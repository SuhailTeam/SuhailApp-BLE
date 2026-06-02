/**
 * Targeted Markdown section replacement, so the standalone usability analyzer can
 * update only the "## Table 13.14 — Usability" block inside section13_results.md
 * without clobbering the suite-count sections (13.9–13.13) that the analyzer does
 * not recompute. The full-regen path (run_all.ts) renders the same block from the
 * same data, so the two writers never diverge.
 */

/**
 * Replaces the body of a `## <heading>` section — every line from the heading up
 * to (but not including) the next `## ` heading or EOF — with `[## heading,
 * ...body]`. If the heading is absent, the section is appended. Pure string op;
 * all other sections are left byte-identical. The result preserves a single
 * trailing newline.
 */
export function replaceSection(md: string, heading: string, body: string[]): string {
  const headingLine = `## ${heading}`;
  const block = [headingLine, ...body];

  const hadTrailingNewline = md.endsWith("\n");
  const lines = (hadTrailingNewline ? md.slice(0, -1) : md).split("\n");

  const start = lines.findIndex((l) => l.trim() === headingLine);
  if (start === -1) {
    const base = md.replace(/\n+$/, "");
    return `${base}\n\n${block.join("\n")}\n`;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("## ")) {
      end = i;
      break;
    }
  }

  const rebuilt = [...lines.slice(0, start), ...block, ...lines.slice(end)];
  return rebuilt.join("\n") + "\n";
}
