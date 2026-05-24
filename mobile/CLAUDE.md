# Suhail Mobile (BLE) — AI Context File

> This file is for AI coding assistants (Claude, GPT, Copilot, etc.) to understand the **mobile app** half of the Suhail BLE rewrite. Read this before touching anything under `mobile/`. For the server/relay half, read the root [CLAUDE.md](../CLAUDE.md).

## What is this?

This directory holds the **React Native / Expo mobile app** that talks **directly to Mentra Live glasses over Bluetooth LE** using `@mentra/bluetooth-sdk`. It is a complete rewrite of the cloud-based Suhail app, undertaken because the team wants direct phone↔glasses control with no MentraOS Cloud dependency. The fork is `SuhailTeam/SuhailApp-BLE`; the original cloud app lives at `SuhailTeam/SuhailApp` and continues to work unchanged.

**Status:** Phase 0 — scaffold only. No code yet. The phased plan lives in the research doc at [`C:\Users\User\.claude\plans\i-want-you-to-curried-steele.md`](../../../../../.claude/plans/i-want-you-to-curried-steele.md) and is summarized in section [Phased Status](#phased-status) below.

## Two halves of this repo

| Half | Lives in | Role | Talks to |
|---|---|---|---|
| **Server / AI relay** | repo root (`src/`) | Stateless HTTPS API. Holds all secrets (OpenRouter, AWS Rekognition, ElevenLabs). Wraps the existing vision/face/intent services as REST endpoints. Deployed to Railway. | Mobile app (HTTPS) |
| **Mobile app** | `mobile/` (this dir) | Native iOS + Android app via React Native + Expo dev build. Owns session lifecycle, listening state machine, audio pipeline, UI. Holds no secrets. | Glasses (BLE) + Server (HTTPS) |

The two halves share types from [`src/types/index.ts`](../src/types/index.ts) (copied or symlinked into mobile; pick whichever works once we add tooling).

## Tech stack (target)

- **Framework:** React Native via Expo (managed workflow with native dev/prod builds — Expo Go **does not work**, the BLE SDK requires native modules)
- **Language:** TypeScript (strict)
- **Min platforms:** iOS 15.1+, Android SDK 28+
- **BLE SDK:** `@mentra/bluetooth-sdk` 0.1.6 (**beta** — pin version, watch release notes)
- **State:** Zustand (recommended; light, no boilerplate, easy to mirror our existing in-memory maps)
- **Storage:** MMKV (fast, synchronous, encrypted) for settings + last-response cache. SQLite via `op-sqlite` only if we need it for the activity log.
- **Audio:** `@mentra/bluetooth-sdk` for PCM I/O over BLE. STT + TTS via ElevenLabs Conversational AI WebSocket (the pattern from the starter kit's [`examples/react-native-elevenlabs-audio`](https://github.com/Mentra-Community/Mentra-Bluetooth-SDK-Starter-Kit/tree/main/examples/react-native-elevenlabs-audio)).
- **Builds:** `eas build` for iOS + Android. iOS requires a Mac (or EAS cloud builds).
- **Navigation:** React Navigation (native stack + bottom tabs) to match the 4-tab webview the cloud version has.
- **Package manager:** Bun (for monorepo consistency with the root server) or npm — TBD.

## Mentra Live hardware (recap)

Same hardware as the cloud version. See root [CLAUDE.md → Mentra Live Hardware](../CLAUDE.md#mentra-live-hardware). One thing to re-emphasize: **no display**. Every response goes through the glasses speaker. UI on the phone is for setup, contacts, settings, and activity log — **not** for the moment-to-moment user experience.

## How the BLE SDK works

```
┌──────────────────┐   BLE   ┌───────────────────────┐  HTTPS  ┌──────────────────────────┐
│   Mentra Live    │◄───────►│  Suhail mobile (RN)   │◄───────►│   Railway relay (src/)   │
│  - 1080p camera  │  audio, │                       │         │   - /api/intent          │
│  - microphone    │  photos,│  - BLE I/O            │         │   - /api/vision/*        │
│  - speaker       │  events │  - Listening state    │         │   - /api/faces/*         │
│  - 2 buttons     │  LEDs   │  - Audio pipeline     │         │   - /api/tts             │
│  - swipe pad     │         │  - Local TTS via      │         │   Holds: OpenRouter,     │
│  - RGB LEDs      │         │    ElevenLabs WS      │         │   AWS Rekognition,       │
│  - battery/wifi  │         │  - Bilingual UI       │         │   ElevenLabs keys        │
└──────────────────┘         └───────────────────────┘         └──────────────────────────┘
```

### Lifecycle (replaces the cloud app's `onSession` / `onStop`)

1. App boots → restores saved settings from MMKV → scans for paired glasses.
2. User pairs glasses once (system pairing flow + BLE handshake).
3. On subsequent launches, app auto-reconnects to the last-paired device.
4. While connected: subscribe to BLE event streams (button, touch, battery, mic PCM, photo, log).
5. App reacts to events: forward swipe → activate listening → stream mic PCM → call STT → route intent via `/api/intent` → execute command → speak result via TTS over BLE.
6. On disconnect: keep the app alive, attempt auto-reconnect with backoff, surface a UI state.

There is **no server-side session**. The phone IS the session.

## BLE SDK reference (essentials)

The full SDK docs live at https://bluetooth-sdk-docs.mentra.glass/. The starter kit is at https://github.com/Mentra-Community/Mentra-Bluetooth-SDK-Starter-Kit. Read both before writing BLE code. Below are the parts that map directly to features Suhail needs.

### Connection lifecycle

- Scan for glasses → request pairing → connect → subscribe to event streams.
- On disconnect, retry connection with exponential backoff (the BLE SDK does not do this for us — we have to).
- Handle Android-13+ permission flow (`BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, plus `ACCESS_FINE_LOCATION` for older SDKs).
- iOS: declare BLE usage strings in `Info.plist`; background-mode-bluetooth-central if we need background audio.

### Events from glasses (subscribe to these)

| Event | Cloud SDK equivalent | What we do with it |
|---|---|---|
| `button` (left short/long, right short/long) | `session.events.onButtonPress` | Left short = interrupt + re-listen; left long = repeat last response. Right = reserved (native camera button on Mentra Live). |
| `touch` / `swipe` | `session.events.onTouchEvent` | Forward swipe = activate listening / silence current TTS + re-listen; backward swipe = repeat last response. |
| `battery`, `case battery`, `charging`, `wifi`, `hotspot` | `session.device.state.*.onChange` | Drive the Status screen; persist last-known values in MMKV. |
| `head-up` | `session.events.onHeadPosition` | Not used today; available for future "wake on head up" feature. |
| `photo` (after capture) | photo arrives in `requestPhoto` callback | Pipe to vision endpoint or face endpoint depending on the active command. |
| `audio chunk` (mic PCM) | `session.events.onTranscriptionForLanguage` (but cooked) | Stream into ElevenLabs Conversational AI for STT. We get raw PCM here, not transcribed text — STT is on us. |
| `sdk log` | (none) | Pipe into our logger for debugging. |

### Outputs to glasses

| Action | Cloud SDK equivalent | Notes |
|---|---|---|
| Speak text | `session.audio.speak(text)` | **No equivalent in BLE SDK.** We synthesize PCM/WAV on the phone (ElevenLabs WS) and ship audio bytes to the speaker. |
| Play short audio cue (listening / got-it / cancelled) | `session.audio.playAudio({ audioUrl })` | Bundle WAVs in the app (`assets/cues/*.wav`), ship bytes to the speaker. |
| Stop currently-playing audio | `session.audio.stopAudio(trackId)` | BLE SDK should expose a speaker stop; if not, send silence or end the active stream. |
| Capture photo | `session.camera.requestPhoto({ size: "large", compress: "medium" })` | BLE `camera capture` API. Photo arrives via our own webhook or local callback. Keep `large` (1920×1080) + `medium` compression — measured optimum from the cloud version. |
| LEDs | `session.led.*` | Same semantics; useful for "thinking…" feedback if we want it. |

### Things that do NOT exist in @mentra/bluetooth-sdk

- **STT (`onTranscriptionForLanguage`)** — bring your own. Default plan: ElevenLabs Conversational AI WebSocket (does STT + TTS in one round trip). Fallback: stream PCM to Railway and run Whisper there.
- **TTS (`audio.speak`)** — bring your own. Same plan.
- **`simpleStorage`** — use MMKV on device.
- **`session.layouts` / `session.dashboard`** — Mentra Live has no display; irrelevant.
- **Permission error events (`onPermissionError`)** — replaced by native OS permission flows on iOS/Android.

## Audio pipeline (the critical piece)

This is the highest-risk part of the rewrite. Latency targets:

| Span | Cloud version (measured) | BLE target |
|---|---|---|
| Swipe → "listening" cue | ~150 ms | ≤ 200 ms |
| End of user speech → first token of result | ~1.5-2.0 s | ≤ 2.5 s |
| End of vision call → first audio byte to speaker | ~600-900 ms | ≤ 1.0 s |
| Total swipe → first spoken word of response | ~3-4 s | ≤ 5 s |

Two architectures are on the table:

**Option A — ElevenLabs Conversational AI direct** (recommended; matches starter kit example)
- Glasses PCM → mobile → WebSocket to ElevenLabs CAI → text (STT) + audio (TTS) back.
- Pros: one WebSocket, fastest, no Railway hop for the audio path.
- Cons: phone must hold ElevenLabs API key (or ephemeral signed token from Railway).
- Decision: **mobile holds an ephemeral token** that Railway mints with `/api/tts/token`. Token short-lived (5 min). Real key never leaves Railway.

**Option B — Stream PCM to Railway, do STT server-side**
- Glasses PCM → mobile → HTTPS chunks to Railway → Whisper or similar → text back.
- Pros: zero secrets on phone, easier to swap STT providers, easier to log/analyze.
- Cons: extra hop, more latency, Railway becomes a real-time audio relay (more failure surface).

Default: A. Implement both `timeline.ts` spans early (port from [`src/utils/timeline.ts`](../src/utils/timeline.ts)) and measure on real hardware before locking in.

### Audio cues

The cloud version generates listening/got-it/cancelled chimes server-side and serves them at `/cues/*.wav`. For BLE: pre-generate the same WAVs at build time, bundle as `mobile/assets/cues/listening.wav`, `got-it.wav`, `cancelled.wav`, ship raw bytes to the speaker via the BLE audio API. Saves ~2.5-3s vs TTS.

### TTS track convention

Cloud version uses `trackId: 2` for speech, leaves track 1 free for background audio. The BLE SDK may or may not surface the same multi-track concept — check the audio API. If it does, keep the same convention. If not, we serialize speech + cues into a single audio stream.

## Listening state machine

Port the **exact** semantics from [`src/app.ts:62-68, 252-325`](../src/app.ts). Constants live in `mobile/src/state/listening.ts`:

- States: `idle` | `active` | `processing`
- `LISTENING_TIMEOUT_MS` = 10_000 — auto return to idle if no command received
- `LISTENING_GRACE_MS` = 1_000 — ignore stale transcriptions immediately after activation
- `TTS_ECHO_BUFFER_MS` = 1_500 — mark session as "speaking" during TTS + 1.5s buffer, ignore mic during that window
- `MIN_CONFIDENCE` = 0.55 — reject low-confidence transcriptions

Transitions:
- Forward swipe (any state) → active. If was processing, also silence current TTS first ("forward swipe during processing").
- Left short press during active or processing → cancel, return to active (re-listen).
- Backward swipe / left long press (any state) → speak `lastResponse` if available.
- Active + 10s no input → idle.
- Active + valid transcription → processing.
- Processing complete → idle.

Recreate the `pendingEnrollments` map for the 2-step face enrollment flow — see [`src/commands/face-enroll.ts`](../src/commands/face-enroll.ts) for the exact 30s timeout + TTS echo detection + concurrency lock.

## Commands to port

All 8 live in [`src/commands/`](../src/commands/) and are the **specification** for the mobile equivalents. Port them in this order (each one wires to a Railway endpoint, see [Railway Relay Contract](#railway-relay-contract)):

| # | Command | Cloud handler | Railway endpoint | Notes |
|---|---|---|---|---|
| 1 | `describe` (scene-summarize) | [scene-summarize.ts](../src/commands/scene-summarize.ts) | `POST /api/vision/scene` + `POST /api/faces/recognize-all` (parallel) | Prepend recognized names to scene. **Reference flow.** |
| 2 | `read` (OCR) | [ocr-read-text.ts](../src/commands/ocr-read-text.ts) | `POST /api/vision/ocr` | Cap at `OCR_MAX_CHARS=400`, append "swipe to stop" hint. |
| 3 | `color` | [color-detect.ts](../src/commands/color-detect.ts) | `POST /api/vision/color` | Trivial after #1. |
| 4 | `money` (currency) | [currency-recognize.ts](../src/commands/currency-recognize.ts) | `POST /api/vision/currency` | Multi-bill counting; RTL number formatting in Arabic. |
| 5 | `find` (object) | [find-object.ts](../src/commands/find-object.ts) | `POST /api/vision/object` | Parameter extraction in router. |
| 6 | `who` (face-recognize) | [face-recognize.ts](../src/commands/face-recognize.ts) | `POST /api/faces/recognize-all` | Multi-face. |
| 7 | `enroll` | [face-enroll.ts](../src/commands/face-enroll.ts) | `POST /api/faces/enroll` | Stateful 2-step; preserve all safeguards. |
| 8 | VQA | [visual-qa.ts](../src/commands/visual-qa.ts) | `POST /api/vision/vqa` | Fallback for unmatched intents. |

The intent router is also a Railway call: `POST /api/intent` with `{ text, language }` returns `{ command, params, confidence }`. Keyword fallback runs client-side if Railway is slow / unreachable (port the keyword table from [`src/commands/command-router.ts`](../src/commands/command-router.ts)).

## Railway relay contract

The mobile app talks to the Railway server via these endpoints. The server implementation lives in `src/` (TypeScript, Bun) and reuses the existing service code. See root [CLAUDE.md](../CLAUDE.md) for the server-side details once those endpoints are built.

| Endpoint | Method | Body | Returns | Wraps |
|---|---|---|---|---|
| `/api/intent` | POST | `{ text, language }` | `{ command, params, confidence }` | [command-router.ts](../src/commands/command-router.ts) |
| `/api/vision/scene` | POST | `{ image: base64, language }` | `{ description }` | [vision-service.ts → describeScene](../src/services/vision-service.ts) |
| `/api/vision/ocr` | POST | `{ image: base64, language }` | `{ text, truncated }` | vision-service → extractText |
| `/api/vision/currency` | POST | `{ image: base64, language }` | `{ bills: [...], total, currency }` | vision-service → recognizeCurrency |
| `/api/vision/object` | POST | `{ image: base64, target, language }` | `{ location }` | vision-service → detectObject |
| `/api/vision/color` | POST | `{ image: base64, language }` | `{ name, hex }` | vision-service → detectColor |
| `/api/vision/vqa` | POST | `{ image: base64, question, language }` | `{ answer }` | vision-service → answerVisualQuestion |
| `/api/faces/recognize` | POST | `{ image: base64 }` | `{ name, confidence } \| null` | [face-service.ts → recognizeFace](../src/services/face-service.ts) |
| `/api/faces/recognize-all` | POST | `{ image: base64 }` | `{ faces: [...], totalDetected }` | face-service → recognizeAllFaces |
| `/api/faces/enroll` | POST | `{ image: base64, name }` | `{ faceId, name, enrolledAt }` | face-service → enrollFace |
| `/api/faces` | GET | — | `{ faces: [...], count }` | face-service → listFaces |
| `/api/faces/:id` | DELETE | — | `{ ok: true }` | face-service → deleteFace |
| `/api/faces/:id` | PUT | `{ name }` | `{ ok: true }` | face-service → renameFace |
| `/api/faces/:id/photo` | GET | — | image bytes | reads `data/faces/:id.jpg` |
| `/api/tts/token` | POST | `{ deviceId }` | `{ token, expiresAt }` | mints short-lived ElevenLabs session token |
| `/api/tts` | POST | `{ text, voice, speed, language }` | PCM/WAV bytes | server-side TTS fallback if not using ElevenLabs WS directly |

### Auth

Per-device HMAC token. Device generates a UUID on first launch (stored in MMKV). On every request, header `Authorization: Bearer <HMAC(deviceId, sharedSecret)>`. Railway holds `RELAY_SHARED_SECRET`. Token is **not** a real auth — it's a soft rate-limiter to prevent random scraping. For real auth, swap to OAuth or Mentra account integration later.

### Versioning

`POST /api/*` accepts an `X-Suhail-Mobile-Version` header. Railway can refuse or warn if the mobile version is too old. Bump `mobile/package.json` version on each release.

## Bilingual support

Same model as the cloud version. The `messages` constant in [`src/services/tts-service.ts`](../src/services/tts-service.ts) is the source of truth — copy verbatim into `mobile/src/i18n/messages.ts` as a TS constants file. Don't introduce a new i18n framework just for this — a flat constants object plus `language` from settings is enough.

Language detection: respect the user's selected language (`settings.language`). Do NOT auto-detect from STT (we already learned that lesson with `onTranscriptionForLanguage` vs `onTranscription`).

RTL: required when language is Arabic. React Native has `I18nManager.forceRTL(true)`. Plan: set on app boot based on `settings.language`; if changed, the app needs to restart (`Updates.reloadAsync()` from `expo-updates`) for layout to flip. This is fine, matches what users expect from RTL toggles.

## Settings

Same shape as [`src/services/settings-store.ts`](../src/services/settings-store.ts):

```ts
interface AppSettings {
  speechSpeed: number;   // 0.5 - 2.0
  volume: number;        // 0.0 - 1.0
  voicePreset: "default" | "male" | "female";
  language: "ar" | "en";
}
```

Storage: MMKV. Defaults: `{ speechSpeed: 1.0, volume: 1.0, voicePreset: "default", language: "ar" }`. Validation/clamping same as the cloud version.

## Environment variables (mobile)

Mobile env vars are baked into the build (anything with `EXPO_PUBLIC_` is exposed at runtime). Keep secrets OFF the device.

| Var | Purpose | Default |
|---|---|---|
| `EXPO_PUBLIC_RELAY_BASE_URL` | Railway base URL (no trailing slash) | (none — must set) |
| `EXPO_PUBLIC_RELAY_SHARED_SECRET` | HMAC secret for device auth. **Soft secret only** — bundled in app. Rotate by re-releasing. | (none) |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry crash reporting (Phase F) | (empty) |
| `EXPO_PUBLIC_LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` |

`.env.example` lives in `mobile/.env.example` — keep it in sync as we add vars. The root `.env.example` covers the Railway server.

## Project structure (planned)

Currently this directory only contains this file. As work proceeds, the layout should look like:

```
mobile/
├── CLAUDE.md                        # This file
├── README.md                        # Human onboarding
├── app.config.ts                    # Expo config
├── eas.json                         # EAS build profiles
├── package.json
├── tsconfig.json
├── babel.config.js
├── .env.example
├── assets/
│   ├── icon.png
│   ├── splash.png
│   └── cues/
│       ├── listening.wav            # Pre-generated chimes
│       ├── got-it.wav
│       └── cancelled.wav
└── src/
    ├── App.tsx                      # Root navigator
    ├── ble/
    │   ├── connection.ts            # Scan, connect, reconnect
    │   ├── events.ts                # Button / touch / battery subscriptions
    │   ├── audio.ts                 # PCM mic in, audio bytes out
    │   └── camera.ts                # Photo capture via BLE
    ├── audio/
    │   ├── stt.ts                   # ElevenLabs CAI WebSocket
    │   ├── tts.ts                   # ElevenLabs CAI WebSocket (same socket)
    │   └── cues.ts                  # Bundled WAV playback
    ├── commands/                    # Mirrors src/commands/ in the server
    │   ├── describe.ts
    │   ├── read.ts
    │   ├── color.ts
    │   ├── money.ts
    │   ├── find.ts
    │   ├── who.ts
    │   ├── enroll.ts
    │   └── vqa.ts
    ├── state/
    │   ├── listening.ts             # State machine (see section above)
    │   ├── enrollment.ts            # 2-step enrollment state
    │   ├── settings.ts              # Zustand store, MMKV-backed
    │   └── activity.ts              # Rolling 20-event log
    ├── relay/
    │   ├── client.ts                # HTTPS client + HMAC auth
    │   ├── intent.ts                # /api/intent
    │   ├── vision.ts                # /api/vision/*
    │   └── faces.ts                 # /api/faces/*
    ├── i18n/
    │   └── messages.ts              # Bilingual constants (copy from server)
    ├── screens/
    │   ├── HomeScreen.tsx           # Status + voice commands reference
    │   ├── ContactsScreen.tsx       # Enrolled faces CRUD
    │   ├── ActivityScreen.tsx       # Rolling log
    │   ├── SettingsScreen.tsx       # Sliders + toggles
    │   └── OnboardingScreen.tsx     # First-launch pairing
    └── utils/
        ├── logger.ts                # Same Logger interface as server
        ├── timeline.ts              # Latency spans (port from src/utils/timeline.ts)
        ├── transcription-filter.ts  # Copy from server
        └── transcription-normalizer.ts # Copy from server
```

## Phased status

| Phase | Goal | Status |
|---|---|---|
| **0** | Repo fork + this CLAUDE.md | **In progress (you are here)** |
| **A** | Railway relay endpoints (`/api/intent`, `/api/vision/*`, `/api/faces/*`, `/api/tts/token`) live alongside the existing MentraOS server | Not started |
| **B** | RN scaffold + BLE handshake + button/swipe events visible in the app | Not started |
| **C** | Audio pipeline end-to-end (PCM → STT → text → TTS → speaker) over BLE | Not started |
| **D** | Port all 8 commands one at a time | Not started |
| **E** | Companion UI (4 screens) + polish | Not started |
| **F** | Hardening + merge back to `main` | Not started |

Each phase ends with hardware verification on Mentra Live. Don't proceed to the next phase until the current one is demoable.

## Rules for contributing (mobile-specific)

These extend the rules in root [CLAUDE.md](../CLAUDE.md), they don't replace them.

1. **No secrets in the app.** OpenRouter, AWS, full ElevenLabs keys live on Railway. The phone only ever holds the shared HMAC secret (soft) and short-lived tokens minted by Railway.
2. **No Expo Go.** Always test on a dev build. CI runs `eas build --profile development`.
3. **Audio only (still).** UI is for setup / settings / contacts / activity. The voice command flow has zero on-screen dependence. A blind user must be able to use the core flow with the phone in their pocket and the screen off.
4. **Preserve cloud semantics.** Listening timeouts, echo buffer, grace period, OCR cap, RTL number formatting — these were tuned with users. Don't change them without a measured reason.
5. **Test on real Mentra Live hardware.** Simulators do not have BLE. Every PR that touches BLE, audio, or commands needs a hardware test note.
6. **Measure before optimizing.** Port [`src/utils/timeline.ts`](../src/utils/timeline.ts) early. Every command span goes through it. Latency is a first-class metric.
7. **Keep both halves in sync.** When you add a new Railway endpoint, update the table in this file. When you change `AppSettings` shape, update both `src/services/settings-store.ts` and `mobile/src/state/settings.ts`. When you change bilingual messages, update both copies.
8. **Don't reach into the cloud app code at runtime.** Only at design time (as a spec to copy from). The mobile app's only runtime dependency on `SuhailTeam/*` is the Railway relay's HTTP API.
9. **Keep `mobile/.env.example` and `mobile/package.json` up to date.** Same hygiene as the server side.
10. **Bun or npm — pick one and don't mix.** Decide in Phase B; document the choice here.

## Adding a new command (mobile-side)

After the relay endpoint exists:

1. Create `mobile/src/commands/<name>.ts` with a single `execute(deps)` function. Pattern: capture photo → call Railway endpoint → speak result. Mirror the shape of [`src/commands/base-command.ts`](../src/commands/base-command.ts) (try/catch + 5s photo timeout + pre-capture fallback + friendly error speech).
2. Add the command to the keyword fallback table in `mobile/src/state/listening.ts` (in case the LLM intent router times out).
3. Add to the command dispatcher in `mobile/src/state/listening.ts` (the equivalent of `this.handlers` in the cloud `app.ts`).
4. Add a real hardware test to the verification list in [the research doc](../../../../../.claude/plans/i-want-you-to-curried-steele.md#7-verification--how-wed-know-the-rewrite-is-done).

## Commands quick reference (mobile dev workflow)

These don't work yet — listed for when Phase B lands.

```bash
# Inside mobile/
bun install                           # or npm install — TBD
bunx expo start --dev-client          # Start Metro for dev build
eas build --profile development --platform ios       # iOS dev build (requires Mac or EAS cloud)
eas build --profile development --platform android   # Android dev build
eas build --profile production --platform all        # Production builds for both
bun run typecheck                     # tsc --noEmit
```

## References

- BLE SDK overview: https://bluetooth-sdk-docs.mentra.glass/bluetooth-sdk/overview/
- Starter kit (read first): https://github.com/Mentra-Community/Mentra-Bluetooth-SDK-Starter-Kit
- ElevenLabs audio pattern (copy): https://github.com/Mentra-Community/Mentra-Bluetooth-SDK-Starter-Kit/tree/main/examples/react-native-elevenlabs-audio
- Original cloud app (the spec): [SuhailTeam/SuhailApp](https://github.com/SuhailTeam/SuhailApp)
- This fork: [SuhailTeam/SuhailApp-BLE](https://github.com/SuhailTeam/SuhailApp-BLE)
- Research / phased plan: [`C:\Users\User\.claude\plans\i-want-you-to-curried-steele.md`](../../../../../.claude/plans/i-want-you-to-curried-steele.md)
