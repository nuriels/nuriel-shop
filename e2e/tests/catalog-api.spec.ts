import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostGet, hostOf, STORE_A, supabaseEnv, USERS } from "./helpers";
import { accessToken, asPlatform, ensureUser, sql } from "./hospitality-helpers";

// Hospitality Stage 2c.1 — מתחמים ויחידות דרך ה-API האמיתי (PostgREST + GoTrue), לפני המסכים (2c.2):
//   • הבעלים והמנהל יוצרים ועורכים דרך פונקציות המסד; ארכיון / מחיקה — הבעלים בלבד;
//   • כתיבה ישירה לטבלאות (POST / PATCH / DELETE) נחסמת לכולם; קריאה נשארת לפי האתר;
//   • אתר אחר, אורח, בעל חנות ואנונימי — נחסמים; מגבלת החבילה נשמרת גם דרך ה-API;
//   • נתוני החנויות לא משתנים.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "c2c1.owner@e2e.test", password: "C2c1-Owner-Pass-1!" };
const MANAGER = { email: "c2c1.manager@e2e.test", password: "C2c1-Manager-Pass-1!" };
const OTHER_OWNER = { email: "c2c1.other@e2e.test", password: "C2c1-Other-Pass-1!" };
const SLUG = "c2c1-api";
const OTHER = "c2c1-api-b";
let siteId = "";
let otherId = "";
let storeHash = "";
const tokens: Record<string, string> = {};

const storeDataHash = () =>
  sql(`SELECT md5(concat_ws('|',
         (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
            JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
         (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
            JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce')))`);

function cleanup() {
  for (const slug of [SLUG, OTHER]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

/** PostgREST בסכמת hospitality, עם האתר וטוקן המשתמש (כמו שהשרת יקרא) */
function rest(
  request: APIRequestContext,
  path: string,
  opts: { token?: string; site: string; method?: string; data?: unknown },
) {
  const { url, anonKey } = supabaseEnv();
  return request.fetch(`${url}/rest/v1/${path}`, {
    method: opts.method ?? "GET",
    headers: {
      apikey: anonKey,
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      "x-tenant-id": opts.site,
      "accept-profile": "hospitality",
      "content-profile": "hospitality",
      "content-type": "application/json",
    },
    ...(opts.data === undefined ? {} : { data: opts.data }),
  });
}
const rpc = (
  request: APIRequestContext,
  fn: string,
  data: unknown,
  token?: string,
  site = siteId,
) => rest(request, `rpc/${fn}`, { method: "POST", data, site, ...(token ? { token } : {}) });

test.beforeAll(async ({ request }) => {
  cleanup();
  storeHash = storeDataHash();
  for (const u of [OWNER, MANAGER, OTHER_OWNER]) await ensureUser(request, u);
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG}', 'צימרי הגליל')`);
  asPlatform(`SELECT hospitality.admin_create_site('${OTHER}', 'אתר אחר')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  otherId = sql(`SELECT id FROM public.tenants WHERE slug = '${OTHER}'`);
  const add = (site: string, email: string, username: string, owner: boolean) =>
    sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
         SELECT '${site}', id, email, '${username}', 'admin', true, ${owner} FROM auth.users WHERE email = '${email}'`);
  add(siteId, OWNER.email, "c2c1_owner", true);
  add(siteId, MANAGER.email, "c2c1_manager", false);
  add(otherId, OTHER_OWNER.email, "c2c1_other", true);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  for (const id of [siteId, otherId])
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ('${id}', 'hospitality_backend_enabled', true), ('${id}', 'hospitality_management_enabled', true)`);
  await expect
    .poll(async () => (await hostGet(request, hostOf(SLUG), "/manage/login")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
  tokens["owner"] = await accessToken(request, OWNER);
  tokens["manager"] = await accessToken(request, MANAGER);
  tokens["other"] = await accessToken(request, OTHER_OWNER);
  tokens["storeOwner"] = await accessToken(request, USERS.ownerA);
  tokens["guest"] = await accessToken(request, USERS.customerA);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

let propertyId = "";
let unitId = "";

test("owner and manager build the catalog through the database functions", async ({ request }) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const created = await rpc(
    request,
    "property_create",
    { _data: { name: "מתחם הגליל", property_type: "zimmer_complex" } },
    tokens["owner"],
  );
  expect(created.status(), await created.text()).toBe(200);
  propertyId = ((await created.json()) as { id: string }).id;

  const unit = await rpc(
    request,
    "unit_create",
    { _property_id: propertyId, _data: { name: "צימר האלון", unit_type: "zimmer", capacity: 4 } },
    tokens["manager"],
  );
  expect(unit.status(), await unit.text()).toBe(200);
  unitId = ((await unit.json()) as { id: string }).id;

  const updated = await rpc(
    request,
    "unit_update",
    { _id: unitId, _changes: { description: "נוף להרים" }, _expected_revision: 1 },
    tokens["manager"],
  );
  expect(((await updated.json()) as { revision: number }).revision).toBe(2);

  const stale = await rpc(
    request,
    "unit_update",
    { _id: unitId, _changes: { capacity: 3 }, _expected_revision: 1 },
    tokens["owner"],
  );
  expect(stale.status()).toBeGreaterThanOrEqual(400);
  expect(await stale.text()).toContain("היחידה עודכנה בינתיים");

  const invalid = await rpc(
    request,
    "unit_create",
    { _property_id: propertyId, _data: { name: "x", unit_type: "zimmer", capacity: 0 } },
    tokens["owner"],
  );
  expect(await invalid.text()).toContain("מספר האורחים המרבי חייב להיות מספר שלם בין 1 ל-100");

  const view = await rpc(request, "catalog_view", {}, tokens["manager"]);
  const json = (await view.json()) as {
    can_owner: boolean;
    properties: { name: string; units: { name: string; capacity: number }[] }[];
  };
  expect(json.can_owner).toBe(false);
  expect(json.properties.map((p) => p.name)).toEqual(["מתחם הגליל"]);
  expect(json.properties[0]!.units).toMatchObject([{ name: "צימר האלון", capacity: 4 }]);
});

test("owner-only actions: the manager is refused, the owner may", async ({ request }) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const del = await rpc(request, "unit_delete", { _id: unitId }, tokens["manager"]);
  expect(await del.text()).toContain("רק בעל העסק יכול למחוק יחידה");
  const archive = await rpc(request, "property_archive", { _id: propertyId }, tokens["manager"]);
  expect(await archive.text()).toContain("רק בעל העסק יכול להעביר מתחם לארכיון");
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE id = '${unitId}'`)).toBe("1");

  const extra = await rpc(
    request,
    "unit_create",
    { _property_id: propertyId, _data: { name: "למחיקה", unit_type: "room", kind: "room" } },
    tokens["owner"],
  );
  const extraId = ((await extra.json()) as { id: string }).id;
  expect((await rpc(request, "unit_delete", { _id: extraId }, tokens["owner"])).status()).toBe(200);
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE id = '${extraId}'`)).toBe("0");
});

test("no direct writes through PostgREST for anyone; reads stay per site", async ({ request }) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  for (const who of ["owner", "manager"]) {
    const token = tokens[who]!;
    const post = await rest(request, "units", {
      token,
      site: siteId,
      method: "POST",
      data: { tenant_id: siteId, property_id: propertyId, name: "ישירות", slug: "direct" },
    });
    expect(post.status(), `${who} POST`).toBeGreaterThanOrEqual(400);
    const patch = await rest(request, `units?id=eq.${unitId}`, {
      token,
      site: siteId,
      method: "PATCH",
      data: { capacity: 50 },
    });
    expect(patch.status(), `${who} PATCH`).toBeGreaterThanOrEqual(400);
    const remove = await rest(request, `properties?id=eq.${propertyId}`, {
      token,
      site: siteId,
      method: "DELETE",
    });
    expect(remove.status(), `${who} DELETE`).toBeGreaterThanOrEqual(400);
    const members = await rest(request, "unit_members", {
      token,
      site: siteId,
      method: "POST",
      data: { tenant_id: siteId, parent_unit_id: unitId, member_unit_id: unitId },
    });
    expect(members.status(), `${who} POST members`).toBeGreaterThanOrEqual(400);
  }
  expect(sql(`SELECT capacity FROM hospitality.units WHERE id = '${unitId}'`)).toBe("4");
  // reads: own site yes; the other site's owner, also with this site's header, nothing
  const own = await rest(request, "units?select=name", { token: tokens["owner"]!, site: siteId });
  expect(await own.json()).toEqual([{ name: "צימר האלון" }]);
  const other = await rest(request, "units?select=name", { token: tokens["other"]!, site: siteId });
  expect(other.ok() ? await other.json() : []).toEqual([]);
});

test("outsiders: another site's owner, a guest, a store owner and anonymous are refused", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  // another site's owner on its own site does not find this site's property
  const foreign = await rpc(
    request,
    "unit_create",
    { _property_id: propertyId, _data: { name: "x", unit_type: "zimmer" } },
    tokens["other"],
    otherId,
  );
  expect(await foreign.text()).toContain("המתחם לא נמצא");
  for (const who of ["other", "guest", "storeOwner"]) {
    const res = await rpc(request, "catalog_view", {}, tokens[who]);
    expect(res.status(), who).toBeGreaterThanOrEqual(400);
    expect(await res.text(), who).toContain("אין הרשאה");
  }
  const anon = await rpc(request, "catalog_view", {});
  expect(anon.status()).toBeGreaterThanOrEqual(400);
  // a store as the site: no catalog
  const onStore = await rpc(request, "catalog_view", {}, tokens["storeOwner"], STORE_A.id);
  expect(onStore.status()).toBeGreaterThanOrEqual(400);
  expect(storeDataHash()).toBe(storeHash);
});
