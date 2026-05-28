/**
 * Async test utilities. The listening state machine fires its session as
 * `void runListenSession(...)` (not awaited by the caller), so tests need to
 * let the microtask/timer queue drain and observe the resulting state.
 */

/** Yields to the microtask + macrotask queue once (real timers). */
export function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * Drains the microtask queue `rounds` times WITHOUT advancing timers. Safe to
 * use under jest fake timers (where setTimeout(0) would not fire) to let
 * awaited continuations run after a synchronous timer callback resolves a
 * pending promise.
 */
export async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

/** Polls `predicate` until true or `timeoutMs` elapses (real timers). */
export async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition not met within timeout");
    }
    await tick();
  }
}

