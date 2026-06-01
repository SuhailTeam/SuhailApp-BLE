/**
 * Intent-router measurement (report Table 13.13 router rows).
 *   - keyword fast-path rate (A — offline, no key): fraction of the labeled set
 *     that the R1 keyword path resolves, using the REAL matchKeywordCommand.
 *   - keyword classification accuracy (A): does the fast-path fire exactly on the
 *     utterances labelled keyword:true?
 *   - LLM classification accuracy (B — needs RUN_LIVE=1 + OPENROUTER_API_KEY):
 *     routes the trigger-less utterances and compares to the expected command.
 */
import { matchKeywordCommand, routeCommand } from "../../../src/relay/command-router";
import { config } from "../../../src/utils/config";

interface Row {
  text: string;
  expected: string;
  keyword: boolean;
}

export interface IntentMetrics {
  n: number;
  fastPathRate: number;
  keywordClassAccuracy: number;
  llm: { n: number; accuracy: number } | null;
}

async function loadRows(): Promise<Row[]> {
  const text = await Bun.file(`${import.meta.dir}/test_set.jsonl`).text();
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Row);
}

export async function computeIntentMetrics(): Promise<IntentMetrics> {
  const rows = await loadRows();
  let fast = 0;
  let kwCorrect = 0;
  for (const r of rows) {
    const isFast = matchKeywordCommand(r.text) !== null;
    if (isFast) fast += 1;
    if (isFast === r.keyword) kwCorrect += 1;
  }

  let llm: IntentMetrics["llm"] = null;
  const live = process.env.RUN_LIVE === "1" && Boolean(config.openRouterApiKey);
  if (live) {
    const nonKw = rows.filter((r) => !r.keyword);
    let correct = 0;
    for (const r of nonKw) {
      const res = await routeCommand(r.text);
      if (res?.command === r.expected) correct += 1;
    }
    llm = { n: nonKw.length, accuracy: nonKw.length ? correct / nonKw.length : 0 };
  }

  return {
    n: rows.length,
    fastPathRate: fast / rows.length,
    keywordClassAccuracy: kwCorrect / rows.length,
    llm,
  };
}

if (import.meta.main) {
  computeIntentMetrics().then((m) => console.log(JSON.stringify(m, null, 2)));
}
