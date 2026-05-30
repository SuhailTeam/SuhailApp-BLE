import type { Language } from "../types";

/** App configuration loaded from environment variables */
export const config = {
  /** Server port */
  port: parseInt(process.env.PORT || "3000", 10),

  /** OpenRouter API key */
  openRouterApiKey: process.env.OPENROUTER_API_KEY || "",

  /** Vision LLM model (used for scene description, VQA, currency, object, color, OCR) */
  visionModel: process.env.VISION_MODEL || "google/gemini-2.5-flash-lite",

  /** Classification LLM model (used for intent classification and transcription normalization) */
  classificationModel: process.env.CLASSIFICATION_MODEL || "google/gemini-2.5-flash-lite",

  /** AWS region for Rekognition (e.g. us-east-1) */
  awsRegion: process.env.AWS_REGION || "us-east-1",

  /** AWS Rekognition collection ID used for face enrollment and matching */
  awsRekognitionCollectionId: process.env.AWS_REKOGNITION_COLLECTION_ID || "suhail-faces",

  /** Default language for responses */
  defaultLanguage: (process.env.DEFAULT_LANGUAGE || "ar") as Language,

  /** Confidence threshold for recognition results.
   * If <=1, interpreted as ratio (0-1). If >1, interpreted as percent (0-100). */
  confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.5"),

  /** Shared secret for the BLE mobile app's HMAC-Bearer auth on the relay
   * endpoints (/api/intent, /api/vision/*, /api/faces/*, /api/tts, /api/stt).
   * When empty, relay endpoints are open (dev mode — startup warning printed). */
  relaySharedSecret: process.env.RELAY_SHARED_SECRET || "",

  /** ElevenLabs API key for the relay's /api/tts + /api/stt endpoints. Held only on
   * the server — never shipped to the mobile binary. When empty, those endpoints
   * return 503 with a clear error message. */
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || "",

  /** Default ElevenLabs voice ID used when /api/tts is called without a voice
   * override. Falls back to "Rachel" (a stock multilingual voice). */
  elevenLabsDefaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",

  /** ElevenLabs TTS model. Defaults to flash v2.5 (multilingual, ~75ms latency). */
  elevenLabsModel: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
} as const;
