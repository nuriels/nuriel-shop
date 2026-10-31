// מנגנון המנועים (Hospitality Stage 1f): רישום, טבלת ההחלטה של המתג, המתג עצמו
// (middleware), מנוע Hospitality ושער הבקשות, ומתאמי סוג האתר והדגלים.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Engine, SiteRef } from "@/platform/engines/contract";
import { createEngineRegistry, normalizeFilename } from "@/platform/engines/registry";
import {
  createEngineGuard,
  decideServerFnAccess,
  guardServerFn,
} from "@/platform/engines/engine-guard";
import { gateEdgeRequest } from "@/platform/engines/edge";
import { ecommerceEngine } from "@/engines/ecommerce/engine";
import { hospitalityEngine } from "@/engines/hospitality/engine";
import { hospitalitySwitchOn } from "@/engines/hospitality/config";
import { hospitalityGate } from "@/engines/hospitality/edge/gate";
import { clearSiteTypeCache, siteTypeOf } from "@/platform/tenancy/site-type.server";
import { clearFeatureFlagCache, featureEnabled } from "@/platform/feature-flags/flags.server";

vi.mock("@/platform/tenancy/current-site.server", () => ({ currentSite: vi.fn() }));

const ECOM: SiteRef = {
  id: "11111111-1111-1111-1111-111111111111",
  siteType: "ecommerce",
  status: "active",
};
const HOSP: SiteRef = {
  id: "22222222-2222-2222-2222-222222222222",
  siteType: "hospitality",
  status: "active",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function fakeEngine(
  key: "ecommerce" | "hospitality",
  enabled: boolean,
  owns = false,
): Engine & { calls: number } {
  const e = {
    key,
    label: key,
    calls: 0,
    ownsServerFn: () => owns,
    enabledFor: async () => {
      e.calls++;
      return enabled;
    },
    gate: async () => null,
  };
  return e;
}

describe("engine registry", () => {
  const registry = createEngineRegistry([ecommerceEngine, hospitalityEngine]);

  it("assigns owners: platform (shared + src/platform), Hospitality (its folder), Ecommerce (everything else)", () => {
    expect(registry.ownerOf("src/lib/auth.functions.ts")).toBe("platform");
    expect(registry.ownerOf("src/lib/portal.functions.ts")).toBe("platform");
    expect(registry.ownerOf("src/platform/x/y.functions.ts")).toBe("platform");
    expect(registry.ownerOf("src/engines/hospitality/server/public.functions.ts")).toBe(
      "hospitality",
    );
    expect(registry.ownerOf("src/lib/orders.functions.ts")).toBe("ecommerce");
    expect(registry.ownerOf("src/lib/does-not-exist.functions.ts")).toBe("ecommerce");
  });

  it("normalises absolute, ./ and Windows paths", () => {
    expect(normalizeFilename("/app/build/src/lib/a.ts")).toBe("src/lib/a.ts");
    expect(normalizeFilename("./src/lib/a.ts")).toBe("src/lib/a.ts");
    expect(normalizeFilename("C:\\work\\src\\lib\\a.ts")).toBe("src/lib/a.ts");
  });

  it("refuses duplicate engines and a missing default engine", () => {
    expect(() => createEngineRegistry([ecommerceEngine, ecommerceEngine])).toThrow(/twice/);
    expect(() => createEngineRegistry([hospitalityEngine])).toThrow(/default engine/);
  });

  it("an engine's claim is final: the default engine never overrides it", () => {
    const greedy = fakeEngine("hospitality", true, true);
    const reg = createEngineRegistry([ecommerceEngine, greedy]);
    expect(reg.ownerOf("src/lib/orders.functions.ts")).toBe("hospitality");
    expect(reg.ownerOf("src/lib/auth.functions.ts")).toBe("platform");
  });
});

describe("dispatcher decision table", () => {
  it.each([
    ["platform", null, false, "allow"],
    ["platform", HOSP, false, "allow"],
    ["platform", ECOM, false, "allow"],
    ["ecommerce", null, true, "allow"],
    ["hospitality", null, true, "not_found"],
    ["ecommerce", ECOM, true, "allow"],
    ["ecommerce", HOSP, true, "not_found"],
    ["hospitality", ECOM, true, "not_found"],
    ["hospitality", HOSP, true, "allow"],
    ["hospitality", HOSP, false, "not_found"],
  ] as const)("owner %s on site %o (engine enabled: %s) → %s", (owner, site, enabled, expected) => {
    expect(decideServerFnAccess({ owner, site, ownerEnabled: enabled })).toBe(expected);
  });

  it("platform functions never look up the site", async () => {
    const current = vi.fn();
    const reg = createEngineRegistry([ecommerceEngine, hospitalityEngine]);
    expect(await guardServerFn(reg, "src/lib/auth.functions.ts", current)).toBe("allow");
    expect(current).not.toHaveBeenCalled();
  });

  it("an engine's enabled check runs only for its own sites", async () => {
    const hosp = fakeEngine("hospitality", true);
    hosp.ownsServerFn = (f) => f.startsWith("src/engines/hospitality/");
    const reg = createEngineRegistry([ecommerceEngine, hosp]);
    const file = "src/engines/hospitality/server/public.functions.ts";
    expect(await guardServerFn(reg, file, async () => ECOM)).toBe("not_found");
    expect(hosp.calls).toBe(0);
    expect(await guardServerFn(reg, file, async () => HOSP)).toBe("allow");
    expect(hosp.calls).toBe(1);
    expect(await guardServerFn(reg, "src/lib/orders.functions.ts", async () => HOSP)).toBe(
      "not_found",
    );
    expect(await guardServerFn(reg, "src/lib/orders.functions.ts", async () => ECOM)).toBe("allow");
  });
});

describe("dispatcher middleware (real middleware object)", () => {
  const registry = createEngineRegistry([ecommerceEngine, hospitalityEngine]);
  const guard = createEngineGuard(registry) as unknown as {
    options: {
      server: (o: { next: () => unknown; serverFnMeta: { filename: string } }) => Promise<unknown>;
    };
  };
  const run = async (filename: string, site: SiteRef | null) => {
    const { currentSite } = await import("@/platform/tenancy/current-site.server");
    vi.mocked(currentSite).mockResolvedValue(site);
    const next = vi.fn(() => "ran");
    try {
      return { result: await guard.options.server({ next, serverFnMeta: { filename } }), next };
    } catch (error) {
      return { error, next };
    }
  };

  it("lets an Ecommerce function run on an Ecommerce site", async () => {
    const r = await run("src/lib/orders.functions.ts", ECOM);
    expect(r.result).toBe("ran");
  });

  it("answers 404 (notFound) for an Ecommerce function on a Hospitality site, without running it", async () => {
    const r = await run("src/lib/orders.functions.ts", HOSP);
    expect(r.next).not.toHaveBeenCalled();
    expect((r.error as { isNotFound?: boolean }).isNotFound).toBe(true);
  });

  it("answers 404 for a Hospitality function on an Ecommerce site", async () => {
    const r = await run("src/engines/hospitality/server/owner.functions.ts", ECOM);
    expect(r.next).not.toHaveBeenCalled();
    expect((r.error as { isNotFound?: boolean }).isNotFound).toBe(true);
  });

  it("answers 404 for a Hospitality function on a Hospitality site while the engine switch is off", async () => {
    vi.stubEnv("HOSPITALITY_ENGINE", "");
    const r = await run("src/engines/hospitality/server/public.functions.ts", HOSP);
    expect(r.next).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("lets platform functions run on every kind of site", async () => {
    for (const site of [ECOM, HOSP, null])
      expect((await run("src/lib/login-code.functions.ts", site)).result).toBe("ran");
  });
});

describe("Hospitality engine", () => {
  beforeEach(() => {
    clearFeatureFlagCache();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("owns only its own folder", () => {
    expect(
      hospitalityEngine.ownsServerFn("src/engines/hospitality/server/public.functions.ts"),
    ).toBe(true);
    expect(hospitalityEngine.ownsServerFn("src/lib/orders.functions.ts")).toBe(false);
    expect(ecommerceEngine.ownsServerFn("src/lib/orders.functions.ts")).toBe(false);
  });

  it("the environment switch is on only for the exact value 'on' (unset = off)", () => {
    expect(hospitalitySwitchOn({})).toBe(false);
    expect(hospitalitySwitchOn({ HOSPITALITY_ENGINE: "true" })).toBe(false);
    expect(hospitalitySwitchOn({ HOSPITALITY_ENGINE: " ON " })).toBe(true);
  });

  it("is disabled without the switch, and does not even read the flag", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await hospitalityEngine.enabledFor(HOSP)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with the switch on, follows hospitality_backend_enabled for the site", async () => {
    vi.stubEnv("HOSPITALITY_ENGINE", "on");
    const fetchMock = vi.fn(async () => json(true));
    vi.stubGlobal("fetch", fetchMock);
    expect(await hospitalityEngine.enabledFor(HOSP)).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      _key: "hospitality_backend_enabled",
      _tenant_id: HOSP.id,
    });
    clearFeatureFlagCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(false)),
    );
    expect(await hospitalityEngine.enabledFor(HOSP)).toBe(false);
  });

  it("edge gate: robots.txt disallows everything, pages are 404, server functions pass to the dispatcher", async () => {
    const robots = await hospitalityGate(HOSP, { pathname: "/robots.txt", method: "GET" });
    expect(robots?.status).toBe(200);
    expect(await robots?.text()).toBe("User-agent: *\nDisallow: /\n");
    for (const path of ["/", "/admin", "/products/x", "/sitemap.xml", "/llms.txt", "/zap"]) {
      const page = await hospitalityGate(HOSP, { pathname: path, method: "GET" });
      expect(page?.status, path).toBe(404);
      expect(page?.headers.get("x-robots-tag")).toBe("noindex");
    }
    expect(await hospitalityGate(HOSP, { pathname: "/_serverFn/abc", method: "POST" })).toBeNull();
  });

  it("edge routing: Ecommerce sites are never handed to an engine gate", async () => {
    const reg = createEngineRegistry([ecommerceEngine, hospitalityEngine]);
    expect(await gateEdgeRequest(reg, ECOM, { pathname: "/", method: "GET" })).toBeNull();
    expect((await gateEdgeRequest(reg, HOSP, { pathname: "/", method: "GET" }))?.status).toBe(404);
  });
});

describe("platform adapters", () => {
  beforeEach(() => {
    clearSiteTypeCache();
    clearFeatureFlagCache();
  });

  it("site type: reads tenants.site_type", async () => {
    expect(
      await siteTypeOf(
        HOSP.id,
        vi.fn(async () => json([{ site_type: "hospitality" }])),
      ),
    ).toBe("hospitality");
  });

  it("site type: falls back to ecommerce when the column does not exist yet (server before migrations)", async () => {
    expect(
      await siteTypeOf(
        ECOM.id,
        vi.fn(async () => json({ code: "42703" }, 400)),
      ),
    ).toBe("ecommerce");
  });

  it("site type: falls back to ecommerce on a network error or an unknown value", async () => {
    expect(
      await siteTypeOf(
        "a",
        vi.fn(async () => Promise.reject(new Error("down"))),
      ),
    ).toBe("ecommerce");
    expect(
      await siteTypeOf(
        "b",
        vi.fn(async () => json([{ site_type: "casino" }])),
      ),
    ).toBe("ecommerce");
  });

  it("site type: cached between calls", async () => {
    const f = vi.fn(async () => json([{ site_type: "hospitality" }]));
    await siteTypeOf("c", f);
    await siteTypeOf("c", f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("feature flags: true only when the database says true; any error → off", async () => {
    expect(
      await featureEnabled(
        "k",
        "t1",
        vi.fn(async () => json(true)),
      ),
    ).toBe(true);
    expect(
      await featureEnabled(
        "k",
        "t2",
        vi.fn(async () => json(false)),
      ),
    ).toBe(false);
    expect(
      await featureEnabled(
        "k",
        "t3",
        vi.fn(async () => json({ message: "x" }, 500)),
      ),
    ).toBe(false);
    expect(
      await featureEnabled(
        "k",
        "t4",
        vi.fn(async () => Promise.reject(new Error("down"))),
      ),
    ).toBe(false);
  });
});
