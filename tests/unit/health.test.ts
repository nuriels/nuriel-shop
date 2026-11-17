import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  READINESS_CACHE_MS,
  handleHealthRequest,
  isHealthPath,
  livenessResponse,
  readinessResponse,
  resetReadinessCacheForTests,
} from "@/server/health.server";

const get = (path: string, method = "GET") => new Request(`http://example.test${path}`, { method });

beforeEach(() => resetReadinessCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe("/healthz — liveness: the process answers, nothing else is touched", () => {
  it("answers 200 {status: ok}, never cached, without any network or database access", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("liveness must not do I/O");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const res = await handleHealthRequest(get("/healthz"));
    expect(res?.status).toBe(200);
    expect(res?.headers.get("cache-control")).toBe("no-store");
    expect(await res?.json()).toEqual({ status: "ok" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is 200 even while the database is down (that is /readyz's job)", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("db down")));
    expect((await handleHealthRequest(get("/healthz")))?.status).toBe(200);
  });

  it("HEAD returns the same status and headers without a body", async () => {
    const res = livenessResponse(get("/healthz", "HEAD"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

describe("/readyz — readiness: the app AND the database", () => {
  it("200 {db: up} when the database check passes", async () => {
    const res = await readinessResponse(undefined, async () => {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", db: "up" });
  });

  it("503 {db: down} when the database check fails — and the body leaks no error text", async () => {
    const res = await readinessResponse(undefined, async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2");
    });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "not_ready", db: "down" });
    expect(text).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0/);
  });

  it("a hanging database counts as not ready (the answer does not wait for it)", async () => {
    const res = await readinessResponse(undefined, () => new Promise(() => {}), Date.now, 20);
    expect(res.status).toBe(503);
  });

  it("one database call per window, however many requests (no load amplification)", async () => {
    const check = vi.fn(async () => {});
    let t = 1_000_000;
    const now = () => t;
    const burst = await Promise.all(
      Array.from({ length: 25 }, () => readinessResponse(undefined, check, now)),
    );
    expect(burst.every((r) => r.status === 200)).toBe(true);
    await readinessResponse(undefined, check, now);
    expect(check).toHaveBeenCalledTimes(1);
    t += READINESS_CACHE_MS + 1; // the window passed — checked again
    await readinessResponse(undefined, check, now);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("recovers: not ready, then ready once the database is back (after the window)", async () => {
    let up = false;
    const check = async () => {
      if (!up) throw new Error("down");
    };
    let t = 5_000_000;
    const now = () => t;
    expect((await readinessResponse(undefined, check, now)).status).toBe(503);
    up = true;
    expect((await readinessResponse(undefined, check, now)).status).toBe(503); // still the cached answer
    t += READINESS_CACHE_MS + 1;
    expect((await readinessResponse(undefined, check, now)).status).toBe(200);
  });
});

describe("routing of the two paths", () => {
  it("recognizes only the two exact paths", () => {
    expect(isHealthPath("/healthz")).toBe(true);
    expect(isHealthPath("/readyz")).toBe(true);
    for (const p of ["/", "/health", "/healthz/", "/healthz/x", "/robots.txt", "/admin"]) {
      expect(isHealthPath(p)).toBe(false);
    }
  });

  it("other paths are not handled (null → the normal flow), other methods get 405", async () => {
    expect(await handleHealthRequest(get("/robots.txt"))).toBeNull();
    const res = await handleHealthRequest(get("/healthz", "POST"));
    expect(res?.status).toBe(405);
    expect(res?.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("pingDatabase (what /readyz calls by default)", () => {
  const env = { SUPABASE_URL: "http://db.test", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
  beforeEach(() => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("calls tenant_for_host with an unknown host and a timeout; ok → resolves", async () => {
    const fetchSpy = vi.fn(async () => new Response("null", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { pingDatabase } = await import("@/integrations/supabase/tenant.server");
    await expect(pingDatabase(1500)).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://db.test/rest/v1/rpc/tenant_for_host");
    expect(JSON.parse(String(init.body))).toEqual({ _host: "readyz.invalid" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a non-2xx answer or a network failure rejects", async () => {
    const { pingDatabase } = await import("@/integrations/supabase/tenant.server");
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 503 }));
    await expect(pingDatabase(1500)).rejects.toThrow(/not ready/);
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")));
    await expect(pingDatabase(1500)).rejects.toThrow();
  });
});

describe("wiring: the probes answer before the tenant lookup, and Docker probes /healthz", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("src/server.ts handles the health paths before resolving the store from the domain", () => {
    const src = read("src/server.ts");
    const routeStart = src.indexOf("async function route(");
    const health = src.indexOf("handleHealthRequest(request)", routeStart);
    const tenant = src.indexOf("resolveTenant(host)", routeStart);
    expect(routeStart).toBeGreaterThan(0);
    expect(health).toBeGreaterThan(routeStart);
    expect(tenant).toBeGreaterThan(health);
  });

  it("the Dockerfile and compose healthchecks probe /healthz; /robots.txt appears only as the rollback fallback", () => {
    for (const file of ["Dockerfile", "docker-compose.yml"]) {
      const text = read(file);
      const probe = text.split("\n").find((l) => l.includes("/healthz") && l.includes("fetch"));
      expect(probe, `${file}: no /healthz probe`).toBeDefined();
      // /healthz is tried first; /robots.txt only when it did not answer 200
      expect(probe!.indexOf("/healthz")).toBeLessThan(probe!.indexOf("/robots.txt"));
      expect(probe).toMatch(/a\|\|ok\('\/robots\.txt'\)/);
    }
  });
});
