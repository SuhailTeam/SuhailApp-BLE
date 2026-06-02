import { describe, expect, test } from "bun:test";
import { replaceSection } from "./patch";

const DOC = ["## Table 13.13 — Cross-cutting", "| a | b |", "", "## Table 13.14 — Usability", "old line", "", ""].join(
  "\n",
);

describe("replaceSection", () => {
  test("replaces only the targeted block, leaving siblings byte-identical", () => {
    const out = replaceSection(DOC, "Table 13.14 — Usability", ["new line 1", "new line 2"]);
    expect(out).toContain("## Table 13.13 — Cross-cutting");
    expect(out).toContain("| a | b |");
    expect(out).toContain("new line 1");
    expect(out).toContain("new line 2");
    expect(out).not.toContain("old line");
  });

  test("preserves a single trailing newline", () => {
    const out = replaceSection(DOC, "Table 13.14 — Usability", ["x"]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  test("does not touch content before the target heading", () => {
    const out = replaceSection(DOC, "Table 13.14 — Usability", ["x"]);
    expect(out.startsWith("## Table 13.13 — Cross-cutting\n| a | b |")).toBe(true);
  });

  test("appends the section when the heading is absent", () => {
    const out = replaceSection("# Title\n\nbody\n", "Table 13.14 — Usability", ["x"]);
    expect(out).toContain("## Table 13.14 — Usability\nx");
    expect(out).toContain("body");
  });

  test("keeps a following section intact", () => {
    const doc = "## A\n1\n## B\n2\n";
    const out = replaceSection(doc, "A", ["replaced"]);
    expect(out).toBe("## A\nreplaced\n## B\n2\n");
  });
});
