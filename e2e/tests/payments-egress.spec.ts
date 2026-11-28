import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  markDemoDatabase,
  must,
  orderOfPayUrl,
  ownerToken,
  payToReturn,
  placeOnlineOrder,
  platformToken,
  setFlag,
  setupPlatformTerminal,
  setupStoreTerminal,
  STORE_B,
  STORE_B_HOST,
} from "./payments-helpers";

// MAX/Hyp DEMO — egress (DM-ENV-8). The app reaches Hyp only through the guarded local override: every SIGN / VERIFY
// of a full store payment, a full platform payment and both connection checks shows up in the mock's call log, with
// the right terminal, and nothing unexpected (no other action, no refused parameter, never the live-shaped
// terminal). The server says at start that its endpoint is the local mock. In CI the real Hyp host resolves only to
// loopback (tests.yml). Nothing here opens a connection to any Hyp host.
test.describe.configure({ retries: 0 });

const CUSTOMER = customerFor("egress");
const SERVER_LOG = fileURLToPath(new URL("../test-results/server.log", import.meta.url));

test("DM-ENV-8: every Hyp call of a store payment, a platform payment and both checks is in /__hyp/calls — nothing else", async ({
  request,
}) => {
  test.setTimeout(120_000);
  markDemoDatabase();
  await ensureStoreBFixtures(request, CUSTOMER);
  const admin = await platformToken(request);
  await hyp.reset(request);
  // the two connection checks (SIGN only, nothing charged) — inside the measured window
  await setupStoreTerminal(request, "storeB", admin);
  await setupPlatformTerminal(request, admin);
  setFlag("max_payments", true);
  const t = await hyp.terminals(request);
  try {
    // a store payment
    const customer = await accessToken(request, CUSTOMER);
    const placed = await placeOnlineOrder(request, customer, CUSTOMER);
    const store = await payToReturn(request, customer, placed.id);
    expect((await deliver(request, store.location)).status).toBe(303);
    // a platform payment
    const chargeId = createOpenCharge(
      STORE_B.id,
      5.55,
      `DEMO egress ${randomBytes(4).toString("hex")}`,
    );
    const started = must(
      await call<{ url: string }>(request, FN.payStart, {
        host: STORE_B_HOST,
        token: await ownerToken(request),
        data: { chargeId },
      }),
      "platform start",
    );
    const platformRef = orderOfPayUrl(started.url);
    const approved = await choose(request, started.url, "approve");
    expect((await deliver(request, approved.location)).status).toBe(303);

    const calls = await hyp.calls(request);
    const count = (action: string, masof: string, order?: string) =>
      calls.filter((c) => c.action === action && c.masof === masof && (!order || c.order === order))
        .length;
    // store: one connection check + one payment SIGN; one VERIFY — all with store B's terminal
    expect(count("SIGN", t.storeB.masof)).toBe(2);
    expect(count("SIGN", t.storeB.masof, store.reference)).toBe(1);
    expect(count("VERIFY", t.storeB.masof, store.reference)).toBe(1);
    // platform: one connection check + one payment SIGN; one VERIFY — all with NURIEL's terminal
    expect(count("SIGN", t.platform.masof)).toBe(2);
    expect(count("SIGN", t.platform.masof, platformRef)).toBe(1);
    expect(count("VERIFY", t.platform.masof, platformRef)).toBe(1);
    // nothing else: no other action, no refused parameter (9902), no unsupported action (9903), no unknown
    // terminal (902), never the live-shaped or store A's terminal, and SIGN / VERIFY only on the hosted-page path
    expect(calls.filter((c) => c.action === "OTHER")).toEqual([]);
    expect(calls.filter((c) => ["9902", "9903", "902", "904"].includes(c.result ?? ""))).toEqual(
      [],
    );
    const used = new Set(calls.map((c) => c.masof));
    expect(used.has(t.liveShaped.masof)).toBe(false);
    expect(used.has(t.storeA.masof)).toBe(false);
    expect(new Set(calls.map((c) => c.path))).toEqual(new Set(["/hyp/p/"]));
    // credentials travel only in SIGN / VERIFY requests (never in the browser's page request)
    for (const c of calls.filter((x) => x.action === "PAGE")) {
      expect([...c.query_keys, ...c.body_keys]).not.toContain("PassP");
      expect([...c.query_keys, ...c.body_keys]).not.toContain("KEY");
    }
  } finally {
    setFlag("max_payments", false);
    setFlag("platform_terminal_payments", false);
  }
});

test("DM-ENV-8: the server's startup line says DEMO + the local mock; in CI the real Hyp host resolves to loopback only", async () => {
  test.skip(
    !existsSync(SERVER_LOG),
    "server.log is written by app-up.sh when Playwright starts the server",
  );
  const log = readFileSync(SERVER_LOG, "utf8");
  expect(log).toMatch(/\[payments\] env=demo endpoint=local-mock tenant=ready platform=ready/);
  expect(log).not.toContain("endpoint=hyp");
  if (process.env["CI"]) {
    // /etc/hosts maps the name (tests.yml); this resolves locally and sends nothing to the host
    const addresses = (await lookup("pay.hyp.co.il", { all: true })).map((a) => a.address);
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.filter((a) => a !== "127.0.0.1" && a !== "::1")).toEqual([]);
  }
});
