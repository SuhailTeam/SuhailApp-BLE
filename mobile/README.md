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
bun install
cp .env.example .env
# Fill in EXPO_PUBLIC_RELAY_BASE_URL and EXPO_PUBLIC_RELAY_SHARED_SECRET
```

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
