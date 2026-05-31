# BLE-only Server Refactor — Design

**Date:** 2026-05-31
**Branch:** `feature/ble-only-refactor`
**Author:** Abdullah Alqobaisi (with Claude)

## Problem

This repo (`SuhailTeam/SuhailApp-BLE`) is the **BLE fork** of Suhail. The original MentraOS cloud-app version lives in a separate repo (`~/SuhailApp`). Yet this repo's server still bundles the **entire MentraOS cloud-app path** — voice session handling, listening-mode state machine, button/swipe handling, 8 command handlers, the `AppSession`-bound TTS/cue/settings services, and a web companion SPA — none of which the BLE mobile app ever uses.

The BLE mobile app (`mobile/`) talks to the glasses directly over Bluetooth and only ever calls this server's **HTTP relay** (`/api/*`) for AI work. Everything else is dead weight: it bloats the codebase (~half of `src/`), couples the server to `@mentra/sdk`, ships ~11.6 MB of unused face.js model weights, and makes the project harder to reason about.

**Goal:** strip this repo down to a focused **BLE relay server** — a plain Bun/Express HTTP service that does intent routing, vision, faces, STT, TTS, and BLE photo capture — and nothing else.

## Scope

**In scope:** delete the cloud-app path; convert `extends AppServer` → plain Express; relocate the four face-management routes the mobile app depends on; trim shared modules of cloud-only code; drop `@mentra/sdk`; remove dead assets (`models/`, committed `.tsbuildinfo`); decouple `landing/`; rewrite docs.

**Out of scope:** any change to `mobile/` (the BLE app is untouched); any new features; behavior changes to the relay endpoints (logic is preserved verbatim, only relocated).

## Non-negotiable constraints

- **The BLE mobile app must keep working unchanged.** Every endpoint in `mobile/src/relay/*` and `mobile/src/screens/ContactsScreen.tsx` must still resolve with identical request/response shapes.
- `GET /api/faces/:faceId/photo` **stays unauthenticated** — the mobile Contacts UI loads it as a plain `<Image src>` and cannot attach auth headers.
- The project rule *"keep it simple, no over-engineering"* (graduation project) governs the restructure: minimal folder churn, no speculative abstraction.

## What the BLE mobile app actually uses (the contract to preserve)

Verified by reading `mobile/src`:

| Endpoint | Mobile caller |
|----------|---------------|
| `POST /api/intent` | `relay/intent.ts` |
| `POST /api/normalize` | `state/listening.ts` |
| `POST /api/vision/{scene,ocr,currency,object,color,vqa}` | `commands/*.ts` |
| `POST /api/faces/{recognize,recognize-all,enroll}` | `relay/faces.ts`, `commands/*.ts` |
| `POST /api/stt` | `relay/stt.ts` |
| `POST /api/tts` | `audio/tts.ts` |
| `POST /api/photo/upload-url`, `GET /api/photo/wait/:token` | `ble/camera.ts` |
| `POST /api/photo/upload/:token` (glasses webhook, unauth) | glasses |
| `GET /api/faces` | `relay/faces.ts` → `ContactsScreen.tsx` |
| `GET /api/faces/:id/photo` | `relay/faces.ts` (`facePhotoUrl`) |
| `PUT /api/faces/:id`, `DELETE /api/faces/:id` | `relay/faces.ts` → `ContactsScreen.tsx` |

The mobile app does **not** call `/api/status`, `/api/activity`, `/api/settings`, or `/webview`.

## Target architecture

A plain Express app, built in `server.ts`, started by `index.ts`. No MentraOS SDK.

```
src/
  index.ts              # bootstrap: build app, run startup probes, listen(PORT)
  server.ts             # buildApp() → Express app with /health, relay mount, face routes
  relay/
    routes.ts           # POST /api/* relay endpoints (logic unchanged)
    auth.ts             # HMAC-Bearer middleware (unchanged)
    faces.ts            # NEW — GET /api/faces, GET :id/photo, PUT/DELETE :id (moved off app.ts)
    command-router.ts   # MOVED from src/commands/ (only the relay uses it now)
  services/
    vision-service.ts   # trimmed: getSettings() → config.defaultLanguage
    face-service.ts     # unchanged
    elevenlabs-tts.ts    elevenlabs-stt.ts    photo-cache.ts    openrouter-status.ts
  utils/
    config.ts  logger.ts
    image-utils.ts      # trimmed to cropFace + base64 helpers (capturePhoto removed)
    transcription-filter.ts  transcription-normalizer.ts
  types/
    index.ts            # trimmed: drop CommandHandler iface + @mentra/sdk import + FaceRecord
```

### Startup sequence (replacing `AppServer.initialize()` + `start()`)

`index.ts`:
1. `const app = buildApp()`
2. `await probeOpenRouterStatus()` (best-effort, never throws)
3. `await faceService.loadPersistedFaces()` (init/verify Rekognition collection + local metadata)
4. `app.listen(config.port)` and log the bound port.

`server.ts` `buildApp()`:
1. `const app = express()`
2. `app.get("/health", ...)` → `{ status: "ok" }` (replaces `AppServer healthCheck: true`)
3. `registerFaceRoutes(app)` (the four management routes)
4. `registerRelayRoutes(app)` (existing — mounts photo webhook + `/api` router)
5. Return `app`.

> **Mount ordering:** `registerRelayRoutes` already registers the unauthenticated `POST /api/photo/upload/:token` **before** `app.use("/api", router)`. Face routes are registered before the relay router as well; none of them collide (`GET/PUT/DELETE /api/faces*` vs the relay's `POST` paths). `relay/routes.ts` keeps owning the `express.json({ limit: "10mb" })` body parser on its router; `faces.ts` adds its own small `express.json()` for the `PUT` body.

### Face routes (`relay/faces.ts`)

Moved verbatim in behavior from `app.ts`, but calling `faceService` directly (no `ai-handler` facade):

- `GET /api/faces` → `faceService.listFaces()` → `{ faces, count }`. **HMAC-authed** (`relayAuth`).
- `GET /api/faces/:faceId/photo` → `faceService.getFacePhotoPath()` → `sendFile`. **Unauthenticated** (image tag).
- `PUT /api/faces/:faceId` `{ name }` → `faceService.renameFace()` → `{ success }`. **HMAC-authed.**
- `DELETE /api/faces/:faceId` → `faceService.deleteFace()` → `{ success }`. **HMAC-authed.**

> **Auth change:** today these routes are open. The mobile relay client already sends `X-Device-Id` + `Authorization` on `getJson/putJson/deleteJson`, so tightening list/rename/delete to `relayAuth` is transparent to the app. The photo route stays open. When `RELAY_SHARED_SECRET` is empty (dev), `relayAuth` is a pass-through (existing behavior), so local dev is unaffected.

## Delete list

**Cloud-app code (whole files):**
- `src/app.ts`
- `src/commands/` — all except `command-router.ts` (i.e. `base-command.ts`, `scene-summarize.ts`, `ocr-read-text.ts`, `face-recognize.ts`, `face-enroll.ts`, `find-object.ts`, `currency-recognize.ts`, `visual-qa.ts`, `color-detect.ts`)
- `src/services/ai-handler.ts`, `tts-service.ts`, `cue-service.ts`, `settings-store.ts`, `ocr-service.ts`
- `src/utils/timeline.ts`

**Web companion (cloud-only):**
- `public/index.html`, `public/cues/` (whole `public/` directory goes)
- the `/`, `/webview`, `/api/status`, `/api/activity`, `/api/settings`, `/cues` routes (they live in the deleted `app.ts`)

**Dead assets / cruft:**
- `models/` (~11.6 MB face.js weights — zero references; recognition is 100% AWS Rekognition)
- `landing/tsconfig.app.tsbuildinfo` (committed build cache) + add `**/*.tsbuildinfo` to `.gitignore`

**Stale docs:**
- `TODO.md`, `TODO-SDK-UPDATES.md`

**Dependency:**
- remove `@mentra/sdk` from `package.json`; add `express` (was transitive via the SDK) and `@types/express` (devDep).

## Trim list (surviving files edited, not deleted)

- `src/types/index.ts` — remove `import type { AppSession }`, the `CommandHandler` interface (cloud-only), and the unused `FaceRecord` type. Keep `Language`, `CommandType`, `IntentType`, `ClassificationResult`, `RouteResult`, `VisionResponse`, `CurrencyResult`, `CurrencyBill`, `FaceRecognitionResult`, `MultiFaceResult`, `FaceMatch`.
- `src/utils/image-utils.ts` — remove `capturePhoto(session)` (the only `@mentra/sdk` user) and its import. Keep `cropFace` (used by `face-service`) and the base64 helpers iff still referenced; drop any that become orphaned.
- `src/services/vision-service.ts` — replace `import { getSettings }` + `language ?? getSettings().language` with `language ?? config.defaultLanguage`.
- `src/relay/routes.ts` — update the `command-router` import path (`../commands/command-router` → `./command-router`). No logic change.
- `package.json` — remove the `build` script (it `cd landing && … build`s the marketing site, which this repo no longer serves). Remove `@mentra/sdk`, add `express`/`@types/express`.

## `landing/` decision

Keep the source in the repo (harmless; may still be deployed separately to its own host), but **decouple it from the server**: remove the root `build` script that builds it. `landing/` retains its own `package.json` and can be built from within its own directory. Delete only its committed `.tsbuildinfo`.

## Docs

- **`CLAUDE.md`** — rewrite as a BLE-relay-server context file: drop the MentraOS SDK reference, cloud-app session lifecycle, listening mode, command-handler pattern, webview, and cue sections. Keep/expand the Relay API, services (vision/face/elevenlabs/photo-cache), config, and the BLE photo-capture flow. Cross-reference `mobile/CLAUDE.md`. (Heed the existing memory: keep `CLAUDE.md` under ~40k chars — this refactor should make that easy.)
- **`README.md`** — rewrite to describe the BLE relay server + how it pairs with the `mobile/` app.
- Delete `TODO.md`, `TODO-SDK-UPDATES.md`.

## Data flow (after refactor)

```
BLE mobile app (over Wi-Fi/HTTP, HMAC-authed)
  → POST /api/stt        (audio → text)
  → POST /api/normalize  + POST /api/intent   (text → {command, params})
  → POST /api/vision/*  or  /api/faces/*       (image → result)        [image via {image} or {photoToken}]
  → POST /api/tts        (text → audio bytes, played through glasses)

Photo capture: POST /api/photo/upload-url → glasses POST /api/photo/upload/:token → GET /api/photo/wait/:token

Contacts screen: GET /api/faces · GET /api/faces/:id/photo · PUT/DELETE /api/faces/:id
```

Internally: relay handlers call `vision-service`, `face-service`, `elevenlabs-tts/stt`, `command-router`, `photo-cache` directly — exactly as today. The only removed indirection is the `ai-handler` facade (cloud-only) and the `AppSession`-bound TTS/cue/settings layer.

## Error handling

Unchanged from today's relay: each `/api/*` handler is wrapped (`wrap(...)` in `routes.ts`) and returns structured JSON errors; `relayAuth` returns 401 on bad/missing HMAC; STT returns 503 when `ELEVENLABS_API_KEY` is unset and 4xx on <1KB PCM; TTS returns 503 without a key and 4xx over 5000 chars. The startup probes (`probeOpenRouterStatus`, `loadPersistedFaces`) log loudly but never crash the boot.

## Testing / verification

This is a deletion-and-relocation refactor with no logic changes, so verification is about proving the surviving surface is intact:

1. **`bun run typecheck`** passes (catches dangling imports from deleted modules — the primary safety net).
2. **Server boots** (`bun run start`) without `@mentra/sdk`, logs the OpenRouter probe + face-collection init + bound port, and serves `GET /health`.
3. **Endpoint smoke test** (script or manual `curl` with a valid HMAC token) hits each surviving route and asserts the response shape matches the contract table above — especially the four face-management routes and one vision endpoint.
4. **`grep` sweeps confirm zero references** remain to deleted modules (`@mentra/sdk`, `ai-handler`, `tts-service`, `cue-service`, `settings-store`, `ocr-service`, `timeline`, `getSettings`, `capturePhoto`).
5. **`mobile/` untouched** — `git diff --stat` shows no changes under `mobile/`.

## Risks & mitigations

- **Hidden import of a deleted module** → `bun run typecheck` is the gate; run it before committing.
- **`image-utils` over-trim** (removing a base64 helper still used by a service) → check importers before deleting each export; typecheck confirms.
- **Express not resolving after dropping the SDK** → add `express` as a direct dep and `bun install`; the relay already `require("express")`.
- **Face-route auth regression** → `relayAuth` is a pass-through when `RELAY_SHARED_SECRET` is empty (dev) and the mobile client already sends headers in prod; verify with an authed + unauthed `curl`.
- **Reversibility** → all deleted cloud code remains in git history and in the sibling `~/SuhailApp` repo.

## Sequencing (high level — detailed plan to follow)

1. Add `express`/`@types/express`, remove `@mentra/sdk`, `bun install`.
2. Create `relay/faces.ts`; move `command-router.ts` into `relay/`.
3. Create `server.ts` + new `index.ts` (plain Express bootstrap + probes + `/health`).
4. Trim `types/index.ts`, `image-utils.ts`, `vision-service.ts`; fix the `command-router` import in `routes.ts`.
5. Delete the cloud files, `public/`, `models/`, stale TODOs, `.tsbuildinfo`; update `.gitignore` and `package.json` `build` script.
6. `bun run typecheck` → boot → smoke test.
7. Rewrite `CLAUDE.md` + `README.md`; keep `.env.example` in sync (drop cloud-only vars: `PACKAGE_NAME`, `MENTRAOS_API_KEY`, `PUBLIC_BASE_URL`).
8. Open PR into `development`.
