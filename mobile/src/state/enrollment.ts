/**
 * State container for the stateful face-enroll command (slice 3d).
 *
 * Two-step flow:
 *   1. User: "enroll this person"
 *      → dispatchCommand routes to face-enroll
 *      → executeEnrollStep1 captures a photo, stores its token via
 *        setPendingPhoto(), returns the bilingual "say the name" prompt
 *      → listening.ts schedules a 30s timeout that auto-clears + speaks
 *        the "timed out" message if the user doesn't respond
 *   2. User swipes again, says "<name>"
 *      → processTranscription checks hasPending() BEFORE the intent
 *        classifier — if set, the text is the name (not a command)
 *      → completeEnrollment() in commands/enroll.ts validates, calls
 *        /api/faces/enroll with the cached photoToken, returns success
 *        or failure speech
 *
 * Single-user mobile = single module-level slot (cloud version keys these
 * by sessionId; we have one device, one session).
 *
 * Mirrors src/commands/face-enroll.ts: pendingEnrollments + enrollmentTimers
 * + processingEnrollments + interruptedEnrollments — minus the per-session
 * Map indirection.
 */

let pendingPhotoToken: string | null = null;
let processing = false;
let interrupted = false;

/** Stores the photo token captured in step 1, awaiting the name. Clears any
 *  prior interrupt marker — a fresh enrollment supersedes a stale one. */
export function setPendingPhoto(token: string): void {
  pendingPhotoToken = token;
  interrupted = false;
}

/** Returns the pending photo token, or null. Doesn't consume — see consume(). */
export function getPendingPhoto(): string | null {
  return pendingPhotoToken;
}

/** Returns and clears the pending photo token. One-shot per step-2 completion. */
export function consumePendingPhoto(): string | null {
  const t = pendingPhotoToken;
  pendingPhotoToken = null;
  return t;
}

/** Clears pending state without marking interrupted (e.g. on timeout). */
export function clearPending(): void {
  pendingPhotoToken = null;
}

/**
 * True if step 1 has run AND step 2 isn't currently processing — i.e. we are
 * waiting for the name. listening.ts's processTranscription checks this
 * before the intent classifier to intercept the name transcription.
 */
export function hasPending(): boolean {
  return pendingPhotoToken !== null && !processing;
}

/**
 * Atomic begin-processing flag (CAS-style). Returns true if we acquired the
 * lock, false if another completion is already in flight (defensive against
 * double-fire — shouldn't happen with the listening state machine, but
 * cloud version guards it so we do too).
 */
export function markProcessing(): boolean {
  if (processing) return false;
  processing = true;
  return true;
}

export function unmarkProcessing(): void {
  processing = false;
}

/**
 * Called from cancel paths (left short press, etc.). Sets the interrupted
 * flag so any in-flight completion (markProcessing == true) discards its
 * result, and clears the pending photo so a new enrollment starts fresh.
 */
export function interrupt(): boolean {
  const hadState = pendingPhotoToken !== null || processing;
  if (!hadState) return false;
  interrupted = true;
  pendingPhotoToken = null;
  return true;
}

/**
 * Reads + resets the interrupted flag. completeEnrollment() checks this
 * after the network call returns — if set, suppresses success speech so
 * the user hears the cancel cue, not "X has been enrolled".
 */
export function takeInterruptedFlag(): boolean {
  const v = interrupted;
  interrupted = false;
  return v;
}
