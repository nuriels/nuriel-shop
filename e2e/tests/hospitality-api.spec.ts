import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { STORE_A, supabaseEnv, USERS } from "./helpers";

// Hospitality Stages 1c–1d through the real local Supabase API (PostgREST + Storage +
// GoTrue tokens): the exposed `hospitality` schema, RLS per site, feature flags,
// product roles, the hosp-media bucket and the booking engine (guest request without an
// account, parallel requests, manage link, owner approval, cancellation request).
// API only — there is no Hospitality UI yet. Disposable data, removed before and after.

test.describe.configure({ mode: "serial" });

const PASSWORD = "Hosp1c-e2e-only!";
const EMAILS = {
  ownerA: "h1c.owner.a@e2e.test",
  ownerB: "h1c.owner.b@e2e.test",
  guest: "h1c.guest@e2e.test",
} as const;
const SLUGS = ["h1c-site-a", "h1c-site-b"];

function sql(query: string): string {
  const url = process.env["DB_URL"];
  if (!url) throw new Error("e2e/.env.e2e is not loaded (DB_URL)");
  return execFileSync("psql", [url, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  }).trim();
}

/** run SQL as the seeded platform admin (auth.uid() inside the functions) */
function asPlatform(query: string): string {
  return sql(`SELECT set_config('request.jwt.claims', json_build_object('sub',
      (SELECT id FROM auth.users WHERE email = '${USERS.platform.email}'), 'role', 'authenticated')::text, false);
    ${query}`);
}

function cleanup() {
  // the platform's own delete function also removes Hospitality data (cascade)
  for (const slug of SLUGS) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (!id) continue;
    sql(`SET storage.allow_delete_query = 'true';
         DELETE FROM storage.objects WHERE bucket_id = 'hosp-media' AND name LIKE '${id}/%'`);
    asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
  sql(`DELETE FROM auth.users WHERE email IN ('${Object.values(EMAILS).join("','")}')`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = false
      WHERE key IN ('hospitality_backend_enabled', 'hospitality_booking_enabled')`,
  );
}

type Rest = { status: number; json: unknown };
async function rest(
  path: string,
  opts: {
    token?: string;
    site?: string;
    profile?: string | null;
    method?: string;
    body?: unknown;
  } = {},
): Promise<Rest> {
  const { url, anonKey } = supabaseEnv();
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    apikey: anonKey,
    Authorization: `Bearer ${opts.token ?? anonKey}`,
  };
  if (opts.site) headers["x-tenant-id"] = opts.site;
  const profile = opts.profile === undefined ? "hospitality" : opts.profile;
  if (profile) headers[method === "GET" ? "Accept-Profile" : "Content-Profile"] = profile;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, json };
}

async function upload(token: string, site: string, path: string, type = "image/png") {
  const { url, anonKey } = supabaseEnv();
  const res = await fetch(`${url}/storage/v1/object/hosp-media/${path}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "x-tenant-id": site,
      "Content-Type": type,
    },
    body: Buffer.from("89504e470d0a1a0a", "hex"),
  });
  return res.status;
}

/** a real user (admin API) and a real access token (GoTrue password sign-in) */
async function userToken(email: string): Promise<{ id: string; token: string }> {
  const { url } = supabaseEnv();
  const service = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  expect(created.status, await created.clone().text()).toBe(200);
  const { id } = (await created.json()) as { id: string };
  return { id, token: await signIn(email, PASSWORD) };
}

async function signIn(email: string, password: string): Promise<string> {
  const { url, anonKey } = supabaseEnv();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

let siteA = "";
let siteB = "";
const tokens: Record<keyof typeof EMAILS, string> = { ownerA: "", ownerB: "", guest: "" };

test.beforeAll(async () => {
  cleanup();
  for (const [slug, name] of [
    [SLUGS[0], "אירוח A"],
    [SLUGS[1], "אירוח B"],
  ]) {
    asPlatform(`SELECT hospitality.admin_create_site('${slug}', '${name}')`);
  }
  siteA = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUGS[0]}'`);
  siteB = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUGS[1]}'`);
  const ownerA = await userToken(EMAILS.ownerA);
  const ownerB = await userToken(EMAILS.ownerB);
  const guest = await userToken(EMAILS.guest);
  tokens.ownerA = ownerA.token;
  tokens.ownerB = ownerB.token;
  tokens.guest = guest.token;
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
         ('${siteA}', '${ownerA.id}', '${EMAILS.ownerA}', 'h1c_owner_a', 'admin', true),
         ('${siteB}', '${ownerB.id}', '${EMAILS.ownerB}', 'h1c_owner_b', 'admin', true);
       INSERT INTO hospitality.properties (tenant_id, name, slug) VALUES
         ('${siteA}', 'מתחם A', 'mitham'), ('${siteB}', 'מתחם B', 'mitham');
       INSERT INTO hospitality.units (tenant_id, property_id, name, slug)
         SELECT tenant_id, id, 'צימר ' || right(name, 1), 'zimmer' FROM hospitality.properties
          WHERE tenant_id IN ('${siteA}', '${siteB}')`);
});

test.afterAll(() => cleanup());

test("the store API is unaffected and the Hospitality schema is exposed but closed to anon", async () => {
  const store = await rest("tenants?select=slug", { profile: null, site: STORE_A.id });
  expect(store.status).toBe(200);
  const anon = await rest("units?select=id", { site: siteA });
  expect(anon.status).toBe(401);
  expect((anon.json as { code: string }).code).toBe("42501");
  const resolved = await rest("rpc/request_tenant", { method: "POST", site: siteA, body: {} });
  expect(resolved.json).toBe(siteA);
});

test("with the backend flag off, even the owner sees no Hospitality rows", async () => {
  const units = await rest("units?select=name", { token: tokens.ownerA, site: siteA });
  expect(units).toEqual({ status: 200, json: [] });
  const can = await rest("rpc/can", {
    token: tokens.ownerA,
    site: siteA,
    method: "POST",
    body: { _permission: "catalog" },
  });
  expect(can.json).toBe(true);
});

test("flag on: each owner sees and writes only its own site", async () => {
  sql(`UPDATE public.platform_feature_flags SET enabled = true WHERE key = 'hospitality_backend_enabled';
       INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ('${siteA}', 'hospitality_backend_enabled', true), ('${siteB}', 'hospitality_backend_enabled', true)`);
  expect(await rest("units?select=name", { token: tokens.ownerA, site: siteA })).toEqual({
    status: 200,
    json: [{ name: "צימר A" }],
  });
  expect(await rest("units?select=name", { token: tokens.ownerB, site: siteB })).toEqual({
    status: 200,
    json: [{ name: "צימר B" }],
  });
  expect(await rest("units?select=name", { token: tokens.ownerA, site: siteB })).toEqual({
    status: 200,
    json: [],
  });
  const foreign = await rest("amenities", {
    token: tokens.ownerA,
    site: siteA,
    method: "POST",
    body: { tenant_id: siteB, name: "חדירה" },
  });
  expect(foreign.status).toBe(403);
  const own = await rest("amenities", {
    token: tokens.ownerA,
    site: siteA,
    method: "POST",
    body: { tenant_id: siteA, name: "בריכה" },
  });
  expect(own.status).toBe(201);
});

test("guests and store members get nothing; a guest cannot become a customer of the site", async () => {
  expect(await rest("units?select=name", { token: tokens.guest, site: siteA })).toEqual({
    status: 200,
    json: [],
  });
  const selfSignup = await rest("user_roles", {
    token: tokens.guest,
    site: siteA,
    profile: "public",
    method: "POST",
    body: {
      user_id: sql(`SELECT id FROM auth.users WHERE email = '${EMAILS.guest}'`),
      email: EMAILS.guest,
      username: "h1c_guest",
      role: "customer",
      is_approved: false,
      is_blocked: false,
    },
  });
  expect(selfSignup.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(selfSignup.json)).toContain("hospitality");
  // the seeded store owner (Ecommerce): nothing on the Hospitality site, no Hospitality permission on its store
  const storeOwner = await signIn(USERS.ownerA.email, USERS.ownerA.password);
  expect(await rest("units?select=name", { token: storeOwner, site: siteA })).toEqual({
    status: 200,
    json: [],
  });
  const can = await rest("rpc/can", {
    token: storeOwner,
    site: STORE_A.id,
    method: "POST",
    body: { _permission: "catalog" },
  });
  expect(can.json).toBe(false);
  // a Hospitality owner on the store host sees no store data
  const orders = await rest("orders?select=id", {
    token: tokens.ownerA,
    site: STORE_A.id,
    profile: "public",
  });
  expect(orders).toEqual({ status: 200, json: [] });
});

test("hosp-media: the owner uploads into its own site folder only; public read works", async () => {
  expect(await upload(tokens.ownerA, siteA, `${siteA}/units/a.png`)).toBe(200);
  expect(await upload(tokens.ownerA, siteA, `${siteB}/units/x.png`)).toBeGreaterThanOrEqual(400);
  expect(await upload(tokens.guest, siteA, `${siteA}/g.png`)).toBeGreaterThanOrEqual(400);
  expect(
    await upload(tokens.ownerA, siteA, `${siteA}/doc.pdf`, "application/pdf"),
  ).toBeGreaterThanOrEqual(400);
  const { url } = supabaseEnv();
  expect(
    (await fetch(`${url}/storage/v1/object/public/hosp-media/${siteA}/units/a.png`)).status,
  ).toBe(200);
  const removed = await fetch(`${url}/storage/v1/object/hosp-media/${siteA}/units/a.png`, {
    method: "DELETE",
    headers: {
      apikey: supabaseEnv().anonKey,
      Authorization: `Bearer ${tokens.ownerA}`,
      "x-tenant-id": siteA,
    },
  });
  expect(removed.status).toBe(200);
});

/** a date N days from today, YYYY-MM-DD */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const message = (r: Rest) => JSON.stringify(r.json);
let bookingId = "";
let manageToken = "";

test("a guest books without an account; of 5 parallel requests for the same dates exactly one wins", async () => {
  sql(`UPDATE public.platform_feature_flags SET enabled = true WHERE key = 'hospitality_booking_enabled';
       INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
       VALUES ('${siteA}', 'hospitality_booking_enabled', true);
       UPDATE hospitality.properties SET status = 'active' WHERE tenant_id = '${siteA}'`);
  const unit = sql(`SELECT id FROM hospitality.units WHERE tenant_id = '${siteA}'`);
  const stay = { _unit_id: unit, _check_in: day(40), _check_out: day(42) };
  const quote = await rest("rpc/quote", { method: "POST", site: siteA, body: stay });
  expect(quote.status, message(quote)).toBe(200);
  const q = quote.json as { available: boolean; policy_hash: string; total: number };
  expect(q.available).toBe(true);

  const attempts = await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      rest("rpc/request_booking", {
        method: "POST",
        site: siteA,
        body: {
          ...stay,
          _full_name: `אורח ${n}`,
          _email: `h1d.guest${n}@e2e.test`,
          _phone: `05011100${n}0`,
          _idempotency_key: `h1d-parallel-${n}-${Date.now()}`,
          _policy_accepted: true,
          _policy_hash: q.policy_hash,
        },
      }),
    ),
  );
  const won = attempts.filter((r) => r.status === 200);
  const lost = attempts.filter((r) => r.status !== 200);
  expect(won).toHaveLength(1);
  expect(lost).toHaveLength(4);
  for (const r of lost) expect(message(r)).toContain("כבר לא פנויים");
  const winner = won[0]!.json as { booking_id: string; status: string; manage_token: string };
  expect(winner.status).toBe("pending_approval");
  bookingId = winner.booking_id;
  manageToken = winner.manage_token;
  expect(sql(`SELECT count(*) FROM hospitality.unit_occupancy WHERE unit_id = '${unit}'`)).toBe(
    "1",
  );
  expect(
    sql(`SELECT count(*) FROM hospitality.notifications WHERE booking_id = '${bookingId}'`),
  ).toBe("2");

  // the manage link works on this site only, and shows no internal data
  const view = await rest("rpc/get_booking_by_token", {
    method: "POST",
    site: siteA,
    body: { _token: manageToken },
  });
  expect(view.status).toBe(200);
  expect((view.json as { id: string }).id).toBe(bookingId);
  expect(view.json).not.toHaveProperty("notes");
  const elsewhere = await rest("rpc/get_booking_by_token", {
    method: "POST",
    site: siteB,
    body: { _token: manageToken },
  });
  expect(elsewhere.status).toBeGreaterThanOrEqual(400);
  expect(message(elsewhere)).toContain("ההזמנה לא נמצאה");
  // no account and no membership was created for the guest
  expect(sql(`SELECT count(*) FROM public.user_roles WHERE email LIKE 'h1d.guest%'`)).toBe("0");
});

test("only the site's owner approves; tables stay closed to guests", async () => {
  for (const [token, site] of [
    [tokens.ownerB, siteA],
    [tokens.guest, siteA],
    [tokens.ownerB, siteB],
  ] as const) {
    const denied = await rest("rpc/approve_booking", {
      method: "POST",
      token,
      site,
      body: { _booking_id: bookingId },
    });
    expect(denied.status, message(denied)).toBeGreaterThanOrEqual(400);
  }
  const approved = await rest("rpc/approve_booking", {
    method: "POST",
    token: tokens.ownerA,
    site: siteA,
    body: { _booking_id: bookingId },
  });
  expect(approved.status, message(approved)).toBe(200);
  expect((approved.json as { status: string }).status).toBe("confirmed");
  const ownerRows = await rest("bookings?select=status", { token: tokens.ownerA, site: siteA });
  expect(ownerRows).toEqual({ status: 200, json: [{ status: "confirmed" }] });
  expect(await rest("bookings?select=id", { token: tokens.guest, site: siteA })).toEqual({
    status: 200,
    json: [],
  });
  expect((await rest("bookings?select=id", { site: siteA })).status).toBe(401);
  const write = await rest(`bookings?id=eq.${bookingId}`, {
    method: "PATCH",
    token: tokens.ownerA,
    site: siteA,
    body: { total: 1 },
  });
  expect(write.status).toBeGreaterThanOrEqual(400);
});

test("the guest asks to cancel with the manage link; the owner approves; the fee is the one quoted", async () => {
  const quote = await rest("rpc/cancellation_quote", {
    method: "POST",
    site: siteA,
    body: { _token: manageToken },
  });
  expect(quote.status, message(quote)).toBe(200);
  const fee = (quote.json as { fee: number }).fee;
  const requested = await rest("rpc/request_cancellation", {
    method: "POST",
    site: siteA,
    body: { _token: manageToken, _reason: "שינוי תוכניות" },
  });
  expect(requested.status, message(requested)).toBe(200);
  expect((requested.json as { status: string }).status).toBe("cancel_requested");
  const approved = await rest("rpc/approve_cancellation", {
    method: "POST",
    token: tokens.ownerA,
    site: siteA,
    body: { _booking_id: bookingId },
  });
  expect(approved.status, message(approved)).toBe(200);
  expect((approved.json as { final_fee: number }).final_fee).toBe(fee);
  expect(sql(`SELECT status FROM hospitality.bookings WHERE id = '${bookingId}'`)).toBe(
    "cancelled",
  );
  expect(
    sql(`SELECT count(*) FROM hospitality.unit_occupancy WHERE booking_id = '${bookingId}'`),
  ).toBe("0");
});

test("plans and statistics: the owner sees their plan; only the platform admin sees statistics, without guest data", async () => {
  const mine = await rest("rpc/my_entitlements", {
    method: "POST",
    token: tokens.ownerA,
    site: siteA,
    body: {},
  });
  expect(mine.status, message(mine)).toBe(200);
  expect(mine.json).toMatchObject({
    plan: "trial",
    status: "trialing",
    active: true,
    units_used: 1,
  });
  const ownerStats = await rest("rpc/admin_site_stats", {
    method: "POST",
    token: tokens.ownerA,
    site: siteA,
    body: {},
  });
  expect(ownerStats.status).toBeGreaterThanOrEqual(400);
  expect(message(ownerStats)).toContain("רק מנהל הפלטפורמה");
  expect((await rest("rpc/admin_overview", { method: "POST", body: {} })).status).toBe(401);

  const platform = await signIn(USERS.platform.email, USERS.platform.password);
  const overview = await rest("rpc/admin_overview", { method: "POST", token: platform, body: {} });
  expect(overview.status, message(overview)).toBe(200);
  expect((overview.json as { sites: number }).sites).toBeGreaterThanOrEqual(2);
  const stats = await rest("rpc/admin_site_stats", { method: "POST", token: platform, body: {} });
  expect(stats.status, message(stats)).toBe(200);
  const rows = stats.json as { tenant_id: string; plan: string; units_active: number }[];
  expect(rows.find((r) => r.tenant_id === siteA)).toMatchObject({ plan: "trial", units_active: 1 });
  expect(message(stats) + message(overview)).not.toContain("h1d.guest");
});
