import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { startTestServer, authHeaders, uploadPhoto, type TestServer } from "../helpers/relay-app";
import { mockAnswerBackends, type AnswerBackendMock } from "../helpers/mock-answer-backends";
import { config } from "../../src/utils/config";

// Live POST /api/answer NDJSON stream: routing (client vs streamed), ordered
// audio chunks, the OCR char cap + suffix, and recoverable-error fallback.
// OpenRouter + ElevenLabs are stubbed; localhost passes through.

let srv: TestServer;
let mock: AnswerBackendMock | undefined;
const REAL_EL_KEY = config.elevenLabsApiKey;

beforeAll(async () => {
  srv = await startTestServer();
  // synthesize() gates on this; set a dummy so the streamed path produces audio.
  (config as any).elevenLabsApiKey = "test-elevenlabs-key";
});
afterAll(async () => {
  (config as any).elevenLabsApiKey = REAL_EL_KEY;
  await srv.close();
});
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

async function readNdjson(res: Response): Promise<any[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events: any[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) events.push(JSON.parse(line));
    }
  }
  const tail = buf.trim();
  if (tail) events.push(JSON.parse(tail));
  return events;
}

async function postAnswer(body: unknown): Promise<any[]> {
  const res = await fetch(`${srv.base}/api/answer`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  return readNdjson(res);
}

/** Mints a token and uploads bytes so /api/answer's waitForBytes resolves. */
async function uploadedToken(): Promise<string> {
  const mintRes = await fetch(`${srv.base}/api/photo/upload-url`, {
    method: "POST",
    headers: authHeaders(),
    body: "{}",
  });
  const { photoToken } = await mintRes.json();
  await uploadPhoto(srv.base, photoToken, Buffer.from("fake-jpeg-bytes"));
  return photoToken;
}

describe("POST /api/answer — routing", () => {
  test("missing text → 400 (before the stream opens)", async () => {
    const res = await fetch(`${srv.base}/api/answer`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("structured command (money) → route mode:client, no streaming", async () => {
    const events = await postAnswer({ text: "money" });
    expect(events[0]).toEqual({ type: "route", mode: "client", command: "currency-recognize" });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((e) => e.type === "chunk")).toBe(false);
  });

  test("annotation-only utterance → route mode:client command unknown", async () => {
    const events = await postAnswer({ text: "(coughs)" });
    expect(events[0]).toMatchObject({ type: "route", mode: "client", command: "unknown" });
  });
});

describe("POST /api/answer — streamed answers", () => {
  test("VQA streams ordered audio chunks then a final", async () => {
    mock = mockAnswerBackends({ deltas: ["The door ", "is open. ", "A cat sits nearby."] });
    const token = await uploadedToken();
    const events = await postAnswer({ text: "is the door open", photoToken: token, language: "en" });

    expect(events[0]).toEqual({ type: "route", mode: "streamed", command: "visual-qa" });
    const chunks = events.filter((e) => e.type === "chunk");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // seqs are strictly increasing from 0, each carries text + base64 audio
    chunks.forEach((c, i) => {
      expect(c.seq).toBe(i);
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.audio.length).toBeGreaterThan(0);
      expect(c.format).toBe("mp3_44100_64");
    });
    const final = events.find((e) => e.type === "final");
    expect(final.text).toContain("The door is open.");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(mock.elevenLabsCalls).toBe(chunks.length); // one TTS per emitted chunk
  });

  test("OCR caps at 400 chars and speaks the truncation suffix", async () => {
    const long = "Lorem ipsum dolor sit amet. ".repeat(40); // ~1100 chars
    mock = mockAnswerBackends({ deltas: [long] });
    const token = await uploadedToken();
    const events = await postAnswer({ text: "read this", photoToken: token, language: "en" });

    const final = events.find((e) => e.type === "final");
    expect(final.text).toContain("...and more. Swipe forward to stop.");
    // body capped near 400 chars (+ suffix)
    expect(final.text.length).toBeLessThan(460);
    // the last spoken chunk is the suffix
    const chunks = events.filter((e) => e.type === "chunk");
    expect(chunks.at(-1).text).toContain("Swipe forward to stop");
  });

  test("no photo → recoverable error so the phone can fall back", async () => {
    mock = mockAnswerBackends({ deltas: ["unused"] });
    const events = await postAnswer({ text: "read this", language: "en" }); // no photoToken
    expect(events.find((e) => e.type === "route")).toEqual({ type: "route", mode: "streamed", command: "ocr-read-text" });
    const err = events.find((e) => e.type === "error");
    expect(err).toMatchObject({ type: "error", recoverable: true });
    expect(events.some((e) => e.type === "chunk")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  test("every TTS failing → recoverable error (no audio produced)", async () => {
    mock = mockAnswerBackends({ deltas: ["Hello there."], failTts: true });
    const token = await uploadedToken();
    const events = await postAnswer({ text: "is the door open", photoToken: token, language: "en" });
    expect(events.some((e) => e.type === "chunk")).toBe(false);
    expect(events.find((e) => e.type === "error")).toMatchObject({ recoverable: true });
  });
});

describe("POST /api/answer — voice settings plumbing", () => {
  test("forwards the speed setting to ElevenLabs voice_settings.speed", async () => {
    mock = mockAnswerBackends({ deltas: ["The door is open."] });
    const token = await uploadedToken();
    await postAnswer({ text: "is the door open", photoToken: token, language: "en", speed: 0.9 });
    expect(mock.elevenLabsRequests.length).toBeGreaterThan(0);
    for (const r of mock.elevenLabsRequests) {
      expect(r.body?.voice_settings?.speed).toBe(0.9);
    }
  });

  test("clamps an out-of-range speed to ElevenLabs' 0.7–1.2 band", async () => {
    mock = mockAnswerBackends({ deltas: ["The door is open."] });
    const token = await uploadedToken();
    await postAnswer({ text: "is the door open", photoToken: token, language: "en", speed: 2.0 });
    expect(mock.elevenLabsRequests.length).toBeGreaterThan(0);
    for (const r of mock.elevenLabsRequests) {
      expect(r.body?.voice_settings?.speed).toBe(1.2);
    }
  });

  test("forwards the voicePreset to the matching ElevenLabs voice id", async () => {
    mock = mockAnswerBackends({ deltas: ["The door is open."] });
    const token = await uploadedToken();
    await postAnswer({ text: "is the door open", photoToken: token, language: "en", voicePreset: "male" });
    expect(mock.elevenLabsRequests.length).toBeGreaterThan(0);
    for (const r of mock.elevenLabsRequests) {
      expect(r.url).toContain("pNInz6obpgDQGcFmaJgB"); // Adam (male preset)
    }
  });
});
