# 05 — Testing and payment scenarios for the MAX/Hyp DEMO stage

Status: COMPLETE (2026-11-27). Role: testing and payment-scenarios agent. Planning only — no repository file was changed, no test suite, app or build was run, and no request was sent to any Hyp payment/API host. No card number, terminal number or credential appears in this file; Hyp's test cards are referenced only by their official page.

Legend: (a) = runs in the DEMO stage; (b) = designed now, run later (refunds, production); (c) = out of scope.

**Summary.**
1. The DEMO stage has two test levels: (a1) automated, local and CI, against a deterministic mock Hyp server (§1) — this must be fully green first; (a2) manual, against Hyp's real **test** environment from a non-production NURIEL instance, only after written approval (§4).
2. The mock extends `e2e/scripts/mock-services.mjs` with SIGN, VERIFY, a hosted page without card fields, per-terminal fake terminals for store A, store B and the platform, and scenario switches; later CancelTrans/zikoyAPI. The app reaches it only through a loopback-only override, and CI also blackholes the real Hyp host.
3. Separation is tested at every layer (§3): one terminal per scope, credentials resolved by scope, separate return routes and hosts, separate settle functions, and provider ledger rows written only by the platform settle.
4. Five existing facts shape the tests: store A is the default tenant (hides fallbacks), the billing ledger cannot be cleaned and one test asserts it holds no provider row, `NODE_ENV=production` in E2E, server logs are discarded, and the ledger has no unique key for provider payments.
5. Refunds stay (b): Hyp documents nothing about refunds on test terminals, and `zikoyAPI` needs a settled transaction.

Out of scope (c) for this stage: production runs or charges, any production migration or deploy, invoices/receipts (in-house or SmartBee), tokens, recurring charges, J5/postpone, iframe, wallets/bit/3DS (production-only per Hyp), Hyp Enterprise.

## 1. Mock Hyp server design

Baseline facts (read directly): the mock today records every request at `GET /__calls` (`e2e/scripts/mock-services.mjs:174-177,185-190`) and answers every unknown path, including all payment paths, with 503 "payments are mocked in e2e" (`:224-225`). `app-up.sh` starts it on 127.0.0.1:4010 (`e2e/scripts/app-up.sh:41`) and points Resend, AI and Grow at it (`:15,17,23`). The server runs with `NODE_ENV=production` in E2E (`app-up.sh:27`). Playwright discards server stdout (`e2e/playwright.config.ts:55`) and retries once in CI (`:22`).

### 1.1 Shape (a)

| Item | Design |
|---|---|
| Where | New module `e2e/scripts/mock-hyp.mjs`, imported by `mock-services.mjs` and dispatched **before** the 503 fallback (`:224`). Same process and port (4010), so `app-up.sh` needs no new process. The Grow 503 path stays exactly as is (R3 relies on it). |
| Namespace | Everything under `/hyp/…` (the app's base URL becomes `http://127.0.0.1:4010/hyp/p/`); control endpoints under `/__hyp/…`. |
| Fake terminal registry | Declared once in `e2e/fixtures/data.mjs` as `HYP_FAKE` and marked "FAKE — not issued by Hyp": `<FAKE_TERMINAL_STORE_A>` (tenant, kobi), `<FAKE_TERMINAL_STORE_B>` (tenant, store-b), `<FAKE_TERMINAL_PLATFORM>` (platform), `<FAKE_TERMINAL_LIVE_SHAPED>` (a number without the documented test prefix, used only to test mode rules). Each has a fake `KEY`/`PassP` **canary** string (unique, so leak scans can find it), its success URL (store host or platform host return path) and an optional error URL. Values are never copied into docs; U18 allow-lists exactly these. |
| Determinism | No randomness inside the mock. Per-terminal signing secret = HMAC of a fixed seed and the terminal id (known only to the mock, never to the app). `signature` and `Sign` = HMAC-SHA256 over the canonical parameter string. Transaction `Id` = per-process counter from a fixed base; `ACode` = fixed fake per scenario. The only random value is our own `Order` reference, which the app generates. |
| Card data | The mock hosted page has **no card fields** — buttons only. Tests never type a card number anywhere. |
| Call log | Hyp calls go into the existing `calls` list (`:185-190`) so existing specs keep working; a filtered `GET /__hyp/calls?order=<ref>&action=<SIGN or VERIFY or …>` returns `{method, path, query_keys, body_keys, masof}` to assert routing (which terminal was used, POST vs GET) without parsing raw bodies. |
| Reset | `POST /__hyp/reset` clears scenarios, issued pages and counters; every MAX spec calls it in `beforeEach`. |

### 1.2 Endpoints and documented behaviour (a)

| Request | Mock response | Basis |
|---|---|---|
| `action=APISign&What=SIGN` (GET or POST) with known `Masof` + matching `KEY`/`PassP` | 200 `text/plain`: every received parameter except `KEY`/`PassP`, `action` changed to `pay`, `signature=<64 hex>` appended (ASCII key order, as observed in the docs example; the app must not depend on the order). Issued page stored in memory (terminal, params, `MoreData`). | `pay/reference/actions` "returns a URL-encoded string containing all parameters and a `signature`"; "`action` … changes to `pay`" |
| SIGN, wrong `PassP` / unknown `Masof` | `CCode=902` | same page, SIGN status codes: "`902` Authentication failure: wrong `PassP`" |
| SIGN without `What` | `CCode=904` | "`904` Missing `What` parameter" |
| Browser `GET /hyp/p/?action=pay…&signature=…` | Signature unknown or any parameter changed → HTML error page, no redirect. Otherwise an RTL HTML page with `data-testid` buttons: approve / decline / cancel. API specs append `&__choice=approve` (or `decline`, `cancel`) to get the 302 directly. | `pay/getting-started/creating-a-payment-page` "append the entire response to `https://pay.hyp.co.il/p/?`" |
| Approve | 302 to that terminal's success URL with `Id, CCode=0, Amount, ACode, Order, Fild1, Fild2, Fild3, Sign`; with `MoreData=True` also `Coin, Payments, L4digit, Brand, Issuer, UID, Tmonth, Tyear, bincard, UserId, Bank, TransType` carrying **sentinel** values declared in the fixture (scan-able, never a published test value). | creating-a-payment-page redirect example; MoreData table in `pay/reference/actions` |
| Decline, terminal **without** error URL | Stays on the mock page with an error; no redirect (the documented default) | `prerequisites-and-initial-setup`: "we recommend **configuring only the success URL**" |
| Decline, terminal **with** error URL | 302 to the error URL with a non-zero `CCode` (configurable; default a documented decline code) | same page, error-URL hint |
| `What=VERIFY` with credentials of the terminal that issued the page and the exact raw parameters in original order | `CCode=0` | `pay/reference/actions` "`0` indicates the transaction is valid and authentic" |
| VERIFY with a missing base parameter | `CCode=200` | "`200` Missing one or more parameters…" |
| VERIFY with anything changed, reordered or another terminal's credentials | non-zero code (default a mock-only code outside the documented list; variant `200`) — the real tamper code is undocumented, so the app must accept only exactly `0` | docs list only 0/200/902/904 for VERIFY |
| Not implemented (undocumented for Hyp Pay) | notify/webhook, transaction lookup, IP allow-list | evidence 01 §4 |
| (b) `action=CancelTrans` (`Masof, PassP, TransId`) | Known `Id` on that terminal and not yet "transmitted" → `TransId=…&CCode=0&Hesh=<fake>&ReversalStatus=777`; otherwise `CCode=920`; wrong `PassP` → 902 | `pay/reference/actions#action-canceltrans`; `common-use-cases/cancellations` "until 22:00 Israel time on the same business day" |
| (b) `action=zikoyAPI` (`Masof, PassP, TransId, Amount`) | Transmitted `Id` and `Amount` ≤ remaining refundable → `Id=<new counter>&CCode=0&ACode=<fake>&HeshASM=<fake>`; over the remaining → `CCode=33`; wrong `PassP` → 902. Cumulative cap across partial refunds is a **mock assumption** (docs say only "can't refund more than the original transaction's value") — confirm with Hyp. `POST /__hyp/transmit {Id}` simulates end-of-day transmission; the `zpass_required` switch returns 901 without `zPass` (the docs are ambiguous). | `pay/reference/actions#action-zikoyapi`; `common-use-cases/refunds` "a **refund creates a brand-new transaction**" |

The app must ignore `Hesh`/`HeshASM` (invoice fields) — owner rule 7, no invoices.

### 1.3 Scenario switches (a, refund switches b)

Set with `POST /__hyp/scenario {target: "terminal:<id>" | "order:<ref>" | "global", sign?, verify?, page?, refund?, times?}`. `order:` targets one attempt (the test reads the reference from the DB after start), `times: n` makes it one-shot (e.g. fail VERIFY twice, then succeed).

| Switch | Values | Proves |
|---|---|---|
| `sign` | `ok`, `creds` (902), `no_what` (904), `html_200`, `html_with_ccode0` (HTML body that contains `CCode=0`), `garbage_200`, `json_200`, `http_500`, `http_503`, `timeout` (hang past the client timeout), `slow:<ms>` (below it), `reset` (socket destroyed), `echo_secret` (response contains `KEY=`/`PassP=`), `no_signature`, `no_action_pay`, `oversize` (> 64 KB), `redirect_3xx` (Location to another host) | U2, U9, E3, X4, X5 |
| `verify` | `ok`, `fail_code`, `fail_200`, `creds` (902), `html_200`, `html_with_ccode0`, `timeout`, `slow:<ms>`, `http_500`, `reset`, `flaky:<n>`, `trailing_crlf` (`CCode=0\r\n`, must pass), `ccode_00`, `ccode_space`, `ccode_dup` (`CCode=0&CCode=1`) — the last three must fail; **`lenient`** (returns 0 even for a changed `Amount`/`Order`/`Coin`) | U5, E3, E4, NEW-E-LENIENT: our own binding must still refuse |
| `page` | `approve`, `decline`, `cancel`, `moredata_off` (ignore `MoreData`), `win1255` (Windows-1255 bytes in `Fild1`/`Info`, as the 3DS example), `utf8`, `dup_param` (duplicate `Amount`), `extra_secret_param` (`PassP=` appended to the return) | U3, E2, E4, D10 contract |
| `refund` (b) | `ok`, `not_transmitted`, `over_amount` (33), `cannot_cancel` (920), `zpass_required` (901), `timeout`, `html_200` | NEW-U-REFUND, NEW-E-REFUND |

"Duplicate return" and "two returns" need no switch: the spec captures the 302 `Location` once and replays it (`hostGet`, `e2e/tests/helpers.ts:40-45`), sequentially and with `Promise.all`.

### 1.4 How the app reaches the mock, and only the mock (a)

| Control | Design | Evidence |
|---|---|---|
| Base-URL override | One test-only variable (name set by the architecture agent, e.g. `MAX_TEST_BASE_URL=http://127.0.0.1:4010/hyp/p/`) exported in `app-up.sh` next to the other mock URLs. Honoured only when the value is `http://127.0.0.1` / `localhost` **and** `PLATFORM_ADMIN_HOST` is `localhost` / `*.localhost`; otherwise the code constant `https://pay.hyp.co.il/p/`. The same base is used for server calls **and** the browser page URL. | Copy of `src/platform/ai/router.server.ts:22-33` (tested in `tests/unit/ai-security.test.ts:742-768`). Do **not** copy Grow: `GROW_SANDBOX_URL` accepts any URL (`src/lib/grow.server.ts:31`). |
| `NODE_ENV` cannot be the guard | Security requirement SR-29 says "an override exists only under `NODE_ENV=test`", but E2E runs the server with `NODE_ENV=production` (`app-up.sh:27`). Use the loopback + `*.localhost` rule instead. | `08-security.md` SR-29 vs `app-up.sh:27` |
| Env inventory | The override goes in `TEST_ONLY` of `tests/unit/env-forwarding.test.ts` (never in `docker-compose.yml`). | evidence 07 U15 |
| No real host in CI | (1) CI holds no secret and no Hyp credential (`tests.yml:2-5`); (2) the override pins every Hyp call to loopback; (3) new E2E step before the app starts: map `pay.hyp.co.il` to an unroutable address in `/etc/hosts`, so any stray call fails fast and loudly; (4) U9 asserts the constant is used when the guard fails. Even a stray call would carry only fake credentials (902, nothing charged). | `tests.yml:2-5`; NEW-X-EGRESS |
| Server log | `app-up.sh` copies server output to `e2e/test-results/server.log` (stdout is ignored today, `playwright.config.ts:55`) so X2 can scan it. The folder is uploaded on failure (`tests.yml:113-121`), which is safe only because every value in CI is fake. | X2 |

## 2. Automated test catalog

IDs U/S/C/E/X/R are reused from `docs/payment-gateways/evidence/07-testing-plan.md` (§3) with the changes stated; `NEW-…` rows are new. "DEMO-blocking" = must be green in CI before the manual DEMO run against Hyp's test environment. All rows run only against the mock and local databases (a), except rows marked (b).

**Rules every MAX test follows** (each is a defect found in the existing setup):

| Rule | Why (evidence) |
|---|---|
| Use **store B** as the main actor for every scope/tenant test, and store A only as the second store | Store A in E2E is the default tenant (`e2e/fixtures/data.mjs:4`; `tenants.is_default` = `kobi` in `shop_test`, read directly). `current_tenant_id()` falls back to the default store (`supabase/migrations/20261019260000_multi_store_members.sql:141-143`), so a fallback bug is invisible when the actor is store A. |
| SQL: dedicated tenant and customer UUIDs; never rely on cleaning `billing.ledger` | The ledger refuses UPDATE/DELETE/TRUNCATE even for the DB owner (`20261114100000_billing_agreements.sql:211-232`); `billing-agreements.test.sql` keeps its rows and asserts `NOT EXISTS (… confirmation = 'provider')` over the **whole** ledger (`:464-468`). Platform-payment test files must therefore sort **after** `billing-agreements.test.sql` (e.g. `max-platform-*.test.sql`) and scope assertions to their own tenants. Each `run.sh` pass starts from a fresh DB (`scripts/db-tests/run.sh:28-31,63-74`). |
| SQL: call settle functions **as `service_role`** through a helper | The SQL helpers never switch to `service_role` (`test-helpers.sql:13-14`, evidence 07 §0.3); copy `tests.lic_server` (`digital-licenses.test.sql:10-24`). |
| E2E: `retries: 0` for MAX specs; unique `x-real-ip` per test; expiry forced through `sql()` | CI retries once (`playwright.config.ts:22`) and could hide a race; the expiry job runs every 5 min under `NODE_ENV=production` (evidence 07 §1.6). |
| Testers are **non-staff** accounts | A staff order is forced offline before any payment branch (`20261019360000_remove_hyp.sql:67`); a platform admin is staff on every store host (independent review H1). |

### 2.1 Unit and architecture (Vitest, `checks` job)

| ID | Layer | Scenario | Expected | DEMO-blocking? |
|---|---|---|---|---|
| U1 | Unit | SIGN request builder (both scopes) | Only the allowed keys, golden string, values URL-encoded, CR/LF/NUL refused; `Amount` from integer agorot only; `Coin=1`; credentials only in the POST body (if M17 shows POST fails: stop and decide). **Extended:** never `SendHesh`, `sendHeshSMS`, `Pritim`, `heshDesc`, `EZ.*`, `sendemail`, `J5`, `Postpone`, `HK`, `Tash` (installments off in DEMO) | Yes |
| U2 | Unit | SIGN response parser | `action=pay` + 64-hex `signature` required; HTML (even containing `CCode=0`), JSON, empty, > 64 KB, duplicate keys, echoed `KEY`/`PassP` → typed error; payment URL = fixed base + response byte for byte | Yes |
| U3 | Unit | Return (redirect) parser | Raw query kept byte for byte (no `URLSearchParams` re-encoding; Windows-1255 and UTF-8 cases); `Id, CCode, Amount, Order, Sign` required; duplicate or reserved keys (`action, What, Masof, KEY, PassP, signature`) → reject before VERIFY; > 4,000 chars → reject | Yes |
| U4 | Unit | VERIFY request builder | Golden `action=APISign&What=VERIFY&Masof&KEY&PassP` + raw return; credentials are a parameter resolved from the **attempt's scope and account**, never from the Host or query | Yes |
| U5 | Unit | VERIFY response | Valid only for exactly `CCode=0` (optional trailing CRLF); `CCode=00`, ` CCode=0`, `ccode=0`, `CCode=0&CCode=1`, HTML, JSON, non-200 → not verified | Yes |
| U6 | Unit | Return `CCode` map | `0` → VERIFY; `600/700/800` → `needs_review`, never paid; every documented failure code → failed only after VERIFY; unknown → failed | Yes |
| U7 | Unit | Amount in agorot | `10`→1000, `10.5`→1050, `10.50`→1050; `10.005`, `1,234.50`, `1e3`, `-10`, spaces, `.5`, `10.`, Arabic-Indic digits → reject; 10,000-value round trip; exact equality, no ±0.01 tolerance | Yes |
| U8 | Unit | Binding `match()` | `amount_mismatch`, `amount_drift`, `currency_mismatch`, `order_mismatch`, `credential_changed`, `mode_mismatch`, **NEW `scope_mismatch`**; `safeEqual` uses `timingSafeEqual` | Yes |
| U9 | Unit | HTTP client | 15 s timeout pinned (SIGN timeout → no URL; VERIFY timeout → `verify_pending`, never paid/failed); 3xx never followed; base = constant unless the loopback + `*.localhost` guard passes; errors and `describeError()` (`src/lib/error-capture.ts`) never contain the fake `KEY`/`PassP`/`Masof` | Yes |
| U10 | Unit | Credential crypto | Round trip, tamper, wrong key, short key, random IV; **AAD binds scope + tenant (or platform) + provider + mode + account + field**: a platform ciphertext pasted into a store row (and the reverse) fails | Yes |
| U11 | Unit | Redaction | `KEY`, `PassP`, `Sign`, `signature` masked fully; `Masof` last 2–3 digits only; `ClientName`, `email`, `cell`, `UserId`, `Fild1-3`, `L4digit`, `Tmonth`, `Tyear`, `bincard`, `UID` masked | Yes |
| U12 | Unit | Store return handler (mocked rpc/fetch) | Host tenant ≠ attempt tenant → neutral page, no credential load, no VERIFY; unknown `Order` → no VERIFY; already paid → no VERIFY; 303 to a query-less URL with `no-store` + `no-referrer`; 429 on limits | Yes |
| U13 | Unit | Store start payment | `online` + `awaiting` + `pending` required; amount from `order_amount_due`; caller = order owner or per-order token; test account on a live store → refused; fixed error list; rate limits | Yes |
| U14 | Unit | Payment choice mapping | `online` → `online`; `bit`, `grow` unchanged; `credit_card` and anything else → `offline` (`src/lib/checkout.functions.ts:49-51`) | Yes |
| U15 | Unit | `env-forwarding.test.ts` | MAX variables listed; the override in `TEST_ONLY`; regex catches `env["…"]` | Yes |
| U16 | Unit | `gtm.test.ts` | Return paths and the result page cleaned like `/checkout/grow/:id` | Yes |
| U17 | Architecture | `tests/architecture/max-boundaries.test.ts` | Credential modules are server-only; no `VITE_*MAX*`/`*HYP*`; no Grow/Bit imports either way; no `rejectUnauthorized`; return routes export GET only; **only the VERIFY path calls `max_attempt_mark_paid` / `platform_attempt_mark_paid`** (review L15) | Yes |
| U18 | Architecture | `no-payment-secrets-in-repo.test.ts` | No terminal-shaped number except the declared fakes; no `PassP=`/`KEY=` with a value; no Luhn-valid 13–19-digit number in `tests/`, `e2e/`, `scripts/`, `docs/` | Yes |
| U19 | Unit | Return fuzz (seeded) | "Paid" only when the stand-in VERIFY says `0` and every match passes | No (before production planning) |
| NEW-U-SCOPE | Unit | Credential resolver | `(scope='platform')` → the platform account only; `(scope='tenant', tenant)` → that store's account only; any mix, null tenant on tenant scope, or a tenant id on platform scope → throw | Yes |
| NEW-U-PRET | Unit | Platform return handler | Served only on `PLATFORM_ADMIN_HOST`; looks up **platform** attempts only; VERIFY with platform credentials; a store host → 404/neutral; same headers as U12 | Yes |
| NEW-U-PSTART | Unit | Platform purchase start | Caller must be the owner of the purchasing store (billing permission); amount taken from the server quote (as `addon_purchase` does via `addon_quote_for`, `20261019470000_addon_approval.sql:180-215`), never from the request; explicit `_tenant`, never `current_tenant_id()` | Yes |
| NEW-U-MODE | Unit | Environment guard and test-user rule | In a non-production instance `mode='live'` is refused at save, start and settle; test mode is offered only to allow-listed accounts (store scope: non-staff test customers; platform scope: allow-listed demo stores and their owners — see §8 D-T3) | Yes |
| NEW-U-NODOC | Unit | No invoices, no SmartBee | SIGN/refund builders never send invoice parameters; `Hesh`/`HeshASM` are ignored and not stored; no module, import, env variable or host for SmartBee; settle does not depend on a document provider | Yes |
| NEW-U-REFUND | Unit | (b) CancelTrans / zikoyAPI builders and parsers | Exact keys; `TransId` only from a paid attempt of the same account; `Amount` in agorot ≤ remaining refundable; cancel success needs `CCode=0` **and** `ReversalStatus=777`; refund success needs `CCode=0` and a new `Id`; 33, 920, 901, 902, HTML → typed errors | No (b) |
| NEW-U-DOCPROV | Unit | (b) Future document provider (e.g. SmartBee) contract | When added, it receives only allowed fields (amount, currency, date, provider transaction id, buyer business details) — never card data or secrets; its failure or absence never blocks or reverses a settle | No (b) |

### 2.2 SQL (`scripts/db-tests/*.test.sql`, `db` job, 3 passes)

| ID | Layer | Scenario | Expected | DEMO-blocking? |
|---|---|---|---|---|
| S1 | SQL | Store-scope grants and activation | anon/authenticated/store admin denied on all MAX tables and functions; `service_role` allowed (via helper); MAX off by default; `place_order(… 'online')` refused while off; admin UPDATE to "paid" ignored; unpaid order cannot move to picking; `orders_payment_check` gains `online` and keeps `credit_card` (today it allows `offline, credit_card, bit, grow` only — read from `shop_test`) | Yes |
| S2 | SQL | Attempt state machine | Table-driven over every (from, to) pair; final states final; snapshot columns immutable | Yes |
| S3 | SQL | `max_attempt_mark_paid` outcomes | `unknown`, `tenant_mismatch`, `amount_mismatch`, `amount_drift`, `currency_mismatch`, `credential_changed`, `mode_mismatch` (**today missing in 06b**, review H1), `ccode_not_zero`, `paid`, `already_paid`, duplicate `Id` → `needs_review`, superseded attempt pays → `duplicate_charge`, failure mid-update rolls back | Yes |
| S4 | SQL | Store isolation matrix | owner A / owner B / agent / customer / platform admin / anon × accounts, attempts, events, status function; owner A with B's header sees nothing; settle with B's tenant on A's attempt → refused | Yes |
| S5 | SQL | Idempotency and frozen amount | One active attempt per order; unique `(provider, terminal, txn_id)`; unique reference; items/total/shipping/coupon frozen while an attempt is active (MX-01) | Yes |
| S6 | SQL | Expiry | Attempt expiry vs order expiry; stock +1 exactly once; payment after expiry → `needs_review: late`, order not reopened, alert row | Yes |
| S7 | SQL | Events append-only | One event per outcome; UPDATE/DELETE refused even for `service_role`; no sentinel card value or canary in any event | Yes |
| S8 / R1 | SQL | `payments-regression.test.sql` | Written and merged **before** MAX code; offline/Bit/Grow/POS/quotes/staff behaviour and function fingerprints unchanged | Yes |
| S9 | SQL | Catalog upkeep | `db-classification`, `ecommerce-engine-guard` count and triggers (review L9), rollback file + data guard, `rollback-check.sh` lines | Yes |
| NEW-S-PACC | SQL | Platform account | Exactly one platform account per provider and mode; it has no store tenant; a store function cannot read it; a platform function cannot read a store account; **one terminal number cannot exist in both scopes** (unique across scopes) | Yes |
| NEW-S-PSETTLE | SQL | `platform_attempt_mark_paid` | Settles only platform attempts; on success, in the **same transaction**: exactly one `billing.ledger` row `kind='payment'`, `confirmation='provider'`, `source='provider'`, `provider_ref` = Hyp `Id`, `method='credit_card'`, amount = attempt amount, `currency='ILS'`, tenant = purchasing store; the purchase is fulfilled (e.g. add-on `active` with `approved_reference`); a forced failure mid-way leaves no ledger row and no activation | Yes |
| NEW-S-PLEDGER | SQL | Ledger guards stay intact | The existing refusal of a manual provider row stays green (`billing-agreements.test.sql:464-468`); provider rows are written only inside settle (the guard needs `billing.provider_write='on'`, `20261114100000_billing_agreements.sql:222-226`); `platform_billing_record_entry` still writes `confirmation='manual'` (`billing.add_entry`, `:867`) | Yes |
| NEW-S-PIDEM | SQL | Platform idempotency | Second settle → `already_paid`, still one ledger row. **Needs a new unique key** (e.g. on `provider_ref` for provider rows, or attempt → ledger link): `billing.ledger` today has unique indexes only on `id`, `entry_no`, `legacy_ref`, `reverses_id` (read from `shop_test`) | Yes |
| NEW-S-PREV | SQL | Reversing a provider row | `platform_billing_reverse_entry` copies `o.source` into the reversal (`:1126`), so on a provider row the guard should refuse it (code reading, not executed). Test the decided behaviour: refused with a fixed message and nothing written, until the refund design (b) exists | Yes (behaviour must be pinned) |
| NEW-S-PISO | SQL | Platform isolation | Owner of store B cannot open, read or settle a platform attempt of store A; `my_billing_summary` of B never shows A's provider payment; the owner sees the payment as verified but never `provider_ref` or internal notes (existing owner-view rule, `billing-agreements.test.sql:229,259`) | Yes |
| NEW-S-MODE | SQL | Mode rules in the DB | `attempt.mode` copied from the account at open; a test attempt never sets a live order or a live platform purchase paid (`needs_review: mode_mismatch`); the instance flag "live not allowed" blocks `mode='live'` saves; the test-user allow-list is checked at open **and** settle (H1) | Yes |
| NEW-S-ONLINE | SQL | `online` method | `online` accepted; `credit_card` still mapped to offline (`remove-hyp.test.sql:85-88,120-124` unchanged); a staff order is never `online` | Yes |
| NEW-S-REFUND | SQL | (b) Refund rows | Separate append-only refund table; composite FK to the attempt; sum of refunds ≤ paid amount (agorot); one in-flight refund per attempt; platform refund writes a ledger `credit` or `reversal` with `source='provider'` | No (b) |
| NEW-S-REVENUE | SQL | (b) Revenue views | Per scope: platform = provider ledger payments − provider credits/reversals = paid platform attempts − refunds; store = paid online orders − refunds; no row counted in both scopes | No (b) |

### 2.3 Concurrency (`scripts/db-tests/max-payments-concurrency.sh`, new CI step)

Uses `parallel()` (advisory-lock barrier, `order-guard-concurrency.sh:70-86`) and `held()` (`hospitality/concurrency/run.sh:58-73`); builds one template DB and clones it per scenario like `rollback-guards.sh:21-26,79`.

| ID | Layer | Scenario | Must be exactly | DEMO-blocking? |
|---|---|---|---|---|
| C1 | Concurrency | Two identical store settles | 1 `paid`, 1 `already_paid`; one paid event | Yes |
| C2 | Concurrency | 10 identical store returns | 1 `paid`, 9 `already_paid`; no error/deadlock; stock unchanged | Yes |
| C3 | Concurrency | `held` proof of `FOR UPDATE` | B waits ≥ 1.2 s and gets `already_paid` | Yes |
| C4 | Concurrency | Double click: 5 parallel `max_attempt_open` | 1 active attempt; every call returns its id | Yes |
| C5 | Concurrency | Settle vs `expire_unpaid_orders()` × 20 rounds | Paid **or** expired + `late`; never both; 0 deadlocks | Yes |
| C6 | Concurrency | Same `Id` on two attempts | 1 paid, 1 `needs_review` | Yes |
| C7 | Concurrency | Settle vs staff cancel | One consistent end state; 0 deadlocks | Yes |
| C8 | Concurrency | Two stores in parallel | B not blocked by A (`held` wait ≤ 500 ms) | Yes |
| NEW-C-P1 | Concurrency | 10 identical platform settles | 1 `paid`, 9 `already_paid`; **exactly 1 ledger row**; purchase activated once | Yes |
| NEW-C-P2 | Concurrency | Platform settle vs the admin's manual approval of the same request (`platform_approve_addon`) | One winner; no double activation, no second ledger/billing row | Yes |
| NEW-C-SCOPE | Concurrency | Store settle and platform settle for the same store at once | Neither blocks the other (independent rows); 0 deadlocks | Yes |
| NEW-C-LOCK | Concurrency | Lock order across open / settle / expire / cancel | One documented order everywhere and 0 deadlocks over 50 mixed rounds. The drafts disagree today: 06b locks order → attempt (`06b-proposed-ddl.sql.txt:436,644-645`), SR-10 says attempt → order (`08-security.md` SR-10) | Yes |

### 2.4 E2E (Playwright, `e2e` job, mock Hyp)

| ID | Layer | Scenario | Expected | DEMO-blocking? |
|---|---|---|---|---|
| E1 | E2E | Store checkout, `online`, through the mock (API level, then UI desktop + `@mobile`) | Start → URL host is the mock, no `KEY`/`PassP` in it → approve → return 303 → order and attempt paid with events; stock reserved once; one order email in `/__calls`; VERIFY used store B's fake terminal (`/__hyp/calls`) | Yes |
| E2 | E2E | Decline and cancel | No-error-URL terminal: no return, attempt `redirected`, forced expiry → expired + stock +1; error-URL terminal: return → VERIFY → `failed`; forged decline (VERIFY fails) changes nothing; cancel/back → new attempt allowed | Yes |
| E3 | E2E | Provider failures | SIGN timeout (one case, ~16 s), HTML, garbage, 500, 902 → fixed Hebrew error, nothing from Hyp's body shown; VERIFY timeout/HTML → "checking payment", not paid; after recovery a retry pays once | Yes |
| E4 | E2E | Tamper and terminal binding | Changed `Amount`/`Order`/`Coin`, removed `Sign`, duplicate `Amount`, appended `PassP=`, reordered → never paid; local rejections make **no** VERIFY call; a return whose `Sign` was made by another fake terminal, replayed with the right reference on the right host → VERIFY (with this store's terminal) non-zero, not paid | Yes |
| NEW-E-LENIENT | E2E | Our binding without VERIFY's help (`verify=lenient`) | Even when the mock's VERIFY returns 0 for a changed `Amount`/`Order`/`Coin`, the order is not paid (`needs_review` or not found) | Yes |
| E5 | E2E | Replay | Same return twice and 10× in parallel → one paid, same final page, one email, ≤ 10 VERIFY calls; decline replayed after payment → stays paid | Yes |
| E6 | E2E | Wrong store host | Store B's return on store A's host (and forged `Host`/`X-Forwarded-Host`) → neutral page, no VERIFY with any terminal; zimmer host → 404; suspended/expired store B → the return is still recorded (MX-05) | Yes |
| E7 | E2E | Expired attempt / order | Valid return after forced expiry → `needs_review: late`, order not reopened, alert row; second return changes nothing | Yes |
| E8 | E2E | Admin screens (both scopes) | Platform admin saves fake credentials for store B and for the platform terminal (platform host only) → UI/JSON show only "configured", masked terminal, mode badge, date; responses never contain canaries; "check connection" = SIGN only, no attempt; owner A/owner B/agent/customer/anon matrix; audit row in the same transaction | Yes |
| E9 | E2E | CSRF and rate limits | Every MAX server function (both scopes) with cross-site origin or no origin headers → 403, nothing written, no SIGN; the cross-site return GET works and is idempotent; start N+1 → error; return N+1 per IP → 429; VERIFY cap → `needs_review` | Yes |
| E10 | E2E | No leaks | Pages, `/_serverFn` responses, error pages, `localStorage`/`sessionStorage`/cookies contain no canary; post-run `sql()` scan of every text/jsonb column (public **and** `billing`) finds no canary or sentinel card value | Yes |
| E11 / R3 | E2E | Regression | Offline and Bit unchanged; Grow start still hits the mock's 503 with today's text; a store without MAX shows today's options | Yes |
| NEW-E-P1 | E2E | Platform purchase by the owner of store B through the mock | Owner starts the DEMO purchase item (the architecture agent picks it; e.g. an add-on) → mock page for `<FAKE_TERMINAL_PLATFORM>` → return lands on the **platform host** → VERIFY with the platform terminal → one provider ledger row for store B, item fulfilled, owner's billing tab shows "verified online payment"; store B's terminal never called | Yes |
| NEW-E-P2 | E2E | Platform purchase negatives | Decline, cancel, tamper (`Amount`), replay ×10, VERIFY timeout → no ledger row until verified; exactly one row after; a request body with a lower amount is ignored | Yes |
| NEW-E-P3 | E2E | Expired store renews through the platform terminal (only if renewal is the DEMO item) | Return on the platform host is not blocked by `storeGate` (platform requests bypass it, `src/server.ts:71-72`); store unlocks after settle | Only if chosen |
| NEW-E-SEP | E2E | Cross-scope delivery | Platform return query sent to a store return route, and a store return query sent to the platform return route → neutral page, no VERIFY call at all, nothing written | Yes |
| NEW-E-TWO | E2E | Two terminals in one run | Store B checkout and store B's owner's platform purchase interleaved → each VERIFY used its own fake terminal; order row and ledger row separate | Yes |
| NEW-E-OWNER | E2E | Store-owner settings never show secrets | Owner's payment card shows status/mode/last verified payment only; no field, response or DOM node contains a canary; owner cannot open platform terminal settings (UI and `callServerFn`) | Yes |
| NEW-E-TEST | E2E | Test-mode visibility | Store in test mode: allow-listed test customer sees "online"; a regular customer does not; a platform admin on the store host gets an offline order (staff rule) | Yes |
| NEW-E-ENV | E2E | Environment guard | Switching any account to live in the CI/DEMO instance is refused in the UI and by direct `callServerFn` | Yes |
| NEW-E-ANALYTICS | E2E | Return params never reach analytics | With consent granted (pattern `tag-manager.spec.ts`), intercepted GA/Meta requests carry no return parameter or order id (SR-06) | Yes |
| NEW-E-REFUND | E2E | (b) Refund from the order screen | Partial refund, over-refund (33) refused, double click → one refund, cancel same day (777), cancel after transmission (920) — mock only | No (b) |

### 2.5 Security and leak scans

| ID | Layer | Scenario | Expected | DEMO-blocking? |
|---|---|---|---|---|
| X1 | Build scan (CI) | Bundle scan (`.output/public`) after both builds, with canary env values at build time | 0 hits for `PassP`, `KEY=`, `APISign`, `What=VERIFY`, MAX env names, canaries, `*.server-*` chunks of payment modules (MX-09) | Yes |
| X2 | E2E log scan | Server-log scan (`e2e/test-results/server.log`) | 0 canaries, 0 `PassP=`/`KEY=` with a value, 0 raw return query, 0 sentinel card values | Yes |
| X3 | E2E + SQL | DB scan (E10) and events (S7) | 0 hits | Yes |
| X4–X9 | Unit + E2E | Errors, fixed messages, CSRF, limits, no card data, headers | As evidence 07 §3.6 | Yes |
| X10 | Architecture + review | Secrets in git (U18 in CI; full history scan by the reviewer) | 0 real values | Yes (U18) |
| X11 | Unit + manual | Fuzzing of the return endpoint | Paid only after `CCode=0` and all matches | No (before production planning) |
| NEW-X-SCOPE | E2E + SQL | Cross-scope abuse | Platform reference on a store route, store reference on the platform route, platform-admin token used from a store origin against credential functions (MX-14: require `isPlatformRequest()`) → refused | Yes |
| NEW-X-EGRESS | CI + E2E | No real Hyp host reachable | E2E job blackholes `pay.hyp.co.il`; any attempt fails the run; every app-side SIGN/VERIFY appears in `/__hyp/calls` | Yes |
| NEW-X-ART | CI artifact scan | Artifact scan | `e2e/test-results` and `playwright-report` (traces, screenshots) contain only declared fakes — scanned before upload | Yes |

### 2.6 Regression (nothing existing may change)

| ID | Layer | Scenario | Expected | DEMO-blocking? |
|---|---|---|---|---|
| R1 | SQL | `payments-regression.test.sql` (= S8) | Same results before and after MAX | Yes |
| R2 | SQL + unit | Existing payment and billing tests unedited | `grow-payments`, `remove-hyp`, `pos`, `billing-agreements`, `billing-seller-vat`, `addon-approval`, `hospitality-billing` (SQL) and the two Grow unit files pass with no edit | Yes |
| R3 | E2E | `payments-regression.spec.ts` (= E11) | Offline, Bit, Grow-503 and "store without MAX" unchanged | Yes |
| R4 | Unit | Payment-choice mapping (= U14) | Client and server mapping unchanged except `online` | Yes |
| R5 | CI | Protected-paths label check (optional, needs owner approval) | A MAX PR that touches Grow/Bit files fails without a label | No |
| NEW-R-GROWOFF | Unit + E2E | MAX with Grow hidden (Grow retirement stage 1, `GROW-RETIREMENT-PLAN.md` §3.2) | Every MAX test passes with the Grow switch off; no MAX test or fixture reads a Grow table, env or mock path | Yes |

## 3. Separation tests (platform vs store; tenant A vs B)

All rows are (a) and DEMO-blocking. Each line is one property, the layer that enforces it, and the tests that prove it.

### 3.1 Platform terminal vs store terminals (owner requirements 1–3)

| # | Property | Enforced at | Tests | Expected when violated |
|---|---|---|---|---|
| P1 | The platform account and store accounts are different rows of different scopes; a terminal number lives in exactly one scope | DB constraint + unique index | NEW-S-PACC | Insert/update refused |
| P2 | Credentials are resolved by `(scope, tenant)`; ciphertext is bound to scope by AAD | Server resolver + crypto | NEW-U-SCOPE, U10 | Throw / decrypt fails |
| P3 | Store checkout signs and verifies with **the store's** terminal; platform purchase with **the platform** terminal | Server | E1, NEW-E-P1, NEW-E-TWO (`/__hyp/calls` shows `masof` per call) | Wrong `masof` = test failure |
| P4 | Each scope has its own return route on its own host | Router | U12, NEW-U-PRET, NEW-E-SEP | Neutral page, **zero** VERIFY calls, nothing written |
| P5 | `max_attempt_mark_paid` touches only store orders/attempts; `platform_attempt_mark_paid` touches only platform attempts, `billing.ledger` and the purchase | DB functions | S3, NEW-S-PSETTLE, catalog check that each function body references only its own tables | — |
| P6 | Store checkouts never write `billing.ledger`; only platform settle writes provider rows | DB | NEW-S-PSETTLE, NEW-S-PLEDGER | Row count check fails |
| P7 | A store reference is `unknown` to the platform settle function, and the reverse | DB | NEW-S-PSETTLE (cross-call cases), NEW-X-SCOPE | `unknown`, no state change |
| P8 | Only the platform admin manages either account, only on `PLATFORM_ADMIN_HOST`; a store owner sees its own store status, never the platform terminal | Server + DB | E8, NEW-E-OWNER, NEW-X-SCOPE (MX-14) | 403 / refused |
| P9 | Test mode, allow-lists and kill switches are per scope; switching one off leaves the other unchanged | DB flags | NEW-S-MODE, NEW-E-TEST, E8 (toggle one scope, start the other) | Other scope still works |
| P10 | Events and logs carry the scope; a store owner's views never list platform events | DB view | S4, NEW-S-PISO | Row hidden |

### 3.2 Store A vs store B (multi-tenant)

| # | Property | Enforced at | Tests |
|---|---|---|---|
| T1 | Host → tenant; forged `Host`/`X-Forwarded-Host` cannot switch stores | `src/server.ts` + nginx | E6 (pattern `tenant-routing.spec.ts`) |
| T2 | A return is looked up by (host tenant, reference); another store's host gets "unknown" and **no VERIFY with any terminal** | Return handler + DB | U12, E6, S4 |
| T3 | Every settle/open function takes an explicit `_tenant`; none uses `current_tenant_id()` (default-store fallback) | DB functions | S3 `tenant_mismatch`, catalog test on function bodies, all tests run with **store B** as actor |
| T4 | Ciphertext of store A cannot be used for store B (AAD) | Crypto | U10 |
| T5 | One terminal belongs to one store | Unique index | S5 / NEW-S-PACC |
| T6 | RLS on, RESTRICTIVE `tenant_isolation`, no anon/authenticated grants on every new table | DB | S1, existing `tenant-isolation-coverage.test.sql` |
| T7 | Owner B sees nothing of A (attempts, events, status, review list) | DB + server | S4, E8 matrix |
| T8 | Owner B cannot start, read or settle a platform purchase of store A; ledger and summary are per store | DB + server | NEW-S-PISO, NEW-E-P1 (run as B) |
| T9 | A busy store does not block another | Locks | C8, NEW-C-SCOPE |
| T10 | A suspended or expired store B still records a return (money may have moved); start stays blocked | `storeGate` exemption + start check | E6 (MX-05) |

## 4. Manual DEMO scenarios (Hyp real test environment)

(a) in the DEMO stage, but **run only after the owner's written approval**, by a named tester, from a non-production NURIEL instance, with Hyp **test** terminals only. The agents never run these (no request from us to any Hyp payment/API host). IDs map to the report's D1–D18 (`MAX-HYP-REPORT.md` §7.3) where they fit.

### 4.1 Global preconditions (D0) — all must hold before M01

| # | Precondition | Source / why |
|---|---|---|
| PRE-1 | Written approval from the owner: date, scope (M-rows), tester names, DEMO instance URL | Owner rules 8–9 |
| PRE-2 | NURIEL instance is **not** production: separate host and separate DB; any migration on it was approved explicitly; the environment guard is on (live mode impossible) — NEW-E-ENV passed on that instance | Owner rule 9; NEW-U-MODE |
| PRE-3 | **Two** Hyp test terminals issued to NURIEL: one for the platform scope, one for the demo store (Hyp gives "one terminal and one Hyp Portal account per environment" by default, so the second must be requested). Both numbers start with the documented test prefix | `pay/getting-started/prerequisites-and-initial-setup`; `pay/getting-started/testing-environments` "their numbers always start with `00100`" |
| PRE-4 | In each test terminal's portal: "Verify by signature in the payment page" on; success URL = that scope's DEMO return URL; error URL per decision D-T6 (default: none); wallets, bit, 3DS and invoice features left off | `pay/security/transaction-validation`; prerequisites page; owner rule 7 |
| PRE-5 | Only Hyp's published test cards are used, read from the official page at test time, never written down: https://developers.hyp.co.il/pay/getting-started/testing-environments. Amounts ≈ ₪10 ("around 10 ILS or USD", same page). The success card is shared by many developers (same page), so results must never depend on it being unused | Hard rule 5 |
| PRE-6 | Credentials are typed by the platform admin/owner into the DEMO admin UI only — never in chat, git, CI, tickets or screenshots | Standing requirement |
| PRE-7 | Accounts: one dedicated **non-staff** test customer on the allow-list; one demo store whose owner is allow-listed for platform purchases; nobody uses a platform-admin account to shop | `remove_hyp.sql:67`; review H1 |
| PRE-8 | All automated DEMO-blocking tests green on the same commit (§6 step S2) | §6 |
| PRE-9 | Evidence folder ready outside git (§5); redacted server logging on; Playwright/HAR/screen recording **off** for anything that shows Hyp's page | §5 |

**Stop at once** (and tell the owner) if: a terminal does not have the test prefix; anything suggests a real charge (bank SMS, settlement report); a production host or DB is touched; a store payment is verified with the platform terminal or the reverse; VERIFY returns `CCode=0` for a tampered field (escalate to Hyp; production planning is blocked); `600/700/800` appears; HTML system errors repeat; a secret or card field appears in a log, the DB, browser storage or analytics; any Grow, Bit or offline order changes; a ledger row appears for a non-demo store.

### 4.2 Scenarios

| ID (maps to) | Scenario | Extra preconditions | Steps | Expected | Evidence to capture |
|---|---|---|---|---|---|
| M01 (D1) | Connection check, both terminals | PRE-1–PRE-9 | Platform admin: "check connection" for the platform account, then the demo store account | SIGN only, nothing charged, no attempt row; `action=pay` + `signature` present, `KEY`/`PassP` not echoed | Result code per account; audit rows (names only) |
| M02 (D2) | Wrong `PassP` (optional) | M01 passed | Save a deliberately wrong password once, check connection, restore | `902` class → "credentials invalid"; account switched off fail-closed; no attempt | Code; redacted log line |
| M03 (D3) | Store checkout success | M01 | Test customer orders ₪10 → pays with the success test card | Paid **only after** VERIFY `CCode=0`; amount/currency/order match; one email; no `Tmonth`/`Tyear`/`bincard`/ID in DB columns or logs | Attempt/order/event rows (redacted columns, §5.2); VERIFY code; screenshot of our result page only |
| M04 (D4) | Decline | M03 | Same with the failure test card | Not paid. With no error URL Hyp shows the error and nothing returns; attempt stays `redirected`, order expires later, stock back once. With an error URL: return → VERIFY → `failed` | Portal setting used; rows; timestamps |
| M05 (D5) | Shopper cancels / closes the tab | M03 | Open Hyp's page, close it | Attempt `redirected` → `expired` at its time limit; order expires on its due date; stock back once | Rows, timestamps |
| M06 (NEW) | Back button | M03 | (a) On Hyp's page press Back, then "pay" again; (b) after a paid return press Back, then Forward | (a) Same attempt reused within its TTL (same `Order`) or a fresh one after expiry — never two live pages; (b) Forward to the return → `already_paid`, no second email. If Hyp's page allows paying again, the second charge → `needs_review: duplicate_charge` and the owner cancels it in Hyp's **test** portal | What Hyp's page did (text note); attempt rows |
| M07 (D12) | Double click on "pay" | M03 | Double-click "pay"; also open the pay page in a second tab | One attempt, one Hyp page (same `Order`) | Attempt count; SIGN count in redacted log |
| M08 (D7) | Refresh on the return / result page; second tab | M03 | Refresh the result page; re-open the return URL from history | Result page refresh sends no VERIFY; re-opening the return → `already_paid`, no second email | VERIFY count for the attempt (log); email count |
| M09 (D9) | Late return | M03 | Run twice. (a) Let only the **attempt** expire (30 min), order still awaiting; (b) force the **order** expiry on the DEMO DB (owner-approved write). Each time pay afterwards on the still-open Hyp page | (a) Paid — the order still awaits the same amount (06b rule, `06b-proposed-ddl.sql.txt:701-705`); (b) `needs_review: late` + staff alert, order not reopened (D-T1); the owner cancels that test charge in Hyp's test portal | Rows; alert row; how long Hyp's page stayed usable |
| M10 (NEW) | VERIFY timeout / Hyp unreachable from the server | M03 | After Hyp's page opens, the operator blocks outbound HTTPS **from the DEMO server** to the Hyp host (the browser still reaches Hyp); pay; observe; unblock; trigger the retry (job or "check again") | While blocked: "checking payment", attempt `returned`, not paid, order due time extended; after unblock: one VERIFY success → paid once | Timestamps; VERIFY attempts and codes; no duplicate rows |
| M11 (D15) | `MoreData` on / off | M03 | Run M03 twice, flag on and off (decision D-T4) | On: which parameter **names** arrive, whether `Coin`/`Payments` are present; off: only the base set; the app passes both ways (currency checked from the signed request when off) | Name lists only |
| M12 (D14 / D18) | Installments | M03 | Default: none offered (`Tash` not sent). Only if the owner enables installments: 3 payments with the test card | Default: `Payments` 1 or absent. Enabled: `Payments=3` (with MoreData), same total, VERIFY passes | Screenshot of our page; parameter names |
| M13 (NEW) | Platform purchase | M01 (platform) | Demo store owner buys the DEMO item (e.g. an add-on) and pays with the success test card | Return lands on the platform host; VERIFY with the **platform** terminal; exactly one provider ledger row for the demo store; item fulfilled; owner sees "verified online payment"; the store terminal was not used | Ledger row (redacted); terminal suffix per call from the redacted log; screenshots of our pages |
| M14 (NEW, D8) | Two terminals side by side | M03, M13 | Two browser profiles: customer pays in the store while the owner pays a platform purchase, both returns captured (§4.3); deliver the store return to the platform return URL and the platform return to the store return URL; finally deliver each original to its own route | Each payment verified with its own terminal; separate order and ledger rows; cross-delivered returns → neutral page, **no VERIFY** | Event rows; per-call terminal suffix; no VERIFY for the cross cases |
| M15 (D6) | Tamper with an unprocessed return | M03 | Capture a return without delivering it (§4.3); send variants: `Amount`, `Order`, `Coin`, `Id`, `Fild1` changed, `Sign` removed, reordered, `Amount` duplicated; finally send the original | Duplicates and missing `Sign` rejected locally, no VERIFY; other variants → VERIFY non-zero, not paid; original → paid. Also answers which fields VERIFY covers (Hyp question) | Per variant: local reject vs VERIFY code |
| M16 (D10) | Hebrew name, email with `+` | M03 | Customer name in Hebrew, email with `+` | VERIFY passes with the raw parameters unchanged | Encoding class observed (UTF-8 vs Windows-1255), not the bytes |
| M17 (D11) | SIGN and VERIFY by POST | M01 | Normal run with the POST client | Both work; credentials never in a URL. If POST fails: stop and decide | Method + code |
| M18 (D13) | Live mode refused | M01 | Try to switch an account to live | Refused by the environment guard and the test-prefix rule | UI message; audit row |
| M19 (D16) | Non-zero return with an error URL (only if D-T6 = configure it) | M04 | Failure card with an error URL configured | What VERIFY returns for a declined return | Code |
| M20 (D17) | Evidence review | All above | Owner greps the DEMO logs on their own machine for the real `KEY`/`PassP` and shares only the count; DB scan for card fields | Both counts 0; events complete | Counts only |

### 4.3 How to capture a return without letting our server settle it (M14, M15)

In the tester's Chrome, DevTools → Network → "Block request URL" on the return path before paying; after Hyp redirects, the blocked request holds the return URL. Copy it to memory only (it contains `Sign` and customer data — never into a file, chat or ticket), send the variants by editing the address bar, then unblock and send the original. This keeps M15 informative (a return that already settled would only answer `already_paid`).

### 4.4 Refund scenarios — (b) designed now, run only if Hyp confirms in writing that `CancelTrans`/`zikoyAPI` work on **test** terminals, the owner approves, and NEW-U-REFUND/NEW-S-REFUND/NEW-E-REFUND are green on the mock

The official pages say nothing about refunds or cancellations on test terminals: of the 30 saved Hyp Pay pages only `testing-environments` and `digital-wallets` mention testing, and neither mentions refunds or cancellations (live testing page re-fetched today: 0 matches); the refunds, cancellations and actions pages never mention testing. `zikoyAPI` also requires that "The original transaction must have been transmitted and settled" (`pay/reference/actions#action-zikoyapi`), which may never happen on a test terminal.

| ID | Scenario | Steps | Expected | Evidence |
|---|---|---|---|---|
| M21 | Same-day cancel from the order screen | Pay ₪10; before 22:00 Israel time click "cancel" | `CCode=0` + `ReversalStatus=777`; attempt/order state per design; platform: ledger reversal/credit with `source='provider'` | Codes; rows |
| M22 | Partial refund | Next business day (after transmission) refund ₪3 of ₪10 | New `Id`, `CCode=0`; remaining refundable ₪7 | Codes; refund rows |
| M23 | Over-refund refused | Try ₪8 more (total above ₪10) | Refused by us before any Hyp call; a direct over-amount call (only if approved) → `CCode=33` | Local refusal; code |
| M24 | Duplicate click on refund | Double-click the refund button | One refund row, one Hyp call | Row and call counts |
| M25 | Wrong operation for the transaction's stage | (a) Cancel after 22:00 / after transmission; (b) refund a same-day, not yet transmitted charge | (a) `CCode=920` → the screen offers a refund instead; (b) Hyp's answer is undocumented — record it; the screen should offer a cancel instead | Codes |

## 5. Evidence and redaction

### 5.1 Automated runs (local and CI) — (a)

Every value is fake (fake terminals, canary `KEY`/`PassP`, sentinel card fields), so CI artifacts may be uploaded as today (`tests.yml:113-121`). Two conditions keep that true: (1) real credentials are **never** used with E2E or CI — the upload folder would publish them; (2) NEW-X-ART scans `e2e/test-results` and `playwright-report` before upload and fails on anything that is not a declared fake.

### 5.2 Manual DEMO runs against Hyp's test environment — what to record

| Record | Form | Example of the allowed content |
|---|---|---|
| Scenario sheet | One line per M-row: date/time, tester, commit, pass/fail, notes | "M03 pass, VERIFY 0, one email" |
| Screenshots | **Our** pages only (checkout, result page, admin screens), cropped to exclude emails/names; Hyp's page at most **before** any field is typed | Result page "שולם", admin mode badge |
| Redacted server log | Output of the redactor (U11) only: event names, `CCode`, HTTP method, durations, parameter **names**, payload sha256, terminal last 2–3 digits | `verify ok ccode=0 method=POST masof=…12 payload=sha256:…` |
| DB rows | Selected columns: attempt id, scope, mode, state, `amount_minor`, currency, `review_reason`, timestamps, events (`source`, `result`, `verification`); ledger: entry_no, kind, confirmation, source, amount | State transitions of one attempt |
| Hyp transaction `Id` | Last 4 digits in shared documents; full value only in the private evidence folder for reconciliation with Hyp's test portal | `…NNNN` |
| Counts | Results of the owner's own greps for the real `KEY`/`PassP` (M20) and the DB card-field scan | `0 / 0` |
| Observed behaviour | What Hyp did (decline page, back button, page lifetime, encoding class, which MoreData names) | "Back from Hyp → our pay page; Forward → already paid" |

### 5.3 Must never be recorded (anywhere: files, chat, tickets, screenshots, git, CI)

`KEY`, `PassP`, `zPass`; full terminal numbers; `Sign` and `signature`; the raw return query or any full Hyp URL (it carries `signature`, `Sign` and customer fields); card number, CVV, expiry, Israeli ID — **including Hyp's published test values**; `bincard`, `Tmonth`, `Tyear`, `UID`, `Token`; real customer names, emails, phones (use the dedicated test accounts); session tokens (`sb-*-auth-token`), cookies; HAR files, Playwright traces or screen recordings of a run against Hyp's real page; unredacted server logs.

### 5.4 Where it is stored

| Material | Location | Retention |
|---|---|---|
| Raw evidence (screenshots, redacted logs, DB extracts, full `Id`s) | Private folder outside git on the owner's machine or a private drive with access limited to the testers | Delete after DEMO sign-off + 30 days (owner may choose otherwise) |
| Shareable summary | A new evidence file in git (for example `docs/payment-gateways/evidence/10-demo-run.md`) containing only §5.2 "allowed content" | Permanent |
| Gate before committing the summary | Reviewer reads it; U18-style secret scan of the file; no full URL, no full `Id`, no screenshot with personal data | Each commit |

If a forbidden value is recorded by mistake: delete it from every copy, tell the owner, and if it is a credential, rotate it in Hyp's test portal before the next run.

## 6. Entry and exit criteria

| Step | Entry | Exit |
|---|---|---|
| S0 Approvals | This plan and the four companion plans delivered | Owner approves the DEMO scope and the §8 decisions (or the recommendations); the DEMO-blocking questions are sent to Hyp (no S2S notify/lookup, what VERIFY covers, encoding, success URL for a non-production host, a second test terminal, refunds on test terminals) |
| S1 Baseline | S0 | R1 `payments-regression.test.sql` merged on the **pre-MAX** code and green; existing suites green unchanged (local `shop_test`: 3,651 assertions, 0 failed — read directly; CI run 209: 428 passed / 18 skipped / 0 failed — per docs) |
| S2 Automated DEMO (local + CI, mock only) | S1; code and migrations on a branch, applied only to local/CI databases | Every "DEMO-blocking = Yes" row in §2 green in CI on a pull request: three SQL passes, concurrency, E2E with `retries: 0`; X1, X2, X3, NEW-X-ART = 0 hits; Grow/Bit/offline tests green **without edits**; rollback and its data guard proven locally; R1 green before and after |
| S3 DEMO instance | S2 + the owner's explicit approval to create and migrate a **non-production** instance (rule 9) | Instance on a non-production host and DB; NEW-E-ENV and E8 pass there; flags on only for the demo store and the platform scope; allow-lists set |
| S4 Hyp test terminals | S3 + two test terminals issued (prefix checked) + portals configured (PRE-3–PRE-4) | M01 for both terminals and M17 pass; nothing charged |
| S5 Store scenarios | S4 | M02–M12, M15, M16, M18–M20 pass or N/A with a written reason; no stop condition |
| S6 Platform + side by side | S4 and M03 passed | M13, M14 pass |
| S7 Contract and sign-off | S5 + S6 | The mock is updated to what Hyp actually did (M04 decline, M06 back button, M11 MoreData names, M15 VERIFY coverage, M16 encoding) and the suite re-runs green; evidence summary reviewed (§5.4); owner signs off the DEMO |
| S-R (b) Refunds in DEMO | Hyp's written confirmation for test terminals + owner approval + refund rows of §2 green on the mock | M21–M25 pass |

**Must be green before any production planning starts** (planning only — still no production change, deploy or migration without explicit approval): S7 signed off; an independent security review of code, tests and DEMO evidence with every high/critical finding fixed and covered by a regression test; U19 and X11 fuzzing run; Hyp's answers on notify/lookup and VERIFY coverage, or the owner's written risk acceptance (manual reconciliation list for "paid but never returned"); a full-history secret scan; the owner's written go-ahead.

## 7. CI integration

### 7.1 What runs where (all (a) unless marked)

| Job (`.github/workflows/tests.yml`) | Adds | Change to the workflow or scripts |
|---|---|---|
| `checks` (`:23-51`) | U1–U18, NEW-U-*; X1 bundle scan after `bun run build` with canary MAX env values at build time | Add MAX files to the strict lint list (`:39`); new step `node scripts/security/scan-bundle.mjs .output/public` |
| `db` (`:53-83`) | S1–S9 and NEW-S-* (picked up by `run.sh` automatically, `run.sh:42`); C1–C8 and NEW-C-* in a new script; MAX rollback guard proof | New step `bash scripts/db-tests/max-payments-concurrency.sh` after `:83` (concurrency scripts are not auto-discovered, evidence 07 §0.1) |
| `e2e` (`:85-124`) | E1–E11, NEW-E-* with `retries: 0`; E10 DB scan; X2 log scan; NEW-X-ART | `app-up.sh`: export the guarded override and tee server output to `e2e/test-results/server.log`; new step "block the real Hyp host" before the app starts; new step `node scripts/security/scan-logs.mjs …` after `:112`; artifact scan before the upload at `:113` |
| Triggers (`:9-13`) | CI on pushes to the payments branch | Add `payments/**` to `push.branches` (today only `hospitality/**`, PRs and manual dispatch) |
| (b) Refund specs | NEW-U/S/E-REFUND, mock refund switches | Same jobs; no extra step |

### 7.2 Network isolation

1. No secret of any kind in CI (`tests.yml:2-5`) — no Hyp credentials exist there to leak or use.
2. The guarded override sends every SIGN/VERIFY (and later refund) call and the browser's payment page to `127.0.0.1:4010`.
3. Egress guard in the `e2e` job: `pay.hyp.co.il` resolves to an unroutable address for the whole job, so a stray server or browser request fails fast (Supabase image pulls are unaffected).
4. Unit U9 proves that an override failing the guard falls back to the constant, and NEW-X-EGRESS proves every app-side Hyp call is visible in `/__hyp/calls`.
5. The mock keeps answering every non-MAX unknown path with 503 (`mock-services.mjs:224-225`).

### 7.3 Leak scans

| Scan | Input | Fails on |
|---|---|---|
| X1 bundle | `.output/public/**` (both builds) | `PassP`, `KEY=`, `APISign`, `What=VERIFY`, MAX env names, canaries, payment `*.server-*` chunks |
| X2 server log | `e2e/test-results/server.log` | canaries, `PassP=`/`KEY=` with a value, raw return query, sentinel card values |
| X3 / E10 DB | every text/jsonb column in `public` and `billing` after the E2E run | canaries, sentinel card values, raw query |
| E10 responses / storage | Playwright `page.on('response')`, `localStorage`, `sessionStorage`, cookies | canaries, `Sign`, `PassP`, `KEY` |
| NEW-X-ART artifacts | `e2e/test-results`, `e2e/playwright-report` | anything that looks like a credential or card value and is not a declared fake |
| U18 repository | tracked files | terminal-shaped numbers except fakes, valued `PassP=`/`KEY=`, Luhn-valid numbers |

### 7.4 Expected runtime impact (estimates, not measured)

| Job | Today | Added |
|---|---|---|
| `checks` | not recorded | ≈ 200 unit cases (< 10 s) + bundle scan (seconds) |
| `db` | not recorded | ≈ 250 SQL assertions × 3 passes (≈ 1–2 min); concurrency script with one template DB and ≈ 12 scenarios (≈ 2–3 min; building a DB from all migrations dominates, as in `order-guard-concurrency.sh:28-34`) |
| `e2e` | 23.8 min for 428 tests (per docs) | ≈ 35 tests, ≈ 5–7 min (two 15-s timeout cases ≈ 35 s; UI flows ≈ 10 s each) → ≈ 30 min, inside the 40-min timeout (`tests.yml:88`) |

## 8. Gaps and decisions

### 8.1 Gaps found (each has a test or a fix above)

| # | Gap | Evidence | Handled by |
|---|---|---|---|
| G-1 | Proposed store settle (06b) never checks `mode`; no test-user allow-list exists | `06b-proposed-ddl.sql.txt:621-736`; review H1 | S3 `mode_mismatch`, NEW-S-MODE fail until the DB design adds it |
| G-2 | SR-29's "override only under `NODE_ENV=test`" cannot work in E2E | `app-up.sh:27` runs `NODE_ENV=production` | §1.4: loopback + `*.localhost` guard (AI pattern) |
| G-3 | No unique key protects a provider payment from being written twice to `billing.ledger` | `shop_test`: unique indexes only on `id`, `entry_no`, `legacy_ref`, `reverses_id` | NEW-S-PIDEM, NEW-C-P1; DB agent adds the key |
| G-4 | `billing.add_entry` always writes `confirmation='manual'`, and `platform_billing_reverse_entry` copies the source — so a provider row can neither be written by the existing helper nor reversed by the existing admin action | `20261114100000_billing_agreements.sql:867,1126,222-226` (code reading) | NEW-S-PSETTLE, NEW-S-PREV; decision D-T5 |
| G-5 | Store A is the default tenant, which hides `current_tenant_id()` fallbacks | `e2e/fixtures/data.mjs:4`; `multi_store_members.sql:141-143`; `shop_test` | Rule "store B is the main actor"; new non-staff **customer of store B** fixture (only `ownerB` exists today, `data.mjs:7-28`) |
| G-6 | `billing-agreements.test.sql` asserts no provider row in the whole ledger, and ledger rows cannot be cleaned | `billing-agreements.test.sql:464-468`; guard `:211-232` | File ordering + scoped assertions (§2 rules) |
| G-7 | CI does not run on pushes to the payments branch | `tests.yml:9-13` | §7.1 trigger |
| G-8 | Server stdout is discarded, so no log can be scanned | `playwright.config.ts:55` | `server.log` tee + X2 |
| G-9 | No secret, bundle or artifact scan in CI | evidence 07 §0.7 | X1, X2, NEW-X-ART, U18 |
| G-10 | Whether `CancelTrans`/`zikoyAPI` work on **test** terminals is undocumented; refunds need a transmitted and settled transaction | live `testing-environments.md` (0 mentions); `pay/reference/actions#action-zikoyapi` | §4.4 gated on Hyp's written answer |
| G-11 | The mock's VERIFY may be stricter than Hyp's (field coverage, order) | Undocumented (`pay/reference/actions` lists only 0/200/902/904) | NEW-E-LENIENT now; S7 contract update after M15 |
| G-12 | Draft lock orders disagree (order→attempt vs attempt→order) | `06b:436,644-645` vs `08-security.md` SR-10 | NEW-C-LOCK; DB agent picks one |
| G-13 | Under `NODE_ENV=production` the payment jobs run on timers during E2E | evidence 07 §1.6 | Make the MAX expiry/re-VERIFY job switchable off in E2E like `AI_RENEWAL_JOB=off` / `SEO_WORKER=off` (`app-up.sh:19-22`) and trigger it from the test |
| G-14 | `/__calls` grows for the whole run and mixes all services | `mock-services.mjs:185-190` | `/__hyp/calls?order=…` filter + `/__hyp/reset` |
| G-15 | The store owner is not signed in on the platform host (tokens are per origin), so the platform return page cannot rely on a session | MX-14 (`08-security.md`) | NEW-E-P1 asserts a neutral result page with a link back to the store admin, no PII |

### 8.2 Decisions the owner (or the named agent) must make

| # | Decision | Recommendation | Tests affected |
|---|---|---|---|
| D-T1 | Payment that arrives after expiry | `needs_review: late` + staff alert, order not reopened (report decision 5) | S3, S6, E7, M09 |
| D-T2 | Which platform purchase is the DEMO item (add-on, plan/package, renewal) | One item only in DEMO — the architecture agent's choice; the others are (b) | NEW-E-P1, NEW-E-P3, M13 |
| D-T3 | Test mode on the **platform** terminal: the standing rule "non-staff test users" cannot apply, because the payer is always a store owner (staff of their own store) | Allow-list of demo **stores** and their owner accounts; never a real store | NEW-U-MODE, NEW-S-MODE, NEW-E-TEST, PRE-7 |
| D-T4 | `MoreData` on or off | As report decision 8, and M11 runs both | U1, U8, U11, M11 |
| D-T5 | Admin "reverse" on a provider ledger row before refunds exist | Refuse with a fixed message (no manual edit of provider money) | NEW-S-PREV |
| D-T6 | Error URL in Hyp's portal | Not set (Hyp's recommendation; report decision 9) | E2, M04, M19 |
| D-T7 | Ask Hyp for a second test terminal (platform + store); a third (store B) only if cross-store VERIFY must be tested for real | Request the second now; third optional | M13, M14, Hyp question 4 |
| D-T8 | How to simulate a VERIFY timeout against real Hyp | Temporary server-side egress block during one return (M10); no fault-injection code in the product | M10 |
| D-T9 | CI changes: push trigger, egress guard, concurrency step, log tee, artifact scan, `retries: 0` for MAX | Approve as one CI change in stage S2 | §7 |
| D-T10 | Keeping the raw return for VERIFY retries (report decision 14) | Encrypted, deleted after VERIFY or 2 h | E3, M10 |
| D-T11 | Where the DEMO instance runs, and whether Hyp's portal accepts its success URL | A non-production HTTPS host; confirm with Hyp whether `http`/`localhost` is accepted (protocol agent) | PRE-2, PRE-4 |
| D-T12 | Refund testing in DEMO at all | Only after Hyp confirms test-terminal support in writing and the owner approves | M21–M25 |

## 9. Claims verified directly

Methods: reading repository files (Read/grep/sed); read-only SQL on the local `shop_test` with `SET default_transaction_read_only = on` (query files kept at `(working file, not in the repo)`, `05-q2.sql`, `05-q3.sql`); `curl` of four documentation pages on developers.hyp.co.il (`.md` copies, documentation host only — nothing sent to any payment/API host). No test suite, app, build or write was run.

| # | Claim | How verified |
|---|---|---|
| V1 | The mock records requests at `/__calls` and answers every unknown path (all payments) with 503 | Read `e2e/scripts/mock-services.mjs:174-190,224-225` |
| V2 | E2E runs the server with `NODE_ENV=production`, platform host `platform.shop.localhost`, the mock started by `app-up.sh`, background AI/SEO jobs off | Read `e2e/scripts/app-up.sh:13,19-22,27,41` |
| V3 | CI retries E2E once, discards server stdout, runs one worker | Read `e2e/playwright.config.ts:20-22,55` |
| V4 | CI triggers are `hospitality/**` pushes, PRs and manual dispatch; no secrets; artifacts uploaded on failure; E2E timeout 40 min | Read `.github/workflows/tests.yml:2-5,9-13,88,113-121` |
| V5 | The AI URL override accepts only loopback with a `*.localhost` platform host; the Grow override accepts any URL | Read `src/platform/ai/router.server.ts:17-33`; `src/lib/grow.server.ts:30-31` |
| V6 | CSRF middleware covers server functions only | Read `src/start.ts:25-27` |
| V7 | Staff orders return before any payment branch (offline) | Read `supabase/migrations/20261019360000_remove_hyp.sql:67` |
| V8 | `current_tenant_id()` falls back to the default store, and the default store is `kobi` = E2E store A | Read `20261019260000_multi_store_members.sql:141-143`; SQL `tenants WHERE is_default` → `kobi`; `e2e/fixtures/data.mjs:4` |
| V9 | `billing.ledger`: unique indexes only on `id`, `entry_no`, `legacy_ref`, `reverses_id`; guard trigger on INSERT/UPDATE/DELETE; `service_role` has SELECT only; current rows are all `confirmation='manual'` | SQL on `pg_indexes`, `information_schema.triggers`, `role_table_grants`, `billing.ledger` |
| V10 | Provider rows need `billing.provider_write='on'`; `billing.add_entry` always writes `manual`; the reversal copies the original source | Read `20261114100000_billing_agreements.sql:222-226,867,1126` (the resulting refusal of a provider reversal is code reading, not executed) |
| V11 | `billing-agreements.test.sql` asserts there is no provider row in the whole ledger | Read `scripts/db-tests/billing-agreements.test.sql:464-468` |
| V12 | Each SQL pass starts from a fresh DB; test files are discovered alphabetically | Read `scripts/db-tests/run.sh:28-31,42,63-74` |
| V13 | `orders_payment_check` allows `offline, credit_card, bit, grow` (no `online` yet); no `payment_*` tables exist | SQL `pg_constraint`; `information_schema.tables` |
| V14 | Local SQL baseline: 3,651 assertions, 0 failed | SQL on `tests.results` |
| V15 | Add-on purchases take the amount from the server quote, with an "expected price" check | Read `20261019470000_addon_approval.sql:180-215`; `addon-approval.test.sql` |
| V16 | Platform-host requests skip `storeGate` | Read `src/server.ts:71-72` |
| V17 | Hyp pages: test terminals "always start with `00100`"; the failure test card is meant to redirect "to your error page"; "one terminal and one Hyp Portal account per environment"; "configuring only the success URL"; cancel until 22:00 with `ReversalStatus=777`; `zikoyAPI` needs a "transmitted and settled" transaction; nothing is documented about refunds on test terminals | `curl` of `pay/getting-started/testing-environments.md`, `pay/getting-started/prerequisites-and-initial-setup.md`, `pay/common-use-cases/refunds.md`, `pay/common-use-cases/cancellations.md`: all four byte-identical to the copies saved earlier today; `grep -ci "refund\|zikoy\|cancel"` = 0 on the live testing page and on the saved `digital-wallets` page (the only two of 30 saved Pay pages that mention testing); `grep -i test` finds nothing in the saved refunds, cancellations and actions pages; `zikoyAPI` prerequisite read in the saved `pay/reference/actions` copy |

Taken from the existing docs and **not** re-verified: CI run 209 counts and the 23.8-minute duration; all runtime estimates in §7.4; the behaviour of Hyp's real test environment (that is what §4 is for).
