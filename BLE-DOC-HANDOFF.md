# BLE Rewrite — Handoff for Documentation

You are updating the Suhail GP2 documentation to cover the new BLE version of the project. The original cloud version is documented; the BLE rewrite is not. Below is everything you need.

## Where the code lives

- **Cloud version (Phase 1):** `SuhailTeam/SuhailApp` and `SuhailTeam/SuhailApp-BLE` → branch `main`. Identical to each other. Production-deployed on Railway.
- **BLE rewrite (Phase 2):** `SuhailTeam/SuhailApp-BLE` → branch **`development`**. This is the new work. 16+ merged PRs, all 8 commands hardware-verified on iPhone 17 Pro Max / iOS 26.5 as of 2026-05-26.
- Authoritative dev-side docs to cross-reference: `CLAUDE.md` (server/relay side) and `mobile/CLAUDE.md` (mobile side) on the development branch. `TODO.md` is the current status snapshot.

## What changed at the architecture level

Before (cloud):

```
Glasses → User's phone (Mentra app) → MentraOS Cloud (WebSocket) → Our server
```

The server was the "session" — it received events, ran AI, and pushed audio responses back through MentraOS Cloud.

After (BLE):

```
Glasses ←─ BLE ─→ Suhail mobile app (iOS, RN/Expo) ←─ HTTPS ─→ Railway relay (stateless API)
```

The phone is now the session. The server became a stateless REST relay. MentraOS Cloud is no longer in the loop. Suhail no longer depends on the Mentra phone app being installed.

## The two halves of the BLE version

### Mobile app — `mobile/` directory

A native iOS app built with React Native + Expo (dev client; Expo Go does not work because the BLE SDK needs native modules).

- **Framework:** Expo SDK 52, React Native 0.76.5, TypeScript strict
- **BLE:** `@mentra/bluetooth-sdk` 0.1.6 (beta — pinned)
- **State:** Zustand
- **Storage:** MMKV (`react-native-mmkv`) for settings + activity log + last-response cache
- **Audio:** `expo-audio` for playback; PCM mic input via the BLE SDK
- **Navigation:** React Navigation (native stack + bottom tabs)
- **Platforms:** iOS 15.1+ verified on iPhone 17 Pro Max / iOS 26.5. Android is **explicitly out of scope** for this milestone (config kept so codebase doesn't regress, but no Android testing).

Mobile source layout (under `mobile/src/`):

- `App.tsx` — entry
- `ble/` — `connection.ts`, `events.ts`, `mic.ts`, `camera.ts`
- `audio/` — TTS playback + cue player
- `commands/` — 8 handlers: `describe`, `read`, `who`, `enroll`, `find`, `money`, `vqa`, `color`
- `state/` — `listening.ts` (state machine), `enrollment.ts`, `lastResponse.ts`, `activity.ts`, `settings.ts`, `deviceId.ts`
- `screens/` — `HomeScreen`, `ContactsScreen`, `ActivityScreen`, `SettingsScreen` (replaces the cloud version's webview SPA)
- `i18n/`, `utils/`

### Server / AI relay — repo root `src/`

The same TypeScript server, but stripped down to a stateless HTTPS API. Same Bun runtime. Same deployment target (Railway).

New `src/relay/` layer with two files: `routes.ts` and `auth.ts` (HMAC device authentication).

Endpoints exposed by the relay:
- `POST /api/intent` — LLM intent classification (Gemini via OpenRouter)
- `POST /api/vision/scene`, `/api/vision/ocr`, `/api/vision/vqa`, etc. — vision tasks
- `POST /api/faces/recognize-all`, `/api/faces/enroll`, `GET/PUT/DELETE /api/faces/:id`
- `POST /api/tts` — ElevenLabs TTS (server holds the API key)
- `POST /api/photo/upload-url`, `POST /api/photo/upload/:token` (unauth, token-as-auth), `GET /api/photo/wait/:token` — photo capture flow
- Plus `multer` for multipart photo uploads from the glasses

The server holds **all secrets** (OpenRouter, AWS Rekognition, ElevenLabs). The mobile app holds none — it gets short-lived signed URLs / HMAC-authed sessions.

## What was kept, replaced, and added

| Concern | Cloud version | BLE version |
|---|---|---|
| Voice commands (all 8) | Same 8 handlers, server-side | Ported to `mobile/src/commands/`, mobile-side |
| Intent classification | OpenRouter / Gemini in-process | Same logic, exposed via `/api/intent` |
| Vision (scene, OCR, VQA, currency, color, object) | OpenRouter / Gemini in-process | Same logic, exposed via `/api/vision/*` |
| Face recognition | AWS Rekognition in-process | Same logic, exposed via `/api/faces/*` |
| STT | MentraOS built-in (`onTranscriptionForLanguage`) | **ElevenLabs Scribe** (custom pipeline — glasses PCM → relay → Scribe → text) |
| TTS | `session.audio.speak()` via MentraOS | **ElevenLabs** direct via `/api/tts` → `expo-audio` → A2DP to glasses speaker |
| Audio cues (listening/got-it/cancelled) | Server-generated WAVs | Pre-bundled WAVs in `mobile/assets/cues/` |
| Persistent storage | `session.simpleStorage` (cloud-synced) | MMKV on device |
| Companion UI | `/webview` SPA in `public/index.html` | Native RN screens, 4 tabs (parity) |
| Session model | Server-side `onSession`/`onStop` | Phone-side; server is stateless |
| Photo capture | `session.camera.requestPhoto()` | Token-mediated upload + 20s long-poll (see "Engineering challenges") |
| Listening state machine | `src/app.ts` | Ported verbatim to `mobile/src/state/listening.ts` (same constants: 10s window, 1s grace, 1.5s TTS echo buffer, 0.55 min confidence) |

## Engineering challenges solved (good material for a "Challenges" section)

1. **iOS BLE SDK photo-completion gap.** `@mentra/bluetooth-sdk` 0.1.6's iOS bridge (`Bridge.swift:261`) emits `photo_response` with `state="error"` but never with `state="success"` — the success variant is declared in the type system but never dispatched. Mentra's own starter-kit example confirms this. **Solution:** a two-step token-mediated photo flow. Mobile requests an upload URL with a one-time token, glasses POST multipart directly to that URL (no auth — the URL path token *is* the auth), server caches bytes in an in-memory `Map<token, PhotoEntry>` with 60s TTL, and mobile long-polls `/api/photo/wait/:token` for up to 20s. Bytes resolve the instant the upload lands. Race against the BLE `photo_response` error variant for fast-fail, plus a 25s outer timeout.

2. **A2DP audio path on iOS.** Confirmed that Mentra Live presents itself as both a BLE peripheral (data) AND a Bluetooth Classic A2DP audio sink. When iOS pairs over BLE, A2DP auto-pairs alongside. Implication: no extra pairing UX needed — TTS plays through `expo-audio` and iOS routes it to the default Bluetooth output. The `audio_pairing_needed` SDK event can be a no-op.

3. **No multi-track audio.** Cloud version used `trackId: 2` for TTS to leave track 1 free. BLE has no such concept — single playback channel — so all speech and cues serialize through one queue managed via `BluetoothSdk.setOwnAppAudioPlaying(true/false)`.

4. **Pre-capture race.** Forward swipe pre-captures a photo in parallel with STT + intent classification. Photo result is awaited on the command path with a short timeout. Measured win: ~3–5s per command. Implemented in `mobile/src/state/listening.ts` as a module-level promise.

5. **STT/TTS budget.** ElevenLabs Starter plan (~30k credits/month, $6/mo). The server logs greppable `[Cost]` lines for every STT/TTS call. Single-trial hardware testing keeps a session under ~700 credits; rough cost per command: describe ≈ 100 credits, enroll ≈ 150.

6. **Enrollment name handling.** Scribe annotates non-speech sounds like `(knocks on table)` inline with the transcribed name. Strip filter lives in both `src/utils/transcription-filter.ts` (server) and `mobile/src/utils/transcription-filter.ts` (mobile — needed because the enrollment-name path bypasses `/api/intent`). Names that are too short after stripping are rejected.

## Current status

**Working and hardware-verified on iPhone 17 Pro Max / iOS 26.5:**
- All 8 voice commands (describe, read, who, enroll, find, money, vqa, color)
- BLE pairing and auto-reconnect on launch
- Listening state machine with timeouts, grace period, TTS echo guard
- A2DP audio output for TTS and cues
- Photo capture via token-mediated flow
- Multi-face recognition
- Stateful 2-step face enrollment with 30s timeout
- 4-screen native mobile UI

**Latency:** currently ~6–10s end-to-end (cloud version is ~3–4s). Target is ≤5s; primary lever is TTS streaming server→mobile.

**Open items (from `TODO.md`):**
- Graceful mid-command BLE-disconnect handling (currently hangs until 25s timeout)
- First-launch onboarding/pairing wizard
- Sub-5s latency (TTS streaming, optional on-device Whisper)
- TestFlight + Apple Developer Program for distribution beyond the dev device
- Optional: LC3 audio compression to shrink STT payloads

## What to write into the documentation

Suggested coverage in the GP2 doc:

1. **Add a "Version 2 — BLE Architecture" section** parallel to whatever exists for the cloud version. Use the architecture diagram above.
2. **Update tech stack** to list both halves (server stack unchanged; mobile stack is new).
3. **New section: "Why we rewrote it"** — eliminate MentraOS Cloud dependency, own the audio/STT pipeline, run on any phone without the Mentra app, learn native mobile.
4. **New section: "Engineering challenges"** — use items 1–4 above; they're concrete and demoable.
5. **Update the project structure tree** to show both `src/` (relay) and `mobile/src/` (app).
6. **Update the "Controls" / user flow section** — the gestures and listening state machine are unchanged, but the lifecycle is different (phone-side session, BLE pairing on first launch).
7. **Update "Future Work"** with the open `TODO.md` items.
8. **Keep the cloud version documented** as Phase 1 / baseline. The BLE rewrite is Phase 2 / current.

Source files to cite or quote from when you write:
- `mobile/CLAUDE.md` — most authoritative description of the mobile half
- `CLAUDE.md` (root, development branch) — relay side
- `TODO.md` — current status and open items
- `mobile/package.json` and root `package.json` — exact dependency versions
- `src/relay/routes.ts` — endpoint list
- `mobile/src/state/listening.ts` — state machine constants

Do not invent details. If something isn't covered above or in the referenced files, ask before writing it into the documentation.
