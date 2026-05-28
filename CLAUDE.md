# Suhail — AI Context File

> This file is for AI coding assistants (Claude, GPT, Copilot, etc.) to understand the Suhail project. Read this before making any changes.

## What is Suhail?

Suhail is an AI-powered assistive app for **visually impaired users**, built for **Mentra Live** smart glasses. It captures images from the glasses camera, processes them through cloud AI APIs, and speaks results back to the user. It is a graduation project (SWE 496, King Saud University).

**Critical constraint:** Mentra Live glasses have a camera, microphone, speakers, LEDs, and WiFi — but **NO display**. All output MUST go through `session.audio.speak()`. Do not use `session.layouts` — it exists on the session object but has no effect since Mentra Live has no screen.

### Two clients, one server

This repo's root `src/` is a single Bun/TypeScript server that serves **two** glasses clients:

1. **MentraOS cloud app** (`src/app.ts` → `onSession`) — the original path. Glasses ↔ phone (Mentra app) ↔ MentraOS Cloud ↔ this server, over WebSocket. Voice commands via swipe + transcription; the server speaks results back. **Most of this file documents this path.**
2. **BLE mobile app** (`mobile/` — see `mobile/CLAUDE.md`) — a React Native / Expo app using `@mentra/bluetooth-sdk` to talk to the glasses **directly over Bluetooth**, calling this server's HMAC-authenticated **`/api/*` relay** (`src/relay/`) for the AI work (intent, vision, faces, STT, TTS, photo capture). See **Relay API** below.

The vision/face/routing **services are shared** by both paths — the cloud app calls them in-process via command handlers; the mobile app calls them over HTTP via the relay.

## Environments

### Local Development
- Run the server with `bun run dev` (auto-restart) or `bun run start`.
- Expose it with `ngrok http 3000 --url=unplummeted-teddy-extractable.ngrok-free.dev` (static URL `https://unplummeted-teddy-extractable.ngrok-free.dev`), set as the webhook URL in the Mentra Developer Console and as the relay base URL for the mobile app.
- Use `.env` for environment variables.

### Production (Railway)
- The `main` branch auto-deploys to **Railway** on push — Railway provides the public URL (no ngrok); env vars live in its dashboard.

## Tech Stack

- **Runtime:** Bun (not Node.js) — `bun run start`, `bun install`, etc.
- **Language:** TypeScript (strict mode)
- **SDK:** `@mentra/sdk` (MentraOS cloud app). The mobile app uses `@mentra/bluetooth-sdk`.
- **Package manager:** Bun
- **Storage:** AWS Rekognition (face collection) + local filesystem (`data/faces/`) for face photos/metadata; in-memory `photo-cache` for the BLE capture flow. The SDK also provides `session.simpleStorage` (cloud-synced KV, ~10MB/user) for future use.
- **AI services:** OpenRouter (Google Gemini 2.5 Flash Lite) for vision + intent classification; AWS Rekognition for face recognition; **ElevenLabs** for TTS (via MentraOS for the cloud app; direct TTS + Scribe STT on the relay for the mobile app).

## Mentra Live Hardware

Mentra Live is one of several glasses models supported by MentraOS. Here's what it has:

| Feature | Mentra Live | Notes |
|---------|-------------|-------|
| Camera | 1080p (photo + video streaming) | `session.camera` |
| Microphone | Yes (with Voice Activity Detection) | `session.events.onTranscriptionForLanguage()` |
| Speaker | Yes | `session.audio.speak()` |
| Buttons | 2 physical buttons (left + right/camera) + swipe pad | Short press + long press each |
| LEDs | RGB + White | `session.led` |
| WiFi | Yes | |
| Display | **No** | `session.layouts` has no effect |
| IMU | Not documented | |

Other glasses (Even Realities G1, Vuzix Z100) have displays but no camera/speaker. Code written for Mentra Live should never assume a display exists.

## How MentraOS Works

MentraOS apps are **server-side TypeScript applications**: `Mentra Live Glasses <-> User's Phone (Mentra App) <-> MentraOS Cloud (WebSocket) <-> YOUR SERVER`.

**Session lifecycle:** user launches your app → MentraOS Cloud POSTs a webhook (`sessionId`, `userId`) → your server opens a WebSocket → **`onSession(session, sessionId, userId)`** is your entry point → glasses stream events / server sends audio → session ends (user stop, disconnect, network error, or `session.disconnect()`) → **`onStop(sessionId, userId, reason)`** (session object NOT available here).

**Voice commands:** there is **no built-in wake word**. The SDK gives you **raw transcription text** via `onTranscriptionForLanguage(langCode, handler, opts)`; your app parses commands from it. Suhail uses **LLM intent classification** (OpenRouter) with keyword matching as a fallback — see `command-router.ts`. **Swipe-to-command:** forward swipe opens a ~10s listening window (next transcription is treated as a command, no wake word); backward swipe repeats the last response; the left button is a fallback (short press = interrupt + re-listen, long press = repeat). This avoids accidental triggers from background conversation.

## MentraOS SDK Reference

### AppServer

```typescript
import { AppServer, AppSession } from "@mentra/sdk";

class MyApp extends AppServer {
  override async onSession(session: AppSession, sessionId: string, userId: string) { }
  override async onStop(sessionId: string, userId: string, reason: string) { }  // session NOT available here
}

new AppServer({
  packageName: "com.suhail.assistant",  // must match Mentra Developer Console
  apiKey: "...", port: 3000,
  publicDir: false,    // static files dir (optional)
  healthCheck: true,   // enable /health endpoint (optional)
});
app.start();  // app.stop() to stop
```

Other methods: `getExpressApp()` (underlying Express app), `generateToken(userId, sessionId, secretKey)` (JWT for webview auth), `addCleanupHandler(handler)`.

### Session Properties

| Property | Type | Description |
|----------|------|-------------|
| `session.events` | `EventManager` | Subscribe to events (voice, buttons, sensors, etc.) |
| `session.audio` | `AudioManager` | Text-to-speech and audio playback |
| `session.camera` | `CameraManager` | Photo capture and video streaming |
| `session.led` | `LedModule` | Control RGB LEDs (Mentra Live only) |
| `session.location` | `LocationManager` | GPS location access |
| `session.device` | `DeviceManager` | Reactive observables for battery, charging, case battery/charging, wifi |
| `session.simpleStorage` | `SimpleStorage` | Persistent key-value storage (cloud-synced) |
| `session.settings` | `SettingsManager` | App settings from Developer Console |
| `session.capabilities` | `Capabilities \| null` | Detect device hardware at runtime |
| `session.layouts` | `LayoutManager` | Display layouts — exists but has NO effect on Mentra Live |
| `session.dashboard` | `DashboardAPI` | Persistent status display — NO effect on Mentra Live |
| `session.logger` | `Logger` (Pino) | Session-scoped logging |

### Events (session.events)

Suhail subscribes to four event helpers. The SDK exposes many more — see "Available but unused events".

```typescript
// Voice transcription locked to one language (Suhail uses this over generic onTranscription()
// to avoid mid-session auto-detect switching):
session.events.onTranscriptionForLanguage(
  langCode,                                  // e.g. "ar-SA" | "en-US"
  async (data) => {
    // data.text, data.isFinal (ALWAYS check — true when user finished), data.confidence (0-1),
    // data.detectedLanguage (what STT detected, may differ from langCode), data.timestamp (Date)
  },
  { disableLanguageIdentification: true }    // skip auto-detect, trust langCode
);

// Mentra Live has 2 buttons ("left", "right"/"camera") + a swipe pad:
session.events.onButtonPress((e) => { /* e.buttonId "left"|"right" (alias "camera"); e.pressType "short"|"long" */ });
session.events.onTouchEvent((e) => { /* e.gesture_name "forward_swipe"|"backward_swipe"|...; e.device_model? */ });
session.events.onPermissionError((data) => { /* camera/mic not granted — speak instruction, stop the operation */ });

// All listeners return an unsubscribe fn:
const unsubscribe = session.events.onButtonPress(handler); unsubscribe();
```

#### Available but unused events

Exist on `session.events` but Suhail doesn't subscribe — verify signatures against the SDK before using: `onTranscription` (generic auto-detect; we prefer `onTranscriptionForLanguage` to avoid mid-session switches), `onHeadPosition`, `onVoiceActivity`, `onPhoneNotifications`, `onCalendarEvent`, `onAudioChunk` (requires `session.subscribe([StreamType.AUDIO_CHUNK])` first), `onLocation`, `onConnected`/`onDisconnected`/`onError`, `onSettingsUpdate`. Battery events `onGlassesBattery`/`onPhoneBattery` also exist, but use `session.device.state.batteryLevel.onChange()` instead (see Device State).

### Camera (session.camera)

```typescript
const photoData = await session.camera.requestPhoto(options?);
// PhotoRequestOptions: size "small"|"medium"|"large"|"full" (default "medium"; avoid "full" on Mentra Live — uploads 25s+),
//   saveToGallery?, compress "none"|"medium"|"heavy" (default "none"), customWebhookUrl?, authToken?
// PhotoData: { buffer: Buffer, mimeType, filename, size (bytes), requestId }
```

**IMPORTANT:** `requestPhoto()` returns a **Buffer, NOT base64** — convert with `photoData.buffer.toString("base64")`. The method is `requestPhoto()`, NOT `takePhoto()`.

Video streaming (unused — see "Not Yet Used"). Managed (MentraOS handles encoding/CDN): `startManagedStream(opts)` → `{ hlsUrl, dashUrl, webrtcUrl?, streamId, previewUrl, thumbnailUrl }`, `stopManagedStream()`, `onManagedStreamStatus(cb)` (status: initializing|preparing|active|stopping|stopped|error). Unmanaged RTMP: `startStream({ rtmpUrl })`, `stopStream()`, `onStreamStatus(cb)`, `isCurrentlyStreaming()`.

### Audio (session.audio)

```typescript
const result = await session.audio.speak(text, options?);  // ElevenLabs TTS, 60s timeout
// → AudioPlayResult { success, error?, duration? }
// SpeakOptions: voice_id?, model_id? (default "eleven_flash_v2_5"), volume? (0-1, default 1.0),
//   trackId? (Suhail always passes 2 — see below),
//   voice_settings?: { stability?, similarity_boost?, style? (all 0-1), speed? (0.5-2.0), use_speaker_boost? }

await session.audio.playAudio({ audioUrl, volume?, stopOtherAudio? });  // NOT playUrl(url)
session.audio.stopAudio();                                  // stop all
session.audio.hasPendingRequest(requestId?): boolean;
```

**Track convention.** Suhail always speaks on `trackId: 2` (see `src/services/tts-service.ts`). Track 1 is left free so background audio (a future ambient cue / sound effect via `playAudio`) can play in parallel without interrupting speech. Keep using track 2 for new TTS calls.

**TTS models:** `eleven_flash_v2_5` (multilingual, ~75ms — DEFAULT), `eleven_v3` (70+ languages), `eleven_turbo_v2_5` (~250-300ms), `eleven_multilingual_v2` (29 languages).

### LEDs (session.led) — Mentra Live Only

Colors: `red`|`green`|`blue`|`orange`|`white`. Commands are fire-and-forget. Methods: `turnOn({ color, brightness? })`, `turnOff()`, `blink(color, onMs, offMs, count)`, `solid(color, durationMs)`, `getCapabilities()` (array of LED info).

### Location (session.location)

```typescript
const unsub = session.location.subscribeToStream({ accuracy: "standard" }, (data) => {
  // data.latitude, .longitude, .accuracy (meters), .altitude?, .timestamp
});
const loc = await session.location.getLatestLocation({ accuracy: "high" });  // single poll, 15s timeout
session.location.unsubscribeFromStream();
// accuracy: "realtime"|"high"|"tenMeters"|"standard"|"hundredMeters"|"kilometer"|"threeKilometers"|"reduced"
```

Requires `LOCATION` permission in Developer Console.

### Device State (session.device.state)

Reactive observables for hardware state. Read once with `getSnapshot()`, then subscribe. Suhail uses this to power `/api/status` for the companion `/webview`.

```typescript
const s = session.device.state.getSnapshot();
// fields (each number-or-null / boolean-or-null): batteryLevel (0-100), charging,
//   caseBatteryLevel (0-100), caseCharging, wifiConnected
// Each is also an observable with .onChange(cb) returning an unsubscribe fn:
session.device.state.batteryLevel.onChange((level) => { /* ... */ });
```

Prefer this over `session.events.onGlassesBattery()` — the observable always reflects the latest known value, and `getSnapshot()` on session start gives immediate state without waiting for an event.

### Simple Storage (session.simpleStorage)

Persistent, cloud-synced, user-isolated, app-scoped key-value store. Values are **strings only** (`JSON.stringify` objects). Limits: ~1MB per value, ~10MB total per user; locally cached for fast reads.

Methods (all async): `set(key, value)`, `get(key)`, `hasKey(key)`, `delete(key)`, `clear()`, `keys()`, `size()`, `getAllData()`, `setMultiple({ ... })`.

### Device Capabilities (session.capabilities)

Runtime hardware detection (null-check `session.capabilities` first). Fields: `modelName` (e.g. "Mentra Live"), `hasCamera`, `hasDisplay` (false on Mentra Live), `hasMicrophone`, `hasSpeaker`, `hasButton`, `hasLight` (LEDs), `hasIMU`, `hasWifi`.

### Settings (session.settings)

Configured in the Mentra Developer Console. Methods: `get<T>(key, default?)`, `has(key)`, `getAll()`, `onChange(cb)` (any change), `onValueChange<T>(key, cb)` (specific key), `fetch()` (force refresh from cloud).

### Permissions

Configured in the Mentra Developer Console (not at runtime): `MICROPHONE` (voice/audio), `CAMERA` (photos/streaming), `LOCATION` / `BACKGROUND_LOCATION` (GPS), `CALENDAR`, `READ_NOTIFICATIONS`, `POST_NOTIFICATIONS`.

### Things That Do NOT Exist in the SDK

- `session.display`, `session.screen` — do not exist
- `session.audio.playUrl(url)` — use `session.audio.playAudio({ audioUrl })`
- `session.camera.takePhoto()` — use `session.camera.requestPhoto()`

## Project Structure

```
suhail/
├── src/
│   ├── index.ts                        # Entry point — creates SuhailApp, calls initialize() + start()
│   ├── app.ts                          # SuhailApp class (extends AppServer) — session handling, event routing, listening mode, mini app API, relay mount
│   ├── relay/                          # BLE-mobile HTTP relay (mounted at /api by app.ts)
│   │   ├── routes.ts                   # /api/{intent,normalize,vision/*,faces/*,stt,tts,photo/*} endpoints
│   │   └── auth.ts                     # HMAC-Bearer auth middleware (RELAY_SHARED_SECRET)
│   ├── commands/
│   │   ├── base-command.ts             # AbstractCommandHandler — shared try/catch, photo capture, error speech
│   │   ├── command-router.ts           # LLM intent classification (OpenRouter) + keyword fallback
│   │   ├── scene-summarize.ts          # "Describe surroundings" -> photo -> face recognition + scene description in parallel -> prepend names -> speak
│   │   ├── ocr-read-text.ts            # "Read this text" -> photo -> vision LLM OCR -> speak (capped at OCR_MAX_CHARS=400 with "swipe to stop" hint)
│   │   ├── face-recognize.ts           # "Who is this?" -> photo -> multi-face AWS Rekognition -> speak all names
│   │   ├── face-enroll.ts              # "Enroll this person" -> photo -> ask name -> save (stateful, 2-step)
│   │   ├── find-object.ts              # "Find my keys" -> photo -> object detection -> speak location
│   │   ├── currency-recognize.ts       # "Count money" -> photo -> vision LLM -> count bills -> speak total
│   │   ├── visual-qa.ts                # Any question -> photo + question -> vision LLM -> speak answer
│   │   └── color-detect.ts             # "What color is this?" -> photo -> color analysis -> speak color
│   ├── services/
│   │   ├── ai-handler.ts               # AIHandler facade — routes to specific services
│   │   ├── vision-service.ts           # OpenRouter/Gemini vision (scene, VQA, currency, object, color, OCR)
│   │   ├── ocr-service.ts              # OCR — delegates to vision-service.extractText()
│   │   ├── face-service.ts             # AWS Rekognition (recognition + enrollment) + local file storage
│   │   ├── tts-service.ts              # speak(), speakBilingual(), localize(), common messages
│   │   ├── cue-service.ts              # Short non-speech WAV chimes (listening/got-it/cancelled) — replaces slow TTS cues
│   │   ├── settings-store.ts           # Global settings (speech speed, volume, voice preset, language)
│   │   ├── elevenlabs-tts.ts           # Direct ElevenLabs TTS for relay /api/tts (voice presets; mp3/pcm/ulaw formats)
│   │   ├── elevenlabs-stt.ts           # ElevenLabs Scribe STT for relay /api/stt (16kHz PCM -> WAV -> text)
│   │   ├── photo-cache.ts              # In-memory token cache for the BLE photo-capture flow (20 max, 60s TTL)
│   │   └── openrouter-status.ts        # Startup probe of OpenRouter /credits (validates key/quota, best-effort)
│   ├── utils/
│   │   ├── config.ts                   # Environment variables (all from process.env with defaults)
│   │   ├── logger.ts                   # Logger class with tag-based [Tag] prefix logging
│   │   ├── image-utils.ts              # capturePhoto(session) -> base64 (1920x1080), cropFace() for multi-face, base64 helpers
│   │   ├── transcription-filter.ts     # Validates transcriptions (rejects garbled/wrong-script); stripAnnotations()
│   │   ├── transcription-normalizer.ts # LLM-based script normalization (Arabic-script English -> Latin)
│   │   └── timeline.ts                 # Per-session latency Timeline (mark/dump) — instrumentation only
│   └── types/
│       └── index.ts                    # All shared interfaces and types
├── data/faces/metadata.json            # Face enrollment metadata (name <-> faceId); enrollment photos saved alongside
├── models/                             # Legacy Face.js weights (SSD MobileNet, landmark, recognition) — UNUSED; recognition uses AWS Rekognition
├── mobile/                             # React Native / Expo BLE app (own CLAUDE.md, README) — talks to glasses over BLE + this server's relay
├── landing/                            # React + Vite landing page (separate app)
├── public/index.html                   # Companion app — 4-tab SPA (Status, Activity, Contacts, Settings)
├── .env.example                        # Environment variable template
├── package.json, tsconfig.json, README.md
```

## Architecture & Data Flow

### Cloud-app voice command (onSession path)

```
Forward swipe -> listening mode (10s window) -> user speaks -> MentraOS STT -> onTranscriptionForLanguage(data)
  -> check data.isFinal (skip partials)
  -> check confidence >= MIN_CONFIDENCE
  -> validate transcription (transcription-filter) -> normalize script if needed (transcription-normalizer)
  -> check pending face enrollment (intercept if waiting for name)
  -> routeCommand(text) -> LLM intent (2s timeout) or keyword fallback
  -> handlers[command].execute(session, params)
     -> speakBilingual(processing) -> capturePhoto(session) -> ai.someMethod(base64) -> speak(result)
```

### Buttons & gestures (cloud app)

- **Forward swipe** → activate listening mode (~10s window)
- **Backward swipe** / **left long press** → repeat last response (any state)
- **Left short press** → interrupt current operation + return to listening
- **Right/camera button** → reserved (native camera hardware)

### BLE-mobile relay path

The mobile app captures voice/photos over BLE itself, then calls the relay for AI: typically `POST /api/stt` (audio→text) → `/api/normalize` + `/api/intent` (text→command) → a `/api/vision/*` or `/api/faces/*` endpoint (image→result) → `/api/tts` (text→audio it plays through the glasses). See **Relay API**.

### Command Handler Pattern

Most handlers extend `AbstractCommandHandler` (`base-command.ts`), which provides automatic try/catch + error speech, photo capture with a 5s timeout, and pre-capture fallback (uses the photo pre-captured during listening mode if available, 3s await). `app.ts` speaks "Got it" / "حسناً" **before** calling the handler. Subclasses implement only:

```typescript
abstract process(session: AppSession, photo: string, params?: Record<string, string>): Promise<void>;
```

Base-class flow: (1) app speaks "Got it"; (2) `capturePhoto()` (5s timeout, base64 or null); (3) if null → speak "Camera not available", return; (4) `process(...)`; (5) catch → speak "Sorry, I couldn't process that". The only exception is `face-enroll.ts`, which implements `CommandHandler` directly for its stateful 2-step flow.

### Face Enrollment (Stateful, 2-Step)

The only stateful command, spanning two transcriptions: (1) "enroll this person" → capture photo, store in `pendingEnrollments` Map, ask for the name; (2) "Abdullah" → `app.ts` checks `hasPendingEnrollment(sessionId)` and passes the name to complete enrollment → face indexed into AWS Rekognition + photo saved to `data/faces/`. State lives in `FaceEnrollCommand.pendingEnrollments: Map<sessionId, base64Photo>`. Safeguards: **TTS echo detection** (ignores the app's own prompt picked up by the mic), **30-second timeout** (auto-cancel), **concurrent enrollment lock**, **interrupt handling** (left short press cancels).

## Voice Command Routing (command-router.ts)

Hybrid: **LLM intent classification** primary, **keyword matching** fallback. The user must first activate listening mode (forward swipe / left button), then speak within ~10s.

- **Primary (LLM):** OpenRouter, model from `CLASSIFICATION_MODEL` (default `google/gemini-2.5-flash-lite`). Classifies into **9 intents** (8 commands + `unknown`), extracts params (object name for find-object, question for visual-qa). **2-second timeout** → falls back to keywords. Requires `OPENROUTER_API_KEY` (warns + falls back if missing).
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

The relay reuses `routeCommand()` via `POST /api/intent`.

## Bilingual Support (Arabic/English)

```typescript
interface BilingualMessage { ar: string; en: string; }
await speakBilingual(session, { ar: "جاري المعالجة...", en: "Processing..." });  // picks language from settings
```

Common messages live in `tts-service.ts` as the `messages` object: welcome, processing, cameraError, generalError, noResult, repeatNoHistory, listening, received, cancelled, didntCatch, listeningTimeout, unknownCommand, permissionError.

## Services Layer

All command handlers go through the **AIHandler** facade (`ai-handler.ts`) instead of calling services directly. Methods: `describeScene()`, `readText()`, `recognizeFace()`, `recognizeAllFaces()`, `enrollFace()`, `listFaces()`, `deleteFace()`, `renameFace()`, `findObject()`, `recognizeCurrency()`, `answerVisualQuestion()`, `detectColor()`, `loadPersistedFaces()`.

### Vision Service (vision-service.ts)
OpenRouter, model from `VISION_MODEL` (default `google/gemini-2.5-flash-lite`). All functions delegate to a shared `callVisionAPI` helper with explicit `max_tokens`. Tasks: `describeScene` (1-2 short sentences for blind users; scene-summarize runs this in parallel with face recognition and prepends recognized names), `answerVisualQuestion` (VQA), `recognizeCurrency`, `detectObject` (location, e.g. "to your right, on the table"), `detectColor` (name + hex), `extractText` (OCR). Bilingual prompts (ar/en); images sent as base64 data URI.

### OCR Service (ocr-service.ts)
`extractText(base64)` — delegates to `visionService.extractText()` (vision-LLM OCR).

### Face Service (face-service.ts)
AWS Rekognition + local file storage. `recognizeFace` (single best match), `recognizeAllFaces` (`DetectFacesCommand` → crop each with `sharp` → per-face `SearchFacesByImageCommand`; returns `MultiFaceResult { faces, totalDetected }`; optimizes single-face, caps at 10, skips boxes <3% of image, parallel via `Promise.allSettled()`), `enrollFace`, `listFaces`, `deleteFace`, `renameFace`, `loadPersistedFaces` (init/verify collection on startup), `getFacePhotoPath`. Names are hex-encoded for Rekognition's `ExternalImageId`; `data/faces/metadata.json` holds the human-readable mappings. AWS credential errors are handled gracefully (warn + continue).

### TTS Service (tts-service.ts)
`speak(session, text, sessionId?)` (wraps `session.audio.speak()` + tracks last response per session), `speakBilingual(...)`, `getLastResponse(sessionId)` / `clearLastResponse(sessionId)` (repeat support), `localize(message)`. Respects global settings (speed, volume, preset, language). Uses `trackId: 2`.

### Settings Store (settings-store.ts)
Voice/language prefs backed by `simpleStorage`. `getSettings()` (defensive copy), `updateSettings(partial)` (validate + clamp + persist with `flush()`), `initSettingsFromStorage(session)`, `clearSettingsSession()`. Settings: `speechSpeed` (0.5–2.0), `volume` (0.0–1.0), `voicePreset` ("default"|"male"|"female"), `language` ("ar"|"en"). Defaults from `DEFAULT_LANGUAGE`; others hardcoded. Survives restarts.

### Relay Services (BLE mobile backend — server-only, not used by the cloud-app path)
- **elevenlabs-tts.ts** — `synthesize()` calls ElevenLabs TTS directly for `/api/tts`. Voice presets (`male`=Adam, `female`=Rachel) mirror `tts-service.ts`; mp3/pcm/ulaw output formats (`isValidFormat()`, `contentTypeFor()`). Returns audio bytes.
- **elevenlabs-stt.ts** — `transcribe()` runs ElevenLabs **Scribe** (`scribe_v1`) for `/api/stt`. Takes raw 16kHz/16-bit/mono s16le PCM from the glasses mic and prepends a 44-byte WAV header. Returns `ScribeResult { text, languageCode?, confidence? }`.
- **photo-cache.ts** — in-memory token store for the two-step BLE photo flow: `mintToken()` → glasses upload → `storeBytes()` → `getBytes()`/`waitForBytes()` (one-shot consume). Caps: 20 in-flight, 60s TTL, 30s sweep.
- **openrouter-status.ts** — `probeOpenRouterStatus()` checks OpenRouter `/credits` at startup to validate the key/quota (free call, never throws). Logs loudly if the key is missing/over-quota so silent fallbacks aren't a surprise.

## Environment Variables

Defined in `src/utils/config.ts`, loaded from `.env` (local) or Railway (production). Keep `.env.example` in sync.

| Variable | Purpose | Default |
|----------|---------|---------|
| `PACKAGE_NAME` | MentraOS app identifier | `com.suhail.assistant` |
| `MENTRAOS_API_KEY` | MentraOS authentication | (empty) |
| `PORT` | Server port | `3000` |
| `OPENROUTER_API_KEY` | OpenRouter — vision + intent classification + normalization | (empty) |
| `AWS_REGION` | AWS region for Rekognition | `us-east-1` |
| `AWS_REKOGNITION_COLLECTION_ID` | Face collection ID in Rekognition | `suhail-faces` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS credentials (used implicitly by the AWS SDK) | (empty) |
| `DEFAULT_LANGUAGE` | Response language ("ar" or "en") | `ar` |
| `CONFIDENCE_THRESHOLD` | Min confidence for face recognition (≤1 = ratio, >1 = percent) | `0.5` |
| `MIN_CONFIDENCE` | Min confidence for transcription filtering | `0.55` |
| `VISION_MODEL` | OpenRouter model for vision tasks | `google/gemini-2.5-flash-lite` |
| `CLASSIFICATION_MODEL` | OpenRouter model for intent classification + normalization | `google/gemini-2.5-flash-lite` |
| `PUBLIC_BASE_URL` | Public base URL (no trailing slash). When set, short chimes replace the "Listening"/"Got it"/"Cancelled" TTS cues. Dev: ngrok URL. Prod: Railway URL. | (empty — falls back to TTS) |
| `RELAY_SHARED_SECRET` | Shared secret for the BLE app's HMAC-Bearer auth on relay endpoints. Empty → relay is OPEN (dev mode, startup warning). | (empty) |
| `ELEVENLABS_API_KEY` | ElevenLabs key for relay `/api/stt` (Scribe) + `/api/tts`. Server-only, never shipped to mobile. Empty → those endpoints return 503. | (empty) |
| `ELEVENLABS_DEFAULT_VOICE_ID` | Default voice for `/api/tts` when no override is passed | `21m00Tcm4TlvDq8ikWAM` (Rachel) |
| `ELEVENLABS_MODEL` | ElevenLabs TTS model for the relay | `eleven_flash_v2_5` |

## Current State of the Project

All core features are **fully implemented** with real AI backends — production-ready. This covers: full MentraOS SDK integration (AppServer/sessions/events/camera/audio); the BLE-mobile relay (`/api/*`); LLM command routing with keyword fallback (Arabic + English); listening-mode state machine (idle→active→processing) with timeouts, grace period, and echo guard; button/swipe handling with interrupt support; all 8 command handlers; vision services (scene/VQA/currency/object/color/OCR via OpenRouter/Gemini); face recognition with multi-face detection (`DetectFaces` + per-face `sharp` crop + `SearchFacesByImage`) integrated into scene summaries to name known people; stateful 2-step face enrollment (TTS echo detection, timeouts, concurrency locks, `enrolledAt` timestamps); bilingual TTS with repeat-last-response; ElevenLabs Scribe STT + TTS on the relay; transcription filtering (garbled/wrong-script/low-confidence) + normalization (Arabic-script English → Latin via LLM); high-res photos (`"large"` 1920x1080 + `compress: "medium"`); companion 4-tab SPA at `/webview`; settings persistence via `simpleStorage` + `flush()` (survives restarts); device-state tracking via reactive `device.state` observables (→ `/api/status`); `onPermissionError()` handling; audio track mixing (`trackId: 2`); structured activity log (type/command/result); a React + Vite landing page in `landing/`; plus logger, config, and image utils.

### SDK Features Not Yet Used (Available for Future Use)
`session.led` (LED feedback — e.g. blink green processing, red on error), `session.location` (GPS features like "where am I?"), `session.capabilities` (runtime hardware detection), `session.events.onHeadPosition()` (head up/down triggers), `session.events.onPhoneNotifications()` (read aloud), and video streaming via `session.camera.startManagedStream()`.

## Listening Mode (app.ts)

A state machine prevents accidental triggers from background conversation:

- **States:** `idle` (transcriptions ignored), `active` (~10s window — next valid transcription is a command), `processing` (handler running → back to idle when done).
- **Activation:** forward swipe / left short press → active. Plays the `/cues/listening.wav` chime when `PUBLIC_BASE_URL` is set, else speaks "تفضل"/"Listening" (chimes save ~2.5–3s). Pre-captures a photo in parallel (3s await).
- **Safeguards:** `LISTENING_TIMEOUT_MS` (10s auto-return to idle); `LISTENING_GRACE_MS` (1s — ignore stale audio right after activation); `TTS_ECHO_BUFFER_MS = 1500ms` (marks session "speaking" during TTS + buffer so the mic doesn't catch the app's own speech); confidence filtering (`MIN_CONFIDENCE`); script validation (`transcription-filter.ts`); script normalization (`transcription-normalizer.ts`).
- **Interrupts:** left short press during active/processing → cancel + return to listening. **Forward swipe during processing** → silences in-flight TTS (`session.audio.stopAudio(2)`), aborts the handler, re-enters listening (no "Cancelled" cue — user clearly wants a new command; good for cutting off long OCR/scene results). Forward swipe during active → cancel with "Cancelled" cue. Backward swipe / left long press → repeat last response (any state).

## Mini App API (app.ts)

Express endpoints (from `AppServer.getExpressApp()`) for the companion app at `/webview`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Online status, session count, uptime, battery, charging, case battery/charging, WiFi |
| `GET` | `/api/activity` | Rolling activity log (last 20, structured type/command/result) |
| `GET` | `/api/faces` | List enrolled faces (`{ faces, count }` — name, faceId, hasPhoto, enrolledAt) |
| `GET` | `/api/faces/:faceId/photo` | Download enrollment photo |
| `DELETE` | `/api/faces/:faceId` | Delete an enrolled face |
| `PUT` | `/api/faces/:faceId` | Rename an enrolled face (body `{ name }`) |
| `GET` / `PUT` | `/api/settings` | Get / update global settings (partial, validated) |
| `GET` | `/webview` | Serve the companion app HTML |

The companion SPA (`public/index.html`) has Home (status/battery/commands), Contacts (search/rename/delete faces with photos), Activity (color-coded log), and Settings (speed/volume sliders, voice preset, language toggle with RTL).

> **Note:** these `/api/*` webview routes and the **Relay API** `/api/*` routes coexist on the same Express app. Relay routes use a dedicated 10MB-body router mounted last with HMAC auth; the small webview routes above are registered separately. Face GET/PUT/DELETE stay on this webview path — only face **POST** (recognize/enroll) lives on the relay.

## Relay API (BLE Mobile Backend)

`src/relay/routes.ts` (mounted at `/api` by `app.ts` via `registerRelayRoutes`) is the HTTP backend the **BLE mobile app** calls for AI work. All endpoints are **POST** under `/api` and require HMAC-Bearer auth (`src/relay/auth.ts`) — **except** the glasses photo-upload webhook (token-authed).

**Auth.** Headers `X-Device-Id: <uuid>` + `Authorization: Bearer <token>`, where `token = hex(HMAC-SHA256(deviceId, RELAY_SHARED_SECRET))`, compared in constant time. When `RELAY_SHARED_SECRET` is empty, auth is skipped (dev mode, one-time startup warning).

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

**Photo capture flow (BLE):** `POST /api/photo/upload-url` mints a one-shot token + `uploadUrl` (60s TTL) → mobile tells the glasses to upload → glasses `POST /api/photo/upload/:token` (multipart `photo`, **unauthenticated** — the URL token is the auth) → mobile long-polls `GET /api/photo/wait/:token` (≤20s) → mobile calls a vision/face endpoint with `{ photoToken }`. The server-side wait exists because the iOS BLE SDK never emits a photo-success event.

## Rules for Contributing

1. **Audio only** — never reference displays/screens. All cloud-app output goes through `session.audio.speak()`.
2. **Always give feedback** — speak "Processing..." before any long op, then the result or error.
3. **Always handle camera failure** — `capturePhoto()` can return null; speak "Camera not available".
4. **Always catch errors** — every handler wraps logic in try/catch and speaks a friendly error.
5. **Extend AbstractCommandHandler** — implement `process(session, photo, params)`. Use `CommandHandler` directly only for non-standard flows (e.g. stateful multi-step like face enrollment).
6. **Use the AIHandler facade** — don't call services directly from command handlers.
7. **Use speakBilingual for common messages** — define `{ ar, en }` pairs.
8. **Use the Logger** — `new Logger("TagName")` for `[TagName]`-prefixed logs.
9. **Use capturePhoto()** from `utils/image-utils.ts` (handles `requestPhoto()`, Buffer→base64, errors).
10. **Keep it simple** — this is a graduation project; no over-engineering.
11. **Keep `.env.example` up to date** — whenever you add/remove/rename an env var in `config.ts`, update `.env.example`.
12. **Keep docs in sync** — when you change features, APIs, services, files, or structure, update **both** `CLAUDE.md` and `README.md` (and `mobile/CLAUDE.md` for mobile/relay changes). Outdated docs are worse than none.

## Version Control Etiquette

**Branches:** `main` (production, auto-deploys to Railway — always stable), `development` (integration), `feature/*` (short-lived, off `development`).

**Workflow:** branch off `development` → conventional commits → PR into `development` → test → when stable, PR `development` → `main` → tag a GitHub release → fast-forward `development` to match `main` (`git checkout development && git merge main --ff-only`).

**Commit messages** (conventional): `feat:` (feature), `fix:` (bug), `docs:`, `chore:` (maintenance), `refactor:` (no behavior change).

**Versioning** (semver): Major (`v2.0.0`) = breaking; Minor (`v1.1.0`) = new backward-compatible features; Patch (`v1.0.1`) = bug fixes.

**Rules:** never force-push or commit directly to `main`/`development` (always PR); keep `development` and `main` in sync after a release; run `bun run typecheck` before opening a PR; keep PRs focused (one feature/fix); delete merged feature branches.

## Adding a New Command

1. Create `src/commands/my-command.ts` extending `AbstractCommandHandler` — implement only `process(session, photo, params)` (base class handles try/catch, 5s photo capture, pre-capture fallback, error speech). Use `CommandHandler` directly only for non-standard flows.
2. Add the type to the `CommandType` union in `src/types/index.ts`.
3. Add a keyword route to `commandMap[]` in `command-router.ts` (and the intent name to the LLM classifier list).
4. Register the handler in `this.handlers` in the `app.ts` constructor.
5. Optionally add a button mapping in `handleButtonPress()` in `app.ts`.
6. If it needs a new AI service, add it to `src/services/` and expose it through `AIHandler`.
7. To expose it to the mobile app, add a relay endpoint in `src/relay/routes.ts`.

## Commands Quick Reference

```bash
bun install           # Install dependencies
bun run start         # Start server
bun run dev           # Start with --watch (auto-restart)
bun run typecheck     # TypeScript type checking
bun run build         # Build the landing page (landing/)
ngrok http 3000       # Expose local server (needed for Mentra connection in local dev)
```
