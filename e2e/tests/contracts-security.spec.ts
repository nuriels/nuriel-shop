import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { fromJSON } from "seroval";
import { hostOf, PORT, supabaseEnv } from "./helpers";
import { accessToken, asPlatform, callServerFn, ensureUser, sql } from "./hospitality-helpers";

// אבטחת המסמכים לחתימה — בדיקות תקיפה ישירות (בלי הממשק), מול השרת הבנוי וה-Supabase המקומי:
//   1. הקישור: ניחוש, צורה לא תקינה, קישור ישן אחרי הנפקה חדשה, פג תוקף, עסק אחר, שימוש חוזר אחרי חתימה,
//      הקישור לא נשמר במסד (רק הטביעה), הגבלת ניסיונות;
//   2. Storage: הדלי הפרטי — בלי גישה ישירה (אנונימי / משתמש מחובר / ציבורי / רשימה / קישור חתום);
//      טבלאות החוזים — בלי גישה ישירה מה-API; קישור לקובץ — רק לעסק שלו ולמי שיש לו הרשאת חוזים, ל-60 שניות;
//   3. אחרי חתימה: הפרטים, החתימה וה-PDF לא משתנים ולא נמחקים, והיומן לא נערך — גם ישירות במסד;
//   5. "תנאים ופרטי החוזה" נאכפים בשרת: בלי אישור — אין חוזה; שינוי בתנאים מבטל את האישור.
// CLOSING_SECRETS=<file>: רושם את הערכים הרגישים שנוצרו (קישורים, ת"ז…) — לסריקת היומנים אחרי הריצה.

test.describe.configure({ mode: "serial" });

const OWNER_A = { email: "cs.owner.a@e2e.test", password: "Cs-Owner-A-Pass-1!" };
const OWNER_B = { email: "cs.owner.b@e2e.test", password: "Cs-Owner-B-Pass-1!" };
const MANAGER_A = { email: "cs.manager.a@e2e.test", password: "Cs-Manager-A-Pass-1!" };
const CUSTOMER = "cs.customer@e2e.test";
const ID_NUMBER = "039337423";
const ADDRESS = "רחוב הסוד 7, צפת";
const SLUG_A = "cs-a";
const SLUG_B = "cs-b";
const FN = "src/engines/hospitality/api/contracts.functions.ts";
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
  "hospitality_contracts_enabled",
] as const;
const PATHS = ["M60,150 L120,60 L180,150 L240,70 L300,140", "M320,120 L420,90 L520,130"];
const secrets: string[] = [ID_NUMBER, ADDRESS, ...PATHS];
let siteA = "";
let siteB = "";
let ownerA = "";
let ownerB = "";
let tokenA = "";
let tokenB = "";
let contractId = "";

const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
const as = (uid: string, site: string, query: string) =>
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, false),
              set_config('request.jwt.claim.sub', '${uid}', false),
              set_config('request.headers', json_build_object('x-tenant-id', '${site}')::text, false);
       ${query}`)
    .split("\n")
    .pop()!;

/** a server function's answer: a refusal comes back as HTTP 200 with a serialized Error (not a status) */
async function outcome<T>(
  res: APIResponse,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const text = await res.text();
  if (res.status() !== 200) return { ok: false, error: `${res.status()} ${text.slice(0, 300)}` };
  if (text.includes('"$TSR/Error"')) {
    const m = /"message":\{"t":1,"s":("(?:[^"\\]|\\.)*")\}/.exec(text);
    return { ok: false, error: m ? (JSON.parse(m[1]!) as string) : text.slice(0, 300) };
  }
  const d = fromJSON({ t: JSON.parse(text), f: 127, m: [] } as unknown as Parameters<
    typeof fromJSON
  >[0]) as { result: T };
  return { ok: true, result: d.result };
}
async function value<T>(res: APIResponse): Promise<T> {
  const o = await outcome<T>(res);
  if (!o.ok) throw new Error(`expected success, got: ${o.error}`);
  return o.result;
}
/** an answer that must be a refusal — its message */
async function refused(res: APIResponse): Promise<string> {
  const o = await outcome<unknown>(res);
  expect(o.ok, "expected a refusal").toBe(false);
  return o.ok ? "" : o.error;
}
const call = (
  request: APIRequestContext,
  host: string,
  name: string,
  data: unknown,
  token?: string,
) => callServerFn(request, { host, file: FN, name, data, token });

const hostingInput = { check_in: day(30), check_out: day(32), whole: true, price: 2000 };

function cleanup() {
  for (const slug of [SLUG_A, SLUG_B]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (!id) continue;
    sql(`SET session_replication_role = replica;
         DELETE FROM hospitality.client_contract_log WHERE tenant_id = '${id}';
         DELETE FROM hospitality.client_contracts WHERE tenant_id = '${id}';
         DELETE FROM storage.objects WHERE bucket_id = 'hosp-contracts' AND name LIKE '${id}/%'`);
    asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "direct calls — once");
  cleanup();
  // the shared rate counters of the local test database (the guessing test fills them)
  sql(`DELETE FROM hospitality.rate_buckets`);
  ownerA = await ensureUser(request, OWNER_A);
  ownerB = await ensureUser(request, OWNER_B);
  await ensureUser(request, MANAGER_A);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`);
  for (const [slug, name, owner, user] of [
    [SLUG_A, "עסק א", OWNER_A.email, "cs_owner_a"],
    [SLUG_B, "עסק ב", OWNER_B.email, "cs_owner_b"],
  ] as const) {
    asPlatform(`SELECT hospitality.admin_create_site('${slug}', '${name}')`);
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
         SELECT '${id}', id, email, '${user}', 'admin', true, true FROM auth.users WHERE email = '${owner}'`);
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ${FLAGS.map((f) => `('${id}', '${f}', true)`).join(", ")}
         ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
    sql(`UPDATE hospitality.settings SET business_name = '${name}', contact_email = 'cs.${slug}@e2e.test',
           contact_phone = '0501234567', address = 'רחוב העסק 1'
          WHERE tenant_id = '${id}'`);
  }
  siteA = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG_A}'`);
  siteB = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG_B}'`);
  // a manager on A without the contracts permission
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${siteA}', id, email, 'cs_manager_a', 'admin', true, false FROM auth.users WHERE email = '${MANAGER_A.email}'`);
  // A: terms saved and confirmed. B: saved, NOT confirmed
  for (const [uid, site, confirm] of [
    [ownerA, siteA, true],
    [ownerB, siteB, false],
  ] as const) {
    as(
      uid,
      site,
      `SELECT hospitality.business_terms_save('${JSON.stringify({
        representative_name: "נציג",
        business_tax_id: "58731621",
        unit_lines: [{ name: "אלון", description: "לזוג" }],
      })}'::jsonb, 0)`,
    );
    if (confirm) as(uid, site, `SELECT hospitality.business_terms_confirm(1)`);
  }
});

test.afterAll(() => {
  const file = process.env["CLOSING_SECRETS"];
  if (file) writeFileSync(file, JSON.stringify(secrets));
  cleanup();
});

test("5. the terms gate is enforced on the server: no confirmed terms — no contract; changing the terms cancels the confirmation", async ({
  request,
}) => {
  const jwtB = await accessToken(request, OWNER_B);
  const target = { kind: "hosting", fillMode: "customer", input: hostingInput, deliver: "link" };
  // preview is allowed (and says it cannot be sent) — creating is refused, bypassing the screen
  const p = await value<{ can_send: boolean; terms_confirmed: boolean }>(
    await call(request, hostOf(SLUG_B), "hospitalityContractStandalonePreview", target, jwtB),
  );
  expect([p.can_send, p.terms_confirmed]).toEqual([false, false]);
  expect(
    await refused(
      await call(request, hostOf(SLUG_B), "hospitalityContractStandaloneCreate", target, jwtB),
    ),
  ).toContain("תנאים");
  expect(
    sql(`SELECT count(*) FROM hospitality.client_contracts WHERE tenant_id = '${siteB}'`),
  ).toBe("0");
  // A confirmed; a change in the terms resets the confirmation — and creating is refused again
  const jwtA = await accessToken(request, OWNER_A);
  const rev = sql(`SELECT revision FROM hospitality.business_terms WHERE tenant_id = '${siteA}'`);
  as(
    ownerA,
    siteA,
    `SELECT hospitality.business_terms_save('{"representative_name": "נציג אחר"}'::jsonb, ${rev})`,
  );
  expect(
    sql(`SELECT confirmed_at IS NULL FROM hospitality.business_terms WHERE tenant_id = '${siteA}'`),
  ).toBe("t");
  await refused(
    await call(request, hostOf(SLUG_A), "hospitalityContractStandaloneCreate", target, jwtA),
  );
  as(ownerA, siteA, `SELECT hospitality.business_terms_confirm(${Number(rev) + 1})`);
  expect(
    sql(
      `SELECT confirmed_at IS NOT NULL FROM hospitality.business_terms WHERE tenant_id = '${siteA}'`,
    ),
  ).toBe("t");
});

test("1. the signing link: guessed, malformed, replaced, expired, another site, reused — all refused; only the hash is stored; attempts are limited", async ({
  request,
}) => {
  const jwtA = await accessToken(request, OWNER_A);
  const created = await value<{ contract: { id: string }; link: { url: string } }>(
    await call(
      request,
      hostOf(SLUG_A),
      "hospitalityContractStandaloneCreate",
      { kind: "hosting", fillMode: "customer", input: hostingInput, deliver: "link" },
      jwtA,
    ),
  );
  contractId = created.contract.id;
  tokenA = /#t=([A-Za-z0-9_-]{43})$/.exec(created.link.url)![1]!;
  secrets.push(tokenA);
  // 256 random bits; only the SHA-256 is in the database — not the link itself, anywhere
  expect(Buffer.from(tokenA, "base64url").length).toBe(32);
  expect(
    sql(`SELECT token_hash = encode(sha256(convert_to('${tokenA}', 'UTF8')), 'hex')
           FROM hospitality.client_contracts WHERE id = '${contractId}'`),
  ).toBe("t");
  expect(
    sql(`SELECT (SELECT count(*) FROM hospitality.client_contracts c WHERE c::text LIKE '%${tokenA}%')
              + (SELECT count(*) FROM hospitality.client_contract_log l WHERE l::text LIKE '%${tokenA}%')`),
  ).toBe("0");
  const open = (host: string, token: unknown) =>
    call(request, host, "hospitalityContractOpen", { token });
  // the right link works
  await value(await open(hostOf(SLUG_A), tokenA));
  // guessed (right shape, random) and malformed
  expect(
    await refused(await open(hostOf(SLUG_A), randomBytes(32).toString("base64url"))),
  ).toContain("לא תקין");
  for (const bad of ["abc", `${tokenA}x`, tokenA.slice(1), "../../etc", null])
    await refused(await open(hostOf(SLUG_A), bad));
  // another business's site — the same link does not open there
  expect(await refused(await open(hostOf(SLUG_B), tokenA))).toContain("לא תקין");
  // a new link — the old one dies
  const again = await value<{ link: { url: string } }>(
    await call(request, hostOf(SLUG_A), "hospitalityContractShareLink", { id: contractId }, jwtA),
  );
  tokenB = /#t=([A-Za-z0-9_-]{43})$/.exec(again.link.url)![1]!;
  secrets.push(tokenB);
  expect(tokenB).not.toBe(tokenA);
  await refused(await open(hostOf(SLUG_A), tokenA));
  await value(await open(hostOf(SLUG_A), tokenB));
  // expired (14 days) — refused; back in time — works again
  sql(
    `UPDATE hospitality.client_contracts SET token_expires_at = now() - interval '1 minute' WHERE id = '${contractId}'`,
  );
  expect(await refused(await open(hostOf(SLUG_A), tokenB))).toContain("פג תוקף");
  sql(
    `UPDATE hospitality.client_contracts SET token_expires_at = now() + interval '1 day' WHERE id = '${contractId}'`,
  );
  // sign once (directly, like the page does)
  const sign = () =>
    call(request, hostOf(SLUG_A), "hospitalityContractSign", {
      token: tokenB,
      fields: {
        full_name: "לקוחה בדיקה",
        email: CUSTOMER,
        phone: "0541112233",
        id_number: ID_NUMBER,
        address: ADDRESS,
        deposit_method: "cash",
      },
      signature: { kind: "drawn", paths: PATHS },
      agreed: true,
    });
  // a drawing outside the 600×200 box (straight to the server, not through the pad) — refused, the link
  // still unused
  expect(
    await refused(
      await call(request, hostOf(SLUG_A), "hospitalityContractSign", {
        token: tokenB,
        fields: {
          full_name: "לקוחה בדיקה",
          email: CUSTOMER,
          id_number: ID_NUMBER,
          address: ADDRESS,
          deposit_method: "cash",
        },
        signature: { kind: "drawn", paths: ["M999,999 L10,10 L900,950"] },
        agreed: true,
      }),
    ),
  ).toContain("החתימה לא תקינה");
  await value(await sign());
  expect(
    sql(
      `SELECT status || '|' || (token_hash IS NULL) || '|' || (pdf_path IS NOT NULL) FROM hospitality.client_contracts WHERE id = '${contractId}'`,
    ),
  ).toBe("signed|true|true");
  // reuse after signing — refused (open and sign)
  expect(await refused(await sign())).toContain("שומש");
  await refused(await open(hostOf(SLUG_A), tokenB));
  // guessing is limited: 60 opens per 10 minutes from one address
  let limited = false;
  for (let i = 0; i < 70 && !limited; i++) {
    const t = await (await open(hostOf(SLUG_A), randomBytes(32).toString("base64url"))).text();
    limited = /נסו שוב|יותר מדי|בעוד/.test(t) && !/לא תקין/.test(t);
  }
  expect(limited, "the open attempts are rate-limited").toBe(true);
  sql(`DELETE FROM hospitality.rate_buckets`);
});

test("2. the private bucket and the tables: no direct access; the file link only for the business's own staff with the permission, for 60 seconds", async ({
  request,
}) => {
  test.setTimeout(150_000); // waits for the 60-second file link to expire
  const { url, anonKey } = supabaseEnv();
  const path = sql(`SELECT pdf_path FROM hospitality.client_contracts WHERE id = '${contractId}'`);
  expect(path).toMatch(new RegExp(`^${siteA}/${contractId}\\.pdf$`));
  const jwtA = await accessToken(request, OWNER_A);
  const jwtB = await accessToken(request, OWNER_B);
  const jwtM = await accessToken(request, MANAGER_A);
  // the storage API directly — anonymous, the owner's own session, public, list, sign
  for (const [what, res] of [
    [
      "anon object",
      await request.get(`${url}/storage/v1/object/hosp-contracts/${path}`, {
        headers: { apikey: anonKey },
      }),
    ],
    [
      "owner object",
      await request.get(`${url}/storage/v1/object/authenticated/hosp-contracts/${path}`, {
        headers: { apikey: anonKey, authorization: `Bearer ${jwtA}` },
      }),
    ],
    ["public url", await request.get(`${url}/storage/v1/object/public/hosp-contracts/${path}`)],
    [
      "owner sign",
      await request.post(`${url}/storage/v1/object/sign/hosp-contracts/${path}`, {
        headers: { apikey: anonKey, authorization: `Bearer ${jwtA}` },
        data: { expiresIn: 3600 },
      }),
    ],
  ] as const)
    expect(res.status(), what).not.toBe(200);
  const list = await request.post(`${url}/storage/v1/object/list/hosp-contracts`, {
    headers: { apikey: anonKey, authorization: `Bearer ${jwtA}` },
    data: { prefix: siteA, limit: 100 },
  });
  expect(list.status() === 200 ? await list.json() : []).toEqual([]);
  // the contract tables through the data API — nothing, even for the owner
  for (const table of ["client_contracts", "client_contract_log", "business_terms"]) {
    const res = await request.get(`${url}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${jwtA}`,
        "accept-profile": "hospitality",
      },
    });
    expect(res.status() === 200 ? await res.json() : [], table).toEqual([]);
  }
  // the server: another business and a manager without the permission — refused
  await refused(
    await call(
      request,
      hostOf(SLUG_B),
      "hospitalityContractFile",
      { id: contractId, purpose: "view" },
      jwtB,
    ),
  );
  await refused(
    await call(
      request,
      hostOf(SLUG_A),
      "hospitalityContractFile",
      { id: contractId, purpose: "view" },
      jwtB,
    ),
  );
  await refused(
    await call(
      request,
      hostOf(SLUG_A),
      "hospitalityContractFile",
      { id: contractId, purpose: "view" },
      jwtM,
    ),
  );
  await refused(
    await call(request, hostOf(SLUG_A), "hospitalityContractFile", {
      id: contractId,
      purpose: "view",
    }),
  );
  const listB = await value<{ rows: unknown[]; total: number }>(
    await call(
      request,
      hostOf(SLUG_B),
      "hospitalitySignedDocuments",
      { q: null, limit: 50, offset: 0 },
      jwtB,
    ),
  );
  expect([listB.rows, listB.total]).toEqual([[], 0]);
  // the owner — a short link to the real file, which stops working after 60 seconds
  const { url: fileUrl } = await value<{ url: string }>(
    await call(
      request,
      hostOf(SLUG_A),
      "hospitalityContractFile",
      { id: contractId, purpose: "download" },
      jwtA,
    ),
  );
  const pdf = await request.get(fileUrl);
  expect(pdf.status()).toBe(200);
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    sql(`SELECT pdf_sha256 FROM hospitality.client_contracts WHERE id = '${contractId}'`),
  );
  await new Promise((r) => setTimeout(r, 62_000));
  expect((await request.get(fileUrl)).status(), "the link expired").not.toBe(200);
});

test("3. after signing: details, signature and PDF cannot change or be deleted, the log cannot be edited — even directly in the database; the stored file is not overwritten", async ({
  request,
}) => {
  const id = contractId;
  const tryIt = (q: string) => {
    try {
      sql(q);
      return "changed";
    } catch (e) {
      return String(e).includes("לא משתנה") ||
        String(e).includes("לא נמחק") ||
        String(e).includes("append")
        ? "blocked"
        : `error: ${String(e).slice(0, 160)}`;
    }
  };
  const before = sql(`SELECT md5(c::text) FROM hospitality.client_contracts c WHERE id = '${id}'`);
  for (const q of [
    `UPDATE hospitality.client_contracts SET signed_body = signed_body || ' זיוף' WHERE id = '${id}'`,
    `UPDATE hospitality.client_contracts SET signature = '{"kind":"typed","name":"אחר"}' WHERE id = '${id}'`,
    `UPDATE hospitality.client_contracts SET customer_fields = '{}' WHERE id = '${id}'`,
    `UPDATE hospitality.client_contracts SET signer_email = 'other@e2e.test' WHERE id = '${id}'`,
    `UPDATE hospitality.client_contracts SET data = '{}' WHERE id = '${id}'`,
    `UPDATE hospitality.client_contracts SET pdf_sha256 = repeat('0', 64) WHERE id = '${id}'`,
    `UPDATE hospitality.client_contracts SET pdf_path = '${siteA}/${siteA}.pdf' WHERE id = '${id}'`,
    `UPDATE hospitality.client_contracts SET status = 'draft' WHERE id = '${id}'`,
    `UPDATE hospitality.client_contracts SET signed_at = now() WHERE id = '${id}'`,
    `DELETE FROM hospitality.client_contracts WHERE id = '${id}'`,
  ])
    expect(tryIt(q), q).toBe("blocked");
  expect(sql(`SELECT md5(c::text) FROM hospitality.client_contracts c WHERE id = '${id}'`)).toBe(
    before,
  );
  const log = sql(
    `SELECT count(*) FROM hospitality.client_contract_log WHERE contract_id = '${id}'`,
  );
  expect(Number(log)).toBeGreaterThan(2);
  for (const q of [
    `UPDATE hospitality.client_contract_log SET details = '{}' WHERE contract_id = '${id}'`,
    `DELETE FROM hospitality.client_contract_log WHERE contract_id = '${id}'`,
  ])
    expect(tryIt(q), q).not.toBe("changed");
  expect(
    sql(`SELECT count(*) FROM hospitality.client_contract_log WHERE contract_id = '${id}'`),
  ).toBe(log);
  // the log has the signing (method, body hash, address), and no ID number / address / drawing
  const logText = sql(
    `SELECT string_agg(action || ' ' || details::text, E'\\n') FROM hospitality.client_contract_log WHERE contract_id = '${id}'`,
  );
  expect(logText).toContain("signed");
  for (const s of [ID_NUMBER, "הסוד", "L120,60"]) expect(logText).not.toContain(s);
  // the file: an upload over it does not replace it (no overwrite), the hash in the database still matches
  const { url, serviceKey } = {
    ...supabaseEnv(),
    serviceKey: process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  };
  const path = sql(`SELECT pdf_path FROM hospitality.client_contracts WHERE id = '${id}'`);
  const over = await request.post(`${url}/storage/v1/object/hosp-contracts/${path}`, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/pdf",
      "x-upsert": "false",
    },
    data: Buffer.from("%PDF-1.4 forged"),
  });
  expect(over.status()).not.toBe(200);
  const now = await request.get(`${url}/storage/v1/object/hosp-contracts/${path}`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  expect(
    createHash("sha256")
      .update(await now.body())
      .digest("hex"),
  ).toBe(sql(`SELECT pdf_sha256 FROM hospitality.client_contracts WHERE id = '${id}'`));
});
