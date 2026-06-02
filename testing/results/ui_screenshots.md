# UI screenshots — Figures 31–34 (capture manually on device/simulator)

These four figures are screenshots of the running companion app. They are **not generated**
here — capture them on a real device or simulator so they reflect the shipped UI. The screens
are built from the centralized WCAG theme (`mobile/src/theme/`); capture in the default **dark**
theme at the default text scale unless the report says otherwise.

## Build & run the app (from `mobile/`)

```bash
cd mobile
bun install                         # installs deps + applies patches/ (bun only — not npm/yarn)
cp .env.example .env                # then set EXPO_PUBLIC_RELAY_BASE_URL + EXPO_PUBLIC_RELAY_SHARED_SECRET
bunx expo prebuild --clean          # one-time: generate native projects
bun run ios                         # build + run on a Mac + iPhone/simulator   (or:)
bun run android                     # build + run on a connected Android device
```

iOS needs a Mac; Expo Go does **not** work (the BLE SDK needs native modules). A simulator is
fine for the four UI screens below — none of them requires a paired glasses connection to render
(the Home status hero just shows a disconnected state without glasses).

## The four screens

| Figure | Screen | Source | How to reach it | What it should show |
|---|---|---|---|---|
| **31** | Home | `mobile/src/screens/HomeScreen.tsx` | Default tab after onboarding | Status hero (connection + battery), listening indicator, voice-commands reference list |
| **32** | Contacts | `mobile/src/screens/ContactsScreen.tsx` | Bottom tab → Contacts | Enrolled faces list (name + photo), with the rename/delete affordances; capture with ≥1 enrolled face if possible |
| **33** | Settings | `mobile/src/screens/SettingsScreen.tsx` | Bottom tab → Settings | Voice output (speed/volume/voice/language) + Appearance (theme, text size) + the Testing entry |
| **34** | Onboarding | `mobile/src/screens/OnboardingScreen.tsx` | First launch, or clear `suhail-onboarding` MMKV / reinstall | Welcome → permissions → pair → done wizard (capture the welcome step) |

> Figure→screen numbering follows the report's "Home, Contacts, Settings, Onboarding" order;
> confirm against the report body if the exact numbers differ.

## Capture tips

- Use the device/simulator screenshot (iOS Simulator: ⌘S; Android emulator: camera button).
- For VoiceOver/TalkBack-relevant figures, the report may also want a screenshot with the
  screen reader focus ring visible — note which, if any, the report calls for.
- Save the PNGs into the report's figures directory (this repo does not store binaries for them).
