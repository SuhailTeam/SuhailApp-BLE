# Suhail Mobile (BLE)

React Native / Expo app that talks directly to Mentra Live glasses over Bluetooth LE and to the Railway relay (this repo's `src/`) over HTTPS for AI inference.

See [`mobile/CLAUDE.md`](./CLAUDE.md) for architecture, contracts, and phased status. The root [`CLAUDE.md`](../CLAUDE.md) covers the server side.

## Prerequisites

- **Node + bun** — `curl -fsSL https://bun.sh/install | bash`
- **Expo CLI** — installed as a devDependency; invoke with `bunx expo …`
- **Android**: Android Studio + USB debugging on a real device (Mentra Live needs real BLE — simulators don't have it)
- **iOS** *(optional, only if you have a Mac)*: Xcode + a real iPhone. Free Apple ID works for sideloading (re-sign every 7 days); $99/year Apple Developer Program for TestFlight / longer provisioning.
- **EAS account** — required for cloud builds (`bunx eas-cli login`), or use local builds via `expo run:android` / `expo run:ios`.

## First-time setup

```bash
cd mobile
bun install            # also applies patches/ via bun's "patchedDependencies"
cp .env.example .env
# Fill in EXPO_PUBLIC_RELAY_BASE_URL and EXPO_PUBLIC_RELAY_SHARED_SECRET
```

> **Note on package manager.** This project uses bun, including for `patchedDependencies` (in `package.json`) which bun applies automatically on install. If you use npm or yarn, patches will silently NOT apply and iOS builds will fail on iOS 26.5+ (see [Known iOS gotchas](#known-ios-gotchas) below).

## Run locally (development build)

The BLE SDK requires native modules, so **Expo Go does not work**. You need a development build.

```bash
# One-time per app: generate native projects
bunx expo prebuild --clean

# Android (device connected via USB)
bun run android

# iOS (Mac only)
bun run ios

# Start Metro dev server separately
bun run start
```

Once a dev build is installed on your device, future code changes hot-reload over Metro — you only need to rebuild when native dependencies change.

## Known iOS gotchas

These bit us during the first iOS build (Mentra Live + iPhone on iOS 26.5). They're all on the iOS toolchain / phone side, not the app, so they need a one-time fix per machine/device.

| Symptom | Fix |
|---|---|
| `xcodebuild` error: `iOS <version> is not installed` | Open Xcode → **Settings → Components** and install the matching simulator/platform support. |
| Build succeeds but won't launch from Xcode: device not eligible | iPhone: **Settings → Privacy & Security → Developer Mode** → enable, reboot when prompted. |
| `expo-localization/ios/LocalizationModule.swift:93: switch must be exhaustive` (Swift compile error on iOS 26.5+) | **Handled in this repo** — `patches/expo-localization@16.0.1.patch` adds an `@unknown default` case. Bun applies it automatically on `bun install`. If you switch to npm/yarn the patch will NOT apply. |
| After install: `Unable to launch ... invalid code signature` | iPhone: **Settings → General → VPN & Device Management** → tap your developer profile → Trust. |
| Metro: `Unable to resolve "@mentra/bluetooth-sdk/react"` | **Handled in this repo** — `metro.config.js` enables `config.resolver.unstable_enablePackageExports = true`. If Metro caches an older config, clear it: `bunx expo start --dev-client -c`. |
| `expo run:ios` warns `Unexpected devicectl JSON version` on Xcode 26 | Non-fatal. Pass the hardware UDID (from `xcrun devicectl list devices` → "Identifier" column on the row with the iPhone, format `00008150-…`) explicitly: `bunx expo run:ios --device 00008150-…`. Don't use the CoreDevice UUID — different field. |
| `bunx expo prebuild --clean` fails at `withAndroidIcons` with `ENOENT ./assets/icon.png` | iOS-only build: `bunx expo prebuild --clean --platform ios`. The Android adaptive icon block was removed in this repo until we have a real Android target — re-add to `app.config.ts` once an icon asset exists. |

## Known relay gotchas

| Symptom | Fix |
|---|---|
| `/api/tts` returns HTTP 402 "Free users cannot use library voices via the API." | ElevenLabs Free tier blocks stock voices (Rachel / Adam) via API. Either upgrade to **Starter** ($6/mo) or clone a custom voice on Free and set `ELEVENLABS_DEFAULT_VOICE_ID` to its ID. See root `.env.example`. |
| Server logs spam `Frontend token verification failed: Invalid frontend token format` on every relay request | **Cosmetic, harmless.** The MentraOS SDK's webview-token middleware runs on every request the AppServer's Express handles, and complains when our `/api/*` calls don't carry its token (they don't need to — we authenticate via `X-Device-Id` + HMAC Bearer in `src/relay/auth.ts`). Relay requests succeed normally. To silence later we'd need to either filter the SDK's logger or move the relay to its own Express app — neither is worth the churn pre-Phase D. |

## EAS cloud builds (one-time setup)

```bash
bunx eas-cli login
bunx eas-cli init                  # links the project to an EAS slug
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

Builds land as install URLs. Forward to teammates. iOS requires a paid Apple Developer Program for `--distribution internal` outside the seven-day free tier.

## What works today (Phase B)

- BLE scan, connect, disconnect, forget — Mentra Live model only
- MMKV-backed settings (language, voice, speed, volume)
- Auto-reconnect to last-paired device on launch
- Activity log shows button presses, swipes, battery events from the glasses (debug observers)
- 4-tab navigation: Home / Contacts / Activity / Settings
- Relay HTTPS client with HMAC auth
- Contacts screen fetches enrolled faces from the relay

## What does NOT work yet

- Voice command flow (mic streaming → STT → intent → vision → TTS) — Phase C
- Any of the 8 voice commands — Phase D
- TTS playback through the glasses speaker — Phase C
- Photo capture flow — Phase D (needs decision on the webhook URL pattern)
- Onboarding / pairing wizard — Phase E

## Verifying

```bash
bun run typecheck            # tsc --noEmit, must be clean before any PR
```

There's no test suite yet — integration is hardware-tested. When you add unit-testable logic (state machines, helpers), add tests then.
