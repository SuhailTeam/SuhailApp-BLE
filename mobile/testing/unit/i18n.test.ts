import { describe, expect, test } from "bun:test";
import { messages, localize, BUNDLED_PHRASE_KEYS, LANGUAGES } from "../../src/i18n/messages";
import { ui, t } from "../../src/i18n/ui";

// Bilingual completeness — every spoken/UI string must have a non-empty ar + en.

function isLeaf(v: unknown): v is { ar: string; en: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as any).ar === "string" &&
    typeof (v as any).en === "string"
  );
}

function* leaves(node: unknown): Generator<{ ar: string; en: string }> {
  if (isLeaf(node)) {
    yield node;
    return;
  }
  if (Array.isArray(node)) {
    for (const el of node) yield* leaves(el);
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const v of Object.values(node)) yield* leaves(v);
  }
}

describe("messages (spoken phrases)", () => {
  test("every message has a non-empty ar and en", () => {
    for (const [key, msg] of Object.entries(messages)) {
      expect(typeof msg.ar, key).toBe("string");
      expect(typeof msg.en, key).toBe("string");
      expect(msg.ar.length, key).toBeGreaterThan(0);
      expect(msg.en.length, key).toBeGreaterThan(0);
    }
  });

  test("every bundled-phrase key exists in messages", () => {
    for (const key of BUNDLED_PHRASE_KEYS) {
      expect(messages[key]).toBeDefined();
    }
  });

  test("localize selects the right language", () => {
    expect(localize(messages.didntCatch, "en")).toBe(messages.didntCatch.en);
    expect(localize(messages.didntCatch, "ar")).toBe(messages.didntCatch.ar);
  });

  test("LANGUAGES is exactly ar + en", () => {
    expect([...LANGUAGES].sort()).toEqual(["ar", "en"]);
  });
});

describe("ui (on-screen strings)", () => {
  test("every ui leaf has a non-empty ar and en", () => {
    let count = 0;
    for (const leaf of leaves(ui)) {
      count += 1;
      expect(leaf.ar.length).toBeGreaterThan(0);
      expect(leaf.en.length).toBeGreaterThan(0);
    }
    expect(count).toBeGreaterThan(0);
  });

  test("t() resolves a bilingual leaf by language", () => {
    expect(t(ui.tabs.home, "ar")).toBe(ui.tabs.home.ar);
    expect(t(ui.tabs.home, "en")).toBe(ui.tabs.home.en);
  });
});
