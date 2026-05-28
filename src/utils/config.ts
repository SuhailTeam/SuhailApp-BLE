import type { Language } from "../types";

/** App configuration loaded from environment variables */
export const config = {
  /** MentraOS package name */
  packageName: process.env.PACKAGE_NAME || "com.suhail.assistant",

  /** MentraOS API key */
  mentraApiKey: process.env.MENTRAOS_API_KEY || "",

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

  /** Minimum transcription confidence to accept (0-1). Below this is treated as noise. */
  minTranscriptionConfidence: parseFloat(process.env.MIN_CONFIDENCE || "0.55"),

  /** Publicly-reachable base URL of this server (no trailing slash). Used to serve
   * generated audio cues (./public/cues/*.wav) to the glasses via playAudio.
   * Dev: your ngrok URL. Prod: Railway URL. When set, short chimes replace the
   * "Listening" / "Got it" / "Cancelled" TTS cues (saves ~4-5s per command). */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),

  /** Shared secret for the BLE mobile app's HMAC-Bearer auth on the relay
   * endpoints (/api/intent, /api/vision/*, /api/faces/* POST, /api/tts).
   * When empty, relay endpoints are open (dev mode — startup warning printed). */
  relaySharedSecret: process.env.RELAY_SHARED_SECRET || "",

  /** ElevenLabs API key for the relay's /api/tts endpoint. Held only on the
   * server — never shipped to the mobile binary. When empty, /api/tts returns
   * 503 with a clear error message. */
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || "",

  /** Default ElevenLabs voice ID used when /api/tts is called without a voice
   * override. Falls back to "Rachel" (a stock multilingual voice). */
  elevenLabsDefaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",

  /** ElevenLabs TTS model. Defaults to flash v2.5 (multilingual, ~75ms latency)
   * to match the Mentra-mediated TTS the cloud app uses. */
  elevenLabsModel: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
} as const;
