// NURIEL AI SEO ENGINE — the server pieces that do not need a database: store templates (facts only), the AI
// answer filter (no invented claims), package templates (the owner's own words), the Search Console connect
// ticket (signed, short, tamper-proof) and the worker's job flow with fake dependencies.
import { beforeAll, describe, expect, it } from "vitest";
import {
  storeTemplateProposals,
  firstSentences,
  type StoreSnapshot,
} from "@/lib/seo/store-templates";
import { parseStoreSeoOutput, storeAiRefs, storeSeoSchema } from "@/lib/seo/store-ai";
import { templateProposals, openingOf } from "@/engines/hospitality/website/seo-templates";
import { signTicket, verifyTicket } from "@/platform/seo/gsc/oauth.server";
import {
  handleJob,
  runJob,
  type SeoJob,
  type TenantBasics,
  type WorkerDeps,
} from "@/platform/seo/worker.server";
import { registerSeoEngine } from "@/platform/seo/engines";
import { centerViewOf, currentAndPrevious } from "@/platform/seo/center.server";
import type { SeoCenterData, SeoSnapshot } from "@/platform/seo/types";
import type { PublicSite } from "@/engines/hospitality/types/website";

beforeAll(() => {
  process.env["AI_ASSISTANT_SECRET"] = "test-secret-for-the-seo-engine-tickets-0123456789";
});

const snap = (over: Partial<StoreSnapshot> = {}): StoreSnapshot => ({
  store: { name: "כלי בית שירה", seo_title: null, seo_description: null, seo_keywords: null },
  categories: [
    {
      id: "c1",
      name: "מטבח",
      parent: null,
      seo_title: null,
      seo_description: null,
      products: 12,
      top: ["כוס קרמיקה", "קערת הגשה", "צלחת עמוקה"],
    },
    {
      id: "c2",
      name: "טקסטיל",
      parent: null,
      seo_title: "כבר נכתב",
      seo_description: null,
      products: 4,
      top: ["מגבת"],
    },
    {
      id: "c3",
      name: "ריקה",
      parent: null,
      seo_title: null,
      seo_description: null,
      products: 0,
      top: [],
    },
  ],
  products: [
    {
      id: "p1",
      name: "כוס קרמיקה בעבודת יד",
      category: "מטבח",
      description: 'כוס קרמיקה בנפח 350 מ"ל, מתאימה למדיח. בכל כוס גוון מעט שונה.',
      seo_title: null,
      seo_description: null,
      seo_keywords: null,
    },
    {
      id: "p2",
      name: "מגבת כותנה",
      category: "טקסטיל",
      description: null,
      seo_title: "מגבת שהבעלים כתב",
      seo_description: null,
      seo_keywords: null,
    },
  ],
  ...over,
});

describe("store templates — only the store's own facts, empty fields only", () => {
  it("proposes for empty fields, never for a field the owner wrote, never for an empty category", () => {
    const items = storeTemplateProposals(snap());
    const key = (i: (typeof items)[number]) => `${i.target_kind}:${i.target_id ?? ""}:${i.field}`;
    const keys = items.map(key);
    expect(keys).toContain("store::seo_title");
    expect(keys).toContain("store::seo_description");
    expect(keys).toContain("category:c1:seo_title");
    expect(keys).toContain("category:c1:seo_description");
    expect(keys).not.toContain("category:c2:seo_title"); // the owner's
    expect(keys.some((k) => k.startsWith("category:c3"))).toBe(false); // no products
    expect(keys).toContain("product:p1:seo_title");
    expect(keys).not.toContain("product:p2:seo_title"); // the owner's
    expect(items.every((i) => i.source === "template" && i.reason.length > 0)).toBe(true);
  });
  it("uses real product names in the category description, the owner's first sentence for a product", () => {
    const items = storeTemplateProposals(snap());
    const cat = items.find((i) => i.target_id === "c1" && i.field === "seo_description")!;
    expect(cat.text).toContain("כוס קרמיקה");
    const prod = items.find((i) => i.target_id === "p1" && i.field === "seo_description")!;
    expect(prod.text.startsWith("כוס קרמיקה בנפח 350")).toBe(true);
    expect(prod.reason).toContain("כתבתם");
  });
  it("invents nothing: no prices, shipping, discounts or superlatives; titles fit Google's ~60 characters", () => {
    for (const i of storeTemplateProposals(snap())) {
      expect(i.text).not.toMatch(/₪|משלוח|הנחה|הכי|הזול|מבצע/);
      if (i.field === "seo_title") expect(i.text.length).toBeLessThanOrEqual(60);
      if (i.field === "seo_description") expect(i.text.length).toBeLessThanOrEqual(155);
    }
  });
  it("firstSentences never cuts a word and drops emoji / tags", () => {
    expect(firstSentences("<b>שלום</b> 🎉 עולם. משפט שני ארוך מאוד ".repeat(3), 40)).not.toMatch(
      /[<>🎉]/u,
    );
    expect(firstSentences("קצר", 155)).toBeNull();
  });
});

describe("store AI — the answer is filtered; invented claims never become proposals", () => {
  const refs = storeAiRefs(snap(), 12);
  it("asks only for the missing fields, with a strict schema", () => {
    expect(refs.find((r) => r.id === "p2")?.needs).toEqual(["seo_description"]);
    const schema = storeSeoSchema(refs.map((r) => r.ref)) as {
      properties: { items: { maxItems: number } };
    };
    expect(schema.properties.items.maxItems).toBe(refs.length);
  });
  it("drops prices, shipping, links, phones, markup, unknown refs and fields that were not asked for", () => {
    const p1 = refs.find((r) => r.id === "p1")!;
    const p2 = refs.find((r) => r.id === "p2")!;
    const out = parseStoreSeoOutput(
      {
        items: [
          {
            ref: p1.ref,
            seo_title: "כוס קרמיקה בעבודת יד | מטבח",
            seo_description:
              "כוס קרמיקה ב-49 ₪ עם משלוח חינם לכל הארץ — הזדמנות שלא תחזור, הזמינו עכשיו באתר",
          },
          {
            ref: p2.ref,
            seo_title: "ניסיון לדרוס את הכותרת של הבעלים",
            seo_description:
              "מגבת כותנה רכה ונעימה לשימוש יומיומי בבית, מתאימה לכביסה במכונה. הזמינו באתר.",
          },
          { ref: "p99", seo_title: "לא קיים", seo_description: null },
          { ref: p1.ref, seo_title: "<script>x</script>", seo_description: null },
        ],
      },
      refs,
    );
    const got = out.map((o) => `${o.target_id}:${o.field}`);
    expect(got).toContain("p1:seo_title");
    expect(got).not.toContain("p1:seo_description"); // ₪ + שיפוח חינם — invented
    expect(got).not.toContain("p2:seo_title"); // not asked (the owner wrote it)
    expect(got).toContain("p2:seo_description");
    expect(out.every((o) => o.source === "ai")).toBe(true);
    expect(out.some((o) => o.text.includes("<"))).toBe(false);
  });
});

describe("hospitality package templates — the owner's own words, never the package description field", () => {
  const site = {
    business: { name: "נופי דורית", address: "מושב ישעי" },
    properties: [
      { property_type: "zimmer_complex", address: "מושב ישעי", description: null, media: [] },
    ],
    units: [
      {
        id: "u1",
        name: "מוריה",
        kind: "unit",
        unit_type: "zimmer",
        capacity: 2,
        bedrooms: 1,
        bathrooms: 1,
        amenities: [],
        media: [],
      },
    ],
    packages: [
      {
        id: "k1",
        name: "חבילת הכלה VIP – רגעים של קסם בנופי דורית ❤️",
        description:
          "חבילת הכלה שלנו נבנתה במיוחד כדי להעניק לכלה ולמשפחה רגעים של שקט, יופי והתארגנות. הג'קוזי יתווסף בקרוב.",
        nights: 2,
        unit_id: "u1",
      },
    ],
  } as unknown as PublicSite;
  const items = templateProposals({ site, design: { seo: {}, sections: [] } as never });
  const pkg = items.filter((i) => i.target_kind === "package");
  it("proposes only the Google title / description of the package", () => {
    expect(pkg.map((i) => i.field).sort()).toEqual(["seo_description", "seo_title"]);
  });
  it("the title is the package name without emoji (it already includes the business name)", () => {
    const t = pkg.find((i) => i.field === "seo_title")!;
    expect(t.text).toBe("חבילת הכלה VIP – רגעים של קסם בנופי דורית");
  });
  it("the description is the owner's opening sentence — nothing added (the jacuzzi sentence is not invented or changed)", () => {
    const d = pkg.find((i) => i.field === "seo_description")!;
    expect(d.text.startsWith("חבילת הכלה שלנו נבנתה במיוחד")).toBe(true);
    expect(site.packages?.[0]?.description).toContain(d.text.replace(/…$/, "").slice(0, 40));
    expect(openingOf("קצר מדי", 155)).toBeNull();
  });
});

describe("Search Console connect ticket", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  const U = "22222222-2222-4222-8222-222222222222";
  it("round-trips, and expires after 10 minutes", () => {
    const now = Date.now();
    const t = signTicket({ t: T, u: U, r: "https://shop.example/admin?tab=seo" }, now);
    expect(verifyTicket(t, now + 60_000)?.t).toBe(T);
    expect(verifyTicket(t, now + 11 * 60_000)).toBeNull();
  });
  it("any change to the payload or the signature is refused", () => {
    const t = signTicket({ t: T, u: U, r: "https://shop.example/admin?tab=seo" });
    const [p, s] = t.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), t: U }),
    ).toString("base64url");
    expect(verifyTicket(`${forged}.${s}`)).toBeNull();
    // one character of the signature changed — to one it is not already (a random signature can start with "x")
    const other = s![0] === "x" ? "y" : "x";
    expect(verifyTicket(`${p}.${other}${s!.slice(1)}`)).toBeNull();
    expect(verifyTicket(`${p}`)).toBeNull();
    expect(verifyTicket(null)).toBeNull();
  });
  it("refuses a non-https return address and a bad business id", () => {
    expect(verifyTicket(signTicket({ t: T, u: U, r: "http://evil.example/" }))).toBeNull();
    expect(verifyTicket(signTicket({ t: "not-a-uuid", u: U, r: "https://a.example/" }))).toBeNull();
  });
});

describe("the worker — job flow with fake dependencies", () => {
  const basics: TenantBasics = {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "shop",
    name: "חנות",
    site_type: "ecommerce",
    status: "active",
    domain: null,
    custom_domain: null,
    custom_domain_status: null,
    settings: null,
  };
  const page = (title: string) =>
    `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><meta name="description" content="תיאור"><link rel="canonical" href="https://shop.example/"></head><body><h1>${title}</h1></body></html>`;
  const fake = (over: Partial<WorkerDeps> & { status?: number } = {}) => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const deps: WorkerDeps = {
      rpc: async <T>(fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "seo_tenant_basics") return basics as T;
        return { added: 1 } as T;
      },
      fetcherFor: () => async (url) =>
        url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")
          ? { status: 404, headers: {}, body: null, finalUrl: url }
          : {
              status: over.status ?? 200,
              headers: { "content-type": "text/html" },
              body: page("דף הבית"),
              finalUrl: url,
            },
      originsOf: async () => ({ origin: "https://shop.example", hosts: ["shop.example"] }),
      backgroundAi: () => false,
      ...over,
    };
    return { deps, calls };
  };
  const job = (kind: SeoJob["kind"], entity_type: string | null = null): SeoJob => ({
    id: 7,
    tenant_id: basics.id,
    kind,
    entity_type,
    attempts: 1,
  });

  it("an audit saves the result of the business's own site", async () => {
    const { deps, calls } = fake();
    const out = await handleJob(job("audit"), deps);
    expect(out.status).toBe("done");
    const save = calls.find((c) => c.fn === "seo_audit_save");
    expect(save?.args["_tenant"]).toBe(basics.id);
    expect(save?.args["_source"]).toBe("scheduled");
  });
  it("a site that is not open is skipped, not scored", async () => {
    const { deps, calls } = fake({ status: 403 });
    const out = await handleJob(job("audit"), deps);
    expect(out.status).toBe("skipped");
    expect(calls.some((c) => c.fn === "seo_audit_save")).toBe(false);
  });
  it("entity jobs go to the engine's handler (never AI unless the platform switch is on)", async () => {
    const seen: unknown[] = [];
    registerSeoEngine("ecommerce", {
      proposals: async (input) => {
        seen.push(input);
        return { ok: true };
      },
      facts: async () => null,
    });
    const { deps } = fake();
    const out = await handleJob(job("entity", "product"), deps);
    expect(out.status).toBe("done");
    expect(seen[0]).toMatchObject({
      tenantId: basics.id,
      scope: "entity",
      entityType: "product",
      ai: false,
    });
  });
  it("a failing job goes back to the queue with the error (the database caps the attempts)", async () => {
    const { deps, calls } = fake({
      rpc: async <T>(fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "seo_tenant_basics") throw new Error("db down");
        return null as T;
      },
    });
    await runJob(job("audit"), deps);
    const fin = calls.find((c) => c.fn === "seo_job_finish");
    expect(fin?.args).toMatchObject({ _id: 7, _status: "queued" });
    expect(String(fin?.args["_error"])).toContain("db down");
  });
  it("Search Console without the platform's OAuth client: skipped, nothing called at Google", async () => {
    delete process.env["GSC_OAUTH_CLIENT_ID"];
    const { deps } = fake();
    const out = await handleJob(job("gsc_sync"), deps);
    expect(out).toMatchObject({ status: "skipped", result: { reason: "not_configured" } });
  });
});

describe("SEO center — opportunities from the newest Search Console period only", () => {
  const s = (id: string, start: string, end: string, rows: SeoSnapshot["rows"]): SeoSnapshot => ({
    id,
    dimension: "query",
    period_start: start,
    period_end: end,
    source: "api",
    rows,
    totals: {},
    created_at: end,
  });
  it("pairs the newest snapshot with the period before it", () => {
    const cur = s("a", "2026-10-20", "2026-11-17", [
      { key: "נופי דורית", clicks: 10, impressions: 400, ctr: 0.025, position: 1.2 },
    ]);
    const prev = s("b", "2026-09-22", "2026-10-19", [
      { key: "נופי דורית", clicks: 40, impressions: 500, ctr: 0.08, position: 1.1 },
    ]);
    expect(currentAndPrevious([prev, cur])).toEqual({ cur, prev });
    const view = centerViewOf(
      {
        site_type: "hospitality",
        can_connect_gsc: true,
        settings: {
          auto_apply: { alt: false, meta: false, keywords: false },
          weekly_audit: true,
          initial_done_at: null,
        },
        pending_proposals: 0,
        audit: null,
        audits: [],
        keywords: [],
        gsc: {
          connected: true,
          property: "sc-domain:x",
          status: "connected",
          last_sync_at: null,
          last_error: null,
          platform_connection: false,
          snapshots: [prev, cur],
        },
      } as SeoCenterData,
      true,
    );
    expect(view.opportunities.some((o) => o.kind === "drop" && o.key === "נופי דורית")).toBe(true);
    expect(view.opportunities_period).toEqual({ start: "2026-10-20", end: "2026-11-17" });
  });
});
