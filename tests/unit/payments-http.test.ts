// MAX/Hyp DEMO — the Hyp HTTP client (src/platform/payments/server/http.ts) against a local server on
// 127.0.0.1 (random port). No other host is contacted. Values are obvious fakes.
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { gzipSync } from "node:zlib";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { HYP_HTTP_DEFAULTS, hypRequest, type HypHttpResult } from "@/platform/payments/server/http";
import { encodeParams } from "@/platform/payments/max/protocol";

const FAKE_KEY = "FAKE_KEY_http";
const FAKE_PASSP = "FAKE_PASSP_http";
const QUERY = `${encodeParams([
  ["action", "APISign"],
  ["What", "VERIFY"],
  ["Masof", "9999999901"],
  ["KEY", FAKE_KEY],
  ["PassP", FAKE_PASSP],
])}&Id=1&CCode=0&Fild1=a%20b+c&Info=%EC%E0&MULTI=[1~x]`;
const KB64 = 64 * 1024;

let server: Server;
let base = "";
let port = 0;
const hits = new Map<string, number>();
const sockets = new Set<Socket>();

beforeAll(async () => {
  server = createServer((req, res) => {
    res.on("error", () => undefined);
    const path = (req.url ?? "").split("?")[0] ?? "";
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const text = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/plain", ...headers });
      res.end(body);
    };
    switch (path) {
      case "/p/": {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () =>
          text(
            200,
            JSON.stringify({
              method: req.method,
              url: req.url,
              contentType: req.headers["content-type"] ?? null,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          ),
        );
        return;
      }
      case "/ok":
        return text(200, "CCode=0");
      case "/status500":
        return text(500, "CCode=999");
      case "/html-type":
        return text(200, "CCode=0", { "content-type": "text/html; charset=utf-8" });
      case "/html-body":
        return text(200, "  \n<!DOCTYPE html><p>x</p>");
      case "/html-inner":
        return text(200, "CCode=0<HTML>");
      case "/exact":
        return text(200, "a".repeat(KB64));
      case "/big":
        return text(200, "a".repeat(KB64 + 1));
      case "/big-chunked": {
        res.writeHead(200, { "content-type": "text/plain" });
        for (let i = 0; i < 100; i += 1) res.write("b".repeat(1024));
        res.end();
        return;
      }
      case "/gzip": {
        const gz = gzipSync(Buffer.alloc(1024 * 1024, 0x61));
        res.writeHead(200, {
          "content-type": "text/plain",
          "content-encoding": "gzip",
          "content-length": String(gz.length),
        });
        res.end(gz);
        return;
      }
      case "/twenty":
        return text(200, "0123456789abcdefghij");
      case "/hang":
        return; // never answers
      case "/slow-body":
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("CCode=");
        return; // never ends
      case "/reset":
        req.socket.destroy();
        return;
      case "/redirect":
        res.writeHead(302, { location: `${base}/ok` });
        res.end();
        return;
      case "/redirect-307":
        res.writeHead(307, { location: `${base}/p/` });
        res.end();
        return;
      default:
        return text(404, "not found");
    }
  });
  server.on("connection", (s: Socket) => {
    sockets.add(s);
    s.on("error", () => undefined);
    s.on("close", () => sockets.delete(s));
  });
  server.on("clientError", () => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;
let spies: MockInstance[] = [];
beforeEach(() => {
  hits.clear();
  spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});
afterEach(() => {
  // the client never writes to the console (nothing to leak)
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

/** An error result carries only the fixed code: no URL, port, query, credential or body. */
function expectBareError(r: HypHttpResult, error: "timeout" | "network" | "too_large") {
  expect(r).toEqual({ ok: false, error });
  const s = JSON.stringify(r);
  for (const leak of [FAKE_KEY, FAKE_PASSP, String(port), "127.0.0.1", "CCode", "Masof"])
    expect(s).not.toContain(leak);
}

describe("hypRequest — methods and body", () => {
  it("GET by default: endpoint + '?' + query exactly (nothing re-encoded)", async () => {
    const r = await hypRequest(`${base}/p/`, QUERY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe(200);
    expect(r.html).toBe(false);
    expect(JSON.parse(r.body)).toEqual({
      method: "GET",
      url: `/p/?${QUERY}`,
      contentType: null,
      body: "",
    });
    expect(hits.get("/p/")).toBe(1);
  });

  it("POST: the query is an application/x-www-form-urlencoded body; the URL carries no query", async () => {
    const r = await hypRequest(`${base}/p/`, QUERY, { method: "POST" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(r.body)).toEqual({
      method: "POST",
      url: "/p/",
      contentType: "application/x-www-form-urlencoded",
      body: QUERY,
    });
  });

  it("any HTTP status is an answer (Hyp: never rely on the status); the caller parses the body", async () => {
    expect(await hypRequest(`${base}/status500`, QUERY)).toEqual({
      ok: true,
      status: 500,
      body: "CCode=999",
      html: false,
    });
    expect(await hypRequest(`${base}/ok`, QUERY)).toEqual({
      ok: true,
      status: 200,
      body: "CCode=0",
      html: false,
    });
  });

  it("HTML: text/html content type, a body that starts with '<', or one that contains <html", async () => {
    for (const path of ["/html-type", "/html-body", "/html-inner"]) {
      const r = await hypRequest(`${base}${path}`, QUERY);
      expect(r.ok && r.html, path).toBe(true);
    }
  });

  it("the defaults are 15 s and 64 KB", () => {
    expect(HYP_HTTP_DEFAULTS).toEqual({ timeoutMs: 15_000, maxBytes: 65_536 });
  });
});

describe("hypRequest — size cap", () => {
  it("a body of exactly the cap is read; one byte more is too_large (declared length)", async () => {
    const exact = await hypRequest(`${base}/exact`, QUERY);
    expect(exact.ok && exact.body.length).toBe(KB64);
    expectBareError(await hypRequest(`${base}/big`, QUERY), "too_large");
  });

  it("an undeclared (chunked) or compressed body is cut as soon as it passes the cap", async () => {
    expectBareError(await hypRequest(`${base}/big-chunked`, QUERY), "too_large");
    expectBareError(await hypRequest(`${base}/gzip`, QUERY), "too_large");
  });

  it("a custom cap applies", async () => {
    expectBareError(await hypRequest(`${base}/twenty`, QUERY, { maxBytes: 19 }), "too_large");
    const r = await hypRequest(`${base}/twenty`, QUERY, { maxBytes: 20 });
    expect(r.ok && r.body).toBe("0123456789abcdefghij");
  });
});

describe("hypRequest — timeouts and network errors become fixed codes, once, without retry", () => {
  it("no answer at all → timeout", async () => {
    const started = Date.now();
    expectBareError(await hypRequest(`${base}/hang`, QUERY, { timeoutMs: 200 }), "timeout");
    expect(Date.now() - started).toBeLessThan(5000);
    expect(hits.get("/hang")).toBe(1);
  });

  it("headers but a body that never ends → timeout (the timeout covers the body)", async () => {
    expectBareError(
      await hypRequest(`${base}/slow-body`, QUERY, { timeoutMs: 200, method: "POST" }),
      "timeout",
    );
    expect(hits.get("/slow-body")).toBe(1);
  });

  it("a reset connection, a closed port, a redirect or an unusable URL → network", async () => {
    expectBareError(await hypRequest(`${base}/reset`, QUERY), "network");
    expect(hits.get("/reset")).toBe(1);

    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expectBareError(
      await hypRequest(`http://127.0.0.1:${closedPort}/p/`, QUERY, { timeoutMs: 2000 }),
      "network",
    );

    // redirects are refused, never followed (a POST body is never re-sent elsewhere)
    expectBareError(await hypRequest(`${base}/redirect`, QUERY), "network");
    expect(hits.get("/ok")).toBeUndefined();
    expectBareError(await hypRequest(`${base}/redirect-307`, QUERY, { method: "POST" }), "network");
    expect(hits.get("/p/")).toBeUndefined();

    for (const endpoint of ["not a url", "http://[::1", "ftp://127.0.0.1/p/", ""])
      expectBareError(await hypRequest(endpoint, QUERY, { timeoutMs: 2000 }), "network");
  });

  it("invalid options are refused with a fixed message (no URL, no query)", async () => {
    const bad: Parameters<typeof hypRequest>[2][] = [
      { method: "PUT" as "GET" },
      { timeoutMs: 0 },
      { timeoutMs: -1 },
      { timeoutMs: Number.NaN },
      { timeoutMs: Number.POSITIVE_INFINITY },
      { timeoutMs: 200_000 },
      { maxBytes: 0 },
      { maxBytes: 1.5 },
      { maxBytes: 2 * 1024 * 1024 },
    ];
    for (const opts of bad) {
      const error = await hypRequest(`${base}/ok`, QUERY, opts).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, JSON.stringify(opts)).toBeInstanceOf(RangeError);
      const message = String((error as Error).message);
      expect(message).toBe("hypRequest: invalid options");
      for (const leak of [FAKE_KEY, FAKE_PASSP, base]) expect(message).not.toContain(leak);
    }
    expect(hits.size).toBe(0);
  });
});
