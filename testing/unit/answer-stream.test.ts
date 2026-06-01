import { afterEach, describe, expect, test } from "bun:test";
import { createSentenceSplitter, streamVisionContent } from "../../src/services/vision-service";
import { sseResponse } from "../helpers/mock-answer-backends";

// Streaming primitives behind POST /api/answer: the sentence splitter (pure) and
// the OpenRouter SSE consumer (fetch stubbed — no network).

describe("createSentenceSplitter", () => {
  test("flushes each completed sentence as a terminator arrives (first ASAP)", () => {
    const s = createSentenceSplitter();
    expect(s.push("There is a desk")).toEqual([]); // no terminator yet
    expect(s.push(" in front of you. A laptop")).toEqual(["There is a desk in front of you."]);
    expect(s.push(" sits on it.")).toEqual(["A laptop sits on it."]);
    expect(s.flush()).toBeNull();
  });

  test("handles ? and ! and ellipsis", () => {
    const s = createSentenceSplitter();
    expect(s.push("Is the door open? Yes! Wait…")).toEqual(["Is the door open?", "Yes!", "Wait…"]);
  });

  test("Arabic question mark ؟ and full stop ۔ are terminators", () => {
    const s = createSentenceSplitter();
    expect(s.push("ما هذا؟ شكراً۔")).toEqual(["ما هذا؟", "شكراً۔"]);
  });

  test("terminator-less run flushes at the soft cap on a word boundary", () => {
    const s = createSentenceSplitter();
    const long = "word ".repeat(60).trim(); // ~300 chars, no punctuation (dense OCR)
    const out = s.push(long);
    expect(out.length).toBeGreaterThanOrEqual(1);
    // every emitted chunk stays under a sane bound
    for (const c of out) expect(c.length).toBeLessThanOrEqual(170);
  });

  test("flush returns the trailing remainder once", () => {
    const s = createSentenceSplitter();
    s.push("tail with no terminator");
    expect(s.flush()).toBe("tail with no terminator");
    expect(s.flush()).toBeNull();
  });
});

describe("streamVisionContent (OpenRouter SSE)", () => {
  let saved: typeof globalThis.fetch;
  afterEach(() => {
    if (saved) globalThis.fetch = saved;
  });

  function stub(res: Response) {
    saved = globalThis.fetch;
    globalThis.fetch = (async () => res) as unknown as typeof globalThis.fetch;
  }

  async function collect(): Promise<string> {
    let out = "";
    for await (const d of streamVisionContent("p", "img", 200)) out += d;
    return out;
  }

  test("yields content deltas, skips keep-alive comments, stops at [DONE]", async () => {
    stub(sseResponse(["Hello", " world", "."]));
    expect(await collect()).toBe("Hello world.");
  });

  test("preserves Arabic when multi-byte sequences split across network chunks", async () => {
    // Build a stream where the UTF-8 bytes of "مرحبا" are cut mid-character.
    const enc = new TextEncoder();
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "مرحبا" } }] })}\n\n`;
    const bytes = enc.encode(line);
    const mid = Math.floor(bytes.length / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, mid));
        c.enqueue(bytes.slice(mid));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
    stub(new Response(stream, { status: 200 }));
    expect(await collect()).toBe("مرحبا");
  });

  test("throws on a non-2xx response", async () => {
    stub(new Response("nope", { status: 500 }));
    await expect(collect()).rejects.toThrow();
  });
});
