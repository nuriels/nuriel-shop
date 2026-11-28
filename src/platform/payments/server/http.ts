/**
 * Online payments — the Hyp HTTP client (server only; under server/ for Vite's import protection).
 *
 * One request per call, no retries (the caller decides), fixed outcomes only:
 * - `{ ok: true, status, body, html }` for any HTTP answer. Hyp "returns a 200 OK status code for almost all
 *   requests, even when an error occurs", so the status is informational and the caller parses the body;
 *   `html` = `text/html` content type, or a body that starts with "<" (after trimming) or contains "<html";
 * - `{ ok: false, error }` with `timeout` (default 15 s, covering headers and body), `too_large` (default 64 KB)
 *   or `network` (DNS, refused or reset connection, TLS, any redirect, an unusable URL).
 * GET (default) sends `endpoint + "?" + query`; POST sends `query` as an application/x-www-form-urlencoded body.
 * The URL and the query carry KEY/PassP: they are never logged, thrown or returned, and neither is the body of a
 * failed request. Redirects are refused rather than followed, so a request can never be re-sent elsewhere.
 * The endpoint is passed in by the caller (hypEndpoint() from env.ts); this module imports nothing.
 */

export type HypHttpResult =
  | { ok: true; status: number; body: string; html: boolean }
  | { ok: false; error: "timeout" | "network" | "too_large" };

export const HYP_HTTP_DEFAULTS: Readonly<{ timeoutMs: number; maxBytes: number }> = Object.freeze({
  timeoutMs: 15_000,
  maxBytes: 64 * 1024,
});

const MAX_TIMEOUT_MS = 120_000;
const MAX_BYTES_LIMIT = 1024 * 1024;

const validTimeout = (v: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_TIMEOUT_MS;
const validMaxBytes = (v: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= MAX_BYTES_LIMIT;

function isHtml(contentType: string, body: string): boolean {
  return /text\/html/i.test(contentType) || body.trimStart().startsWith("<") || /<html/i.test(body);
}

type ReadOutcome = { bytes: Uint8Array } | { failed: "too_large" | "aborted" };

/** Reads the body up to maxBytes; stops (and aborts the request) as soon as the cap is passed. */
async function readCapped(
  res: Response,
  maxBytes: number,
  abort: () => void,
): Promise<ReadOutcome> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.body?.cancel().catch(() => undefined);
    abort();
    return { failed: "too_large" };
  }
  if (!res.body) return { bytes: new Uint8Array(0) };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch(() => undefined);
        abort();
        return { failed: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { failed: "aborted" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

export async function hypRequest(
  endpoint: string,
  query: string,
  opts?: { method?: "GET" | "POST"; timeoutMs?: number; maxBytes?: number },
): Promise<HypHttpResult> {
  const method = opts?.method ?? "GET";
  const timeoutMs = opts?.timeoutMs ?? HYP_HTTP_DEFAULTS.timeoutMs;
  const maxBytes = opts?.maxBytes ?? HYP_HTTP_DEFAULTS.maxBytes;
  if (
    (method !== "GET" && method !== "POST") ||
    !validTimeout(timeoutMs) ||
    !validMaxBytes(maxBytes)
  )
    throw new RangeError("hypRequest: invalid options");
  if (typeof endpoint !== "string" || typeof query !== "string")
    return { ok: false, error: "network" };

  const controller = new AbortController();
  let timedOut = false;
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const failure = (): HypHttpResult => ({ ok: false, error: timedOut ? "timeout" : "network" });

  try {
    const init: RequestInit = { method, redirect: "error", signal: controller.signal };
    if (method === "POST") {
      init.headers = { "content-type": "application/x-www-form-urlencoded" };
      init.body = query;
    }
    let res: Response;
    try {
      res = await fetch(method === "GET" ? `${endpoint}?${query}` : endpoint, init);
    } catch {
      return failure();
    }
    const read = await readCapped(res, maxBytes, () => controller.abort());
    if ("failed" in read)
      return read.failed === "too_large" ? { ok: false, error: "too_large" } : failure();
    const body = new TextDecoder("utf-8").decode(read.bytes);
    return {
      ok: true,
      status: res.status,
      body,
      html: isHtml(res.headers.get("content-type") ?? "", body),
    };
  } catch {
    return failure();
  } finally {
    clearTimeout(timer);
  }
}
