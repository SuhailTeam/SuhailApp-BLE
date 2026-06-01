import { fetch as expoFetch } from "expo/fetch";
import type { Language } from "../i18n/messages";
import type { AudioFormat } from "./tts";
import type { CommandType } from "./intent";
import { authHeaders, buildUrl, withTimeout } from "./client";
import { Logger } from "../utils/logger";

const logger = new Logger("Relay.Answer");

/**
 * NDJSON events streamed by POST /api/answer. Mirrors the server's `AnswerEvent`
 * union in src/types/index.ts (kept in sync by hand — the two halves don't share
 * a build).
 */
export type AnswerEvent =
  | { type: "route"; mode: "streamed"; command: CommandType }
  | { type: "route"; mode: "client"; command: CommandType; params?: Record<string, string> }
  | { type: "chunk"; seq: number; text: string; format: AudioFormat; audio: string }
  | { type: "final"; text: string }
  | { type: "error"; recoverable: boolean; message?: string }
  | { type: "done" };

/** Whole-answer ceiling — the streamed answer flows on one connection, so this is
 *  much higher than the per-request 30s used elsewhere. */
const ANSWER_STREAM_TIMEOUT_MS = 45_000;

/**
 * Streams POST /api/answer and invokes `onEvent` for each parsed NDJSON event in
 * order. Uses `expo/fetch` (SDK 52+) for an incrementally-readable response body
 * — the global RN fetch buffers, so it can't be used here.
 *
 * Throws on transport failure (network error, non-2xx, or abort). Parsing is
 * line-buffered; `TextDecoder({stream:true})` keeps multi-byte UTF-8 (Arabic)
 * intact across chunk boundaries.
 */
export async function requestAnswerStream(
  body: { text: string; photoToken: string; language: Language },
  signal: AbortSignal | undefined,
  onEvent: (ev: AnswerEvent) => void | Promise<void>,
): Promise<void> {
  const res = await expoFetch(buildUrl("/api/answer"), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify(body),
    signal: withTimeout(signal, ANSWER_STREAM_TIMEOUT_MS),
  });

  if (!res.ok || !res.body) {
    throw new Error(`/api/answer HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = createNdjsonDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of decoder.push(value)) await onEvent(ev);
  }
  for (const ev of decoder.flush()) await onEvent(ev);
}

/**
 * Incremental NDJSON decoder: feed it raw byte chunks (`push`), get back the
 * events whose lines have completed. `TextDecoder({stream:true})` carries any
 * partial multi-byte UTF-8 sequence (e.g. Arabic split mid-character across two
 * network chunks) into the next push. `flush()` returns a trailing line with no
 * final newline. Exposed for unit testing the cross-chunk handling.
 */
export function createNdjsonDecoder() {
  const decoder = new TextDecoder();
  let buf = "";
  const drain = (final: boolean): AnswerEvent[] => {
    const out: AnswerEvent[] = [];
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      const ev = parseEvent(line);
      if (ev) out.push(ev);
    }
    if (final) {
      const ev = parseEvent(buf.trim());
      buf = "";
      if (ev) out.push(ev);
    }
    return out;
  };
  return {
    push(bytes: Uint8Array): AnswerEvent[] {
      buf += decoder.decode(bytes, { stream: true });
      return drain(false);
    },
    flush(): AnswerEvent[] {
      buf += decoder.decode(); // flush any trailing partial multibyte
      return drain(true);
    },
  };
}

function parseEvent(line: string): AnswerEvent | null {
  if (!line) return null;
  try {
    return JSON.parse(line) as AnswerEvent;
  } catch {
    logger.debug(`skipping unparseable NDJSON line: ${line.slice(0, 80)}`);
    return null;
  }
}
