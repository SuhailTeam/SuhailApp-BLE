import { describe, expect, test } from "bun:test";
import { parseCsv, decodeSession, SESSION_HEADER_7 } from "./csv";

const HEADER = SESSION_HEADER_7.join(",");

describe("parseCsv (RFC 4180)", () => {
  test("parses a simple grid", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("keeps a comma inside a quoted field (the transcript column)", () => {
    expect(parseCsv('a,"hello, world",c')).toEqual([["a", "hello, world", "c"]]);
  });

  test("unescapes doubled quotes", () => {
    expect(parseCsv('"she said ""hi"""')).toEqual([['she said "hi"']]);
  });

  test("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a,"line1\nline2",c')).toEqual([["a", "line1\nline2", "c"]]);
  });

  test("a trailing newline does not produce a spurious empty row", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("empty input yields no rows", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("decodeSession", () => {
  test("decodes the app's 7-column export with seconds", () => {
    const csv = `${HEADER}\n2026-06-01T10:00:00.000Z,1 · scene-summarize,scene-summarize,3.10,0.80,4.50,"a, b"`;
    const rows = decodeSession(parseCsv(csv));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      iso: "2026-06-01T10:00:00.000Z",
      task: "1 · scene-summarize",
      command: "scene-summarize",
      timeToFirstWordS: 3.1,
      endUtteranceToFirstWordS: 0.8,
      totalS: 4.5,
      transcript: "a, b",
      success: null,
    });
  });

  test("blank numeric cells decode to null, never 0", () => {
    const csv = `${HEADER}\n2026-06-01T10:01:00.000Z,2 · ocr,ocr-read-text,,,2.50,`;
    const [row] = decodeSession(parseCsv(csv));
    expect(row?.timeToFirstWordS).toBeNull();
    expect(row?.endUtteranceToFirstWordS).toBeNull();
    expect(row?.totalS).toBe(2.5);
    expect(row?.transcript).toBe("");
  });

  test("reads an optional 8th success column when present", () => {
    const csv = `${HEADER},success\n2026-06-01T10:00:00.000Z,1 · scene-summarize,scene-summarize,3.1,0.8,4.5,,1\n2026-06-01T10:02:00.000Z,1 · scene-summarize,scene-summarize,3.0,0.7,4.4,,0`;
    const rows = decodeSession(parseCsv(csv));
    expect(rows.map((r) => r.success)).toEqual([1, 0]);
  });

  test("throws on a header mismatch (loud drift signal)", () => {
    expect(() => decodeSession(parseCsv("iso,task,wrong\n"))).toThrow(/header mismatch/);
  });
});

describe("SESSION_HEADER_7 matches the mobile app export", () => {
  test("equals the literal USABILITY_CSV_HEADER in the mobile source", async () => {
    const src = await Bun.file(`${import.meta.dir}/../../mobile/src/state/usabilityLog.ts`).text();
    const block = src.match(/USABILITY_CSV_HEADER\s*=\s*\[([\s\S]*?)\]/);
    expect(block).not.toBeNull();
    const headers = [...block![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(headers).toEqual([...SESSION_HEADER_7]);
  });
});
