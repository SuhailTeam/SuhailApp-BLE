import type { Language } from "../i18n/messages";
import { postJson } from "./client";

export type CommandType =
  | "scene-summarize"
  | "ocr-read-text"
  | "face-recognize"
  | "face-enroll"
  | "find-object"
  | "currency-recognize"
  | "color-detect"
  | "visual-qa"
  | "unknown";

export interface RouteResult {
  command: CommandType;
  params?: Record<string, string>;
  rawText: string;
}

/** Calls POST /api/intent on the relay. Returns "unknown" command on no match. */
export async function classifyIntent(
  text: string,
  language: Language,
  signal?: AbortSignal,
): Promise<RouteResult> {
  return postJson<RouteResult>("/api/intent", { text, language }, { signal, timeoutMs: 5_000 });
}
