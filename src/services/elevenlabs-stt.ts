import { config } from "../utils/config";
import { Logger } from "../utils/logger";

const logger = new Logger("ElevenLabsSTT");

/** Default Scribe model. */
const DEFAULT_MODEL = "scribe_v1";

/**
 * Glasses mic emits raw 16 kHz / 16-bit / mono / s16le PCM via mic_pcm events
 * (per @mentra/bluetooth-sdk MicPcmEvent.encoding). ElevenLabs Scribe wants a
 * proper audio file, not raw PCM, so we prepend a 44-byte WAV header.
 */
const MIC_SAMPLE_RATE = 16_000;
const MIC_BITS_PER_SAMPLE = 16;
const MIC_CHANNELS = 1;

export interface ScribeResult {
  text: string;
  /** BCP-47-ish language code reported by Scribe (e.g. "en", "ar"). May be undefined. */
  languageCode?: string;
  /** Scribe's overall confidence 0-1 if returned. */
  confidence?: number;
}

export interface ScribeOptions {
  /** Raw 16 kHz / 16-bit / mono PCM bytes from the glasses mic. */
  pcm: Buffer;
  /** Optional language hint ("en", "ar"). Scribe auto-detects when omitted. */
  language?: string;
  /** Model override; defaults to scribe_v1. */
  modelId?: string;
}

/**
 * Wraps raw 16 kHz / 16-bit / mono PCM in a standard RIFF WAV header so
 * ElevenLabs Scribe accepts it as an audio file.
 */
function pcmToWav(pcm: Buffer): Buffer {
  const dataSize = pcm.length;
  const out = Buffer.alloc(44 + dataSize);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataSize, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);                                          // PCM chunk size
  out.writeUInt16LE(1, 20);                                           // format: PCM
  out.writeUInt16LE(MIC_CHANNELS, 22);
  out.writeUInt32LE(MIC_SAMPLE_RATE, 24);
  out.writeUInt32LE(MIC_SAMPLE_RATE * MIC_CHANNELS * MIC_BITS_PER_SAMPLE / 8, 28);  // byte rate
  out.writeUInt16LE(MIC_CHANNELS * MIC_BITS_PER_SAMPLE / 8, 32);      // block align
  out.writeUInt16LE(MIC_BITS_PER_SAMPLE, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataSize, 40);
  pcm.copy(out, 44);
  return out;
}

/**
 * Transcribes a buffer of PCM audio via ElevenLabs Scribe.
 * Throws on missing API key or non-2xx response. Caller wraps + maps to HTTP.
 */
export async function transcribe(opts: ScribeOptions): Promise<ScribeResult> {
  if (!config.elevenLabsApiKey) {
    throw new Error("ELEVENLABS_API_KEY not configured");
  }
  if (opts.pcm.length === 0) {
    throw new Error("audio buffer is empty");
  }

  const modelId = opts.modelId ?? DEFAULT_MODEL;
  const wav = pcmToWav(opts.pcm);
  const durationMs = Math.round((opts.pcm.length / 2 / MIC_SAMPLE_RATE) * 1000);

  // multipart/form-data — Scribe expects a `file` field plus form-encoded options.
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
  form.append("model_id", modelId);
  if (opts.language) {
    // Scribe accepts a language_code hint to improve accuracy when known.
    form.append("language_code", opts.language);
  }

  logger.info(`Transcribing ${(wav.length / 1024).toFixed(1)}KB (~${durationMs}ms audio), model=${modelId}, lang=${opts.language ?? "auto"}`);

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenLabsApiKey,
      // NOTE: do NOT set Content-Type here — fetch + FormData set the multipart
      // boundary automatically. Setting it manually breaks the request.
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`ElevenLabs Scribe failed: ${response.status} ${response.statusText}${errText ? ` — ${errText.slice(0, 200)}` : ""}`);
  }

  const data = await response.json() as { text?: string; language_code?: string; language_probability?: number };
  const text = data.text ?? "";
  logger.info(`Scribe result: ${text.length}ch, lang=${data.language_code ?? "?"} (${text.slice(0, 60).replace(/\s+/g, " ")}${text.length > 60 ? "…" : ""})`);

  return {
    text,
    languageCode: data.language_code,
    confidence: data.language_probability,
  };
}
