# TODO

> Handoff for the next Claude session working on the BLE rewrite of Suhail.

## Current state (as of 2026-05-26, post-PR #16)

- **8 of 8 voice commands shipped + hardware-verified** on iPhone 17 Pro Max / iOS 26.5
- **Phase C complete** — feature parity with the cloud app's command surface
- 16 PRs merged into `development` (see `gh pr list --state merged --limit 16`)
- Cloud Suhail on `main` is unchanged and still works

Stack reminder:
```
glasses (Mentra Live)  ←BLE→  mobile (RN/Expo, iOS verified)  ←HTTPS→  Railway relay (src/, on local Mac + ngrok during dev)
```

## Read this first

1. [`CLAUDE.md`](CLAUDE.md) — root, cloud/Railway side
2. [`mobile/CLAUDE.md`](mobile/CLAUDE.md) — mobile side + commands status + photo flow + audio pipeline
3. `~/.claude/plans/i-want-you-to-curried-steele.md` — original research + phased plan (verification criteria at the bottom)
4. Recent PRs in order: `gh pr list --state merged --limit 16`

## Quick wins (do first, free or near-free)

- [ ] **Delete orphan `(knocks on table)` face** from PR #15 testing. It'll false-match in who-is-this. Either via the Contacts tab in the mobile app, OR:
  ```bash
  curl -X DELETE https://<ngrok>/api/faces/9fef7182-9213-4bab-a87b-613e439d7cb1
  ```

## Tier 1 — Demo-stage critical (the only things that could embarrass you live)

- [ ] **Graceful glasses-disconnect handling.** Plan-doc criterion: *"Glasses disconnect mid-session → app reconnects automatically; in-flight command fails gracefully with a spoken error."* Today: auto-reconnect on launch works, but a mid-command BLE drop hangs the command until the 25s `CAPTURE_TIMEOUT_MS` instead of speaking an error. **~2 hours.** Touch points:
  - `mobile/src/ble/camera.ts` — race a BLE-disconnect signal alongside the existing wait/error/timeout
  - `mobile/src/ble/connection.ts` — surface a `disconnected` observable
  - `mobile/src/state/listening.ts` — cancel paths already abort; just need to also wire disconnect → cancel + speak error

- [ ] **Onboarding wizard for first-launch pairing.** New users get dropped into Home with a "Scan for glasses" button. A 30s guided flow (welcome → permission grants → pair → done) matters for non-Suhail-team users. Touch points:
  - Add `mobile/src/screens/OnboardingScreen.tsx`
  - Check a `hasOnboarded` flag from MMKV at app boot, redirect

- [ ] **Sub-5s latency** (plan target was ≤5s; we're at ~6-10s). Biggest remaining levers:
  - **TTS streaming server→mobile**: ~500-800ms shaved. Server pipes ElevenLabs `/stream` bytes through to the mobile player as they arrive. ~2 hours. See PR #8 for the architectural notes.
  - **On-device STT** (whisper.cpp): ~1s saved + eliminates per-command Scribe credit burn. ~150MB model bundle. Bigger project.

## Tier 2 — Production hygiene (cheap, high value)

- [ ] **Pre-bundled WAVs for ~18 static phrases** (`didntCatch`, `unknownCommand`, all 8 routed-command messages × 2 langs, enrollment success/failure templates). Zero latency for those, big cut in TTS spend. ~30 min. Pattern: same as `mobile/scripts/generate-cues.ts` + bundle into `mobile/assets/`.

- [ ] **LC3 audio compression on mobile.** PR #14 bumped the JSON body limit to dodge HTTP 413, but a better fix is to never send a 100KB+ JSON in the first place. Check if `@mentra/bluetooth-sdk` 0.1.6 exposes `mic_lc3` events (it does, per `BluetoothSdk.types.d.ts`). ~3× smaller STT payloads, ~200-400ms less network time.

- [ ] **Port `src/utils/timeline.ts` perf instrumentation to mobile.** Plan-doc criterion: *"Audio latency measurements documented."* We're eyeballing today. The cloud version already has session-level span tracking — copy it. Gives real numbers instead of "feels faster."

- [ ] **ContactsScreen CRUD.** Currently just lists enrolled faces. The relay already exposes PUT/DELETE for rename + delete; mobile just needs the UI. ~40 LOC. See `mobile/src/screens/ContactsScreen.tsx`.

- [ ] **Per-device rate limiting.** `(req as any).deviceId` is set on every relay request but unused. Would matter if the relay ever goes public.

## Tier 3 — Distribution

- [ ] **TestFlight setup + Apple Developer Program** ($99/year). Needed for anyone outside the dev iPhone to install. Free Apple ID works for personal sideloading but re-signs every 7 days.
- [ ] **Sentry / crash reporting.** No visibility if the app crashes on someone else's phone.

## Tier 4 — Real future work

- [ ] **`/api/tts/token` + ElevenLabs Conversational AI streaming.** The "Option A" from the original research doc — one WebSocket does STT + TTS in one round-trip. Big refactor of `mobile/src/audio/tts.ts` + `mobile/src/state/listening.ts` audio path. Latency win is significant if it works.
- [ ] **Auto-listen after enrollment step 1 prompt.** Today: user swipes twice (one to enroll, one to say the name). Cloud is always-listening so it's one swipe. The 1.5s TTS echo-guard window swallows fast responses — needs more design.
- [ ] **Cloud↔BLE feature drift.** If cloud Suhail ships features on `main`, mirror them here.

## Out of scope (don't do these)

- ❌ **Android.** Out of scope for this milestone. The `android.*` block in `app.config.ts` and the Android permissions are kept so the codebase doesn't regress, but no Android-specific work, no `bun run android` testing, no Android-only fixes. iOS-only until further notice.

## How to ship a slice

1. **Branch from `development`:**
   ```bash
   git checkout development && git pull --ff-only
   git checkout -b feature/<name>
   ```
2. **Implement.** Match the patterns in `mobile/src/commands/*.ts` (8 worked examples), `mobile/src/state/*.ts`, or `src/relay/routes.ts`.
3. **Typecheck both halves:**
   ```bash
   bun run typecheck        # server
   cd mobile && bun run typecheck    # mobile
   ```
4. **Commit + push + PR** with a hardware test plan in the body. Single-trial each test; cost-aware (see below).
5. **Hardware verification** — the user runs Mac-Claude on the iPhone-attached Mac. They paste the report back; address findings before merge.
6. **Merge** when PASS. Pull `development` locally. Delete the branch.

## Cost watch

User is on **ElevenLabs Starter ($6/mo, ~30k credits/month)**. Watch the server log:
```bash
grep '\[Cost\]' suhail.log
```
- STT (Scribe): ~1.6 credits per second of audio
- TTS (Flash v2.5): 0.5 credits per character
- A full describe cycle ≈ ~100 credits
- A full enroll cycle ≈ ~150 credits

Single-trial testing keeps a hardware session under ~700 credits. Loop tests for averaging eat credits fast. The startup `[Cost] OpenRouter status:` line shows remaining OpenRouter spend (separate budget, ~$0.0003 per intent call, basically free).

## What NOT to do

- Don't merge without `bun run typecheck` on both halves
- Don't break cloud Suhail (`main` branch) — it still runs in production for cloud users
- Don't ship without a hardware test pass on iOS for any user-visible change
- Don't loop hardware tests for latency averaging — cost concern
- Don't add features to Android (see Out of scope)
- Don't add things to `.env.example` without keeping the comments current — that file is how teammates know what env vars they need
- Don't generate text/code with emojis unless explicitly asked (project convention)

## Key gotchas to remember

- **BLE SDK 0.1.6 photo bug**: `photo_response` `state="success"` never fires from iOS — see `mobile/src/services/photo-cache.ts` `waitForBytes` for the long-poll workaround
- **Mount order matters in `src/relay/routes.ts`**: unauth `/api/photo/upload/:token` must register BEFORE the auth router or glasses get 401 (PR #16 commit message has the story)
- **OpenRouter Free tier** returns `total_credits: 0` from `/credits` — startup probe renders that as `"free-tier, no $ limit"`, don't break that branch
- **Annotation strip** lives in two places now (`src/utils/transcription-filter.ts` server + `mobile/src/utils/transcription-filter.ts`) — keep them in sync; mobile's version is needed for the enrollment-name path that bypasses `/api/intent`
- **Pre-capture promise** in `mobile/src/state/listening.ts` is module-level; nulled on every dispatch + cancel. If you add a new command type, take `preCapture` in its opts and use `resolvePhoto` not `capturePhoto`
- **MentraOS SDK webview-token stack traces** in the server log on every relay request are cosmetic — documented in `mobile/README.md`

## Stuck? Where to look

- A command isn't routing → `src/commands/command-router.ts` (LLM prompt + keyword fallback)
- TTS sounds wrong → `src/services/elevenlabs-tts.ts` + `mobile/src/audio/tts.ts`
- STT failing → check `[Cost] STT` log line, then `src/services/elevenlabs-stt.ts`
- Photo flow broken → `src/services/photo-cache.ts` + `mobile/src/ble/camera.ts`
- BLE event missing → grep `BluetoothSdk.addListener` in mobile/; the events are typed in `node_modules/@mentra/bluetooth-sdk/build/BluetoothSdk.types.d.ts`
- Settings not persisting → `mobile/src/state/settings.ts` (MMKV)
- Listening state machine confusion → `mobile/src/state/listening.ts` is the source of truth; cloud equivalent is `src/app.ts:62-68, 252-325`
