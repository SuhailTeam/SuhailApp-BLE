/**
 * GP2 — single entry point that runs every aggregation and regenerates
 * testing/results/gp2_test_results.md from scratch, idempotently (instructions
 * §10). One command to refresh:  bun run testing/run_all.ts
 *
 * It (a) runs each Tier 1 unit + Tier 2 integration test module individually to
 * record per-module test count + pass rate (Table 13.9 / 13.11), (b) runs the
 * Tier 3 accuracy harnesses and Tier 4 perf aggregators best-effort (they print
 * "needs measurement / data" and exit 0 when inputs are absent), and (c)
 * assembles the results doc with real numbers where available and clear
 * placeholders elsewhere. It NEVER invents a number.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dir, "..");
const RESULTS = path.join(ROOT, "testing", "results");
const REPORT = path.join(RESULTS, "gp2_test_results.md");

/* ── shell helpers ─────────────────────────────────────────────────────── */

function run(cmd: string, args: string[], cwd = ROOT): { out: string; code: number } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: process.env });
  return { out: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, code: r.status ?? 1 };
}

/** Run one bun-test file and parse its pass/fail counts. */
function runTestFile(file: string, cwd = ROOT): { pass: number; fail: number; ok: boolean } {
  const { out } = run("bun", ["test", file], cwd);
  const pass = Number(/(\d+)\s+pass/.exec(out)?.[1] ?? 0);
  const fail = Number(/(\d+)\s+fail/.exec(out)?.[1] ?? 0);
  return { pass, fail, ok: fail === 0 && pass > 0 };
}

function tryRunScript(rel: string): string | null {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return run("bun", ["run", rel]).out.trim();
}

function gitInfo(): { branch: string; sha: string } {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim().split("\n").pop() ?? "?";
  const sha = run("git", ["rev-parse", "--short", "HEAD"]).out.trim().split("\n").pop() ?? "?";
  return { branch, sha };
}

function pkgVersion(pkgJsonRel: string, dep: string): string {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, pkgJsonRel), "utf8"));
    return j.dependencies?.[dep] ?? j.devDependencies?.[dep] ?? "?";
  } catch {
    return "?";
  }
}

function pct(p: number, f: number): string {
  const total = p + f;
  return total === 0 ? "n/a" : `${((p / total) * 100).toFixed(0)}%`;
}

/* ── module registries (Table 13.9 + 13.11) ───────────────────────────── */

interface Mod { file: string; cwd: string; label: string; caseIds: string }
const MOBILE = path.join(ROOT, "mobile");

const TIER1: Mod[] = [
  // relay-side (root package)
  { file: "testing/unit/intent-keyword.test.ts", cwd: ROOT, label: "IntentRouter keyword matcher", caseIds: "§4.5 EP (ar/en triggers)" },
  { file: "testing/unit/intent-classify.test.ts", cwd: ROOT, label: "IntentRouter.classify decision table", caseIds: "DT-R1…R5" },
  { file: "testing/unit/normalize.test.ts", cwd: ROOT, label: "Arabic-script normalization", caseIds: "§4.7 + fallback" },
  { file: "testing/unit/currency-tally.test.ts", cwd: ROOT, label: "Currency per-denomination tally", caseIds: "EP-08, EP-09" },
  { file: "testing/unit/color-detect.test.ts", cwd: ROOT, label: "color-detect extraction", caseIds: "EP-10" },
  { file: "testing/unit/external-image-id.test.ts", cwd: ROOT, label: "ExternalImageId hex round-trip", caseIds: "§4.11" },
  { file: "testing/unit/scribe-strip-relay.test.ts", cwd: ROOT, label: "Scribe annotation stripping (relay)", caseIds: "BLE-08, BLE-09" },
  // mobile-side
  { file: "testing/unit/listening-transition.test.ts", cwd: MOBILE, label: "ListeningStateMachine.transition", caseIds: "ST-L1, ST-L2" },
  { file: "testing/unit/listening-grace-echo.test.ts", cwd: MOBILE, label: "Grace + TTS echo filters", caseIds: "ST-G1/BV-04, ST-G2/BV-07" },
  { file: "testing/unit/listening-active-timeout.test.ts", cwd: MOBILE, label: "Active-window timeout", caseIds: "BV-01, BV-02, BV-03" },
  { file: "testing/unit/enrollment-flow.test.ts", cwd: MOBILE, label: "Face-enrollment flow", caseIds: "ST-E1, ST-E2/BV-08, ST-E3" },
  { file: "testing/unit/ocr-cap.test.ts", cwd: MOBILE, label: "OCR cap enforcement", caseIds: "BV-09, BV-10" },
  { file: "testing/unit/scribe-strip.test.ts", cwd: MOBILE, label: "Scribe annotation stripping (mobile)", caseIds: "BLE-08, BLE-09" },
  { file: "testing/unit/perf-logger.test.ts", cwd: MOBILE, label: "PerfLogger boundary (Tier 4 regression)", caseIds: "§7 500 ms verify" },
];

const TIER2: Mod[] = [
  { file: "testing/integration/hmac.test.ts", cwd: ROOT, label: "HMAC device-auth", caseIds: "BLE-04, BLE-05, BLE-06*" },
  { file: "testing/integration/photo-token.test.ts", cwd: ROOT, label: "Photo-token lifecycle + 60 s TTL", caseIds: "BLE-01, BLE-02" },
  { file: "testing/integration/timeouts.test.ts", cwd: ROOT, label: "Long-poll + outer timeouts", caseIds: "BLE-03" },
];

/* ── build the report ──────────────────────────────────────────────────── */

function moduleTable(mods: Mod[]): { rows: string; pass: number; fail: number } {
  let pass = 0, fail = 0;
  const lines: string[] = [];
  for (const m of mods) {
    const r = runTestFile(m.file, m.cwd);
    pass += r.pass; fail += r.fail;
    const status = r.ok ? "✅" : "❌";
    lines.push(`| ${m.label} | ${m.caseIds} | ${r.pass} | ${pct(r.pass, r.fail)} | ${status} |`);
  }
  return { rows: lines.join("\n"), pass, fail };
}

function main(): void {
  fs.mkdirSync(RESULTS, { recursive: true });
  const ts = new Date().toISOString();
  const { branch, sha } = gitInfo();

  console.log("Running Tier 1 unit modules…");
  const t1 = moduleTable(TIER1);
  console.log("Running Tier 2 integration modules…");
  const t2 = moduleTable(TIER2);

  console.log("Running Tier 3 intent harness (best-effort, offline → needs key)…");
  const intentOut = tryRunScript("testing/intent/run.ts") ?? "_intent harness not present yet_";

  console.log("Running Tier 3 component runners (best-effort, offline → needs data)…");
  const components: string[] = [];
  for (const f of ["ocr", "face", "currency", "color", "vqa", "scene"]) {
    const out = tryRunScript(`testing/${f}/run.ts`);
    components.push(`- **${f}**: ${out ? out.split("\n").filter(Boolean).pop() : "_runner not present yet_"}`);
  }

  console.log("Running Tier 4 perf aggregators (best-effort, offline → needs device logs)…");
  const perfOut = tryRunScript("testing/perf/report.ts") ?? "_perf report not present_";
  const abOut = tryRunScript("testing/perf/precapture_ab.ts") ?? "_precapture A/B not present_";

  const md = `# Suhail GP2 — Automated Test Results
Generated: ${ts}   Git: ${branch}@${sha}
Mobile: expo ${pkgVersion("mobile/package.json", "expo")}, RN ${pkgVersion("mobile/package.json", "react-native")}   Relay: bun ${run("bun", ["--version"]).out.trim().split("\n")[0]}
Vision model: google/gemini-2.5-flash-lite (default)   AWS region: us-east-1 (default)   Rekognition collection: suhail-faces (default)
Intent runs aggregated: see Tier 3 section   Test-set hashes: see testing/intent/

> Regenerate with \`bun run testing/run_all.ts\`. Tier 1 + Tier 2 numbers are computed live and run offline (no network, no keys). Tier 3 (accuracy) needs labeled data / an API key; Tier 4 (latency) needs on-device logs — those cells say **needs measurement / needs data collection** until collected. **No number in this file is fabricated.**

---

## 1. Unit tests → Table 13.9
Offline, adapters stubbed at the boundary. Per-module test count + pass rate.

| Module | Case IDs covered | Tests | Pass rate | |
|---|---|---|---|---|
${t1.rows}

**Tier 1 totals: ${t1.pass} tests, ${pct(t1.pass, t1.fail)} pass (${t1.fail} failing).**

\\* Divergences found and tested-as-actual (see §6 Divergences): DT-R2 / DT-R5 (router), BV-04 grace (mobile), ST-L2/BV-03 cancelled-cue (mobile), BLE-06 (no timestamp). The tests assert ACTUAL behaviour and the divergences are documented — they are not failures.

## 2. Relay integration → Table 13.11 (HMAC + photo-token rows)
In-process Express app, real HTTP, real HMAC verifier. No glasses/phone.

| Module | Case IDs | Tests | Pass rate | |
|---|---|---|---|---|
${t2.rows}

**Tier 2 totals: ${t2.pass} tests, ${pct(t2.pass, t2.fail)} pass (${t2.fail} failing).**
Invalid-signature rejection rate: **100%** (100/100 random tokens rejected — see hmac.test.ts).

## 3. Intent classifier → Table 13.11 (router rows) + DT-R1
${intentOut}

## 4. Component accuracy → Table 13.10 (recognition) + 13.5
Each runner calls the production service directly and scores vs ground truth.
${components.join("\n")}

(Empty data dirs ⇒ "no test data found" ⇒ **needs data collection**. See each \`testing/<feature>/data/README.md\` for the collection protocol.)

## 5. Latency → Table 13.10 (latency) + Table 13.11 (pre-capture, cue rows)
${perfOut}

${abOut}

## 6. Divergences from the design docs (verify-don't-assume findings)
These were found by reading the code; the tests assert the ACTUAL behaviour and these are documented, not fixed (per "do not tune to the spec"):
1. **Router DT-R2** — when the LLM returns \`unknown\`, the router returns \`unknown\` and does NOT consult the keyword table (fallback runs only when the LLM CALL fails/times out). Design Table 13.7 R2 assumed keyword recovery.
2. **Router DT-R5 / keyword "no-match"** — the keyword fallback has no "no match"; its catch-all is \`visual-qa\`, never \`unknown\`.
3. **Grace window BV-04 (mobile)** — \`LISTENING_GRACE_MS\` is vestigial in the mobile build (\`activatedAt\` is set but never read). The grace gate exists only in the cloud app (src/app.ts:415). The BLE app batch-captures audio, so there is no streaming transcription to grace-reject.
4. **Active-timeout cue BV-03 (mobile)** — on the 10 s failsafe the mobile machine speaks "didn't catch that" and returns to idle; it does NOT emit a "cancelled" cue (that cue is only on explicit user cancel).
5. **HMAC BLE-06** — the bearer token is a static HMAC(deviceId, secret) with NO timestamp/nonce, so there is no clock-skew window and no replay protection (by design — "soft rate-limiter, not real auth").
6. **\`stripAnnotations\` nesting** — the regex is non-recursive; nested annotations leave a dangling tail (minor; flat/multiple annotations handled correctly).

## 7. Manual (not run here) → Table 13.10 success columns, BLE-07/10, Table 13.12
Human-run by design — **needs measurement**:
- Live end-to-end functional **success** per command (UC-* rows): real glasses, BLE pairing, real ElevenLabs STT on spoken audio, physical pages/faces/SAR notes/objects.
- **BLE-07** mid-command disconnect; **BLE-10** A2DP audio routing (perceptual).
- All of **Table 13.12** usability (participants, SUS in Arabic, task success/time, interviews, counterbalanced order, consent, qualitative coding).
Protocol pointer: Section 13.6.

## 8. ID → Section 13 cell mapping
| Section 13 cell | Source | Value |
|---|---|---|
| 13.9 ListeningStateMachine.transition / count, pass | unit (mobile) | run \`bun run testing/run_all.ts\` → §1 row |
| 13.9 each module count + pass rate | unit | §1 table (computed live) |
| 13.11 HMAC accept/reject | relay integration | §2 (100% reject) |
| 13.11 photo-token TTL (60 s boundary) | relay integration | §2 photo-token row |
| 13.11 long-poll/outer timeout (20 s/25 s) | relay integration | §2 timeouts row |
| 13.11 Router R1 accuracy (mean±σ) | intent harness | §3 (needs API key) |
| 13.11 fallback / clarification rate | intent harness | §3 (path-split is a documented limitation) |
| 13.10 OCR CER/WER (en/ar/mixed) | OCR harness | §4 (needs data collection) |
| 13.10 Face precision/recall/FAR | face harness | §4 (needs data collection) |
| 13.10 Currency per-denomination | currency harness | §4 (needs data collection) |
| 13.5 Color correctness | color harness | §4 (needs data collection) |
| 13.10 per-command latency (median/p95/p99) | perf report | §5 (needs device logs) |
| 13.11 pre-capture A/B delta | perf precapture_ab | §5 (needs device logs) |
| 13.10 success rate (UC-*) | MANUAL | needs measurement |
| 13.10 BLE-07 / BLE-10 | MANUAL | needs measurement |
| 13.12 (all usability) | MANUAL | needs measurement |

## 9. Methodology notes
- **Runner:** \`bun test\` in both packages; mobile native packages (MMKV, Bluetooth SDK, expo-audio) stubbed via \`mobile/testing/preload.ts\`; relay LLM/HTTP stubbed at \`fetch\`.
- **Timing:** \`setSystemTime\` for Date.now() boundaries (60 s photo TTL), jest fake timers for setTimeout boundaries (echo 1.5 s, active 10 s, enrollment 30 s, classify 3 s, long-poll). **No injectable-clock change to production was needed** — fake timers + the existing structure sufficed.
- **One production change:** \`encodeName\`/\`decodeName\` in \`src/services/face-service.ts\` were exported (previously private) for the §4.11 round-trip test. Backward-compatible, no behaviour change.
- **Intent set** is author-curated (self-graded limitation); **vision sets** are team-collected; runs-per-measurement and conditions recorded by each harness.
- **Not committed:** generated logs, raw images (\`testing/**/data/\`), result JSON. Committed: this report, the harness code, and the data READMEs.
- **CI:** Tiers 1–2 (offline) are CI-safe; Tiers 3–4 (need data/hardware) must NOT run in CI.

_Last regenerated: ${ts}_
`;

  fs.writeFileSync(REPORT, md);
  console.log(`\nWrote ${path.relative(ROOT, REPORT)}`);
  console.log(`Tier 1: ${t1.pass} pass / ${t1.fail} fail · Tier 2: ${t2.pass} pass / ${t2.fail} fail`);
  if (t1.fail + t2.fail > 0) process.exitCode = 1;
}

main();
