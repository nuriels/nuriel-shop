import { expect, test } from "@playwright/test";
import { AUTH, hostGet, platformUrl } from "./helpers";
import {
  call,
  FN,
  hyp,
  markDemoDatabase,
  must,
  ownerToken,
  PLATFORM_HOST,
  platformPatch,
  platformToken,
  dropPlatformAdmin,
  ensurePlatformTerminal,
  extraPlatformAdmin,
  requestStepup,
  setFlag,
  sql,
  STORE_B_HOST,
  TID,
  timeTravel,
} from "./payments-helpers";

// MAX/Hyp DEMO — NURIEL's own terminal (DM-SEP-6). Only on the platform host, only for the platform admin, and only
// with an action-bound step-up code e-mailed to that admin (read here from the mail mock). A code works once, for the
// change it was issued for, within 10 minutes. Store hosts never reach these functions. retries 0.
test.describe.configure({ retries: 0 });
// No Playwright trace: a trace records every request and response — the mock's fake terminal credentials (canaries)
// and the raw signed returns these specs deliver — and CI's artifact scan would then (rightly) block the upload of
// the whole report. Screenshots and error-context.md on failure are kept.
test.use({ trace: "off" });

// The app allows 5 code requests per admin in 15 minutes: this spec spreads its codes over two admins of its own
type Admin = Awaited<ReturnType<typeof extraPlatformAdmin>>;
let admin = "";
let first: Admin;
let second: Admin;
let terminals: Awaited<ReturnType<typeof hyp.terminals>>;

test.beforeAll(async ({ request }) => {
  markDemoDatabase();
  await hyp.reset(request);
  admin = await platformToken(request);
  first = await extraPlatformAdmin(request, "stepup1");
  second = await extraPlatformAdmin(request, "stepup2");
  terminals = await hyp.terminals(request);
});

const codeFor = (
  request: Parameters<typeof call>[0],
  who: Admin,
  patch: unknown,
  freeQuota = true,
) =>
  requestStepup(request, who.token, patch, {
    actorId: who.id,
    email: who.account.email,
    freeQuota,
  });

test.beforeEach(async ({ request }) => {
  await hyp.reset(request);
});

test.afterAll(async ({ request }) => {
  // leave a working terminal behind for the other payment specs of the run
  await ensurePlatformTerminal(request, admin);
  setFlag("platform_terminal_payments", false);
  for (const who of [first, second]) if (who) dropPlatformAdmin(who.id);
});

const save = (
  request: Parameters<typeof call>[0],
  data: unknown,
  host = PLATFORM_HOST,
  token = first.token,
) =>
  call<{ status?: string; configured?: boolean; terminal_hint?: string }>(
    request,
    FN.terminalSave,
    {
      host,
      token,
      data,
    },
  );

test("DM-SEP-6: the terminal page lives on the platform host only", async ({
  browser,
  request,
}) => {
  expect((await hostGet(request, STORE_B_HOST, "/platform/payments")).status()).toBe(403);
  const ctx = await browser.newContext({ storageState: AUTH.platform });
  const page = await ctx.newPage();
  try {
    await page.goto(platformUrl("/platform/payments"));
    const card = page.getByTestId(TID.platformTerminal);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(TID.demoBanner)).toBeVisible();
    // write-only secrets: the form never shows a stored KEY / PassP
    const html = await page.content();
    expect(html).not.toContain(terminals.platform.key);
    expect(html).not.toContain(terminals.platform.passp);
  } finally {
    await ctx.close();
  }
});

test("DM-SEP-6: saving needs the e-mailed code; the status shows only a 2-digit hint", async ({
  request,
}) => {
  const patch = platformPatch(terminals.platform);
  // no code → refused, nothing saved
  const before = sql(
    `SELECT credentials_updated_at FROM payments.platform_accounts WHERE provider = 'max'`,
  );
  expect(
    (
      await save(request, {
        patch,
        challengeId: "00000000-0000-0000-0000-000000000000",
        code: "123456",
      })
    ).ok,
  ).toBe(false);
  expect(
    sql(`SELECT credentials_updated_at FROM payments.platform_accounts WHERE provider = 'max'`),
  ).toBe(before);
  // with the code from the e-mail → saved
  const { challengeId, code } = await codeFor(request, first, patch);
  must(await save(request, { patch, challengeId, code }), "save with the e-mailed code");
  const status = must(
    await call<Record<string, unknown>>(request, FN.terminalStatus, {
      host: PLATFORM_HOST,
      token: admin,
    }),
    "status",
  );
  const text = JSON.stringify(status);
  expect(text).toMatch(/[*•]+01/);
  expect(text).not.toContain(terminals.platform.masof);
  expect(text).not.toContain(terminals.platform.key);
  expect(text).not.toContain(terminals.platform.passp);
  // ciphertext only in the DB (sealed by the app), never the canary itself
  expect(
    sql(`SELECT count(*) FROM payments.platform_accounts
               WHERE api_key_enc LIKE 'v1:%' AND api_password_enc LIKE 'v1:%'`),
  ).toBe("1");
  expect(
    sql(`SELECT count(*) FROM payments.platform_accounts
               WHERE api_key_enc LIKE '%${terminals.platform.key}%'`),
  ).toBe("0");
});

test("DM-SEP-6: a wrong, reused, expired or superseded code is refused; a code for one change cannot save another", async ({
  request,
}) => {
  test.setTimeout(90_000);
  const patch = platformPatch(terminals.platform);
  // wrong code
  const wrong = await codeFor(request, first, patch);
  const other = wrong.code === "000000" ? "111111" : "000000";
  expect((await save(request, { patch, challengeId: wrong.challengeId, code: other })).ok).toBe(
    false,
  );
  // reused code: the first save works, the same challenge never again
  const once = await codeFor(request, first, patch);
  must(await save(request, { patch, challengeId: once.challengeId, code: once.code }), "first use");
  expect((await save(request, { patch, challengeId: once.challengeId, code: once.code })).ok).toBe(
    false,
  );
  // expired: the code's 10 minutes have passed (test-only clock move on that one challenge)
  const late = await codeFor(request, first, patch);
  timeTravel(`UPDATE payments.platform_stepup_challenges
                 SET created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes'
               WHERE id = '${late.challengeId}'`);
  expect((await save(request, { patch, challengeId: late.challengeId, code: late.code })).ok).toBe(
    false,
  );
  // superseded: asking for a new code cancels the previous one
  const older = await codeFor(request, second, patch);
  await codeFor(request, second, patch, false);
  expect(
    (
      await save(
        request,
        { patch, challengeId: older.challengeId, code: older.code },
        PLATFORM_HOST,
        second.token,
      )
    ).ok,
  ).toBe(false);
  // bound to the change: a code issued to switch the terminal off cannot save new credentials
  const off = await codeFor(request, second, platformPatch(terminals.platform, { enabled: false }));
  const changed = platformPatch(terminals.platform, { apiKey: `${terminals.platform.key}X` });
  expect(
    (
      await save(
        request,
        { patch: changed, challengeId: off.challengeId, code: off.code },
        PLATFORM_HOST,
        second.token,
      )
    ).ok,
  ).toBe(false);
});

test("DM-SEP-6: store hosts and non-admins never reach the terminal functions", async ({
  request,
}) => {
  const patch = platformPatch(terminals.platform);
  for (const fn of [FN.terminalStatus, FN.terminalRequestCode, FN.terminalTest, FN.cardPayments]) {
    expect(
      (await call(request, fn, { host: STORE_B_HOST, token: admin, data: { patch } })).ok,
      fn.name,
    ).toBe(false);
  }
  const owner = await ownerToken(request);
  for (const fn of [FN.terminalStatus, FN.terminalRequestCode, FN.terminalTest]) {
    expect(
      (await call(request, fn, { host: PLATFORM_HOST, token: owner, data: { patch } })).ok,
      fn.name,
    ).toBe(false);
    expect(
      (await call(request, fn, { host: PLATFORM_HOST, data: { patch } })).ok,
      `${fn.name} anon`,
    ).toBe(false);
  }
  // a valid code of the platform admin is useless on a store host
  const { challengeId, code } = await codeFor(request, second, patch);
  expect((await save(request, { patch, challengeId, code }, STORE_B_HOST, second.token)).ok).toBe(
    false,
  );
  expect((await save(request, { patch, challengeId, code }, PLATFORM_HOST, owner)).ok).toBe(false);
  // no refused call reached Hyp
  expect(await hyp.calls(request, { action: "SIGN" })).toEqual([]);
});
