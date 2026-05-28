/**
 * Helpers for the relay-side unit tests that exercise the LLM-backed services
 * (intent router, transcription normalizer, vision services). These services
 * call OpenRouter via a raw global `fetch`; we stub `fetch` at that boundary so
 * the tests run offline with no API key (instructions §1, §37). We also toggle
 * `config.openRouterApiKey` because several code paths branch on whether a key
 * is configured (e.g. keyword-only fallback when the key is empty).
 *
 * The production `config` object is built from process.env at import; it is a
 * plain (non-frozen) object, so we mutate it at runtime via a cast and restore
 * it afterwards.
 */
import { config } from "../../src/utils/config";

const realFetch = globalThis.fetch;
const realKey = config.openRouterApiKey;

/** Set (or clear) the OpenRouter API key the services read. */
export function setApiKey(key: string): void {
  (config as { openRouterApiKey: string }).openRouterApiKey = key;
}

/** Builds an OpenRouter chat-completion success body wrapping `content`. */
function completion(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

/** Stub fetch so the next LLM call returns `content` as the message body. */
export function mockLLMContent(content: string): void {
  globalThis.fetch = (async () => completion(content)) as unknown as typeof fetch;
}

/** Stub fetch with a non-OK HTTP status (service treats as failure → fallback). */
export function mockLLMHttpStatus(status: number): void {
  globalThis.fetch = (async () => ({ ok: false, status, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
}

/** Stub fetch to reject as if the request was aborted (timeout/network path). */
export function mockLLMAbort(): void {
  globalThis.fetch = (async () => {
    const err = new Error("The operation was aborted");
    (err as Error & { name: string }).name = "AbortError";
    throw err;
  }) as unknown as typeof fetch;
}

/**
 * Stub fetch that resolves with `content` only AFTER its abort signal fires —
 * i.e. it never resolves on its own, so the service's internal
 * CLASSIFY_TIMEOUT_MS controller is what aborts it. Use with jest fake timers
 * to prove the timeout fires at the configured deadline.
 */
export function mockLLMHangUntilAbort(): void {
  globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // never settles
      if (signal.aborted) {
        const err = new Error("aborted");
        (err as Error & { name: string }).name = "AbortError";
        reject(err);
        return;
      }
      signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        (err as Error & { name: string }).name = "AbortError";
        reject(err);
      });
    })) as unknown as typeof fetch;
}

/** Restore the real fetch + API key. Call in afterEach. */
export function restore(): void {
  globalThis.fetch = realFetch;
  (config as { openRouterApiKey: string }).openRouterApiKey = realKey;
}
