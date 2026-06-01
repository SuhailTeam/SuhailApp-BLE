import * as FileSystem from "expo-file-system";
import { play } from "./playback";
import { extensionFor } from "./tts";
import { stopThinkingCue } from "./thinkingCue";
import { requestAnswerStream } from "../relay/answer";
import type { CommandType } from "../relay/intent";
import type { Language } from "../i18n/messages";
import { getSettings } from "../state/settings";
import { Logger } from "../utils/logger";

const logger = new Logger("Audio.StreamTTS");

/** Unique temp filenames across rapid chunks. */
let chunkCounter = 0;

/**
 * Outcome of a merged /api/answer turn — tells the listening machine what to do
 * next:
 *   - "spoke"    → streamed chunks were played; `fullText` is the response text.
 *   - "dispatch" → server routed a non-streamed command (or a streamed command
 *                  failed before audio but after routing); run the discrete handler.
 *   - "unknown"  → not a visual command; speak the unknown-command phrase.
 *   - "aborted"  → user interrupted; stay silent.
 *   - "fallback" → streaming was unavailable before any routing; run the legacy
 *                  normalize→classify→dispatch path.
 */
export type StreamedAnswerResult =
  | { kind: "spoke"; fullText: string }
  | { kind: "dispatch"; command: CommandType; params?: Record<string, string> }
  | { kind: "unknown" }
  | { kind: "aborted" }
  | { kind: "fallback" };

export interface RunStreamedAnswerOpts {
  text: string;
  photoToken: string;
  language: Language;
  signal?: AbortSignal;
  /** Fires when the server reports the routed command (for tagTimeline + marks). */
  onRoute?: (command: CommandType, mode: "streamed" | "client") => void;
  /** Fires the instant the FIRST chunk's bytes are received (before write/play). */
  onFirstChunkReceived?: () => void;
  /** Fires the instant the FIRST chunk begins playing (the tts-playback-start mark). */
  onFirstChunkStart?: () => void;
}

/**
 * Drives a POST /api/answer stream: stops the thinking cue on the first chunk,
 * writes each chunk's audio to a temp file, and enqueues it on the serialized
 * playback queue so chunks play back-to-back in order. Resolves only once all
 * enqueued audio has finished playing.
 */
export async function runStreamedAnswer(opts: RunStreamedAnswerOpts): Promise<StreamedAnswerResult> {
  const { text, photoToken, language, signal } = opts;
  const volume = getSettings().volume;

  let mode: "streamed" | "client" | undefined;
  let command: CommandType | undefined;
  let params: Record<string, string> | undefined;
  let fullText = "";
  let recoverable = false;
  let chunkCount = 0;
  const playPromises: Promise<void>[] = [];
  const tempPaths: string[] = [];

  const settle = () => Promise.allSettled(playPromises);
  const cleanup = () => {
    for (const p of tempPaths) FileSystem.deleteAsync(p, { idempotent: true }).catch(() => {});
  };

  try {
    await requestAnswerStream({ text, photoToken, language }, signal, async (ev) => {
      switch (ev.type) {
        case "route":
          mode = ev.mode;
          command = ev.command;
          params = ev.mode === "client" ? ev.params : undefined;
          opts.onRoute?.(ev.command, ev.mode);
          break;
        case "chunk": {
          const isFirst = chunkCount === 0;
          if (isFirst) {
            opts.onFirstChunkReceived?.();
            await stopThinkingCue(); // single A2DP stream: cue off before audio on
          }
          const path = `${FileSystem.cacheDirectory}answer-${chunkCounter++}.${extensionFor(ev.format)}`;
          await FileSystem.writeAsStringAsync(path, ev.audio, { encoding: FileSystem.EncodingType.Base64 });
          tempPaths.push(path);
          playPromises.push(
            play({ uri: path }, {
              volume,
              label: `answer:${ev.seq}`,
              onStart: isFirst ? opts.onFirstChunkStart : undefined,
            }),
          );
          chunkCount += 1;
          break;
        }
        case "final":
          fullText = ev.text;
          break;
        case "error":
          recoverable = ev.recoverable;
          break;
        case "done":
          break;
      }
    });
  } catch (err) {
    // Transport failure (network / non-2xx / abort).
    if (signal?.aborted) {
      await settle();
      cleanup();
      return { kind: "aborted" };
    }
    logger.warn(`answer stream failed: ${err instanceof Error ? err.message : String(err)}`);
    await stopThinkingCue();
    if (chunkCount > 0) {
      // Already speaking — don't double-speak via a fallback. Keep what we have.
      await settle();
      cleanup();
      return { kind: "spoke", fullText };
    }
    // Routing may have arrived before the break — dispatch discretely if so.
    return resolveNoAudio(mode, command, params);
  }

  if (signal?.aborted) {
    await settle();
    cleanup();
    return { kind: "aborted" };
  }

  if (chunkCount > 0) {
    await settle(); // resolve once all chunks have finished playing
    cleanup();
    return { kind: "spoke", fullText };
  }

  // No audio was produced.
  await stopThinkingCue();
  if (mode === "client") {
    return command && command !== "unknown"
      ? { kind: "dispatch", command, params }
      : { kind: "unknown" };
  }
  // Streamed command but no chunk (recoverable server error) → dispatch discretely if we know the command.
  return resolveNoAudio(mode, command, params, recoverable);
}

/** Maps a "no audio produced" situation to a follow-up action. */
function resolveNoAudio(
  mode: "streamed" | "client" | undefined,
  command: CommandType | undefined,
  params: Record<string, string> | undefined,
  _recoverable = true,
): StreamedAnswerResult {
  if (mode === "client") {
    return command && command !== "unknown" ? { kind: "dispatch", command, params } : { kind: "unknown" };
  }
  if (command && command !== "unknown") {
    return { kind: "dispatch", command, params };
  }
  return { kind: "fallback" };
}
