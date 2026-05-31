import { describe, expect, test } from "bun:test";
import { parseColorResponse, parseCurrencyResponse } from "../../src/services/vision-service";

describe("currency parsing (EP from Section 13.2.1)", () => {
  test("groups repeated denominations and computes the dominant-currency total", () => {
    const result = parseCurrencyResponse(JSON.stringify({
      bills: [
        { denomination: 50, count: 2, currency: "sar" },
        { denomination: 10, count: 1, currency: "SAR" },
        { denomination: 50, count: 1, currency: "SAR" },
      ],
    }));

    expect(result.currency).toBe("SAR");
    expect(result.total).toBe(160);
    expect(result.bills).toEqual([
      { denomination: 50, count: 3 },
      { denomination: 10, count: 1 },
    ]);
  });

  test("separates non-dominant currencies", () => {
    const result = parseCurrencyResponse(JSON.stringify({
      bills: [
        { denomination: 100, count: 2, currency: "SAR" },
        { denomination: 20, count: 1, currency: "USD" },
      ],
    }));

    expect(result.currency).toBe("SAR");
    expect(result.total).toBe(200);
    expect(result.otherCurrencies).toEqual([
      { currency: "USD", bills: [{ denomination: 20, count: 1 }], total: 20 },
    ]);
  });

  test("returns an empty UNKNOWN result for malformed or invalid model output", () => {
    expect(parseCurrencyResponse("not json")).toMatchObject({
      bills: [],
      total: 0,
      currency: "UNKNOWN",
    });

    expect(parseCurrencyResponse(JSON.stringify({
      bills: [
        { denomination: 50, count: 0, currency: "SAR" },
        { denomination: -10, count: 1, currency: "SAR" },
      ],
    }))).toMatchObject({
      bills: [],
      total: 0,
      currency: "UNKNOWN",
    });
  });
});

describe("color response parsing (EP from Section 13.2.1)", () => {
  test("extracts dominant color name and hex from raw JSON", () => {
    expect(parseColorResponse(JSON.stringify({ colorName: "red", hex: "#ff0000" }), "en")).toEqual({
      colorName: "red",
      hex: "#ff0000",
    });
  });

  test("supports fenced JSON and falls back on malformed output", () => {
    expect(parseColorResponse("```json\n{\"colorName\":\"blue\",\"hex\":\"#0000ff\"}\n```", "en")).toEqual({
      colorName: "blue",
      hex: "#0000ff",
    });

    expect(parseColorResponse("not json", "ar")).toEqual({
      colorName: "غير معروف",
      hex: "#000000",
    });
  });
});
