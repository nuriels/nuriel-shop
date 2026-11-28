import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { login, storeUrl } from "./helpers";
import {
  accessToken,
  ageKeptReturns,
  ageReturn,
  call,
  choose,
  createOpenCharge,
  customerFor,
  deliver,
  ensurePlatformTerminal,
  ensureStoreBFixtures,
  FN,
  HYP_PAGE_TESTIDS,
  hyp,
  keptReturns,
  lastAttempt,
  logLines,
  MANAGER_B,
  mailsTo,
  markDemoDatabase,
  must,
  orderOfPayUrl,
  orderRow,
  PAY_PRODUCT,
  payerStore,
  payToReturn,
  paymentDueAt,
  placeOnlineOrder,
  platformAttempts,
  platformToken,
  pokeReturn,
  providerRowsForCharge,
  rawOf,
  runAttemptExpiry,
  runPlatformAttemptExpiry,
  runReturnsPurge,
  setFlag,
  setupStoreTerminal,
  sql,
  startPayment,
  stockOf,
  STORE_B,
  STORE_B_HOST,
  storeBells,
  tamper,
  tenantAttempts,
  TID,
  timeTravel,
  USERS,
} from "./payments-helpers";

// MAX/Hyp DEMO — fix round 3 (contract §7.1 X-14 … X-19): real failures, through the app and the mock Hyp, with the
// DB helper only for the clock. Store B is the actor. R2-2: VERIFY down and no payment job → the order expiry must not
// cancel an order whose return is unverified. R2-1: a staff cancel while the payer is on Hyp's page must not allow a
// second payment. R2-3 / N2 / N3: a forged return is held, parked, alerted once, and a person's decision ends the
// hold. R2-7 / N1: parking by the sweep and by the purge alerts exactly once. R2-4: a platform return while the
// platform side is not ready is recorded and keeps the charge unpayable. retries 0: a retry could hide a race.
test.describe.configure({ retries: 0 });
// No Playwright trace: a trace records every request and response — the mock's fake terminal credentials (canaries)
// and the raw signed returns these specs deliver — and CI's artifact scan would then (rightly) block the upload of
// the whole report. Screenshots and error-context.md on failure are kept.
test.use({ trace: "off" });

const CUSTOMER = customerFor("failures");
/** a second shopper of store B: the "attacker" who forges a return from their own page */
const ATTACKER = customerFor("forger");
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VARIANT_PORT = 3101;
const VERIFY_PENDING = "התשלום בתהליך אימות. אין צורך לשלם שוב; הסטטוס יתעדכן בעוד כמה דקות.";
let customer = "";
let attacker = "";
let managerId = "";

test.beforeAll(async ({ request }) => {
  markDemoDatabase();
  ({ managerId } = await ensureStoreBFixtures(request, CUSTOMER));
  await ensureStoreBFixtures(request, ATTACKER);
  await hyp.reset(request);
  await setupStoreTerminal(request, "storeB", await platformToken(request));
  setFlag("max_payments", true);
  customer = await accessToken(request, CUSTOMER);
  attacker = await accessToken(request, ATTACKER);
});

test.beforeEach(async ({ request }) => {
  await hyp.reset(request);
});

test.afterAll(() => {
  setFlag("max_payments", false);
});

const order = (request: APIRequestContext) => placeOnlineOrder(request, customer, CUSTOMER);
const verifies = async (request: APIRequestContext, reference: string) =>
  hyp.calls(request, { order: reference, action: "VERIFY" });
const payPage = (orderId: string) => storeUrl(STORE_B.slug, `/checkout/pay/${orderId}`);

/** Exactly `n` e-mails about this order reached `email` (polls, then checks that no extra one follows) */
async function expectMails(
  request: APIRequestContext,
  email: string,
  since: number,
  n: number,
  orderNumber: string,
) {
  const count = async () => (await mailsTo(request, email, since, orderNumber)).length;
  await expect.poll(count, { timeout: 20_000 }).toBe(n);
  await new Promise((r) => setTimeout(r, 1_500));
  expect(await count()).toBe(n);
}

/**
 * X-17: exactly one store bell (for store B's manager), one e-mail to the store's admins and one ALERT line for this
 * parked attempt — polled first (the app sends after the 303), then checked again after a pause.
 */
async function expectOneStoreAlert(
  request: APIRequestContext,
  placed: { order_number: string },
  attemptId: string,
  since: number,
) {
  const alert = new RegExp(
    `\\[pay:tenant\\] ALERT needs_review attempt=${attemptId.slice(0, 8)} reason=verify_exhausted`,
  );
  await expect.poll(() => storeBells(managerId, placed.order_number), { timeout: 20_000 }).toBe(1);
  await expectMails(request, MANAGER_B.email, since, 1, placed.order_number);
  // the ALERT line is in the server log when this run started the server (app-up.sh tees it)
  const lines = logLines(alert);
  if (lines !== null) await expect.poll(() => logLines(alert), { timeout: 10_000 }).toBe(1);
  expect(storeBells(managerId, placed.order_number)).toBe(1);
}

/**
 * A forged return for `reference`: the attacker's own, genuinely signed return (their order, same amount) with the
 * victim's reference put in. Our side cannot tell; the mock's VERIFY rejects it (it was never issued like this).
 */
async function forgedReturnFor(request: APIRequestContext, reference: string) {
  const own = await placeOnlineOrder(request, attacker, ATTACKER);
  const { location } = await payToReturn(request, attacker, own.id);
  return { location, raw: tamper(rawOf(location), "Order", reference) };
}

/** The order's card in the store's order panel (admin › orders) */
function orderCard(page: Page, orderNumber: string) {
  return page
    .locator("div.shadow-card")
    .filter({ has: page.getByRole("checkbox", { name: `בחירת הזמנה ${orderNumber}` }) });
}

async function customerPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, storeUrl(STORE_B.slug), CUSTOMER);
  return { context, page };
}

test("R2-2 (HIGH): VERIFY down, no payment job — the order expiry later leaves the held order and its stock alone; the recovered VERIFY pays once", async ({
  request,
}) => {
  test.setTimeout(120_000);
  const since = Date.now();
  const stock0 = stockOf(PAY_PRODUCT.id);
  const placed = await order(request);
  expect(stockOf(PAY_PRODUCT.id)).toBe(stock0 - 1);
  const { reference, location } = await payToReturn(request, customer, placed.id);
  // Hyp's VERIFY is down: first it hangs (the app gives up after 15 s), then it answers an HTML error page
  await hyp.scenario(request, { target: `order:${reference}`, verify: "timeout", times: 1 });
  expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  await hyp.scenario(request, { target: `order:${reference}`, verify: "html_200", times: 1 });
  expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  expect(lastAttempt(placed.id)).toMatchObject({ state: "returned", applied: false });
  // X-14: the DB held the order at the first recorded return (no due time)
  expect(paymentDueAt(placed.id)).toBe("null");
  const view = must(
    await call<{ held: boolean; attempt: { state: string } | null }>(request, FN.status, {
      host: STORE_B_HOST,
      token: customer,
      data: { orderId: placed.id },
    }),
    "status while VERIFY is down",
  );
  expect([view.held, view.attempt?.state]).toEqual([true, "returned"]);

  // three hours pass (the order's 2-hour window and any extension are long over; the return came 60 minutes ago).
  // No payment job runs (PAYMENTS_JOBS=off); the store's order expiry does
  timeTravel(
    `UPDATE public.orders SET created_at = created_at - interval '3 hours' WHERE id = '${placed.id}';
     UPDATE payments.tenant_attempts SET created_at = created_at - interval '3 hours',
            expires_at = expires_at - interval '3 hours', signed_at = signed_at - interval '3 hours',
            returned_at = returned_at - interval '60 minutes' WHERE order_id = '${placed.id}';
     UPDATE payments.tenant_returns SET received_at = received_at - interval '60 minutes',
            purge_after = purge_after - interval '60 minutes'
      WHERE attempt_id IN (SELECT id FROM payments.tenant_attempts WHERE order_id = '${placed.id}')`,
  );
  sql(`SELECT public.expire_unpaid_orders()`);
  expect(orderRow(placed.id)).toMatchObject({ status: "pending", payment_status: "awaiting" });
  expect(paymentDueAt(placed.id)).toBe("null");
  expect(stockOf(PAY_PRODUCT.id)).toBe(stock0 - 1);
  // meanwhile no second payment page (X-15)
  const again = await startPayment(request, customer, placed.id);
  expect(again).toMatchObject({ ok: false, message: VERIFY_PENDING });
  expect(tenantAttempts(placed.id)).toHaveLength(1);

  // Hyp is back: the shopper's refresh (the same return, re-verified) pays the order — once
  expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  expect(lastAttempt(placed.id)).toMatchObject({ state: "test_paid", applied: true });
  expect(orderRow(placed.id)).toMatchObject({ status: "pending", payment_status: "paid" });
  await deliver(request, location);
  sql(`SELECT public.expire_unpaid_orders()`);
  expect(orderRow(placed.id).payment_status).toBe("paid");
  expect(await verifies(request, reference)).toHaveLength(3);
  expect(stockOf(PAY_PRODUCT.id)).toBe(stock0 - 1);
  await expectMails(request, CUSTOMER.email, since, 1, placed.order_number);
});

test("R2-1: staff cancels the attempt while the payer is on Hyp's page — the late return is unverified; no second payment page", async ({
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const placed = await order(request);
  const started = must(await startPayment(request, customer, placed.id), "start");
  const reference = orderOfPayUrl(started.url);
  // the store's admin cancels the live attempt (to edit the order) — the payer is still on Hyp's page
  const manager = await accessToken(request, MANAGER_B);
  must(
    await call(request, FN.cancelAttempt, {
      host: STORE_B_HOST,
      token: manager,
      data: { orderId: placed.id },
    }),
    "staff cancels the attempt",
  );
  expect(lastAttempt(placed.id)?.state).toBe("cancelled");
  // the payer pays anyway; the late return comes back while VERIFY fails (HTML error page)
  await hyp.scenario(request, { target: `order:${reference}`, verify: "html_200", times: 1 });
  const approved = await choose(request, started.url, "approve");
  expect(approved.status).toBe(302);
  expect((await deliver(request, approved.location)).location).toBe(
    `/checkout/pay/${placed.id}?r=1`,
  );
  const late = lastAttempt(placed.id)!;
  expect([late.state, late.applied, late.returned_at !== null]).toEqual(["cancelled", false, true]);
  expect(paymentDueAt(placed.id)).toBe("null");

  // X-15: the order is busy — no second payment (API), and the pay page shows "in review" without a Pay button
  const second = await startPayment(request, customer, placed.id);
  expect(second).toMatchObject({ ok: false, message: VERIFY_PENDING });
  const { context, page } = await customerPage(browser);
  try {
    await page.goto(payPage(placed.id));
    await expect(page.getByTestId(TID.payPage)).toHaveAttribute("data-stage", "review", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("online-pay-retry")).toHaveCount(0);
    await page.goto(`${payPage(placed.id)}?start=1`);
    await expect(page.getByTestId(TID.payPage)).toHaveAttribute("data-stage", "review", {
      timeout: 20_000,
    });
    await expect(page.getByTestId(HYP_PAGE_TESTIDS.page)).toHaveCount(0);
  } finally {
    await context.close();
  }
  expect(tenantAttempts(placed.id)).toHaveLength(1);
  expect(await hyp.calls(request, { action: "SIGN" })).toHaveLength(1);

  // Hyp answers again: the one real charge pays the order (still one attempt, one SIGN, one VERIFY that said 0)
  expect((await deliver(request, approved.location)).location).toBe(
    `/checkout/pay/${placed.id}?r=1`,
  );
  expect(lastAttempt(placed.id)).toMatchObject({ state: "test_paid", applied: true });
  expect(orderRow(placed.id).payment_status).toBe("paid");
  expect(tenantAttempts(placed.id)).toHaveLength(1);
  expect(await hyp.calls(request, { action: "SIGN" })).toHaveLength(1);
});

test("R2-3 / N2 (charged): after 'charged' the order stays held — never expired, never payable online again", async ({
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const placed = await order(request);
  const started = must(await startPayment(request, customer, placed.id), "start");
  const reference = orderOfPayUrl(started.url);
  const forged = await forgedReturnFor(request, reference);
  const since = Date.now();
  await deliver(request, forged.location, { raw: forged.raw });
  const first = lastAttempt(placed.id)!;
  expect(first.state).toBe("returned");
  ageReturn(first.id, 120);
  runAttemptExpiry();
  expect(lastAttempt(placed.id)?.state).toBe("needs_review");
  await pokeReturn(request, forged.location);
  await expectOneStoreAlert(request, placed, first.id, since);

  // the store owner decides "charged" (the server function the panel calls)
  const ownerB = await accessToken(request, USERS.ownerB);
  // the outcome is required while the order still awaits its payment
  const noOutcome = await call(request, FN.resolveReview, {
    host: STORE_B_HOST,
    token: ownerB,
    data: { orderId: placed.id, attemptId: first.id, note: "" },
  });
  expect(noOutcome.ok).toBe(false);
  const resolved = must(
    await call<{ resolved: boolean }>(request, FN.resolveReview, {
      host: STORE_B_HOST,
      token: ownerB,
      data: { orderId: placed.id, attemptId: first.id, outcome: "charged", note: "חויב בפורטל" },
    }),
    "resolve: charged",
  );
  expect(resolved.resolved).toBe(true);
  expect(paymentDueAt(placed.id)).toBe("null");
  const staffView = must(
    await call<{ held: boolean; attempt: { reviewOutcome?: string | null } | null }>(
      request,
      FN.orderPayment,
      { host: STORE_B_HOST, token: ownerB, data: { orderId: placed.id } },
    ),
    "the order panel's view",
  );
  expect([staffView.held, staffView.attempt?.reviewOutcome]).toEqual([true, "charged"]);

  // three hours later the order expiry still leaves it; no second payment, no Pay button
  timeTravel(
    `UPDATE public.orders SET created_at = created_at - interval '3 hours' WHERE id = '${placed.id}'`,
  );
  sql(`SELECT public.expire_unpaid_orders()`);
  expect(orderRow(placed.id)).toMatchObject({ status: "pending", payment_status: "awaiting" });
  expect((await startPayment(request, customer, placed.id)).ok).toBe(false);
  const { context, page } = await customerPage(browser);
  try {
    await page.goto(payPage(placed.id));
    await expect(page.getByTestId(TID.payPage)).toHaveAttribute("data-stage", "review", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("online-pay-retry")).toHaveCount(0);
  } finally {
    await context.close();
  }
  expect(tenantAttempts(placed.id)).toHaveLength(1);
  expect(await hyp.calls(request, { order: reference, action: "SIGN" })).toHaveLength(1);
});

test("R2-3 / N2 / N3: a forged return (VERIFY rejects it) → held → parked → one bell → 'not charged' → the customer pays again, once", async ({
  request,
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const placed = await order(request);
  const started = must(await startPayment(request, customer, placed.id), "start");
  const reference = orderOfPayUrl(started.url);
  const forged = await forgedReturnFor(request, reference);
  const since = Date.now();
  expect((await deliver(request, forged.location, { raw: forged.raw })).location).toBe(
    `/checkout/pay/${placed.id}?r=1`,
  );
  const first = lastAttempt(placed.id)!;
  expect(first).toMatchObject({ state: "returned", applied: false });
  expect((await verifies(request, reference)).map((c) => c.result)).toEqual(["9901"]);
  expect(paymentDueAt(placed.id)).toBe("null");

  // 90 minutes and no VERIFY confirmed it: the sweep parks it for a person (the order stays held)
  ageReturn(first.id, 120);
  expect(runAttemptExpiry()).toBeGreaterThanOrEqual(1);
  expect(lastAttempt(placed.id)).toMatchObject({
    state: "needs_review",
    review_reason: "verify_exhausted",
  });
  await pokeReturn(request, forged.location);
  await expectOneStoreAlert(request, placed, first.id, since);
  sql(`SELECT public.expire_unpaid_orders()`);
  expect(orderRow(placed.id)).toMatchObject({ status: "pending", payment_status: "awaiting" });

  // the store owner checks the Hyp portal and decides "not charged" in the order panel (X-16)
  await login(page, storeUrl(STORE_B.slug), USERS.ownerB);
  await page.goto(storeUrl(STORE_B.slug, "/admin?tab=orders"));
  const info = orderCard(page, placed.order_number).getByTestId("online-payment-info");
  await expect(info).toHaveAttribute("data-state", "needs_review", { timeout: 30_000 });
  await expect(info).toHaveAttribute("data-held", "true");
  await info.getByTestId("online-payment-resolve").click();
  await info.getByTestId("online-payment-resolve-note").fill("נבדק בפורטל: לא בוצע חיוב");
  await info.getByTestId("online-payment-resolve-not-charged").click();
  await expect(page.getByText("ההחלטה נשמרה.")).toBeVisible({ timeout: 15_000 });
  await expect(info).toHaveAttribute("data-held", "false");
  expect(paymentDueAt(placed.id)).not.toBe("null");
  expect(sql(`SELECT review_outcome FROM payments.tenant_attempts WHERE id = '${first.id}'`)).toBe(
    "not_charged",
  );

  // the customer can pay again from the pay page — a new page, paid once
  const { context, page: shopper } = await customerPage(browser);
  try {
    await shopper.goto(payPage(placed.id));
    const pay = shopper.getByTestId(TID.payPage);
    await expect(pay).toHaveAttribute("data-stage", /ready|failed/, { timeout: 20_000 });
    await shopper.getByTestId("online-pay-retry").click();
    await expect(shopper.getByTestId(HYP_PAGE_TESTIDS.page)).toBeVisible({ timeout: 30_000 });
    await shopper.getByTestId(HYP_PAGE_TESTIDS.approve).click();
    await expect(shopper.getByTestId(TID.payPage)).toHaveAttribute("data-stage", "paid", {
      timeout: 30_000,
    });
  } finally {
    await context.close();
  }
  const attempts = tenantAttempts(placed.id);
  expect(attempts.map((a) => [a.state, a.applied])).toEqual([
    ["needs_review", false],
    ["test_paid", true],
  ]);
  expect(orderRow(placed.id).payment_status).toBe("paid");
  expect(await verifies(request, attempts[1]!.reference)).toHaveLength(1);
  await expectMails(request, CUSTOMER.email, since, 1, placed.order_number);
  // still one alert for the forged attempt
  expect(storeBells(managerId, placed.order_number)).toBe(1);
});

test("R2-7 / N1: parked by the sweep and by the purge → exactly one bell, one e-mail, one ALERT each; looking again adds nothing", async ({
  request,
}) => {
  test.setTimeout(150_000);
  // two orders back from Hyp's page while VERIFY answers an HTML error: returned, kept, unverified
  const returned = async () => {
    const placed = await order(request);
    const paid = await payToReturn(request, customer, placed.id);
    await hyp.scenario(request, {
      target: `order:${paid.reference}`,
      verify: "html_200",
      times: 1,
    });
    await deliver(request, paid.location);
    const attempt = lastAttempt(placed.id)!;
    expect(attempt.state).toBe("returned");
    expect(keptReturns(attempt.id)).toBe(1);
    return { placed, attempt, location: paid.location };
  };
  const bySweep = await returned();
  const byPurge = await returned();
  const since = Date.now();
  // the sweep: the return came back 2 hours ago (its kept copy keeps its own time)
  ageReturn(bySweep.attempt.id, 120);
  expect(runAttemptExpiry()).toBeGreaterThanOrEqual(1);
  // the purge: the kept copy arrived 2 hours ago (the attempt's return time is recent)
  ageKeptReturns(byPurge.attempt.id, 120);
  expect(lastAttempt(byPurge.placed.id)?.state).toBe("returned");
  runReturnsPurge();
  for (const parked of [bySweep, byPurge])
    expect(lastAttempt(parked.placed.id)).toMatchObject({
      state: "needs_review",
      review_reason: "verify_exhausted",
    });
  for (const parked of [bySweep, byPurge]) {
    expect(storeBells(managerId, parked.placed.order_number)).toBe(0);
    expect(paymentDueAt(parked.placed.id)).toBe("null");
  }

  // the next handled return claims both (X-17)
  await pokeReturn(request, bySweep.location);
  for (const parked of [bySweep, byPurge])
    await expectOneStoreAlert(request, parked.placed, parked.attempt.id, since);

  // N1: more returns, an exact replay of a parked one, the sweep and the purge again — nothing rings twice
  await pokeReturn(request, bySweep.location);
  await deliver(request, bySweep.location);
  await deliver(request, byPurge.location);
  runAttemptExpiry();
  runReturnsPurge();
  await pokeReturn(request, byPurge.location);
  await new Promise((r) => setTimeout(r, 2_000));
  for (const parked of [bySweep, byPurge])
    await expectOneStoreAlert(request, parked.placed, parked.attempt.id, since);
});

test("R2-4: a platform return while the platform side is not ready is recorded, not verified; the charge stays unpayable; the sweep parks it", async ({
  request,
}) => {
  test.setTimeout(150_000);
  const admin = await platformToken(request);
  await ensurePlatformTerminal(request, admin);
  const payer = await payerStore(request, "r24");
  await hyp.reset(request); // the terminal check above signs once; count this test's pages only
  const chargeId = createOpenCharge(payer.id, 12.34, `DEMO R2-4 ${randomBytes(4).toString("hex")}`);
  const start = () =>
    call<{ url: string }>(request, FN.payStart, {
      host: payer.host,
      token: payer.token,
      data: { chargeId },
    });
  const started = must(await start(), "start on the ready server");
  const reference = orderOfPayUrl(started.url);
  const approved = await choose(request, started.url, "approve");
  expect(approved.status).toBe(302);

  // the return reaches a server whose platform side is not ready (no platform root secret): same build, DB and mocks
  const variant: ChildProcess = spawn("bash", ["e2e/scripts/app-up.sh"], {
    cwd: ROOT,
    env: {
      ...process.env,
      E2E_APP_VARIANT: "platform-not-ready",
      E2E_APP_PORT: String(VARIANT_PORT),
    },
    stdio: "ignore",
    detached: true,
  });
  try {
    await expect
      .poll(
        async () => {
          try {
            return (
              await request.get(`http://127.0.0.1:${VARIANT_PORT}/`, { timeout: 2_000 })
            ).status();
          } catch {
            return 0;
          }
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toBeGreaterThan(0);
    const startup = logLines(/\[payments\] env=demo .*tenant=ready platform=off:root_missing/);
    if (startup !== null) expect(startup).toBeGreaterThanOrEqual(1);

    const back = await deliver(request, approved.location, { port: VARIANT_PORT });
    expect(back.status).toBe(303);
    expect(back.location).toMatch(/\/admin\?tab=billing&pay=return$/);
    const [attempt] = platformAttempts(chargeId);
    expect(attempt).toMatchObject({ state: "returned", applied: false, reference });
    expect(
      sql(
        `SELECT returned_at IS NOT NULL FROM payments.platform_attempts WHERE id = '${attempt!.id}'`,
      ),
    ).toBe("t");
    expect(await hyp.calls(request, { order: reference, action: "VERIFY" })).toHaveLength(0);
    expect(providerRowsForCharge(chargeId)).toBe(0);
    const alert = new RegExp(
      `\\[pay:platform\\] ALERT return_not_verified attempt=${attempt!.id.slice(0, 8)}`,
    );
    if (logLines(alert) !== null)
      await expect.poll(() => logLines(alert), { timeout: 10_000 }).toBe(1);
  } finally {
    if (variant.pid) process.kill(-variant.pid, "SIGTERM");
  }

  // on the ready server the owner cannot pay the same charge again: not payable, no new page
  expect((await start()).ok).toBe(false);
  const options = must(
    await call<{ charges: { id: string; payable: boolean }[] }>(request, FN.payOptions, {
      host: payer.host,
      token: payer.token,
    }),
    "pay options",
  );
  expect(options.charges.find((c) => c.id === chargeId)?.payable ?? false).toBe(false);
  expect(platformAttempts(chargeId)).toHaveLength(1);
  expect(await hyp.calls(request, { action: "SIGN" })).toHaveLength(1);

  // 90 minutes and no VERIFY: the platform sweep parks it for the platform admin; still one attempt, no ledger row
  const id = platformAttempts(chargeId)[0]!.id;
  ageReturn(id, 120, "platform_attempts");
  expect(runPlatformAttemptExpiry()).toBeGreaterThanOrEqual(1);
  expect(platformAttempts(chargeId)).toEqual([
    expect.objectContaining({ state: "needs_review", review_reason: "verify_exhausted" }),
  ]);
  expect((await start()).ok).toBe(false);
  expect(providerRowsForCharge(chargeId)).toBe(0);
});
