import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mocks, resetMocks, loadListening, waitFor } from "../helpers/listening-harness";

// Covers the merged /api/answer dispatch branches in the listening machine:
// streamed-spoke, client-dispatch, legacy fallback, and abort.

let L: Awaited<ReturnType<typeof loadListening>>;

beforeAll(async () => {
  L = await loadListening();
});
beforeEach(() => {
  resetMocks();
  L.reset();
});

describe("merged answer dispatch", () => {
  test("streamed command (scene/ocr/vqa) → spoken via the stream, stored for repeat, no discrete dispatch", async () => {
    mocks.route = { command: "visual-qa", params: { question: "what is this" }, rawText: "what is this" };
    await L.processTranscription("what is this", 0.95);
    await waitFor(() => mocks.lastResponse !== null);
    expect(mocks.streamedCalls).toContain("what is this");
    expect(mocks.lastResponse).toBe(mocks.reply);
    expect(mocks.dispatched).toHaveLength(0);
    expect(L.getListeningState()).toBe("idle");
  });

  test("structured command (currency) → client-mode discrete dispatch, not streamed audio", async () => {
    mocks.route = { command: "currency-recognize", rawText: "money" };
    await L.processTranscription("money", 0.95);
    await waitFor(() => mocks.dispatched.length > 0);
    expect(mocks.dispatched).toContain("executeMoney");
    expect(mocks.speakCalls).toContain(mocks.reply);
  });

  test("streaming unavailable (fallback) → legacy normalize → classify → dispatch", async () => {
    mocks.forceStreamOutcome = { kind: "fallback" };
    mocks.route = { command: "scene-summarize", rawText: "describe the room" };
    await L.processTranscription("describe the room", 0.95);
    await waitFor(() => mocks.dispatched.length > 0);
    expect(mocks.dispatched).toContain("executeDescribe"); // legacy path dispatched
  });

  test("aborted stream → stays silent, no dispatch, nothing stored", async () => {
    mocks.forceStreamOutcome = { kind: "aborted" };
    await L.processTranscription("describe the room", 0.95);
    expect(mocks.speakCalls).toHaveLength(0);
    expect(mocks.dispatched).toHaveLength(0);
    expect(mocks.lastResponse).toBeNull();
    expect(L.getListeningState()).toBe("idle");
  });
});
