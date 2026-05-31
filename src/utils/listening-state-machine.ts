import type { ListeningState } from "../types";

export const LISTENING_GRACE_MS = 1_000;
export const LISTENING_TIMEOUT_MS = 10_000;
export const TTS_ECHO_BUFFER_MS = 1_500;

export type ListeningEvent = "wake" | "transcription" | "timeout" | "processingDone";

export function transitionListeningState(
  state: ListeningState,
  event: ListeningEvent,
): ListeningState {
  if (state === "idle" && event === "wake") return "active";
  if (state === "active" && event === "transcription") return "processing";
  if (state === "active" && event === "timeout") return "idle";
  if (state === "processing" && event === "processingDone") return "idle";
  return state;
}

export function shouldAcceptTranscriptionEvent(input: {
  state: ListeningState;
  elapsedSinceActivationMs: number;
  isSpeaking: boolean;
  confidence: number;
  minConfidence: number;
}): boolean {
  return input.state === "active" &&
    !input.isSpeaking &&
    input.elapsedSinceActivationMs >= LISTENING_GRACE_MS &&
    input.elapsedSinceActivationMs <= LISTENING_TIMEOUT_MS &&
    input.confidence >= input.minConfidence;
}
