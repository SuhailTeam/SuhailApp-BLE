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
