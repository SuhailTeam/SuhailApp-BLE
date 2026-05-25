/**
 * In-memory cache of the last spoken response, used for "repeat" (backward
 * swipe / left long press). Cloud version keyed by sessionId; we have one
 * device per app install, so a single value is fine.
 *
 * Not persisted — clears on app restart. The cloud version is also per-session
 * (so it clears when the user disconnects).
 */
let last: string | null = null;

export function setLastResponse(text: string): void {
  last = text;
}

export function getLastResponse(): string | null {
  return last;
}

export function clearLastResponse(): void {
  last = null;
}
