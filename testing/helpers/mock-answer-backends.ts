/**
 * Fetch mocks for the streaming /api/answer pipeline. Stubs `globalThis.fetch`
 * so OpenRouter returns a streaming SSE body (chat-completions with
 * `stream:true`) and ElevenLabs returns audio bytes — while localhost calls
 * (the in-process relay server) pass through to the real fetch.
 *
 * No network is touched. Call `restore()` in afterEach.
 */

/** Builds a real streaming Response that emits each delta as an SSE `data:` line, then `[DONE]`. */
export function sseResponse(deltas: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // A keep-alive comment line — the parser must skip it.
      controller.enqueue(enc.encode(": OPENROUTER PROCESSING\n\n"));
      for (const d of deltas) {
        const payload = JSON.stringify({ choices: [{ delta: { content: d } }] });
        controller.enqueue(enc.encode(`data: ${payload}\n\n`));
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A tiny non-empty audio buffer standing in for an ElevenLabs TTS clip. */
export function audioResponse(): Response {
  // 4 bytes that look like an MP3 frame header — content is irrelevant to tests.
  return new Response(new Uint8Array([0xff, 0xf3, 0x44, 0x00]), {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });
}

/** A captured ElevenLabs TTS request — the URL (carries the voice id) + parsed JSON body. */
export interface ElevenLabsRequest {
  url: string;
  body: any;
}

export interface AnswerBackendMock {
  readonly openRouterCalls: number;
  readonly elevenLabsCalls: number;
  /** Every ElevenLabs TTS request seen, in order — lets tests assert the voice id + voice_settings. */
  readonly elevenLabsRequests: ElevenLabsRequest[];
  restore(): void;
}

/**
 * Intercepts the OpenRouter streaming call (yields `deltas`) and every
 * ElevenLabs TTS call (yields audio bytes). `opts.failTts` makes TTS reject so
 * the "no audio produced" path can be exercised.
 */
export function mockAnswerBackends(opts: { deltas: string[]; failTts?: boolean }): AnswerBackendMock {
  const saved = globalThis.fetch;
  let openRouterCalls = 0;
  let elevenLabsCalls = 0;
  const elevenLabsRequests: ElevenLabsRequest[] = [];

  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url =
      typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
    if (typeof url === "string" && url.includes("openrouter.ai")) {
      openRouterCalls += 1;
      return sseResponse(opts.deltas);
    }
    if (typeof url === "string" && url.includes("elevenlabs.io")) {
      elevenLabsCalls += 1;
      const rawBody = (init as { body?: unknown } | undefined)?.body;
      let body: any;
      try {
        body = typeof rawBody === "string" ? JSON.parse(rawBody) : undefined;
      } catch {
        body = undefined;
      }
      elevenLabsRequests.push({ url, body });
      if (opts.failTts) throw new Error("elevenlabs down");
      return audioResponse();
    }
    return (saved as typeof globalThis.fetch)(input as any, init as any);
  }) as unknown as typeof globalThis.fetch;

  return {
    get openRouterCalls() {
      return openRouterCalls;
    },
    get elevenLabsCalls() {
      return elevenLabsCalls;
    },
    get elevenLabsRequests() {
      return elevenLabsRequests;
    },
    restore() {
      globalThis.fetch = saved;
    },
  };
}
