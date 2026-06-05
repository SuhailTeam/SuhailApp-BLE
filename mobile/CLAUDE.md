# Suhail Mobile (BLE) — AI Context File

> This file is for AI coding assistants (Claude, GPT, Copilot, etc.) to understand the **mobile app** half of the Suhail BLE rewrite. Read this before touching anything under `mobile/`. For the server/relay half, read the root [CLAUDE.md](../CLAUDE.md).

## What is this?

This directory holds the **React Native / Expo mobile app** that talks **directly to Mentra Live glasses over Bluetooth LE** using `@mentra/bluetooth-sdk`. It is a complete rewrite of the cloud-based Suhail app, undertaken because the team wants direct phone↔glasses control with no MentraOS Cloud dependency. The fork is `SuhailTeam/SuhailApp-BLE`; the original cloud app lives at `SuhailTeam/SuhailApp` and continues to work unchanged.

**Status:** Built and shipping. All 8 voice commands, the BLE audio pipeline (PCM mic → STT → streaming answer → TTS over BLE), the companion UI (onboarding + 4 tabs, WCAG theme), and the section-13.8 usability-test instrumentation are implemented under `mobile/src/`. What's left is on-device hardening and tuning (Phase F). The per-phase breakdown is in [Phased status](#phased-status) below.

## Two halves of this repo

| Half | Lives in | Role | Talks to |
|---|---|---|---|
| **Server / AI relay** | repo root (`src/`) | Stateless HTTPS API. Holds all secrets (OpenRouter, AWS Rekognition, ElevenLabs). Wraps the existing vision/face/intent services as REST endpoints. Deployed to Railway. | Mobile app (HTTPS) |
| **Mobile app** | `mobile/` (this dir) | Native iOS + Android app via React Native + Expo dev build. Owns session lifecycle, listening state machine, audio pipeline, UI. Holds no secrets. | Glasses (BLE) + Server (HTTPS) |

The two halves share types from [`src/types/index.ts`](../src/types/index.ts) (the relay's types; mobile mirrors the shapes it needs).

> **Path convention in this file.** `mobile/src/...`, `src/relay/...`, and `src/services/{vision,face,elevenlabs-*}.ts` point at **this repo** (the mobile app and the relay server). References to the cloud app's `src/commands/*`, `src/app.ts`, `src/services/tts-service.ts`, `src/services/settings-store.ts`, or `src/services/cue-service.ts` describe the **original cloud app** in the separate `SuhailTeam/SuhailApp` repo — used as the porting *spec*, not present here, so those `../src/...` links won't resolve in this repo by design.

## Tech stack (as built)

- **Framework:** React Native 0.76 via Expo SDK 52 (dev/prod native builds — Expo Go **does not work**, the BLE SDK requires native modules)
- **Language:** TypeScript (strict)
- **Min platforms:** iOS 15.1+, Android SDK 28+
- **BLE SDK:** `@mentra/bluetooth-sdk` 0.1.6 (**beta** — pinned exact; watch release notes)
- **State:** Zustand — the `src/state/*` stores (settings, appearance, onboarding, activity, usabilityLog, lastResponse, enrollment, listening, deviceId)
- **Storage:** `react-native-mmkv` (fast, synchronous) for settings/appearance/onboarding/deviceId. The activity log is an in-memory rolling store (no SQLite).
- **Audio:** `@mentra/bluetooth-sdk` for PCM I/O over BLE. STT + TTS run **server-side on the relay** — PCM → `POST /api/stt` (ElevenLabs Scribe), text → `POST /api/tts` (ElevenLabs), and the hot turn streams audio back via `POST /api/answer` (NDJSON). There is **no ElevenLabs WebSocket on the device** — the CAI-WebSocket plan from the starter kit was dropped (see [Audio pipeline](#audio-pipeline-the-critical-piece)).
- **Builds:** `eas build` for iOS + Android, or local `expo run:ios` / `expo run:android`. iOS requires a Mac (or EAS cloud builds).
- **Navigation:** React Navigation v7 (native stack + bottom tabs).
- **Package manager:** **Bun** (decided — `bun.lock`, `bunfig.toml`, and `package.json` `patchedDependencies`, which bun applies on install; npm/yarn skip the patches and break iOS 26.5+ builds — see `mobile/README.md`).

## Mentra Live hardware (recap)

Same hardware as the cloud version — see the **Hardware note** in the root [CLAUDE.md](../CLAUDE.md). One thing to re-emphasize: **no display**. Every response goes through the glasses speaker. UI on the phone is for setup, contacts, settings, and activity log — **not** for the moment-to-moment user experience.

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
- On disconnect, retry connection with exponential backoff (the BLE SDK's `autoConnectDefault` is one-shot — a ref guard that never re-fires — so we run our own reconnect loop in `BluetoothSessionProvider`, `src/ble/connection.ts`: 1→15s backoff, suppressed on a deliberate user disconnect, re-armed on any successful connect).
- Handle Android-13+ permission flow (`BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, plus `ACCESS_FINE_LOCATION` for older SDKs).
- iOS: declare BLE usage strings in `Info.plist`; background-mode-bluetooth-central if we need background audio.

### Events from glasses (subscribe to these)

| Event | Cloud SDK equivalent | What we do with it |
|---|---|---|
| `button` (left short/long, right short/long) | `session.events.onButtonPress` | Left short = interrupt + re-listen; left long = repeat last response. Right = reserved (native camera button on Mentra Live). |
| `touch` / `swipe` | `session.events.onTouchEvent` | Forward swipe = activate listening / silence current TTS + re-listen; backward swipe = repeat last response. |
| `battery`, `case battery`, `charging`, `wifi`, `hotspot` | `session.device.state.*.onChange` | Drive the Status screen; persist last-known values in MMKV. |
| `head-up` | `session.events.onHeadPosition` | Not used today; available for future "wake on head up" feature. |
| `photo_response` (error only) | photo arrives in `requestPhoto` callback | **Only the ERROR variant is wired in `@mentra/bluetooth-sdk` 0.1.6.** The success variant is declared in the type system but never dispatched from iOS native (Bridge.swift:261 — no `sendPhotoSuccess`). Mentra's own starter-kit example uses server polling for completion; we do the same — see [Photo capture flow](#photo-capture-flow). Keep this listener for the error path (fast-fail when glasses can't capture). |
| `audio chunk` (mic PCM) | `session.events.onTranscriptionForLanguage` (but cooked) | Stream into ElevenLabs Conversational AI for STT. We get raw PCM here, not transcribed text — STT is on us. |
| `sdk log` | (none) | Pipe into our logger for debugging. |

### Outputs to glasses

| Action | Cloud SDK equivalent | Notes |
|---|---|---|
| Speak text | `session.audio.speak(text)` | **No equivalent in BLE SDK.** We synthesize PCM/WAV on the phone (ElevenLabs WS) and ship audio bytes to the speaker. |
| Play short audio cue (listening / got-it / cancelled) | `session.audio.playAudio({ audioUrl })` | Bundle WAVs in the app (`assets/cues/*.wav`), ship bytes to the speaker. |
| Stop currently-playing audio | `session.audio.stopAudio(trackId)` | BLE SDK should expose a speaker stop; if not, send silence or end the active stream. |
| Capture photo | `session.camera.requestPhoto({ size: "large", compress: "medium" })` | BLE `requestPhoto(requestId, appId, size, webhookUrl, authToken, compress, sound)`. Glasses POST multipart `{photo, requestId}` to the webhook URL. Completion is detected via **server long-poll** (`/api/photo/wait/:token`), NOT via `photo_response` — see [Photo capture flow](#photo-capture-flow). Keep `large` (1920×1080) + `medium` compression — measured optimum from the cloud version. |
| LEDs | `session.led.*` | Same semantics; useful for "thinking…" feedback if we want it. |

### Things that do NOT exist in @mentra/bluetooth-sdk

- **STT (`onTranscriptionForLanguage`)** — bring your own. Default plan: ElevenLabs Conversational AI WebSocket (does STT + TTS in one round trip). Fallback: stream PCM to Railway and run Whisper there.
- **TTS (`audio.speak`)** — bring your own. Same plan.
- **`simpleStorage`** — use MMKV on device.
- **`session.layouts` / `session.dashboard`** — Mentra Live has no display; irrelevant.
- **Permission error events (`onPermissionError`)** — replaced by native OS permission flows on iOS/Android.

## Photo capture flow

Two-step, token-mediated. Mobile never base64-encodes the photo itself.

```
1. Mobile → POST /api/photo/upload-url   (HMAC-authed)
     ← { photoToken, uploadUrl, expiresAt }   // server caches an empty entry under photoToken

2. Mobile → BluetoothSdk.requestPhoto(reqId, appId, "large", uploadUrl, null, "medium", false)
   Glasses → POST multipart {photo, requestId} to uploadUrl   // NO AUTH — URL-path token IS the auth
     ← { success: true, bytes }                                // server.storeBytes() wakes any waiters

3. Mobile → GET /api/photo/wait/<token>   (HMAC-authed, server long-poll, 20s)
     ← { ok: true, bytes }                                     // resolves the instant storeBytes() fires
   (in parallel: photo_response state="error" listener — fast-fail if glasses can't capture)

4. Mobile → POST /api/vision/scene  { photoToken, language }    ── │ parallel
            POST /api/faces/recognize-all  { photoToken }        ── │
     ← results
```

**Why the long-poll instead of the BLE `photo_response` success event:** `@mentra/bluetooth-sdk` 0.1.6's iOS bridge has `sendPhotoError` but no `sendPhotoSuccess` (Bridge.swift:261 — verified). The success variant is in the Swift type model but never dispatched to JS. Mentra's own starter-kit example (`examples/react-native/src/useBluetoothSdkExample.ts`) uses server polling for completion for the same reason — `photo_response` is documented as "acknowledgment, not completion."

**Server-side cache** (`src/services/photo-cache.ts`): in-memory `Map<token, PhotoEntry>` with 60s TTL, 20-entry cap, sweeper every 30s. `getBytes()` is non-evicting so describe-scene can read the same photo from both `/api/vision/scene` and `/api/faces/recognize-all` in parallel. `waitForBytes()` does the long-poll. Optional `evict()` for callers that want to free early.

**Mobile-side wrapper** (`mobile/src/ble/camera.ts`): `capturePhoto({ signal, size, compress })` orchestrates the whole dance. Races three signals — wait endpoint success, BLE `photo_response` error variant, 25s outer timeout. Cleans up the listener + timer + abort handler in `finally`.

## Audio pipeline (the critical piece)

This is the highest-risk part of the rewrite. Latency targets:

| Span | Cloud version (measured) | BLE target |
|---|---|---|
| Swipe → "listening" cue | ~150 ms | ≤ 200 ms |
| End of user speech → first token of result | ~1.5-2.0 s | ≤ 2.5 s |
| End of vision call → first audio byte to speaker | ~600-900 ms | ≤ 1.0 s |
| Total swipe → first spoken word of response | ~3-4 s | ≤ 5 s |

### Audio OUTPUT path (confirmed on iOS hardware)

**Mentra Live presents itself as both a BLE peripheral (data) and a Bluetooth Classic A2DP audio sink.** When iOS pairs over BLE through `@mentra/bluetooth-sdk`, the A2DP audio profile auto-pairs alongside it. From the OS perspective, the glasses speaker is just a regular Bluetooth audio output.

Implications:
- **No A2DP pairing UX needed in the app.** The `audio_pairing_needed` SDK event handler can be a no-op / fallback only.
- **TTS playback** = `/api/tts` bytes → temp file → play with `expo-audio` → routes to default Bluetooth output automatically.
- **Audio cues** = bundled WAVs in `mobile/assets/cues/` → play the same way.
- **Mic / speaker arbitration**: call `BluetoothSdk.setOwnAppAudioPlaying(true)` before any playback and `(false)` after. The SDK uses this to manage mic state during speech.
- **No multi-track concept** like the cloud's `trackId: 2` — there is no BLE audio channel to multiplex onto. **Serialize** speech and cues through a single playback queue.

### Audio INPUT path (mic) + STT

Glasses mic emits PCM via the SDK's `mic_pcm` event after calling `BluetoothSdk.setMicState(enabled=true, useGlassesMic=true, ...)` (wrapped in `src/ble/mic.ts`). Format is fixed: **16 kHz, 16-bit signed LE, mono, `pcm_s16le`**. VAD-gated by default.

**STT runs server-side — the "stream PCM to Railway" path we picked.** The phone batches the captured PCM and POSTs it to `POST /api/stt` (`src/relay/stt.ts`), where the relay runs ElevenLabs Scribe and returns text; `POST /api/normalize` (`src/relay/normalize.ts`) then fixes Arabic-script-English transcripts. We deliberately did **not** ship the ElevenLabs Conversational AI WebSocket directly on the device (the starter-kit alternative): keeping the key server-side, swapping STT providers, and logging/analysis all stay simpler, and the streaming `POST /api/answer` turn (below) recovers most of the latency the extra hop would otherwise cost. The once-planned `/api/tts/token` (a CAI signed-URL minter) was never needed and is not implemented.

### Streaming answer turn

The hot command turn no longer makes the 5 sequential relay calls (`stt → normalize → intent → vision → tts`). After STT it makes **one** call to `POST /api/answer` (`src/relay/answer.ts → requestAnswerStream`, via **`expo/fetch`** for an incrementally-readable body), which routes the utterance server-side and, for the **three free-text commands** (`scene-summarize`, `ocr-read-text`, `visual-qa`), streams the spoken answer back as **NDJSON `AnswerEvent`s** — per-sentence `chunk`s carrying base64 audio. `src/audio/streamingTts.ts → runStreamedAnswer` writes each chunk to a temp file and enqueues it on the existing serialized `play()` queue, so **sentence 1 plays while the LLM is still generating the rest** (the first chunk fires the `tts-playback-start` mark).

- **Photo:** `state/listening.ts` resolves the swipe-time pre-capture to a `photoToken` first (near-instant) and passes it in; the server's `waitForBytes` does the upload wait, so the phone skips its own `/api/photo/wait` hop.
- **Other commands** (`currency`, `color`, `find-object`, `who`, `face-enroll`, `unknown`): the server returns `route mode:"client"` and the phone runs its **existing discrete dispatch** unchanged (keeps the tuned, localized composition — e.g. money's RTL phrasing). One fewer round-trip (no separate `/api/intent`).
- **Working earcon:** `src/audio/thinkingCue.ts` (`startThinkingCue`/`stopThinkingCue`) plays a quiet looping pulse (`assets/cues/working.wav`) during the wait on its **own** expo-audio player (NOT the serialized queue), stopped the instant the first chunk arrives — single A2DP stream means cue-off-before-audio-on.
- **Fallback:** if streaming is unavailable before routing, the phone falls back to the **legacy** `normalize → /api/intent → discrete dispatch` path (`runLegacyTurn`), reusing the already-resolved photo. A recoverable mid-stream error (before any audio) dispatches the known command discretely; a failure after ≥1 chunk keeps the partial answer (no double-speak).

### Audio cues

Pre-generated WAV files bundled at `mobile/assets/cues/listening.wav`, `got-it.wav`, `cancelled.wav`, `working.wav`. The cloud version generated these server-side at startup; for mobile we pre-generate them at build time and play through `expo-audio`. Saves ~2.5-3s vs TTS cues. Generator: `scripts/generate-cues.ts` (pure synthetic tones — no network).

### Pre-bundled phrase audio

The hot, **static** spoken phrases (`didntCatch`, `generalError`, `unknownCommand`, `repeatNoHistory`, `glassesDisconnected`, `enrollPrompt`, `enrollFailed`) ship as committed mp3 assets (`mobile/assets/phrases/<key>.<lang>.mp3`) so they play instantly with no `/api/tts` round-trip and zero ElevenLabs spend. Dynamic strings (scene/OCR results, the enrollment success line that embeds a name) still use live TTS.

- **Source of truth:** `BUNDLED_PHRASE_KEYS` + the message text in [`src/i18n/messages.ts`](src/i18n/messages.ts). Shared by the generator and the runtime.
- **Generator:** `scripts/generate-phrases.ts` — mirrors [`src/services/elevenlabs-tts.ts`](../src/services/elevenlabs-tts.ts) (default voice Rachel, `eleven_flash_v2_5`, `mp3_44100_64`, `/stream`) so a bundled phrase is indistinguishable from a live one. Reads `ELEVENLABS_API_KEY` from the **repo-root `.env`** (the secret never ships in the app). Run `bun run scripts/generate-phrases.ts` and commit the mp3s after editing any bundled phrase.
- **Runtime:** [`src/audio/phrases.ts`](src/audio/phrases.ts) maps an exact localized string → bundled asset id; `speak()` ([`src/audio/tts.ts`](src/audio/tts.ts)) takes the fast path **only when `voicePreset === "default"` and `speechSpeed === 1.0`** — a user on a custom voice/speed still hears their choice via live TTS. Volume is applied at playback, so it's honored either way.

## Listening state machine

The mobile machine lives in `mobile/src/state/listening.ts` and ports the **exact** semantics from the cloud app's `src/app.ts` (separate repo — see the path note near the top). Constants:

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
- **Glasses disconnect (active/processing, or enrollment pending) → abort + speak `glassesDisconnected`.** Connection state can't be observed via `addListener` (the public event map omits `glasses_status`), so `ble/connection.ts` keeps a small imperative store (`isGlassesConnected`/`onGlassesDisconnected`/`setGlassesConnected`) fed from the React session by the always-mounted `BluetoothSessionProvider` at the app root (a single `useSuhailBluetooth()` instance — not per-screen — so the flag is accurate regardless of which tab is active and there's no double `autoConnectDefault`; screens read it via `useBluetoothSession()`). `camera.ts` fail-fasts on it (pre-check + a disconnect racer alongside wait/error/timeout) so a mid-command BLE drop fails in <1s instead of hanging out the 25s `CAPTURE_TIMEOUT_MS`. Photo capture is single-flighted (only one `requestPhoto` in flight at a time — two concurrent ones make the glasses deliver neither), and `resolvePhoto` awaits the swipe-time pre-capture rather than racing a second capture. The listening machine aborts in-flight work and **always** speaks the disconnect notice exactly once (via `announceDisconnectOnce`, deduped between the dispatch catch and the transition handler) — kept out of the generic-error path via the `GLASSES_DISCONNECTED_ERROR` marker. `lastResponse` is preserved across the drop.

Recreate the `pendingEnrollments` map for the 2-step face enrollment flow — see [`src/commands/face-enroll.ts`](../src/commands/face-enroll.ts) for the exact 30s timeout + TTS echo detection + concurrency lock.

## Usability-test instrumentation

For the section-13.8 usability study, every command turn is auto-measured — **no stopwatch, no Metro-log scraping.**

- **`tts-playback-start` mark** — `audio/playback.ts → play()` takes an `onStart` callback that fires the instant `player.play()` succeeds (first audio byte to the speaker = "glasses start speaking"). `audio/tts.ts → speak()` forwards it on both the bundled-phrase and live-TTS paths; `state/listening.ts → speakWithEchoGuard` passes `onStart: () => mark("tts-playback-start")`. This is the headline metric: wake → glasses start speaking.
- **`utils/timeline.ts`** — `markTime(label)` reads a mark's time relative to start; `tagTimeline({command, transcript})` (called by `listening.ts` right after intent routing) marks a turn as a real command so `endTimeline()` records one usability row per command turn (`timeToFirstWordMs`, `endUtteranceToFirstWordMs = first-word − mic-capture-done`, `totalMs`). Repeat/cue/disconnect speech is untagged and skipped.
- **`state/usabilityLog.ts`** — UNCAPPED session store (the 20-entry `activity.ts` cap would drop early tasks in a 45-min session). Rows are tagged with the moderator's `activeTask`; recoveries for a task = rows − 1. `buildUsabilityCsv()` + `USABILITY_CSV_HEADER` produce the export.
- **`screens/UsabilityTestScreen.tsx`** (Settings → Testing) — set the active task (1–8), watch live per-task counts, **Export CSV** (RN `Share`, dep-free), **Clear session** between participants. Strings live in `i18n/ui.ts → ui.usability`.
- Companion data-collection kit (protocol, 8 counterbalanced task scripts AR/EN, SUS, Table-13.14 formulas) lives in Google Docs/Sheets, not the repo.

## Commands status

All 8 live in [`src/commands/`](../src/commands/) (cloud) and `mobile/src/commands/` (mobile). Cloud handlers are the **specification** for the mobile equivalents.

| # | Command | Cloud handler | Mobile handler | Status |
|---|---|---|---|---|
| 1 | `scene-summarize` | [scene-summarize.ts](../src/commands/scene-summarize.ts) | [describe.ts](src/commands/describe.ts) | **Shipped** (slice 3b) |
| 2 | `ocr-read-text` | [ocr-read-text.ts](../src/commands/ocr-read-text.ts) | [read.ts](src/commands/read.ts) | **Shipped** (slice 3c) |
| 3 | `color-detect` | [color-detect.ts](../src/commands/color-detect.ts) | [color.ts](src/commands/color.ts) | **Shipped** (slice 3c) |
| 4 | `find-object` | [find-object.ts](../src/commands/find-object.ts) | [find.ts](src/commands/find.ts) | **Shipped** (slice 3c) |
| 5 | `face-recognize` | [face-recognize.ts](../src/commands/face-recognize.ts) | [who.ts](src/commands/who.ts) | **Shipped** (slice 3c) |
| 6 | `currency-recognize` | [currency-recognize.ts](../src/commands/currency-recognize.ts) | [money.ts](src/commands/money.ts) | **Shipped** (slice 3c) |
| 7 | `visual-qa` | [visual-qa.ts](../src/commands/visual-qa.ts) | [vqa.ts](src/commands/vqa.ts) | **Shipped** (slice 3c) |
| 8 | `face-enroll` | [face-enroll.ts](../src/commands/face-enroll.ts) | [enroll.ts](src/commands/enroll.ts) | **Shipped** (slice 3d — stateful 2-step + 30s timeout) |

Each ported command:
- captures a photo via [`mobile/src/ble/camera.ts`](src/ble/camera.ts) → server long-poll completion
- calls one or two [`mobile/src/relay/{vision,faces}.ts`](src/relay/) endpoints with `{ photoToken }`
- returns the spoken text (the listening state machine speaks it + updates `lastResponse`)
- throws on failure → dispatcher catches → speaks `generalError`

For the **legacy "port in this order" guidance** (kept for reference):

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

The intent router is also a Railway call: `POST /api/intent` with `{ text, language }` returns `{ command, params, confidence }`. Keyword fallback runs client-side if Railway is slow / unreachable (the relay's keyword table is in [`src/relay/command-router.ts`](../src/relay/command-router.ts)).

## Railway relay contract

The mobile app talks to the Railway server via these endpoints. The server implementation lives in `src/` (TypeScript, Bun) and reuses the existing service code. See root [CLAUDE.md](../CLAUDE.md) for the server-side details once those endpoints are built.

| Endpoint | Method | Body | Returns | Wraps |
|---|---|---|---|---|
| `/api/intent` | POST | `{ text, language }` | `{ command, params, confidence }` | [command-router.ts](../src/relay/command-router.ts) |
| `/api/answer` | POST | `{ text, photoToken, language, speed?, voicePreset? }` | **NDJSON `AnswerEvent` stream** (route → chunks → final). The primary low-latency turn path — `speed`/`voicePreset` ride along so streamed describe/read/VQA honour the user's voice settings like the discrete /api/tts path. See [Streaming answer turn](#streaming-answer-turn). | [answer.ts](../src/relay/answer.ts) |
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
| `/api/faces/:id` | DELETE | — | `{ success: true }` | face-service → deleteFace |
| `/api/faces/:id` | PUT | `{ name }` | `{ success: true }` (400 if `name` missing) | face-service → renameFace |
| `/api/faces/:id/photo` | GET | — | image bytes (404 if none) | reads `data/faces/:id.jpg` |
| `/api/tts` | POST | `{ text, voicePreset?, voiceId?, speed?, format? }` | audio bytes (Content-Type per format, `X-Audio-Format` header echoes choice) | server-side ElevenLabs TTS; default `format=mp3_44100_128`. Accepts `mp3_*`, `pcm_*` (8/16/22/24/44 kHz, 16-bit LE mono), and `ulaw_8000`. Returns 503 if `ELEVENLABS_API_KEY` is unset, 413 if text > 5000 chars. |
| `/api/tts/token` *(deferred)* | POST | TBD | TBD | will mint a short-lived ElevenLabs Conversational AI signed URL when we set up a CAI agent. Not implemented yet — use `/api/tts` for now. |

> **Face management routes are HMAC-authed except the photo GET.** `registerFaceRoutes(app)` ([`src/relay/faces.ts`](../src/relay/faces.ts), mounted in [`src/server.ts`](../src/server.ts) *before* the relay router so the specific routes win) puts `relayAuth` on `GET /api/faces`, `PUT /api/faces/:id`, and `DELETE /api/faces/:id`; only `GET /api/faces/:id/photo` is unauthenticated, so its URL works directly as an `<Image>` source ([`relay/faces.ts → facePhotoUrl`](src/relay/faces.ts)). Face **POST** recognize/enroll live on the relay router. The Contacts screen consumes `listFaces` / `renameFace` / `deleteFace` / `facePhotoUrl`.

### Auth

Per-device HMAC token. Device generates a UUID on first launch (stored in MMKV). On every request, header `Authorization: Bearer <HMAC(deviceId, sharedSecret)>`. Railway holds `RELAY_SHARED_SECRET`. Token is **not** a real auth — it's a soft rate-limiter to prevent random scraping. For real auth, swap to OAuth or Mentra account integration later.

### Versioning

`POST /api/*` accepts an `X-Suhail-Mobile-Version` header. Railway can refuse or warn if the mobile version is too old. Bump `mobile/package.json` version on each release.

## Bilingual support

Same model as the cloud version. `mobile/src/i18n/messages.ts` is the source of truth for spoken strings (a flat TS constants object keyed by `language`); it also feeds the bundled-phrase generator, so keep it clean of UI-only copy (that lives in `i18n/ui.ts`). Don't introduce a new i18n framework — a constants object plus `language` from settings is enough.

Language detection: respect the user's selected language (`settings.language`). Do NOT auto-detect from STT (we already learned that lesson with `onTranscriptionForLanguage` vs `onTranscription`).

RTL: required when language is Arabic. Implemented in `src/App.tsx` at module load — read the saved language synchronously (`getSettings().language`), `I18nManager.allowRTL(true)`, and `forceRTL(wantRTL)` when it differs from the current direction. `forceRTL` only takes full effect after a JS reload, so the **Settings language toggle** (`SettingsScreen.tsx`) flips the strings immediately and, when the layout direction changes, shows a "restart required" `Alert` (`ui.settings.restartMsg`) asking the user to reopen the app. We deliberately do **not** add `expo-updates`/`Updates.reloadAsync()` — the default language is Arabic, so a fresh install already boots RTL, and the toggle-needs-restart path is the rare case. Use logical styles (`start`/`end`, RN auto-mirrors `flexDirection: row` under RTL) in new UI.

## Settings

The server-contract settings shape (consumed by the relay's `/api/tts` request):

```ts
interface AppSettings {
  speechSpeed: number;   // 0.7 - 1.2 (ElevenLabs voice_settings.speed band; clamped)
  volume: number;        // 0.0 - 1.0
  voicePreset: "default" | "male" | "female";
  language: "ar" | "en";
}
```

Storage: MMKV. Defaults: `{ speechSpeed: 1.0, volume: 1.0, voicePreset: "default", language: "ar" }`. Validation/clamping same as the cloud version.

**Display-only prefs are NOT in `AppSettings`.** `AppSettings` is the server-contract shape (the relay/TTS consume it), so theme/text-size live in a separate `state/appearance.ts` store (MMKV id `suhail-appearance`): `{ themeMode: "dark" | "highContrast"; textScale: 0.85–1.5 }`, same clamp/sanitise pattern as `settings.ts`. The first-launch flag lives in `state/onboarding.ts` (MMKV id `suhail-onboarding`, synchronous `getHasOnboarded()`). Keep these out of `AppSettings` so the server contract doesn't grow display fields.

## UI & theming

The companion UI is built on a centralized, WCAG-checked theme (no UI-kit dependency). Targets WCAG 2.1 AA across the board (text 4.5:1, large/UI 3:1, touch targets ≥44px) and AAA contrast (7:1) where feasible. **The phone screen is still secondary** — the core voice flow has zero on-screen dependence (rule 3). This UI serves sighted helpers and low-vision / VoiceOver users.

- **Theme (`src/theme/`):** `ThemeProvider` (React Context) exposes `useTheme()` → an immutable `Theme` (colors, spacing, radii, typography scale, `minTouch: 44`, `borderWidth`). Two modes: `dark` (default) + `highContrast`; architecture is extensible to a future `light`. Components build styles with `const styles = useMemo(() => createStyles(theme), [theme])` where `createStyles = makeStyles((t) => StyleSheet.create({...}))`. The theme identity only changes on a themeMode/textScale change, so styles recompute rarely. `palettes.ts` holds the WCAG hex tables (with contrast notes); `navTheme.ts → toNavigationTheme()` maps tokens onto React Navigation's v7 theme (spreads `DarkTheme` for the required `fonts` block).
- **Typography scale** folds in the user `textScale`; OS Dynamic Type is applied on top by RN `Text` (don't multiply by `PixelRatio.getFontScale()` too — that double-applies). Use `minHeight` not fixed `height`, `flexShrink`, `numberOfLines`, and `hitSlop` so scaled text never clips.
- **Primitives (`src/components/`):** `Screen`, `Card` (tones default/ok/warn/danger), `AppButton` (variants + busy/disabled a11y, 44px), `Stepper` (`accessibilityRole="adjustable"`), `Chip` (selected = check glyph, not colour alone), `SettingRow`, `SectionHeader` (role=header), `StatusDot` (shape-by-state, not colour alone). Build screens from these — don't re-hardcode colours.
- **Accessibility conventions:** every control has `accessibilityRole` + label + state; the stepper is one adjustable node with increment/decrement actions; the rename modal is `accessibilityViewIsModal`; HomeScreen announces connection + listening transitions via `AccessibilityInfo.announceForAccessibility` (additive, never the only feedback — the audio cues still carry the core flow). Never convey status by colour alone (the listening dot, connection card, and activity tags all pair colour with a glyph/word).
- **Navigation:** `src/App.tsx` = `SafeAreaProvider > ThemeProvider > BluetoothSessionProvider > NavigationContainer(themed) > native-stack`. The stack gates **Onboarding** vs **Main** on `useOnboarding().hasOnboarded` (synchronous MMKV read = no boot flash); completing onboarding flips the flag and the stack swaps to `MainTabs` (`src/navigation/MainTabs.tsx`, Ionicons + accessible tab labels). The single `useSuhailBluetooth()` instance stays in `BluetoothSessionProvider`; screens + onboarding read it via `useBluetoothSession()`.
- **UI strings:** screen/onboarding/appearance/a11y strings live in `src/i18n/ui.ts` (`ui` + `uiFn` for interpolated, `useUi()` hook) — SEPARATE from the spoken `messages.ts` (which feeds the phrase generator and must stay clean). Add UI copy to `ui.ts`, never to `messages.ts`.
- **Branding:** the app icon, splash, and in-app marks are generated from the team's logo art by `scripts/make-icons.ts` (uses `sharp` from the repo-root node_modules — run `bun mobile/scripts/make-icons.ts`). The white mark composited on brand navy `#020617` → `assets/icon.png` (opaque, iOS-safe) + `assets/splash.png`; `assets/logo-white.png` is used in onboarding. Wired in `app.config.ts` (`icon` + `splash`).

## Environment variables (mobile)

Mobile env vars are baked into the build (anything with `EXPO_PUBLIC_` is exposed at runtime). Keep secrets OFF the device.

| Var | Purpose | Default |
|---|---|---|
| `EXPO_PUBLIC_RELAY_BASE_URL` | Railway base URL (no trailing slash) | (none — must set) |
| `EXPO_PUBLIC_RELAY_SHARED_SECRET` | HMAC secret for device auth. **Soft secret only** — bundled in app. Rotate by re-releasing. | (none) |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry crash reporting (Phase F) | (empty) |
| `EXPO_PUBLIC_LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` |

`.env.example` lives in `mobile/.env.example` — keep it in sync as we add vars. The root `.env.example` covers the Railway server.

## Project structure

The actual layout (top-level config, `scripts/`, `assets/{cues,phrases}/`, `patches/`, and `testing/` omitted for brevity — see the repo):

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
│       ├── cancelled.wav
│       └── working.wav              # Looping "thinking" pulse during the answer wait
└── src/
    ├── App.tsx                      # Root: ThemeProvider > BluetoothSessionProvider > themed native-stack (Onboarding|Main)
    ├── theme/                       # Centralized WCAG theme (tokens, palettes, ThemeProvider, navTheme, buildTheme)
    ├── components/                  # Shared primitives (Screen, Card, AppButton, Stepper, Chip, SettingRow, SectionHeader, StatusDot)
    ├── navigation/
    │   └── MainTabs.tsx             # Bottom tabs (themed, Ionicons + a11y labels)
    ├── ble/
    │   ├── connection.ts            # Scan, connect, reconnect + imperative connected-state store
    │   ├── events.ts                # Button / touch / battery subscriptions
    │   ├── mic.ts                   # PCM mic capture (setMicState + mic_pcm)
    │   └── camera.ts                # Photo capture via BLE (single-flight + disconnect racer)
    ├── audio/
    │   ├── tts.ts                   # TTS playback orchestration (bundled-phrase fast path + live /api/tts)
    │   ├── playback.ts              # Low-level expo-audio play() with onStart mark
    │   ├── phrases.ts               # Bundled static-phrase asset lookup
    │   ├── streamingTts.ts          # Consumes /api/answer NDJSON → temp files → serialized play() queue
    │   ├── thinkingCue.ts           # Looping "working" earcon (own player) during the answer wait
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
    │   ├── lastResponse.ts          # Last spoken response (for repeat)
    │   ├── settings.ts              # Zustand store, MMKV-backed (server-contract AppSettings)
    │   ├── appearance.ts            # Display prefs: themeMode + textScale (MMKV, NOT in AppSettings)
    │   ├── onboarding.ts            # First-launch hasOnboarded flag (MMKV)
    │   ├── deviceId.ts              # Per-device UUID for HMAC auth (MMKV)
    │   ├── activity.ts              # Rolling 20-event log
    │   └── usabilityLog.ts          # Uncapped session log for usability testing (+ CSV export)
    ├── relay/
    │   ├── client.ts                # HTTPS client + HMAC auth (exports authHeaders/buildUrl/withTimeout)
    │   ├── intent.ts                # /api/intent
    │   ├── normalize.ts             # /api/normalize (Arabic-script-English → Latin)
    │   ├── answer.ts                # /api/answer streaming consumer (expo/fetch) + NDJSON decoder
    │   ├── stt.ts                   # /api/stt (PCM → text)
    │   ├── tts.ts                   # /api/tts (text → audio bytes)
    │   ├── photo.ts                 # /api/photo/upload-url + wait (capture token dance)
    │   ├── vision.ts                # /api/vision/*
    │   └── faces.ts                 # /api/faces/*
    ├── i18n/
    │   ├── messages.ts              # Spoken bilingual constants (copy from server; feeds phrase generator)
    │   └── ui.ts                    # On-screen UI strings + useUi() (separate from messages.ts)
    ├── screens/
    │   ├── HomeScreen.tsx           # Status hero + listening + voice commands reference
    │   ├── ContactsScreen.tsx       # Enrolled faces CRUD
    │   ├── ActivityScreen.tsx       # Rolling log
    │   ├── SettingsScreen.tsx       # Voice output + Appearance/accessibility + Testing entry
    │   ├── OnboardingScreen.tsx     # First-launch wizard (welcome → permissions → pair → done)
    │   └── UsabilityTestScreen.tsx  # Testing mode: tag active task, view per-task counts, export CSV
    └── utils/
        ├── logger.ts                # Same Logger interface as server
        ├── timeline.ts              # Latency spans + usability marks
        └── transcription-filter.ts  # stripAnnotations() + validation (script normalization is server-side via /api/normalize)
```

## Phased status

| Phase | Goal | Status |
|---|---|---|
| **0** | Repo fork + this CLAUDE.md | **Done** |
| **A** | Railway relay endpoints (`/api/stt`, `/api/intent`, `/api/answer`, `/api/normalize`, `/api/vision/*`, `/api/faces/*`, `/api/tts`) | **Done** |
| **B** | RN scaffold + BLE handshake + button/swipe events in the app | **Done** |
| **C** | Audio pipeline end-to-end (PCM → STT → text → TTS → speaker) over BLE, incl. the streaming `/api/answer` turn | **Done** |
| **D** | All 8 commands ported | **Done** |
| **E** | Companion UI (onboarding + 4 tabs, WCAG theme) + usability instrumentation | **Done** |
| **F** | On-device hardening + tuning + merge back to `main` | **In progress** |

Each phase ends with hardware verification on Mentra Live. Don't proceed to the next phase until the current one is demoable.

## Rules for contributing (mobile-specific)

These extend the rules in root [CLAUDE.md](../CLAUDE.md), they don't replace them.

1. **No secrets in the app.** OpenRouter, AWS, full ElevenLabs keys live on Railway. The phone only ever holds the shared HMAC secret (soft) and short-lived tokens minted by Railway.
2. **No Expo Go.** Always test on a dev build. CI runs `eas build --profile development`.
3. **Audio only (still).** UI is for setup / settings / contacts / activity. The voice command flow has zero on-screen dependence. A blind user must be able to use the core flow with the phone in their pocket and the screen off.
4. **Preserve cloud semantics.** Listening timeouts, echo buffer, grace period, OCR cap, RTL number formatting — these were tuned with users. Don't change them without a measured reason.
5. **Test on real Mentra Live hardware.** Simulators do not have BLE. Every PR that touches BLE, audio, or commands needs a hardware test note.
6. **Measure before optimizing.** Port [`src/utils/timeline.ts`](../src/utils/timeline.ts) early. Every command span goes through it. Latency is a first-class metric.
7. **Keep both halves in sync.** When you add or change a relay endpoint, update the Railway-relay-contract table in this file (and the root `CLAUDE.md`). When you change the `AppSettings` shape (`mobile/src/state/settings.ts`), check the `/api/tts` request still matches. When you change bilingual spoken strings (`i18n/messages.ts`), regenerate the bundled phrases (`bun run scripts/generate-phrases.ts`).
8. **Don't reach into the cloud app code at runtime.** Only at design time (as a spec to copy from). The mobile app's only runtime dependency on `SuhailTeam/*` is the Railway relay's HTTP API.
9. **Keep `mobile/.env.example` and `mobile/package.json` up to date.** Same hygiene as the server side.
10. **Bun is the package manager** — `bun install` (it applies `patches/` via `patchedDependencies`). Don't use npm/yarn: they skip the patches and break iOS 26.5+ builds.

## Adding a new command (mobile-side)

After the relay endpoint exists:

1. Create `mobile/src/commands/<name>.ts` with a single `execute(deps)` function. Pattern: capture photo → call Railway endpoint → speak result. Mirror the shape of [`src/commands/base-command.ts`](../src/commands/base-command.ts) (try/catch + 5s photo timeout + pre-capture fallback + friendly error speech).
2. Add the command to the keyword fallback table in `mobile/src/state/listening.ts` (in case the LLM intent router times out).
3. Add to the command dispatcher in `mobile/src/state/listening.ts` (the equivalent of `this.handlers` in the cloud `app.ts`).
4. Add an on-device hardware test note to the PR (any BLE / audio / command change needs one — see rule 5).

## Testing (mobile)

Tests live in `mobile/testing/` (Bun test). `testing/preload.ts` stubs the native
modules (BLE SDK, expo-audio/file-system, MMKV, react-native) so the **real** app
modules import offline. `testing/unit/` covers pure logic (enrollment state, the
transcription filter, the OCR cap, i18n, the timeline); `testing/state-machine/`
drives the **real** listening machine via `helpers/listening-harness.ts` (mocked
IO) and runs as a **separate** `bun test` process because `mock.module` is
process-global. Full layout + gotchas: [`../testing/README.md`](../testing/README.md).

## Commands quick reference (mobile dev workflow)

```bash
# Inside mobile/
bun install                           # installs deps + applies patches/ (bun only)
cp .env.example .env                  # then set EXPO_PUBLIC_RELAY_BASE_URL + _SHARED_SECRET
bunx expo prebuild --clean            # one-time: generate native projects (bun run prebuild)
bun run start                         # Metro for the dev build (expo start --dev-client)
bun run android                       # build + run on a connected Android device (expo run:android)
bun run ios                           # build + run on a Mac + real iPhone (expo run:ios)
bun run typecheck                     # tsc --noEmit (production src; testing/ excluded)
bun run typecheck:test                # Type-check src + testing/ (tsconfig.test.json)
bun run test                          # Mobile suite: bun test ./testing/unit && ./testing/state-machine
bun run scripts/generate-cues.ts      # Regenerate cue chimes (synthetic, no network)
bun run scripts/generate-phrases.ts   # Regenerate pre-bundled phrase audio (needs repo-root ELEVENLABS_API_KEY)
bun scripts/make-icons.ts             # Regenerate app icon + splash + logo marks (uses repo-root sharp)
```

For EAS cloud builds: `bunx eas-cli login`, then `bunx eas build --profile development --platform ios|android` (or `--profile production --platform all`).

## References

- BLE SDK overview: https://bluetooth-sdk-docs.mentra.glass/bluetooth-sdk/overview/
- Starter kit (read first): https://github.com/Mentra-Community/Mentra-Bluetooth-SDK-Starter-Kit
- ElevenLabs audio pattern (copy): https://github.com/Mentra-Community/Mentra-Bluetooth-SDK-Starter-Kit/tree/main/examples/react-native-elevenlabs-audio
- Original cloud app (the spec): [SuhailTeam/SuhailApp](https://github.com/SuhailTeam/SuhailApp)
- This fork: [SuhailTeam/SuhailApp-BLE](https://github.com/SuhailTeam/SuhailApp-BLE)
