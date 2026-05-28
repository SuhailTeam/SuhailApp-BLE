/**
 * Generates the pre-bundled phrase audio for the mobile app.
 *
 * The hot, static spoken phrases (didn't-catch, general error, unknown command,
 * etc. — see BUNDLED_PHRASE_KEYS in src/i18n/messages.ts) are synthesized once
 * here and committed as assets, so at runtime they play instantly with no
 * /api/tts round-trip and zero per-utterance ElevenLabs credit spend.
 *
 * This mirrors src/services/elevenlabs-tts.ts (default voice, model, mp3 format,
 * /stream endpoint) so a bundled phrase is indistinguishable from a live one
 * when the user is on default voice + speed settings (the only case the runtime
 * uses the bundle — see src/audio/phrases.ts).
 *
 * Run from the mobile/ directory (the key is read from the repo-root .env, the
 * same secret the Railway relay uses — it never ships in the app):
 *   bun run scripts/generate-phrases.ts
 *
 * Output: mobile/assets/phrases/<key>.<lang>.mp3  — commit these.
 * Re-run after editing BUNDLED_PHRASE_KEYS or any bundled message text.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { messages, BUNDLED_PHRASE_KEYS, LANGUAGES } from "../src/i18n/messages";

const OUT_DIR = resolve(__dirname, "..", "assets", "phrases");
const ROOT_ENV = resolve(__dirname, "..", "..", ".env");

/** Minimal .env reader — pulls one key without adding a dotenv dependency. */
function readEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  if (!existsSync(ROOT_ENV)) return undefined;
  for (const line of readFileSync(ROOT_ENV, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2]!.replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const API_KEY = readEnv("ELEVENLABS_API_KEY");
// Default voice + model match the relay's defaults so default-settings users
// hear the same voice for bundled and live phrases.
const VOICE_ID = readEnv("ELEVENLABS_DEFAULT_VOICE_ID") ?? "21m00Tcm4TlvDq8ikWAM"; // Rachel
const MODEL_ID = readEnv("ELEVENLABS_MODEL") ?? "eleven_flash_v2_5";
const FORMAT = "mp3_44100_64"; // matches elevenlabs-tts.ts default

if (!API_KEY) {
  console.error(
    "✗ ELEVENLABS_API_KEY not found (looked in process.env and repo-root .env).\n" +
      "  Set it and re-run: ELEVENLABS_API_KEY=... bun run scripts/generate-phrases.ts",
  );
  process.exit(1);
}

async function synthesize(text: string): Promise<Buffer> {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE_ID)}` +
    `/stream?output_format=${FORMAT}&optimize_streaming_latency=3`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY!,
      "Content-Type": "application/json",
      Accept: "*/*",
    },
    // Neutral speed (1.0) — matches default speechSpeed. No voice_settings.speed
    // needed; 1.0 is the ElevenLabs default.
    body: JSON.stringify({ text, model_id: MODEL_ID }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`voice=${VOICE_ID.slice(0, 8)}… model=${MODEL_ID} format=${FORMAT}\n`);

  let totalChars = 0;
  let count = 0;
  for (const key of BUNDLED_PHRASE_KEYS) {
    for (const lang of LANGUAGES) {
      const text = messages[key][lang];
      const audio = await synthesize(text);
      const file = join(OUT_DIR, `${key}.${lang}.mp3`);
      writeFileSync(file, audio);
      totalChars += text.length;
      count += 1;
      console.log(`✓ ${key}.${lang}.mp3  (${audio.length} bytes, ${text.length} chars)`);
    }
  }

  // Flash v2.5 bills ~0.5 credits/char.
  console.log(
    `\nWrote ${count} files to ${OUT_DIR}\n` +
      `Total ${totalChars} chars ≈ ${Math.round(totalChars * 0.5)} ElevenLabs credits (one-time).`,
  );
}

main().catch((err) => {
  console.error(`\n✗ generation failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
