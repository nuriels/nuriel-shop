import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { login, storeUrl, supabaseEnv } from "./helpers";
import {
  accessToken,
  ageAttempt,
  call,
  choose,
  customerFor,
  deliver,
  ensureStoreBFixtures,
  expireOrderNow,
  findCanaries,
  FN,
  HYP_PAGE_TESTIDS,
  hyp,
  lastAttempt,
  mailsTo,
  markDemoDatabase,
  must,
  nextIp,
  orderOfPayUrl,
  orderRow,
  PAY_PRODUCT,
  payToReturn,
  placeOnlineOrder,
  PLATFORM_HOST,
  platformToken,
  rawOf,
  runAttemptExpiry,
  runCanaries,
  setFlag,
  setupStoreTerminal,
  sql,
  USERS,
  paymentDueAt,
  sha256,
  startPayment,
  stockOf,
  STORE_B,
  STORE_B_HOST,
  tamper,
  tenantAttempts,
  TID,
  unknownReturns,
} from "./payments-helpers";

// MAX/Hyp DEMO — a store checkout paid through the mock Hyp (e2e/scripts/mock-hyp.mjs). Store B is the main actor:
// store A is the default store and would hide a fallback to it. The customer is an ordinary, non-staff account (a
// staff order is always a phone order). Paid = VERIFY with store B's own fake terminal said exactly CCode=0 and every
// local check matched. M03–M11 of the manual DEMO list, automated against the mock. No retry: a retry could hide a race.
test.describe.configure({ retries: 0 });
// No Playwright trace: a trace records every request and response — the mock's fake terminal credentials (canaries)
// and the raw signed returns these specs deliver — and CI's artifact scan would then (rightly) block the upload of
// the whole report. Screenshots and error-context.md on failure are kept.
test.use({ trace: "off" });

const CUSTOMER = customerFor("checkout");
const SERVER_LOG = fileURLToPath(new URL("../test-results/server.log", import.meta.url));
let customer = "";
let storeB = { masof: "" };

test.beforeAll(async ({ request }) => {
  markDemoDatabase();
  await ensureStoreBFixtures(request, CUSTOMER);
  await hyp.reset(request);
  await setupStoreTerminal(request, "storeB", await platformToken(request));
  setFlag("max_payments", true);
  customer = await accessToken(request, CUSTOMER);
  storeB = (await hyp.terminals(request)).storeB;
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

/** Exactly `n` e-mails about this order reached the customer (polls, then checks that no extra one follows) */
async function expectMails(
  request: APIRequestContext,
  since: number,
  n: number,
  orderNumber: string,
) {
  const count = async () => (await mailsTo(request, CUSTOMER.email, since, orderNumber)).length;
  await expect.poll(count, { timeout: 20_000 }).toBe(n);
  await new Promise((r) => setTimeout(r, 1_500));
  expect(await count()).toBe(n);
}

test("DM-PAY-4 (M03): the order is paid only after VERIFY with store B's own terminal; one e-mail", async ({
  request,
}) => {
  const since = Date.now();
  const placed = await order(request);
  const { reference, location } = await payToReturn(request, customer, placed.id);
  // on the payment page: nothing verified, nothing paid, no e-mail yet
  expect(lastAttempt(placed.id)).toMatchObject({ state: "redirected", applied: false });
  expect(await verifies(request, reference)).toHaveLength(0);
  expect(orderRow(placed.id).payment_status).toBe("awaiting");

  const back = await deliver(request, location);
  expect(back.status).toBe(303);
  expect(back.location).toBe(`/checkout/pay/${placed.id}?r=1`);
  expect(lastAttempt(placed.id)).toMatchObject({
    state: "test_paid",
    applied: true,
    terminal_number: storeB.masof,
  });
  expect(orderRow(placed.id)).toEqual({
    status: "pending",
    payment_method: "online",
    payment_status: "paid",
  });
  const verify = await verifies(request, reference);
  expect(verify.map((c) => [c.masof, c.result])).toEqual([[storeB.masof, "0"]]);
  // SIGN went to store B's terminal too, and never with an invoice / installments parameter
  const sign = await hyp.calls(request, { order: reference, action: "SIGN" });
  expect(sign.map((c) => [c.masof, c.result])).toEqual([[storeB.masof, "ok"]]);
  await expectMails(request, since, 1, placed.order_number);

  // the customer's status view: paid, and nothing of Hyp's secrets or the raw return in it
  const status = must(
    await call(request, FN.status, {
      host: STORE_B_HOST,
      token: customer,
      data: { orderId: placed.id },
    }),
    "payment status",
  );
  expect(JSON.stringify(status)).not.toMatch(/PassP|KEY=|signature|Sign=|Fild|bincard|Tmonth/);
});

test("DM-PAY-10: an unknown reference is recorded without VERIFY; the attempt that never came back is listed", async ({
  request,
}) => {
  const placed = await order(request);
  const { reference, location } = await payToReturn(request, customer, placed.id);
  const forged = tamper(rawOf(location), "Order", "f".repeat(32));
  const back = await deliver(request, location, { raw: forged });
  expect(back.status).toBe(303);
  expect(back.location).toBe("/checkout/pay/unknown");
  expect(unknownReturns(sha256(forged))).toBe(1);
  expect(await hyp.calls(request, { action: "VERIFY" })).toHaveLength(0);
  expect(lastAttempt(placed.id)?.state).toBe("redirected");
  // the genuine return still pays (the forged one took nothing from it)
  expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  expect(lastAttempt(placed.id)?.state).toBe("test_paid");
  expect((await verifies(request, reference)).length).toBe(1);

  // "sent to Hyp and never returned": signed, no return, its time is over → the platform admin's list
  const lost = await order(request);
  must(await startPayment(request, customer, lost.id), "start");
  ageAttempt(lastAttempt(lost.id)!.id, "tenant_attempts");
  expect(runAttemptExpiry()).toBeGreaterThanOrEqual(1);
  expect(lastAttempt(lost.id)?.state).toBe("expired");
  const view = must(
    await call<{ unreturned: { orderNumber: string | null }[] }>(request, FN.storePayments, {
      host: PLATFORM_HOST,
      token: await platformToken(request),
      data: { tenantId: STORE_B.id },
    }),
    "MAX tab of store B",
  );
  expect(view.unreturned.map((u) => u.orderNumber)).toContain(lost.order_number);
});

test("M04/M05: decline (no error URL) stays on the page; cancel; the attempt and then the order expire — stock back once", async ({
  request,
}) => {
  const stock0 = stockOf(PAY_PRODUCT.id);
  const placed = await order(request);
  const started = must(await startPayment(request, customer, placed.id), "start");
  const reference = orderOfPayUrl(started.url);
  const declined = await choose(request, started.url, "decline");
  expect([declined.status, declined.location]).toEqual([200, ""]);
  expect(declined.body).toContain(`data-testid="${HYP_PAGE_TESTIDS.status}"`);
  const cancelled = await choose(request, started.url, "cancel");
  expect([cancelled.status, cancelled.location]).toEqual([200, ""]);
  expect(lastAttempt(placed.id)?.state).toBe("redirected");
  expect(await verifies(request, reference)).toHaveLength(0);

  // back on the store after a cancel: paying again is allowed — the same attempt, no second one
  const again = must(await startPayment(request, customer, placed.id), "start again");
  expect(orderOfPayUrl(again.url)).toBe(reference);
  expect(tenantAttempts(placed.id)).toHaveLength(1);

  // 30 minutes later the DB job expires the attempt; the order still awaits (its window is 2 hours)
  ageAttempt(lastAttempt(placed.id)!.id, "tenant_attempts");
  expect(runAttemptExpiry()).toBeGreaterThanOrEqual(1);
  expect(lastAttempt(placed.id)?.state).toBe("expired");
  expect(orderRow(placed.id)).toMatchObject({ status: "pending", payment_status: "awaiting" });
  // the order's window ends: the existing expiry cancels it and returns the stock — exactly once
  expireOrderNow(placed.id);
  expect(orderRow(placed.id)).toMatchObject({ status: "cancelled", payment_status: "expired" });
  expect(stockOf(PAY_PRODUCT.id)).toBe(stock0);
  expireOrderNow(placed.id);
  runAttemptExpiry();
  expect(stockOf(PAY_PRODUCT.id)).toBe(stock0);
});

test("M09 (E7): a valid return after the order expired → for review (late); the order is not reopened, no e-mail", async ({
  request,
}) => {
  const since = Date.now();
  const placed = await order(request);
  const started = must(await startPayment(request, customer, placed.id), "start");
  ageAttempt(lastAttempt(placed.id)!.id, "tenant_attempts");
  runAttemptExpiry();
  expireOrderNow(placed.id);
  // the shopper pays on the page that was still open
  const approved = await choose(request, started.url, "approve");
  expect(approved.status).toBe(302);
  expect((await deliver(request, approved.location)).status).toBe(303);
  expect(lastAttempt(placed.id)).toMatchObject({
    state: "needs_review",
    review_reason: "late",
    applied: false,
  });
  expect(orderRow(placed.id)).toMatchObject({ status: "cancelled", payment_status: "expired" });
  await expectMails(request, since, 0, placed.order_number);
});

test("M07 + M06: a double click opens one attempt; paying a second page of it is a duplicate charge, not a second payment", async ({
  request,
}) => {
  const since = Date.now();
  const placed = await order(request);
  const ip = nextIp();
  const [one, two] = await Promise.all([
    startPayment(request, customer, placed.id, { ip }),
    startPayment(request, customer, placed.id, { ip }),
  ]);
  const a = must(one, "first click");
  const b = must(two, "second click");
  expect(orderOfPayUrl(a.url)).toBe(orderOfPayUrl(b.url));
  expect(tenantAttempts(placed.id)).toHaveLength(1);

  const first = await choose(request, a.url, "approve");
  expect((await deliver(request, first.location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  expect(lastAttempt(placed.id)?.state).toBe("test_paid");
  if (a.url !== b.url) {
    // the second signed page of the same attempt is paid too (Back + pay again): a person must refund it
    const second = await choose(request, b.url, "approve");
    expect(second.status).toBe(302);
    await deliver(request, second.location);
    expect(lastAttempt(placed.id)).toMatchObject({
      state: "test_paid",
      review_reason: "duplicate_charge",
    });
    // review M4: the second approved transaction is kept for the refund (never paid twice)
    expect(lastAttempt(placed.id)?.extra_txn_ids).toHaveLength(1);
  }
  expect(orderRow(placed.id).payment_status).toBe("paid");
  await expectMails(request, since, 1, placed.order_number);
});

test("M08 (E5): refreshing or replaying the return — 3× in a row and 5× at once — no second VERIFY, no second e-mail", async ({
  request,
}) => {
  const since = Date.now();
  const placed = await order(request);
  const { reference, location } = await payToReturn(request, customer, placed.id);
  expect((await deliver(request, location)).status).toBe(303);
  for (let i = 0; i < 3; i += 1) {
    expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  }
  const parallel = await Promise.all(Array.from({ length: 5 }, () => deliver(request, location)));
  expect(parallel.map((r) => r.status)).toEqual([303, 303, 303, 303, 303]);
  expect(await verifies(request, reference)).toHaveLength(1);
  expect(lastAttempt(placed.id)?.state).toBe("test_paid");
  await expectMails(request, since, 1, placed.order_number);
});

test("E4: a changed Amount / Order / CCode / Id / Coin is never paid; local rejections make no VERIFY; then the original pays", async ({
  request,
}) => {
  const placed = await order(request);
  const { reference, location } = await payToReturn(request, customer, placed.id);
  const raw = rawOf(location);
  const fail = "9901";
  for (const [key, value] of [
    ["Amount", "1.00"],
    ["Id", "700000000001"],
    ["Coin", "2"],
  ] as const) {
    const back = await deliver(request, location, { raw: tamper(raw, key, value) });
    expect(back.status, key).toBe(303);
    expect(lastAttempt(placed.id)?.state, key).toBe("returned");
    expect(orderRow(placed.id).payment_status, key).toBe("awaiting");
  }
  expect((await verifies(request, reference)).map((c) => c.result)).toEqual([fail, fail, fail]);
  // another reference: unknown → no VERIFY at all
  await deliver(request, location, { raw: tamper(raw, "Order", "e".repeat(32)) });
  // rejected by the parser before any DB write or VERIFY: duplicate key, reserved key, no Sign
  for (const variant of [
    `${raw}&Amount=1.00`,
    `${raw}&PassP=FAKEINJECTEDPASSP`,
    `${raw}&Masof=${storeB.masof}`,
    raw.replace(/&Sign=[0-9a-f]+/, ""),
  ]) {
    expect((await deliver(request, location, { raw: variant })).status).toBe(303);
  }
  expect(await verifies(request, reference)).toHaveLength(3);
  // X-11: the unsigned return is refused before any DB call — only the scope's log line records it
  if (existsSync(SERVER_LOG)) {
    expect(readFileSync(SERVER_LOG, "utf8")).toMatch(
      /\[pay:tenant\] return_refused why=no_signature/,
    );
  }
  // the untouched return pays exactly once
  expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  expect(lastAttempt(placed.id)).toMatchObject({ state: "test_paid", applied: true });

  // CCode: an authentic decline (error-URL terminal) changed to CCode=0 is not verified; the decline itself fails it
  const declined = await order(request);
  const started = must(await startPayment(request, customer, declined.id), "start");
  const declinedRef = orderOfPayUrl(started.url);
  await hyp.scenario(request, { target: `order:${declinedRef}`, page: "decline_redirect:4" });
  const dec = await choose(request, started.url, "decline");
  expect(dec.status).toBe(302);
  await deliver(request, dec.location, { raw: tamper(rawOf(dec.location), "CCode", "0") });
  expect(lastAttempt(declined.id)?.state).toBe("returned");
  await deliver(request, dec.location);
  expect(lastAttempt(declined.id)?.state).toBe("failed");
  expect(orderRow(declined.id).payment_status).toBe("awaiting");
});

test("DM-PAY-6 / DM-PAY-7: CCode 600/700/800/10, Hesh, HeshASM, HKId and MULTI → for review, never paid; Hesh=0 / empty → paid", async ({
  request,
}) => {
  test.setTimeout(120_000);
  const cases: [string, string | null][] = [
    ["hold_600", "unexpected_hold"],
    ["hold_700", "unexpected_hold"],
    ["hold_800", "unexpected_hold"],
    ["hold_10", "unexpected_hold"],
    ["hesh", "document_issued"],
    ["heshasm", "document_issued"],
    ["hkid", "unexpected_hold"],
    ["multi", "unexpected_hold"],
    ["hesh_zero", null],
    ["hesh_empty", null],
  ];
  for (const [page, reason] of cases) {
    const placed = await order(request);
    const { location } = await payToReturn(request, customer, placed.id, { page });
    expect((await deliver(request, location)).status, page).toBe(303);
    const a = lastAttempt(placed.id)!;
    if (reason) {
      expect([a.state, a.review_reason, a.applied], page).toEqual(["needs_review", reason, false]);
      expect(orderRow(placed.id).payment_status, page).toBe("awaiting");
      // review M3: the order is held while a person looks at the payment — the expiry job leaves it alone
      expect(paymentDueAt(placed.id), page).toBe("null");
      sql(`SELECT public.expire_unpaid_orders()`);
      expect(orderRow(placed.id), page).toMatchObject({
        status: "pending",
        payment_status: "awaiting",
      });
    } else {
      expect([a.state, a.applied], page).toEqual(["test_paid", true]);
    }
  }
});

test("DM-PAY-4: only a VERIFY body of exactly CCode=0 verifies (00, leading space, duplicate, HTML with CCode=0 do not)", async ({
  request,
}) => {
  const placed = await order(request);
  const { reference, location } = await payToReturn(request, customer, placed.id);
  for (const sw of ["ccode_00", "ccode_space", "ccode_dup", "html_with_ccode0"]) {
    await hyp.scenario(request, { target: `order:${reference}`, verify: sw, times: 1 });
    expect((await deliver(request, location)).status, sw).toBe(303);
    expect(lastAttempt(placed.id)?.state, sw).toBe("returned");
  }
  expect((await deliver(request, location)).status).toBe(303);
  expect(lastAttempt(placed.id)?.state).toBe("test_paid");
  expect(await verifies(request, reference)).toHaveLength(5);
});

test("M10 (E3): VERIFY times out, then Hyp drops the connection → still 'checking'; the replayed return pays once", async ({
  request,
}) => {
  test.setTimeout(90_000);
  const since = Date.now();
  const placed = await order(request);
  const { reference, location } = await payToReturn(request, customer, placed.id);
  await hyp.scenario(request, { target: `order:${reference}`, verify: "timeout", times: 1 });
  expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  expect(lastAttempt(placed.id)).toMatchObject({ state: "returned", applied: false });
  await hyp.scenario(request, { target: `order:${reference}`, verify: "reset", times: 1 });
  await deliver(request, location);
  expect(lastAttempt(placed.id)?.state).toBe("returned");
  const status = must(
    await call<{ attempt?: { state?: string } } | null>(request, FN.status, {
      host: STORE_B_HOST,
      token: customer,
      data: { orderId: placed.id },
    }),
    "status while checking",
  );
  expect(JSON.stringify(status)).not.toContain("test_paid");
  // the shopper refreshes the return (or the job re-verifies): VERIFY answers, the order is paid once
  await deliver(request, location);
  expect(lastAttempt(placed.id)).toMatchObject({ state: "test_paid", applied: true });
  await deliver(request, location);
  expect((await verifies(request, reference)).length).toBe(3);
  await expectMails(request, since, 1, placed.order_number);
});

test("NEW-E-LENIENT: even when VERIFY answers 0 for anything, a changed Amount or Coin is never paid", async ({
  request,
}) => {
  await hyp.scenario(request, { verify: "lenient" });
  for (const [key, value, reason] of [
    ["Amount", "0.50", "amount_mismatch"],
    ["Coin", "2", "currency_mismatch"],
  ] as const) {
    const placed = await order(request);
    const { location } = await payToReturn(request, customer, placed.id);
    await deliver(request, location, { raw: tamper(rawOf(location), key, value) });
    expect(lastAttempt(placed.id), key).toMatchObject({
      state: "needs_review",
      review_reason: reason,
      applied: false,
    });
    expect(orderRow(placed.id).payment_status, key).toBe("awaiting");
  }
  // every local check matches → paid (the mock's leniency changes nothing for a genuine return)
  const placed = await order(request);
  const { location } = await payToReturn(request, customer, placed.id);
  await deliver(request, location);
  expect(lastAttempt(placed.id)?.state).toBe("test_paid");
});

test("DM-SEC-4 (M03 in the browser): pay with the mock's buttons; pages, responses, storage and cookies hold no canary", async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const canaries = await runCanaries(request);
  expect(canaries.length).toBeGreaterThanOrEqual(8);
  // no extra browser header: Supabase's CORS would refuse it; the browser's own requests stay under the limits
  const context = await browser.newContext();
  const page = await context.newPage();
  const bodies: string[] = [];
  page.on("response", (res) => {
    const type = res.headers()["content-type"] ?? "";
    if (!/json|html|text|javascript|x-component/.test(type)) return;
    void res
      .text()
      .then((t) => bodies.push(t))
      .catch(() => undefined);
  });
  try {
    await login(page, storeUrl(STORE_B.slug), CUSTOMER);
    await page.goto(storeUrl(STORE_B.slug, `/product/${PAY_PRODUCT.id}`));
    await expect(page.locator('[data-price="hold"]')).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: "הוספה לסל" }).first().click();
    await page.goto(storeUrl(STORE_B.slug, "/checkout"));
    await expect(page.getByText(PAY_PRODUCT.name).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(TID.demoBanner)).toBeVisible();
    await page.locator("#co-name").fill("לקוח תשלום מקוון");
    await page.locator("#co-tax").fill("123456782");
    await page.locator("#co-phone").fill("0521234567");
    await page.locator("#co-city").fill("חיפה");
    await page.locator("#co-address").fill("הנמל 1");
    await page.locator("#co-zip").fill("3100000");
    await page.getByTestId(TID.payOnlineOption).click();
    await page.locator("#co-terms").check();
    await page.getByTestId(TID.checkoutSubmit).click();
    // the mock's hosted page: buttons only, no card field
    await expect(page.getByTestId(HYP_PAGE_TESTIDS.page)).toBeVisible({ timeout: 30_000 });
    expect(page.url().startsWith("http://127.0.0.1:4010/hyp/p/?")).toBe(true);
    await expect(page.locator("input, select, textarea")).toHaveCount(0);
    await page.getByTestId(HYP_PAGE_TESTIDS.approve).click();
    const pay = page.getByTestId(TID.payPage);
    await expect(pay).toHaveAttribute("data-stage", "paid", { timeout: 30_000 });
    // the result page's address carries none of Hyp's return parameters
    expect(page.url()).not.toMatch(/[?&](Sign|CCode|Order|Id|Amount)=/);
    const orderId = /\/checkout\/pay\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
    expect(lastAttempt(orderId)?.state).toBe("test_paid");

    await page.waitForTimeout(1_000);
    const state = JSON.stringify(await context.storageState());
    const session = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
    expect(findCanaries(state, canaries), "cookies + localStorage").toBe(0);
    expect(findCanaries(session, canaries), "sessionStorage").toBe(0);
    expect(findCanaries(bodies.join("\n"), canaries), "responses").toBe(0);
    expect(bodies.join("\n")).not.toMatch(/api_key_enc|api_password_enc|"KEY":|PassP=[^&\s"]/);
  } finally {
    await context.close();
  }
});

test("review M5: a variant sold in an online-paid order can still be removed in the product editor", async ({
  request,
}) => {
  const productId = "e2e0b000-0000-0000-0000-0000000000f2";
  sql(`INSERT INTO public.global_products (id, tenant_id, created_by, sku, name, category, description,
         price_tier1, price_tier2, price_tier3, stock_quantity)
       VALUES ('${productId}', '${STORE_B.id}', '${USERS.ownerB.id}', '90000192', 'מוצר וריאציות לתשלום מקוון',
               'קטגוריה של B', 'בדיקת M5', 11, 11, 11, 100)
       ON CONFLICT (id) DO UPDATE SET stock_quantity = GREATEST(public.global_products.stock_quantity, 100)`);
  const owner = await accessToken(request, USERS.ownerB);
  const { url, anonKey } = supabaseEnv();
  // the product editor's own call (AdminProductDialog → save_product_variants), as the store's admin
  const saveVariants = (values: string[]) =>
    request.post(`${url}/rest/v1/rpc/save_product_variants`, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${owner}`,
        "content-type": "application/json",
        "x-tenant-id": STORE_B.id,
      },
      data: {
        _product_id: productId,
        _attributes: [{ name: "צבע", values }],
        _variants: values.map((v) => ({ options: { צבע: v }, stock_quantity: 20 })),
      },
    });
  const created = await saveVariants(["אדום", "כחול"]);
  expect(created.ok(), await created.text()).toBe(true);
  const red = sql(`SELECT id FROM public.product_variants WHERE product_id = '${productId}'
                    AND options ->> 'צבע' = 'אדום'`);
  expect(red).toMatch(/^[0-9a-f-]{36}$/);

  const placed = await placeOnlineOrder(request, customer, CUSTOMER, 1, [
    { product_id: productId, variant_id: red, quantity: 1 },
  ]);
  const { location } = await payToReturn(request, customer, placed.id);
  await deliver(request, location);
  expect(orderRow(placed.id).payment_status).toBe("paid");
  const total = sql(`SELECT total FROM public.orders WHERE id = '${placed.id}'`);

  // the owner removes the sold variant: allowed; the paid order keeps its amount and lines (variant link cleared)
  const removed = await saveVariants(["כחול"]);
  expect(removed.ok(), await removed.text()).toBe(true);
  expect(sql(`SELECT count(*) FROM public.product_variants WHERE id = '${red}'`)).toBe("0");
  expect(
    sql(`SELECT COALESCE(variant_id::text, 'null') FROM public.order_items
          WHERE order_id = '${placed.id}' AND product_id = '${productId}'`),
  ).toBe("null");
  expect(sql(`SELECT total FROM public.orders WHERE id = '${placed.id}'`)).toBe(total);
  expect(orderRow(placed.id).payment_status).toBe("paid");
});
