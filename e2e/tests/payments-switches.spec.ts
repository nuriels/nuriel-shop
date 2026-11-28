import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  accessToken,
  call,
  choose,
  createOpenCharge,
  customerFor,
  deliver,
  ensureStoreBFixtures,
  FN,
  hyp,
  lastAttempt,
  markDemoDatabase,
  must,
  ownerToken,
  payToReturn,
  placeOnlineOrder,
  PLATFORM_HOST,
  platformToken,
  providerRowsForCharge,
  setFlag,
  ensurePlatformTerminal,
  setupStoreTerminal,
  startPayment,
  STORE_B,
  STORE_B_HOST,
} from "./payments-helpers";

// MAX/Hyp DEMO — kill switches (DM-ENV-6). Turning a switch off stops NEW attempts within the 15-second flag cache;
// a payment already on its way back is still verified and settled (money may have moved). retries 0.
test.describe.configure({ retries: 0 });

const CUSTOMER = customerFor("switches");
const SWITCH_MS = 15_000;
let customer = "";
let owner = "";
let admin = "";

test.beforeAll(async ({ request }) => {
  markDemoDatabase();
  await ensureStoreBFixtures(request, CUSTOMER);
  await hyp.reset(request);
  admin = await platformToken(request);
  await setupStoreTerminal(request, "storeB", admin);
  await ensurePlatformTerminal(request, admin);
  setFlag("max_payments", true);
  customer = await accessToken(request, CUSTOMER);
  owner = await ownerToken(request);
});

test.beforeEach(async ({ request }) => {
  await hyp.reset(request);
});

test.afterAll(() => {
  setFlag("max_payments", false);
  setFlag("platform_terminal_payments", false);
});

/** Polls until `refused()` is true; returns the milliseconds it took (fails after the cache window + margin) */
async function untilRefused(refused: () => Promise<boolean>): Promise<number> {
  const t0 = Date.now();
  await expect.poll(refused, { timeout: SWITCH_MS + 5_000, intervals: [500] }).toBe(true);
  return Date.now() - t0;
}

test("DM-ENV-6: the store switch (max_payments) stops new attempts within 15 s; a return in flight is still verified", async ({
  request,
}) => {
  test.setTimeout(90_000);
  const inFlight = await placeOnlineOrder(request, customer, CUSTOMER);
  const { location } = await payToReturn(request, customer, inFlight.id);
  const waiting = await placeOnlineOrder(request, customer, CUSTOMER);
  setFlag("max_payments", false);
  try {
    const took = await untilRefused(
      async () => !(await startPayment(request, customer, waiting.id)).ok,
    );
    expect(took).toBeLessThanOrEqual(SWITCH_MS + 1_000);
    const options = must(
      await call<{ available: boolean }>(request, FN.options, {
        host: STORE_B_HOST,
        token: customer,
      }),
      "checkout options",
    );
    expect(options.available).toBe(false);
    // the shopper who already paid comes back: verified with store B's terminal and settled
    expect((await deliver(request, location)).location).toBe(`/checkout/pay/${inFlight.id}?r=1`);
    expect(lastAttempt(inFlight.id)?.state).toBe("test_paid");
  } finally {
    setFlag("max_payments", true);
  }
  // switched back on: payments start again
  await expect
    .poll(async () => (await startPayment(request, customer, waiting.id)).ok, {
      timeout: SWITCH_MS + 5_000,
      intervals: [500],
    })
    .toBe(true);
});

test("DM-ENV-6: the store's own terminal switch (enabled = false) stops new attempts; returns are still verified", async ({
  request,
}) => {
  test.setTimeout(90_000);
  const inFlight = await placeOnlineOrder(request, customer, CUSTOMER);
  const { location } = await payToReturn(request, customer, inFlight.id);
  const waiting = await placeOnlineOrder(request, customer, CUSTOMER);
  must(
    await call(request, FN.saveStoreTerminal, {
      host: PLATFORM_HOST,
      token: admin,
      data: { tenantId: STORE_B.id, enabled: false },
    }),
    "switch store B's terminal off",
  );
  try {
    await untilRefused(async () => !(await startPayment(request, customer, waiting.id)).ok);
    expect((await deliver(request, location)).status).toBe(303);
    expect(lastAttempt(inFlight.id)?.state).toBe("test_paid");
  } finally {
    await setupStoreTerminal(request, "storeB", admin);
  }
});

test("DM-ENV-6: the platform switch stops new platform attempts within 15 s; a return in flight still writes its row", async ({
  request,
}) => {
  test.setTimeout(90_000);
  const stamp = randomBytes(4).toString("hex");
  const inFlight = createOpenCharge(STORE_B.id, 9.9, `DEMO switch a ${stamp}`);
  const waiting = createOpenCharge(STORE_B.id, 9.8, `DEMO switch b ${stamp}`);
  const started = must(
    await call<{ url: string }>(request, FN.payStart, {
      host: STORE_B_HOST,
      token: owner,
      data: { chargeId: inFlight },
    }),
    "start",
  );
  const approved = await choose(request, started.url, "approve");
  setFlag("platform_terminal_payments", false);
  try {
    const took = await untilRefused(
      async () =>
        !(
          await call(request, FN.payStart, {
            host: STORE_B_HOST,
            token: owner,
            data: { chargeId: waiting },
          })
        ).ok,
    );
    expect(took).toBeLessThanOrEqual(SWITCH_MS + 1_000);
    expect((await deliver(request, approved.location)).status).toBe(303);
    expect(providerRowsForCharge(inFlight)).toBe(1);
    expect(providerRowsForCharge(waiting)).toBe(0);
  } finally {
    setFlag("platform_terminal_payments", true);
  }
});
