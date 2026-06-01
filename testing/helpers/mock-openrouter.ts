/**
 * Minimal OpenRouter (chat-completions) fetch mock. The router, normalizer, and
 * vision service all call `fetch("https://openrouter.ai/api/v1/chat/completions")`
 * directly, so we stub `globalThis.fetch` and restore it after each test.
 *
 * No network is ever touched. Use `restore()` in afterEach.
 */

export interface FetchMock {
  /** Number of times the mocked fetch was invoked. */
  readonly calls: number;
  restore(): void;
}

let saved: typeof globalThis.fetch | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

function install(impl: () => Promise<Response>): FetchMock {
  saved = globalThis.fetch;
  const original = saved;
  let calls = 0;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url =
      typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
    // Only intercept OpenRouter; let localhost (in-process server) calls through
    // so integration tests can hit the relay AND stub the LLM at the same time.
    if (typeof url === "string" && url.includes("openrouter.ai")) {
      calls += 1;
      return impl();
    }
    return (original as typeof globalThis.fetch)(input as any, init as any);
  }) as unknown as typeof globalThis.fetch;
  return {
    get calls() {
      return calls;
    },
    restore() {
      if (saved) globalThis.fetch = saved;
      saved = undefined;
    },
  };
}

/** Returns a chat-completions response whose message content is `content`. */
export function mockChatContent(content: string, status = 200): FetchMock {
  return install(async () => jsonResponse({ choices: [{ message: { content } }] }, status));
}

/** Returns a non-ok HTTP status (e.g. 429/500) — exercises the `!response.ok` branch. */
export function mockHttpError(status = 500): FetchMock {
  return install(async () => jsonResponse({ error: "boom" }, status));
}

/** Rejects like a network failure or an aborted/timed-out request. */
export function mockFetchReject(kind: "network" | "abort" = "network"): FetchMock {
  return install(async () => {
    if (kind === "abort") {
      const err = new Error("The operation was aborted");
      (err as Error).name = "AbortError";
      throw err;
    }
    throw new Error("network unreachable");
  });
}

/** Returns an empty completion (no content) — exercises the empty-response branch. */
export function mockEmptyContent(): FetchMock {
  return install(async () => jsonResponse({ choices: [{ message: { content: "" } }] }, 200));
}
