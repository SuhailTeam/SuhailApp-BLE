# Suhail — AI Context File

> This file is for AI coding assistants (Claude, GPT, Copilot, etc.) to understand the Suhail project. Read this before making any changes.

## What is Suhail?

Suhail is an AI-powered assistive app for **visually impaired users**, built for **Mentra Live** smart glasses. It captures images from the glasses camera, processes them through cloud AI APIs, and speaks results back to the user. It is a graduation project (SWE 496, King Saud University).

**Critical constraint:** Mentra Live glasses have a camera, microphone, speakers, LEDs, and WiFi — but **NO display**. All output MUST go through `session.audio.speak()`. Do not use `session.layouts` — it exists on the session object but has no effect since Mentra Live has no screen.

## Environments

The project runs in two environments:

### Local Development
- Run the server locally with `bun run dev` (auto-restart) or `bun run start`
- Expose the local server to the internet with `ngrok http 3000 --url=unplummeted-teddy-extractable.ngrok-free.dev`
- Static ngrok URL: `https://unplummeted-teddy-extractable.ngrok-free.dev`
- This URL is set in the Mentra Developer Console as the webhook URL
- Use `.env` file for environment variables
- Good for rapid iteration and debugging

### Production (Railway)
- The `main` branch is deployed on **Railway** (cloud hosting)
- Railway provides the public URL — no ngrok needed
- Environment variables are set in Railway's dashboard
- Push to `main` triggers automatic deployment

## Tech Stack

- **Runtime:** Bun (not Node.js) — use `bun run start`, `bun install`, etc.
- **Language:** TypeScript (strict mode)
- **SDK:** `@mentra/sdk` (MentraOS TypeScript SDK)
- **Package manager:** Bun
- **Storage:** AWS Rekognition (face collection) + local filesystem (`data/faces/`) for face photos and metadata. The SDK provides `session.simpleStorage` (persistent, cloud-synced key-value store, ~10MB per user) which is available for future use
- **AI services:** OpenRouter (Google Gemini 2.5 Flash Lite) for vision + intent classification, AWS Rekognition for face recognition

## Mentra Live Hardware

Mentra Live is one of several glasses models supported by MentraOS. Here's what it has:

| Feature | Mentra Live | Notes |
|---------|-------------|-------|
| Camera | 1080p (photo + video streaming) | `session.camera` |
| Microphone | Yes (with Voice Activity Detection) | `session.events.onTranscription()` |
| Speaker | Yes | `session.audio.speak()` |
| Buttons | 2 physical buttons (left + right/camera) + swipe pad | Short press + long press each |
| LEDs | RGB + White | `session.led` |
| WiFi | Yes | |
| Display | **No** | `session.layouts` has no effect |
| IMU | Not documented | |

Other glasses (Even Realities G1, Vuzix Z100) have displays but no camera/speaker. Code written for Mentra Live should never assume a display exists.

## How MentraOS Works

MentraOS apps are **server-side TypeScript applications**. The architecture:

```
Mentra Live Glasses <-> User's Phone (Mentra App) <-> MentraOS Cloud (WebSocket) <-> YOUR SERVER
```

### Session Lifecycle
1. User launches your app from the Mentra phone app
2. MentraOS Cloud sends an HTTP POST webhook to your server with `sessionId` and `userId`
3. Your server establishes a WebSocket connection to MentraOS Cloud
4. `onSession(session, sessionId, userId)` is called — this is your entry point
5. Session is active — glasses stream events, server sends audio responses
6. Session ends via: user stopping app, glasses disconnect, network error, or `session.disconnect()`
7. `onStop(sessionId, userId, reason)` is called (session object is NOT available here)

### Voice Commands — How They Work
There is **no built-in wake word or command system** from Mentra. The SDK gives you **raw transcription text** via `session.events.onTranscription()`. Your app is responsible for parsing commands from that text. The Suhail app uses **LLM-based intent classification** (via OpenRouter) with keyword matching as a fallback — see `command-router.ts`.

**Swipe-to-command:** The user swipes **forward** on the swipe pad to activate a ~10 second listening window. The next voice transcription is processed as a command without needing a wake word. Swiping **backward** repeats the last response. The left button also works as a fallback (short press = interrupt + re-listen, long press = repeat). This prevents accidental triggers from background conversation and is more reliable than speech-based wake words.

## MentraOS SDK Reference

### AppServer

```typescript
import { AppServer, AppSession } from "@mentra/sdk";

class MyApp extends AppServer {
  // Called when a user connects
  override async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> { }

  // Called when a session ends (session object NOT available here)
  override async onStop(sessionId: string, userId: string, reason: string): Promise<void> { }
}

// Constructor config
new AppServer({
  packageName: "com.suhail.assistant",  // Must match Mentra Developer Console
  apiKey: "your_mentra_api_key",
  port: 3000,
  publicDir: false,       // Static files directory (optional)
  healthCheck: true,      // Enable /health endpoint (optional)
});

app.start();   // Launch server
app.stop();    // Stop server
```

Additional AppServer methods:
- `getExpressApp()` — returns the underlying Express app instance
- `generateToken(userId, sessionId, secretKey)` — generates JWT for webview auth
- `addCleanupHandler(handler)` — registers cleanup function

### Session Properties

| Property | Type | Description |
|----------|------|-------------|
| `session.events` | `EventManager` | Subscribe to events (voice, buttons, sensors, etc.) |
| `session.audio` | `AudioManager` | Text-to-speech and audio playback |
| `session.camera` | `CameraManager` | Photo capture and video streaming |
| `session.led` | `LedModule` | Control RGB LEDs (Mentra Live only) |
| `session.location` | `LocationManager` | GPS location access |
| `session.simpleStorage` | `SimpleStorage` | Persistent key-value storage (cloud-synced) |
| `session.settings` | `SettingsManager` | App settings from Developer Console |
| `session.capabilities` | `Capabilities \| null` | Detect device hardware at runtime |
| `session.layouts` | `LayoutManager` | Display layouts — exists but has NO effect on Mentra Live |
| `session.dashboard` | `DashboardAPI` | Persistent status display — NO effect on Mentra Live |
| `session.logger` | `Logger` (Pino) | Session-scoped logging |

### Events (session.events)

```typescript
// Voice transcription (speech-to-text done by MentraOS)
session.events.onTranscription((data: TranscriptionData) => {
  // data.text       — transcribed text (string)
  // data.isFinal    — boolean, true when user finished speaking (ALWAYS check this)
  // data.confidence — confidence score 0-1
  // data.language   — language code e.g. "en-US"
  // data.timestamp  — Date
});

// Button press (Mentra Live has 2 buttons: "left" and "right"/"camera")
session.events.onButtonPress((data: ButtonPress) => {
  // data.buttonId  — "left" or "right" (also "camera" as alias for "right")
  // data.pressType — "short" or "long"
});

// Head position detection
session.events.onHeadPosition((data: HeadPosition) => {
  // "up" or "down"
});

// Voice activity detection (is the user speaking?)
session.events.onVoiceActivity((data: Vad) => {
  // boolean — true when voice detected
});

// Phone notifications forwarded from the user's phone
session.events.onPhoneNotifications((data: PhoneNotification) => {
  // data.app, data.title, data.content
});

// Battery levels
session.events.onGlassesBattery((data: GlassesBatteryUpdate) => {
  // data.level, data.charging
});
session.events.onPhoneBattery((data: PhoneBatteryUpdate) => { });

// Calendar events
session.events.onCalendarEvent((data: CalendarEvent) => { });

// Raw audio chunks (requires explicit subscription)
session.events.onAudioChunk((data: AudioChunk) => { });
// Must subscribe first: session.subscribe([StreamType.AUDIO_CHUNK])

// Location updates
session.events.onLocation((data: LocationUpdate) => { });

// Connection lifecycle
session.events.onConnected((settings?: AppSettings) => { });
session.events.onDisconnected((reason: string) => { });
session.events.onError((error: WebSocketError | Error) => { });

// Settings changes
session.events.onSettingsUpdate((settings: AppSettings) => { });

// All event listeners return an unsubscribe function:
const unsubscribe = session.events.onTranscription(handler);
unsubscribe(); // stop listening
```

### Camera (session.camera)

```typescript
// Request a photo from the glasses camera
const photoData = await session.camera.requestPhoto(options?);

// Options:
interface PhotoRequestOptions {
  size?: "small" | "medium" | "large" | "full";  // Default: "medium". Avoid "full" on Mentra Live — uploads can take 25s+
  saveToGallery?: boolean;
  compress?: "none" | "medium" | "heavy";  // Default: "none"
  customWebhookUrl?: string;
  authToken?: string;
}

// Returns:
interface PhotoData {
  buffer: Buffer;      // Raw image bytes
  mimeType: string;
  filename: string;
  size: number;        // bytes
  requestId: string;
}

// IMPORTANT: The SDK returns a Buffer, NOT a base64 string.
// Convert with: photoData.buffer.toString("base64")
// The method is requestPhoto(), NOT takePhoto()

// Video streaming (managed — MentraOS handles encoding/CDN)
const result = await session.camera.startManagedStream(options?);
// Returns: { hlsUrl, dashUrl, webrtcUrl?, streamId, previewUrl, thumbnailUrl }
await session.camera.stopManagedStream();
session.camera.onManagedStreamStatus((status) => { });
// status: "initializing" | "preparing" | "active" | "stopping" | "stopped" | "error"

// Video streaming (unmanaged — direct RTMP)
await session.camera.startStream({ rtmpUrl: "rtmp://..." });
await session.camera.stopStream();
session.camera.onStreamStatus(handler);
session.camera.isCurrentlyStreaming(): boolean;
```

### Audio (session.audio)

```typescript
// Text-to-speech (uses ElevenLabs)
const result = await session.audio.speak(text: string, options?: SpeakOptions);
// Returns: AudioPlayResult { success: boolean, error?: string, duration?: number }
// TTS has a 60-second timeout

interface SpeakOptions {
  voice_id?: string;                    // ElevenLabs voice ID
  model_id?: string;                    // Default: "eleven_flash_v2_5"
  voice_settings?: {
    stability?: number;                 // 0-1
    similarity_boost?: number;          // 0-1
    style?: number;                     // 0-1
    speed?: number;                     // 0.5-2.0
    use_speaker_boost?: boolean;
  };
  volume?: number;                      // 0.0-1.0, default 1.0
}

// Available TTS models:
// - "eleven_flash_v2_5" (multilingual, ~75ms latency) — DEFAULT
// - "eleven_v3" (70+ languages, standard latency)
// - "eleven_turbo_v2_5" (multilingual, ~250-300ms)
// - "eleven_multilingual_v2" (29 languages, standard latency)

// Play audio from a URL
await session.audio.playAudio({ audioUrl: "https://...", volume?: 0.0-1.0, stopOtherAudio?: true });
// NOTE: The method is playAudio({ audioUrl }), NOT playUrl(url)

// Stop all audio
session.audio.stopAudio();

// Check if audio is still playing
session.audio.hasPendingRequest(requestId?: string): boolean;
```

### LEDs (session.led) — Mentra Live Only

```typescript
// Colors: "red" | "green" | "blue" | "orange" | "white"
await session.led.turnOn({ color: "green", brightness?: number });
await session.led.turnOff();
await session.led.blink(color, onTimeMs, offTimeMs, count);
await session.led.solid(color, durationMs);
session.led.getCapabilities(); // Returns array of LED info
// LED commands are fire-and-forget
```

### Location (session.location)

```typescript
// Continuous location updates
const unsubscribe = session.location.subscribeToStream(
  { accuracy: "standard" },
  (data: LocationUpdate) => {
    // data.latitude, data.longitude, data.accuracy (meters), data.altitude?, data.timestamp
  }
);

// Single location poll (15-second timeout)
const loc = await session.location.getLatestLocation({ accuracy: "high" });

// Accuracy options: "realtime" | "high" | "tenMeters" | "standard" | "hundredMeters" | "kilometer" | "threeKilometers" | "reduced"

// Stop all updates
session.location.unsubscribeFromStream();
```

Requires `LOCATION` permission in Developer Console.

### Simple Storage (session.simpleStorage)

Persistent, cloud-synced key-value storage. User-isolated, app-scoped.

```typescript
await session.simpleStorage.set(key, value);       // Values are strings only (use JSON.stringify for objects)
const val = await session.simpleStorage.get(key);
await session.simpleStorage.hasKey(key);
await session.simpleStorage.delete(key);
await session.simpleStorage.clear();
await session.simpleStorage.keys();
await session.simpleStorage.size();
await session.simpleStorage.getAllData();
await session.simpleStorage.setMultiple({ key1: "val1", key2: "val2" });
// Limits: ~1MB per value, ~10MB total per user
// Local caching for fast reads
```

### Device Capabilities (session.capabilities)

```typescript
// Detect hardware at runtime
if (session.capabilities) {
  session.capabilities.modelName;    // e.g., "Mentra Live"
  session.capabilities.hasCamera;    // true
  session.capabilities.hasDisplay;   // false for Mentra Live
  session.capabilities.hasMicrophone;
  session.capabilities.hasSpeaker;
  session.capabilities.hasButton;
  session.capabilities.hasLight;     // LEDs
  session.capabilities.hasIMU;
  session.capabilities.hasWifi;
}
```

### Settings (session.settings)

Settings are configured in the Mentra Developer Console.

```typescript
session.settings.get<T>(key, defaultValue?);
session.settings.has(key);
session.settings.getAll();
session.settings.onChange(handler);          // Listen for any setting change
session.settings.onValueChange<T>(key, handler);  // Listen for specific key
session.settings.fetch();                   // Force refresh from cloud
```

### Permissions

Configured in the Mentra Developer Console (not at runtime):
- `MICROPHONE` — voice input, audio chunks
- `CAMERA` — photos, video streaming
- `LOCATION` — GPS coordinates
- `BACKGROUND_LOCATION` — GPS when app inactive
- `CALENDAR` — calendar events
- `READ_NOTIFICATIONS` — phone notifications
- `POST_NOTIFICATIONS` — send notifications

### Things That Do NOT Exist in the SDK

- `session.display` — does not exist
- `session.screen` — does not exist
- `session.audio.playUrl(url)` — the correct method is `session.audio.playAudio({ audioUrl })`
- `session.camera.takePhoto()` — the correct method is `session.camera.requestPhoto()`

## Project Structure

```
suhail/
├── src/
│   ├── index.ts                        # Entry point — creates SuhailApp and calls app.start()
│   ├── app.ts                          # SuhailApp class (extends AppServer) — session handling, event routing, listening mode, mini app API
│   ├── commands/
│   │   ├── base-command.ts             # AbstractCommandHandler — shared try/catch, photo capture, error speech
│   │   ├── command-router.ts           # LLM intent classification (OpenRouter) + keyword fallback
│   │   ├── scene-summarize.ts          # "Describe my surroundings" -> photo -> face recognition -> vision LLM (with names) -> speak
│   │   ├── ocr-read-text.ts            # "Read this text" -> photo -> vision LLM OCR -> speak
│   │   ├── face-recognize.ts           # "Who is this?" -> photo -> multi-face AWS Rekognition -> speak all names
│   │   ├── face-enroll.ts              # "Enroll this person" -> photo -> ask name -> save (stateful, 2-step)
│   │   ├── find-object.ts              # "Find my keys" -> photo -> object detection -> speak location
│   │   ├── currency-recognize.ts       # "Count money" -> photo -> vision LLM -> speak denomination
│   │   ├── visual-qa.ts                # Any question -> photo + question -> vision LLM -> speak answer
│   │   └── color-detect.ts             # "What color is this?" -> photo -> color analysis -> speak color
│   ├── services/
│   │   ├── ai-handler.ts               # AIHandler class — unified facade that routes to specific services
│   │   ├── vision-service.ts           # OpenRouter/Gemini vision calls (scene, VQA, currency, object, color, OCR)
│   │   ├── ocr-service.ts              # OCR — delegates to vision-service.extractText()
│   │   ├── face-service.ts             # AWS Rekognition (recognition + enrollment) + local file storage
│   │   ├── tts-service.ts              # speak(), speakBilingual(), localize(), common messages
│   │   └── settings-store.ts           # Global settings store (speech speed, volume, voice preset, language)
│   ├── utils/
│   │   ├── config.ts                   # Environment variables (all from process.env with defaults)
│   │   ├── logger.ts                   # Logger class with tag-based [Tag] prefix logging
│   │   ├── image-utils.ts              # capturePhoto(session) -> base64 string (1920x1080), cropFace() for multi-face, base64 helpers
│   │   ├── transcription-filter.ts     # Validates transcriptions (rejects garbled/wrong-script text)
│   │   └── transcription-normalizer.ts # LLM-based script normalization (Arabic-script English → Latin)
│   └── types/
│       └── index.ts                    # All shared interfaces and types
├── data/
│   ├── .gitkeep
│   └── faces/
│       └── metadata.json               # Face enrollment metadata (name → faceId mappings)
├── models/                             # Face.js ML model weights (SSD MobileNet, landmark, recognition)
├── landing/                            # React + Vite landing page (separate app)
├── public/
│   └── index.html                      # Companion app — 4-tab SPA (Status, Activity, Contacts, Settings)
├── .env.example                        # Environment variable template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Architecture & Data Flow

### Request Flow (Voice Command)

```
User swipes forward -> listening mode activated (10s window)
  -> User speaks -> Mentra glasses mic -> MentraOS STT -> onTranscription(data)
    -> check data.isFinal (skip partial transcriptions)
    -> check confidence >= MIN_CONFIDENCE (reject low-confidence)
    -> validate transcription (reject garbled/wrong-script via transcription-filter)
    -> normalize script if needed (Arabic-script English → Latin via transcription-normalizer)
    -> check pending face enrollment (intercept if waiting for name)
    -> routeCommand(data.text) -> LLM intent classification (2s timeout) or keyword fallback
    -> handlers[command].execute(session, params)
      -> speakBilingual(session, messages.processing)  // "Processing..."
      -> capturePhoto(session)                          // Camera -> Buffer -> base64
      -> ai.someMethod(base64Image)                     // AI service call
      -> speak(session, result)                         // Speak result to user
```

### Request Flow (Button Press)

Mentra Live has **2 physical buttons** ("left" and "right"/"camera") plus a swipe pad. Gesture/button mappings:

- **Forward swipe** → Activate listening mode (~10s window for next voice command)
- **Backward swipe** → Repeat last response
- **Left short press** → Interrupt current operation + return to listening mode
- **Left long press** → Repeat last response
- **Right/camera button** → Reserved (triggers native camera hardware)

```
User swipes forward on swipe pad -> onTouchEvent(event)
  -> gesture_name="forward_swipe" -> activate listening mode
  -> next transcription is processed as a command (no wake word needed)
```

### Command Handler Pattern

Most command handlers extend `AbstractCommandHandler` (from `base-command.ts`), which provides:
- Automatic try/catch with error speech
- Photo capture with 5-second timeout
- Pre-capture photo fallback (uses pre-captured photo from listening mode if available, with 3s await timeout)
- "Got it" / "حسناً" feedback is spoken by `app.ts` before the handler is called

Subclasses only need to implement the `process(session, photo, params)` method:

```typescript
abstract class AbstractCommandHandler implements CommandHandler {
  abstract process(session: AppSession, photo: string, params?: Record<string, string>): Promise<void>;
}
```

The only exception is `face-enroll.ts`, which implements `CommandHandler` directly due to its stateful 2-step flow.

Standard handler flow (handled by `AbstractCommandHandler`):
1. `app.ts` speaks "Got it" / "حسناً" before calling the handler
2. Capture photo via `capturePhoto(session)` with 5-second timeout — uses pre-captured photo if available, returns base64 or null
3. If null, speak "Camera not available" and return
4. Call `process(session, photo, params)` — subclass logic
5. Catch errors and speak "Sorry, I couldn't process that"

### Face Enrollment (Special — Stateful, 2-Step)

Face enrollment is the only stateful command. It works across two transcriptions:

1. User says "enroll this person" → captures photo, stores in `pendingEnrollments` Map, asks "say the name"
2. User says "Abdullah" → `app.ts` checks `hasPendingEnrollment(sessionId)`, passes name to complete enrollment
3. Face is indexed into AWS Rekognition collection + photo saved to `data/faces/`

The state machine lives in `FaceEnrollCommand.pendingEnrollments: Map<sessionId, base64Photo>`.

**Enhanced safeguards:**
- **TTS echo detection** — ignores the app's own speech (e.g., "please say the person's name") being picked up by the mic
- **30-second timeout** — auto-cancels enrollment if no name is provided
- **Concurrent enrollment lock** — prevents multiple enrollments from the same session
- **Interrupt handling** — left button short press cancels the pending enrollment

## Voice Command Routing (command-router.ts)

The router uses a **hybrid approach**: LLM-based intent classification as the primary method, with keyword matching as a fallback. The user must first activate listening mode (forward swipe or left button), then speak their command within the ~10 second window.

### Primary: LLM Intent Classification
- Uses **OpenRouter API** with configurable model (default: `google/gemini-2.5-flash-lite`, via `CLASSIFICATION_MODEL` env var)
- Classifies transcription into 9 intents (8 commands + "unknown")
- **2-second timeout** — falls back to keyword matching if LLM is slow or unavailable
- Extracts parameters (object name for find-object, question text for visual-qa)
- Requires `OPENROUTER_API_KEY` — logs warning and falls back if missing

### Fallback: Keyword Matching
Used when LLM classification fails, times out, or API key is missing. Matches first word of transcription:

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

## Bilingual Support (Arabic/English)

The app supports Arabic and English via `BilingualMessage` objects:

```typescript
interface BilingualMessage { ar: string; en: string; }

// Usage
await speakBilingual(session, { ar: "جاري المعالجة...", en: "Processing..." });
// Selects language based on config.defaultLanguage (from DEFAULT_LANGUAGE env var, default: "ar")
```

Common messages are defined in `src/services/tts-service.ts` as the `messages` object: welcome, processing, cameraError, generalError, noResult, repeatNoHistory, listening, received, cancelled, didntCatch, listeningTimeout, unknownCommand, interruptedListening, permissionError.

## Services Layer

### AI Handler (ai-handler.ts)
Facade class that routes to specific services. All command handlers use this instead of calling services directly.

Methods: `describeScene()`, `describeSceneWithFaces()`, `readText()`, `recognizeFace()`, `recognizeAllFaces()`, `enrollFace()`, `listFaces()`, `deleteFace()`, `renameFace()`, `findObject()`, `recognizeCurrency()`, `answerVisualQuestion()`, `detectColor()`, `loadPersistedFaces()`

### Vision Service (vision-service.ts) — WORKING
Uses **OpenRouter API** with configurable model (default: `google/gemini-2.5-flash-lite`, via `VISION_MODEL` env var). All vision functions delegate to a shared `callVisionAPI` helper (extracted fetch boilerplate) with explicit `max_tokens` set. Handles 7 vision tasks:
- `describeScene(base64)` — scene description for blind users
- `describeSceneWithFaces(base64, knownNames)` — scene description with known face names injected into the prompt, so the LLM naturally uses names (e.g., "Abdullah is on your left") instead of generic descriptions
- `answerVisualQuestion(base64, question)` — VQA
- `recognizeCurrency(base64)` — money denomination
- `detectObject(base64, targetName)` — object location (e.g., "to your right, on the table")
- `detectColor(base64)` — dominant color name + hex
- `extractText(base64)` — OCR text extraction via vision LLM

All calls include bilingual prompt support (ar/en based on config). Images sent as base64 data URI.

### OCR Service (ocr-service.ts) — WORKING
- `extractText(base64)` — delegates to `visionService.extractText()` (vision LLM-based OCR)

### Face Service (face-service.ts) — WORKING
Uses **AWS Rekognition** with local file storage for metadata and photos:
- `recognizeFace(base64)` — search Rekognition collection, return single best match (used by face enrollment)
- `recognizeAllFaces(base64)` — detect ALL faces via `DetectFacesCommand`, crop each with `sharp`, search individually via `SearchFacesByImageCommand`. Returns `MultiFaceResult { faces: FaceMatch[], totalDetected }`. Optimizes single-face case (no cropping). Caps at 10 faces, skips tiny bounding boxes (<3% of image), runs per-face searches in parallel via `Promise.allSettled()`
- `enrollFace(name, base64)` — index face into collection + save photo to `data/faces/`
- `listFaces()` — enumerate all enrolled faces with metadata
- `deleteFace(faceId)` — remove from Rekognition + local storage
- `renameFace(faceId, newName)` — update local metadata
- `loadPersistedFaces()` — initialize/verify Rekognition collection on startup
- `getFacePhotoPath(faceId)` — get path to stored enrollment photo

Face names are hex-encoded for Rekognition's `ExternalImageId` field. Local `data/faces/metadata.json` stores the human-readable name mappings. Handles AWS credential errors gracefully (logs warning, continues).

### TTS Service (tts-service.ts) — WORKING
- `speak(session, text, sessionId?)` — wraps `session.audio.speak()` with logging + tracks last response per session
- `speakBilingual(session, message, sessionId?)` — selects language from settings store
- `getLastResponse(sessionId)` — retrieve last spoken text for repeat functionality
- `clearLastResponse(sessionId)` — cleanup on session end
- `localize(message)` — returns string for current language
- TTS now respects global settings: speech speed, volume, voice preset, and language
- TTS uses `trackId: 2` for audio track mixing — enables background audio on track 1 without blocking speech

### Settings Store (settings-store.ts) — WORKING
Persistent settings store for voice and language preferences, backed by `simpleStorage`:
- `getSettings()` — returns current settings (defensive copy)
- `updateSettings(partial)` — validates, applies, and persists to `simpleStorage` with `flush()`
- `initSettingsFromStorage(session)` — loads persisted settings on session start
- `clearSettingsSession()` — clears session reference on session end
- Settings: `speechSpeed` (0.5–2.0), `volume` (0.0–1.0), `voicePreset` ("default" | "male" | "female"), `language` ("ar" | "en")
- All values are validated and clamped to valid ranges
- Defaults read from `DEFAULT_LANGUAGE` env var; all other defaults are hardcoded
- Settings persist across server restarts via `session.simpleStorage` + `flush()`

## Environment Variables

Defined in `src/utils/config.ts`, loaded from `.env` (local) or Railway dashboard (production):

| Variable | Purpose | Default |
|----------|---------|---------|
| `PACKAGE_NAME` | MentraOS app identifier | `com.suhail.assistant` |
| `MENTRAOS_API_KEY` | MentraOS authentication | (empty) |
| `PORT` | Server port | `3000` |
| `OPENROUTER_API_KEY` | OpenRouter API — vision + LLM intent classification | (empty) |
| `AWS_REGION` | AWS region for Rekognition | `us-east-1` |
| `AWS_REKOGNITION_COLLECTION_ID` | Face collection ID in Rekognition | `suhail-faces` |
| `AWS_ACCESS_KEY_ID` | AWS credentials (used implicitly by AWS SDK) | (empty) |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials (used implicitly by AWS SDK) | (empty) |
| `DEFAULT_LANGUAGE` | Response language ("ar" or "en") | `ar` |
| `CONFIDENCE_THRESHOLD` | Min confidence for face recognition results | `0.5` |
| `MIN_CONFIDENCE` | Min confidence for transcription filtering | `0.55` |
| `VISION_MODEL` | OpenRouter model for vision tasks | `google/gemini-2.5-flash-lite` |
| `CLASSIFICATION_MODEL` | OpenRouter model for intent classification | `google/gemini-2.5-flash-lite` |

## Current State of the Project

All core features are **fully implemented** with real AI backends. The app is production-ready.

### What's Done
- Full MentraOS SDK integration (AppServer, sessions, events, camera, audio)
- **LLM-based command routing** with keyword fallback (Arabic + English)
- **Listening mode** with state machine (idle → active → processing), timeouts, and echo guard
- Button press + swipe gesture handling with interrupt support
- All 8 command handlers with real AI backends
- **Vision services** — OpenRouter/Gemini for scene description, VQA, currency, object detection, color, OCR
- **Face recognition** — AWS Rekognition with persistent storage (collection + local files). Supports **multi-face detection** (DetectFaces + per-face crop via `sharp` + SearchFacesByImage). Scene summarization integrates face recognition to mention known people by name
- **Face enrollment** — stateful 2-step flow with TTS echo detection, timeouts, and concurrency locks
- Bilingual TTS (Arabic/English) with repeat-last-response support
- Transcription filtering (garbled text, wrong script, low confidence)
- Transcription normalization (Arabic-script English → Latin via LLM)
- **Companion app** — 4-tab SPA (Status, Activity, Contacts, Settings) at `/webview`
- **Settings persistence** — voice speed, volume, voice preset, language persisted via `simpleStorage` + `flush()` (survives restarts)
- **Device state tracking** — battery, case battery, charging, WiFi status via reactive `device.state` observables, exposed via `/api/status`
- **Permission error handling** — `onPermissionError()` speaks a warning when camera/mic permissions are missing
- **Audio track mixing** — TTS uses dedicated `trackId: 2`, leaving track 1 available for background audio
- **High-resolution photos** — all camera captures use `"large"` (1920x1080) for accuracy without the long upload latency of `"full"`
- **Structured activity log** — enriched with type, command, result fields
- **Face enrollment timestamps** — `enrolledAt` field on face metadata
- **Landing page** — React + Vite app in `landing/`
- Logger, config, image utils

### SDK Features Not Yet Used (Available for Future Use)
- `session.led` — LED feedback (e.g., blink green when processing, red on error)
- `session.location` — GPS-aware features (e.g., "where am I?")
- `session.capabilities` — Runtime hardware detection
- `session.events.onHeadPosition()` — Trigger actions on head up/down
- `session.events.onPhoneNotifications()` — Read phone notifications aloud
- Video streaming via `session.camera.startManagedStream()`

## Listening Mode (app.ts)

The app uses a **listening state machine** to prevent accidental command triggers from background conversation:

### States
- **idle** — Not listening. Transcriptions are ignored.
- **active** — Listening window open (~10 seconds). Next valid transcription is processed as a command.
- **processing** — Command received, executing handler. Returns to idle when done.

### Activation
- **Forward swipe** or **left short press** → transitions from idle to active
- Speaks "تفضل" / "Listening" cue
- Pre-captures a photo in parallel with a 3-second await timeout (optimization for faster command execution)

### Safeguards
- **10-second timeout** (`LISTENING_TIMEOUT_MS`) — auto-returns to idle if no command received
- **2-second grace period** (`LISTENING_GRACE_MS`) — ignores stale transcriptions immediately after activation (leftover audio from before the swipe)
- **TTS echo guard** (`TTS_ECHO_BUFFER_MS = 1500ms`) — marks session as "speaking" during TTS output + 1.5s buffer, so the mic doesn't pick up the app's own speech as a command
- **Confidence filtering** — rejects transcriptions below `MIN_CONFIDENCE` threshold
- **Script validation** — via `transcription-filter.ts`, rejects garbled or wrong-script text
- **Script normalization** — via `transcription-normalizer.ts`, converts Arabic-script English to Latin using LLM

### Interrupts
- Left short press during **active** or **processing** → cancels current operation, returns to listening
- Backward swipe or left long press → repeats last response (works from any state)

## Mini App API (app.ts)

The app serves REST endpoints via Express (from `AppServer.getExpressApp()`), used by the companion app at `/webview`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Online status, session count, uptime, battery, charging, case battery, case charging, WiFi connected |
| `GET` | `/api/activity` | Rolling activity log (last 20 events, structured with type/command/result) |
| `GET` | `/api/faces` | List all enrolled faces (`{ faces, count }` — each face has name, faceId, hasPhoto, enrolledAt) |
| `GET` | `/api/faces/:faceId/photo` | Download enrollment photo for a face |
| `DELETE` | `/api/faces/:faceId` | Delete an enrolled face |
| `PUT` | `/api/faces/:faceId` | Rename an enrolled face (body: `{ name }`) |
| `GET` | `/api/settings` | Get current global settings (speechSpeed, volume, voicePreset, language) |
| `PUT` | `/api/settings` | Update global settings (partial update, validated) |
| `GET` | `/webview` | Serve the companion app HTML |

The companion app is a 4-tab SPA in `public/index.html` with:
- **Home** — connection status, battery level, voice commands reference
- **Contacts** — search, view, rename, delete enrolled faces with photo cards
- **Activity** — color-coded rolling log of commands and system events
- **Settings** — speech speed slider, volume slider, voice preset, language toggle (Arabic/English with RTL)

## Rules for Contributing

1. **Audio only** — never reference displays, screens, or visual UI. All output goes through `session.audio.speak()`
2. **Always give feedback** — speak "Processing..." before any long operation, then speak the result or error
3. **Always handle camera failure** — `capturePhoto()` can return null, speak "Camera not available"
4. **Always catch errors** — every handler wraps its logic in try/catch and speaks a friendly error
5. **Extend AbstractCommandHandler** — implement `process(session, photo, params)` for standard commands. Use `CommandHandler` directly only for non-standard flows (e.g., stateful multi-step commands)
6. **Use AIHandler facade** — don't call services directly from command handlers
7. **Use speakBilingual for common messages** — define `{ ar: "...", en: "..." }` pairs
8. **Use the Logger** — `new Logger("TagName")` for consistent `[TagName]` prefixed logging
9. **Use capturePhoto()** from `utils/image-utils.ts` — it handles the SDK's `requestPhoto()`, Buffer->base64 conversion, and error handling
10. **Keep it simple** — this is a graduation project. No over-engineering.
11. **Keep `.env.example` up to date** — whenever you add, remove, or rename an environment variable in `config.ts` or anywhere in the codebase, update `.env.example` to reflect the change. This file is how teammates know which env vars they need.
12. **Keep documentation in sync** — whenever you add, remove, or change features, APIs, services, files, or project structure, update **both** `CLAUDE.md` and `README.md` to reflect the changes. These files must always match the current state of the code. Outdated docs are worse than no docs.

## Version Control Etiquette

### Branch Strategy
- **`main`** — production branch, auto-deploys to Railway. Always stable.
- **`development`** — integration branch. All feature work merges here first.
- **`feature/*`** — short-lived feature branches off `development`.

### Workflow
1. Create a feature branch off `development`: `git checkout -b feature/my-feature development`
2. Make commits with clear, descriptive messages following conventional commits (e.g., `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`)
3. Open a PR from your feature branch → `development`
4. After review and merge into `development`, test thoroughly
5. When `development` is stable and ready for release, open a PR from `development` → `main`
6. After merging to `main`, create a GitHub release with a version tag (e.g., `v1.2.0`)
7. Fast-forward `development` to match `main` after the merge: `git checkout development && git merge main --ff-only`

### Commit Messages
Use **conventional commit** format:
- `feat: add new command for X` — new feature
- `fix: handle null camera response` — bug fix
- `docs: update CLAUDE.md with new API endpoints` — documentation only
- `chore: add .superpowers/ to gitignore` — maintenance, no code change
- `refactor: extract photo capture into utility` — code restructure, no behavior change

### Versioning (Semantic Versioning)
- **Major** (`v2.0.0`) — breaking changes, major rewrites
- **Minor** (`v1.1.0`) — new features, backward-compatible
- **Patch** (`v1.0.1`) — bug fixes, small improvements

### Rules
- Never force-push to `main` or `development`
- Never commit directly to `main` — always go through a PR
- Always ensure `development` and `main` are in sync after a release (fast-forward merge)
- Run `bun run typecheck` before opening a PR
- Keep PRs focused — one feature or fix per PR, not kitchen-sink merges
- Delete feature branches after they are merged

## Adding a New Command

1. Create `src/commands/my-command.ts` extending `AbstractCommandHandler` (from `base-command.ts`). You only need to implement the `process(session, photo, params)` method — the base class handles try/catch, photo capture (with 5s timeout), pre-capture fallback, and error speech. Use `CommandHandler` directly only if your command has a non-standard flow (like face enrollment's 2-step state machine)
2. Add the command type to `CommandType` union in `src/types/index.ts`
3. Add keyword route to `routes[]` array in `src/commands/command-router.ts`
4. Register the handler in `this.handlers` map in `src/app.ts` constructor
5. Optionally add a button mapping in `handleButtonPress()` in `src/app.ts`
6. If it needs a new AI service, add it to `src/services/` and expose through `AIHandler`

## Commands Quick Reference

```bash
bun install           # Install dependencies
bun run start         # Start server
bun run dev           # Start with --watch (auto-restart)
bun run typecheck     # TypeScript type checking
ngrok http 3000       # Expose local server (needed for Mentra connection in local dev)
```
