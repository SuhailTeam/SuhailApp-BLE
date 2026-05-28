/**
 * Tier 1 unit — currency per-denomination tally.
 * Fills: Table 13.9 (currency per-denomination tally).
 * Case IDs: EP-08 (three 50-SAR notes → count + total),
 *           EP-09 (mixed pile → per-denomination counts + total).
 *
 * The tally/sum/grouping is pure (parseCurrencyResponse in
 * src/services/vision-service.ts) but private. Per "call production code", we
 * drive the public recognizeCurrency() and stub the OpenRouter `fetch` to
 * return the model's JSON — so the REAL parsing/grouping/sum runs.
 */
import { test, expect, describe, afterEach } from "bun:test";
import { recognizeCurrency } from "../../src/services/vision-service";
import { setApiKey, restore, mockLLMContent } from "../helpers/openrouter-mock";

const IMG = "ZmFrZQ=="; // base64 placeholder; never decoded (fetch is stubbed)

function modelBills(bills: Array<{ denomination: number; count: number; currency: string }>): void {
  setApiKey("test-key");
  mockLLMContent(JSON.stringify({ bills, notes: "" }));
}

afterEach(() => restore());

describe("EP-08: three 50-SAR notes", () => {
  test("count 3, total 150, currency SAR", async () => {
    modelBills([{ denomination: 50, count: 3, currency: "SAR" }]);
    const r = await recognizeCurrency(IMG);
    expect(r.bills).toEqual([{ denomination: 50, count: 3 }]);
    expect(r.total).toBe(150);
    expect(r.currency).toBe("SAR");
  });
});

describe("EP-09: mixed pile → per-denomination counts + total", () => {
  test("100×1 + 50×2 + 10×3 → sorted desc, total 230", async () => {
    modelBills([
      { denomination: 50, count: 2, currency: "SAR" },
      { denomination: 100, count: 1, currency: "SAR" },
      { denomination: 10, count: 3, currency: "SAR" },
    ]);
    const r = await recognizeCurrency(IMG);
    expect(r.bills).toEqual([
      { denomination: 100, count: 1 },
      { denomination: 50, count: 2 },
      { denomination: 10, count: 3 },
    ]);
    expect(r.total).toBe(100 + 100 + 30);
    expect(r.currency).toBe("SAR");
  });

  test("duplicate denominations from the model are merged", async () => {
    modelBills([
      { denomination: 50, count: 2, currency: "SAR" },
      { denomination: 50, count: 1, currency: "SAR" },
    ]);
    const r = await recognizeCurrency(IMG);
    expect(r.bills).toEqual([{ denomination: 50, count: 3 }]);
    expect(r.total).toBe(150);
  });
});

describe("multi-currency: dominant by total, others surfaced", () => {
  test("SAR 600 dominant over USD 20", async () => {
    modelBills([
      { denomination: 100, count: 6, currency: "SAR" },
      { denomination: 20, count: 1, currency: "USD" },
    ]);
    const r = await recognizeCurrency(IMG);
    expect(r.currency).toBe("SAR");
    expect(r.total).toBe(600);
    expect(r.otherCurrencies?.[0]?.currency).toBe("USD");
    expect(r.otherCurrencies?.[0]?.total).toBe(20);
  });
});

describe("negative + defensive cases", () => {
  test("no money → empty bills, total 0, UNKNOWN", async () => {
    modelBills([]);
    const r = await recognizeCurrency(IMG);
    expect(r.bills).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.currency).toBe("UNKNOWN");
  });
  test("malformed JSON → empty result, never throws", async () => {
    setApiKey("test-key");
    mockLLMContent("not json at all");
    const r = await recognizeCurrency(IMG);
    expect(r.bills).toEqual([]);
    expect(r.currency).toBe("UNKNOWN");
  });
  test("invalid entries (count<=0, denom<=0) are dropped", async () => {
    modelBills([
      { denomination: 0, count: 5, currency: "SAR" },
      { denomination: 50, count: 0, currency: "SAR" },
      { denomination: 20, count: 2, currency: "SAR" },
    ]);
    const r = await recognizeCurrency(IMG);
    expect(r.bills).toEqual([{ denomination: 20, count: 2 }]);
    expect(r.total).toBe(40);
  });
});
