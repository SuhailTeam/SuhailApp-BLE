/** Supported languages */
export type Language = "ar" | "en";

/** Command types the relay can route an utterance to */
export type CommandType =
  | "scene-summarize"
  | "ocr-read-text"
  | "face-recognize"
  | "face-enroll"
  | "find-object"
  | "currency-recognize"
  | "color-detect"
  | "visual-qa";

/** Intent types returned by the LLM classifier (superset of CommandType) */
export type IntentType =
  | "scene_summarize"
  | "ocr_read_text"
  | "face_recognize"
  | "face_enroll"
  | "find_object"
  | "currency_recognize"
  | "color_detect"
  | "visual_qa"
  | "unknown";

/** Result from the LLM intent classifier */
export interface ClassificationResult {
  intent: IntentType;
  param?: string;
}

/** Result from the command router */
export interface RouteResult {
  command: CommandType;
  /** Extra parameters extracted from the transcription (e.g. object name for "find") */
  params?: Record<string, string>;
  /** Original transcription text */
  rawText: string;
}

/** Vision API response */
export interface VisionResponse {
  description: string;
  confidence: number;
}

/** Face recognition result */
export interface FaceRecognitionResult {
  name: string | null;
  confidence: number;
  isKnown: boolean;
}

/** Single face match within a multi-face recognition result */
export interface FaceMatch {
  name: string | null;
  confidence: number;
  isKnown: boolean;
}

/** Result from recognizing ALL faces in an image */
export interface MultiFaceResult {
  faces: FaceMatch[];
  totalDetected: number;
}

/** A single denomination group within a currency recognition result */
export interface CurrencyBill {
  denomination: number;
  count: number;
}

/** Currency detection result. Groups bills by denomination and reports a total. */
export interface CurrencyResult {
  bills: CurrencyBill[];
  total: number;
  /** Dominant currency ISO code (e.g. "SAR"), or "UNKNOWN" when bills detected but currency unclear */
  currency: string;
  /** Non-dominant currencies present in the same photo. Usually undefined. */
  otherCurrencies?: Array<{ currency: string; bills: CurrencyBill[]; total: number }>;
  confidence: number;
}

/**
 * ElevenLabs `output_format` string. Mirrors `AudioFormat` in
 * services/elevenlabs-tts.ts but lives here so the mobile client can share it
 * without importing server-only code.
 */
export type AudioFormatString =
  | "mp3_44100_128"
  | "mp3_44100_64"
  | "mp3_22050_32"
  | "pcm_16000"
  | "pcm_22050"
  | "pcm_24000"
  | "pcm_44100"
  | "ulaw_8000";

/**
 * NDJSON event streamed by `POST /api/answer` — one JSON object per line.
 *
 * Order on the wire:
 *   1. exactly one `route`.
 *      - `mode:"client"` → the phone runs its existing discrete dispatch
 *        (structured/short commands, face-enroll, unknown); stream ends here.
 *      - `mode:"streamed"` → zero or more `chunk`s follow (sentence text +
 *        base64 audio, in `seq` order), then a `final` (full spoken text).
 *   2. an `error` may replace `final`. `recoverable:true` (emitted before any
 *      `chunk`) tells the phone to fall back to discrete dispatch;
 *      `recoverable:false` (after ≥1 chunk) means stop cleanly, no fallback.
 *   3. `done` is always the last event.
 */
export type AnswerEvent =
  | { type: "route"; mode: "streamed"; command: CommandType }
  | { type: "route"; mode: "client"; command: CommandType | "unknown"; params?: Record<string, string> }
  | { type: "chunk"; seq: number; text: string; format: AudioFormatString; audio: string }
  | { type: "final"; text: string }
  | { type: "error"; recoverable: boolean; message?: string }
  | { type: "done" };
