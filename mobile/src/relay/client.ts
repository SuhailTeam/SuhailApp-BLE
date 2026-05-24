import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { getDeviceId } from "../state/deviceId";
import { Logger } from "../utils/logger";

const logger = new Logger("RelayClient");

const BASE_URL = (process.env.EXPO_PUBLIC_RELAY_BASE_URL ?? "").replace(/\/+$/, "");
const SHARED_SECRET = process.env.EXPO_PUBLIC_RELAY_SHARED_SECRET ?? "";

if (!BASE_URL) {
  logger.warn("EXPO_PUBLIC_RELAY_BASE_URL is not set — relay calls will fail");
}

/** Computes the HMAC-Bearer token for this device. Matches src/relay/auth.ts. */
function computeToken(deviceId: string): string {
  if (!SHARED_SECRET) return ""; // dev mode — server also has empty secret
  return bytesToHex(hmac(sha256, utf8ToBytes(SHARED_SECRET), utf8ToBytes(deviceId)));
}

interface RequestOptions {
  /** Request body (JSON-serialisable). Pass `undefined` for GET. */
  body?: unknown;
  /** Override the default 30s timeout. */
  timeoutMs?: number;
  /** Override the default Accept header. */
  accept?: string;
  /** Abort signal from the caller (e.g. cancelled commands). */
  signal?: AbortSignal;
}

export interface RelayJsonResponse<T> {
  ok: true;
  data: T;
  headers: Headers;
}

export interface RelayBinaryResponse {
  ok: true;
  bytes: ArrayBuffer;
  contentType: string;
  headers: Headers;
}

export class RelayError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public override readonly message: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}

function authHeaders(): Record<string, string> {
  const deviceId = getDeviceId();
  const token = computeToken(deviceId);
  const headers: Record<string, string> = {
    "X-Device-Id": deviceId,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function buildUrl(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${BASE_URL}${path}`;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  // Clear the timer when the controller fires for any reason
  controller.signal.addEventListener("abort", () => clearTimeout(t), { once: true });
  return controller.signal;
}

async function rawRequest(path: string, method: "GET" | "POST" | "PUT" | "DELETE", opts: RequestOptions = {}): Promise<Response> {
  const url = buildUrl(path);
  const headers: Record<string, string> = {
    ...authHeaders(),
    Accept: opts.accept ?? "application/json",
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const signal = withTimeout(opts.signal, opts.timeoutMs ?? 30_000);
  logger.debug(`${method} ${path}`);
  return fetch(url, { method, headers, body, signal });
}

/** POST JSON, parse JSON response. Throws RelayError on non-2xx. */
export async function postJson<T>(path: string, body: unknown, opts: RequestOptions = {}): Promise<T> {
  const response = await rawRequest(path, "POST", { ...opts, body });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new RelayError(response.status, path, `HTTP ${response.status}`, text);
  }
  return (await response.json()) as T;
}

/** GET JSON. Throws RelayError on non-2xx. */
export async function getJson<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const response = await rawRequest(path, "GET", opts);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new RelayError(response.status, path, `HTTP ${response.status}`, text);
  }
  return (await response.json()) as T;
}

/** POST returning raw binary (e.g. /api/tts audio bytes). */
export async function postBinary(path: string, body: unknown, opts: RequestOptions = {}): Promise<RelayBinaryResponse> {
  const response = await rawRequest(path, "POST", { ...opts, body, accept: opts.accept ?? "*/*" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new RelayError(response.status, path, `HTTP ${response.status}`, text);
  }
  const bytes = await response.arrayBuffer();
  return {
    ok: true,
    bytes,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    headers: response.headers,
  };
}
