// ============================================================
// FAKE — not issued by Hyp. Everything in this file is invented for the local / CI mock of Hyp Pay
// (e2e/scripts/mock-hyp.mjs). No real terminal, credential, card value or published Hyp test value
// appears here, and nothing here is ever sent to a Hyp host.
//   • Terminals: 10-digit numbers. The first three carry the documented test prefix 00100; the fourth
//     is "live-shaped" (no test prefix) and exists only to test the mode rules (DEMO refuses it).
//   • KEY / PassP: canaries, unique per E2E run (built from the run id that app-up.sh generates), so
//     the leak scanners can search for them. app-up.sh writes them to e2e/test-results/hyp-canaries.txt.
//   • Return values: sentinels (scan-able where the field format allows), never real card data.
// This is the only file that declares Hyp fakes — the repository scanner allow-lists exactly these.
// ============================================================
import { STORE_A, STORE_B } from "./data.mjs";

export const HYP_FAKE_NOTICE = "FAKE — not issued by Hyp (E2E mock only)";

/** The mock's address (= MAX_PAY_TEST_URL in e2e/scripts/app-up.sh) */
export const HYP_MOCK_ORIGIN = "http://127.0.0.1:4010";
export const HYP_MOCK_BASE = `${HYP_MOCK_ORIGIN}/hyp/p/`;

/** The E2E hosts (app-up.sh: TENANT_BASE_DOMAIN=shop.localhost, PLATFORM_ADMIN_HOST=platform.shop.localhost, PORT=3100) */
const STORE_ORIGIN = (slug) => `http://${slug}.shop.localhost:3100`;
const PLATFORM_ORIGIN = "http://platform.shop.localhost:3100";
/** Return routes (contract §2): store hosts → /payments/return/max; platform host → /platform/payments/return/max */
const STORE_RETURN = (slug) => `${STORE_ORIGIN(slug)}/payments/return/max`;
const PLATFORM_RETURN = `${PLATFORM_ORIGIN}/platform/payments/return/max`;

/**
 * FAKE terminals (decision ה-2: platform, store A, store B; plus one live-shaped). `successUrl` is what
 * the terminal's "portal" would hold. No terminal has an error URL (decision D-T6): a decline stays on
 * the mock page unless a test sets the `decline_redirect` page switch.
 */
export const HYP_FAKE_TERMINALS = Object.freeze({
  platform: Object.freeze({
    label: "platform",
    code: "PL",
    scope: "platform",
    tenantSlug: null,
    masof: "0010090001",
    successUrl: PLATFORM_RETURN,
  }),
  storeA: Object.freeze({
    label: "storeA",
    code: "SA",
    scope: "tenant",
    tenantSlug: STORE_A.slug,
    masof: "0010090002",
    successUrl: STORE_RETURN(STORE_A.slug),
  }),
  storeB: Object.freeze({
    label: "storeB",
    code: "SB",
    scope: "tenant",
    tenantSlug: STORE_B.slug,
    masof: "0010090003",
    successUrl: STORE_RETURN(STORE_B.slug),
  }),
  liveShaped: Object.freeze({
    label: "liveShaped",
    code: "LV",
    scope: "tenant",
    tenantSlug: STORE_B.slug,
    masof: "7770090004",
    successUrl: STORE_RETURN(STORE_B.slug),
  }),
});

/** The documented test-terminal prefix ("their numbers always start with 00100") */
export const HYP_TEST_PREFIX = "00100";

const RUN_ID = /^[0-9a-z]{6,32}$/;

/**
 * The run's fake credentials per terminal label. `runId` comes from app-up.sh (HYP_MOCK_RUN_ID).
 * @param {string} runId
 */
export function hypFakeCredentials(runId) {
  if (!RUN_ID.test(String(runId))) throw new Error("hyp-fake: the run id must be 6-32 of [0-9a-z]");
  /** @param {{ code: string, masof: string }} t */
  const of = (t) =>
    Object.freeze({
      masof: t.masof,
      key: `FAKEKEY${t.code}${runId}`,
      passp: `FAKEPASSP${t.code}${runId}`,
    });
  const T = HYP_FAKE_TERMINALS;
  return Object.freeze({
    platform: of(T.platform),
    storeA: of(T.storeA),
    storeB: of(T.storeB),
    liveShaped: of(T.liveShaped),
  });
}

/**
 * Every KEY / PassP canary of the run (one string each), for e2e/test-results/hyp-canaries.txt
 * @param {string} runId
 */
export function hypCanaries(runId) {
  return Object.values(hypFakeCredentials(runId)).flatMap((c) => [c.key, c.passp]);
}

/**
 * Sentinel values the mock puts in an approved return (MoreData and the base fields). Formats are
 * mock assumptions (Hyp documents the names, not the formats). `UID`, `UserId` and `bincard` are
 * long enough to search for; the app must never keep them outside the encrypted raw return.
 * `UserId` deliberately fails the Israeli ID checksum.
 */
export const HYP_SENTINELS = Object.freeze({
  ACode: "0909090",
  L4digit: "0019",
  Brand: "2",
  Issuer: "6",
  Bank: "6",
  TransType: "Internet-Secure",
  Payments: "1",
  Tmonth: "11",
  Tyear: "2031",
  UID: "E2EUIDSENTINEL19",
  UserId: "990177002",
  bincard: "990155",
  Hesh: "900017",
  HeshASM: "900018",
  HKId: "770017",
  MULTI: "1",
  /** Value of the PassP the `extra_secret_param` switch appends to a return (not a canary) */
  injectedPassP: "FAKEINJECTEDPASSP",
});

/** Sentinels to search for in logs, the DB and artifacts */
export const HYP_SCAN_SENTINELS = Object.freeze([
  HYP_SENTINELS.UID,
  HYP_SENTINELS.UserId,
  HYP_SENTINELS.bincard,
]);

/** Fixed Hebrew text the `win1255` / `utf8` page switches put in Fild1 (and Info) */
export const HYP_HEBREW_TEXT = "לקוח בדיקה";

/** Mock-only result codes (outside Hyp's documented lists), so a test can tell them apart */
export const HYP_MOCK_CODES = Object.freeze({
  /** VERIFY: anything changed, reordered, re-encoded, another terminal, or an unknown transaction */
  verifyMismatch: "9901",
  /** SIGN: a parameter DEMO never sends (invoice, installments, J5/postpone, HK, UserId, sendemail) */
  forbiddenParam: "9902",
  /** Any action the mock does not implement (refunds, cancel, tokens, payment links, …) */
  unsupported: "9903",
});

/** data-testid values on the mock hosted page */
export const HYP_PAGE_TESTIDS = Object.freeze({
  page: "hyp-mock-page",
  amount: "hyp-amount",
  approve: "hyp-approve",
  decline: "hyp-decline",
  cancel: "hyp-cancel",
  status: "hyp-status",
  error: "hyp-error",
});
