import { routeCommand } from "../commands/command-router";
import * as visionService from "../services/vision-service";
import * as faceService from "../services/face-service";
import { synthesize, isValidFormat, contentTypeFor, type AudioFormat } from "../services/elevenlabs-tts";
import { transcribe } from "../services/elevenlabs-stt";
import { normalizeTranscription } from "../utils/transcription-normalizer";
import { stripAnnotations } from "../utils/transcription-filter";
import { mintToken, storeBytes, getBytes } from "../services/photo-cache";
import { config } from "../utils/config";
import { Logger } from "../utils/logger";
import type { Language } from "../types";
import { relayAuth, warnIfDevAuth } from "./auth";

const logger = new Logger("RelayRoutes");

/** Max body size for relay endpoints — base64 1080p JPEG can be ~3MB. */
const RELAY_BODY_LIMIT = "10mb";

/** Normalises an incoming language value to the typed union, defaulting to "ar". */
function asLanguage(value: unknown): Language {
  return value === "en" ? "en" : "ar";
}

/** Type guard for a non-empty base64 image string. */
function isImage(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Resolves either `image` (base64) or `photoToken` (cache key) to a base64
 * string for vision/face endpoints. Mobile callers can pass EITHER:
 *   { image: base64 }         — legacy / direct path (still used by tests)
 *   { photoToken: "<hex>" }   — BLE flow: glasses uploaded to /api/photo/upload/<token>
 *
 * Returns the base64 image on success, or sets a 4xx response + returns null
 * on missing/invalid input. Caller checks the return value before proceeding.
 *
 * Photo token consumption is one-shot — calling twice with the same token
 * fails the second time (entry evicted on first consume).
 */
/**
 * Reconstructs the public base URL for this server from the incoming request.
 * Honours x-forwarded-proto / x-forwarded-host (set by ngrok and Railway) so
 * the URL we give to glasses for photo upload is reachable from the public
 * internet, not localhost. Falls back to req.protocol + req.get('host').
 */
function absoluteBase(req: any): string {
  const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "https";
  const host = req.get("x-forwarded-host") ?? req.get("host");
  return `${proto}://${host}`;
}

function resolveImageOrRespondError(body: any, res: any): string | null {
  if (typeof body?.image === "string" && body.image.length > 0) {
    return body.image;
  }
  if (typeof body?.photoToken === "string" && body.photoToken.length > 0) {
    const bytes = getBytes(body.photoToken);
    if (!bytes) {
      res.status(404).json({ error: "photoToken unknown, expired, or never uploaded" });
      return null;
    }
    return bytes.toString("base64");
  }
  res.status(400).json({ error: "image (base64) or photoToken is required" });
  return null;
}

/**
 * Wraps an async handler so unexpected throws turn into 500s instead of crashing
 * the process. Logs the failure with the route path for debugging.
 */
function wrap(name: string, handler: (req: any, res: any) => Promise<void>) {
  return async (req: any, res: any) => {
    try {
      await handler(req, res);
    } catch (error: any) {
      logger.error(`[${name}] handler failed:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Internal error" });
      }
    }
  };
}

/**
 * Registers the BLE-mobile relay endpoints on the given Express app.
 * All routes mount under /api and require HMAC-Bearer auth (see auth.ts).
 *
 * Endpoint contract (matches mobile/CLAUDE.md):
 *   POST /api/intent              { text, language }                → { command, params, rawText }
 *   POST /api/vision/scene        { image, language }               → { description, confidence }
 *   POST /api/vision/ocr          { image, language, context? }     → { text }
 *   POST /api/vision/currency     { image }                         → CurrencyResult
 *   POST /api/vision/object       { image, target, language }       → { found, location, confidence }
 *   POST /api/vision/color        { image, language }               → { colorName, hex }
 *   POST /api/vision/vqa          { image, question, language }     → { description, confidence }
 *   POST /api/faces/recognize     { image }                         → FaceRecognitionResult
 *   POST /api/faces/recognize-all { image }                         → MultiFaceResult
 *   POST /api/faces/enroll        { image, name }                   → { faceId, name }
 */
export function registerRelayRoutes(expressApp: any): void {
  warnIfDevAuth();

  const express = require("express");
  // Dedicated router so the 10mb body limit doesn't apply to existing /api routes
  // (which were sized for small JSON payloads like /api/settings).
  const router = express.Router();
  router.use(express.json({ limit: RELAY_BODY_LIMIT }));
  router.use(relayAuth);

  /* ── /api/photo/upload-url ───────────────────────────────────────────── */
  // Mobile calls this to mint a one-shot upload URL it then passes to
  // BluetoothSdk.requestPhoto(...). Glasses POST the photo to that URL.

  router.post("/photo/upload-url", wrap("photo/upload-url", async (req, res) => {
    const deviceId = (req as any).deviceId ?? "anon";
    let token;
    try {
      token = mintToken(deviceId);
    } catch (err) {
      // Cache at capacity — too many in-flight photos. Mobile should retry shortly.
      res.status(503).json({ error: "photo cache at capacity, try again" });
      return;
    }
    const base = absoluteBase(req);
    res.json({
      photoToken: token.photoToken,
      uploadUrl: `${base}/api/photo/upload/${token.photoToken}`,
      expiresAt: token.expiresAt,
    });
  }));

  /* ── /api/intent ─────────────────────────────────────────────────────── */

  router.post("/intent", wrap("intent", async (req, res) => {
    const { text } = req.body ?? {};
    if (typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    // Strip Scribe-style annotations like "(clicks tongue)" before routing —
    // they confuse the classifier and can be the entire utterance.
    const cleaned = stripAnnotations(text);
    if (cleaned.length === 0) {
      res.json({ command: "unknown", rawText: text });
      return;
    }
    // language is accepted for future use (e.g. localized fallbacks) but routeCommand
    // doesn't currently consume it — the LLM is language-agnostic.
    const result = await routeCommand(cleaned);
    if (!result) {
      res.json({ command: "unknown", rawText: text });
      return;
    }
    res.json(result);
  }));

  /* ── /api/normalize ──────────────────────────────────────────────────── */

  router.post("/normalize", wrap("normalize", async (req, res) => {
    const { text, language } = req.body ?? {};
    if (typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const lang: Language = language === "en" ? "en" : "ar";
    // Strip Scribe-style "(coughs)" before normalization for the same reason.
    const cleaned = stripAnnotations(text);
    if (cleaned.length === 0) {
      res.json({ text: "" });
      return;
    }
    // normalizeTranscription is a no-op when the text doesn't need normalization
    // (returns input unchanged). So mobile callers can call this unconditionally,
    // though they SHOULD pre-check with `needsScriptNormalization` to skip the
    // round-trip and OpenRouter spend when nothing's needed.
    const normalized = await normalizeTranscription(cleaned, lang);
    res.json({ text: normalized });
  }));

  /* ── /api/vision/* ───────────────────────────────────────────────────── */

  router.post("/vision/scene", wrap("vision/scene", async (req, res) => {
    const image = resolveImageOrRespondError(req.body, res);
    if (!image) return;
    const result = await visionService.describeScene(image, asLanguage(req.body?.language));
    res.json(result);
  }));

  router.post("/vision/ocr", wrap("vision/ocr", async (req, res) => {
    const image = resolveImageOrRespondError(req.body, res);
    if (!image) return;
    const text = await visionService.extractText(
      image,
      typeof req.body?.context === "string" ? req.body.context : undefined,
      asLanguage(req.body?.language),
    );
    res.json({ text });
  }));

  router.post("/vision/currency", wrap("vision/currency", async (req, res) => {
    const image = resolveImageOrRespondError(req.body, res);
    if (!image) return;
    const result = await visionService.recognizeCurrency(image);
    res.json(result);
  }));

  router.post("/vision/object", wrap("vision/object", async (req, res) => {
    if (typeof req.body?.target !== "string" || req.body.target.trim().length === 0) {
      res.status(400).json({ error: "target is required" });
      return;
    }
    const image = resolveImageOrRespondError(req.body, res);
    if (!image) return;
    const result = await visionService.detectObject(image, req.body.target.trim(), asLanguage(req.body?.language));
    res.json(result);
  }));

  router.post("/vision/color", wrap("vision/color", async (req, res) => {
    const image = resolveImageOrRespondError(req.body, res);
    if (!image) return;
    const result = await visionService.detectColor(image, asLanguage(req.body?.language));
    res.json(result);
  }));

  router.post("/vision/vqa", wrap("vision/vqa", async (req, res) => {
    if (typeof req.body?.question !== "string" || req.body.question.trim().length === 0) {
      res.status(400).json({ error: "question is required" });
      return;
    }
    const image = resolveImageOrRespondError(req.body, res);
    if (!image) return;
    const result = await visionService.answerVisualQuestion(image, req.body.question.trim(), asLanguage(req.body?.language));
    res.json(result);
  }));

  /* ── /api/faces/* (POST only — GET/PUT/DELETE stay on the existing webview path) ── */

  router.post("/faces/recognize", wrap("faces/recognize", async (req, res) => {
    const image = resolveImageOrRespondError(req.body, res);
    if (!image) return;
    const result = await faceService.recognizeFace(image);
    res.json(result);
  }));

  router.post("/faces/recognize-all", wrap("faces/recognize-all", async (req, res) => {
    const image = resolveImageOrRespondError(req.body, res);
    if (!image) return;
    const result = await faceService.recognizeAllFaces(image);
    res.json(result);
  }));

  router.post("/faces/enroll", wrap("faces/enroll", async (req, res) => {
    if (typeof req.body?.name !== "string" || req.body.name.trim().length === 0) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const image = resolveImageOrRespondError(req.body, res);
    if (!image) return;
    const faceId = await faceService.enrollFace(req.body.name.trim(), image);
    if (!faceId) {
      res.status(422).json({ error: "Face could not be enrolled" });
      return;
    }
    res.json({ faceId, name: req.body.name.trim(), enrolledAt: new Date().toISOString() });
  }));

  /* ── /api/stt ────────────────────────────────────────────────────────── */

  router.post("/stt", wrap("stt", async (req, res) => {
    if (!config.elevenLabsApiKey) {
      res.status(503).json({ error: "STT not configured (ELEVENLABS_API_KEY missing)" });
      return;
    }
    const { audio, language } = req.body ?? {};
    if (typeof audio !== "string" || audio.length === 0) {
      res.status(400).json({ error: "audio (base64 PCM s16le 16kHz mono) is required" });
      return;
    }
    let pcm: Buffer;
    try {
      pcm = Buffer.from(audio, "base64");
    } catch {
      res.status(400).json({ error: "audio is not valid base64" });
      return;
    }
    if (pcm.length < 1024) {
      // < ~32ms of audio is almost certainly noise / empty buffer. Avoid the
      // round-trip; Scribe will reject anyway.
      res.status(400).json({ error: "audio buffer too small (need ≥ 1KB of PCM)" });
      return;
    }
    const lang = language === "ar" || language === "en" ? language : undefined;
    const result = await transcribe({ pcm, language: lang });
    res.json(result);
  }));

  /* ── /api/tts ────────────────────────────────────────────────────────── */

  router.post("/tts", wrap("tts", async (req, res) => {
    if (!config.elevenLabsApiKey) {
      res.status(503).json({ error: "TTS not configured (ELEVENLABS_API_KEY missing)" });
      return;
    }
    const { text, voicePreset, voiceId, speed, format } = req.body ?? {};
    if (typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    // ElevenLabs caps single-request text at 5000 chars; reject earlier so
    // mobile gets a clean error instead of a vendor surprise.
    if (text.length > 5000) {
      res.status(413).json({ error: "text exceeds 5000 character limit" });
      return;
    }
    const chosenFormat: AudioFormat | undefined = isValidFormat(format) ? format : undefined;
    const { audio, format: usedFormat } = await synthesize({
      text,
      voicePreset: typeof voicePreset === "string" ? voicePreset : undefined,
      voiceId: typeof voiceId === "string" ? voiceId : undefined,
      speed: typeof speed === "number" ? speed : undefined,
      format: chosenFormat,
    });
    res
      .status(200)
      .setHeader("Content-Type", contentTypeFor(usedFormat))
      .setHeader("Content-Length", String(audio.length))
      .setHeader("X-Audio-Format", usedFormat)
      .send(audio);
  }));

  // Mount the router. Existing /api/* routes (status, activity, faces GET/PUT/DELETE,
  // settings, faces photo) remain registered on the parent app and are not affected.
  expressApp.use("/api", router);

  /* ── /api/photo/upload/:token (UNAUTHENTICATED — glasses webhook) ────── */
  // Goes on the parent app, NOT the HMAC-auth router. The token in the URL
  // path is the auth (one-shot, 60s TTL, minted by /api/photo/upload-url).
  // Multipart parsing via multer (memory storage, 10MB cap). The wire format
  // is dictated by the BLE SDK's photo upload (multipart `photo` field +
  // optional `requestId`) — matches Mentra's photo-webhook-server example.
  const multer = require("multer");
  const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }).single("photo");

  expressApp.post("/api/photo/upload/:token", photoUpload, (req: any, res: any) => {
    try {
      const token = String(req.params?.token ?? "");
      const photo = req.file;
      if (!photo) {
        res.status(400).json({ error: "photo field missing" });
        return;
      }
      if (!storeBytes(token, photo.buffer)) {
        res.status(404).json({ error: "photoToken unknown or expired" });
        return;
      }
      logger.info(`photo upload: ${photo.buffer.length} bytes for ${token.slice(0, 8)}... (requestId=${req.body?.requestId ?? "?"})`);
      res.json({ success: true, bytes: photo.buffer.length });
    } catch (err: any) {
      logger.error("photo upload failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || "Internal error" });
      }
    }
  });

  logger.info("Relay routes registered: /api/intent, /api/normalize, /api/vision/*, /api/faces/{recognize,recognize-all,enroll}, /api/tts, /api/stt, /api/photo/{upload-url,upload/:token}");
}
