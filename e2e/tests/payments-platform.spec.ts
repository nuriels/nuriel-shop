import { randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostGet, login, storeUrl } from "./helpers";
import {
  accessToken,
  ageAttempt,
  call,
  choose,
  createOpenCharge,
  customerFor,
  deliver,
  ensureStoreBFixtures,
  FN,
  HYP_PAGE_TESTIDS,
  hyp,
  MANAGER_B,
  markDemoDatabase,
  must,
  orderOfPayUrl,
  ownerToken,
  PLATFORM_HOST,
  platformAttempts,
  platformToken,
  providerRowsForCharge,
  rawOf,
  setFlag,
  ensurePlatformTerminal,
  sql,
  STORE_A_HOST,
  STORE_B,
  STORE_B_HOST,
  tamper,
  TID,
  USERS,
} from "./payments-helpers";

// MAX/Hyp DEMO — the store owner pays NURIEL an open billing charge with NURIEL's own (fake) terminal
// (DM-PLAT-1, DM-PLAT-3, DM-PLAT-5). The return lands on the platform host; the DB writes exactly one provider row
// in billing.ledger; nothing is activated, renewed or upgraded (decision ה-3). retries 0.
test.describe.configure({ retries: 0 });

const CUSTOMER = customerFor("platform");
let owner = "";
let admin = "";
let terminals: Awaited<ReturnType<typeof hyp.terminals>>;

test.beforeAll(async ({ request }) => {
  markDemoDatabase();
  await ensureStoreBFixtures(request, CUSTOMER);
  await hyp.reset(request);
  admin = await platformToken(request);
  await ensurePlatformTerminal(request, admin);
  owner = await ownerToken(request);
  terminals = await hyp.terminals(request);
});

test.beforeEach(async ({ request }) => {
  await hyp.reset(request);
});

test.afterAll(() => {
  setFlag("platform_terminal_payments", false);
  sql(
    `UPDATE public.tenants SET status = 'active' WHERE id = '${STORE_B.id}' AND status <> 'active'`,
  );
});

const newCharge = (amount = 12.34) =>
  createOpenCharge(STORE_B.id, amount, `DEMO platform ${randomBytes(4).toString("hex")}`);

async function start(
  request: APIRequestContext,
  token: string,
  chargeId: string,
  host = STORE_B_HOST,
) {
  return call<{ url: string; demo: boolean }>(request, FN.payStart, {
    host,
    token,
    data: { chargeId },
  });
}

/** What the store keeps of its subscription and add-ons (nothing may change when NURIEL is paid online) */
const storeEntitlements = () =>
  sql(`SELECT json_build_object(
         'sub', (SELECT row_to_json(s) FROM (SELECT plan_type, status, current_period_end, trial_ends_at
                   FROM public.tenant_subscriptions WHERE tenant_id = '${STORE_B.id}') s),
         'addons', (SELECT count(*) FROM public.tenant_addons WHERE tenant_id = '${STORE_B.id}'),
         'tenant', (SELECT status FROM public.tenants WHERE id = '${STORE_B.id}'))`);

test("DM-PLAT-1: only the store's owner may pay — platform admin, manager, another store's owner and a customer are refused", async ({
  request,
}) => {
  const chargeId = newCharge();
  const refused: [string, string, string][] = [
    ["platform admin on store B", admin, STORE_B_HOST],
    ["store B manager (not the owner)", await accessToken(request, MANAGER_B), STORE_B_HOST],
    ["store A's owner on store B", await accessToken(request, USERS.ownerA), STORE_B_HOST],
    [
      "store A's owner with B's charge on A",
      await accessToken(request, USERS.ownerA),
      STORE_A_HOST,
    ],
    ["a customer of store B", await accessToken(request, CUSTOMER), STORE_B_HOST],
    ["the owner on the platform host", owner, PLATFORM_HOST],
  ];
  for (const [who, token, host] of refused) {
    const r = await start(request, token, chargeId, host);
    expect(r.ok, who).toBe(false);
  }
  expect(platformAttempts(chargeId)).toEqual([]);
  expect(await hyp.calls(request, { action: "SIGN" })).toEqual([]);
  // the owner's view offers the charge; a platform admin acting on the store is not offered anything
  const mine = must(
    await call<{ available: boolean; charges: { id: string; payable: boolean }[] }>(
      request,
      FN.payOptions,
      { host: STORE_B_HOST, token: owner },
    ),
    "owner options",
  );
  expect(mine.available).toBe(true);
  expect(mine.charges.find((c) => c.id === chargeId)?.payable).toBe(true);
  const asAdmin = await call<{ available: boolean }>(request, FN.payOptions, {
    host: STORE_B_HOST,
    token: admin,
  });
  expect(asAdmin.ok ? asAdmin.value.available : false).toBe(false);
  // the owner can
  const ok = must(await start(request, owner, chargeId), "the owner starts");
  expect(platformAttempts(chargeId)).toHaveLength(1);
  const sign = await hyp.calls(request, { order: orderOfPayUrl(ok.url), action: "SIGN" });
  expect(sign.map((c) => c.masof)).toEqual([terminals.platform.masof]);
});

test("DM-PLAT-3: paid → one provider ledger row, nothing activated; verified with NURIEL's terminal; back to the store's billing tab", async ({
  request,
}) => {
  const before = storeEntitlements();
  const chargeId = newCharge();
  const started = must(await start(request, owner, chargeId), "start");
  const reference = orderOfPayUrl(started.url);
  expect(new URL(started.url).searchParams.get("Amount")).toBe("12.34");
  const approved = await choose(request, started.url, "approve");
  expect(new URL(approved.location).hostname).toBe(PLATFORM_HOST);
  const back = await deliver(request, approved.location);
  expect(back.status).toBe(303);
  expect(back.location).toMatch(
    /^http:\/\/store-b\.shop\.localhost(:3100)?\/admin\?tab=billing&pay=return$/,
  );

  expect(platformAttempts(chargeId)).toEqual([
    expect.objectContaining({ state: "test_paid", applied: true, reference }),
  ]);
  expect(providerRowsForCharge(chargeId)).toBe(1);
  const row = JSON.parse(
    sql(`SELECT row_to_json(l) FROM (SELECT tenant_id, kind, category, amount, method, confirmation, source
           FROM billing.ledger WHERE reference = '${reference}' AND confirmation = 'provider') l`),
  ) as Record<string, unknown>;
  expect(row).toEqual({
    tenant_id: STORE_B.id,
    kind: "payment",
    category: "other",
    amount: 12.34,
    method: "credit_card",
    confirmation: "provider",
    source: "provider",
  });
  // decision ה-3: nothing is renewed, upgraded or activated
  expect(storeEntitlements()).toBe(before);
  // VERIFY with NURIEL's terminal; store B's terminal is never used for this payment
  const all = await hyp.calls(request, { order: reference });
  expect([...new Set(all.map((c) => c.masof))]).toEqual([terminals.platform.masof]);
  // replays change nothing
  await deliver(request, approved.location);
  await deliver(request, approved.location);
  expect(providerRowsForCharge(chargeId)).toBe(1);
  expect(await hyp.calls(request, { order: reference, action: "VERIFY" })).toHaveLength(1);
  // the owner's list shows it
  const payments = must(
    await call<{ id: string; state: string; test: boolean }[]>(request, FN.myPayments, {
      host: STORE_B_HOST,
      token: owner,
    }),
    "my card payments",
  );
  expect(payments.some((p) => p.state === "test_paid" && p.test)).toBe(true);
  // a charge already paid online cannot be started again
  expect((await start(request, owner, chargeId)).ok).toBe(false);
});

test("DM-PLAT-3: a second payment of the same charge (the old page of a superseded attempt) → for review, still one row", async ({
  request,
}) => {
  const chargeId = newCharge();
  const first = must(await start(request, owner, chargeId), "first start");
  const [old] = platformAttempts(chargeId);
  // the first attempt's time runs out; the owner starts again → a new attempt (the old page is still open at Hyp)
  ageAttempt(old!.id, "platform_attempts");
  const second = must(await start(request, owner, chargeId), "second start");
  expect(orderOfPayUrl(second.url)).not.toBe(orderOfPayUrl(first.url));
  const paid = await choose(request, second.url, "approve");
  await deliver(request, paid.location);
  expect(providerRowsForCharge(chargeId)).toBe(1);
  // now the old page is paid as well: money moved twice → a person must refund; no second row
  const late = await choose(request, first.url, "approve");
  expect(late.status).toBe(302);
  await deliver(request, late.location);
  const attempts = platformAttempts(chargeId);
  expect(attempts.find((a) => a.id === old!.id)).toMatchObject({
    state: "needs_review",
    review_reason: "duplicate_charge",
    applied: false,
  });
  expect(providerRowsForCharge(chargeId)).toBe(1);
});

test("DM-PLAT-3: a forged amount never writes a ledger row (VERIFY fails; with a lenient VERIFY the DB refuses it)", async ({
  request,
}) => {
  const chargeId = newCharge();
  // a lower amount in the request body is ignored: the amount comes from the charge
  const started = must(
    await call<{ url: string }>(request, FN.payStart, {
      host: STORE_B_HOST,
      token: owner,
      data: { chargeId, amount: 0.01, amountMinor: 1 },
    }),
    "start",
  );
  expect(new URL(started.url).searchParams.get("Amount")).toBe("12.34");
  const reference = orderOfPayUrl(started.url);
  const approved = await choose(request, started.url, "approve");
  const forged = tamper(rawOf(approved.location), "Amount", "0.10");
  await deliver(request, approved.location, { raw: forged });
  expect(providerRowsForCharge(chargeId)).toBe(0);
  expect(platformAttempts(chargeId)[0]?.state).toBe("returned");
  // even if VERIFY said 0 for it, the amount check of the DB parks it for review
  await hyp.scenario(request, { target: `order:${reference}`, verify: "lenient" });
  await deliver(request, approved.location, { raw: forged });
  expect(platformAttempts(chargeId)[0]).toMatchObject({
    state: "needs_review",
    review_reason: "amount_mismatch",
    applied: false,
  });
  expect(providerRowsForCharge(chargeId)).toBe(0);
});

test("DM-PLAT-5: a locked (suspended) store can still pay; the return lands on the platform host", async ({
  request,
}) => {
  test.setTimeout(90_000);
  const chargeId = newCharge();
  sql(`UPDATE public.tenants SET status = 'suspended' WHERE id = '${STORE_B.id}'`);
  try {
    // the tenant cache (15 s): wait until the storefront is locked
    await expect
      .poll(async () => (await hostGet(request, STORE_B_HOST, "/")).status(), { timeout: 30_000 })
      .toBe(403);
    const started = must(await start(request, owner, chargeId), "start on a locked store");
    const approved = await choose(request, started.url, "approve");
    expect(new URL(approved.location).hostname).toBe(PLATFORM_HOST);
    expect((await deliver(request, approved.location)).status).toBe(303);
    expect(providerRowsForCharge(chargeId)).toBe(1);
  } finally {
    sql(`UPDATE public.tenants SET status = 'active' WHERE id = '${STORE_B.id}'`);
  }
  await expect
    .poll(async () => (await hostGet(request, STORE_B_HOST, "/")).status(), { timeout: 30_000 })
    .toBe(200);
});

test("DM-PLAT-3 (UI): the owner pays a charge from 'המנוי שלי'; the result is shown back in the store", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const chargeId = newCharge(7.5);
  await login(page, storeUrl(STORE_B.slug), USERS.ownerB);
  await page.goto(storeUrl(STORE_B.slug, "/admin?tab=billing"));
  const section = page.getByTestId(TID.myBillingPay);
  await expect(section).toHaveAttribute("data-available", "true", { timeout: 20_000 });
  const row = page.locator(`[data-testid="my-billing-pay-charge"][data-charge-id="${chargeId}"]`);
  await expect(row).toHaveAttribute("data-payable", "true");
  await row.getByTestId(TID.myBillingPayButton).click();
  await expect(page.getByTestId(HYP_PAGE_TESTIDS.page)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(HYP_PAGE_TESTIDS.approve).click();
  await expect(page).toHaveURL(/store-b\.shop\.localhost:3100\/admin\?tab=billing/, {
    timeout: 30_000,
  });
  await expect(page.getByTestId(TID.myBillingPayResult)).toHaveAttribute("data-state", /paid/, {
    timeout: 30_000,
  });
  expect(providerRowsForCharge(chargeId)).toBe(1);
});
