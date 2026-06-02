/**
 * Pure scoring predicates for the per-command functional dataset (report Table
 * 13.12 / 39). Each returns { pass, got } so a failing case is explainable in the
 * runner output. No network, no service imports — unit-testable in isolation.
 */

export interface ScoreResult {
  pass: boolean;
  got: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Passes if the text contains AT LEAST ONE of the keywords (scene / color). */
export function scoreAnyOf(text: string, anyOf: string[]): ScoreResult {
  const hay = norm(text);
  return { pass: anyOf.some((k) => hay.includes(norm(k))), got: text };
}

/** Passes if the text contains ALL of the substrings (OCR / VQA). */
export function scoreContains(text: string, contains: string[]): ScoreResult {
  const hay = norm(text);
  return { pass: contains.every((k) => hay.includes(norm(k))), got: text };
}

/** Currency: exact ISO code (case-insensitive) AND total within tolerance. */
export function scoreCurrency(
  gotCurrency: string,
  gotTotal: number,
  exp: { currency: string; total: number; tolerance?: number },
): ScoreResult {
  const curOk = gotCurrency.toUpperCase() === exp.currency.toUpperCase();
  const totOk = Math.abs(gotTotal - exp.total) <= (exp.tolerance ?? 0);
  return { pass: curOk && totOk, got: `${gotCurrency} ${gotTotal}` };
}

/** find-object: found flag matches; if found, location contains a keyword. */
export function scoreFound(
  gotFound: boolean,
  gotLocation: string,
  exp: { found: boolean; locationContains?: string[] },
): ScoreResult {
  if (gotFound !== exp.found) return { pass: false, got: `found=${gotFound} (${gotLocation})` };
  if (exp.found && exp.locationContains && exp.locationContains.length > 0) {
    const loc = norm(gotLocation);
    return { pass: exp.locationContains.some((k) => loc.includes(norm(k))), got: gotLocation };
  }
  return { pass: true, got: `found=${gotFound}` };
}

/** Face: expected name present among recognized names, or no known face for a stranger (null). */
export function scoreFaceName(gotNames: string[], expected: string | null): ScoreResult {
  const got = gotNames.length ? gotNames.join(", ") : "(none)";
  if (expected === null) return { pass: gotNames.length === 0, got };
  return { pass: gotNames.includes(expected), got };
}
