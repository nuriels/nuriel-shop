// MAX/Hyp DEMO — shared helpers of the payment E2E specs (e2e/tests/payments-*.spec.ts).
// Every Hyp call goes to the mock (e2e/scripts/mock-hyp.mjs on 127.0.0.1:4010); nothing reaches a Hyp host.
// The app's names (server functions, data-testids, the migration-208 tables) are declared HERE once, so a rename in
// D3/D4/D5 is fixed in one place. Sources: scratchpad arch-design.md §2–§5, §12; migration 208 (payments.*).
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { fromJSON } from "seroval";
import { HYP_MOCK_ORIGIN, HYP_PAGE_TESTIDS } from "../fixtures/hyp-fake.mjs";
import { hostOf, PORT, STORE_A, STORE_B, supabaseEnv, USERS } from "./helpers";
import { accessToken, asPlatform, callServerFn, ensureUser, sql } from "./hospitality-helpers";

export { HYP_PAGE_TESTIDS, STORE_A, STORE_B, USERS, sql, accessToken };

export const HYP = HYP_MOCK_ORIGIN;
export const STORE_A_HOST = hostOf(STORE_A.slug);
export const STORE_B_HOST = hostOf(STORE_B.slug);
export const PLATFORM_HOST = "platform.shop.localhost";
export const TENANT_RETURN_PATH = "/payments/return/max";
export const PLATFORM_RETURN_PATH = "/platform/payments/return/max";

// ------------------------------------------------------------------------------------------------------------
// The app's payment server functions (arch-design §3). `file` + export name = the TanStack server-fn id.
// ------------------------------------------------------------------------------------------------------------
const TENANT_FNS = "src/lib/online-payments.functions.ts";
const STAFF_FNS = "src/lib/online-payments-staff.functions.ts";
const OWNER_FNS = "src/lib/online-payments-owner.functions.ts";
const ADMIN_FNS = "src/lib/online-payments-admin.functions.ts";
const PAY_FNS = "src/platform/billing/pay.functions.ts";
const TERMINAL_FNS = "src/platform/billing/pay-terminal.functions.ts";
export const FN = {
  options: { file: TENANT_FNS, name: "getOnlinePaymentOptions" },
  start: { file: TENANT_FNS, name: "startOnlinePayment" },
  status: { file: TENANT_FNS, name: "getOnlinePaymentStatus" },
  orderPayment: { file: STAFF_FNS, name: "getOrderOnlinePayment" },
  cancelAttempt: { file: STAFF_FNS, name: "cancelOrderOnlinePayment" },
  resolveReview: { file: STAFF_FNS, name: "resolveOrderOnlinePayment" },
  ownerSettings: { file: OWNER_FNS, name: "getOnlinePaymentSettings" },
  storePayments: { file: ADMIN_FNS, name: "getStoreOnlinePayments" },
  saveStoreTerminal: { file: ADMIN_FNS, name: "saveStoreTerminal" },
  testStoreTerminal: { file: ADMIN_FNS, name: "testStoreTerminal" },
  payOptions: { file: PAY_FNS, name: "myBillingPayOptions" },
  myPayments: { file: PAY_FNS, name: "myBillingPayments" },
  payStart: { file: PAY_FNS, name: "myBillingPayStart" },
  terminalStatus: { file: TERMINAL_FNS, name: "platformTerminalStatus" },
  terminalRequestCode: { file: TERMINAL_FNS, name: "platformTerminalRequestCode" },
  terminalSave: { file: TERMINAL_FNS, name: "platformTerminalSave" },
  terminalTest: { file: TERMINAL_FNS, name: "platformTerminalTest" },
  cardPayments: { file: TERMINAL_FNS, name: "platformCardPayments" },
  unreturned: { file: TERMINAL_FNS, name: "platformUnreturnedAttempts" },
} as const;
type ServerFn = (typeof FN)[keyof typeof FN];

/** data-testids of the app's payment screens (arch-design §12) */
export const TID = {
  demoBanner: "demo-banner",
  payOnlineOption: "pay-online-option",
  checkoutSubmit: "checkout-submit",
  payPage: "online-pay-page",
  payMessage: "online-pay-message",
  platformTerminal: "platform-terminal",
  myBillingPay: "my-billing-pay",
  myBillingPayButton: "my-billing-pay-button",
  myBillingPayResult: "my-billing-pay-result",
} as const;

// ------------------------------------------------------------------------------------------------------------
// Unique client IPs: the payment rate limits count per X-Real-IP (src/platform/security/client-ip.ts)
// ------------------------------------------------------------------------------------------------------------
const IP_RUN = randomBytes(2);
let ipSeq = 0;
export function nextIp(): string {
  ipSeq += 1;
  return `10.${IP_RUN[0]! % 200}.${(IP_RUN[1]! + (ipSeq >> 8)) % 256}.${(ipSeq % 250) + 1}`;
}

// ------------------------------------------------------------------------------------------------------------
// Server-function calls (same-origin, like the browser) and their seroval answers
// ------------------------------------------------------------------------------------------------------------
export type FnResult<T> = { ok: true; value: T } | { ok: false; message: string; status: number };
type SerovalNode = { t: number; s?: { message?: unknown } };
const serovalValue = (node: unknown): unknown =>
  fromJSON({ t: node, f: 127, m: [] } as unknown as Parameters<typeof fromJSON>[0]);

export async function decodeFn<T>(res: APIResponse): Promise<FnResult<T>> {
  const text = await res.text();
  let root: { p?: { k: string[]; v: SerovalNode[] } } | null = null;
  try {
    root = JSON.parse(text) as { p?: { k: string[]; v: SerovalNode[] } };
  } catch {
    return { ok: false, message: text.slice(0, 300), status: res.status() };
  }
  const keys = root.p?.k ?? [];
  const error = keys.includes("error") ? root.p?.v[keys.indexOf("error")] : undefined;
  if (error && error.t === 25) {
    const message = error.s?.message;
    return {
      ok: false,
      message: message ? String(serovalValue(message)) : "",
      status: res.status(),
    };
  }
  if (res.status() !== 200) return { ok: false, message: text.slice(0, 300), status: res.status() };
  const decoded = serovalValue(root) as { result: T };
  return { ok: true, value: decoded.result };
}

export async function call<T = unknown>(
  request: APIRequestContext,
  fn: ServerFn,
  opts: { host: string; token?: string | undefined; data?: unknown; ip?: string },
): Promise<FnResult<T>> {
  const res = await callServerFn(request, {
    host: opts.host,
    file: fn.file,
    name: fn.name,
    data: opts.data,
    token: opts.token,
    headers: { "x-real-ip": opts.ip ?? nextIp() },
  });
  return decodeFn<T>(res);
}

export function must<T>(r: FnResult<T>, what: string): T {
  if (!r.ok) throw new Error(`${what}: ${r.message}`);
  return r.value;
}

// ------------------------------------------------------------------------------------------------------------
// The mock Hyp (control endpoints of e2e/scripts/mock-hyp.mjs)
// ------------------------------------------------------------------------------------------------------------
export type HypTerminal = {
  label: "platform" | "storeA" | "storeB" | "liveShaped";
  masof: string;
  key: string;
  passp: string;
  successUrl: string;
};
export type HypCall = {
  seq: number;
  method: string;
  path: string;
  action: "SIGN" | "VERIFY" | "PAGE" | "OTHER";
  what: string | null;
  query_keys: string[];
  body_keys: string[];
  masof: string | null;
  order: string | null;
  choice: string | null;
  result: string | null;
};

export const hyp = {
  async reset(request: APIRequestContext) {
    expect((await request.post(`${HYP}/__hyp/reset`)).status()).toBe(200);
  },
  async scenario(request: APIRequestContext, spec: Record<string, unknown>) {
    const res = await request.post(`${HYP}/__hyp/scenario`, { data: spec });
    expect(res.status(), await res.text()).toBe(200);
  },
  async calls(
    request: APIRequestContext,
    query: { order?: string; action?: HypCall["action"]; masof?: string } = {},
  ): Promise<HypCall[]> {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) if (v) params[k] = v;
    return (await (await request.get(`${HYP}/__hyp/calls`, { params })).json()) as HypCall[];
  },
  async terminals(request: APIRequestContext): Promise<Record<HypTerminal["label"], HypTerminal>> {
    const body = (await (await request.get(`${HYP}/__hyp/terminals`)).json()) as {
      terminals: HypTerminal[];
    };
    const byLabel = Object.fromEntries(body.terminals.map((t) => [t.label, t]));
    return byLabel as Record<HypTerminal["label"], HypTerminal>;
  },
};

/** The Order (= attempt reference) carried by a signed pay URL */
export function orderOfPayUrl(payUrl: string): string {
  const order = new URL(payUrl).searchParams.get("Order") ?? "";
  expect(order, "the pay URL carries the attempt reference").toMatch(/^[0-9a-f]{32}$/);
  return order;
}

/** API-style choice on the mock page; approve answers 302 with the browser's return URL */
export async function choose(
  request: APIRequestContext,
  payUrl: string,
  choice: "approve" | "decline" | "cancel" = "approve",
): Promise<{ status: number; location: string; body: string }> {
  expect(payUrl.startsWith(`${HYP}/hyp/p/`), "the pay URL is the local mock").toBe(true);
  const res = await request.get(`${payUrl}&__choice=${choice}`, { maxRedirects: 0 });
  return {
    status: res.status(),
    location: res.headers()["location"] ?? "",
    body: res.status() === 302 ? "" : await res.text(),
  };
}

export const rawOf = (location: string) => location.slice(location.indexOf("?") + 1);
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Delivers a return the way the browser would (Node does not resolve *.localhost: the request goes to 127.0.0.1
 * with the Host / X-Forwarded-Host of the target). `host` overrides the host of `location`.
 */
export async function deliver(
  request: APIRequestContext,
  location: string,
  opts: { host?: string; path?: string; ip?: string; raw?: string; port?: number } = {},
): Promise<{ status: number; location: string; body: string }> {
  const url = new URL(location);
  const host = opts.host ?? url.hostname;
  const path = opts.path ?? url.pathname;
  const raw = opts.raw ?? rawOf(location);
  const res = await request.get(`http://127.0.0.1:${opts.port ?? PORT}${path}?${raw}`, {
    headers: { host, "x-forwarded-host": host, "x-real-ip": opts.ip ?? nextIp() },
    maxRedirects: 0,
  });
  return {
    status: res.status(),
    location: res.headers()["location"] ?? "",
    body: res.status() >= 300 && res.status() < 400 ? "" : await res.text(),
  };
}

/** Replaces one parameter of a raw query, byte for byte (no re-encoding of the others) */
export function tamper(raw: string, key: string, value: string): string {
  const segs = raw.split("&");
  const i = segs.findIndex((s) => s.startsWith(`${key}=`));
  expect(i, `${key} is in the return`).toBeGreaterThanOrEqual(0);
  segs[i] = `${key}=${value}`;
  return segs.join("&");
}

// ------------------------------------------------------------------------------------------------------------
// The run's canaries (app-up.sh writes them; the mock's fake KEY/PassP as a fallback when the server was reused)
// ------------------------------------------------------------------------------------------------------------
const CANARY_FILE = fileURLToPath(new URL("../test-results/hyp-canaries.txt", import.meta.url));
export async function runCanaries(request: APIRequestContext): Promise<string[]> {
  if (existsSync(CANARY_FILE)) {
    const lines = readFileSync(CANARY_FILE, "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length >= 10) return lines;
  }
  const t = await hyp.terminals(request);
  return Object.values(t).flatMap((x) => [x.key, x.passp]);
}
export const findCanaries = (text: string, canaries: string[]) =>
  canaries.filter((c) => text.includes(c)).length;

// ------------------------------------------------------------------------------------------------------------
// Database (migration 208 names) — reads, and the E2E-only state changes the specs need
// ------------------------------------------------------------------------------------------------------------
/** The E2E database is a DEMO database (payments.environment is created unset; only the DB owner marks it) */
export function markDemoDatabase() {
  sql(`UPDATE payments.environment SET name = 'demo' WHERE id AND name IS DISTINCT FROM 'demo'`);
  expect(sql(`SELECT name FROM payments.environment`)).toBe("demo");
}

export function setFlag(key: "max_payments" | "platform_terminal_payments", on: boolean) {
  sql(`UPDATE public.platform_feature_flags SET enabled = ${on} WHERE key = '${key}'`);
}

const json = <T>(query: string): T => JSON.parse(sql(query) || "null") as T;

export type TenantAttempt = {
  id: string;
  state: string;
  reference: string;
  applied: boolean;
  review_reason: string | null;
  return_flags: string[];
  attempt_no: number;
  terminal_number: string;
  provider_txn_id: string | null;
  verify_attempts: number;
  returned_at: string | null;
  signed_at: string | null;
  extra_txn_ids: string[];
};
export function tenantAttempts(orderId: string): TenantAttempt[] {
  return json<TenantAttempt[]>(
    `SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.attempt_no), '[]') FROM (
       SELECT id, state, reference, applied, review_reason, return_flags, attempt_no, terminal_number,
              provider_txn_id, verify_attempts, returned_at, signed_at, extra_txn_ids
         FROM payments.tenant_attempts WHERE order_id = '${orderId}') x`,
  );
}
export const lastAttempt = (orderId: string) => tenantAttempts(orderId).at(-1);

export type OrderRow = { status: string; payment_method: string; payment_status: string };
export function orderRow(orderId: string): OrderRow {
  return json<OrderRow>(
    `SELECT row_to_json(x) FROM (SELECT status, payment_method, payment_status FROM public.orders
      WHERE id = '${orderId}') x`,
  );
}

/** the order's payment window end (null = held: a payment in review stops the expiry, review M3) */
export const paymentDueAt = (orderId: string) =>
  sql(`SELECT COALESCE(payment_due_at::text, 'null') FROM public.orders WHERE id = '${orderId}'`);

export const stockOf = (productId: string) =>
  Number(sql(`SELECT stock_quantity FROM public.global_products WHERE id = '${productId}'`));

export const unknownReturns = (payloadSha: string) =>
  Number(
    sql(`SELECT count(*) FROM payments.unknown_returns WHERE payload_sha256 = '${payloadSha}'`),
  );

/**
 * Test-only "time travel": moves the timestamps of ONE row into the past. The payment tables refuse such an update
 * (snapshot guards), so it runs as the local stack's superuser with triggers off for this one statement. Never
 * used to change a state, an amount or a reference — only the clock the expiry rules read.
 */
export function timeTravel(statement: string) {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_nuriel-e2e",
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `SET session_replication_role = replica; ${statement}`,
    ],
    { encoding: "utf8" },
  );
}

/** The attempt's 30-minute window has passed (expires_at and created_at moved back together) */
export function ageAttempt(attemptId: string, table: "tenant_attempts" | "platform_attempts") {
  timeTravel(
    `UPDATE payments.${table} SET created_at = created_at - interval '1 hour',
                                  expires_at = expires_at - interval '1 hour' WHERE id = '${attemptId}'`,
  );
}

/** The order's payment window has passed, then the existing expiry job runs (stock goes back) */
export function expireOrderNow(orderId: string) {
  sql(`SELECT set_config('kobi.payment_update', 'on', false);
       UPDATE public.orders SET payment_due_at = now() - interval '1 minute' WHERE id = '${orderId}';
       SELECT set_config('kobi.payment_update', 'off', false);
       SELECT public.expire_unpaid_orders();`);
}
export const runAttemptExpiry = () => Number(sql(`SELECT public.max_attempts_expire()`));
/** the DB purge of kept raw returns (the app runs it after every return and in every tick) */
export const runReturnsPurge = () => Number(sql(`SELECT public.platform_payment_returns_purge()`));
export const runPlatformAttemptExpiry = () =>
  Number(sql(`SELECT public.platform_attempts_expire()`));

/** The return of this attempt came back `minutes` ago (returned_at only; the kept raw return keeps its time) */
export function ageReturn(attemptId: string, minutes: number, table = "tenant_attempts") {
  timeTravel(
    `UPDATE payments.${table} SET returned_at = returned_at - interval '${minutes} minutes' WHERE id = '${attemptId}'`,
  );
}
/** The kept raw return(s) of this attempt arrived `minutes` ago (with its ceiling: purge_after ≤ received_at + 2 h) */
export function ageKeptReturns(attemptId: string, minutes: number) {
  timeTravel(
    `UPDATE payments.tenant_returns SET received_at = received_at - interval '${minutes} minutes',
            purge_after = purge_after - interval '${minutes} minutes' WHERE attempt_id = '${attemptId}'`,
  );
}
export const keptReturns = (attemptId: string) =>
  Number(sql(`SELECT count(*) FROM payments.tenant_returns WHERE attempt_id = '${attemptId}'`));

/** The store bell rows (staff_notifications) about this order for one staff user */
export const storeBells = (userId: string, orderNumber: string) =>
  Number(
    sql(`SELECT count(*) FROM public.staff_notifications WHERE tenant_id = '${STORE_B.id}'
          AND user_id = '${userId}' AND title = 'תשלום מקוון לבדיקה' AND body LIKE '%${orderNumber}%'`),
  );

/** The app server's log (app-up.sh tees it); null when the run reused a server started elsewhere */
export const SERVER_LOG = fileURLToPath(new URL("../test-results/server.log", import.meta.url));
export function logLines(pattern: RegExp): number | null {
  if (!existsSync(SERVER_LOG)) return null;
  return readFileSync(SERVER_LOG, "utf8")
    .split("\n")
    .filter((l) => pattern.test(l)).length;
}

/**
 * A signed-looking return of a reference nobody issued, to the store host: the app records it as unknown (no
 * VERIFY) and — like after every handled return — claims the reviews not alerted yet (X-17). With the payment jobs
 * off in E2E, this is how a spec makes the app "look again" without a tick.
 */
export async function pokeReturn(request: APIRequestContext, location: string) {
  const raw = tamper(rawOf(location), "Order", randomBytes(16).toString("hex"));
  const back = await deliver(request, location, { raw });
  expect([back.status, back.location]).toEqual([303, "/checkout/pay/unknown"]);
}

export type PlatformAttempt = {
  id: string;
  state: string;
  reference: string;
  applied: boolean;
  review_reason: string | null;
  payer_tenant_id: string;
  ledger_payment_id: string | null;
  return_origin: string | null;
};
export function platformAttempts(chargeId: string): PlatformAttempt[] {
  return json<PlatformAttempt[]>(
    `SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.attempt_no), '[]') FROM (
       SELECT id, state, reference, applied, review_reason, payer_tenant_id, ledger_payment_id, return_origin,
              attempt_no
         FROM payments.platform_attempts WHERE ledger_charge_id = '${chargeId}') x`,
  );
}
/** Provider-confirmed ledger rows written for one charge's attempts */
export const providerRowsForCharge = (chargeId: string) =>
  Number(
    sql(`SELECT count(*) FROM billing.ledger l
          WHERE l.confirmation = 'provider' AND l.reference IN (
            SELECT p.reference FROM payments.platform_attempts p WHERE p.ledger_charge_id = '${chargeId}')`),
  );

/** An open billing charge of a store (category "other", so the agreement specs' setup / subscription sums stay) */
export function createOpenCharge(tenantId: string, amount: number, label: string): string {
  asPlatform(
    `SELECT public.platform_billing_record_entry('${tenantId}', jsonb_build_object('kind', 'charge',
       'category', 'other', 'amount', ${amount}, 'description', '${label}'))`,
  );
  const id = sql(`SELECT id FROM billing.ledger WHERE tenant_id = '${tenantId}' AND kind = 'charge'
                   AND description = '${label}' ORDER BY entry_no DESC LIMIT 1`);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id;
}

// ------------------------------------------------------------------------------------------------------------
// Fixtures: a store-B customer (non-staff), a cheap product (test payments are capped at ₪50), store B's manager
// ------------------------------------------------------------------------------------------------------------
/** Run stamp: a fresh customer per spec and run (the order rate guard allows 30 orders / 10 min per customer) */
const STAMP = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
export type Account = { email: string; password: string };
export const customerFor = (tag: string): Account => ({
  email: `pay.${tag}.${STAMP}@e2e.test`,
  password: "E2e-Pay-Customer-1!",
});
export const MANAGER_B = {
  email: "manager.b.pay@e2e.test",
  password: "E2e-Pay-Manager-1!",
} as const;
export const PAY_PRODUCT = {
  id: "e2e0b000-0000-0000-0000-0000000000f1",
  name: "מוצר בדיקה לתשלום מקוון",
  sku: "90000191",
  price: 12,
} as const;

/** A non-staff, approved customer of store B (staff orders are always phone orders) + the fixtures below */
export async function ensureStoreBFixtures(request: APIRequestContext, customer: Account) {
  const customerId = await ensureUser(request, customer);
  const username = customer.email
    .split("@")[0]!
    .replace(/[^a-z0-9]/gi, "_")
    .slice(0, 40);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${STORE_B.id}', '${customerId}', '${customer.email}', '${username}', 'customer', true)
       ON CONFLICT DO NOTHING`);
  sql(`INSERT INTO public.customer_profiles (tenant_id, user_id, business_name, contact_name, phone,
         business_address, city, price_tier, age_confirmed, profile_completed)
       VALUES ('${STORE_B.id}', '${customerId}', 'לקוח תשלום מקוון בע"מ', 'לקוח בדיקה', '0500000001',
               'רחוב הבדיקה 2', 'חיפה', 1, true, true)
       ON CONFLICT DO NOTHING`);
  const managerId = await ensureUser(request, MANAGER_B);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name)
       VALUES ('${STORE_B.id}', '${managerId}', '${MANAGER_B.email}', 'manager_b_pay', 'admin', true, 'מנהל בדיקה')
       ON CONFLICT DO NOTHING`);
  sql(`INSERT INTO public.global_products (id, tenant_id, created_by, sku, name, category, description,
         price_tier1, price_tier2, price_tier3, stock_quantity)
       VALUES ('${PAY_PRODUCT.id}', '${STORE_B.id}', '${USERS.ownerB.id}', '${PAY_PRODUCT.sku}', '${PAY_PRODUCT.name}',
               'קטגוריה של B', 'מוצר זול לבדיקות התשלום (תקרת ₪50 במצב בדיקה)', ${PAY_PRODUCT.price},
               ${PAY_PRODUCT.price}, ${PAY_PRODUCT.price}, 500)
       ON CONFLICT (id) DO UPDATE SET price_tier1 = EXCLUDED.price_tier1, price_tier2 = EXCLUDED.price_tier2,
         price_tier3 = EXCLUDED.price_tier3, stock_quantity = GREATEST(public.global_products.stock_quantity, 100)`);
  return { customerId, managerId };
}

/** A store-B order with payment method "online", placed by the customer through the normal RPC (like the checkout) */
export async function placeOnlineOrder(
  request: APIRequestContext,
  token: string,
  customer: Account,
  quantity = 1,
  items?: { product_id: string; variant_id?: string; quantity: number }[],
): Promise<{ id: string; order_number: string }> {
  const { url, anonKey } = supabaseEnv();
  const method =
    sql(`SELECT id FROM public.shipping_methods WHERE tenant_id = '${STORE_B.id}' AND is_active
                       ORDER BY sort_order NULLS LAST, created_at LIMIT 1`);
  const res = await request.post(`${url}/rest/v1/rpc/place_order`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-tenant-id": STORE_B.id,
    },
    data: {
      _kind: "order",
      _items: (items ?? [{ product_id: PAY_PRODUCT.id, quantity }]).map((i) => ({
        ...i,
        unit_price: 0,
      })),
      _vat_rate: 0,
      _prices_include_vat: true,
      _details: {
        customer_name: "לקוח תשלום מקוון",
        customer_tax_id: "123456782",
        customer_phone: "0521234567",
        customer_email: customer.email,
        billing_city: "חיפה",
        billing_address: "הנמל 1",
        billing_zip: "3100000",
        ship_to_different: false,
        shipping_name: "",
        shipping_phone: "",
        shipping_city: "",
        shipping_address: "",
        shipping_zip: "",
        note: "",
        accepted_terms: true,
        shipping_method_id: method,
        coupon_code: "",
        payment_method: "online",
      },
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const row = ((await res.json()) as { id: string; order_number: string }[])[0];
  expect(row?.id).toBeTruthy();
  expect(orderRow(row!.id)).toEqual({
    status: "pending",
    payment_method: "online",
    payment_status: "awaiting",
  });
  return row!;
}

export async function startPayment(
  request: APIRequestContext,
  token: string | undefined,
  orderId: string,
  opts: { host?: string; ip?: string; guestToken?: string } = {},
) {
  return call<{ url: string; demo: boolean }>(request, FN.start, {
    host: opts.host ?? STORE_B_HOST,
    token,
    data: { orderId, ...(opts.guestToken ? { guestToken: opts.guestToken } : {}) },
    ...(opts.ip ? { ip: opts.ip } : {}),
  });
}

/** Order → SIGN → mock page → approve: returns the reference and the browser's return URL (not delivered yet) */
export async function payToReturn(
  request: APIRequestContext,
  token: string,
  orderId: string,
  page: Record<string, unknown> | null = null,
) {
  const started = must(await startPayment(request, token, orderId), "start the online payment");
  const reference = orderOfPayUrl(started.url);
  if (page) await hyp.scenario(request, { target: `order:${reference}`, ...page });
  const approved = await choose(request, started.url, "approve");
  expect(approved.status, approved.body).toBe(302);
  return { reference, payUrl: started.url, location: approved.location };
}

/** E-mails (the mail mock) whose recipient list holds `email`, sent since `since` (optionally naming `mark`) */
export async function mailsTo(
  request: APIRequestContext,
  email: string,
  since: number,
  mark?: string,
) {
  const calls = (await (await request.get(`${HYP}/__calls`)).json()) as {
    method: string;
    url: string;
    body: string;
    at: number;
  }[];
  const recipients = (body: string): string[] => {
    try {
      const to = (JSON.parse(body) as { to?: unknown }).to;
      return (Array.isArray(to) ? to : [to]).map((a) => String(a ?? "").toLowerCase());
    } catch {
      return [];
    }
  };
  return calls.filter(
    (c) =>
      c.method === "POST" &&
      c.url.startsWith("/emails") &&
      c.at >= since &&
      recipients(c.body).some((r) => r.includes(email.toLowerCase())) &&
      (!mark || c.body.includes(mark)),
  );
}

// ------------------------------------------------------------------------------------------------------------
// Terminal setup through the app (platform admin, platform host) — the specs never write credentials in SQL
// ------------------------------------------------------------------------------------------------------------
export async function platformToken(request: APIRequestContext) {
  return accessToken(request, USERS.platform);
}

/** Store terminal (MAX tab): save the fake terminal + canary credentials, enable, check the connection (SIGN) */
export async function setupStoreTerminal(
  request: APIRequestContext,
  label: "storeA" | "storeB",
  admin: string,
) {
  const t = (await hyp.terminals(request))[label];
  const tenantId = label === "storeA" ? STORE_A.id : STORE_B.id;
  // already holding this run's fake credentials (the free check passes) → only make sure it is on
  const before = await call<{ ok: boolean }>(request, FN.testStoreTerminal, {
    host: PLATFORM_HOST,
    token: admin,
    data: { tenantId },
  });
  if (before.ok && before.value.ok) {
    must(
      await call(request, FN.saveStoreTerminal, {
        host: PLATFORM_HOST,
        token: admin,
        data: { tenantId, enabled: true },
      }),
      `switch the ${label} terminal on`,
    );
    return;
  }
  // new credentials: attempts left on the payment page by an EARLIER run would be stranded, so the DB asks for
  // force (review M1) and parks them for review — setup only, never this run's payments
  must(
    await call(request, FN.saveStoreTerminal, {
      host: PLATFORM_HOST,
      token: admin,
      data: {
        tenantId,
        terminalNumber: t.masof,
        apiKey: t.key,
        apiPassword: t.passp,
        enabled: true,
        force: true,
      },
    }),
    `save the ${label} terminal`,
  );
  const tested = must(
    await call<{ ok: boolean; code?: string | null }>(request, FN.testStoreTerminal, {
      host: PLATFORM_HOST,
      token: admin,
      data: { tenantId },
    }),
    `check the ${label} terminal`,
  );
  expect(tested.ok, `connection check of ${label}`).toBe(true);
}

/** The platform terminal's change set (arch-design §5) — non-secret parts + the secrets typed once */
export const platformPatch = (t: HypTerminal, extra: Record<string, unknown> = {}) => ({
  terminalNumber: t.masof,
  apiKey: t.key,
  apiPassword: t.passp,
  enabled: true,
  // review M1: a credential change while a payer is on NURIEL's page needs force (bound to the step-up code too)
  force: true,
  ...extra,
});

/** The step-up code e-mailed to the platform admin after `since` (6 digits) */
export async function stepupCodeFromMail(
  request: APIRequestContext,
  since: number,
  email: string = USERS.platform.email,
) {
  let code = "";
  await expect
    .poll(
      async () => {
        const mails = await mailsTo(request, email, since);
        const mail = mails.filter((m) => m.body.includes("קוד אימות")).pop() ?? mails.pop();
        // six digits that are not part of a colour (#123456) or a longer number
        code = /(?<![#\w])(\d{6})(?!\w)/.exec(mail?.body ?? "")?.[1] ?? "";
        return code;
      },
      { timeout: 15_000 },
    )
    .toMatch(/^\d{6}$/);
  return code;
}

/**
 * The DB allows 5 step-up codes per admin in 10 minutes; the specs ask for more in one run. Test-only: the admin's
 * EARLIER challenges (all superseded by the next request anyway) are moved 11 minutes back, so they stop counting.
 */
export function freeStepupQuota(actorId: string = USERS.platform.id) {
  timeTravel(
    `UPDATE payments.platform_stepup_challenges
        SET created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes'
      WHERE actor_id = '${actorId}' AND created_at > now() - interval '10 minutes'`,
  );
}

/**
 * An extra platform admin for one spec. The app allows 5 step-up code requests per admin in 15 minutes (in memory),
 * so the step-up spec spreads its codes over its own admins. Removed again by `dropPlatformAdmin`.
 */
export async function extraPlatformAdmin(request: APIRequestContext, tag: string) {
  const account: Account = {
    email: `platform.${tag}.${STAMP}@e2e.test`,
    password: "E2e-Pay-Admin-1!",
  };
  const id = await ensureUser(request, account);
  sql(`INSERT INTO public.platform_admins (user_id) VALUES ('${id}') ON CONFLICT DO NOTHING`);
  return { id, account, token: await accessToken(request, account) };
}
export function dropPlatformAdmin(id: string) {
  sql(`DELETE FROM public.platform_admins WHERE user_id = '${id}'`);
}

export async function requestStepup(
  request: APIRequestContext,
  admin: string,
  patch: unknown,
  opts: { freeQuota?: boolean; actorId?: string; email?: string } = {},
) {
  if (opts.freeQuota !== false) freeStepupQuota(opts.actorId);
  const since = Date.now();
  const issued = must(
    await call<{ challengeId: string; expiresAt: string; maskedEmail: string }>(
      request,
      FN.terminalRequestCode,
      { host: PLATFORM_HOST, token: admin, data: { patch } },
    ),
    "request the step-up code",
  );
  return {
    challengeId: issued.challengeId,
    code: await stepupCodeFromMail(request, since, opts.email),
  };
}

/**
 * NURIEL's terminal for this run, set up at most once: the free connection check first (it passes when the terminal
 * already holds this run's fake credentials); otherwise the full step-up save. Then the platform switch on.
 */
export async function ensurePlatformTerminal(request: APIRequestContext, admin: string) {
  const tested = await call<{ ok: boolean; status?: { enabled?: boolean } }>(
    request,
    FN.terminalTest,
    { host: PLATFORM_HOST, token: admin },
  );
  if (tested.ok && tested.value.ok && tested.value.status?.enabled) {
    setFlag("platform_terminal_payments", true);
    return;
  }
  await setupPlatformTerminal(request, admin);
}

/** NURIEL's terminal: step-up code from the mail mock → save → connection check → the platform switch on */
export async function setupPlatformTerminal(request: APIRequestContext, admin: string) {
  const t = (await hyp.terminals(request)).platform;
  const patch = platformPatch(t);
  const { challengeId, code } = await requestStepup(request, admin, patch);
  must(
    await call(request, FN.terminalSave, {
      host: PLATFORM_HOST,
      token: admin,
      data: { patch, challengeId, code },
    }),
    "save the platform terminal",
  );
  const tested = must(
    await call<{ ok: boolean }>(request, FN.terminalTest, { host: PLATFORM_HOST, token: admin }),
    "check the platform terminal",
  );
  expect(tested.ok, "connection check of the platform terminal").toBe(true);
  setFlag("platform_terminal_payments", true);
}

export async function ownerToken(request: APIRequestContext) {
  return accessToken(request, USERS.ownerB);
}

/**
 * A fresh ecommerce store with its own protected owner, for platform payments (the app allows 10 platform starts
 * per owner per 15 minutes, more than one owner can do in a run). Created through platform_create_tenant.
 */
export async function payerStore(request: APIRequestContext, tag: string) {
  const slug = `pay-${tag}-${STAMP}`.toLowerCase().slice(0, 40);
  const owner: Account = { email: `owner.${tag}.${STAMP}@e2e.test`, password: "E2e-Pay-Owner-1!" };
  const ownerId = await ensureUser(request, owner);
  const existing = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  if (!existing) {
    asPlatform(
      `SELECT public.platform_create_tenant('${slug}', 'חנות תשלום ${tag}', '${owner.email}')`,
    );
  }
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       VALUES ('${id}', '${ownerId}', '${owner.email}', '${slug.replace(/-/g, "_")}', 'admin', true, true)
       ON CONFLICT DO NOTHING`);
  sql(`UPDATE public.user_roles SET is_protected = true, role = 'admin', is_approved = true
        WHERE tenant_id = '${id}' AND user_id = '${ownerId}'`);
  return { id, slug, host: hostOf(slug), owner, ownerId, token: await accessToken(request, owner) };
}
