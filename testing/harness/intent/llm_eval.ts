/**
 * LLM-path intent-classification accuracy (report Table 13.13 / 40).
 *
 *   RUN_LIVE=1 bun testing/harness/intent/llm_eval.ts
 *
 * Loads a representative set of NON-trigger-word utterances (so they bypass the
 * keyword fast-path and exercise the real OpenRouter classifier via routeCommand)
 * and measures end-to-end routing accuracy vs the labelled expected CommandType.
 * Needs OPENROUTER_API_KEY. This set is SEPARATE from test_set.jsonl (which stays
 * frozen at 13 rows for the cited keyword figures); growing this one is encouraged.
 */
import { routeCommand, matchKeywordCommand } from "../../../src/relay/command-router";
import { config } from "../../../src/utils/config";

interface Row {
  text: string;
  expected: string;
}

async function main(): Promise<void> {
  if (!config.openRouterApiKey) {
    console.log("No OPENROUTER_API_KEY — LLM eval needs a key. Skipping (would be needs-data).");
    return;
  }
  const text = await Bun.file(`${import.meta.dir}/llm_eval.jsonl`).text();
  const rows = text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Row);

  // Warm the classifier so a cold-start timeout doesn't skew the first case.
  await routeCommand("warm up the classifier please");

  let correct = 0;
  let fastPath = 0;
  const wrong: Array<{ text: string; expected: string; got: string }> = [];
  for (const r of rows) {
    if (matchKeywordCommand(r.text)) fastPath += 1; // should be 0 — these are non-trigger
    const res = await routeCommand(r.text);
    const got = res?.command ?? "null";
    if (got === r.expected) correct += 1;
    else wrong.push({ text: r.text, expected: r.expected, got });
  }

  console.log(`LLM-path routing accuracy: ${correct}/${rows.length} = ${((100 * correct) / rows.length).toFixed(1)}%`);
  if (fastPath > 0) console.log(`WARN: ${fastPath} utterance(s) hit the keyword fast-path (not pure LLM).`);
  if (wrong.length > 0) {
    console.log("Misroutes:");
    for (const w of wrong) console.log(`  "${w.text}"  expected=${w.expected}  got=${w.got}`);
  }
}

main();
