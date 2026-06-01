import { describe, expect, test } from "bun:test";
import { createNdjsonDecoder } from "../../src/relay/answer";

// The /api/answer NDJSON decoder: line buffering across arbitrary byte-chunk
// boundaries, multi-byte UTF-8 (Arabic) split mid-character, trailing flush, and
// skipping blank / unparseable lines. Pure — no expo/fetch involved.

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);

describe("createNdjsonDecoder", () => {
  test("parses multiple complete events in one push", () => {
    const d = createNdjsonDecoder();
    const evs = d.push(
      bytes('{"type":"route","mode":"streamed","command":"visual-qa"}\n{"type":"final","text":"hi"}\n'),
    );
    expect(evs.map((e) => e.type)).toEqual(["route", "final"]);
  });

  test("buffers a line split across two pushes", () => {
    const d = createNdjsonDecoder();
    expect(d.push(bytes('{"type":"chunk","seq":0,'))).toEqual([]); // incomplete line
    const evs = d.push(bytes('"text":"hello","format":"mp3_44100_64","audio":"AAAA"}\n'));
    expect(evs).toHaveLength(1);
    expect((evs[0] as any).seq).toBe(0);
  });

  test("preserves Arabic when UTF-8 bytes split mid-character across chunks", () => {
    const d = createNdjsonDecoder();
    const line = bytes('{"type":"final","text":"مرحبا بك"}\n');
    const mid = Math.floor(line.length / 2);
    d.push(line.slice(0, mid)); // likely cuts a multi-byte codepoint
    const evs = d.push(line.slice(mid));
    expect((evs[0] as any).text).toBe("مرحبا بك");
  });

  test("flush emits a trailing line that had no newline", () => {
    const d = createNdjsonDecoder();
    expect(d.push(bytes('{"type":"done"}'))).toEqual([]); // no newline yet
    expect(d.flush().map((e) => e.type)).toEqual(["done"]);
  });

  test("skips blank and unparseable lines", () => {
    const d = createNdjsonDecoder();
    const evs = d.push(bytes('\n: keep-alive comment\n{bad json}\n{"type":"done"}\n'));
    expect(evs.map((e) => e.type)).toEqual(["done"]);
  });
});
