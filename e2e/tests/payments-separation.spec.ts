import { randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
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
  orderOfPayUrl,
  orderRow,
  ownerToken,
  payToReturn,
  placeOnlineOrder,
  PLATFORM_HOST,
  PLATFORM_RETURN_PATH,
  platformAttempts,
  platformToken,
  providerRowsForCharge,
  rawOf,
  setFlag,
  setupPlatformTerminal,
  setupStoreTerminal,
  sha256,
  STORE_A_HOST,
  STORE_B,
  STORE_B_HOST,
  TENANT_RETURN_PATH,
  unknownReturns,
} from "./payments-helpers";

// MAX/Hyp DEMO — separation (DM-SEP-4, DM-SEP-5). A return is looked up only in its own scope's table and only for
// the store of the host it arrived on; anything else is answered like an unknown reference and NEVER reaches VERIFY
// (no terminal's credentials are used for a return that is not theirs). Store B is the payer; store A — the default
// store kobi, which an unknown host falls back to — is the other store.
test.describe.configure({ retries: 0 });

const CUSTOMER = customerFor("separation");
let customer = "";
let owner = "";
let terminals: Awaited<ReturnType<typeof hyp.terminals>>;

test.beforeAll(async ({ request }) => {
  markDemoDatabase();
  await ensureStoreBFixtures(request, CUSTOMER);
  await hyp.reset(request);
  const admin = await platformToken(request);
  await setupStoreTerminal(request, "storeB", admin);
  await setupPlatformTerminal(request, admin);
  setFlag("max_payments", true);
  customer = await accessToken(request, CUSTOMER);
  owner = await ownerToken(request);
  terminals = await hyp.terminals(request);
});

test.beforeEach(async ({ request }) => {
  await hyp.reset(request);
});

test.afterAll(() => {
  setFlag("max_payments", false);
  setFlag("platform_terminal_payments", false);
});

const noVerify = async (request: APIRequestContext, reference: string) =>
  expect(await hyp.calls(request, { order: reference, action: "VERIFY" })).toEqual([]);

/** A store-B order taken to the mock and approved: the return URL, not delivered yet */
async function storeReturn(request: APIRequestContext) {
  const placed = await placeOnlineOrder(request, customer, CUSTOMER);
  return { placed, ...(await payToReturn(request, customer, placed.id)) };
}

/** An open charge of store B, started by its owner and approved on the mock: the platform return, not delivered */
async function platformReturn(request: APIRequestContext) {
  const chargeId = createOpenCharge(
    STORE_B.id,
    12.34,
    `DEMO sep ${randomBytes(4).toString("hex")}`,
  );
  const started = must(
    await call<{ url: string }>(request, FN.payStart, {
      host: STORE_B_HOST,
      token: owner,
      data: { chargeId },
    }),
    "start the platform payment",
  );
  const reference = orderOfPayUrl(started.url);
  const approved = await choose(request, started.url, "approve");
  expect(approved.status).toBe(302);
  expect(approved.location.startsWith(`http://${PLATFORM_HOST}:3100${PLATFORM_RETURN_PATH}?`)).toBe(
    true,
  );
  return { chargeId, reference, location: approved.location };
}

test("DM-SEP-4: a store return delivered to the platform host is refused on both routes — no VERIFY", async ({
  request,
}) => {
  const { placed, reference, location } = await storeReturn(request);
  // the store route on the platform host: not served there (no DB lookup, no VERIFY)
  const onStoreRoute = await deliver(request, location, { host: PLATFORM_HOST });
  expect(onStoreRoute.status).toBe(404);
  // the platform route: the reference is not a platform attempt → unknown, recorded without PII
  const onPlatformRoute = await deliver(request, location, {
    host: PLATFORM_HOST,
    path: PLATFORM_RETURN_PATH,
  });
  expect(onPlatformRoute.status).toBe(303);
  expect(unknownReturns(sha256(rawOf(location)))).toBeGreaterThanOrEqual(1);
  await noVerify(request, reference);
  expect(lastAttempt(placed.id)?.state).toBe("redirected");
  // delivered where it belongs it pays, verified with store B's own terminal
  expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  const verify = await hyp.calls(request, { order: reference, action: "VERIFY" });
  expect(verify.map((c) => c.masof)).toEqual([terminals.storeB.masof]);
  expect(orderRow(placed.id).payment_status).toBe("paid");
});

test("DM-SEP-4: a platform return delivered to a store host is refused — no VERIFY, no ledger row", async ({
  request,
}) => {
  const { chargeId, reference, location } = await platformReturn(request);
  const onStoreRoute = await deliver(request, location, {
    host: STORE_B_HOST,
    path: TENANT_RETURN_PATH,
  });
  expect(onStoreRoute.status).toBe(303);
  expect(onStoreRoute.location).toBe("/checkout/pay/unknown");
  // the platform route does not exist on a store host (storeGate answers 403 for /platform/*)
  const onPlatformPath = await deliver(request, location, { host: STORE_B_HOST });
  expect(onPlatformPath.status).toBe(403);
  await noVerify(request, reference);
  expect(providerRowsForCharge(chargeId)).toBe(0);
  expect(platformAttempts(chargeId).map((a) => a.state)).toEqual(["redirected"]);
  // on the platform host it is verified with NURIEL's terminal — never a store's
  const back = await deliver(request, location);
  expect(back.status).toBe(303);
  const verify = await hyp.calls(request, { order: reference, action: "VERIFY" });
  expect(verify.map((c) => c.masof)).toEqual([terminals.platform.masof]);
  expect(providerRowsForCharge(chargeId)).toBe(1);
});

test("DM-SEP-5: store B's return at store A's host is refused — no VERIFY; at B's host it pays", async ({
  request,
}) => {
  const { placed, reference, location } = await storeReturn(request);
  const onA = await deliver(request, location, { host: STORE_A_HOST });
  expect(onA.status).toBe(303);
  expect(onA.location).toBe("/checkout/pay/unknown");
  await noVerify(request, reference);
  expect(lastAttempt(placed.id)?.state).toBe("redirected");
  expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  expect(lastAttempt(placed.id)?.state).toBe("test_paid");
});

test("DM-SEP-5: a return on an unknown host — which falls back to the default store (A) — is refused, no VERIFY", async ({
  request,
}) => {
  const { placed, reference, location } = await storeReturn(request);
  // localhost / an IP resolve to the default store kobi (= store A); an unknown subdomain or domain is "store not found"
  for (const host of ["localhost", "127.0.0.1", "no-such-store.shop.localhost", "evil.example"]) {
    const back = await deliver(request, location, { host });
    expect([303, 404], host).toContain(back.status);
    if (back.status === 303) expect(back.location, host).toBe("/checkout/pay/unknown");
    expect(lastAttempt(placed.id)?.state, host).toBe("redirected");
  }
  await noVerify(request, reference);
  expect(orderRow(placed.id).payment_status).toBe("awaiting");
  expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  expect(lastAttempt(placed.id)?.state).toBe("test_paid");
});

test("DM-SEP-4/5: a return signed by another fake terminal (store A) for store B's reference is never paid", async ({
  request,
}) => {
  const { placed, reference, location } = await storeReturn(request);
  // the forgery: store A's terminal signs a page with store B's reference and amount (any Hyp terminal holder could)
  const amount = new URL(location).searchParams.get("Amount") ?? "";
  const a = terminals.storeA;
  const signed = await (
    await request.get(`http://127.0.0.1:4010/hyp/p/`, {
      params: {
        action: "APISign",
        What: "SIGN",
        Masof: a.masof,
        KEY: a.key,
        PassP: a.passp,
        Amount: amount,
        Coin: "1",
        Order: reference,
        Sign: "True",
        MoreData: "True",
      },
    })
  ).text();
  const forged = await choose(request, `http://127.0.0.1:4010/hyp/p/?${signed}`, "approve");
  expect(forged.status).toBe(302);
  // delivered on store B's host with store B's reference: VERIFY with store B's terminal → not verified
  await deliver(request, forged.location, { host: STORE_B_HOST, path: TENANT_RETURN_PATH });
  expect(lastAttempt(placed.id)).toMatchObject({ applied: false });
  expect(lastAttempt(placed.id)?.state).not.toMatch(/paid/);
  const verify = await hyp.calls(request, { order: reference, action: "VERIFY" });
  expect(verify.map((c) => [c.masof, c.result])).toEqual([[terminals.storeB.masof, "9901"]]);
  // the genuine return still pays
  expect((await deliver(request, location)).location).toBe(`/checkout/pay/${placed.id}?r=1`);
  expect(lastAttempt(placed.id)?.state).toBe("test_paid");
});
