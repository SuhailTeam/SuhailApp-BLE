import { routeCommand } from "../commands/command-router";
import * as visionService from "../services/vision-service";
import * as faceService from "../services/face-service";
import { synthesize, isValidFormat, contentTypeFor, type AudioFormat } from "../services/elevenlabs-tts";
import { transcribe } from "../services/elevenlabs-stt";
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

  /* ── /api/intent ─────────────────────────────────────────────────────── */

  router.post("/intent", wrap("intent", async (req, res) => {
    const { text } = req.body ?? {};
    if (typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    // language is accepted for future use (e.g. localized fallbacks) but routeCommand
    // doesn't currently consume it — the LLM is language-agnostic.
    const result = await routeCommand(text);
    if (!result) {
      res.json({ command: "unknown", rawText: text });
      return;
    }
    res.json(result);
  }));

  /* ── /api/vision/* ───────────────────────────────────────────────────── */

  router.post("/vision/scene", wrap("vision/scene", async (req, res) => {
    const { image, language } = req.body ?? {};
    if (!isImage(image)) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }
    const result = await visionService.describeScene(image, asLanguage(language));
    res.json(result);
  }));

  router.post("/vision/ocr", wrap("vision/ocr", async (req, res) => {
    const { image, language, context } = req.body ?? {};
    if (!isImage(image)) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }
    const text = await visionService.extractText(
      image,
      typeof context === "string" ? context : undefined,
      asLanguage(language),
    );
    res.json({ text });
  }));

  router.post("/vision/currency", wrap("vision/currency", async (req, res) => {
    const { image } = req.body ?? {};
    if (!isImage(image)) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }
    const result = await visionService.recognizeCurrency(image);
    res.json(result);
  }));

  router.post("/vision/object", wrap("vision/object", async (req, res) => {
    const { image, target, language } = req.body ?? {};
    if (!isImage(image)) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }
    if (typeof target !== "string" || target.trim().length === 0) {
      res.status(400).json({ error: "target is required" });
      return;
    }
    const result = await visionService.detectObject(image, target.trim(), asLanguage(language));
    res.json(result);
  }));

  router.post("/vision/color", wrap("vision/color", async (req, res) => {
    const { image, language } = req.body ?? {};
    if (!isImage(image)) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }
    const result = await visionService.detectColor(image, asLanguage(language));
    res.json(result);
  }));

  router.post("/vision/vqa", wrap("vision/vqa", async (req, res) => {
    const { image, question, language } = req.body ?? {};
    if (!isImage(image)) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }
    if (typeof question !== "string" || question.trim().length === 0) {
      res.status(400).json({ error: "question is required" });
      return;
    }
    const result = await visionService.answerVisualQuestion(image, question.trim(), asLanguage(language));
    res.json(result);
  }));

  /* ── /api/faces/* (POST only — GET/PUT/DELETE stay on the existing webview path) ── */

  router.post("/faces/recognize", wrap("faces/recognize", async (req, res) => {
    const { image } = req.body ?? {};
    if (!isImage(image)) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }
    const result = await faceService.recognizeFace(image);
    res.json(result);
  }));

  router.post("/faces/recognize-all", wrap("faces/recognize-all", async (req, res) => {
    const { image } = req.body ?? {};
    if (!isImage(image)) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }
    const result = await faceService.recognizeAllFaces(image);
    res.json(result);
  }));

  router.post("/faces/enroll", wrap("faces/enroll", async (req, res) => {
    const { image, name } = req.body ?? {};
    if (!isImage(image)) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }
    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const faceId = await faceService.enrollFace(name.trim(), image);
    if (!faceId) {
      res.status(422).json({ error: "Face could not be enrolled" });
      return;
    }
    res.json({ faceId, name: name.trim(), enrolledAt: new Date().toISOString() });
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
  logger.info("Relay routes registered: /api/intent, /api/vision/*, /api/faces/{recognize,recognize-all,enroll}, /api/tts, /api/stt");
}
