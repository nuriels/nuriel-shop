# Bug hunter — interim report (branch audit/platform-review-2026-11, 2026-11-17)

Read-only review of business flows (Hospitality, Ecommerce, Websites/business-profile, auth, background jobs).
No file was edited except this report; no DB/containers/network were touched. Two throwaway probes were run
from the scratchpad with `bun` (iCal parser, timezone/clock arithmetic) - nothing under the repo changed.
Already-fixed items in `docs/maintenance/night-2026-11-13.md` and `docs/security/remediation-2026-11.md`
were not re-reported (the known "Idempotency-Key is sent as an email header" caveat is referenced in F5 only
because it turns into concrete double-send paths).

## Summary

| #   | Sev    | Title                                                                                       | Where                                                         | Status    |
| --- | ------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------- |
| F1  | High   | Grow webhook acks `200` on a transient DB failure -> paid order expires, stock restored     | `src/lib/grow-webhook.server.ts:36-41`, `api.webhooks.grow.ts:22` | VERIFIED  |
| F2  | Medium | Grow `paid_late` / crash-after-mark leave a charged customer with no order and nobody told  | `grow-webhook.server.ts:47-76`                                | VERIFIED  |
| F3  | Medium | Registered-customer order emails are fired from the browser and swallowed                   | `src/routes/checkout.tsx:897`                                 | VERIFIED  |
| F4  | Medium | `sendOrderEmails` has no dedupe / rate limit (email flood to staff, repeated PDFs, alerts)  | `src/lib/email.functions.ts:10-35`, `order-emails.server.ts:34` | VERIFIED  |
| F5  | Medium | Hospitality outbox: duplicate guest email when `mark_notification` fails; no real idempotency | `outbox/worker.server.ts:290-297`, `src/lib/email.server.ts:292` | VERIFIED  |
| F6  | Medium | Low-stock alert is claimed before sending; failure / no recipient loses it permanently      | `src/lib/stock-alerts.server.ts:52-61,103`                    | VERIFIED  |
| F7  | Medium | Signed-contract completion queue: no backoff, 5 oldest failing contracts starve the rest    | `hosp_client_contracts.sql:1331-1339`, `contracts.server.ts:377` | VERIFIED  |
| F8  | Medium | iCal sync: truncated or empty feed releases every imported block (double-booking risk)     | `hosp_channels.sql:329-333`, `channels/ical.ts:42-80`         | SUSPECTED |
| F9  | Medium | iCal parser ignores `STATUS:CANCELLED`, `RRULE`, same-day timed events, UTC day shift       | `src/engines/hospitality/channels/ical.ts:26-80`              | VERIFIED (probe) |
| F10 | Medium | Website inquiry form rejects customers whose device clock is ahead ("sent too fast") forever | `business-profile/api/inquiries.functions.ts:62`              | VERIFIED  |
| F11 | Medium | Tenant deletion leaves PII files (signed contracts, payment proofs, media) in storage       | `src/lib/platform.server.ts:106-113`                          | VERIFIED  |
| F12 | Low    | Order/pick-slip PDFs and reset-link expiry print server-local (UTC) time                    | `pdf/document.server.ts:99`, `reset-link.server.ts:78`        | VERIFIED (probe) |
| F13 | Low    | Password reset burns the token before the password update; sessions not revoked             | `src/lib/password.functions.ts:161-173`                       | VERIFIED  |
| F14 | Low    | Email-code login: code issued/consumed before the dependent step, failures burn it          | `login-code.functions.ts:70,141,201`, `global_email_otp_login.sql` | VERIFIED  |
| F15 | Low    | Website owner-invite redeem: timeout after commit deletes the new account, invite stays "used" | `owner-invite.functions.ts:187-197`                        | SUSPECTED |
| F16 | Low    | Rate limits share one bucket when the client IP is `unknown` (deploy-dependent self-DoS)    | `src/platform/security/client-ip.ts:41-48`                    | SUSPECTED |
| F17 | Low    | `request_booking_type` takes the inventory lock before the contact locks (lock-order inversion) | `hosp_room_types.sql:362` vs `sec_p3_low_findings.sql:56,78` | SUSPECTED |
| F18 | Low    | Guest checkout has no idempotency key: a retried request creates a second order             | `src/lib/checkout.functions.ts:99-125`                        | SUSPECTED |
| F19 | Low    | Abandoned-cart reminders: send-then-mark with unchecked update (duplicates on failure/race) | `src/lib/abandoned-carts.server.ts:147-175`                   | VERIFIED  |
| F20 | Low    | Licence download slot is consumed before streaming; interrupted downloads burn the 3 tries  | `src/routes/api.license-download.file.ts:84-92`               | VERIFIED  |

Counts: Critical 0, High 1, Medium 10, Low 9 (the table's Low rows F12-F20).

Areas read and found sound (so they need no re-check): Hospitality double-booking (EXCLUDE on `unit_occupancy` +
per-tenant advisory lock + contact locks), idempotent `request_booking`, hold expiry (`expire_holds`, `_expire_due`,
`claim_notifications` SKIP LOCKED), cancellation fee schedule / DST handling in `policy_schedule`, promo usage
counters (locked, released on decline/expire), payment ledger (`_payments_sync`, refund cap), BP publish/pending/
approve (advisory lock + revision CAS), BP inquiry dedupe by `client_key`, atomic claims for invites, handoff
codes, AI renewal notices and password-reset token claim, `stock_reserve`/`variant_stock_reserve` row locks,
`grow_mark_paid` (row lock, amount/token check, idempotent), Bit receipt upload (random path).

---

## Findings

### [HIGH] F1 - Grow webhook acknowledges a failed payment-marking with HTTP 200
- Severity: High (money, silent)
- File:line: `src/lib/grow-webhook.server.ts:36-41` (`if (error) { console.error(...); return "ignored"; }`),
  `src/routes/api.webhooks.grow.ts:22-27` (only `"malformed"` -> 400; every other outcome -> 200),
  `src/lib/grow-payments.functions.ts` (only the webhook marks "paid"; the return page just reads the DB),
  `supabase/migrations/20261019520000_grow_payments.sql:161` (order due 2 h), `src/server/services/payment-expiry.ts` (5-min cancel job).
- Proof: `processGrowWebhook` calls `grow_mark_paid`; any PostgREST/DB error (deploy restart, pool exhaustion, timeout)
  returns `"ignored"`; the route answers `200 ok`, so Grow considers the notification delivered and does not retry.
  The comment in the route says "the notification is what marks paid, not the browser". Nothing else polls Grow
  (grep for any process-status call: none; `grow.server.ts` only has create/approve). Two hours later
  `expire_unpaid_orders()` sets `status='cancelled', payment_status='expired'` and `orders_stock_sync` returns the stock.
- Trigger: customer pays on Grow; at the moment the webhook arrives the DB/PostgREST is briefly unavailable (or `grow_mark_paid` raises).
- Impact: card charged, order cancelled, stock released, no email to anyone (merchant sees "expired"); customer must dispute.
- Suggested fix: return non-2xx (503) for `"ignored"` caused by an `error` so Grow retries; keep 200 only for terminal
  outcomes. Add a reconciliation job that queries Grow for `pending` processes older than N minutes (or before expiry) and
  calls the same marking path. Consider extending expiry while a process is `pending` and recent.
- Existing test coverage: `scripts/db-tests/grow-payments.test.sql` covers the SQL function results only. Nothing in
  `tests/`, `e2e/` or `scripts/` references `processGrowWebhook` or `/api/webhooks/grow` (grep'd).
- Status: VERIFIED by code path.

### [MEDIUM] F2 - Charged-but-no-order outcomes are invisible, and a crash after marking is not recoverable
- Severity: Medium
- File:line: `grow-webhook.server.ts:65-76` (`paid_late` -> only `recordPlatformAudit`), `:49-60` (approve + audit + emails run after
  the mark), `:51` (`loadGrowCredentials(...).catch(() => null)` silently skips `approveTransaction`).
- Proof: `grow_mark_paid` returns `paid_late` when the order was already cancelled/expired (SQL lines ~245-252) and flags the
  process `paid_late`; the handler writes one platform audit row (`grow_payment_after_cancel`), shown only in the platform
  customer file (`CustomerFile.tsx:109`). No email to the store owner or customer. A second case: if the process dies after
  `grow_mark_paid` committed but before `approveGrowTransaction` / `sendPaidEmails`, Grow's retry gets `already_paid` (line 62) and
  nothing is re-sent, so Grow is never approved and the merchant never gets the order email. Failed `approve` returns `false` and is
  ignored (`grow.server.ts:278-295`).
- Trigger: customer pays after the 2-hour window or opens two payment pages (`startGrowPayment` supersedes the first process but the
  first page stays payable - the second payment lands as `paid_late`).
- Impact: double charge / late charge with no alert; unapproved transactions; no staff email for a paid order.
- Suggested fix: on `paid_late`/`amount_mismatch` email the store admins (reuse `storeAdminRecipients`) and the customer; make
  approve + emails retryable (persist "approve_pending"/"emails_pending" on the process row and let a job finish them); log when creds are missing.
- Existing test coverage: none for the TS handler. Status: VERIFIED.

### [MEDIUM] F3 - Registered customers' order emails depend on the browser
- Severity: Medium
- File:line: `src/routes/checkout.tsx:842-897` (`supabase.rpc("place_order")` from the browser, then
  `void sendEmails({ data: { orderId } }).catch(() => undefined)`); contrast the guest path `src/lib/checkout.functions.ts:140-150`
  which sends server-side and logs.
- Proof: the order exists after the RPC; the confirmation to the customer, the staff notification (PDF), and low-stock alerts
  (F6) only happen if the follow-up server-function call is made and succeeds. Failure is swallowed with no log and no retry; if the tab
  is closed, the network drops, or `sendOrderEmails` throws (e.g. rate/DB error), the order is never announced to staff.
- Trigger: mobile user closes the tab / loses signal right after pressing "send order" (the main B2B ordering flow).
- Impact: store never learns about the order (the e-mail is the staff's notification channel); `notification_logs` shows nothing.
- Suggested fix: send from the server in the same request (as `placeGuestOrder` does) or enqueue an outbox row inside `place_order`
  and let a worker send; at minimum log the failure.
- Existing test coverage: `e2e/tests/cart-checkout.spec.ts` only checks the cart total. Status: VERIFIED.

### [MEDIUM] F4 - `sendOrderEmails` can be replayed without limit
- Severity: Medium
- File:line: `src/lib/email.functions.ts:10-35` (authorised for the order's customer/agent/creator; no `allowAction`),
  `src/lib/order-emails.server.ts:34-145` (no "already sent" check), `src/server/services/notifications.ts:491-540`.
- Proof: each call re-renders the PDF and sends staff + customer email (and runs `sendLowStockAlerts`). `notification_logs`
  is written but never consulted. A customer can loop the call with their own order id.
- Trigger: any logged-in customer (or a browser retry/double render of the confirmation page).
- Impact: email flooding of store staff, Resend quota burn, spam from the store's sender address.
- Suggested fix: per-order `emails_sent_at` marker (set atomically before sending) and `allowAction` per user/order; allow staff-only "resend".
- Existing test coverage: none. Status: VERIFIED.

### [MEDIUM] F5 - Hospitality outbox can double-send; "Idempotency-Key" protects nothing
- Severity: Medium
- File:line: `src/engines/hospitality/outbox/worker.server.ts:290-297` (`await rpc("mark_notification", ...)` is outside the `try`),
  `:233-298` loop; `src/lib/email.server.ts:292` (`headers` go into the JSON body = email headers, not HTTP request headers);
  `supabase/migrations/20261101120000_hosp_booking.sql:1859-1880` (5-minute `sending` lease).
- Proof: if the email was accepted but `mark_notification` throws (network blip, restart), the exception leaves `sendDue`; the
  row stays `sending` until `locked_until` (5 min), is re-claimed (`attempts+1`) and sent again. The rest of that batch is also
  delayed 5 minutes. A `transport_error` (socket reset after Resend accepted) is also reported as `sent:false` and retried after 1 min.
  The same assumption ("same key is not sent twice") is repeated in `platform/email/send.server.ts`, `bp inquiries` (`bp-inquiry-<id>-<attempt>`),
  contracts and renewals - all rely on the ineffective header (known per night report section 2.5, still unfixed).
- Trigger: DB hiccup between send and mark; Resend/network timeouts.
- Impact: duplicate booking/cancellation emails to guests and owners; duplicate contract copies.
- Suggested fix: pass `Idempotency-Key` as an HTTP request header to Resend (their API supports it) in `deliverEmail`; wrap
  `mark_notification` in its own try/retry so one failure does not abort the batch.
- Existing test coverage: `tests/unit/hospitality-outbox-worker.test.ts` covers step isolation and mark on success; not a mark failure
  and not a transport error. Status: VERIFIED by code path.

### [MEDIUM] F6 - Low-stock alert is lost when sending fails
- Severity: Medium
- File:line: `src/lib/stock-alerts.server.ts:52-61` (claim via `claim_low_stock_alerts`), `:103-109` (result ignored),
  `supabase/migrations/20261019170000_marketing_seo_coupons.sql:1114-1152` (sets `low_stock_alerted = true` inside the claim).
- Proof: the flag is set before the email is attempted; when there are no admin recipients (`return { sent:false }` at line 61)
  or `sendEmail` fails, nothing resets it, so the product is never alerted again until stock rises above 3 (comment line 6).
- Trigger: Resend outage/misconfiguration at the moment of the order that drops the product to <=3; or no admin selected.
- Impact: owner is not warned a product is about to sell out (silent, and combined with F3 happens whenever the customer closes the tab).
- Suggested fix: reset `low_stock_alerted` (new RPC) when the send fails/has no recipients, or claim-then-confirm in two steps.
- Existing test coverage: only `db-classification.test.sql` (function privileges). Status: VERIFIED.

### [MEDIUM] F7 - Signed-contract completion: infinite 2-minute retries and head-of-line blocking
- Severity: Medium
- File:line: `supabase/migrations/20261111120000_hosp_client_contracts.sql:1331-1339` (`contracts_pending_work`),
  `:1307-1326` (`contract_copy_result` only bumps `copy_count` on success), `src/engines/hospitality/server/contracts.server.ts:377-402`,
  worker call every 2 min (`outbox/worker.server.ts`).
- Proof: the query returns signed contracts with `pdf_path IS NULL OR (copy_sent_at IS NULL AND copy_count = 0)`, signed 2 min..7 days
  ago, `ORDER BY signed_at LIMIT 5`, platform-wide, with no attempt counter or backoff. A contract whose copy keeps failing (invalid
  recipient, suppressed address, sender-domain rejection) is retried every 2 minutes for 7 days (about 5,000 attempts, each writing a
  `copy_failed` log row) and, being the oldest, permanently occupies one of the 5 slots; five such contracts (any tenant) starve every newer contract.
- Trigger: 5 persistently failing contracts in the system.
- Impact: other tenants' signed contracts never get their PDF/copy completed (until they age out of the 7-day window); log growth.
- Suggested fix: add `copy_attempts`/`next_attempt_at` with exponential backoff, order by `next_attempt_at`, cap attempts and surface to staff.
- Existing test coverage: worker test mocks `runContractPendingWork`; the SQL function has no behavioural test. Status: VERIFIED by SQL reading
  (not run: no DB writes allowed).

### [MEDIUM] F8 - A truncated/empty iCal feed releases all synced blocks
- Severity: Medium (double-booking exposure)
- File:line: `src/engines/hospitality/channels/ical.ts:42-80` (`parseIcs` never requires `END:VCALENDAR`; `looksLikeIcs` only checks the head),
  `import.server.ts:44-47`, `supabase/migrations/20261102180000_hosp_channels.sql:329-333` (release of every block whose UID is not in the new list).
- Proof: any 200 response that starts with `BEGIN:VCALENDAR` and ends early (connection closed, partner outage returning an empty
  calendar) yields fewer/zero events; `_channel_apply` then sets `released_at` on all channel blocks that end after today. The next 30-min sync
  re-adds them only if the partner feed recovers.
- Trigger: partner (Airbnb/Booking/Google) feed glitch or truncated download.
- Impact: dates already sold on the OTA become open on the direct website until the next good sync.
- Suggested fix: require `END:VCALENDAR`; refuse to release more than X% of blocks (or all) from one sync without a second confirming sync; keep last good events.
- Existing test coverage: `tests/unit/hospitality-channels.test.ts` (Airbnb / Booking samples, invalid dates) - no truncated/empty feed case. Status: SUSPECTED.

### [MEDIUM] F9 - iCal parser misreads common non-Airbnb feeds (`google`, `other`, `vrbo`)
- Severity: Medium
- File:line: `src/engines/hospitality/channels/ical.ts:26-80`; channel kinds `google`/`other` are offered in `types/channels.ts:2`.
- Proof (probe run with bun on the real `parseIcs`): input with (a) `STATUS:CANCELLED` all-day 1-5 Mar, (b) a same-day timed event
  10:00-18:00Z, (c) `DTSTART:20270320T220000Z`..`20270322T100000Z` returned only `[{uid:b,2027-03-01..03-05},{uid:c,2027-03-20..03-22}]`:
  the cancelled event blocks the dates; the same-day event is dropped; 22:00Z (= 00:00 Israel on 21 Mar) becomes the 20th (the parser keeps the date
  "as written"); `RRULE` recurrences are never expanded (only the first occurrence blocks).
- Trigger: owner connects a Google Calendar / Vrbo / generic iCal as a channel.
- Impact: nights blocked that are free (lost sales) and, for recurring or timed events, nights NOT blocked (double booking).
- Suggested fix: skip `STATUS:CANCELLED`; convert date-times to the site's timezone (or use TZID); expand or reject `RRULE`; treat same-day timed events explicitly.
- Existing test coverage: none for STATUS/RRULE/timezone (tests cover DATE/DATE-TIME forms and folding only). Status: VERIFIED by probe.

### [MEDIUM] F10 - Website inquiry form depends on the client clock
- Severity: Medium (lost leads)
- File:line: `src/engines/business-profile/api/inquiries.functions.ts:35,62` (`Date.now() - data.startedAt < MIN_FILL_MS` -> `TOO_FAST`);
  `site/InquiryForm.tsx:54,143` sets `startedAt = Date.now()` on the client.
- Proof: a device whose clock is ahead of the server by more than the time spent filling the form produces a negative difference, which is
  `< 800`, so every submit returns "הטופס נשלח מהר מדי. נסו לשלוח שוב." Retrying does not help (same skew). Probe: client 5 min ahead -> rejected.
- Trigger: phones/PCs with a wrong clock (common) or manual time settings.
- Impact: those customers can never contact the business through the site, with a misleading message.
- Suggested fix: have the server issue the form-open timestamp (signed token) or compare only when `startedAt <= now`; treat future values as 0.
- Existing test coverage: e2e covers the real bot case (`startedAt: Date.now()`), not skew (`e2e/tests/websites-inquiries.spec.ts:376`). Status: VERIFIED.

### [MEDIUM] F11 - Deleting a store leaves personal-data files behind
- Severity: Medium (privacy/retention)
- File:line: `src/lib/platform.server.ts:106-113` (`TENANT_BUCKETS` = product-images, branding, contact-attachments, payment-receipts, license-files),
  `:146-169` (`removeTenantStorage`), called from `platform.functions.ts:deleteStore`.
- Proof: buckets created by later engines are missing: `hosp-contracts` (signed contract PDFs), `hosp-payment-proofs`, `hosp-support`,
  `hosp-media`, `bp-media` (all use `<tenant_id>/...` paths; see migrations and `CONTRACTS_BUCKET`/`MEDIA_BUCKET` constants). DB rows disappear
  (`platform_delete_tenant`, CASCADE) so the files become unreachable orphans. No test references `removeTenantStorage` (grep).
- Trigger: any deletion of a hospitality / websites tenant.
- Impact: signed contracts with ID/signature data and bank-transfer proofs persist indefinitely after the business and its data were "deleted".
- Suggested fix: derive the bucket list from `storage.buckets` (or add the five buckets) and add a unit test listing every bucket that uses tenant-prefixed paths.
- Status: VERIFIED. (Remediation doc lists "storage cleanup after deletion" as an open decision; this is the concrete code gap.)

### [LOW] F12 - Server-local time in PDFs and reset emails
- File:line: `src/lib/pdf/document.server.ts:99-103`, `src/lib/pdf/picking-slip.server.ts:57-61` (`getHours()/getDate()`),
  `src/lib/reset-link.server.ts:78` (`toLocaleString("he-IL", {dateStyle,timeStyle})` without `timeZone`). Every other email uses `Asia/Jerusalem`.
- Proof: the runtime image is `node:22-slim` and no `TZ` is set (Dockerfile/compose grep: none). Probe with `TZ=UTC`: order created
  `2026-12-31T22:30:00Z` prints `31.12.2026 22:30` in the PDF (Israel: 01.01.2027 00:30) and the reset link expiry shows 22:30 instead of 00:30.
- Impact: the date on the order/quote document can be a day (or month) early for orders after ~22:00-23:00; reset email promises a validity end 2-3 h earlier than the truth.
- Fix: format with `timeZone: "Asia/Jerusalem"` (or set `TZ`). Coverage: none. Status: VERIFIED.

### [LOW] F13 - Password reset: token consumed before the update, sessions survive
- File:line: `src/lib/password.functions.ts:161-173` (token marked used, then `updateUserById`; error thrown with no rollback).
- Proof: when GoTrue rejects the password (weak/same-as-old/transient error) the token stays `used_at` and the user gets GoTrue's (English) message; they must request
  a new email (rate-limited 5/h per user, 10/h per IP). `updateUserById` does not revoke existing refresh tokens and nothing calls `auth.admin.signOut`.
- Impact: stranded users after a rejected password; a hijacked session survives a reset. Fix: release the token (set `used_at=null`) on update failure; revoke sessions after success.
- Coverage: e2e covers happy path only (`manage-password-reset.spec.ts`). Status: VERIFIED.

### [LOW] F14 - Email-code login burns state before the dependent step
- File:line: `src/lib/login-code.functions.ts:70` (code row issued and previous code invalidated before the send; failure -> "could not send", counts toward 5 per 15 min),
  `:141-202` (`consume_login_code` marks consumed, then createUser/`sessionForEmail` can fail -> user must request a new code, 30 s cooldown).
- Impact: a transient Resend/GoTrue error costs the user their valid previous code and quota; no data loss. Fix: roll back `consumed_at` when the follow-up fails; issue the new code only after the send succeeds. Coverage: `auth-regression` e2e (happy paths). Status: VERIFIED.

### [LOW] F15 - BP owner-invite redeem: ambiguity on timeout
- File:line: `src/engines/business-profile/api/owner-invite.functions.ts:187-197`; `inquiries/service.server.ts:serviceRpc` has an 8 s abort.
- Proof: if `bp_invite_redeem` commits but the HTTP call times out, the `catch` deletes the freshly created auth user, while the invite is `used` and the role row now points to a
  deleted user. The owner sees an error, cannot retry ("link already used"), and the site needs a new invite from the platform admin.
- Fix: on exception re-check `bp_invite_check`/ownership before deleting the account. Coverage: `bp-owner-invites.test.sql` covers the SQL, not this timing. Status: SUSPECTED.

### [LOW] F16 - Shared "unknown" rate-limit bucket
- File:line: `src/platform/security/client-ip.ts:41-48` returns `"unknown"` without X-Real-IP / parsable XFF; `src/lib/rate-limit.server.ts` keys `login-code:${ip}` (10 per 15 min),
  `register:${ip}` (5/h), `guest-order:${ip}` (8/15 min) etc. directly on it.
- Impact: if the app is ever reached without the Nginx `X-Real-IP` (CDN/LB in front, direct container exposure, health tooling), all visitors share one bucket and sign-in/sign-up/checkout lock out store-wide.
  Hospitality skips the rule for `unknown`; Ecommerce does not. Night report notes the deployment dependency; the code has no fail-safe. Fix: skip or loosen IP rules for `unknown`. Status: SUSPECTED (deployment-dependent).

### [LOW] F17 - Lock-order inversion in `request_booking_type`
- File:line: `supabase/migrations/20261102160000_hosp_room_types.sql:362` (`_lock_inventory` first, then calls `request_booking`, which takes the contact advisory locks
  at `sec_p3_low_findings.sql:56` and the inventory lock at `:78`); `request_booking`, `_group` and `_package` take contact locks first.
- Proof: T1 (type request, contact X) holds inventory and waits for contact X; T2 (direct/group/package request, same email or phone) holds contact X and waits for inventory -> Postgres deadlock (40P01),
  one request fails with the generic "try again". Needs the same contact in two simultaneous different-type requests, so rare. Fix: acquire contact locks first in `request_booking_type`. Coverage: none. Status: SUSPECTED.

### [LOW] F18 - Guest order creation is not idempotent
- File:line: `src/lib/checkout.functions.ts:99-125` (`place_guest_order` has no client key; only an IP rate limit of 8 per 15 min).
- Impact: a client retry after a timeout (or double submit across tabs) creates two orders and reserves stock twice (for Grow, two payable processes). Fix: client-generated key stored on the order with a unique index. Coverage: none. Status: SUSPECTED.

### [LOW] F19 - Abandoned-cart reminder marks after sending and ignores the update error
- File:line: `src/lib/abandoned-carts.server.ts:141-175`. `abandoned_carts_due` does not claim rows; two concurrent POSTs (limit 6/h per token) read `reminder_count = 0` and both send;
  the `.update(...).eq("reminder_count", 0)` result/error is never checked, so a failed update means the next run re-sends. These are marketing emails (legal exposure). Fix: claim (`reminder_count = 1`) before sending, restore on failure. Coverage: db-test `abandoned-automation`. Status: VERIFIED.

### [LOW] F20 - Licence download slot consumed before the stream completes
- File:line: `src/routes/api.license-download.file.ts:84-92` (`license_consume_download` then `return new Response(upstream.body)`). Max 3 downloads / 7 days; an interrupted large installer
  download (flaky connection) uses a slot and `Range` resume is not supported. Impact: customer locked out after three interrupted attempts. Fix: count on completion or allow N retries within minutes. Status: VERIFIED.

---

## Notes / smaller observations (not separate findings)
- Worker/email `fetch` calls have no explicit timeout (`outbox/worker.server.ts:rpc/select`, `email.server.ts:post`): a hung socket stalls the whole tick (`running` stays true) until undici's default (about 5 min).
- `registerCustomer` (`src/lib/admin.functions.ts:635,655`): `deleteUser` results are not checked on rollback paths; a failure leaves an orphan auth user that blocks the email ("already registered") with no role row.
- `STATIC_PATH = /\.[a-z0-9]{2,5}$/i` in `src/server.ts:39` sends any path ending in a short extension through `runWithTenant(host, null)` (no tenant). Fine for assets; worth confirming no tenant route (slugs/pages with dots) can end that way.
- `grow` webhook `sum` is parsed with `Number()` (`grow.server.ts:263`): a formatted sum like "1,234.50" becomes NaN -> `amount_mismatch` -> paid customer "rejected". Unverified against real Grow payloads.
- `payment_record` (Hospitality) has no idempotency key: a double-click records two payments (reversible via `payment_void`).
