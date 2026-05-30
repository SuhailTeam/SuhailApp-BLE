# Suhail (BLE Relay Server) — AI Context File

> This file is for AI coding assistants (Claude, GPT, Copilot, etc.) to understand this repo. Read it before making any changes.

## What is this?

Suhail is an AI-powered assistive app for **visually impaired users**, built for **Mentra Live** smart glasses. It is a graduation project (SWE 496, King Saud University).

**This repository is the BLE relay server.** It is a plain **Bun/TypeScript + Express** HTTP service that provides the AI backend for the **BLE mobile app** in `mobile/` (a React Native / Expo app using `@mentra/bluetooth-sdk` that talks to the glasses directly over Bluetooth). The mobile app captures voice and photos over BLE itself, then calls this server's HMAC-authenticated **`/api/*` relay** for the AI work: intent routing, vision, face recognition/enrollment, STT, TTS, and BLE photo capture.

**This repo does NOT run the MentraOS cloud app.** The original cloud-app path (glasses ↔ phone ↔ MentraOS Cloud ↔ server over WebSocket, via `@mentra/sdk` and `onSession`) lives in a **separate repository**. This server has no `@mentra/sdk` dependency, no WebSocket session handling, no voice/listening state machine, and no web companion view. If you're looking for that code, it's not here by design.

**Hardware note:** Mentra Live glasses have a camera, microphone, speakers, LEDs, and WiFi — but **NO display**. The mobile app drives all of that over BLE; this server never talks to the glasses directly except to receive a photo upload (see the photo-capture flow).

## Environments

### Local Development
- Run with `bun run dev` (auto-restart) or `bun run start`.
- Expose it with a tunnel (e.g. `ngrok http 3000`) so the mobile app can reach it; set that public URL as the mobile app's `EXPO_PUBLIC_RELAY_BASE_URL`.
- Use `.env` for environment variables.

### Production (Railway)
- The `main` branch auto-deploys to **Railway** on push — Railway provides the public URL; env vars live in its dashboard.

## Tech Stack

- **Runtime:** Bun (not Node.js) — `bun run start`, `bun install`, etc.
- **Language:** TypeScript (strict mode)
- **HTTP:** Express (built by `src/server.ts`, started by `src/index.ts`)
- **Storage:** AWS Rekognition (face collection) + local filesystem (`data/faces/`) for face photos/metadata; in-memory `photo-cache` for the BLE capture flow.
- **AI services:** OpenRouter (Google Gemini 2.5 Flash Lite) for vision + intent classification + script normalization; AWS Rekognition for face recognition; **ElevenLabs** for direct TTS (`/api/tts`) and Scribe STT (`/api/stt`).

## Architecture & Data Flow

```
BLE mobile app (over Wi-Fi/HTTP, HMAC-authed)
  → POST /api/stt        (audio → text)
  → POST /api/normalize + POST /api/intent   (text → {command, params})
  → POST /api/vision/* or /api/faces/*        (image → result)   [image via {image} or {photoToken}]
  → POST /api/tts        (text → audio bytes, played through the glasses by the app)

Photo capture: POST /api/photo/upload-url → glasses POST /api/photo/upload/:token → GET /api/photo/wait/:token
Contacts screen: GET /api/faces · GET /api/faces/:id/photo · PUT/DELETE /api/faces/:id
```

A typical command turn in the mobile app: `/api/stt` (audio→text) → `/api/normalize` + `/api/intent` (text→command) → a `/api/vision/*` or `/api/faces/*` endpoint (image→result) → `/api/tts` (text→audio).

### Server bootstrap

- **`src/index.ts`** — `main()`: `buildApp()`, then `await loadPersistedFaces()` (init/verify the Rekognition collection + local metadata), then `await probeOpenRouterStatus()` (best-effort key/quota check, never throws), then `app.listen(config.port)`.
- **`src/server.ts`** — `buildApp()`: creates the Express app, registers `GET /health`, then `registerFaceRoutes(app)`, then `registerRelayRoutes(app)`. **No global body parser** is installed — the relay router and the face routes attach their own `express.json()` with the right limit, and the multipart photo-upload webhook must not have `json()` applied.

> Registration order matters: the specific face routes (`GET/PUT/DELETE /api/faces*`) are registered **before** the relay router's `app.use("/api", router)` so they win over it. They never collide with the relay's `POST /api/faces/{recognize,recognize-all,enroll}`.

## Relay API

`src/relay/routes.ts` (mounted by `registerRelayRoutes`) is the HTTP backend the mobile app calls. All endpoints are **POST** under `/api` and require HMAC-Bearer auth (`src/relay/auth.ts`) — **except** the glasses photo-upload webhook (token-authed).

**Auth.** Headers `X-Device-Id: <uuid>` + `Authorization: Bearer <token>`, where `token = hex(HMAC-SHA256(deviceId, RELAY_SHARED_SECRET))`, compared in constant time (`relayAuth`). When `RELAY_SHARED_SECRET` is empty, auth is skipped (dev mode, one-time startup warning via `warnIfDevAuth`).

**Image input.** Vision/face endpoints accept either `{ image: <base64> }` (direct) or `{ photoToken: <hex> }` (BLE flow). The relay router's body limit is 10MB.

| Endpoint (POST) | Body | Returns |
|-----------------|------|---------|
| `/api/intent` | `{ text, language? }` | `{ command, params?, rawText }` (Scribe annotations stripped first) |
| `/api/normalize` | `{ text, language }` | `{ text }` (Arabic-script English → Latin; no-op when not needed) |
| `/api/vision/scene` | `{ image\|photoToken, language? }` | `{ description, confidence }` |
| `/api/vision/ocr` | `{ image\|photoToken, context?, language? }` | `{ text }` |
| `/api/vision/currency` | `{ image\|photoToken }` | `CurrencyResult` |
| `/api/vision/object` | `{ image\|photoToken, target, language? }` | `{ found, location, confidence }` |
| `/api/vision/color` | `{ image\|photoToken, language? }` | `{ colorName, hex }` |
| `/api/vision/vqa` | `{ image\|photoToken, question, language? }` | `{ description, confidence }` |
| `/api/faces/recognize` | `{ image\|photoToken }` | `FaceRecognitionResult` |
| `/api/faces/recognize-all` | `{ image\|photoToken }` | `MultiFaceResult` |
| `/api/faces/enroll` | `{ image\|photoToken, name }` | `{ faceId, name, enrolledAt }` |
| `/api/stt` | `{ audio (base64 s16le 16kHz mono PCM), language? }` | `ScribeResult` (503 if no `ELEVENLABS_API_KEY`; rejects <1KB PCM) |
| `/api/tts` | `{ text, voicePreset?, voiceId?, speed?, format? }` | audio bytes + `Content-Type`/`X-Audio-Format` headers (≤5000 chars; 503 if no key) |

### Face-management routes (`src/relay/faces.ts`)

The BLE mobile **Contacts** screen calls these. Enrolled faces live on the server (AWS Rekognition collection + `data/faces/` photos & metadata), so the app must ask the server for them.

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `GET` | `/api/faces` | HMAC | `{ faces, count }` (name, faceId, hasPhoto, enrolledAt) |
| `GET` | `/api/faces/:faceId/photo` | **none** | JPEG (loaded as an `<img src>` by the app, so it can't send auth headers) |
| `PUT` | `/api/faces/:faceId` | HMAC | `{ success }` (body `{ name }`) |
| `DELETE` | `/api/faces/:faceId` | HMAC | `{ success }` |

### Photo capture flow (BLE)

`POST /api/photo/upload-url` mints a one-shot token + `uploadUrl` (60s TTL) → mobile tells the glasses to upload → glasses `POST /api/photo/upload/:token` (multipart `photo`, **unauthenticated** — the URL token is the auth) → mobile long-polls `GET /api/photo/wait/:token` (≤20s) → mobile calls a vision/face endpoint with `{ photoToken }`. The server-side wait exists because the iOS BLE SDK never emits a photo-success event. Backed by `src/services/photo-cache.ts` (in-memory, 20 in-flight max, 60s TTL, 30s sweep).

## Command Routing (`src/relay/command-router.ts`)

`routeCommand(text, language?)` is reused by `POST /api/intent`. Hybrid: **LLM intent classification** primary, **keyword matching** fallback.

- **Primary (LLM):** OpenRouter, model from `CLASSIFICATION_MODEL` (default `google/gemini-2.5-flash-lite`). Classifies into **9 intents** (8 commands + `unknown`) and extracts params (object name for find-object, question for visual-qa). 2-second timeout → falls back to keywords. Requires `OPENROUTER_API_KEY` (warns + falls back if missing).
- **Fallback (keyword):** matches the first word of the transcription:

| Keyword | Command | Arabic |
|---------|---------|--------|
| "describe" | scene-summarize | "وصف" |
| "read" | ocr-read-text | "اقرأ" |
| "who" | face-recognize | "من" |
| "enroll" | face-enroll | "سجل" |
| "find" | find-object | "وين" |
| "money" | currency-recognize | "فلوس" |
| "color" | color-detect | "لون" |
| (anything else) | visual-qa | (fallback) |

The mobile app maps the returned `command` to the matching relay endpoint(s) itself.

## Services Layer (`src/services/`)

Relay handlers call these services **directly** (there is no facade).

### vision-service.ts
OpenRouter, model from `VISION_MODEL` (default `google/gemini-2.5-flash-lite`). All functions delegate to a shared `callVisionAPI` helper with explicit `max_tokens`. Tasks: `describeScene`, `answerVisualQuestion` (VQA), `recognizeCurrency`, `detectObject` (location, e.g. "to your right, on the table"), `detectColor` (name + hex), `extractText` (OCR). Bilingual prompts (ar/en); images sent as base64 data URI. The language default comes from `config.defaultLanguage` (overridable per request via the `language` field).

### face-service.ts
AWS Rekognition + local file storage. `recognizeFace` (single best match), `recognizeAllFaces` (`DetectFacesCommand` → crop each with `sharp`/`cropFace` → per-face `SearchFacesByImageCommand`; returns `MultiFaceResult`; optimizes single-face, caps at 10, skips boxes <3% of image, parallel via `Promise.allSettled()`), `enrollFace`, `listFaces`, `deleteFace`, `renameFace`, `loadPersistedFaces` (init/verify collection on startup), `getFacePhotoPath`. Names are hex-encoded for Rekognition's `ExternalImageId`; `data/faces/metadata.json` holds the human-readable mappings. AWS credential errors are handled gracefully (warn + continue).

### elevenlabs-tts.ts
`synthesize()` calls ElevenLabs TTS directly for `/api/tts`. Voice presets (`male`=Adam, `female`=Rachel); mp3/pcm/ulaw output formats (`isValidFormat()`, `contentTypeFor()`). Returns audio bytes. Held server-side only — never shipped to the mobile binary.

### elevenlabs-stt.ts
`transcribe()` runs ElevenLabs **Scribe** (`scribe_v1`) for `/api/stt`. Takes raw 16kHz/16-bit/mono s16le PCM from the glasses mic and prepends a 44-byte WAV header. Returns `ScribeResult { text, languageCode?, confidence? }`.

### photo-cache.ts
In-memory token store for the two-step BLE photo flow (see Photo capture flow): `mintToken()` → glasses upload → `storeBytes()` → `getBytes()`/`waitForBytes()` (one-shot consume). Caps: 20 in-flight, 60s TTL, 30s sweep.

### openrouter-status.ts
`probeOpenRouterStatus()` checks OpenRouter `/credits` at startup to validate the key/quota (free call, never throws). Logs loudly if the key is missing/over-quota so silent fallbacks aren't a surprise.

## Utilities (`src/utils/`)

- **config.ts** — environment variables (all from `process.env` with defaults). See table below.
- **logger.ts** — `new Logger("Tag")` → `[Tag]`-prefixed logs.
- **image-utils.ts** — `cropFace(base64, boundingBox)` (used by multi-face recognition in face-service).
- **transcription-filter.ts** — `stripAnnotations()` (used by `/api/intent` to clean Scribe output), plus `isValidTranscription` / `needsScriptNormalization`.
- **transcription-normalizer.ts** — `normalizeTranscription()` — LLM-based Arabic-script-English → Latin (used by `/api/normalize`).

## Bilingual Support (Arabic/English)

The relay is language-aware via a `language` field on requests (`"ar" | "en"`); when omitted, services fall back to `config.defaultLanguage` (`DEFAULT_LANGUAGE`, default `ar`). Vision prompts are written bilingually in `vision-service.ts`.

## Environment Variables

Defined in `src/utils/config.ts`, loaded from `.env` (local) or Railway (production). Keep `.env.example` in sync.

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Server port | `3000` |
| `OPENROUTER_API_KEY` | OpenRouter — vision + intent classification + normalization | (empty) |
| `VISION_MODEL` | OpenRouter model for vision tasks | `google/gemini-2.5-flash-lite` |
| `CLASSIFICATION_MODEL` | OpenRouter model for intent classification + normalization | `google/gemini-2.5-flash-lite` |
| `AWS_REGION` | AWS region for Rekognition | `us-east-1` |
| `AWS_REKOGNITION_COLLECTION_ID` | Face collection ID in Rekognition | `suhail-faces` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS credentials (used implicitly by the AWS SDK) | (empty) |
| `DEFAULT_LANGUAGE` | Response language ("ar" or "en") | `ar` |
| `CONFIDENCE_THRESHOLD` | Min confidence for face recognition (≤1 = ratio, >1 = percent) | `0.5` |
| `RELAY_SHARED_SECRET` | Shared secret for the BLE app's HMAC-Bearer auth. Empty → relay is OPEN (dev mode, startup warning). | (empty) |
| `ELEVENLABS_API_KEY` | ElevenLabs key for `/api/stt` (Scribe) + `/api/tts`. Server-only. Empty → those endpoints return 503. | (empty) |
| `ELEVENLABS_DEFAULT_VOICE_ID` | Default voice for `/api/tts` when no override is passed | `21m00Tcm4TlvDq8ikWAM` (Rachel) |
| `ELEVENLABS_MODEL` | ElevenLabs TTS model for the relay | `eleven_flash_v2_5` |

## Project Structure

```
suhail/
├── src/
│   ├── index.ts                        # Bootstrap — buildApp(), startup probes, listen(PORT)
│   ├── server.ts                       # buildApp() — Express app + /health + route mounts
│   ├── relay/
│   │   ├── routes.ts                   # POST /api/{intent,normalize,vision/*,faces/{recognize,...},stt,tts,photo/*}
│   │   ├── auth.ts                     # HMAC-Bearer auth middleware (RELAY_SHARED_SECRET)
│   │   ├── faces.ts                    # GET/PUT/DELETE /api/faces* (face management)
│   │   └── command-router.ts           # LLM intent classification + keyword fallback (used by /api/intent)
│   ├── services/
│   │   ├── vision-service.ts           # OpenRouter/Gemini vision (scene, VQA, currency, object, color, OCR)
│   │   ├── face-service.ts             # AWS Rekognition (recognition + enrollment) + local file storage
│   │   ├── elevenlabs-tts.ts           # Direct ElevenLabs TTS for /api/tts
│   │   ├── elevenlabs-stt.ts           # ElevenLabs Scribe STT for /api/stt
│   │   ├── photo-cache.ts              # In-memory token cache for the BLE photo-capture flow
│   │   └── openrouter-status.ts        # Startup probe of OpenRouter /credits
│   ├── utils/
│   │   ├── config.ts                   # Environment variables
│   │   ├── logger.ts                   # Tag-based [Tag] prefix logging
│   │   ├── image-utils.ts              # cropFace() for multi-face recognition
│   │   ├── transcription-filter.ts     # stripAnnotations() + validation
│   │   └── transcription-normalizer.ts # LLM script normalization (Arabic-script English → Latin)
│   └── types/
│       └── index.ts                    # Shared interfaces and types
├── data/faces/metadata.json            # Face enrollment metadata (name ↔ faceId); photos saved alongside — gitignored
├── mobile/                             # React Native / Expo BLE app (own CLAUDE.md, README) — talks to glasses over BLE + this relay
├── landing/                            # React + Vite landing page (standalone marketing site; NOT served by this server)
├── .env.example
├── package.json, tsconfig.json, README.md
```

## Rules for Contributing

1. **Relay-only** — this server has no MentraOS SDK, no glasses session, no display, no TTS playback. It returns data/audio bytes over HTTP; the mobile app plays audio and drives the glasses.
2. **Always catch errors** — every `/api/*` handler is wrapped (`wrap(...)` in `routes.ts`) and returns structured JSON errors. Keep that pattern.
3. **Call services directly** — relay handlers import `vision-service`, `face-service`, `elevenlabs-*`, `photo-cache`, `command-router` directly. There is no facade; don't add one.
4. **Use the Logger** — `new Logger("TagName")` for `[TagName]`-prefixed logs.
5. **Keep auth consistent** — new relay endpoints go under the HMAC router (or `relayAuth`). The face **photo** GET is the only intentionally-unauthenticated route (it's an `<img src>`).
6. **Keep it simple** — this is a graduation project; no over-engineering.
7. **Keep `.env.example` up to date** — whenever you add/remove/rename an env var in `config.ts`, update `.env.example`.
8. **Keep docs in sync** — when you change features, APIs, services, files, or structure, update **both** `CLAUDE.md` and `README.md` (and `mobile/CLAUDE.md` for mobile changes). Outdated docs are worse than none.

## Version Control Etiquette

**Branches:** `main` (production, auto-deploys to Railway — always stable), `development` (integration), `feature/*` (short-lived, off `development`).

**Workflow:** branch off `development` → conventional commits → PR into `development` → test → when stable, PR `development` → `main` → tag a GitHub release → fast-forward `development` to match `main`.

**Commit messages** (conventional): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.

**Rules:** never force-push or commit directly to `main`/`development` (always PR); keep `development` and `main` in sync after a release; run `bun run typecheck` before opening a PR; keep PRs focused; delete merged feature branches.

## Adding a New Relay Endpoint

1. If it needs a new AI capability, add it to the relevant service in `src/services/` (or create a new service file with one clear responsibility).
2. Add the route inside `registerRelayRoutes()` in `src/relay/routes.ts`, wrapped with the shared `wrap(...)` handler and mounted on the HMAC `router` (use `relayAuth` directly for app-level routes like the face-management ones in `faces.ts`).
3. If it's a new command intent, extend the `CommandType`/`IntentType` unions in `src/types/index.ts`, add the keyword route + LLM intent name in `src/relay/command-router.ts`, and have the mobile app map the command to the new endpoint.
4. Update `CLAUDE.md` + `README.md` (and `.env.example` if you added an env var).

## Commands Quick Reference

```bash
bun install           # Install dependencies
bun run start         # Start server
bun run dev           # Start with --watch (auto-restart)
bun run typecheck     # TypeScript type checking
```
