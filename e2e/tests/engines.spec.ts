import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { toJSONAsync } from "seroval";
import { hostGet, hostOf, PORT, STORE_A, USERS } from "./helpers";

// Hospitality Stage 1f — the engine layer on the real built server:
//   • Ecommerce routes, feeds and server functions behave as before;
//   • a Hospitality site serves no store page (404), robots.txt disallows everything;
//   • the dispatcher runs each server function only on its own engine's sites, and a
//     Hospitality function only when the engine switch and the site's flags are on;
//   • platform (shared) functions run on every kind of site.
// Server functions are called directly by their build id: sha256("<file>--<export>_createServerFn_handler").

test.describe.configure({ mode: "serial" });

const SLUG = "h1f-stay";
const STORE = hostOf(STORE_A.slug);
const HOSP = hostOf(SLUG);
let siteId = "";
let unitId = "";

function sql(query: string): string {
  const url = process.env["DB_URL"];
  if (!url) throw new Error("e2e/.env.e2e is not loaded (DB_URL)");
  return execFileSync("psql", [url, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  }).trim();
}
const asPlatform = (query: string) =>
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub',
      (SELECT id FROM auth.users WHERE email = '${USERS.platform.email}'), 'role', 'authenticated')::text, false);
    ${query}`);

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
  sql(`UPDATE public.platform_feature_flags SET enabled = false
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_booking_enabled')`);
}

const fnId = (file: string, name: string) =>
  createHash("sha256").update(`${file}--${name}_createServerFn_handler`).digest("hex");
const HOSP_QUOTE = fnId("src/engines/hospitality/server/public.functions.ts", "hospitalityQuote");
const ECOM_PRODUCT_SEO = fnId("src/lib/seo.functions.ts", "getProductSeo");
const PLATFORM_PORTAL_SLUG = fnId("src/lib/portal.functions.ts", "checkPortalSlug");

/** a server-function call as the browser makes it (same-origin, serialized payload) */
async function callFn(
  request: APIRequestContext,
  host: string,
  id: string,
  data: unknown,
  method: "GET" | "POST" = "POST",
) {
  const payload = JSON.stringify(await toJSONAsync({ data }));
  const headers = {
    host,
    "x-forwarded-host": host,
    "sec-fetch-site": "same-origin",
    "x-tsr-serverFn": "true",
    accept: "application/json",
  };
  const url = `http://127.0.0.1:${PORT}/_serverFn/${id}`;
  return method === "GET"
    ? request.get(`${url}?payload=${encodeURIComponent(payload)}`, { headers })
    : request.post(url, {
        headers: { ...headers, "content-type": "application/json" },
        data: payload,
      });
}

test.beforeAll(() => {
  cleanup();
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG}', 'אירוח 1f')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status) VALUES ('${siteId}', 'מתחם', 'p', 'active');
       INSERT INTO hospitality.units (tenant_id, property_id, name, slug, base_price)
         SELECT '${siteId}', id, 'צימר', 'z', 600 FROM hospitality.properties WHERE tenant_id = '${siteId}'`);
  unitId = sql(`SELECT id FROM hospitality.units WHERE tenant_id = '${siteId}'`);
});

test.afterAll(() => cleanup());

test("Ecommerce: the store, its robots.txt and its server functions work as before", async ({
  request,
}) => {
  expect((await hostGet(request, STORE, "/")).status()).toBe(200);
  const robots = await hostGet(request, STORE, "/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).not.toBe("User-agent: *\nDisallow: /\n");
  const seo = await callFn(
    request,
    STORE,
    ECOM_PRODUCT_SEO,
    { id: "00000000-0000-0000-0000-000000000000" },
    "GET",
  );
  expect(seo.status(), await seo.text()).toBe(200);
});

test("a Hospitality site serves no store page, and robots.txt disallows everything", async ({
  request,
}) => {
  for (const path of [
    "/",
    "/admin",
    "/login",
    "/products/x",
    "/sitemap.xml",
    "/llms.txt",
    "/zap",
  ]) {
    const res = await hostGet(request, HOSP, path);
    expect(res.status(), path).toBe(404);
    expect(res.headers()["x-robots-tag"], path).toBe("noindex");
  }
  expect(await (await hostGet(request, HOSP, "/")).text()).toContain("האתר עדיין לא פתוח");
  const robots = await hostGet(request, HOSP, "/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");
});

test("server functions run only on their own engine's sites", async ({ request }) => {
  const stay = { unitId, checkIn: "2027-03-10", checkOut: "2027-03-12" };
  // a Hospitality function on a store → 404
  expect((await callFn(request, STORE, HOSP_QUOTE, stay)).status()).toBe(404);
  // a store function on a Hospitality site → 404
  expect(
    (
      await callFn(
        request,
        HOSP,
        ECOM_PRODUCT_SEO,
        { id: "00000000-0000-0000-0000-000000000000" },
        "GET",
      )
    ).status(),
  ).toBe(404);
  // the site's own Hospitality function while its flags are off → 404
  expect((await callFn(request, HOSP, HOSP_QUOTE, stay)).status()).toBe(404);
  // a platform (shared) function is not blocked on a Hospitality site (it fails on its own input check)
  expect(
    (await callFn(request, HOSP, PLATFORM_PORTAL_SLUG, { token: "x", slug: "abc" })).status(),
  ).not.toBe(404);

  // flags on for this site → the Hospitality function runs against the database
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_booking_enabled');
       INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ('${siteId}', 'hospitality_backend_enabled', true), ('${siteId}', 'hospitality_booking_enabled', true)`);
  await expect
    .poll(async () => (await callFn(request, HOSP, HOSP_QUOTE, stay)).status(), { timeout: 20_000 })
    .toBe(200);
  const quote = await callFn(request, HOSP, HOSP_QUOTE, stay);
  const body = await quote.text();
  expect(body).toContain("available");
  expect(body).toContain("policy_hash");
  // … and the store function is still not available there
  expect(
    (
      await callFn(
        request,
        HOSP,
        ECOM_PRODUCT_SEO,
        { id: "00000000-0000-0000-0000-000000000000" },
        "GET",
      )
    ).status(),
  ).toBe(404);
  // … and the Hospitality function is still not available on a store
  expect((await callFn(request, STORE, HOSP_QUOTE, stay)).status()).toBe(404);
  // input is validated before the database (invalid dates → the validator's error, no quote;
  // TanStack returns server-function errors serialized, with HTTP 200)
  const bad = await callFn(request, HOSP, HOSP_QUOTE, {
    unitId,
    checkIn: "2027-03-12",
    checkOut: "2027-03-10",
  });
  const badBody = await bad.text();
  expect(badBody).toContain("תאריכי השהייה לא תקינים");
  expect(badBody).not.toContain("policy_hash");
});
