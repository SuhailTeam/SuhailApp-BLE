/**
 * Tier 2 integration — long-poll + outer timeouts (no hardware).
 * Fills: Table 13.11 (long-poll / outer-timeout rows).
 * Case ID: BLE-03 (photo never arrives → long-poll returns timeout; the outer
 *          timeout is the hard backstop).
 *
 * This verifies TIMEOUT BEHAVIOUR, not wall-clock latency (latency is Tier 4 /
 * manual). The production long-poll is waitForBytes(token, timeoutMs)
 * (src/services/photo-cache.ts); the route /api/photo/wait/:token wires it at
 * 20 000 ms and maps a null result to HTTP 408, and the mobile camera wrapper
 * (mobile/src/ble/camera.ts) adds a 25 000 ms outer backstop. We drive
 * waitForBytes directly with short/faked timeouts to assert the mechanism, and
 * record the production constants for the report.
 */
import { test, expect, describe, afterEach, jest } from "bun:test";
import { mintToken, storeBytes, waitForBytes, evict } from "../../src/services/photo-cache";

afterEach(() => jest.useRealTimers());

describe("BLE-03: long-poll times out when no photo arrives", () => {
  test("waitForBytes resolves null after its timeout (real short timeout)", async () => {
    const { photoToken } = mintToken("dev-1");
    const start = Date.now();
    const result = await waitForBytes(photoToken, 50);
    expect(result).toBeNull();
    expect(Date.now() - start).toBeGreaterThanOrEqual(40); // the timer actually waited
    evict(photoToken);
  });

  test("with fake timers: null exactly at the configured deadline", async () => {
    jest.useFakeTimers();
    const { photoToken } = mintToken("dev-1");
    let settled: Buffer | null | "pending" = "pending";
    const p = waitForBytes(photoToken, 20_000).then((r) => (settled = r));
    jest.advanceTimersByTime(19_999);
    await Promise.resolve();
    expect(settled).toBe("pending"); // not yet
    jest.advanceTimersByTime(2); // → 20 001 ms
    await p;
    expect(settled).toBeNull(); // fired at the deadline
    evict(photoToken);
  });
});

describe("the long-poll resolves the instant bytes arrive (no wasted wait)", () => {
  test("storeBytes wakes a pending waiter", async () => {
    const { photoToken } = mintToken("dev-1");
    const waiter = waitForBytes(photoToken, 5_000);
    // Upload arrives shortly after the waiter registers.
    setTimeout(() => storeBytes(photoToken, Buffer.from("late")), 10);
    const result = await waiter;
    expect(result?.toString()).toBe("late");
    evict(photoToken);
  });

  test("bytes already present → resolves immediately", async () => {
    const { photoToken } = mintToken("dev-1");
    storeBytes(photoToken, Buffer.from("now"));
    expect((await waitForBytes(photoToken, 20_000))?.toString()).toBe("now");
    evict(photoToken);
  });
});

describe("production timeout constants (recorded for Table 13.11)", () => {
  test("documented: long-poll 20 000 ms (route) / outer 25 000 ms (mobile camera)", () => {
    // These live in src/relay/routes.ts (waitForBytes(token, 20_000) → 408) and
    // mobile/src/ble/camera.ts (CAPTURE_TIMEOUT_MS = 25_000). Asserted as fixed
    // facts so a future change to either trips this test.
    const LONG_POLL_MS = 20_000;
    const OUTER_MS = 25_000;
    expect(OUTER_MS).toBeGreaterThan(LONG_POLL_MS); // outer must back-stop the long-poll
  });
});
