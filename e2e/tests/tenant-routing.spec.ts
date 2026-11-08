import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { toJSONAsync } from "seroval";
import { hostGet, hostOf, PORT, PRODUCTS, STORE_A, STORE_B, USERS } from "./helpers";
import { accessToken, asPlatform, ensureUser, sql } from "./hospitality-helpers";

// זיהוי העסק בכל בקשה (src/server.ts) — לכל סוגי האתרים, על השרת הבנוי:
//   • חנות, מתחם, פאנל הפלטפורמה, הדומיין הראשי, דומיין מותאם של חנות ושל מתחם (מאומת — העסק שלו;
//     לא מאומת — "לא נמצא", ולא חנות ברירת המחדל);
//   • נתיב של פונקציית שרת שנגמר כמו קובץ (/_serverFn/<id>/x.js): TanStack לוקח את המזהה מהקטע הראשון
//     ומריץ את הפונקציה. לפני התיקון של NURIEL AI הנתיב נחשב "קובץ סטטי" ורץ בלי עסק — והמתג של
//     המנועים (שמחליט לפי העסק) העביר פונקציה של Ecommerce באתר של מתחם. עכשיו הוא מקבל את העסק;
//   • קבצים סטטיים — בלי זיהוי עסק ובלי מסד (גם בכתובת שלא קיימת);
//   • Host / X-Forwarded-Host מזויפים (בקשה ישירה לאפליקציה, בלי Nginx — ב-Nginx הכותרת נדרסת),
//     tenantId בקלט ופונקציה של המנוע השני — לא נותנים גישה לעסק אחר.

test.describe.configure({ mode: "serial" });

const ZIMMER_SLUG = "iso-zimmer";
const ZIMMER = hostOf(ZIMMER_SLUG);
const ZIMMER_OWNER = { email: "iso.zimmer.owner@e2e.test", password: "Iso-Zimmer-Pass-1!" };
const STORE = hostOf(STORE_A.slug);
const OTHER = hostOf(STORE_B.slug);
const PLATFORM = "platform.shop.localhost";
const BASE = "shop.localhost";
const STORE_B_DOMAIN = "iso-store-b.example";
const ZIMMER_DOMAIN = "iso-zimmer.example";
let zimmerId = "";

const fnId = (file: string, name: string) =>
  createHash("sha256").update(`${file}--${name}_createServerFn_handler`).digest("hex");
const PRODUCT_SEO = fnId("src/lib/seo.functions.ts", "getProductSeo");
const ECOM_AI_STATUS = fnId("src/lib/ai-assistant.functions.ts", "ecommerceAiStatus");
const ECOM_AI_ASK = fnId("src/lib/ai-assistant.functions.ts", "ecommerceAiAsk");
const HOSP_AI_STATUS = fnId(
  "src/engines/hospitality/api/assistant.functions.ts",
  "hospitalityAiStatus",
);
const AI_ADMIN_OVERVIEW = fnId("src/lib/ai-admin.functions.ts", "aiAdminOverview");

/**
 * קריאה לפונקציית שרת כמו שהדפדפן שולח. host ו-forwardedHost בנפרד: מאחורי Nginx שניהם הדומיין
 * האמיתי; forwardedHost שונה = כותרת מזויפת שנשלחה ישר לאפליקציה. suffix = נתיב "של קובץ" אחרי המזהה.
 */
async function callFn(
  request: APIRequestContext,
  opts: {
    host: string;
    forwardedHost?: string;
    id: string;
    data?: unknown;
    token?: string;
    method?: "GET" | "POST";
    suffix?: string;
  },
) {
  const payload = JSON.stringify(await toJSONAsync({ data: opts.data }));
  const headers: Record<string, string> = {
    host: opts.host,
    "x-forwarded-host": opts.forwardedHost ?? opts.host,
    "sec-fetch-site": "same-origin",
    "x-tsr-serverFn": "true",
    accept: "application/json",
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
  };
  const url = `http://127.0.0.1:${PORT}/_serverFn/${opts.id}${opts.suffix ?? ""}`;
  return (opts.method ?? "POST") === "GET"
    ? request.get(`${url}?payload=${encodeURIComponent(payload)}`, { headers })
    : request.post(url, {
        headers: { ...headers, "content-type": "application/json" },
        data: payload,
      });
}

const STORE_NOT_FOUND = "החנות לא נמצאה";

function cleanup() {
  const ids = [STORE_B.id, ...(zimmerId ? [zimmerId] : [])].map((id) => `'${id}'`).join(", ");
  for (const t of [
    "ai_notifications",
    "ai_subscription_events",
    "ai_subscription_periods",
    "ai_subscriptions",
  ])
    sql(`DELETE FROM public.${t} WHERE tenant_id IN (${ids})`);
  sql(
    `UPDATE public.tenants SET custom_domain = NULL WHERE custom_domain IN ('${STORE_B_DOMAIN}', '${ZIMMER_DOMAIN}')`,
  );
  const zimmer = sql(`SELECT id FROM public.tenants WHERE slug = '${ZIMMER_SLUG}'`);
  if (zimmer) asPlatform(`SELECT public.platform_delete_tenant('${zimmer}', '${ZIMMER_SLUG}')`);
}

/** דומיין מותאם: נשמר (ממתין לאימות), ואז — אם verified — מסומן כמאומת (כמו אחרי בדיקת DNS) */
function setCustomDomain(tenantId: string, domain: string, verified: boolean) {
  sql(`UPDATE public.tenants SET custom_domain = '${domain}' WHERE id = '${tenantId}'`);
  if (verified)
    sql(`UPDATE public.tenants SET custom_domain_verified_at = now(), custom_domain_status = 'verified'
          WHERE id = '${tenantId}'`);
}

/** חבילת AI פעילה לעסק (הפונקציה של מנהל העל במסד — בלי מסך) */
function activateAi(tenantId: string, product: "ecommerce" | "hospitality") {
  sql(`SELECT public.ai_admin_activate('${USERS.platform.id}', '${tenantId}', '${product}', public.ai_today(), 'E2E routing',
                                       _payment_confirmed => true)`);
  return sql(
    `SELECT max(ends_on) FROM public.ai_subscription_periods WHERE tenant_id = '${tenantId}'`,
  );
}

let storeBEnds = "";
let zimmerEnds = "";

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "API checks");
  cleanup();
  await ensureUser(request, ZIMMER_OWNER);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled', 'hospitality_frontend_enabled')`);
  asPlatform(`SELECT hospitality.admin_create_site('${ZIMMER_SLUG}', 'מתחם הניתוב')`);
  zimmerId = sql(`SELECT id FROM public.tenants WHERE slug = '${ZIMMER_SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${zimmerId}', id, email, 'iso_zimmer_owner', 'admin', true, true FROM auth.users WHERE email = '${ZIMMER_OWNER.email}'`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${zimmerId}', 'hospitality_backend_enabled', true), ('${zimmerId}', 'hospitality_management_enabled', true),
       ('${zimmerId}', 'hospitality_frontend_enabled', true)`);
  storeBEnds = activateAi(STORE_B.id, "ecommerce");
  zimmerEnds = activateAi(zimmerId, "hospitality");
  await expect
    .poll(async () => (await hostGet(request, ZIMMER, "/manage")).status(), { timeout: 20_000 })
    .toBe(200);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("static files: no business lookup — the same file on every address, even one that does not exist", async ({
  request,
}) => {
  const dir = fileURLToPath(new URL("../../.output/public/assets", import.meta.url));
  const asset = readdirSync(dir).find((f) => f.endsWith(".js"));
  expect(asset).toBeTruthy();
  for (const host of [STORE, ZIMMER, PLATFORM, "no-such-store.shop.localhost", "unknown.example"]) {
    const res = await hostGet(request, host, `/assets/${asset}`);
    expect(res.status(), host).toBe(200);
    expect(res.headers()["content-type"], host).toContain("javascript");
  }
});

test("a server function path that ends like a file gets the business of the address and the engine switch", async ({
  request,
}) => {
  const seo = (host: string, id: string, suffix?: string) =>
    callFn(request, {
      host,
      id: PRODUCT_SEO,
      data: { id },
      method: "GET",
      ...(suffix ? { suffix } : {}),
    });
  for (const suffix of ["/x.js", "/a/b.css", "/x.json"]) {
    // החנות: אותה תשובה כמו בנתיב הרגיל — המוצר שלה
    const own = await seo(STORE, PRODUCTS.a1.id, suffix);
    expect(own.status(), suffix).toBe(200);
    expect(await own.text(), suffix).toContain(PRODUCTS.a1.name);
    // חנות אחרת: המוצר של החנות הראשונה לא נמצא שם
    const other = await seo(OTHER, PRODUCTS.a1.id, suffix);
    expect(await other.text(), suffix).not.toContain(PRODUCTS.a1.name);
    // מתחם: פונקציה של Ecommerce — לא קיימת (המתג של המנועים; לפני התיקון רצה "בלי עסק")
    expect((await seo(ZIMMER, PRODUCTS.a1.id, suffix)).status(), suffix).toBe(404);
    // כתובת של חנות שלא קיימת: "החנות לא נמצאה" — לא ריצה בלי עסק
    const missing = await seo("no-such-store.shop.localhost", PRODUCTS.a1.id, suffix);
    expect(missing.status(), suffix).toBe(404);
    expect(await missing.text(), suffix).toContain(STORE_NOT_FOUND);
  }
  // והעוזר של Ecommerce בנתיב כזה באתר המתחם — גם הוא לא קיים
  const token = await accessToken(request, ZIMMER_OWNER);
  expect(
    (await callFn(request, { host: ZIMMER, id: ECOM_AI_STATUS, token, suffix: "/x.js" })).status(),
  ).toBe(404);
});

test("custom domains: a verified store domain and a verified zimmer domain serve their own business; an unverified one serves none", async ({
  request,
}) => {
  // לפני האימות: לא חנות ברירת המחדל ולא החנות עצמה
  setCustomDomain(STORE_B.id, STORE_B_DOMAIN, false);
  setCustomDomain(zimmerId, ZIMMER_DOMAIN, false);
  for (const host of [STORE_B_DOMAIN, ZIMMER_DOMAIN]) {
    const res = await hostGet(request, host, "/sitemap.xml");
    expect(res.status(), host).toBe(404);
    expect(await res.text(), host).toContain(STORE_NOT_FOUND);
  }

  setCustomDomain(STORE_B.id, STORE_B_DOMAIN, true);
  setCustomDomain(zimmerId, ZIMMER_DOMAIN, true);
  // המטמון של זיהוי העסק — עד 15 שניות
  await expect
    .poll(async () => (await hostGet(request, STORE_B_DOMAIN, "/sitemap.xml")).status(), {
      timeout: 25_000,
    })
    .toBe(200);
  const sitemap = await (await hostGet(request, STORE_B_DOMAIN, "/sitemap.xml")).text();
  expect(sitemap).toContain(PRODUCTS.b1.id);
  expect(sitemap).not.toContain(PRODUCTS.a1.id);

  // החנות בדומיין שלה: העוזר שלה (החבילה של חנות B) — כמו בכתובת הרגילה
  const ownerB = await accessToken(request, USERS.ownerB);
  for (const host of [OTHER, STORE_B_DOMAIN]) {
    const res = await callFn(request, { host, id: ECOM_AI_STATUS, token: ownerB });
    const body = await res.text();
    expect(res.status(), host).toBe(200);
    expect(body, host).toContain(storeBEnds);
    expect(body, host).toContain("NURIEL AI – Ecommerce");
  }
  // פונקציה של המנוע השני בדומיין של החנות — לא קיימת
  expect(
    (await callFn(request, { host: STORE_B_DOMAIN, id: HOSP_AI_STATUS, token: ownerB })).status(),
  ).toBe(404);

  // המתחם בדומיין שלו: העוזר של Hospitality; של Ecommerce — לא קיים
  const zimmerOwner = await accessToken(request, ZIMMER_OWNER);
  await expect
    .poll(
      async () =>
        (
          await callFn(request, { host: ZIMMER_DOMAIN, id: HOSP_AI_STATUS, token: zimmerOwner })
        ).status(),
      { timeout: 25_000 },
    )
    .toBe(200);
  for (const host of [ZIMMER, ZIMMER_DOMAIN]) {
    const body = await (
      await callFn(request, { host, id: HOSP_AI_STATUS, token: zimmerOwner })
    ).text();
    expect(body, host).toContain(zimmerEnds);
    expect(body, host).toContain("NURIEL AI – Hospitality");
    expect(
      (await callFn(request, { host, id: ECOM_AI_STATUS, token: zimmerOwner })).status(),
      host,
    ).toBe(404);
  }
});

test("forged Host / X-Forwarded-Host, tenantId in the input, the other engine's function: no access to another business", async ({
  request,
}) => {
  const ownerA = await accessToken(request, USERS.ownerA);
  const ownerB = await accessToken(request, USERS.ownerB);
  // הבעלים של חנות A שולח ישר לאפליקציה Host של A עם X-Forwarded-Host של B (ל-B יש חבילה פעילה):
  // ההקשר הוא של B, ובו אין לו תפקיד — לא רואה כלום ולא שואל
  const forgedStatus = await callFn(request, {
    host: STORE,
    forwardedHost: OTHER,
    id: ECOM_AI_STATUS,
    token: ownerA,
  });
  expect(forgedStatus.status()).toBe(200);
  const forgedBody = await forgedStatus.text();
  expect(forgedBody).toContain("visible");
  expect(forgedBody).not.toContain(storeBEnds);
  const forgedAsk = await callFn(request, {
    host: STORE,
    forwardedHost: OTHER,
    id: ECOM_AI_ASK,
    token: ownerA,
    data: { question: "איך מוסיפים מוצר?", tenantId: STORE_B.id },
  });
  expect(await forgedAsk.text()).toContain("אין הרשאה");

  // הכיוון ההפוך: הבעלים של B עם Host של B ו-X-Forwarded-Host של A — לא רואה את B דרך A
  const reverse = await (
    await callFn(request, { host: OTHER, forwardedHost: STORE, id: ECOM_AI_STATUS, token: ownerB })
  ).text();
  expect(reverse).not.toContain(storeBEnds);

  // tenantId / מצב "פעיל" בקלט — לא משנים את העסק (A אין לו חבילה; התשובה של A בלבד)
  const viaInput = await (
    await callFn(request, {
      host: STORE,
      id: ECOM_AI_STATUS,
      token: ownerA,
      data: { tenantId: STORE_B.id, status: "active", endsOn: storeBEnds },
    })
  ).text();
  expect(viaInput).not.toContain(storeBEnds);

  // X-Forwarded-Host של מתחם על פונקציה של Ecommerce → לא קיימת; העוזר של המתחם — לא למי שאינו מנהל שלו
  expect(
    (
      await callFn(request, {
        host: STORE,
        forwardedHost: ZIMMER,
        id: ECOM_AI_STATUS,
        token: ownerA,
      })
    ).status(),
  ).toBe(404);
  const hospForged = await (
    await callFn(request, { host: STORE, forwardedHost: ZIMMER, id: HOSP_AI_STATUS, token: ownerA })
  ).text();
  expect(hospForged).not.toContain(zimmerEnds);
  // פונקציה של Hospitality בחנות — לא קיימת
  expect((await callFn(request, { host: STORE, id: HOSP_AI_STATUS, token: ownerA })).status()).toBe(
    404,
  );

  // X-Forwarded-Host של פאנל הפלטפורמה: מנהל עסק לא מקבל שום פונקציה של מנהל העל
  const asPanel = await callFn(request, {
    host: STORE,
    forwardedHost: PLATFORM,
    id: AI_ADMIN_OVERVIEW,
    token: ownerA,
  });
  expect(await asPanel.text()).toContain("אין הרשאה");
});

test("the platform panel and the main domain: no business assistant there; the admin functions only on the panel host", async ({
  request,
}) => {
  const platform = await accessToken(request, USERS.platform);
  // בפאנל: אין עסק — העוזר של Ecommerce לא מוצג, של Hospitality לא קיים
  const ecom = await (
    await callFn(request, { host: PLATFORM, id: ECOM_AI_STATUS, token: platform })
  ).text();
  expect(ecom).toContain("visible");
  expect(ecom).not.toContain("NURIEL AI – Ecommerce");
  expect(
    (await callFn(request, { host: PLATFORM, id: HOSP_AI_STATUS, token: platform })).status(),
  ).toBe(404);
  // הפונקציות של מנהל העל: בפאנל — כן; בדומיין הראשי, בחנות ובמתחם — לא
  const overview = await callFn(request, {
    host: PLATFORM,
    id: AI_ADMIN_OVERVIEW,
    token: platform,
  });
  expect(overview.status()).toBe(200);
  expect(await overview.text()).toContain("monthlyBudgetUsd");
  for (const host of [BASE, STORE, OTHER]) {
    const res = await callFn(request, { host, id: AI_ADMIN_OVERVIEW, token: platform });
    expect(await res.text(), host).toContain("אין הרשאה");
  }
  expect(
    (await callFn(request, { host: ZIMMER, id: AI_ADMIN_OVERVIEW, token: platform })).status(),
  ).toBe(404);
});

test("no regression: the pages of every kind of address answer as before", async ({ request }) => {
  // עמוד הבית של חנות (המוצרים נטענים בדפדפן — כאן: ה-HTML של השרת הוא של החנות הנכונה)
  const home = await hostGet(request, STORE, "/");
  expect(home.status()).toBe(200);
  const homeHtml = await home.text();
  expect(homeHtml).toContain('siteType:"ecommerce"');
  expect(homeHtml).toContain("isDefaultStore:!0");
  const homeB = await hostGet(request, OTHER, "/");
  expect(homeB.status()).toBe(200);
  const homeBHtml = await homeB.text();
  expect(homeBHtml).toContain('siteType:"ecommerce"');
  expect(homeBHtml).toContain("isDefaultStore:!1");
  expect((await hostGet(request, BASE, "/robots.txt")).status()).toBe(200);
  expect((await hostGet(request, ZIMMER, "/manage")).status()).toBe(200);
  const panel = await hostGet(request, PLATFORM, "/platform");
  expect([200, 302, 307]).toContain(panel.status());
  const missing = await hostGet(request, "no-such-store.shop.localhost", "/");
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain(STORE_NOT_FOUND);
});
