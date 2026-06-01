import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mocks, resetMocks, loadListening, waitFor } from "../helpers/listening-harness";
import { messages } from "../../src/i18n/messages";

// Drives the REAL listening state machine with mocked IO. Covers the
// transitions (ST-L1/L2), the confidence/echo/validity filters, and intent→
// dispatch routing.

let L: Awaited<ReturnType<typeof loadListening>>;

beforeAll(async () => {
  L = await loadListening();
});
beforeEach(() => {
  resetMocks();
  L.reset();
});

describe("transitions", () => {
  test("ST-L1: idle → active → processing → idle (happy path streams the answer)", async () => {
    await L.activate();
    await waitFor(() => mocks.lastResponse !== null);
    expect(mocks.cues).toContain("listening"); // entered active
    expect(mocks.cues).toContain("got-it"); // entered processing
    expect(mocks.cues).toContain("working"); // thinking cue during the wait
    expect(mocks.streamedCalls).toContain("describe the room"); // merged /api/answer called
    expect(mocks.lastResponse).toBe("a tidy room"); // streamed answer stored for repeat
    expect(mocks.dispatched).toHaveLength(0); // streamed, not discretely dispatched
    expect(L.getListeningState()).toBe("idle"); // back to idle
  });

  test("ST-L2: idle → active → idle when no audio is captured", async () => {
    mocks.capture = null;
    await L.activate();
    await waitFor(() => mocks.speakCalls.length > 0);
    expect(mocks.cues).toContain("listening");
    expect(mocks.dispatched).toHaveLength(0); // never dispatched
    expect(mocks.speakCalls).toContain(messages.didntCatch.en);
    expect(L.getListeningState()).toBe("idle");
  });
});

describe("transcription filters", () => {
  test("MIN_CONFIDENCE: low-confidence transcription is rejected", async () => {
    await L.processTranscription("describe the room", 0.3);
    expect(mocks.dispatched).toHaveLength(0);
    expect(mocks.speakCalls).toContain(messages.didntCatch.en);
  });

  test("TTS echo guard: a transcription while speaking is ignored entirely", async () => {
    L.useListening.setState({ speaking: true });
    await L.processTranscription("describe the room", 0.95);
    expect(mocks.speakCalls).toHaveLength(0); // no finishProcessing at all
    expect(mocks.dispatched).toHaveLength(0);
  });

  test("invalid transcription (junk) is rejected before routing", async () => {
    await L.processTranscription("@@", 0.95);
    expect(mocks.dispatched).toHaveLength(0);
    expect(mocks.speakCalls).toContain(messages.didntCatch.en);
  });
});

describe("intent → dispatch routing", () => {
  test("routed command maps to the matching handler", async () => {
    mocks.route = { command: "color-detect", rawText: "what color is this" };
    await L.processTranscription("what color is this", 0.95);
    await waitFor(() => mocks.dispatched.length > 0);
    expect(mocks.dispatched).toContain("executeColor");
  });

  test('"unknown" command speaks the help message and does not dispatch', async () => {
    mocks.route = { command: "unknown", rawText: "what time is it" };
    await L.processTranscription("what time is it", 0.95);
    expect(mocks.dispatched).toHaveLength(0);
    expect(mocks.speakCalls).toContain(messages.unknownCommand.en);
  });
});
