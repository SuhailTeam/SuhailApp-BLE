import { routeCommand } from "./command-router";
import {
  buildScenePrompt,
  buildOcrPrompt,
  buildVqaPrompt,
  streamVisionContent,
  createSentenceSplitter,
} from "../services/vision-service";
import { recognizeAllFaces } from "../services/face-service";
import { synthesize, type AudioFormat } from "../services/elevenlabs-tts";
import { waitForBytes } from "../services/photo-cache";
import { normalizeTranscription } from "../utils/transcription-normalizer";
import { stripAnnotations, needsScriptNormalization } from "../utils/transcription-filter";
import { Logger } from "../utils/logger";
import type { AnswerEvent, CommandType, Language, MultiFaceResult } from "../types";

const logger = new Logger("AnswerRelay");

/**
 * POST /api/answer — the merged intent+vision+answer endpoint.
 *
 * Body: { text, photoToken, language }. Routes the utterance, then:
 *  - For the 3 free-text commands (scene/ocr/vqa): streams the vision LLM,
 *    splits it into sentences, TTS each, and streams NDJSON {text+audio} chunks
 *    so the phone plays sentence 1 while the LLM is still writing the rest.
 *  - For everything else (structured/short commands, face-enroll, unknown):
 *    emits a `route mode:"client"` event and the phone runs its existing
 *    discrete dispatch unchanged (one fewer round-trip — no separate /api/intent).
 *
 * Mounted on the HMAC relay router; NOT wrapped by routes.ts' json-500 `wrap()`
 * because once the stream headers are sent we can't fall back to res.json().
 */

/** Commands answered by the streaming pipeline (free-text, multi-sentence). */
const STREAMED_COMMANDS = new Set<CommandType>(["scene-summarize", "ocr-read-text", "visual-qa"]);

/* ── Spoken-text composition (server-side replica of the mobile commands) ── */
// Mirrors mobile/src/commands/{describe,read}.ts so a streamed answer reads the
// same as the discrete path. Kept in sync with mobile rule 4 (don't drift tuned
// cloud semantics).
const KNOWN_FACE_MIN_CONFIDENCE = 0.5;
const MAX_SCENE_CHARS = 350;
const OCR_MAX_CHARS = 400;

const TRUNCATION_SUFFIX: Record<Language, string> = {
  ar: " وغيره. اسحب للأمام للإيقاف.",
  en: " ...and more. Swipe forward to stop.",
};
const NO_TEXT_MESSAGE: Record<Language, string> = {
  ar: "ما قدرت ألاقي نص في الصورة.",
  en: "I couldn't find any text in the image.",
};

/** How long the server waits for the glasses' photo upload before giving up. */
const PHOTO_WAIT_MS = 20_000;

/** Per-sentence TTS ceiling. A stalled ElevenLabs call must not block the rest
 *  of the stream (no further chunks / final / done) — on timeout we skip that
 *  sentence's audio and keep going, exactly like a thrown TTS error. */
const TTS_TIMEOUT_MS = 8_000;

function namesPrefix(names: string[], language: Language): string {
  if (names.length === 0) return "";
  const joiner = language === "ar" ? "، " : ", ";
  return `${names.join(joiner)}. `;
}

function knownNamesFrom(result: MultiFaceResult | null): string[] {
  if (!result) return [];
  return result.faces
    .filter((f) => f.isKnown && f.name && f.confidence >= KNOWN_FACE_MIN_CONFIDENCE)
    .map((f) => f.name as string)
    .filter((n, i, arr) => arr.indexOf(n) === i); // dedupe (multi-face same person)
}

export async function answerHandler(req: any, res: any): Promise<void> {
  const body = req.body ?? {};
  const text = typeof body.text === "string" ? body.text : "";
  const language: Language = body.language === "en" ? "en" : "ar";
  // Voice settings ride along with the streamed turn so describe/read/VQA honour
  // the user's speed + voice choice, exactly like the discrete /api/tts path.
  // (synthesize() clamps speed to ElevenLabs' valid 0.7–1.2 band.)
  const voicePreset = typeof body.voicePreset === "string" ? body.voicePreset : undefined;
  const speed = typeof body.speed === "number" ? body.speed : undefined;

  if (text.trim().length === 0) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  // Route BEFORE opening the stream so a routing failure can't strand us with
  // half-sent headers. Any throw degrades to "unknown" → client-handled.
  let command: CommandType | "unknown" = "unknown";
  let params: Record<string, string> | undefined;
  try {
    const cleaned = stripAnnotations(text);
    if (cleaned.length > 0) {
      let toRoute = cleaned;
      if (needsScriptNormalization(cleaned, language)) {
        try {
          toRoute = await normalizeTranscription(cleaned, language);
        } catch {
          /* keep cleaned text */
        }
      }
      const routed = await routeCommand(toRoute);
      if (routed) {
        command = routed.command;
        params = routed.params;
      }
    }
  } catch (err) {
    logger.warn("routing failed — treating as client/unknown:", err);
  }

  // Open the NDJSON stream. Headers disable proxy/Bun buffering so chunks reach
  // the phone incrementally (Railway honours X-Accel-Buffering).
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  const write = (ev: AnswerEvent) => {
    try {
      res.write(JSON.stringify(ev) + "\n");
    } catch (err) {
      logger.debug("write after close:", err);
    }
  };

  // Non-streamed commands → the phone keeps its tuned, localized composition.
  if (command === "unknown" || !STREAMED_COMMANDS.has(command)) {
    write({ type: "route", mode: "client", command, params });
    write({ type: "done" });
    res.end();
    return;
  }

  write({ type: "route", mode: "streamed", command });

  // A client disconnect (forward-swipe / cancel aborts the fetch) tears down the
  // in-flight OpenRouter + ElevenLabs work so we stop spending immediately.
  const ac = new AbortController();
  const onClose = () => ac.abort();
  req.on("close", onClose);

  let seq = 0;
  let chunkCount = 0;

  // Synthesize one sentence and write it as the next ordered chunk. Sequential
  // by construction (callers await it), so chunks are emitted in `seq` order;
  // the phone's playback overlaps the server's synthesis of the next sentence.
  const emit = async (chunkText: string): Promise<void> => {
    const t = chunkText.trim();
    if (!t || ac.signal.aborted) return;
    // Bound this one synthesize() call: a hung ElevenLabs fetch would otherwise
    // stall the whole for-await loop. Fold in the client-disconnect signal so a
    // cancel aborts in-flight TTS too.
    const ttsCtl = new AbortController();
    const onAbort = () => ttsCtl.abort();
    ac.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ttsCtl.abort(), TTS_TIMEOUT_MS);
    let audioB64 = "";
    let format: AudioFormat = "mp3_44100_64";
    try {
      const r = await synthesize({ text: t, format: "mp3_44100_64", voicePreset, speed, signal: ttsCtl.signal });
      audioB64 = r.audio.toString("base64");
      format = r.format;
    } catch (err) {
      logger.warn(`TTS failed/timed out for seq ${seq} — skipping audio:`, err);
      return; // best-effort: skip this chunk's audio; text still lands in `final`
    } finally {
      clearTimeout(timer);
      ac.signal.removeEventListener("abort", onAbort);
    }
    if (ac.signal.aborted) return;
    write({ type: "chunk", seq: seq++, text: t, format, audio: audioB64 });
    chunkCount++;
  };

  try {
    const photoToken = typeof body.photoToken === "string" ? body.photoToken : "";
    const image = await waitForBytes(photoToken, PHOTO_WAIT_MS);
    if (!image) {
      // No photo (token missing / expired / never uploaded). Let the phone
      // recover via its discrete path (which can fire a fresh capture).
      write({ type: "error", recoverable: true, message: "photo unavailable" });
      return;
    }
    const imageBase64 = image.toString("base64");

    let fullText: string;
    if (command === "scene-summarize") {
      fullText = await streamScene(imageBase64, language, emit, ac.signal);
    } else if (command === "ocr-read-text") {
      fullText = await streamOcr(imageBase64, language, params, emit, ac.signal);
    } else {
      fullText = await streamVqa(imageBase64, language, params, emit, ac.signal);
    }

    if (ac.signal.aborted) return;
    if (chunkCount === 0) {
      // Produced no audible chunk (e.g. every TTS call failed) → recover discretely.
      write({ type: "error", recoverable: true, message: "no audio produced" });
    } else {
      write({ type: "final", text: fullText });
    }
  } catch (err: any) {
    logger.error("answer stream failed:", err);
    // Before the first chunk we can still fall back; after it we must not (would double-speak).
    write({ type: "error", recoverable: chunkCount === 0, message: err?.message });
  } finally {
    write({ type: "done" });
    req.removeListener("close", onClose);
    res.end();
  }
}

/* ── Per-command streaming routines ──────────────────────────────────────── */

/**
 * Streams sentences from a vision prompt, applying an optional character budget.
 * Emits whole sentences while under budget; when the next would overflow, stops
 * and (if a suffix is given) speaks it as a final chunk. Returns the full spoken
 * body text (for the `final` event / lastResponse).
 */
async function streamCapped(opts: {
  prompt: string;
  imageBase64: string;
  maxTokens: number;
  /** Character budget for the body; 0 = uncapped (token budget bounds it). */
  maxChars: number;
  suffix: string;
  collapseWhitespace: boolean;
  emit: (t: string) => Promise<void>;
  signal: AbortSignal;
}): Promise<string> {
  const { prompt, imageBase64, maxTokens, maxChars, suffix, collapseWhitespace, emit, signal } = opts;
  const splitter = createSentenceSplitter();
  const parts: string[] = [];
  let used = 0;
  let truncated = false;

  // Returns true when the budget is hit (caller should stop the stream).
  const consume = async (raw: string): Promise<boolean> => {
    const s = collapseWhitespace ? raw.replace(/\s+/g, " ").trim() : raw.trim();
    if (!s) return false;
    if (maxChars > 0 && used + s.length > maxChars) {
      truncated = true;
      return true; // stop before emitting the overflowing sentence
    }
    parts.push(s);
    used += s.length;
    await emit(s);
    return false;
  };

  outer: for await (const delta of streamVisionContent(prompt, imageBase64, maxTokens, signal)) {
    if (signal.aborted) break;
    for (const sentence of splitter.push(delta)) {
      if (await consume(sentence)) break outer;
    }
  }
  if (!truncated && !signal.aborted) {
    const tail = splitter.flush();
    if (tail) await consume(tail);
  }

  if (truncated && !signal.aborted) {
    await emit(suffix.trim());
    return (parts.join(" ") + suffix).trim();
  }
  return parts.join(" ").trim();
}

/** Scene: speak recognized names first (chunk seq 0), then the streamed scene. */
async function streamScene(
  imageBase64: string,
  language: Language,
  emit: (t: string) => Promise<void>,
  signal: AbortSignal,
): Promise<string> {
  // Faces resolve before scene sentences so names lead (matches describe.ts).
  // One Rekognition call (~fast); failure just drops the names.
  const faces = await recognizeAllFaces(imageBase64).catch((err): MultiFaceResult | null => {
    logger.warn("recognize-all failed (continuing without names):", err);
    return null;
  });
  if (signal.aborted) return "";

  const prefix = namesPrefix(knownNamesFrom(faces), language);
  if (prefix) await emit(prefix); // emit() trims → "Ahmad."

  const body = await streamCapped({
    prompt: buildScenePrompt(language),
    imageBase64,
    maxTokens: 200,
    maxChars: MAX_SCENE_CHARS - prefix.length,
    suffix: TRUNCATION_SUFFIX[language],
    collapseWhitespace: false,
    emit,
    signal,
  });
  return (prefix + body).trim();
}

/** OCR: collapse whitespace, cap at 400 chars, speak a "no text" line when empty. */
async function streamOcr(
  imageBase64: string,
  language: Language,
  params: Record<string, string> | undefined,
  emit: (t: string) => Promise<void>,
  signal: AbortSignal,
): Promise<string> {
  const context = typeof params?.context === "string" ? params.context : undefined;
  const body = await streamCapped({
    prompt: buildOcrPrompt(language, context),
    imageBase64,
    maxTokens: 500,
    maxChars: OCR_MAX_CHARS,
    suffix: TRUNCATION_SUFFIX[language],
    collapseWhitespace: true,
    emit,
    signal,
  });
  if (!body && !signal.aborted) {
    const msg = NO_TEXT_MESSAGE[language];
    await emit(msg);
    return msg;
  }
  return body;
}

/** VQA: free-text answer, uncapped (the 200-token budget bounds it). */
async function streamVqa(
  imageBase64: string,
  language: Language,
  params: Record<string, string> | undefined,
  emit: (t: string) => Promise<void>,
  signal: AbortSignal,
): Promise<string> {
  const question =
    typeof params?.question === "string" && params.question.trim().length > 0
      ? params.question.trim()
      : language === "ar"
        ? "ماذا ترى؟"
        : "What do you see?";
  return streamCapped({
    prompt: buildVqaPrompt(question, language),
    imageBase64,
    maxTokens: 200,
    maxChars: 0,
    suffix: "",
    collapseWhitespace: false,
    emit,
    signal,
  });
}
