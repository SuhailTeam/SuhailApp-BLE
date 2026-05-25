/**
 * Generates the bundled audio cues for the mobile app.
 * Mirror of src/services/cue-service.ts's makeListeningCue / makeGotItCue /
 * makeCancelledCue so the cloud and mobile apps sound identical.
 *
 * Run from the mobile/ directory:
 *   bun run scripts/generate-cues.ts
 *
 * Output: mobile/assets/cues/{listening,got-it,cancelled}.wav
 * Commit the WAVs — they are tiny (~5-10KB each) and identical across runs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SAMPLE_RATE = 22050;
const OUT_DIR = resolve(__dirname, "..", "assets", "cues");

type CueType = "listening" | "got-it" | "cancelled";

function tone(freq: number, durationMs: number, amplitude = 0.5): Int16Array {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const samples = new Int16Array(n);
  const attack = Math.min(0.02 * SAMPLE_RATE, n / 4);
  const release = Math.min(0.05 * SAMPLE_RATE, n / 4);
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < attack) env = i / attack;
    else if (i > n - release) env = (n - i) / release;
    const s = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * amplitude * env;
    samples[i] = Math.max(-32767, Math.min(32767, Math.round(s * 32767)));
  }
  return samples;
}

function silence(durationMs: number): Int16Array {
  return new Int16Array(Math.floor((durationMs / 1000) * SAMPLE_RATE));
}

function concat(...parts: Int16Array[]): Int16Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Int16Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function buildWav(samples: Int16Array): Buffer {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);    // PCM
  buffer.writeUInt16LE(1, 22);    // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);   // 16-bit
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i]!, 44 + i * 2);
  }
  return buffer;
}

const CUES: Record<CueType, () => Buffer> = {
  // Rising A4 → E5: "go ahead, listening"
  "listening": () => buildWav(concat(tone(440, 90), tone(659.25, 110))),
  // Double E5 tap: acknowledgment
  "got-it": () => buildWav(concat(tone(659.25, 70), silence(30), tone(659.25, 70))),
  // Falling E5 → A4: negative acknowledgment
  "cancelled": () => buildWav(concat(tone(659.25, 90), tone(440, 110))),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of Object.entries(CUES)) {
  const data = build();
  const path = join(OUT_DIR, `${name}.wav`);
  writeFileSync(path, data);
  console.log(`✓ ${name}.wav  (${data.length} bytes)`);
}
console.log(`\nWrote ${Object.keys(CUES).length} cues to ${OUT_DIR}`);
