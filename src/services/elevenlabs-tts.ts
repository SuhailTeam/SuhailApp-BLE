import { config } from "../utils/config";
import { Logger } from "../utils/logger";

const logger = new Logger("ElevenLabsTTS");

/** Voice preset → built-in ElevenLabs voice ID (used by the relay /api/tts endpoint). */
const PRESET_VOICE_IDS: Record<string, string> = {
  male: "pNInz6obpgDQGcFmaJgB",    // Adam
  female: "21m00Tcm4TlvDq8ikWAM",  // Rachel
};

/** Supported output formats. Maps to ElevenLabs `output_format` query param. */
export type AudioFormat =
  | "mp3_44100_128"
  | "mp3_44100_64"
  | "mp3_22050_32"
  | "pcm_16000"
  | "pcm_22050"
  | "pcm_24000"
  | "pcm_44100"
  | "ulaw_8000";

const VALID_FORMATS = new Set<string>([
  "mp3_44100_128", "mp3_44100_64", "mp3_22050_32",
  "pcm_16000", "pcm_22050", "pcm_24000", "pcm_44100",
  "ulaw_8000",
]);

export function isValidFormat(value: unknown): value is AudioFormat {
  return typeof value === "string" && VALID_FORMATS.has(value);
}

/** Returns the HTTP Content-Type to send for a given output format. */
export function contentTypeFor(format: AudioFormat): string {
  if (format.startsWith("mp3_")) return "audio/mpeg";
  if (format.startsWith("pcm_")) {
    // ElevenLabs returns raw 16-bit signed LE mono PCM. There's no perfect
    // standard MIME — audio/L16 with rate is the closest match per RFC 2586.
    const rate = format.split("_")[1] ?? "16000";
    return `audio/L16; rate=${rate}; channels=1`;
  }
  if (format.startsWith("ulaw_")) return "audio/basic";
  return "application/octet-stream";
}

export interface SynthesizeOptions {
  text: string;
  /** Either a preset name ("male"/"female") OR a raw ElevenLabs voice ID. */
  voicePreset?: string;
  /** Raw voice ID override (takes priority over preset). */
  voiceId?: string;
  /** Speech speed 0.5-2.0 (clamped). */
  speed?: number;
  /** Output audio format (defaults to mp3_44100_128). */
  format?: AudioFormat;
  /** Model override; defaults to config.elevenLabsModel. */
  modelId?: string;
}

/** Resolves the final voice id from override > preset > config default. */
function resolveVoiceId(opts: SynthesizeOptions): string {
  if (opts.voiceId && opts.voiceId.length > 0) return opts.voiceId;
  if (opts.voicePreset && PRESET_VOICE_IDS[opts.voicePreset]) {
    return PRESET_VOICE_IDS[opts.voicePreset]!;
  }
  return config.elevenLabsDefaultVoiceId;
}

function clampSpeed(speed: number | undefined): number | undefined {
  if (typeof speed !== "number" || !Number.isFinite(speed)) return undefined;
  return Math.min(2.0, Math.max(0.5, speed));
}

/**
 * Synthesizes audio bytes from text via the ElevenLabs HTTP TTS API.
 * Returns the raw audio Buffer and the chosen format (so callers can set the
 * right Content-Type on the response).
 *
 * Throws on missing API key or non-2xx response. Callers should wrap.
 */
export async function synthesize(opts: SynthesizeOptions): Promise<{ audio: Buffer; format: AudioFormat }> {
  if (!config.elevenLabsApiKey) {
    throw new Error("ELEVENLABS_API_KEY not configured");
  }
  if (typeof opts.text !== "string" || opts.text.trim().length === 0) {
    throw new Error("text is required");
  }

  const voiceId = resolveVoiceId(opts);
  // 64kbps default (was 128). For voice through small glasses speakers the
  // quality drop is barely audible and payload halves — meaningful network
  // transfer time win on every TTS round-trip.
  const format: AudioFormat = opts.format ?? "mp3_44100_64";
  const modelId = opts.modelId ?? config.elevenLabsModel;
  const speed = clampSpeed(opts.speed);

  // /stream endpoint + optimize_streaming_latency tells ElevenLabs to start
  // emitting audio sooner (sacrificing some quality smoothing). 3 = "max
  // latency optimisation, may impact text normalization". Worth it for voice
  // commands where snappiness > pronunciation perfection.
  // Note: we still buffer the full response below — this just speeds up
  // ElevenLabs' first-byte time on their side. True stream-through to the
  // client is a separate refactor (see PR description).
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${format}&optimize_streaming_latency=3`;

  const body: Record<string, unknown> = {
    text: opts.text,
    model_id: modelId,
  };
  if (speed !== undefined) {
    body.voice_settings = { speed };
  }

  logger.info(`Synthesizing ${opts.text.length} chars → voice=${voiceId.slice(0, 8)}..., model=${modelId}, format=${format}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenLabsApiKey,
      "Content-Type": "application/json",
      "Accept": "*/*",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed: ${response.status} ${response.statusText}${errText ? ` — ${errText.slice(0, 200)}` : ""}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audio = Buffer.from(arrayBuffer);
  logger.info(`Received ${audio.length} bytes of audio`);

  // Spend tracking — TTS bills per character. Flash v2.5 uses ~0.5 credits/char,
  // multilingual_v2 uses 1 credit/char. Greppable line for cost aggregation
  // (`grep '\[Cost\]' suhail.log`).
  logger.info(`[Cost] TTS ${opts.text.length}ch (model=${modelId})`);

  return { audio, format };
}
