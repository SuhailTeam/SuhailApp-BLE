import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { startTestServer, authHeaders, type TestServer } from "../helpers/relay-app";
import { mockChatContent, mockFetchReject, type FetchMock } from "../helpers/mock-openrouter";

// Speech → intent pipeline through the live /api/intent + /api/normalize routes:
// annotation stripping feeds routing; LLM failure falls back to keywords.

let srv: TestServer;
let fm: FetchMock | undefined;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.close();
});
afterEach(() => {
  fm?.restore();
  fm = undefined;
});

async function intent(text: string): Promise<any> {
  const res = await fetch(`${srv.base}/api/intent`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ text }),
  });
  return { status: res.status, body: await res.json() };
}

describe("intent pipeline", () => {
  test("annotation is stripped before routing → keyword wins", async () => {
    const { status, body } = await intent("Describe my surroundings (clicks tongue).");
    expect(status).toBe(200);
    expect(body.command).toBe("scene-summarize");
  });

  test("utterance that is only an annotation → unknown", async () => {
    const { body } = await intent("(coughs)");
    expect(body.command).toBe("unknown");
  });

  test("missing text → 400", async () => {
    const res = await fetch(`${srv.base}/api/intent`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("paraphrase routed by the LLM", async () => {
    fm = mockChatContent('{"intent":"scene_summarize"}');
    const { body } = await intent("what is in front of me");
    expect(body.command).toBe("scene-summarize");
    expect(fm.calls).toBe(1);
  });

  test("LLM failure falls back to keyword default (visual-qa)", async () => {
    fm = mockFetchReject("abort");
    const { body } = await intent("is the door open");
    expect(body.command).toBe("visual-qa");
  });
});

describe("normalize pipeline", () => {
  test("no normalization needed → text unchanged (no LLM call)", async () => {
    fm = mockChatContent("SHOULD NOT BE USED");
    const res = await fetch(`${srv.base}/api/normalize`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ text: "what is here", language: "en" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe("what is here");
    expect(fm.calls).toBe(0);
  });
});
