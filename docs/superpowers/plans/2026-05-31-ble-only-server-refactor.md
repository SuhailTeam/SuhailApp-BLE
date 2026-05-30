# BLE-only Server Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip this repo's server down to a focused BLE relay (plain Bun/Express HTTP service), deleting the entire MentraOS cloud-app path and all dead code.

**Architecture:** Replace `SuhailApp extends AppServer` with a plain Express app built in `server.ts` and started by `index.ts`. Relocate the four face-management routes the mobile app depends on into `relay/faces.ts` (calling `face-service` directly). Move `command-router` into `relay/`. Delete cloud-only command handlers, services, the webview SPA, face.js model weights, and `@mentra/sdk`.

**Tech Stack:** Bun, TypeScript (strict), Express, AWS Rekognition, OpenRouter (Gemini), ElevenLabs, `sharp`, `multer`.

**Verification model:** This repo has **no test framework** (no `tests/`, no test script — confirmed). It's a deletion-and-relocation refactor with no logic changes, so the safety net is `bun run typecheck` + a boot + `curl` smoke test, plus `grep` sweeps proving zero dangling references. **`bun run typecheck` is only expected to pass after Task 7** (once all deletions + trims land); mid-refactor commits are coherent logical units but may not typecheck. This is normal for a deletion refactor and is called out per-task.

**Spec:** `docs/superpowers/specs/2026-05-31-ble-only-server-refactor-design.md`

**Contract to preserve (must not break `mobile/`):** every endpoint in the spec's "What the BLE mobile app actually uses" table, with identical request/response shapes. `GET /api/faces/:id/photo` stays unauthenticated. `mobile/` is never edited.

---

## File Structure (end state)

```
src/
  index.ts              # MODIFY (rewrite): bootstrap — buildApp(), probes, listen(PORT)
  server.ts             # CREATE: buildApp() → Express app + /health + mounts
  relay/
    routes.ts           # MODIFY: command-router import path only
    auth.ts             # unchanged
    faces.ts            # CREATE: GET/PUT/DELETE /api/faces* (moved off app.ts)
    command-router.ts   # MOVE from src/commands/command-router.ts
  services/
    vision-service.ts   # MODIFY: getSettings() → config.defaultLanguage
    face-service.ts     # unchanged
    elevenlabs-tts.ts    elevenlabs-stt.ts    photo-cache.ts    openrouter-status.ts   # unchanged
  utils/
    config.ts           # MODIFY: drop cloud-only fields
    image-utils.ts      # MODIFY: drop capturePhoto + @mentra/sdk import
    logger.ts            transcription-filter.ts    transcription-normalizer.ts   # unchanged
  types/
    index.ts            # MODIFY: drop @mentra/sdk import, CommandHandler, ListeningState, FaceRecord
```

Deleted: `src/app.ts`, `src/commands/*` (except moved router), `src/services/{ai-handler,tts-service,cue-service,settings-store,ocr-service}.ts`, `src/utils/timeline.ts`, `public/`, `models/`, `TODO.md`, `TODO-SDK-UPDATES.md`, `landing/tsconfig.app.tsbuildinfo`.

---

## Task 1: Add `express` as a direct dependency

`express` is currently only transitive (via `@mentra/sdk`). The relay `require("express")`s it, and `server.ts`/`faces.ts` will `import express`. Promote it before we remove the SDK.

**Files:** Modify `package.json`

- [ ] **Step 1: Add deps**

In `package.json`, add to `dependencies`: `"express": "^4.22.2"`. Add to `devDependencies`: `"@types/express": "^5.0.6"`. (Leave `@mentra/sdk` in place for now — removed in Task 7.)

- [ ] **Step 2: Install**

Run: `bun install`
Expected: completes; `express` and `@types/express` resolve as direct deps.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add express as a direct dependency"
```

---

## Task 2: Create `src/relay/faces.ts`

The four face-management routes, moved off `app.ts`, calling `face-service` directly (no `ai-handler` facade). `list`/`rename`/`delete` are HMAC-authed via `relayAuth`; the photo route stays open (mobile loads it as `<Image src>`).

**Files:** Create `src/relay/faces.ts`

- [ ] **Step 1: Write the file**

```typescript
import * as fs from "node:fs/promises";
import express from "express";
import { listFaces, deleteFace, renameFace, getFacePhotoPath } from "../services/face-service";
import { Logger } from "../utils/logger";
import { relayAuth } from "./auth";

const logger = new Logger("FaceRoutes");

/**
 * Registers the face-management routes the BLE mobile Contacts screen depends on.
 * Mounted directly on the Express app (NOT the relay router) so the unauthenticated
 * photo route can opt out of HMAC auth individually.
 *
 * - GET    /api/faces                list enrolled faces           (HMAC-authed)
 * - GET    /api/faces/:faceId/photo  enrollment photo (image tag)  (UNAUTHENTICATED)
 * - PUT    /api/faces/:faceId        rename                        (HMAC-authed)
 * - DELETE /api/faces/:faceId        delete                        (HMAC-authed)
 *
 * Must be registered BEFORE the relay router's `app.use("/api", router)` so these
 * specific GET/PUT/DELETE paths win over the router. They never collide with the
 * relay's POST /api/faces/{recognize,recognize-all,enroll}.
 */
export function registerFaceRoutes(app: any): void {
  const jsonBody = express.json({ limit: "1mb" });

  app.get("/api/faces", relayAuth, async (_req: any, res: any) => {
    try {
      const faces = await listFaces();
      res.json({ faces, count: faces.length });
    } catch (error) {
      logger.error("Failed to list faces:", error);
      res.status(500).json({ error: "Failed to list faces" });
    }
  });

  app.get("/api/faces/:faceId/photo", async (req: any, res: any) => {
    try {
      const photoPath = getFacePhotoPath(req.params.faceId);
      await fs.access(photoPath);
      res.type("image/jpeg").sendFile(photoPath);
    } catch {
      res.status(404).json({ error: "Photo not found" });
    }
  });

  app.put("/api/faces/:faceId", relayAuth, jsonBody, async (req: any, res: any) => {
    try {
      const { name } = req.body || {};
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      await renameFace(req.params.faceId, name);
      res.json({ success: true });
    } catch (error) {
      logger.error("Failed to rename face:", error);
      res.status(500).json({ error: "Failed to rename face" });
    }
  });

  app.delete("/api/faces/:faceId", relayAuth, async (req: any, res: any) => {
    try {
      await deleteFace(req.params.faceId);
      res.json({ success: true });
    } catch (error) {
      logger.error("Failed to delete face:", error);
      res.status(500).json({ error: "Failed to delete face" });
    }
  });

  logger.info("Face routes registered (GET /api/faces, GET :id/photo, PUT/DELETE :id)");
}
```

- [ ] **Step 2: Sanity check imports exist**

Run: `grep -nE "export (async )?function (listFaces|deleteFace|renameFace|getFacePhotoPath)" src/services/face-service.ts && grep -n "export function relayAuth" src/relay/auth.ts`
Expected: all five symbols print. (`relayAuth` reads only headers, so no body parser is needed before it.)

- [ ] **Step 3: Commit**

```bash
git add src/relay/faces.ts
git commit -m "feat(relay): add face-management routes (moved off cloud app.ts)"
```

---

## Task 3: Create `src/server.ts` and rewrite `src/index.ts`

Plain Express bootstrap replacing `AppServer`. `server.ts` builds the app; `index.ts` runs startup probes and listens.

**Files:** Create `src/server.ts`; Modify (rewrite) `src/index.ts`

- [ ] **Step 1: Create `src/server.ts`**

```typescript
import express from "express";
import { registerFaceRoutes } from "./relay/faces";
import { registerRelayRoutes } from "./relay/routes";
import { Logger } from "./utils/logger";

const logger = new Logger("Server");

/**
 * Builds the BLE relay Express app.
 *
 * Route groups (registration order matters — specific paths before the /api router):
 *   1. GET /health                          — liveness probe
 *   2. registerFaceRoutes(app)              — GET/PUT/DELETE /api/faces*
 *   3. registerRelayRoutes(app)             — POST /api/* relay endpoints + photo upload webhook;
 *                                             owns its own express.json({ limit: "10mb" }) on the /api router
 *                                             and prints the dev-auth warning (warnIfDevAuth).
 *
 * No global body parser is installed here: the relay router and the face routes each
 * attach their own json() with the right limit, and the multipart photo-upload webhook
 * must not have json() applied.
 */
export function buildApp() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  registerFaceRoutes(app);
  registerRelayRoutes(app);

  logger.info("BLE relay app built");
  return app;
}
```

- [ ] **Step 2: Rewrite `src/index.ts`** (replace the entire file)

```typescript
import { buildApp } from "./server";
import { config } from "./utils/config";
import { Logger } from "./utils/logger";
import { loadPersistedFaces } from "./services/face-service";
import { probeOpenRouterStatus } from "./services/openrouter-status";

const logger = new Logger("Main");

async function main(): Promise<void> {
  logger.info("Starting Suhail BLE relay server");
  logger.info(`Port: ${config.port}`);
  logger.info(`Language: ${config.defaultLanguage}`);

  const app = buildApp();

  // Init/verify the Rekognition collection + local face metadata before serving.
  await loadPersistedFaces();

  // Probe OpenRouter so an expired/over-quota key surfaces loudly at boot instead
  // of silently degrading intent classification + normalize. Best-effort, never throws.
  await probeOpenRouterStatus();

  app.listen(config.port, () => {
    logger.info(`Suhail BLE relay listening on port ${config.port}`);
  });
}

main().catch((err) => {
  logger.error("Fatal startup error:", err);
  process.exit(1);
});
```

> Note: `registerRelayRoutes` already calls `warnIfDevAuth()` (routes.ts:103), so the open-relay dev warning still prints — no need to call it here.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "feat(server): plain Express bootstrap replacing AppServer"
```

> typecheck NOT expected to pass yet — `src/app.ts` and cloud modules still exist and break under the deletions below; gate is Task 7.

---

## Task 4: Delete the cloud-app code (except `command-router`)

**Files:** Delete `src/app.ts`, all of `src/commands/` except `command-router.ts`, and the cloud-only services + `timeline`.

- [ ] **Step 1: Delete files**

```bash
git rm src/app.ts \
  src/commands/base-command.ts \
  src/commands/scene-summarize.ts \
  src/commands/ocr-read-text.ts \
  src/commands/face-recognize.ts \
  src/commands/face-enroll.ts \
  src/commands/find-object.ts \
  src/commands/currency-recognize.ts \
  src/commands/visual-qa.ts \
  src/commands/color-detect.ts \
  src/services/ai-handler.ts \
  src/services/tts-service.ts \
  src/services/cue-service.ts \
  src/services/settings-store.ts \
  src/services/ocr-service.ts \
  src/utils/timeline.ts
```

- [ ] **Step 2: Verify only `command-router.ts` remains in commands/**

Run: `ls src/commands/`
Expected: `command-router.ts` only.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: remove MentraOS cloud-app path (onSession, command handlers, cloud services)"
```

---

## Task 5: Move `command-router` into `relay/`

It's relay-only now. Relocate and fix the one importer (`routes.ts`).

**Files:** Move `src/commands/command-router.ts` → `src/relay/command-router.ts`; Modify `src/relay/routes.ts:1`

- [ ] **Step 1: Move the file**

```bash
git mv src/commands/command-router.ts src/relay/command-router.ts
rmdir src/commands
```

- [ ] **Step 2: Fix the import in `routes.ts`**

In `src/relay/routes.ts`, change line 1 from:

```typescript
import { routeCommand } from "../commands/command-router";
```
to:
```typescript
import { routeCommand } from "./command-router";
```

- [ ] **Step 3: Verify no other references to the old path**

Run: `grep -rn "commands/command-router" src`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add -A src/relay src/commands
git commit -m "refactor(relay): move command-router into relay/ (relay-only now)"
```

---

## Task 6: Trim surviving modules of cloud-only code

**Files:** Modify `src/types/index.ts`, `src/utils/image-utils.ts`, `src/services/vision-service.ts`, `src/utils/config.ts`

- [ ] **Step 1: Trim `src/types/index.ts`**

Remove `import type { AppSession } from "@mentra/sdk";` (line 1). Remove the `CommandHandler` interface (the one with `execute(session: AppSession, ...)`), the `ListeningState` type (cloud listening-mode only), and the unused `FaceRecord` interface. Keep `Language`, `CommandType`, `IntentType`, `ClassificationResult`, `RouteResult`, `VisionResponse`, `CurrencyResult`, `CurrencyBill`, `FaceRecognitionResult`, `MultiFaceResult`, `FaceMatch`.

Verify after: `grep -n "AppSession\|CommandHandler\|ListeningState\|FaceRecord" src/types/index.ts` → no output.

- [ ] **Step 2: Trim `src/utils/image-utils.ts`**

Remove the `capturePhoto(session: AppSession)` function and the `import ... AppSession ... from "@mentra/sdk"` line. Keep `cropFace` (used by `face-service`). Keep `stripBase64Prefix`/`getMimeType` ONLY if still referenced — check first:

Run: `grep -rn "stripBase64Prefix\|getMimeType\|cropFace\|capturePhoto" src`
Then delete any of those exports that have zero remaining references outside their own definition. (`cropFace` will remain; drop whichever base64 helpers are now orphaned.)

Verify after: `grep -n "@mentra/sdk\|AppSession\|capturePhoto" src/utils/image-utils.ts` → no output.

- [ ] **Step 3: Trim `src/services/vision-service.ts`**

Remove `import { getSettings } from "./settings-store";` (line 3). Add `config` to its imports if not already present (`import { config } from "../utils/config";` exists at line 1 area — confirm). Change the language-default line (≈line 10) from:

```typescript
  return language ?? getSettings().language;
```
to:
```typescript
  return language ?? config.defaultLanguage;
```

Verify after: `grep -n "getSettings\|settings-store" src/services/vision-service.ts` → no output.

- [ ] **Step 4: Trim `src/utils/config.ts`**

Remove the now-unused cloud-only fields: `packageName`, `mentraApiKey`, `publicBaseUrl`. For `minTranscriptionConfidence`, first confirm it's cloud-only:

Run: `grep -rn "minTranscriptionConfidence" src`
If the only hit (besides config.ts) was the deleted `app.ts`, remove it too. Keep everything else (`port`, `openRouterApiKey`, `visionModel`, `classificationModel`, `awsRegion`, `awsRekognitionCollectionId`, `defaultLanguage`, `confidenceThreshold`, `relaySharedSecret`, `elevenLabs*`).

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/utils/image-utils.ts src/services/vision-service.ts src/utils/config.ts
git commit -m "refactor: trim cloud-only code from types, image-utils, vision-service, config"
```

---

## Task 7: Drop `@mentra/sdk` and typecheck (the gate)

**Files:** Modify `package.json`

- [ ] **Step 1: Verify nothing imports the SDK anymore**

Run: `grep -rn "@mentra/sdk" src`
Expected: no output. (If anything prints, fix it before continuing.)

- [ ] **Step 2: Remove the dependency**

In `package.json`, delete `"@mentra/sdk": "2.1.29"` from `dependencies`. Then:

Run: `bun install`
Expected: completes; `@mentra/sdk` removed from `bun.lock`.

- [ ] **Step 3: TYPECHECK — must pass**

Run: `bun run typecheck`
Expected: **exit 0, no errors.** This is the primary safety gate. If it fails, the error names the dangling import — fix it (usually a leftover reference to a deleted module) and re-run until clean.

- [ ] **Step 4: Verify zero references to every deleted module**

Run:
```bash
grep -rn "ai-handler\|tts-service\|cue-service\|settings-store\|ocr-service\|utils/timeline\|getSettings\|capturePhoto\|from \"./app\"\|from \"../app\"" src
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: drop @mentra/sdk — BLE server no longer depends on the MentraOS SDK"
```

---

## Task 8: Remove dead assets and decouple `landing/`

**Files:** Delete `public/`, `models/`, `TODO.md`, `TODO-SDK-UPDATES.md`, `landing/tsconfig.app.tsbuildinfo`; Modify `.gitignore`, `package.json`

- [ ] **Step 1: Delete dead assets**

```bash
git rm -r public models
git rm TODO.md TODO-SDK-UPDATES.md
git rm landing/tsconfig.app.tsbuildinfo
```

- [ ] **Step 2: Ignore build caches**

Append to `.gitignore`:
```
# TypeScript incremental build caches
**/*.tsbuildinfo
```

- [ ] **Step 3: Decouple landing from the server build**

In `package.json`, remove the `"build": "cd landing && bun install && bun run build"` script (this repo no longer serves the marketing site; `landing/` keeps its own `package.json` and builds independently). Leave `start`, `dev`, `typecheck`.

- [ ] **Step 4: Verify typecheck still clean**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove dead assets (face.js models, webview SPA, cues, stale TODOs) and decouple landing build"
```

---

## Task 9: Runtime verification (boot + smoke test)

**Files:** none (verification only)

- [ ] **Step 1: Boot the server**

Run (background, then check log): `bun run start`
Expected log lines: "Starting Suhail BLE relay server", the face-collection init, the OpenRouter probe result, and "Suhail BLE relay listening on port 3000". No crash, no `@mentra/sdk` errors.

- [ ] **Step 2: Health check**

Run: `curl -s localhost:3000/health`
Expected: `{"status":"ok"}`

- [ ] **Step 3: Face-list smoke (auth path)**

With `RELAY_SHARED_SECRET` set in `.env`, compute a token and call the list route:
```bash
DEV_ID=test-device
SECRET=$(grep '^RELAY_SHARED_SECRET=' .env | cut -d= -f2-)
TOKEN=$(printf %s "$DEV_ID" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.*= //')
curl -s -H "X-Device-Id: $DEV_ID" -H "Authorization: Bearer $TOKEN" localhost:3000/api/faces
```
Expected: `{"faces":[...],"count":N}` (200). A call WITHOUT the headers should return 401 (when the secret is set).

- [ ] **Step 4: Confirm `mobile/` untouched**

Run: `git diff --stat development -- mobile`
Expected: no output (zero changes under `mobile/`).

- [ ] **Step 5: Stop the server.** No commit (verification only).

---

## Task 10: Rewrite docs for the BLE server

**Files:** Modify `CLAUDE.md`, `README.md`, `.env.example`

- [ ] **Step 1: Rewrite `CLAUDE.md`**

Rewrite as a BLE-relay-server context file. **Remove:** the MentraOS SDK reference section, cloud-app session lifecycle/`onSession`, listening-mode state machine, button/swipe handling, the command-handler pattern, `AbstractCommandHandler`, the webview/mini-app API, cue-service, and the "two clients" framing (this repo is now the relay only). **Keep/expand:** project purpose, the Relay API table, the BLE photo-capture flow, services (vision/face/elevenlabs-tts/elevenlabs-stt/photo-cache/openrouter-status/command-router), HMAC auth, env vars, project structure (new `src/` layout), and a pointer to `mobile/CLAUDE.md`. Keep it under ~40k chars (per project memory).

- [ ] **Step 2: Rewrite `README.md`**

Describe the BLE relay server, the new `src/` layout, how it pairs with the `mobile/` app, run commands (`bun run start|dev|typecheck`), and required env (`OPENROUTER_API_KEY`, AWS, `RELAY_SHARED_SECRET`, `ELEVENLABS_API_KEY`). Drop MentraOS-cloud setup, ngrok-as-webhook, and Mentra Developer Console steps that only applied to the cloud app.

- [ ] **Step 3: Sync `.env.example`**

Remove the cloud-only vars: `PACKAGE_NAME`, `MENTRAOS_API_KEY`, `PUBLIC_BASE_URL`, `MIN_CONFIDENCE` (drop the last only if it was removed from `config.ts` in Task 6). Keep `PORT`, `OPENROUTER_API_KEY`, AWS vars, `DEFAULT_LANGUAGE`, `CONFIDENCE_THRESHOLD`, `VISION_MODEL`, `CLASSIFICATION_MODEL`, `RELAY_SHARED_SECRET`, `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`, `ELEVENLABS_MODEL`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md .env.example
git commit -m "docs: rewrite CLAUDE.md + README + .env.example for the BLE relay server"
```

---

## Task 11: Final verification and PR

**Files:** none

- [ ] **Step 1: Final typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/ble-only-refactor
```

- [ ] **Step 3: Open PR into `development`**

```bash
gh pr create --base development --head feature/ble-only-refactor \
  --title "refactor: BLE-only server — remove MentraOS cloud-app path" \
  --body "See docs/superpowers/specs/2026-05-31-ble-only-server-refactor-design.md. Strips the cloud-app path, converts to a plain Express relay, drops @mentra/sdk and ~11.6MB of dead face.js weights. mobile/ untouched; all relay + face-management endpoints preserved."
```

Expected: PR URL printed.

---

## Self-review notes

- **Spec coverage:** delete list → Tasks 4, 7, 8; convert → Task 3; face routes relocation → Task 2; command-router move → Task 5; trims → Task 6; landing decouple → Task 8; docs → Task 10; auth tightening → Task 2; verification → Tasks 7, 9, 11. All spec sections mapped.
- **Type consistency:** `registerFaceRoutes(app)` (Task 2) called in `buildApp` (Task 3); `registerRelayRoutes(app)` existing signature; `loadPersistedFaces`/`probeOpenRouterStatus` (Task 3) match `face-service`/`openrouter-status` exports; `config.defaultLanguage` (Task 6) exists in `config.ts`.
- **No placeholders:** new files (`faces.ts`, `server.ts`, `index.ts`) shown in full; deletions are exact `git rm` lists; trims name exact symbols with verify greps.
