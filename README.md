# Suhail — BLE Relay Server

**Graduation Project — SWE 496, King Saud University (KSU)**

Suhail is an AI-powered assistive system for **visually impaired users** running on **Mentra Live** smart glasses. This repository is the **AI relay server** for the **BLE mobile app** (`mobile/`): a plain Bun/TypeScript + Express HTTP service that does intent routing, vision, face recognition/enrollment, speech-to-text, text-to-speech, and BLE photo capture.

The mobile app talks to the glasses directly over Bluetooth and calls this server's HMAC-authenticated `/api/*` relay for all the AI work. The glasses have a camera, mic, and speaker but **no display** — all output is audio.

> The original MentraOS *cloud-app* version (glasses ↔ phone ↔ MentraOS Cloud ↔ server over WebSocket) lives in a separate repo. This repo is BLE-only and no longer depends on `@mentra/sdk`.

## Team Members

- Abdullah Alqobaisi
- Faisal Alqahtani
- Nasser Alaboud
- Abdullah Alyousef

## Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- An OpenRouter API key, AWS credentials (Rekognition), and an ElevenLabs API key
- The BLE mobile app (`mobile/`) for end-to-end testing — see `mobile/README.md`

## Setup

1. **Install dependencies**
   ```bash
   bun install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Fill in your keys. Key variables:

   | Variable | Purpose | Default |
   |----------|---------|---------|
   | `PORT` | Server port | `3000` |
   | `OPENROUTER_API_KEY` | OpenRouter — vision + intent classification + normalization | (required) |
   | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS credentials for Rekognition | (required) |
   | `AWS_REGION` | AWS region | `us-east-1` |
   | `AWS_REKOGNITION_COLLECTION_ID` | Face collection ID | `suhail-faces` |
   | `RELAY_SHARED_SECRET` | HMAC-Bearer secret shared with the mobile app (empty → relay is open, dev mode) | (empty) |
   | `ELEVENLABS_API_KEY` | ElevenLabs key for `/api/tts` + `/api/stt` (empty → those return 503) | (empty) |
   | `DEFAULT_LANGUAGE` | Response language (`ar` or `en`) | `ar` |
   | `VISION_MODEL` | OpenRouter model for vision tasks | `google/gemini-2.5-flash-lite` |
   | `CLASSIFICATION_MODEL` | OpenRouter model for intent classification | `google/gemini-2.5-flash-lite` |
   | `CONFIDENCE_THRESHOLD` | Min confidence for face recognition | `0.5` |

3. **Start the server**
   ```bash
   bun run start          # or: bun run dev  (auto-restart on change)
   ```
   It serves `GET /health` and the `/api/*` relay. Point the mobile app's `EXPO_PUBLIC_RELAY_BASE_URL` at this server (locally, expose it with a tunnel such as ngrok; in production it deploys to Railway).

## Development

```bash
bun run dev         # watch mode (auto-restart)
bun run typecheck   # tsc --noEmit
```

### Git workflow
```bash
git checkout -b feature/my-feature development    # branch off development
# make changes, conventional commits...
git push origin feature/my-feature                # open PR → development
```
After merging to `development` and testing, open a PR `development` → `main` for release. See `CLAUDE.md` for full version-control guidelines.

## Relay API (what the mobile app calls)

All endpoints are **POST** under `/api` and require HMAC-Bearer auth (`X-Device-Id` + `Authorization: Bearer <hex(HMAC-SHA256(deviceId, RELAY_SHARED_SECRET))>`), **except** the glasses photo-upload webhook (token-authed) and the face **photo** GET (loaded as an `<img>`). Vision/face endpoints accept either `{ image: <base64> }` or `{ photoToken: <hex> }`.

| Endpoint | Body | Returns |
|----------|------|---------|
| `POST /api/intent` | `{ text, language? }` | `{ command, params?, rawText }` |
| `POST /api/normalize` | `{ text, language }` | `{ text }` |
| `POST /api/vision/scene` | `{ image\|photoToken, language? }` | `{ description, confidence }` |
| `POST /api/vision/ocr` | `{ image\|photoToken, context?, language? }` | `{ text }` |
| `POST /api/vision/currency` | `{ image\|photoToken }` | `CurrencyResult` |
| `POST /api/vision/object` | `{ image\|photoToken, target, language? }` | `{ found, location, confidence }` |
| `POST /api/vision/color` | `{ image\|photoToken, language? }` | `{ colorName, hex }` |
| `POST /api/vision/vqa` | `{ image\|photoToken, question, language? }` | `{ description, confidence }` |
| `POST /api/faces/recognize` | `{ image\|photoToken }` | `FaceRecognitionResult` |
| `POST /api/faces/recognize-all` | `{ image\|photoToken }` | `MultiFaceResult` |
| `POST /api/faces/enroll` | `{ image\|photoToken, name }` | `{ faceId, name, enrolledAt }` |
| `POST /api/stt` | `{ audio (base64 s16le 16kHz mono PCM), language? }` | `ScribeResult` (503 without `ELEVENLABS_API_KEY`) |
| `POST /api/tts` | `{ text, voicePreset?, voiceId?, speed?, format? }` | audio bytes (503 without key) |
| `GET /api/faces` | — | `{ faces, count }` (HMAC-authed) |
| `GET /api/faces/:id/photo` | — | JPEG (unauthenticated — loaded as `<img>`) |
| `PUT /api/faces/:id` | `{ name }` | `{ success }` (HMAC-authed) |
| `DELETE /api/faces/:id` | — | `{ success }` (HMAC-authed) |

**BLE photo-capture flow:** `POST /api/photo/upload-url` mints a one-shot token + `uploadUrl` → mobile tells the glasses to upload → glasses `POST /api/photo/upload/:token` (multipart, unauthenticated — the URL token is the auth) → mobile long-polls `GET /api/photo/wait/:token` → mobile calls a vision/face endpoint with `{ photoToken }`.

## Features

| Feature | AI Backend |
|---------|------------|
| Scene summarization (with face recognition) | OpenRouter / Gemini + AWS Rekognition |
| OCR / read text | OpenRouter / Gemini |
| Face recognition (multi-face) + enrollment | AWS Rekognition |
| Find object · Currency · Color · Visual Q&A | OpenRouter / Gemini |
| Speech-to-text · Text-to-speech | ElevenLabs (Scribe STT · TTS) |

## Project Structure

```
suhail/
├── src/
│   ├── index.ts                        # Bootstrap: build app, startup probes, listen(PORT)
│   ├── server.ts                       # buildApp() — Express app + /health + route mounts
│   ├── relay/
│   │   ├── routes.ts                   # POST /api/* relay endpoints + photo-upload webhook
│   │   ├── auth.ts                     # HMAC-Bearer auth middleware
│   │   ├── faces.ts                    # GET/PUT/DELETE /api/faces* (face management)
│   │   └── command-router.ts           # LLM intent classification + keyword fallback
│   ├── services/
│   │   ├── vision-service.ts           # Vision LLM calls (OpenRouter / Gemini)
│   │   ├── face-service.ts             # Face recognition/enrollment (AWS Rekognition + local storage)
│   │   ├── elevenlabs-tts.ts           # ElevenLabs TTS for /api/tts
│   │   ├── elevenlabs-stt.ts           # ElevenLabs Scribe STT for /api/stt
│   │   ├── photo-cache.ts              # In-memory token store for the BLE photo flow
│   │   └── openrouter-status.ts        # Startup probe of OpenRouter /credits
│   ├── utils/
│   │   ├── config.ts                   # Environment config
│   │   ├── logger.ts                   # Tag-prefixed logger
│   │   ├── image-utils.ts              # cropFace() for multi-face recognition
│   │   ├── transcription-filter.ts     # stripAnnotations() + validation
│   │   └── transcription-normalizer.ts # Arabic-script English → Latin (LLM)
│   └── types/
│       └── index.ts                    # Shared TypeScript types
├── data/faces/                         # Persistent face data (metadata + photos) — gitignored
├── mobile/                             # React Native / Expo BLE app (own README/CLAUDE.md)
├── landing/                            # React + Vite marketing site (standalone; not served here)
├── .env.example
├── package.json
└── tsconfig.json
```

## Architecture

```
BLE mobile app (over Wi-Fi/HTTP, HMAC-authed)
  → POST /api/stt        (audio → text)
  → POST /api/normalize + POST /api/intent   (text → {command, params})
  → POST /api/vision/* or /api/faces/*        (image → result)
  → POST /api/tts        (text → audio bytes, played through the glasses)
```

The server is a plain Express app: `index.ts` builds it via `server.ts`, runs startup probes (`loadPersistedFaces`, `probeOpenRouterStatus`), and listens. Relay handlers call the `vision`/`face`/`elevenlabs`/`command-router`/`photo-cache` services directly.
