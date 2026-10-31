// Hospitality Stage 2a — אזור הניהול: שער העמודים, הפעלה לפי דגלים, ניווט לפי הרשאות,
// רשימת ההקמה, הודעת המנוי ועיצוב ערכים. (ההרשאות עצמן נבדקות במסד —
// scripts/db-tests/hospitality-management.test.sql; המסכים — e2e/tests/manage.spec.ts)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteRef } from "@/platform/engines/contract";
import { createEngineRegistry } from "@/platform/engines/registry";
import { gateEdgeRequest } from "@/platform/engines/edge";
import { clearFeatureFlagCache } from "@/platform/feature-flags/flags.server";
import { ecommerceEngine } from "@/engines/ecommerce/engine";
import { hospitalityEngine } from "@/engines/hospitality/engine";
import { backendEnabled, managementEnabled } from "@/engines/hospitality/access.server";
import { hospitalityGate } from "@/engines/hospitality/edge/gate";
import { clientRouteRedirect, isManagementPath } from "@/engines/hospitality/edge/paths";
import { engineRouteRedirect } from "@/app/site-routes";
import { hospitalitySiteOnly } from "@/engines/hospitality/management/route-guard";
import { NAV_ITEMS, splitForMobile, visibleNav } from "@/engines/hospitality/management/lib/nav";
import { CHECKLIST_STEPS, checklistProgress } from "@/engines/hospitality/management/lib/checklist";
import { planNotice } from "@/engines/hospitality/management/lib/plan-notice";
import {
  daysLeft,
  daysText,
  formatDate,
  usageText,
} from "@/engines/hospitality/management/lib/format";
import { CHECKLIST_KEYS, type ManagementContext } from "@/engines/hospitality/types/management";

const HOSP: SiteRef = {
  id: "22222222-2222-2222-2222-222222222222",
  siteType: "hospitality",
  status: "active",
};
const SUSPENDED: SiteRef = { ...HOSP, status: "suspended" };
const ECOM: SiteRef = {
  id: "11111111-1111-1111-1111-111111111111",
  siteType: "ecommerce",
  status: "active",
};
const get = (pathname: string) => ({ pathname, method: "GET" });
const open = { managementOpen: async () => true };
const closed = { managementOpen: async () => false };

describe("edge gate: the management area", () => {
  it("serves /manage, its sub-paths and the owner handoff only when the management area is open", async () => {
    for (const path of [
      "/manage",
      "/manage/",
      "/manage/login",
      "/manage/anything",
      "/admin-handoff",
    ]) {
      expect(await hospitalityGate(HOSP, get(path), open), path).toBeNull();
      const shut = await hospitalityGate(HOSP, get(path), closed);
      expect(shut?.status, path).toBe(404);
      expect(shut?.headers.get("x-robots-tag")).toBe("noindex");
    }
  });

  it("sends the existing handoff landing (/admin) to /manage, only when open", async () => {
    for (const path of ["/admin", "/admin/"]) {
      const res = await hospitalityGate(HOSP, get(path), open);
      expect(res?.status, path).toBe(302);
      expect(res?.headers.get("location")).toBe("/manage");
      expect((await hospitalityGate(HOSP, get(path), closed))?.status).toBe(404);
    }
  });

  it("keeps every store page closed on a Hospitality site, even with the management area open", async () => {
    for (const path of [
      "/",
      "/admin/orders",
      "/admin_/dashboard",
      "/login",
      "/products/x",
      "/managex",
      "/manager",
      "/sitemap.xml",
      "/zap",
    ]) {
      expect((await hospitalityGate(HOSP, get(path), open))?.status, path).toBe(404);
    }
  });

  it("a suspended site shows the suspended page in the management area (and 404 while it is closed)", async () => {
    const res = await hospitalityGate(SUSPENDED, get("/manage"), open);
    expect(res?.status).toBe(403);
    expect(await res?.text()).toContain("האתר מושעה");
    expect((await hospitalityGate(SUSPENDED, get("/manage"), closed))?.status).toBe(404);
  });

  it("does not even check the flags for paths outside the management area", async () => {
    const managementOpen = vi.fn(async () => true);
    await hospitalityGate(HOSP, get("/"), { managementOpen });
    await hospitalityGate(HOSP, get("/robots.txt"), { managementOpen });
    await hospitalityGate(HOSP, { pathname: "/_serverFn/x", method: "POST" }, { managementOpen });
    expect(managementOpen).not.toHaveBeenCalled();
  });

  it("in-app navigation on a Hospitality site: only the management paths are allowed", () => {
    expect(isManagementPath("/manage/login")).toBe(true);
    expect(isManagementPath("/managers")).toBe(false);
    expect(clientRouteRedirect("/manage")).toBeNull();
    expect(clientRouteRedirect("/admin-handoff")).toBeNull();
    expect(clientRouteRedirect("/admin")).toBe("/manage");
    expect(clientRouteRedirect("/checkout")).toBe("/manage");
    expect(engineRouteRedirect("hospitality", "/admin")).toBe("/manage");
    expect(engineRouteRedirect("hospitality", "/manage/login")).toBeNull();
    // בחנות: הנתיבים של החנות כרגיל (ה-root לא מפנה כלום)
    expect(engineRouteRedirect("ecommerce", "/admin")).toBeNull();
    expect(engineRouteRedirect("ecommerce", "/manage")).toBeNull();
  });

  it("the /manage routes exist only on Hospitality sites (a store gets its normal not-found)", () => {
    const ctx = (siteType: string) => ({ context: { hostMode: { siteType } } });
    expect(() => hospitalitySiteOnly(ctx("hospitality"))).not.toThrow();
    expect(() => hospitalitySiteOnly(ctx("ecommerce"))).toThrow();
    try {
      hospitalitySiteOnly(ctx("ecommerce"));
    } catch (thrown) {
      expect((thrown as { isNotFound?: boolean }).isNotFound).toBe(true);
    }
  });
});

describe("management area: enabled per site by flags", () => {
  const flagsSeen: string[] = [];
  beforeEach(() => {
    clearFeatureFlagCache();
    vi.unstubAllEnvs();
    flagsSeen.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());
  const stubFlags = (on: Record<string, boolean>) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { _key } = JSON.parse(String(init.body)) as { _key: string };
        flagsSeen.push(_key);
        return new Response(JSON.stringify(on[_key] === true), { status: 200 });
      }),
    );

  it("off without the environment switch, whatever the flags say (no flag is read)", async () => {
    stubFlags({ hospitality_backend_enabled: true, hospitality_management_enabled: true });
    expect(await managementEnabled(HOSP.id)).toBe(false);
    expect(flagsSeen).toEqual([]);
  });

  it("needs the database flag and the management flag — independent of the public-website flag", async () => {
    vi.stubEnv("HOSPITALITY_ENGINE", "on");
    stubFlags({ hospitality_backend_enabled: true, hospitality_management_enabled: true });
    expect(await managementEnabled(HOSP.id)).toBe(true);
    expect(flagsSeen).not.toContain("hospitality_frontend_enabled");

    clearFeatureFlagCache();
    stubFlags({ hospitality_backend_enabled: true, hospitality_management_enabled: false });
    expect(await managementEnabled(HOSP.id)).toBe(false);
    expect(await backendEnabled(HOSP.id)).toBe(true);

    clearFeatureFlagCache();
    stubFlags({ hospitality_backend_enabled: false, hospitality_management_enabled: true });
    expect(await managementEnabled(HOSP.id)).toBe(false);
  });

  it("the public website being on does not open the management area", async () => {
    vi.stubEnv("HOSPITALITY_ENGINE", "on");
    stubFlags({ hospitality_backend_enabled: true, hospitality_frontend_enabled: true });
    expect(await managementEnabled(HOSP.id)).toBe(false);
  });

  it("through the registry: Ecommerce sites never reach the Hospitality gate; Hospitality /manage follows the flags", async () => {
    vi.stubEnv("HOSPITALITY_ENGINE", "on");
    stubFlags({ hospitality_backend_enabled: true, hospitality_management_enabled: true });
    const reg = createEngineRegistry([ecommerceEngine, hospitalityEngine]);
    expect(await gateEdgeRequest(reg, ECOM, get("/manage"))).toBeNull();
    expect(flagsSeen).toEqual([]);
    expect(await gateEdgeRequest(reg, HOSP, get("/manage"))).toBeNull();
    expect((await gateEdgeRequest(reg, HOSP, get("/")))?.status).toBe(404);
  });
});

describe("navigation", () => {
  const all = Object.fromEntries(
    [
      "settings",
      "policies",
      "catalog",
      "media",
      "pricing",
      "bookings",
      "guests",
      "reports",
      "staff.managers",
      "billing.manage",
      "guests.privacy",
    ].map((p) => [p, true]),
  );
  const manager = {
    ...all,
    "staff.managers": false,
    "billing.manage": false,
    "guests.privacy": false,
  };

  it("the owner sees every item; a manager does not see the team", () => {
    expect(visibleNav(all).map((i) => i.key)).toEqual(NAV_ITEMS.map((i) => i.key));
    expect(visibleNav(manager).map((i) => i.key)).not.toContain("team");
    expect(visibleNav(manager).map((i) => i.key)).toContain("bookings");
  });

  it("an item whose permission is missing or false is hidden", () => {
    expect(visibleNav({}).map((i) => i.key)).toEqual(["dashboard"]);
  });

  it("phone: dashboard, bookings and units in the bar, the rest under 'more'", () => {
    const { bar, more } = splitForMobile(visibleNav(all));
    expect(bar.map((i) => i.key)).toEqual(["dashboard", "bookings", "units"]);
    expect(more.map((i) => i.key)).toContain("team");
  });

  it("only built screens are links (2a: the dashboard, 2b.2: business settings)", () => {
    expect(NAV_ITEMS.filter((i) => i.to).map((i) => i.key)).toEqual(["dashboard", "settings"]);
  });
});

describe("setup checklist", () => {
  it("has a step for every key the database returns, in order", () => {
    expect(CHECKLIST_STEPS.map((s) => s.key)).toEqual([...CHECKLIST_KEYS]);
  });
  it("counts progress", () => {
    expect(checklistProgress({})).toEqual({ done: 0, total: 5, percent: 0, complete: false });
    expect(checklistProgress({ business: true, units: true })).toMatchObject({
      done: 2,
      percent: 40,
    });
    expect(
      checklistProgress({ business: true, units: true, photos: true, prices: true, policy: true }),
    ).toMatchObject({ done: 5, complete: true });
  });
});

describe("plan notice", () => {
  const NOW = Date.parse("2026-11-01T10:00:00Z");
  const ctx = (e: Partial<ManagementContext["entitlements"]>): ManagementContext => ({
    role: "owner",
    permissions: {},
    flags: { management: true, frontend: false, booking: false },
    site: { name: "x", slug: "x", status: "active" },
    business: { name: "x", timezone: "Asia/Jerusalem", currency: "ILS" },
    checklist: { business: false, units: false, photos: false, prices: false, policy: false },
    entitlements: { active: true, max_units: 5, units_used: 1, ...e },
  });

  it("inactive subscription → warning (existing bookings continue, nothing new)", () => {
    const n = planNotice(ctx({ active: false }), NOW);
    expect(n?.tone).toBe("warning");
    expect(n?.text).toContain("אינו פעיל");
  });
  it("trial ending within 14 days → days left and the date", () => {
    const n = planNotice(ctx({ status: "trialing", trial_ends_at: "2026-11-04T10:00:00Z" }), NOW);
    expect(n?.text).toBe("תקופת הניסיון מסתיימת בעוד 3 ימים (04.11.2026).");
    expect(
      planNotice(ctx({ status: "trialing", trial_ends_at: "2026-12-30T10:00:00Z" }), NOW),
    ).toBeNull();
  });
  it("at the unit limit → info; unlimited plan → nothing", () => {
    expect(planNotice(ctx({ max_units: 2, units_used: 2 }), NOW)?.text).toContain("מגבלת היחידות");
    expect(planNotice(ctx({ max_units: null, units_used: 50 }), NOW)).toBeNull();
  });
  it("a manager (no plan details) sees only the inactive warning", () => {
    expect(planNotice(ctx({}), NOW)).toBeNull();
  });
});

describe("formatting", () => {
  it("dates in the business timezone, days left, usage", () => {
    expect(formatDate("2026-11-04T22:30:00Z")).toBe("05.11.2026");
    expect(formatDate(null)).toBe("—");
    expect(daysLeft("2026-11-02T00:00:01Z", Date.parse("2026-11-01T00:00:00Z"))).toBe(2);
    expect(daysLeft("2020-01-01T00:00:00Z")).toBe(0);
    expect(daysText(1)).toBe("יום אחד");
    expect(usageText(2, 5)).toBe("2 מתוך 5");
    expect(usageText(7, null)).toBe("7 (ללא הגבלה)");
  });
});
