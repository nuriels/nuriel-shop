---
name: hyp-max-integration
description: Work on NURIEL's MAX / Hyp Pay (formerly Yaad Sarig, YaadPay) card-payment integration. Use when the task touches the hosted payment page (APISign SIGN), transaction validation (APISign VERIFY), Hyp status codes (CCode), store terminals and their credentials (Masof, KEY, PassP), the payment return route, double-charge / late-return / unverified-payment handling, DEMO vs production rules, the payments schema and its RLS, payment logs, or tests for any of these. Hebrew triggers - "סליקה", "מסוף", "דף תשלום", "HYP", "MAX", "יעד שריג", "אימות עסקה", "חיוב כפול".
metadata:
  version: "1.0"
  docs_verified: "2026-11-28 against https://developers.hyp.co.il/ (Hyp Pay section)"
---

# Hyp / MAX integration in NURIEL

This skill is a map, not a second implementation. The protocol is already written and tested in this
repository; almost every task is "find the one place that owns this rule and change it there, with its test".
Do not add a new Hyp call, endpoint, parameter or table from memory. If something is not in the official docs
(`references/hyp-protocol.md`) or in the code map (`references/nuriel-architecture.md`), stop and ask.

## Hard rules (never break these)

1. **No secret in this skill, in code, in tests, in logs, in the browser or in chat.** `Masof`, `KEY` and
   `PassP` of a real terminal exist only encrypted in the database, entered through the platform admin screen.
   Never print them, never paste them, never ask the user to send them. Tests use the fake values declared in
   `scripts/security/declared-fakes.json` and the mock in `e2e/`.
2. **Owner-only files are never opened or printed.** The list is the `neverRead` set in
   `scripts/security/scan-core.mjs` (environment files, the self-host setup script, one comparison document)
   plus the third-party WooCommerce plugin sources. The repo scanner skips them on purpose; so do you.
3. **No request to Hyp's payment host from a development machine or CI.** CI and the E2E app point that host
   at loopback; tests talk to `e2e/scripts/mock-hyp.mjs`. A run against Hyp needs the owner's explicit approval.
   Reading the public documentation site is fine.
4. **Every Hyp call is server-side** and goes through `src/platform/payments/server/http.ts` (`hypRequest`).
   `max/protocol.ts` and `redact.ts` are imported from server code only (the bundle scan enforces it).
5. **An order is marked paid online in exactly one place**: the DB function `max_attempt_mark_paid`
   (`platform_attempt_mark_paid` for the platform), after a server-to-server VERIFY whose whole body is
   `CCode=0`. A browser redirect alone never pays anything.
6. **Out of scope until the owner says otherwise**: 3DS changes, refunds, cancellations, tokens, recurring
   charges, invoices / documents, wallets, SmartBee. There is no code path for them; do not add one.
7. **Existing payment flows are not yours to touch**: Bit, Grow, POS, phone and manual payments.
   `expire_unpaid_orders` stays byte-identical (a test pins its md5).
8. **Migration 208 and production**: the migration runs on the local DB and CI only until the owner approves a
   deployment. Never deploy, never change the live server, never merge to `main` without explicit approval.

## The flow in one screen

```
checkout (server fn)                      Hyp                         return route (server)
--------------------                      ---                         ---------------------
max_attempt_open  -> attempt, reference
buildSignParams   -> APISign What=SIGN  ->  signed query string
validateSignResponse (echo must match)
redirect browser to endpoint + "?" + the signed string, unchanged
                                          payer pays on Hyp's page
                                          browser redirected to the terminal's success URL
                                                                      parseReturnQuery (raw, order kept)
                                                                      returnHasSignature, else refuse
                                                                      max_attempt_record_return  (order held)
                                                                      buildVerifyQuery -> APISign What=VERIFY
                                                                      classifyVerifyResponse (exactly CCode=0)
                                                                      max_attempt_mark_paid (amount, currency,
                                                                        terminal, txn id, duplicates in SQL)
```

Anything VERIFY did not confirm changes nothing and is retried by the 5-minute tick; after 6 failed tries or
90 minutes the attempt is parked for a person (`needs_review`) and exactly one alert is claimed.

## How to work on a task

1. Read `references/nuriel-architecture.md` for the owner of the rule (file, DB function, test file).
2. If the task changes anything Hyp sees or sends, read `references/hyp-protocol.md` and re-check the official
   page it cites (the docs serve Markdown: append `.md` to a page URL, see that file's first section).
3. Read the binding decisions in `docs/payment-gateways/DEMO-IMPLEMENTATION-CONTRACT.md` §7 (X-1 … and the
   pilot rules P-1 …). They override older text and this skill. If your change contradicts one, stop and ask.
4. Write the failing test first, then the change, in the owner module only (`references/testing.md` lists the
   suites and the commands). A payment fix without a test that failed before it is not done.
5. Run the checks in `references/testing.md` → "Before you say done". Report real numbers.

## Where things are decided (quick index)

| Topic | Owner |
| --- | --- |
| SIGN parameters and their order, VERIFY query, return parsing, CCode classes | `src/platform/payments/max/protocol.ts` |
| Endpoint, DEMO vs production, mock override, readiness, startup line | `src/platform/payments/server/env.ts` |
| HTTP to Hyp (timeout, size cap) | `src/platform/payments/server/http.ts` |
| Sealing KEY / PassP and raw returns | `server/crypto.ts`, `server/tenant-keys.ts`, `server/platform-keys.ts` |
| Log masking | `src/platform/payments/redact.ts` + `server/*/log.ts` |
| Store flow (checkout, return, jobs, alerts, staff, owner, admin) | `src/platform/payments/server/tenant/*`, `src/lib/online-payments*` |
| Platform flow (NURIEL's own terminal; off in the pilot) | `src/platform/payments/server/platform/*`, `src/platform/billing/pay*` |
| Tables, guards, RLS, every money rule | `supabase/migrations/20261128100000_online_payments_foundation.sql` (migration 208) |
| Static boundaries (who may import / call what) | `tests/architecture/max-boundaries.test.ts` |

## Store settings model (owner decision, 2026-11-28)

- The **platform admin** enters a store's terminal details in platform management, under that store. The store
  owner never sees or edits the terminal number or keys.
- The store owner sees only whether MAX card payment is on; the shopper sees a card option at checkout only
  when the database says the store is active for them.
- Every terminal and key belongs to exactly one store (`payments.terminal_registry`); a terminal number saved
  for one store is refused for any other store and for the platform.
- Right now only the store at `nuriel-shop.nuri1.fit` may use the DEMO (test) terminal. Every other store shows
  "הסליקה בקרוב" and is refused on the server and in the database, not only hidden in the UI.
- The implementation state of this "pilot" (contract §7.2) changes; read the contract and the branch before
  assuming any of it is merged or deployed.

## References

- `references/hyp-protocol.md` — what the official Hyp Pay docs say (SIGN, VERIFY, redirect, status codes,
  test terminals, portal settings), what they do not say, and how to re-verify.
- `references/nuriel-architecture.md` — module map, DB API, separation of stores and terminals, double-charge
  and late-return rules, security, logs and RLS.
- `references/testing.md` — suites, commands, DEMO vs production checks, what every change must prove.
