import { config } from "../utils/config";
import { Logger } from "../utils/logger";

const logger = new Logger("OpenRouter");

/**
 * Startup probe against OpenRouter's /api/v1/credits endpoint to confirm the
 * key is valid and the account has remaining quota. Surfaced in PR #7 review:
 * an expired/over-quota key fails silently — /api/normalize returns input
 * unchanged and /api/intent falls back to keyword matching, both of which
 * mask the underlying problem. Logging the status loudly at boot means the
 * operator sees the failure before the first user-facing call hits it.
 *
 * Best-effort. Never throws — the rest of the server still runs even if
 * OpenRouter is unreachable. We just won't get LLM-based features until
 * the key is fixed.
 *
 * /credits is free to call (doesn't consume credits), per OpenRouter docs.
 */
export async function probeOpenRouterStatus(): Promise<void> {
  if (!config.openRouterApiKey) {
    logger.warn("OPENROUTER_API_KEY is empty — intent classification + script normalization will fall through to keyword/no-op paths");
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${config.openRouterApiKey}` },
        signal: controller.signal,
      });

      if (response.status === 401) {
        logger.error("[Cost] OpenRouter status: INVALID KEY — rotate OPENROUTER_API_KEY");
        return;
      }
      if (response.status === 402) {
        logger.error("[Cost] OpenRouter status: OUT OF CREDITS — top up at https://openrouter.ai/credits");
        return;
      }
      if (!response.ok) {
        logger.warn(`[Cost] OpenRouter status: HTTP ${response.status} ${response.statusText} — couldn't read quota`);
        return;
      }

      const data = await response.json() as { data?: { total_credits?: number; total_usage?: number } };
      const total = data.data?.total_credits ?? 0;
      const used = data.data?.total_usage ?? 0;
      const remaining = Math.max(0, total - used);
      logger.info(`[Cost] OpenRouter status: OK ($${remaining.toFixed(4)} remaining, $${used.toFixed(4)} used of $${total.toFixed(4)})`);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      logger.warn("[Cost] OpenRouter status: probe timed out (5s) — network or API issue");
    } else {
      logger.warn("[Cost] OpenRouter status: probe failed:", err?.message ?? err);
    }
  }
}
