import { createAudioPlayer } from "expo-audio";
import { ensureAudioMode } from "./playback";
import { getSettings } from "../state/settings";
import { Logger } from "../utils/logger";

const logger = new Logger("Audio.ThinkingCue");

/**
 * A subtle "working" earcon played while the user waits for an answer (after the
 * "got-it" cue, until the first spoken chunk arrives). It runs on its OWN
 * expo-audio player — NOT the serialized playback queue — because it loops for
 * the duration of the wait and must not block the answer chunks behind it.
 *
 * Single A2DP stream constraint: the caller MUST `stopThinkingCue()` before the
 * first answer chunk is enqueued, so only one stream is ever active on the
 * glasses speaker. `runStreamedAnswer` does this on the first chunk; the
 * listening machine also stops it on every cancel/disconnect path.
 */
let player: ReturnType<typeof createAudioPlayer> | null = null;

export async function startThinkingCue(): Promise<void> {
  if (player) return; // already running
  try {
    await ensureAudioMode();
    const p = createAudioPlayer(require("../../assets/cues/working.wav"));
    p.loop = true;
    // Quiet — sits under speech and never startles. Honour the user's volume but cap low.
    p.volume = Math.min(0.4, getSettings().volume);
    player = p;
    p.play();
  } catch (err) {
    // Best-effort: a missing/failed cue must never break the answer flow.
    logger.debug(`thinking cue start failed: ${err instanceof Error ? err.message : String(err)}`);
    player = null;
  }
}

export async function stopThinkingCue(): Promise<void> {
  const p = player;
  player = null;
  if (!p) return;
  try {
    p.pause();
    p.remove();
  } catch (err) {
    logger.debug(`thinking cue stop failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
