import { play } from "./playback";

export type CueType = "listening" | "got-it" | "cancelled";

// `require` returns a Metro asset id (number) that expo-audio accepts as AudioSource.
// These imports are statically resolvable so Metro can bundle them.
const ASSETS: Record<CueType, number> = {
  "listening": require("../../assets/cues/listening.wav"),
  "got-it": require("../../assets/cues/got-it.wav"),
  "cancelled": require("../../assets/cues/cancelled.wav"),
};

/**
 * Plays one of the bundled cue chimes. Resolves when the chime finishes
 * (typically ~200 ms). Rejects with Error("interrupted") if stopAll() races.
 *
 * Cues are bundled via require() so they're available offline and don't go
 * through the relay. Volume is intentionally a bit quieter than speech so
 * the chime doesn't startle the user.
 */
export function playCue(type: CueType): Promise<void> {
  return play(ASSETS[type], { volume: 0.7, label: `cue:${type}` });
}
