# 01 — Hyp protocol spec for the DEMO stage (MAX/Hyp native integration)

Status: complete (sections 0–8).
Author role: Hyp expert / payment-protocol agent (1 of 5). Research only: no repo edits, no DB access, **no request to any Hyp payment/API host** (only documentation pages on developers.hyp.co.il were fetched).
Date: 2026-11-27.

**Conventions**
- `P/x` = `https://developers.hyp.co.il/pay/x`; `E/x` = `https://developers.hyp.co.il/enterprise/x`. Quotes are the rendered text (Markdown bold/link markup removed), ≤ 25 words.
- **Verification:** every Hyp Pay page (all 30 + the platform intro) and 16 Enterprise pages were fetched **live today** and are **byte-identical** to the cached copies in (saved copies of the official pages, kept outside the repo). Every Hyp quote below was checked verbatim against the live copy by script (100/100 matched; list in (working file, not in the repo)). See §8.
- Placeholders replace every value printed in the docs' examples: `<test terminal>`, `<test card>`, `<KEY>`, `<PassP>`, `<Id>`, `<signature>` (hard rule 5).
- Scope tags: **[DEMO-now]** needed for DEMO now · **[DESIGN-now/BUILD-later]** · **[OUT]** out of scope.
- "**Inference:**" marks my reading; everything else is what the docs say. "not documented" = absent from all 30 Hyp Pay pages.
- Naming anchors used as given: scopes `platform` | `tenant`; modes `test` | `live`; provider `max`; order payment method `online`.

---

## 0. Executive summary

1. **Hyp Pay has no separate sandbox host.** Test and live use the same `https://pay.hyp.co.il/p/`; only the terminal (test terminals "always start with `00100`") and its credentials differ. The "no real charge" guarantee therefore rests entirely on our credential/terminal guards (mode flag + prefix check + no live credentials in the DEMO environment). (P/getting-started/testing-environments)
2. **The one-time hosted-page flow is fully documented:** `APISign`/`SIGN` → append the response to `https://pay.hyp.co.il/p/?` → browser returns to the terminal's portal success URL → `APISign`/`VERIFY` with all redirect parameters in order → `CCode=0`. Every parameter used in DEMO has a source (§1.2–1.5).
3. **Return URLs exist only per terminal, in the Hyp Portal; the return carries no terminal number.** Separation of `platform` vs `tenant` must therefore come from (a) a different success URL route per terminal, (b) the `Order` reference, and (c) VERIFY with the credentials of the account the route/attempt names. Hyp gives "one terminal and one Hyp Portal account per environment" by default, so **DEMO needs Hyp to issue two test terminals** (platform + one store) to prove separation (§1.11, §5).
4. **Hyp's built-in invoicing is ON by default on every terminal and issues a document for every successful transaction, including refunds and cancellations.** Omitting invoice parameters is not enough to satisfy "no invoices"; Hyp must switch the module off on the DEMO terminals (how is not documented) and we treat a non-empty `Hesh`/`HeshASM` as a stop condition (§4).
5. **No server-to-server notification or transaction lookup exists for Hyp Pay** (re-confirmed on all 30 pages); Enterprise webhooks/`inquireTransactions` are not documented as usable by a Hyp Pay terminal. DEMO accepts manual reconciliation of "paid but never returned" (§1.10).
6. **Refunds are designable, not yet safely buildable.** `CancelTrans` (full, same business day until 22:00) and `zikoyAPI` (full/partial, returns a new `Id`) are documented, but multiple partial refunds, `zPass`, idempotency, test-terminal behaviour and after-the-fact verification are not. Never auto-retry a refund call (§2).
7. **Platform terminal = the same hosted-page flow on a separate terminal** for one-time purchases now; for recurring later, merchant-managed tokens (`getToken` + `soft`) fit a platform ledger better than Hyp-managed `HK`, whose automatic charges have no documented result signal and support fixed amounts only (§3).

### 0.1 Decisions needed

| # | Who | Decision | Recommendation |
|---|---|---|---|
| D-A | Owner → Hyp | Request two test terminals (platform + one demo store) | Yes; without two, separation cannot be shown (§1.11) |
| D-B | Owner | DEMO-1 host and return routes | Staging hosts over HTTPS (option A, §1.9) with explicit scope routes `/payments/return/max/platform` and `/payments/return/max/tenant` (one canonical path; §7 C20) |
| D-C | Owner | `MoreData=True` in DEMO | Keep (owner decision 8): needed to check `Coin` and `Payments`; costs extra PII in the return |
| D-D | Owner | Error URL in the portal | Keep the default (no error URL); optionally one approved decline run to answer Q7 |
| D-E | Owner → Hyp | Invoicing module | Off on both DEMO terminals; for live, exactly one document issuer per terminal (none / Hyp Invoice / SmartBee later) |
| D-F | Owner | Never-returned payments in DEMO | Accept manual reconciliation (no documented S2S mechanism) |
| D-G | Owner | Refund from the order screen | Design only now; DEMO-2 tests only after Hyp answers Q20–Q23 |
| D-H | Owner (later) | Platform recurring model | Merchant-managed tokens over `HK` unless Hyp documents HK charge results (Q25) |
| D-I | Hyp | Answers that gate DEMO-1 | Q1, Q4, Q5, Q13 (IP part), Q17 (§6) |

---

## 1. DEMO protocol spec — one-time hosted-page payment, step by step

### 1.0 Refined definition of DEMO

The working definition holds, with one correction from the evidence: Hyp's "test environment" is **not a separate host**, it is a test terminal on the production host.

| Stage | What runs | Hyp contact | Gate |
|---|---|---|---|
| **DEMO-0** (local/CI) | NURIEL against a mock Hyp server that implements **only documented behaviour** (the mock spec in `evidence/07-testing-plan.md:429-458` matches §1.2–1.7 below) | none | none of the Hyp questions block it |
| **DEMO-1** (manual) | A non-production NURIEL instance (staging) → real `https://pay.hyp.co.il/p/` with **test terminals only** (`00100…`), published test cards, ≈ ₪10 amounts, synthetic customer data, two terminals (platform + one store), invoicing module off | SIGN/VERIFY only | owner approval + §5 checklist + questions marked "DEMO-1 start" in §6 |
| **DEMO-2** (later, optional) | Same as DEMO-1 plus `CancelTrans`/`zikoyAPI` experiments for the refund design | refund calls | Hyp answers Q3, Q20–Q23 |

Basis: "The URL stays the same (`https://pay.hyp.co.il/p/`), but it will only process real transactions when you use your production credentials." and test environments let you verify flows "without ever touching a real credit card or processing an actual transaction" (P/getting-started/testing-environments). Hyp also asks for "synthetic test data rather than real customer information" in non-production (P/getting-started/authentication-security).

**The flow (same for `platform` and `tenant`; only the account differs):**
1. Server opens an attempt (amount frozen in agorot, random `Order` reference, account = platform account or the store's account, mode `test`).
2. Server → Hyp: `APISign`/`SIGN` (§1.2); checks the response (§1.3).
3. Browser → `https://pay.hyp.co.il/p/?` + signed string; shopper pays on Hyp's page.
4. Hyp → browser → the terminal's portal success URL (§1.4, §1.9).
5. Server: local checks, records the raw return (§1.6 #1–3).
6. Server → Hyp: `APISign`/`VERIFY` with that account's credentials (§1.5).
7. Server: binding checks, then `max_attempt_mark_paid` (§1.6 #4–11); 303 to a clean result page.

### 1.1 Test environment

| Topic | What the docs say (quote, URL) | Consequence for DEMO |
|---|---|---|
| Test vs live terminal | "These terminals are easy to spot because their numbers always start with `00100`." (P/getting-started/testing-environments) | **[DEMO-now]** In `test` mode refuse any terminal not starting with `00100`; in `live` mode refuse any that does (evidence 07 D13). |
| Same host for both | "The URL stays the same … only process real transactions when you use your production credentials." (same page) | **[DEMO-now]** Isolation is by credentials only. The DEMO environment must never hold a live terminal's `KEY`/`PassP`. |
| What a test terminal does | "…without ever touching a real credit card or processing an actual transaction." (same page) | Test terminals do not process real transactions (documented). |
| Public/shared test terminal | **not documented** (none is published). The terminal numbers in the examples on P/reference/actions are samples; most of them do not start with `00100`, so by the docs' own rule they are not test terminals (evidence 01 §6). | **[DEMO-now]** Never use a sample terminal from the docs or a third-party plugin. |
| Dedicated test terminal for a merchant | Register → service agreement → acquiring agreement → contact `ipos@hyp.co.il`; Hyp will "Register one or more terminal numbers for you." "By default, you receive one terminal and one Hyp Portal account per environment." (P/getting-started/prerequisites-and-initial-setup) | A test terminal comes with its own portal account. More than one terminal is possible ("one or more") but not the default. |
| Prerequisite order | The acquiring agreement "step is mandatory before Hyp can configure a terminal for you." (same page) | **Whether a test terminal can be opened before an acquiring agreement exists is not documented** → Q1. |
| Two test terminals (platform + store) | **not documented** beyond "one or more terminal numbers". | **[DEMO-now]** Ask Hyp for two (Q1). With one terminal, separation cannot be demonstrated (same credentials, one success URL). |
| Credentials per terminal | `KEY`: "Your terminal API key." `PassP`: "Your terminal API password." (P/reference/actions) · "repeat the steps above for every environment" (prerequisites page) | Store `Masof`/`KEY`/`PassP` per account (scope × mode). |
| Published test cards | One success card and one failure card are published on P/getting-started/testing-environments (**not copied here**). "we recommend keeping your test amounts low" (same page). | **[DEMO-now]** Testers read them from the official page; never stored in git, tickets or fixtures. |
| Failure card behaviour | "To simulate a failure that redirects to your error page, you can use this test card:" (same page) | Only redirects back to us if an error URL is configured (see §1.4, §7 C13). |
| Live-only features | Apple Pay: "the full payment workflow only works in production." bit: "the full bit payment flow only works in the production environment." (P/common-use-cases/digital-wallets) · "3DS is only available on production terminals." (P/advanced-features/3ds) | **[DEMO-now]** Keep Apple Pay, bit, 3DS off. **Google Pay: not documented either way** (our evidence 07 line 574 overstates this; §7 C19). Gift cards need separate merchant accounts (P/advanced-features/gift-cards) → off. |
| Test vs live marker in a response | **not documented** (no field in SIGN, redirect, MoreData or VERIFY marks test). `TransType` is "for example, `Internet-Secure`, `ApplePay`, or `GooglePay`" (P/reference/actions). | Mode must come from our account record, never from Hyp's response → Q2. |
| Test transactions in a portal | Portal: "You can use it to view transactions, manage your terminals, and configure your API settings." (P/introduction/key-concepts-and-terminology); a portal account exists per environment (prerequisites page). **Inference:** test transactions are visible in the test portal account; not stated explicitly. Enterprise states it explicitly: "Mock transactions are still recorded inside the test environment's console…" (E/introduction/environment-setup) | Needed for reconciling unreturned DEMO payments → Q3. |

### 1.2 Step 1 — SIGN request (server → `https://pay.hyp.co.il/p/`)

Sent from the server only: "Never expose your API credentials by making calls from a browser or mobile app." (P/reference/actions). TLS: "We require TLS 1.2 or higher for all connections." (P/getting-started/authentication-security). Values URL-encoded: "Make sure to URL-encode all parameter values before constructing the request URL" (P/getting-started/creating-a-payment-page).

| Parameter | Docs: required? | DEMO value | Source (URL + short quote) | Note |
|---|---|---|---|---|
| `action` | Yes | `APISign` | P/reference/actions#create-a-payment-page-request: "Must be set to `APISign`." | |
| `What` | Yes | `SIGN` | same: "Must be set to `SIGN` to request a new payment page." | missing → `CCode=904` |
| `Masof` | Yes | `<test terminal>` of the attempt's account | same: "Your terminal number." (format "10 digits") | prefix guard before sending |
| `KEY` | Yes | `<KEY>` (decrypted in memory for this call only) | same: "Your terminal API key." | never logged |
| `PassP` | Yes | `<PassP>` | same: "Your terminal API password." · "Your API password is different from the password you use to log in to the Hyp Portal." (prerequisites page) | wrong → `902` |
| `Amount` | **Yes** (table) | attempt amount, agorot → decimal with 2 digits | same: "This can be a decimal number with up to two fractional digits (for example, `10.00`, `10.5`, or `10`)." | guide's "bare minimum" omits it (§7 C1) — always send |
| `Sign` | **No** (table), but VERIFY needs it | `True` | same: "Set to `True` to receive a security signature that is required for transaction validation." · VERIFY prerequisite: "You must have included `Sign=True` in the initial `APISign` request." | §7 C2 |
| `Coin` | guide list only | `1` (ILS) | P/getting-started/creating-a-payment-page: "Supported values: `1` for ILS (used by default), `2` for USD, `3` for Euro, `4` for GBP." | send explicitly (ILS is the default anyway) so the echoed value can be checked in the SIGN response and, with MoreData, in the redirect |
| `Order` | No | attempt `reference` (random, 32 hex, baseline) | P/reference/actions: "An internal order ID for your records." (format "String") | max length/charset **not documented** (Q11); also the lookup key on return |
| `MoreData` | No | `True` (owner decision 8, `MAX-HYP-REPORT.md:66`) | same: "Set to `True` to receive additional parameters like `UID` and `UserId` in the redirect…" | gives `Coin`, `Payments`, `L4digit`, `Brand`… (cost: more PII) |
| `hideBtns` | No | `True` | same: "Set to `True` to hide the payment method selection buttons on the payment page." | second layer behind "wallets not enabled" |
| `PageLang` | No | `HEB` (default) | same: "`HEB` (Hebrew) is the default." | |
| `ClientName`, `ClientLName`, `email`, `cell` | No | synthetic test data (platform: store owner; tenant: shopper) | same: "The customer's first name." … | optional prefill |
| **Not sent in DEMO** | | | | |
| `UserId` | No | — | same: "The customer's Israeli ID." | sensitive (P/common-use-cases/tokenization); owner decision 10 |
| `Tash`, `FixTash`, `tashType`, `ShowEngTashText` | No | — | P/common-use-cases/installments: "If you don't include them, the payment will be processed as a single, one-time charge." | single charge only |
| `J5`, `Postpone` | No | — | P/reference/actions (two-phase/postpone table) | would yield 700/800 |
| `HK`, `freq`, `TashFirstPayment`, `FirstPaymentTash`, `OnlyOnApprove` | No | — | P/advanced-features/recurring-payments | §3 later |
| `SendHesh`, `sendHeshSMS`, `Pritim`, `heshDesc`, `EZ.*` | No | — | P/invoicing/basic-invoicing | §4 |
| `sendemail` | guide list only | — | creating-a-payment-page: "Set this to `True` to send the customer an email confirmation of the transaction." | no Hyp emails in DEMO |
| `Info`, `tmp`, `street`, `city` | No | — (`Info` optional, ASCII only) | creating-a-payment-page / actions | `Info` comes back in redirects with an undocumented charset (3DS example; Q8) |
| `UTF8`, `UTF8out`, `Fild1`–`Fild3` | **not documented for APISign** (documented for `soft`) | — | P/reference/actions#charge-a-saved-token | do not invent inputs |

### 1.3 Step 2 — SIGN response and the redirect URL

| Item | Docs | Our handling **[DEMO-now]** |
|---|---|---|
| Success | "A successful request returns a URL-encoded string containing all parameters and a `signature`" (P/reference/actions) · for `action`: "This changes to `pay` in the response." · "All other parameters passed in the request are returned as-is." | Accept only if: not HTML; contains `signature` and `action=pay`; contains no `KEY`/`PassP` key (the example omits them, the table implies "as-is" → §7 C4, Q16); echoed `Masof`, `Amount`, `Coin`, `Order`, `Sign`, `MoreData` equal what we sent. |
| Failure | "If the request fails, the response will contain a non-zero status code (`CCode`)" — codes `902` "Authentication failure: wrong `PassP`.", `904` "Missing `What` parameter." (same) | Any `CCode` ≠ 0, or no `signature` → attempt `failed` (SIGN), fixed user message; `902` → alert platform admin (credentials). |
| System error | "If the response contains HTML instead of a URL-encoded string or JSON, it indicates a system error." · "You should never rely on HTTP status codes to determine the success of an operation." (same) | One retry, then "unavailable" (baseline `MAX-HYP-REPORT.md:397`). |
| Redirect URL | "just append the entire response to `https://pay.hyp.co.il/p/?`" · "with all parameters in the exact same order — no extra processing needed" (P/getting-started/creating-a-payment-page) | Build `https://pay.hyp.co.il/p/?` + raw response string, byte-for-byte; never re-sort or re-encode. |
| Session integrity | "It stops replay attacks by ensuring each payment session can only be used once." (P/security/payment-page-security) | One signed URL per attempt; URL **lifetime not documented** (Q14). Full-page redirect (no iframe) per baseline. |

### 1.4 Step 3 — Shopper pays; browser returns to our URL

| Case | What the docs say | Parameters | Our handling |
|---|---|---|---|
| **Success, without MoreData** | "Hyp Pay passes a query string with several parameters — we usually call this a payment completion redirect." (P/getting-started/creating-a-payment-page) | Example order: `Id, CCode, Amount, ACode, Order, Fild1, Fild2, Fild3, Sign` (same page). `Id`: "the unique ID for that transaction on our end" (P/common-use-cases/tokenization); `ACode`: "The authorization code returned by the card company." (P/reference/actions, `soft` table); `Sign`: "a unique signature Hyp Pay creates for that specific transaction" (P/security/transaction-validation) | Keep the **raw query string** (order, empty values like `Fild3=`, percent-encoding) for VERIFY. Meaning of `Fild1`–`Fild3` on a payment page is not defined (example shows name/email) → never rely on them. |
| **Success, with `MoreData=True`** | "If you set `MoreData=True` in the request, Hyp Pay will include additional transaction details in the payment completion redirect" (P/reference/actions) | `Bank, TransType, Payments, UserId, Brand, Issuer, L4digit, street, city, zip, cell, Coin, Tmonth, Tyear, Hesh, UID, spType, bincard` (MoreData table). The 3DS example also shows `Info`, `ECI`, `errMsg` and spells `SpType`/`BinCard` (P/advanced-features/3ds). | Store at most `Coin`, `Payments`, `L4digit`, `Brand`, `UID`, `Hesh`; never persist `Tmonth`/`Tyear`/`bincard`/`UserId` outside the encrypted, short-lived raw return (baseline decision 14, `MAX-HYP-REPORT.md:72`). |
| **Decline, default portal setting** | "If the payment failed, show an error or redirect to your error page" (creating-a-payment-page) · Hyp recommends "configuring only the success URL" and displaying the error on its own page (P/getting-started/prerequisites-and-initial-setup) | **No redirect reaches us.** | Attempt stays `redirected` and later expires (evidence 07 E2/D4). |
| **Decline, error URL configured** | "Failed transactions can return different `CCode` values in the redirect URL." (P/getting-started/testing-environments) | The parameter set of an error redirect (with or without MoreData) is **not documented**; what VERIFY returns for it is **not documented** (Q7). | Record + VERIFY; never `paid`; `failed` only after a verified decline. |
| 600 / 700 / 800 | "If an error URL is configured, Hyp Pay treats these non-zero codes as failures and redirects the user to your error page" (prerequisites page); without one, 700 and 800 go to the success page (P/advanced-features/two-phase-commits, P/common-use-cases/postponing-transactions) | We never send `J5`/`Postpone`, so these must not occur in DEMO. | **Stop condition** + `needs_review` (evidence 07 §3.8). |
| Extras we must not see in DEMO | `HKId` (recurring), `MULTI` (gift cards: "it must be done separately for each transaction using the respective transaction ID", P/advanced-features/gift-cards) | | Record and VERIFY as usual (money may have moved), then `needs_review`, never `paid`; DEMO stop condition (feature unexpectedly on). |

### 1.5 Step 4 — VERIFY (server → `https://pay.hyp.co.il/p/`)

| Item | Docs | Our handling |
|---|---|---|
| Request | `action=APISign`, `What=VERIFY`, `Masof`, `KEY`, `PassP` (all "Yes"), then "All parameters from the redirect URL, in their original order." (P/reference/actions#validate-a-transaction) · "All parameters passed to your success page URL, in the same order." (creating-a-payment-page) | Credentials of the **account named by the return route and the attempt** (§1.6). Append the raw redirect query unchanged after the five fixed parameters, as the docs' example does. Whether re-encoding is tolerated is not documented (Q8). |
| Prerequisites | "You must have included `Sign=True` in the initial `APISign` request." (same) · portal "Verify by signature in the payment page" — "This setting is usually on by default." (P/security/transaction-validation) | Checklist item (§5). |
| Response | "`0` indicates the transaction is valid and authentic." Failure example `CCode=200` = "Missing one or more parameters from the payment completion redirect."; `902`, `904` (P/reference/actions) · "If the validation fails — like if the signature is wrong or the transaction doesn't exist — you'll get an error code." (P/security/transaction-validation) | Verified only on **exactly** `CCode=0`; anything else (incl. HTML, empty, extra keys) = not verified. |
| What VERIFY proves | "you're asking Hyp Pay to confirm that the signature matches the provided transaction" (P/security/transaction-validation); another page says it "checks whether the transaction has indeed occurred" (P/introduction/what-is-a-payment-page). Fields covered by `Sign`: **not documented**. | Do **not** treat VERIFY as approval by itself: also require redirect `CCode=0` and local field matches (§1.6). |
| Mandatory? | "While it's not strictly required, we definitely recommend" (creating-a-payment-page) vs "We recommend validating every transaction before you ship an order…" (transaction-validation) | Mandatory for us (owner rule). |
| Repeatability | **not documented** whether a second VERIFY of the same redirect returns 0 again, or for how long (Q15). | Retries after transport failure are needed (baseline backoff); test D7 in DEMO-1. |

### 1.6 Step 5 — Binding checks before `max_attempt_mark_paid` (ours, in this order)

| # | Check | Why / source |
|---|---|---|
| 1 | Route → **scope** (`platform` or `tenant`) and **account** (platform account, or the store resolved from the Host). Mode must be `test` in DEMO and the account's terminal must start with `00100`. | Return URL is per terminal (§1.9); the redirect has no terminal field (§1.11). |
| 2 | Parse the raw query: reject duplicate keys and keys only we send (`KEY`, `PassP`, `action`, `What`) — forgery indicators, no DB write. `HKId`/`MULTI`/600/700/800 are **not** rejected here: they go through VERIFY and end in `needs_review`. | Baseline `MAX-HYP-REPORT.md:352-354`. |
| 3 | Find the attempt by (scope, account, `Order`). Not found → event `return_wrong_scope`/`return_wrong_host`, **no VERIFY**. | Prevents using one account's credentials on another's redirect. |
| 4 | VERIFY with **that account's** credentials → require `CCode=0`. | §1.5. |
| 5 | Redirect `CCode` = `0` (immediate J4 charge). 600/700/800 → stop condition. | P/reference/response-status-codes: "`0`: Approved transaction." |
| 6 | Redirect `Amount` (decimal) = attempt amount (agorot) = current amount due. | Owner rule; Amount formats per §1.2. |
| 7 | `Coin` = `1` (needs MoreData). | Owner rule (currency). |
| 8 | `Payments` = `1` or absent. | P/reference/actions: "The number of installments used for the transaction." |
| 9 | `Id` not yet used for this account (unique per account; global uniqueness not documented, Q12). | Replay. |
| 10 | Test-mode user allow-list (baseline decision 13). | Owner rule. |
| 11 | `Hesh` empty/absent, else flag "document may have been issued" (§4). | Owner rule "no invoices". |

Only then `max_attempt_mark_paid` (the single function allowed to set paid). **Platform scope:** the same function family writes a provider-confirmed billing payment (`billing` ledger `confirmation='provider'`, `provider_ref=<Id>`, `source='provider'`, `kind='payment'`) instead of touching a store order — DB design belongs to the DB agent; nothing is migrated (owner rule 9).

### 1.7 CCode and error handling for DEMO

Source: P/reference/response-status-codes unless noted. "Hyp Pay returns a `200 OK` status code for almost all requests, even when an error occurs." (P/reference/actions).

| Code | Meaning (quote) | Where it can appear in DEMO | Handling |
|---|---|---|---|
| `0` | "Approved transaction." / VERIFY: "valid and authentic" | redirect, VERIFY | continue checks |
| `902` | "Authentication error" | SIGN, VERIFY | credentials problem → alert, attempt not redirected / return stays pending |
| `904` | "Missing `What` parameter" | SIGN, VERIFY | our bug → alert |
| `200` | "Missing one or more parameters from the payment completion redirect" | VERIFY | not verified; check raw pass-through |
| `901` | "Terminal is not permitted to use this method or a wrong `zPass` is provided" | any | config problem → alert |
| `903` | "The number of payments configured in the terminal has been exceeded" | redirect | should not occur (no `Tash`) |
| `600` / `700` / `800` | J2 check / "Authorization (J5)" / "Postponed transaction" — listed as success codes, nothing captured | redirect | stop condition |
| `700` (Shva) | "Transaction declined by PinPad device" (same code, other meaning) | — | §7 C15 |
| `401` / `402` | Hyp Pay: "First or last name is required" / "Transaction information is required"; Shva: installments too high / too low | redirect (error URL) | treat as decline; ambiguous (Q19) |
| `4`, `6`, `33`… (Shva/Hyp declines) | e.g. "Transaction not approved" (4); `6` "incorrect CVV2 (May also indicate a missing Israeli ID number)" | redirect (error URL only) | decline after VERIFY |
| `998` / `999` / `990` | "Transaction cancelled" / "Communication error" / card not readable | any | treat as failure; `999` on SIGN/VERIFY → retry policy |
| `417` / `494` (Shva) | "Terminal number is incorrect" / "Different terminal number" | any | config / cross-terminal alarm |
| `425` (Shva) | "Duplicate record" | any | `needs_review` |
| HTML body | "indicates a system error" (P/reference/actions) | any | transient failure |

### 1.8 HTTP method for SIGN/VERIFY

"Every API call on this page is made using a standard HTTP GET request. Most calls can also be performed using equivalent HTTP POST requests." (P/reference/actions). Which calls are excluded, the POST content type, and whether parameter order is kept in a POST body are **not documented** (Q10).
**[DEMO-now]** Use GET (documented) in DEMO-0/1 with URL masking in every log; test POST once in DEMO-1 (evidence 07 D11) and switch only after Hyp confirms. Hyp itself asks to mask "the values of `KEY`, `PassP`, and any customer-related parameters" (P/getting-started/authentication-security).

### 1.9 Return URLs — where they are set, and DEMO from a non-public instance

| Fact | Source |
|---|---|
| Set **per terminal in the Hyp Portal**: Settings → "Payment Page and API" → "Post-transaction address" → "Successful transaction: Custom link"; an optional "Failed transaction" URL; default "Display the error on the payment page". | P/getting-started/prerequisites-and-initial-setup |
| Hyp's recommendation: "configuring only the success URL" and showing errors on its own page. With an error URL, "Hyp Pay will redirect the customer to your site for any transaction that is not a standard immediate charge." | same |
| **No per-transaction return URL parameter** exists in any APISign table (searched all 30 pages). The flow page says the customer is sent back "using the success and error URLs you provided in your Hyp Pay account". | P/reference/actions; P/introduction/what-is-a-payment-page |
| The return is a **browser redirect**, not a server call (sequence diagram: Hyp → customer browser → merchant). | P/introduction/what-is-a-payment-page |

**Consequences**
- One success URL per terminal ⇒ each terminal is bound to **one** NURIEL environment and **one** scope at a time. Recommended routes (our design, final path owned by the architecture agent; note our own docs disagree today: `/payments/return/max` in `MAX-HYP-REPORT.md:352` and `evidence/05-architecture.md:259` vs `/api/payments/max/return` in `evidence/07-testing-plan.md:536`):
  - platform test terminal → `https://<demo-platform-host>/payments/return/max/platform`
  - store test terminal → `https://<demo-store-subdomain>/payments/return/max/tenant`
  - Use path segments only — no query string in the portal URL: VERIFY must receive "Every parameter that was sent to your success page URL" (P/security/transaction-validation), so a query we add ourselves would become part of the VERIFY set (**inference**; Q4).
- Our server needs **outbound** HTTPS to `pay.hyp.co.il` only; Hyp never calls us. Whether Hyp restricts source IPs is not documented (Q13).

**Options the docs allow for a non-public / localhost DEMO instance** (all rely on "browser redirect only"):

| Option | How | Pros / cons |
|---|---|---|
| A (recommended for DEMO-1) | Staging hosts with real DNS + HTTPS; access restricted to testers; portal success URLs point there | Closest to live; whether the portal accepts any host is not documented but HTTPS public hosts are the normal case. |
| B | Success URL on a host that resolves only on the tester's machine (hosts file or VPN) | Works if the portal accepts the URL (Q4); only the tester's browser must reach it. |
| C | `http://localhost:<port>/…` | Acceptance by the portal **not documented** (Q4); one developer at a time per terminal. |
| D (smoke test only) | Success URL unreachable; tester copies the redirect query from the browser address bar into the local instance's return route | Docs-compatible (VERIFY needs only the parameters), but manual and error-prone; **inference**. |
| Error URL | Keep the default (no error URL) as Hyp recommends; optionally one dedicated run with an error URL to observe decline redirects (Q7) | Changing it is a portal action by the owner. |

### 1.10 Server-to-server notification and transaction lookup

| Product | Mechanism | Usable by a Hyp Pay terminal? |
|---|---|---|
| Hyp Pay | **None documented**: no webhook, notify URL, IPN, or lookup by `Id`/`Order`. The only server-side check is VERIFY of the browser-delivered redirect (all 30 pages searched for webhook/notif/callback/IPN/inquir; only Shva code texts matched). `payRequest`/`LIST` covers payment links only ("up to the 500 most recent links created on your terminal", P/common-use-cases/send-payment-links). | — |
| Hyp Enterprise | Webhooks: "Hyp Enterprise push notifications are powered by Amazon SNS (Simple Notification Service)" with "Terminal Selection" of all or specific terminals (E/payment-page-integration/webhooks). Inquiry: `inquireTransactions`, but "Transaction inquiries are not meant to be performed on a continuous basis." (E/inquiring-transactions/overview). Redirect MAC (`responseMac`, local SHA-256 over browser-delivered values — not server-to-server; "Validation is not required, but…", E/advanced-security-guidelines/transaction-validation). | **not documented.** No Enterprise page mentions Hyp Pay or its terminals; no Hyp Pay page mentions webhooks or transaction inquiry (grep of all 117 cached pages: 30 Pay + platform intro + 86 Enterprise). The only cross-link: the Hyp Pay Apple Pay iframe script is served from `pps.creditguard.co.il` (P/common-use-cases/digital-wallets). |

**[DEMO-now]** "Paid but never returned" cannot be detected automatically: the attempt expires, appears in the reconciliation list with its `Order`, and the tester checks the test portal (if it shows test transactions, Q3). Add a DEMO-1 scenario "close the tab on Hyp's page after paying". **[DESIGN-now/BUILD-later]** If Hyp confirms a notification (Q6), it enters through the same VERIFY + mark-paid path.

### 1.11 Several terminals from one integration (platform + one per store)

| Topic | What the docs say | Design rule |
|---|---|---|
| Many terminals | "You'll get one or more unique terminal numbers from Hyp to use in your API calls." · "Each terminal has its own configuration for things like currency and transaction types." · "Each merchant has a unique ID in our system." (P/introduction/key-concepts-and-terminology) | One account row per (scope, owner, mode); one terminal belongs to exactly one account. |
| Credentials | per terminal (`KEY` "Your terminal API key") | Load credentials only from the attempt's account. |
| Platform or integrator model | **not documented** (no partner, marketplace or sub-merchant model) | Each store is its own Hyp merchant with its own portal, success URL and credentials (EXISTING Q27). |
| Return → terminal binding | The documented redirect sets (base and MoreData) contain **no terminal number**. | Bind by route + `Order` + VERIFY with the account's credentials. |
| Does VERIFY bind the terminal? | VERIFY takes `Masof` "Your terminal number" and fails "if the signature is wrong or the transaction doesn't exist" (P/security/transaction-validation). **Inference:** a redirect from terminal B fails VERIFY with terminal A's credentials. Not stated. | Q9; DEMO-1 test D8/E4 (cross-terminal VERIFY must fail). |
| SIGN binding | The SIGN response echoes `Masof` and the payment-page URL carries it. | Check echoed `Masof` = account terminal. |
| Tokens across terminals | "Normally, a token only works on the terminal where it was created." · "Note that a two-terminal setup only works when both terminals use the same business ID." (P/advanced-features/recurring-payments) · `tOwner`: "In a multi-terminal setup, specifies the terminal number that obtained the card token when it's different from the terminal making the charge." (P/reference/actions) · tokens "are unique to each merchant — the same card will result in different tokens for different businesses" (P/common-use-cases/tokenization) | Never send `tOwner`. Caution: two DEMO test terminals issued to NURIEL share one business ID, so token cross-use would technically be possible there; tokens stay out of DEMO. |
| "Terminal for searching the original transaction" | Enterprise only: "By default, the terminal used for refund or cancellation must match the original transaction's terminal." (E/additional-payment-scenarios/refunds-and-cancellations). Hyp Pay: **not documented**. | Refunds always use the original attempt's account (Q23). |

**Cross-terminal risks to test in DEMO-1:** (1) a store's success URL pointing at the platform route or another store → attempt not found → no VERIFY; (2) a redirect from terminal B sent to terminal A's route with a forged `Order` → VERIFY must fail; (3) `Id` collisions across terminals → uniqueness per account; (4) a store owner changes `KEY`/`PassP` in their portal ("anyone who gets into your Hyp Pay account can also see your API credentials", P/getting-started/authentication-security) → SIGN `902` → alert; (5) per-terminal settings drift (invoicing, wallets, gift cards, installments) → onboarding checklist per terminal (§5).

---

## 2. Refunds and cancellations spec (future "refund from the order screen") — [DESIGN-now/BUILD-later]

Nothing here is built or called in DEMO-0/DEMO-1. DEMO-2 may exercise it on test terminals only after Hyp answers Q3 and Q20–Q23.

### 2.1 Which call, when

| | Cancellation (`CancelTrans`) | Refund (`zikoyAPI`) |
|---|---|---|
| When | "If the transaction hasn't been transmitted yet, it is fully cancellable." "You can cancel a transaction up until 22:00 Israel time on the same business day it was made." (P/common-use-cases/cancellations). Reference wording: "typically before 22:00 Israel time on the same day" (P/reference/actions) | "The original transaction must have been transmitted and settled." (P/reference/actions#action-zikoyapi) |
| Amount | Full only (no `Amount` parameter) | "You need to specify the amount to refund (can be partial)." (same) · "you can't refund more than the original transaction's value" (P/common-use-cases/refunds) |
| Effect | "you won't be charged the credit card company's commission for it" (cancellations page) | "a refund creates a brand-new transaction" (refunds page) |
| Fallback between them | **not documented** for Hyp Pay (Enterprise `refundDeal` has one, §2.6). No documented way to ask Hyp whether a transaction was transmitted. | |

**Our rule (design):** full refund on the original's Israel business day, before a safety margin ahead of 22:00 → `CancelTrans`; otherwise (or partial) → `zikoyAPI`. On `CancelTrans` → `920` do **not** switch to `zikoyAPI` automatically (920 also means "does not exist"); show staff a second explicit action. Partial refunds on the same day as the charge: behaviour before transmission is not documented (Q21) → block in the UI until answered.

### 2.2 `CancelTrans`

| Parameter | Required | Source quote (P/reference/actions#action-canceltrans unless noted) |
|---|---|---|
| `action` | Yes | "Must be set to `CancelTrans`." |
| `Masof` | Yes | "Your terminal number." |
| `PassP` | Yes | "Your terminal API password." |
| `TransId` | Yes | "The unique `Id` of the transaction to cancel." |
| `KEY` | **not listed** | (by omission; Q20) |

Response: `TransId`, `CCode` ("`0` indicates success."), `ReversalStatus` ("A code indicating the cancellation status (e.g., `777`)."); the example also carries `Hesh` (not in the table, §7 C8). "If the cancellation works, the system returns `CCode=0` and `ReversalStatus=777`." (P/common-use-cases/cancellations). Codes: `0`, `902`, `920` "Transaction cannot be cancelled (e.g., doesn't exist or was already transmitted)." Success = `CCode=0` **and** `ReversalStatus=777`.

### 2.3 `zikoyAPI`

| Parameter | Required | Source quote (P/reference/actions#action-zikoyapi) |
|---|---|---|
| `action` | Yes | "Must be set to `zikoyAPI`." |
| `Masof` | Yes | "Your terminal number." |
| `PassP` | Yes | "Your terminal API password." |
| `TransId` | Yes | "The unique `Id` of the original transaction." |
| `Amount` | Yes | "The amount to refund." (decimal, up to two fractional digits) |
| `zPass` | **ambiguous** | Not in this table, but the payout table defines it as "A secondary password specifically for payouts and refunds." (Q20) |
| `KEY` | **not listed** | (Q20) |

Response: `Id` ("The new unique ID for the refund transaction."), `CCode`, plus `ACode` and `HeshASM` in the example ("The response includes a new `Id`, which is the unique identifier for the refund itself.", P/common-use-cases/refunds). **No `Amount` is returned** (Q21). Codes: `0`, `33` "Amount exceeds the original transaction value." (status page wording: "You can credit the entire transaction or a small amount of the transaction amount only"), `902`; `901` is possible ("Terminal is not permitted to use this method or a wrong `zPass` is provided", P/reference/response-status-codes).

### 2.4 What is not documented (blocks building the order-screen refund)

| Topic | Status | Design consequence |
|---|---|---|
| Several partial refunds per original; cumulative cap | **not documented** ("can't refund more than the original transaction's value" may be per call or cumulative) | Enforce a local cumulative cap ≤ captured amount; Q21. |
| Client reference / idempotency on `zikoyAPI`, `CancelTrans` | **not documented** (no `Order`/`Fild` input in either table) | One in-flight refund per payment; idempotency key on our side; **never auto-retry** a call with unknown outcome (a retry may refund twice); Q22. |
| Verifying a refund afterwards | **not documented**: no lookup API; only the synchronous `CCode` | Timeout/HTML → state `unknown` → `needs_review` + manual check in the Hyp Portal. |
| Terminal permissions | **not documented** for refunds. Shva codes hint at acquirer/issuer permission: `304` "No permission for credit - acquirer permission", `344` "…issuer permission" (status page). A third-party plugin's text says refunds need card-company permission to credit without CVV (evidence 01 §9; not official). | Onboarding question per store terminal; Q20. |
| Refunds/cancels on test terminals | **not documented** (does a test terminal transmit at 22:00 and settle?) | DEMO-2 only after Q3. |
| Wrong-terminal protection | **not documented** for Hyp Pay | Always use the original attempt's account; Q23. |
| Installment transactions | **not documented** for Hyp Pay (Enterprise mirrors the schedule) | Installments stay off until answered; Q21. |
| Side effects | Invoicing module issues documents for "refunds, cancellations, and payouts" (P/invoicing/basic-invoicing) | §4: one document issuer per terminal. |
| Gift-card payments | Each gift card is "a separate transaction"; refund or cancel "separately for each transaction" (P/advanced-features/gift-cards) | Gift cards off until the model supports several `Id`s per payment. |

### 2.5 Safe design for later (protocol-level constraints only)

1. Server-only action, permission-checked per scope (store owner/staff with a refund permission for `tenant`; platform admin for `platform`); never from a browser parameter.
2. A `refund` row per request (`requested → sent → succeeded | failed | unknown`), pinned to the original attempt's **account** (same scope, same terminal); amount ≤ captured − already refunded (locked).
3. Store Hyp's new `Id`, `ACode`, `HeshASM` / `ReversalStatus`; no card data.
4. `unknown` (timeout, HTML) is never retried automatically → `needs_review`, staff checks the portal.
5. Emits provider-neutral accounting events (`payment_cancelled`, `refund_succeeded`) for a future document provider (§4.5).
6. DEMO-2 scenarios once answered: same-day full cancel; next-day full refund; two partial refunds then a third above the remainder (expect `33`); refund with the other terminal's credentials (must fail); wrong `PassP` (`902`).

### 2.6 Comparison with Hyp Enterprise (`refundDeal` / `cancelDeal`)

| Aspect | Hyp Pay | Hyp Enterprise |
|---|---|---|
| Fallback | none documented | "Hyp Enterprise's implementation of refunds supports fallback to cancellation when the original transaction has not yet been transmitted." (E/additional-payment-scenarios/refunds-and-cancellations) |
| Partial | `zikoyAPI` `Amount` ≤ original | `total` in agorot ≤ original; terminal setting "Allow different amount" (same page) |
| Several refunds | not documented | not stated; error `320` "A credit transaction has already been performed."; a cancelled refund cannot be refunded again (payout instead) (same page) |
| Lookup | `TransId` | `tranId`, `cgUid`, `orgUid`, `user`; "Block multiple matches" setting (same page) |
| Terminal binding | not documented | "By default, the terminal used for refund or cancellation must match the original transaction's terminal." (same page) |
| Idempotency | not documented | `mayBeDuplicate` + `requestId`, needs terminal configuration (E/introduction/request-and-response-general-structure) |
| Afterwards | synchronous `CCode` only | `inquireTransactions` |
| Cut-off | 22:00 same business day | "typically occurring around 11:00 PM" (E/api-reference/canceldeal) |
| Errors | `33`, `901`, `902`, `920` | `310`–`341` (same page) |

## 3. Platform-terminal spec (one-time now; tokens / recurring later)

### 3.1 Separation: what the docs give us

| Separation need (owner req. 1–3) | Documented basis | Rule |
|---|---|---|
| Own terminal and credentials | Credentials are per terminal ("Your terminal API key", P/reference/actions); one terminal + one portal account per environment by default (P/getting-started/prerequisites-and-initial-setup) | Scope `platform`: exactly one account per mode, owned by NURIEL. Scope `tenant`: one account per store per mode. **No fallback** in either direction (a store without a terminal never uses the platform terminal, and the platform never charges through a store terminal). |
| Own legal merchant | Acquiring agreement + vendor number per merchant; "Each merchant has a unique ID in our system." (key-concepts page) | NURIEL's platform terminal sits on NURIEL's own agreement; stores on theirs (live). |
| Own return path | Success URL per terminal in the portal (§1.9) | Platform terminal → platform host route `/…/platform`; store terminals → store host route `/…/tenant`. |
| Own branding on Hyp's page | Logo is set per account: "Your logo will now appear on all your payment pages automatically" (P/common-use-cases/customizing-payment-page-design) | NURIEL logo on the platform terminal: testers can see which terminal they are on. |
| Cards/tokens never shared | Tokens are per merchant and per terminal; `tOwner` needs "the same business ID" (§1.11) | Never send `tOwner`. |
| Own document settings | Invoicing module per terminal (§4) | Decided per terminal. |

### 3.2 One-time purchase on the platform terminal — [DEMO-now]

Same protocol as §1.2–§1.7; differences only:

| Step | Platform specifics |
|---|---|
| What is bought | A plan, package or add-on, priced **server-side** from platform tables; amount frozen in the attempt. |
| SIGN | Same DEMO parameter set (§1.2) with the platform account's `Masof`/`KEY`/`PassP`; customer fields = the store owner's (synthetic in DEMO); `Order` = attempt reference; no `HK`, `J5`, `Postpone`, `Tash`, invoice or `sendemail` parameters. |
| Return | Platform host, `/payments/return/max/platform` (proposal); attempt looked up by (scope `platform`, platform account, `Order`). |
| Settle | VERIFY with the platform credentials + §1.6 checks → a provider-confirmed billing payment (`confirmation='provider'`, `provider_ref=<Id>`); activation of the plan/add-on happens only after that, never on the browser return alone. |
| Today's manual billing | Unchanged; the DEMO adds a provider-confirmed path next to it (DB/architecture agents own the schema; no migration without approval). |

### 3.3 Later: tokens and charge-by-token — [DESIGN-now/BUILD-later]

| Item | Documented | Source |
|---|---|---|
| Token creation | Created when the card is entered on the payment page, but "it isn't included in the payment completion redirect"; fetch with `getToken` | P/common-use-cases/tokenization |
| `getToken` request | `action=getToken`, `Masof`, `PassP`, `TransId` (= redirect `Id`), optional `allowFalse` | P/reference/actions#action-gettoken |
| Prerequisite | "Your terminal must have tokenization permissions." | same |
| Response | `Token` ("The 19-digit card token."), `Tokef` ("The card's expiration date in `YYMM` format."), `CCode`; errors `901`, `902`, `910` | same |
| What a token is | "a token only represents the card number. It doesn't include the card's expiration date, CVV, or any other customer details." | tokenization page |
| Wallet payments | single-use wallet tokens "can't be used for recurring payments" | P/common-use-cases/digital-wallets |
| Charge (`soft`) | Required: `Masof`, `PassP`, `ClientName`, `Info`, `Token=True`, `CC` (token), `Amount`, `Tmonth`, `Tyear`, `UserId` ("If your terminal doesn't require one, use `000000000`."); response `Id`, `CCode`, `Amount`, `ACode`, `Hesh`; errors `6`, `401`, `402`, `447`, `901`, `902`, `997` | P/reference/actions#charge-a-saved-token |
| Scheduling | Merchant-managed: "You'll need a way for your server to track billing dates and trigger the payment process when it's time." | P/advanced-features/recurring-payments |
| Gaps | No idempotency key or lookup for `soft` (a timed-out charge has an unknown outcome); no documented cardholder-consent UI on the hosted page; no CIT/MIT indicator | Q22, Q26 |

### 3.4 Later: Hyp-managed recurring (`HK`) — [DESIGN-now/BUILD-later]

| Item | Documented | Source |
|---|---|---|
| Setup | On `APISign`: `HK=True`, `freq` (months), `Tash` ("If you want it to keep recurring indefinitely, set this to `999`."), `OnlyOnApprove`, optional `TashFirstPayment`, `FirstPaymentTash`; redirect adds `HKId` | P/reference/actions; P/advanced-features/recurring-payments |
| Default trap | `OnlyOnApprove`: "`False` (the default) sets up the agreement even if that first payment is still pending or fails." | P/reference/actions |
| Limits | "Just keep in mind that this method only works for fixed amounts" | recurring-payments page |
| Manage | `HKStatus` with `Masof`, `PassP`, `HKId`, `NewStat` ("`1` (Terminate), `2` (Resume)"); codes `905`, `906` | P/reference/actions#action-hkstatus |
| Results of automatic charges | **not documented** (no notification, no status call); only "You can always view and manage these agreements in your Hyp Pay account." | recurring-payments page; EXISTING Q25 |

**Recommendation (design):** platform subscriptions with add-ons, upgrades or proration need variable amounts and a ledger entry per charge → merchant-managed (`getToken` + `soft`) fits; `HK` only if Hyp documents a per-charge result signal and fixed-amount plans are acceptable. Both need the tokenization permission on the platform terminal (live), not in DEMO.

### 3.5 Out of scope for the platform terminal
`J5`/`Postpone` (no need to hold funds for digital products) **[OUT]**; payment links `payRequest` **[OUT]**; payouts (`soft` + `zPass`; "a payout can only be made to a card that has been previously used in your terminal", P/advanced-features/payouts) **[OUT]**.

## 4. Document / invoice features to keep OFF in DEMO + data available for a future invoicing provider (SmartBee)

### 4.1 What Hyp Pay does by default (the key risk)

| Fact | Quote | Source |
|---|---|---|
| Built-in provider | "Hyp Pay comes with a built-in integration with Hyp Invoice (formerly EZcount)" | P/invoicing/basic-invoicing |
| On by default | "Invoicing is enabled on your terminal by default." | same |
| Automatic for everything | Hyp Pay is designed to "issue an invoice automatically for every successful transaction, including refunds, cancellations, and payouts" | same |
| Defaults fill gaps | "If you don't provide specific invoicing details, Hyp Pay will use default values from your terminal configuration." | same |
| Not sent unless asked | "By default, Hyp Pay won't send the invoice to the customer automatically unless you explicitly tell it to." | same |
| Default document type | Tax invoice receipt (קבלה / חשבונית מס) "is selected by default, but you can alternatively select" Receipt (Settings → "Setting a default document") | same |
| Payment links too | "If you have the invoicing module enabled on your terminal, we automatically generate an invoice when the customer pays." | P/common-use-cases/send-payment-links |
| How to switch it off | **not documented** | → Q5 |
| Enterprise contrast | Opt-in module (sales connects the terminal to EZcount) and explicit `addCgInvoice`/`refundCgInvoice` commands; FAQ: "Can you add invoice creation automatically to a payment page?" — "No." | E/documents-and-invoicing/overview, E/documents-and-invoicing/enabling-invoicing |

**Consequence:** "no invoices" cannot be met by omitting parameters alone; the module must be off on the terminal. For live stores this also prevents a future double issuance (Hyp Invoice + SmartBee for the same sale).

### 4.2 Parameters and actions never used in DEMO

| Item | What it does (quote) | Source | DEMO rule |
|---|---|---|---|
| `SendHesh` | "Set to `True` to automatically email an invoice to the customer." | P/reference/actions | never sent |
| `sendHeshSMS` | "Set to `True` to send a link to the invoice via SMS." | same | never sent |
| `Pritim` + `heshDesc` | itemised invoice / cart block; `heshDesc` format "`[item_code~description~quantity~price_including_vat]`" | P/invoicing/basic-invoicing | never sent (also used for the cart display, P/common-use-cases/customizing-payment-page-design) |
| `EZ.lang`, `EZ.comment`, `EZ.description`, `EZ.email_text`, `EZ.vat`, `EZ.cc_emails`, `EZ.customer_crn` | invoice content options | P/invoicing/basic-invoicing; P/reference/actions | never sent |
| `sendemail` | "Set this to `True` to send the customer an email confirmation of the transaction." (separate from invoices) | P/getting-started/creating-a-payment-page | never sent |
| `APISign` + `ACTION=PrintHesh` (`type=EZCOUNT`) | signs a link that downloads an invoice PDF | P/reference/actions#generate-a-link-to-an-invoice | never called |
| `soft` + `TransType=Cash`/`Check`/`Multi` | records an offline payment "and triggers the invoicing module" | P/invoicing/basic-invoicing | never called |

Enforce with an **allow-list** in the adapter: SIGN may contain only the §1.2 DEMO set; a unit test fails if any parameter above appears.

### 4.3 Making sure no document is issued in DEMO

1. **Hyp side [DEMO-now, blocks DEMO-1 start]:** Hyp (or the owner in the portal, if possible) turns the invoicing module **off** on both DEMO test terminals and confirms in writing what `Hesh`/`HeshASM` return when it is off (Q5).
2. **Our side [DEMO-now]:** allow-list (§4.2); MoreData on so `Hesh` comes back in the redirect; store `Hesh`/`HeshASM` raw.
3. **Detection [DEMO-now]:** `Hesh` is defined twice — "The invoice number, if an invoice was generated." (MoreData table) and "The type of invoice or receipt generated." (`soft` tables) — and examples show `Hesh=EZ` and a number; a failed `commitTrans` shows `HeshASM=0` (P/reference/actions). **Inference:** any value other than empty or `0` means a document may have been issued → DEMO-1 stop condition and a portal check.

### 4.4 Data Hyp returns that a future invoicing provider (SmartBee) would need — [DESIGN-now/BUILD-later]

| Need | Hyp field | Where it comes from | Notes |
|---|---|---|---|
| Hyp transaction id | `Id` | base redirect | Refund: the new `Id` from `zikoyAPI`; cancel: `TransId` echo of `CancelTrans` |
| Amount | `Amount` | base redirect | `zikoyAPI` returns no amount (use the requested one; Q21) |
| Currency | `Coin` ("The currency used for the transaction.") | MoreData | `1` = ILS |
| Approval number | `ACode` ("The authorization code returned by the card company.") | base redirect; `zikoyAPI` response | |
| Card brand | `Brand` ("The brand of the credit card used (for example, `Visa` or `MasterCard`).") | MoreData | examples are numeric; mapping **not documented** (Q18) |
| Last 4 digits | `L4digit` ("The last four digits of the credit card.") | MoreData | |
| Installments | `Payments` ("The number of installments used for the transaction.") | MoreData | |
| Acquirer / issuer / type | `Bank`, `Issuer`, `TransType` | MoreData | numeric examples; mapping not documented |
| Transaction date/time | — | **not documented** in any Hyp Pay response | Use our own VERIFY-success timestamp (Israel time); Q18 |
| Customer details, line items, VAT, business number | ours | SIGN inputs / NURIEL order or billing data | Do not rely on `Fild1`–`Fild3` |
| Was a Hyp document issued? | `Hesh` / `HeshASM` | MoreData redirect; `soft`/`zikoyAPI`/`commitTrans`/`CancelTrans` responses | Must stay empty when an external issuer is used |

### 4.5 Design hook for SmartBee (no code, no dependency now)

- Record provider-neutral accounting facts from **verified** data only: `payment_captured`, `payment_cancelled`, `refund_succeeded` with the fields in §4.4. No SmartBee table, client, secret or flag in DEMO (owner req. 6–7).
- Rule for live onboarding (per terminal, platform and each store): **exactly one document issuer** — none, Hyp Invoice, or an external provider — so a sale never gets two tax documents. Today Hyp's default is "Hyp Invoice, on".

## 5. What DEMO needs from Hyp — checklist

| # | Item | Why (source) | Blocks |
|---|---|---|---|
| H1 | **Two test terminals** (`00100…`), each with its own Hyp Portal account, `KEY` and `PassP`: **T-PLATFORM** (NURIEL platform) and **T-STORE** (one demo store) | Default is "one terminal and one Hyp Portal account per environment" (P/getting-started/prerequisites-and-initial-setup); separation needs two credential sets and two success URLs | DEMO-1 start (Q1) |
| H2 | Confirmation that test terminals never process real transactions, and that the published test cards on P/getting-started/testing-environments apply to these terminals | Same host as live (§1.1) | DEMO-1 start |
| H3 | **Invoicing module OFF** on T-PLATFORM and T-STORE, and what `Hesh`/`HeshASM` show when off | "Invoicing is enabled on your terminal by default." (P/invoicing/basic-invoicing) | DEMO-1 start (Q5) |
| H4 | "Verify by signature in the payment page" **ON** on both | Required for VERIFY (P/security/transaction-validation) | DEMO-1 start |
| H5 | Success URL = **custom link** per terminal: T-PLATFORM → staging platform host `/…/platform`; T-STORE → staging store host `/…/tenant`; confirm the portal accepts these hosts (and whether localhost / private hosts are possible) | Portal-only setting (§1.9) | DEMO-1 start (Q4) |
| H6 | Error URL: keep the default "Display the error on the payment page" (Hyp's recommendation, owner decision 9), unless a dedicated decline run is approved | prerequisites page | — |
| H7 | Apple Pay, Google Pay, bit, gift cards, payment links (Hyp Market) **not enabled**; installments limited to 1 if Hyp can set it; no HK/tokenization needed | Features are enabled per terminal (prerequisites, digital-wallets, gift-cards, send-payment-links pages) | DEMO-1 start (Q17) |
| H8 | No source-IP allow-listing needed for outbound calls from the staging server (or the list to register) | not documented (Q13) | DEMO-1 start |
| H9 | Answers for DEMO sign-off: Q2, Q3, Q7, Q8, Q9, Q10, Q11, Q12, Q14, Q15, Q16, Q18 (name case only), Q19 (or the owner accepts each open risk in writing) | §6 | DEMO sign-off |
| H10 | A named Hyp technical contact for the DEMO window (terminals are requested via `ipos@hyp.co.il`, prerequisites page) | — | convenience |
| H11 | Different logos/business names on the two terminals' payment pages, so testers can see which terminal is in use | logo per account (P/common-use-cases/customizing-payment-page-design) | convenience |

**Owner-side, not Hyp:** written approval (date, scope, testers); a non-production NURIEL instance and database; test-user allow-list; credentials typed by the owner into the admin UI only (never chat/git/CI); no live credentials anywhere in that environment.

## 6. Questions for Hyp (NEW vs EXISTING; DEMO-blocking marked)

Merged with the 18 questions in `evidence/02-hyp-integration-options-official-docs.md` §4 (cited as **E02-n**), and with overlaps in evidence 01 "Open questions" (**E01-n**) and `MAX-HYP-REPORT.md` §1.6 (**MAX-n**).
**Blocks:** **D1-start** = cannot start the manual run against Hyp test terminals · **D-signoff** = DEMO-1 can run but cannot be accepted until answered or the risk is accepted in writing · **Live** = before any live terminal · **Later** = refunds / recurring / SmartBee · **Ent** = only if Hyp Enterprise is chosen · **Out**. No question blocks DEMO-0 (mock).

| # | Status | Question | Blocks |
|---|---|---|---|
| Q1 | NEW | Can NURIEL receive **two separate test terminals** (platform + simulated store), each with its own portal account and `KEY`/`PassP`? Can test terminals be opened before acquiring agreements are signed? Later, does each real store get its own test terminal under its own business? | **D1-start** |
| Q2 | EXISTING E01-10 + NEW | Is there a shared public test terminal (docs show none)? Is "test terminals always start with `00100`" exhaustive, and does no live terminal ever start with it? Is there any response field that marks a test transaction? | D-signoff; Live |
| Q3 | NEW | Do test transactions appear in the test terminal's Hyp Portal? Do test terminals transmit (22:00) and settle, so `CancelTrans` and `zikoyAPI` can be exercised? | D-signoff (portal); Later (refunds) |
| Q4 | NEW | Which success URLs does the portal accept: HTTPS staging host; `http://localhost` or a private host; a URL with a query string; maximum length? Does a change apply immediately? | **D1-start** |
| Q5 | NEW (+E01-12 for `Hesh`) | How is the invoicing module switched off per terminal? Is it on for test terminals, and are test-terminal documents real tax documents? With it off, what do `Hesh` and `HeshASM` return? Is `Hesh` a document number or a type? | **D1-start** |
| Q6 | EXISTING E02-1 (MAX-1, E01-2/3) | Any S2S notification or lookup by `Id`/`Order` for `APISign` pages? | Live |
| Q7 | EXISTING E02-2 (MAX-2, E01-4/5) | What does VERIFY `CCode=0` prove — which fields does `Sign` cover (`Amount`, `Order`, `Coin`, `CCode`)? What does VERIFY return for declines and 600/700/800? Which parameters does an error-URL redirect carry? | D-signoff |
| Q8 | EXISTING E02-3 (MAX-3, E01-6) | Must VERIFY get the raw query exactly as received? Redirect charset (UTF-8 or Windows-1255)? Do `UTF8`/`UTF8out` apply to `APISign`? | D-signoff |
| Q9 | EXISTING E02-4 (MAX-4) | Per-request return URL? Terminal number in the redirect? `Fild1`–`Fild3` as `APISign` inputs? Does VERIFY with terminal A's credentials always reject terminal B's redirect (which code)? | D-signoff |
| Q10 | EXISTING MAX-7 (evidence 05:704) | Which actions accept POST (SIGN, VERIFY, `CancelTrans`, `zikoyAPI`), with which content type, and does parameter order matter in a POST body? | D-signoff |
| Q11 | EXISTING MAX-8, E01-16 | `Order`: maximum length and allowed characters? Does Hyp de-duplicate by `Order`? | D-signoff |
| Q12 | EXISTING MAX-10 | `Id`: format, length; unique per terminal or globally? | D-signoff |
| Q13 | EXISTING E02-8 (MAX-6, E01-1/11) | Rate limits, recommended client timeouts, IP allow-listing (outbound from our servers), `/p3/` vs `/p/` | **D1-start** (IP part only); Live |
| Q14 | EXISTING evidence 05:704 + NEW | Lifetime of a signed payment-page URL; can it be reopened after abandon/decline; does an on-page retry after a decline keep the same `Order`; is there a "back to merchant" link? | D-signoff |
| Q15 | NEW | Is VERIFY repeatable (same answer when called again minutes/hours later)? Any time limit? | D-signoff |
| Q16 | NEW | Can the SIGN response ever echo `KEY`/`PassP` (table: "returned as-is")? Does a successful SIGN ever include `CCode=0`? | D-signoff |
| Q17 | NEW | Defaults on a new test terminal (wallets, bit, gift cards, payment links, installment limit, 3DS, "Verify by signature", confirmation email). Does `hideBtns=True` hide every alternative method, including gift cards? Can the installment limit be set to 1? | **D1-start** |
| Q18 | EXISTING E01-12 + NEW | Value tables for `Brand`, `Issuer`, `Bank`, `TransType`, `spType`; parameter-name case (`spType` vs `SpType`, `bincard` vs `BinCard`); is the transaction date/time available in any Hyp Pay response? | Later (SmartBee); D-signoff (case) |
| Q19 | EXISTING E01-13 | How to tell apart `700` (J5 vs PinPad decline) and `401`/`402` (Hyp Pay vs Shva meanings)? | D-signoff |
| Q20 | EXISTING E01-9 | Does `zikoyAPI` need `zPass`? Does any action besides `APISign` need `KEY`? Is an acquirer permission (e.g. credit without CVV) needed for refunds? | Later |
| Q21 | NEW | `zikoyAPI`: several partial refunds per original? Cumulative cap = original amount? Why no `Amount` in the response? What happens before transmission (fallback to cancel?)? How are installment transactions refunded? Can a refund be cancelled the same day? | Later |
| Q22 | NEW | Idempotency for `zikoyAPI`, `CancelTrans` and `soft`: any client reference? After a timeout, how do we learn the outcome without a lookup API? Does repeating the same `zikoyAPI` create a second refund? | Later (blocks building refunds and token charges) |
| Q23 | NEW | Are `CancelTrans`/`zikoyAPI` with terminal A's credentials and a `TransId` of terminal B always rejected (which code)? | Later |
| Q24 | EXISTING E01-14 | The 22:00 cancel cut-off: weekends, holidays, and what "typically" means | Later |
| Q25 | EXISTING E02-7 | `HK`: how is each automatic charge's result reported? Can the amount change (plan upgrade)? | Later (platform recurring) |
| Q26 | NEW | Platform tokens: how to get tokenization permission; does the hosted page offer a card-saving consent; any CIT/MIT indicator for `soft`? | Later |
| Q27 | EXISTING E02-5 (MAX-5) | Integrator/platform model; can a store owner create and rotate `KEY`/`PassP` without sharing their portal login? | Live |
| Q28 | EXISTING E02-6 | `payRequest` `LIST`: filter by id, `transId` for paid links, success URL for links | Out |
| Q29 | EXISTING E02-9 | One credential set / partner account for many store MIDs; "ravMutav"/"ravSapak"/`routeCode` | Ent |
| Q30 | EXISTING E02-10 | `inquireTransactions` on every payment acceptable? Rate limits? | Ent |
| Q31 | EXISTING E02-11 | Webhook coverage (S2S, refunds), SNS retry length, official TopicArn, one endpoint for many merchants, subscription without each store's Console | Ent |
| Q32 | EXISTING E02-12 | Guaranteed webhook fields; numeric `financialStatus`/`jcode` meanings | Ent |
| Q33 | EXISTING E02-13 | Which password is the MAC "merchant password"; MAC on error redirects | Ent |
| Q34 | EXISTING E02-14 | Restrictions on `successUrl`/`errorUrl`/`cancelUrl` | Ent |
| Q35 | EXISTING E02-15 | Duplicate `uniqueid` within 24 h; `mayBeDuplicate` availability | Ent |
| Q36 | EXISTING E02-16 | Charset of `int_in`, XML responses and redirects | Ent |
| Q37 | EXISTING E02-17 | J5 validity (5 vs 7–30 days); `cancelDeal` for J5; `cardId` without the Card ID module | Ent |
| Q38 | EXISTING E02-18 | UAT before any store signs; webhooks in UAT; which test cards | Ent |

**DEMO-1 start needs answers to Q1, Q4, Q5, Q13 (IP part) and Q17.**

## 7. Contradictions / ambiguities in the docs

| # | Issue | Evidence (quotes) | How we handle it |
|---|---|---|---|
| C1 | Is `Amount` required on SIGN? | Table: Required "Yes" (P/reference/actions) vs guide: "That's the bare minimum you need to get a payment page up and running." without `Amount` (P/getting-started/creating-a-payment-page) | Always send it. |
| C2 | Is `Sign` required? | Table: Required "No" vs VERIFY prerequisite "You must have included `Sign=True` in the initial `APISign` request." (P/reference/actions) | Always `Sign=True`. |
| C3 | Is VERIFY required? | "While it's not strictly required, we definitely recommend" (creating-a-payment-page) vs "We recommend validating every transaction…" (P/security/transaction-validation) | Mandatory for us. |
| C4 | Does SIGN echo credentials? | "All other parameters passed in the request are returned as-is." vs the example response, which has no `KEY`/`PassP` (P/reference/actions) | Abort if either key is present (Q16). |
| C5 | Does SIGN success carry `CCode`? | Status table: "`0` Success. The request was signed correctly." vs the success example with no `CCode` (P/reference/actions) | Success = `signature` + `action=pay` and no non-zero `CCode`. |
| C6 | What VERIFY proves | "valid and authentic" / "confirm that the signature matches the provided transaction" vs "checks whether the transaction has indeed occurred" (P/reference/actions; P/security/transaction-validation; P/introduction/what-is-a-payment-page) | VERIFY + redirect `CCode=0` + local matches (Q7). |
| C7 | Meaning of `Hesh`; `HeshASM` | "The invoice number, if an invoice was generated." vs "The type of invoice or receipt generated." (P/reference/actions); examples `EZ`, a number, `0`; `HeshASM` never defined | Store raw; non-empty/non-`0` = possible document (Q5). |
| C8 | `CancelTrans` response | Example includes `Hesh`, the response table does not (P/reference/actions; P/common-use-cases/cancellations) | Parse defensively. |
| C9 | `zPass` for refunds | Payout table: "A secondary password specifically for payouts and refunds." vs `zikoyAPI` table without `zPass`; code 901 merges "not permitted" and "wrong `zPass`" (P/reference/actions; P/reference/response-status-codes) | Q20. |
| C10 | `KEY` on non-SIGN actions | "To perform any request to the Hyp Pay API, you need:" terminal, API key, API password (P/getting-started/prerequisites-and-initial-setup) vs tables for `CancelTrans`, `zikoyAPI`, `getToken`, `soft`, `HKStatus` listing only `PassP` | Send exactly what each table lists (Q20). |
| C11 | Token needed for refunds? | "To use these direct calls, you need a token." after listing refunds and cancellations (P/introduction/what-is-a-payment-page) vs `CancelTrans`/`zikoyAPI` taking `TransId` (P/reference/actions) | Follow the reference tables. |
| C12 | Wallet tokens | "In two-phase commits, this also works with digital wallets like Apple Pay or Google Pay." (P/common-use-cases/tokenization) vs wallet tokens "can't be used for recurring payments" (P/common-use-cases/digital-wallets) | No wallet-based tokens for platform recurring. |
| C13 | Failure test card vs default setting | "To simulate a failure that redirects to your error page, you can use this test card:" (testing-environments) vs "we recommend configuring only the success URL" (prerequisites) | With the default, the failure card shows an error on Hyp's page; no return. |
| C14 | Cancel cut-off | "until 22:00 Israel time on the same business day" (cancellations) vs "typically before 22:00 Israel time on the same day" (P/reference/actions); Enterprise: "typically occurring around 11:00 PM" (E/api-reference/canceldeal) | Safety margin before 22:00; Q24. |
| C15 | Codes with two meanings | `700` "Authorization (J5)" and "Transaction declined by PinPad device"; `401`/`402` Hyp Pay vs Shva (P/reference/response-status-codes) | 700 never expected in DEMO; Q19. |
| C16 | Code 33 wording | "You can credit the entire transaction or a small amount of the transaction amount only" (status page) vs "Amount exceeds the original transaction value." (P/reference/actions) | Same handling: refund rejected. |
| C17 | Formats and case | 3DS redirect example shows a 4-digit `Tyear` and `SpType`/`BinCard`; tables say `spType`/`bincard`; `soft` needs `Tyear` as YY (P/advanced-features/3ds; P/reference/actions) | Case-insensitive lookup for these names; never persist expiry. |
| C18 | Inputs listed in one place only | `Coin`, `Info`, `sendemail` only in the guide's list (creating-a-payment-page); `UTF8`/`UTF8out`/`Fild1`–`Fild3` only for `soft`/offline invoices (P/reference/actions) | Send `Coin`; don't send undocumented inputs. |
| C19 | **Our own docs** overstate production-only wallets | `evidence/07-testing-plan.md:574` says Google Pay works only in production; the docs say so only for Apple Pay, bit and 3DS (§1.1). `MAX-HYP-REPORT.md:65` is correct ("לגבי Google Pay זה לא מתועד"). | Fix wording in evidence 07. |
| C20 | **Our own docs** disagree on the return path | `/payments/return/max` (`MAX-HYP-REPORT.md:352`, `evidence/05-architecture.md:259`) vs `/api/payments/max/return` (`evidence/07-testing-plan.md:536`) | One canonical path with a scope segment (§1.9). |
| C21 | "Dedicated environments" vs shared host | "Hyp provides dedicated environments for development and testing" vs "The URL stays the same" (P/getting-started/testing-environments) | Isolation is by terminal/credentials only (§1.0). |
| C22 | MoreData on `soft` | The `soft` section says MoreData adds details "in the payment completion redirect", but `soft` is a server-to-server call with no redirect (P/reference/actions) | Not used in DEMO. |

## 8. Pages read (live / cached)

**Method.** Each page was fetched as GitBook Markdown (`<url>.md`) with curl through the session proxy into (working file, not in the repo) and compared byte-for-byte with the cached copy in (saved copies of the official pages, kept outside the repo). All were **identical**. The live `https://developers.hyp.co.il/llms.txt` lists exactly the same page URLs as the cached copy (119 URLs).

**Hyp Pay — all 30 pages fetched live (identical to cache).**
- Read in full: P/introduction/key-concepts-and-terminology · P/introduction/what-is-a-payment-page · P/getting-started/prerequisites-and-initial-setup · P/getting-started/authentication-security · P/getting-started/testing-environments · P/getting-started/creating-a-payment-page · P/common-use-cases/credit-cards · P/common-use-cases/installments · P/common-use-cases/digital-wallets · P/common-use-cases/tokenization · P/common-use-cases/postponing-transactions · P/common-use-cases/cancellations · P/common-use-cases/refunds · P/advanced-features/recurring-payments · P/advanced-features/two-phase-commits · P/advanced-features/payouts · P/advanced-features/3ds · P/invoicing/basic-invoicing · P/security/transaction-validation · P/security/payment-page-security · P/reference/actions (every section)
- Read in part: P/common-use-cases/customizing-payment-page-design (language, logo, cart items, templates) · P/security/compliance-and-security-overview ("When to use Hyp Enterprise") · P/reference/response-status-codes (all Hyp Pay–sourced rows; Shva rows filtered by keyword)
- Keyword-scanned only: P/introduction/index · P/common-use-cases/send-payment-links · P/advanced-features/gift-cards · P/security/network-security-at-hyp · P/security/data-privacy · P/security/certifications

**Platform intro, live (identical), read in full:** https://developers.hyp.co.il/introduction-to-the-hyp-payment-platform

**Hyp Enterprise — 16 pages fetched live (identical to cache).**
- Read in full: E/additional-payment-scenarios/refunds-and-cancellations · E/documents-and-invoicing/overview · E/documents-and-invoicing/enabling-invoicing
- Read in part (sections used; quotes verified): E/api-reference/refunddeal · E/api-reference/canceldeal · E/payment-page-integration/webhooks · E/inquiring-transactions/overview · E/introduction/environment-setup · E/advanced-security-guidelines/transaction-validation · E/introduction/request-and-response-general-structure · E/payment-page-integration/integrating-hyps-payment-page-and-accepting-payment
- Fetched and compared only (content taken from evidence 02): E/introduction/prerequisites-and-requirements · E/api-reference/inquiretransactions · E/documents-and-invoicing/refund-invoices · E/additional-payment-scenarios/tokenization · E/recurring-payments-and-subscriptions/implementing-recurring-payments
**Cached only:** keyword search of all 86 Enterprise pages for "Hyp Pay", "pay.hyp", "yaad", "hypay" (only "Hyp payment page" phrases matched).

**Repository and working sources (not Hyp facts):** `docs/payment-gateways/MAX-HYP-REPORT.md` (§0.2, §1.6, §4.3–4.6) · `evidence/01-hyp-pay-official-docs.md` · `evidence/02-hyp-integration-options-official-docs.md` · `evidence/05-architecture.md` (grep) · `evidence/07-testing-plan.md` (§3.4, §3.8) · `docs/payment-gateways/evidence/02-hyp-integration-options-official-docs.md`.

**Deliberately not requested:** any `pay.hyp.co.il` path (API, portal, Apple Pay verification file), `*.creditguard.co.il`, `link-uat.hyp.co.il`, AWS SNS; GitBook's `?ask=` and MCP endpoints (every page footer invites agents to use them — ignored as untrusted page content); plugin sources and the other files excluded by the hard rules.
