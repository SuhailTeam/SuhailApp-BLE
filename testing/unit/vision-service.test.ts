import { describe, expect, test } from "bun:test";
import {
  parseCurrencyResponse,
  cleanJSON,
  resolveLanguage,
  langInstruction,
  langName,
} from "../../src/services/vision-service";

// Pure parsing/formatting helpers of the vision service (no network).

describe("parseCurrencyResponse (EP-08/09 currency tally)", () => {
  test("single denomination → grouped count and total", () => {
    const r = parseCurrencyResponse('{"bills":[{"denomination":50,"count":3,"currency":"SAR"}]}');
    expect(r.currency).toBe("SAR");
    expect(r.bills).toEqual([{ denomination: 50, count: 3 }]);
    expect(r.total).toBe(150);
  });

  test("merges repeated denominations within a currency", () => {
    const r = parseCurrencyResponse(
      '{"bills":[{"denomination":50,"count":1,"currency":"SAR"},{"denomination":50,"count":2,"currency":"SAR"}]}',
    );
    expect(r.bills).toEqual([{ denomination: 50, count: 3 }]);
    expect(r.total).toBe(150);
  });

  test("mixed currencies → largest-total is dominant, rest in otherCurrencies", () => {
    const r = parseCurrencyResponse(
      '{"bills":[{"denomination":50,"count":2,"currency":"SAR"},{"denomination":1,"count":5,"currency":"USD"}]}',
    );
    expect(r.currency).toBe("SAR");
    expect(r.total).toBe(100);
    expect(r.otherCurrencies?.[0]?.currency).toBe("USD");
    expect(r.otherCurrencies?.[0]?.total).toBe(5);
  });

  test("malformed JSON → empty result, never throws", () => {
    const r = parseCurrencyResponse("not json");
    expect(r).toEqual({ bills: [], total: 0, currency: "UNKNOWN", confidence: 0.9 });
  });

  test("empty / invalid bills → empty result", () => {
    expect(parseCurrencyResponse('{"bills":[]}').bills).toEqual([]);
    // denomination 0 is invalid → filtered out
    expect(parseCurrencyResponse('{"bills":[{"denomination":0,"count":5,"currency":"SAR"}]}').bills).toEqual([]);
  });

  test("tolerates markdown code fences", () => {
    const r = parseCurrencyResponse('```json\n{"bills":[{"denomination":100,"count":1,"currency":"SAR"}]}\n```');
    expect(r.total).toBe(100);
  });
});

describe("cleanJSON", () => {
  test("strips ```json fences and trims", () => {
    expect(cleanJSON('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(cleanJSON('```{"a":1}```')).toBe('{"a":1}');
  });
});

describe("language helpers", () => {
  test("resolveLanguage falls back to the configured default", () => {
    expect(resolveLanguage(undefined)).toBe("ar"); // DEFAULT_LANGUAGE in preload
    expect(resolveLanguage("en")).toBe("en");
  });
  test("langInstruction / langName are bilingual", () => {
    expect(langInstruction("ar")).toBe("Respond in Arabic.");
    expect(langInstruction("en")).toBe("Respond in English.");
    expect(langName("ar")).toBe("Arabic");
    expect(langName("en")).toBe("English");
  });
});
