# DB & RLS agent report (MAX / Hyp Pay)

> **Lead's note:** this agent could not write its report file, so it returned the report in its final message; the lead saved that text here unchanged, apart from the evidence sanitizer and repo-relative paths. The DDL it mentions is `docs/payment-gateways/evidence/06b-proposed-ddl.sql.txt` (a proposal; never executed). Where the main report adjusts this proposal, see MAX-HYP-REPORT.md §6.3.

## Summary

I could not save `db-rls.md`: the harness blocks subagents from writing report files. The full report is below the summary; you can save it under that name. The full DDL (1,126 lines) is in `(lead's working file, not in the repo)`. It has not been run and was not machine-parsed (installing a parser was denied). It was checked as text only.

1. **Database baseline.** `shop_test` has all 207 migrations, up to `20261127100000_product_brand_condition.sql`. This branch and `platform/crawl-parity` have the same migrations. Tests: 3651 assertions, 0 failed. Postgres had died; I started it once with the exact command from the brief. Apart from that I ran only catalog reads.
2. **Amount drift — your probe matches my code-reading.**
   - The `"order items insert"` policy (`20260928090000_order_integrity.sql:151-157`) checks only that the order is `pending`. A paid or awaiting order is still `pending`, so the customer can keep adding lines.
   - That policy cannot be tightened on `payment_status`. `place_order` is SECURITY INVOKER and inserts its own lines after `orders_default_payment` has already set the order to `awaiting`.
   - `grow_mark_paid` compares only with the amount stored on the process (±0.01) and does not check the order's current total.
3. **Other findings.**
   - New `public` objects get ALL privileges for `anon`, `authenticated` and `service_role` by default. Today `anon` holds ALL (including TRUNCATE) on `orders` and `order_items`; only RLS protects them, so the map's §3.3 is wrong.
   - `current_tenant_id()` quietly falls back to the default store when `service_role` sends no tenant header.
   - `site_settings` is readable by everyone and writable by any store admin.
   - `platform_delete_tenant` tolerates only foreign-key errors, so any new delete guard must allow `nuriel.deleting_tenant`.
   - The server can `SELECT` Grow's encrypted credentials.
4. **Proposal — 5 tables.** `payment_provider_accounts`, `payment_store_settings`, `payment_attempts`, `payment_events` and `payment_config_audit`. Each has RLS plus a RESTRICTIVE `tenant_isolation` policy. `anon` and `authenticated` get no grants. `service_role` can only read, and cannot read the encrypted-credential columns.
5. **Proposal — 22 server-only functions.** They are SECURITY DEFINER with an empty `search_path`, and take an explicit store (`_tenant`) and acting user (`_actor`). Only `max_attempt_mark_paid` can mark an order paid:
   - it locks the order, then the attempt;
   - it requires a recorded return payload plus VERIFY `CCode=0`;
   - amount (exact, in agorot), currency, terminal and installments must match, and so must the order's current `order_amount_due`;
   - the transaction ID must be unique per provider and terminal;
   - anything else goes to `needs_review`. The browser return alone never pays.
6. **Changes to `orders`.** Only three: `'max'` is added to `orders_payment_check`, one branch is added to `orders_default_payment`, and one `WHEN` line is added to `place_order` / `place_guest_order`. Each patch's text anchor appears exactly once in the live definitions. `orders_payment_guard` is unchanged, and no Grow or Bit column or function is touched.
7. **Amount lock — two triggers.**
   - One on `orders` stops the total changing while a MAX attempt is active.
   - One on `order_items` stops any line change during an active attempt. It also stops non-staff callers adding lines to a MAX order after the transaction that created it, which closes your probe's "add lines to a paid order" case for MAX.
   - Grow and Bit are unaffected. Their existing drift is left as a decision for the owner.
8. **`remove-hyp.test.sql`.** Every assertion passes against the text, so no assertion needs changing.
9. **Migration plan.** Migration 208 in one idempotent transaction, with the flag off by default. A rollback that refuses to run when MAX data exists. New tests, including a concurrency script. Regenerated `db-classification`. A release script modelled on `release-crawl-parity.sh`.
10. **Riskiest points.**
    - The database checks are only as strong as Hyp's VERIFY. Hyp has not confirmed that the signature covers Order, Amount and Coin.
    - Three text patches on live functions.
    - Test-mode payments (enforced by a CHECK and shown only to platform admins).
    - The SQL has never been run; `run.sh` is the first step.

## Full report

### 0. Method, baseline, limits

**Baseline**
- There is no migrations table locally. The runner applies every file in order (`scripts/db-tests/run.sh:48-74`); production tracks applied files in `_migrations_applied` (`deploy/release-next.sh:200,294`).
- Migration 207 is present: `global_products.brand` and `global_products.item_condition` exist, and `store_seo_proposals_field_check` includes `item_condition`.
- `git diff payments/max-hyp platform/crawl-parity -- supabase/ scripts/db-tests/` is empty.
- `tests.results` has 3651 rows, 0 failed, and 0 named `probe:%` (your probe was rolled back).

**Postgres restart.** The server was down at about 16:27 (no shutdown in the log; stale socket from 13:50). I started it with the brief's command. The baseline was unchanged afterwards.

**How "live" facts were gathered.** Every live definition below comes from catalog reads: `pg_get_functiondef`, `pg_policies`, `pg_constraint`, `pg_trigger`, `information_schema` and `has_*_privilege`. The dumps are in `(lead's working file, not in the repo)`.

**Limits.** I ran no DDL or DML and changed no repo file. I ran no deploy script and never touched `deploy/setup-selfhost.sh`. Statements marked **(code-reading)** are inferences I did not execute.

### A. Current state (live)

**A1. `orders` table**

Payment columns:
- `payment_method text NOT NULL DEFAULT 'offline'`, `payment_status text NOT NULL DEFAULT 'not_required'`
- `payment_due_at`, `paid_at`
- Bit: `bit_transaction_id`, `bit_receipt_url`, `payment_reported_at`, `payment_confirmed_by`
- Grow: `grow_asmachta`, `grow_transaction_id`, `grow_card`, `grow_installments`
- `pos_payment_method`

Amount columns:
- `total numeric NOT NULL DEFAULT 0`, with CHECK `total >= 0`
- `vat_rate`, `prices_include_vat`, `vat_business_type`
- Stored generated columns: `gross_amount = order_gross(...)`, `vat_amount`, `net_amount`

`orders_payment_check` (live text = `20261019520000_grow_payments.sql:94-110`):
- method ∈ {`offline`, `credit_card`, `bit`, `grow`}
- status ∈ {`not_required`, `awaiting`, `awaiting_verification`, `paid`, `expired`, `rejected`}
- `paid` requires `paid_at`
- `bit_*` columns only on Bit rows, `grow_*` columns only on Grow rows, plus length limits

Other constraints and indexes:
- `orders_status_check`: `pending`, `agent_review`, `picking`, `picked`, `awaiting_courier`, `shipped`, `delivered`, `cancelled`
- `orders_kind_check`: `order`, `quote`
- `orders_tenant_id_key UNIQUE (tenant_id, id)` (`20261008090000_multi_tenant_foundation.sql:207`). Composite foreign keys can use it.
- Index `orders_awaiting_payment_idx` (`20261019190000_hyp_payments.sql:408-409`)

**A2. `order_items` RLS policies (live `pg_policies`)**
- `"order items select"`: `can_view_order(o.customer_id, o.agent_id)`.
- **`"order items insert"`** (authenticated; `20260928090000_order_integrity.sql:151-157`):
  `EXISTS(order o: (o.customer_id = auth.uid() AND o.status = 'pending') OR is_admin(auth.uid()) OR o.agent_id = auth.uid())`. **There is no `payment_status` condition.**
- `"order items update by staff"` and `"order items delete by staff"`: admin or agent only (`20260907120000_b2b_beverage_platform.sql:379-390`).
- RESTRICTIVE `tenant_isolation` (loop at `20261008090000_multi_tenant_foundation.sql:366-380`).

So the answer to "can items be added while payment is awaiting?" is **yes, and also after it is paid**. Why:
- An awaiting order is always `pending`: `orders_payment_guard` only allows such an order to be `pending` or `cancelled`.
- `snapshot_order_item_product` prices each non-staff line from the database, ignoring the client's `unit_price` (live lines 152-191).
- `recompute_order_total` runs `UPDATE orders SET total = total`, which makes `orders_shipping_and_total` add up all lines again (live lines 48-56, 100).
- Your probe confirms it: total 100→300 while awaiting, 300→400 after paid, still paid (`evidence/04-probe-amount-drift.txt`).

Two more facts:
- The policy cannot be made to check `payment_status`. `place_order` (SECURITY INVOKER) inserts its own lines under this same policy (live lines 59-71), after `orders_default_payment` has already set the order to `awaiting` (live lines 31-52). Such a predicate would break Bit and Grow checkout for logged-in customers, and still would not cover staff or SECURITY DEFINER / `service_role` paths.
- Staff can change lines and, through `"orders update by staff"`, shipping and coupon fields too.

**A3. How the total is computed**
- **Line price:** `snapshot_order_item_product` (`20261019120000_shipping_digital_variants.sql:654-847`). Quotes and gifts are 0; deposits use the deposit price; then the variant price; then tier → custom price list → `LEAST` with the sale price. Staff prices are kept as entered.
- **Line extras:** `order_items_snapshot_sale` and `ensure_order_item_deposit`.
- **Order total:** `orders_shipping_and_total` (`20261019550000_coupon_rules.sql:224-325`), recomputed after every line change by `recompute_order_total` (`20261019120000_shipping_digital_variants.sql:244-255`; trigger at `:614`).
- **Inputs frozen at creation:**
  - coupon: `orders_apply_coupon`, `20261118110000_order_guard.sql:92-172`
  - POS discount: `orders_pos_guard`
  - VAT from store settings: `orders_vat_from_settings`, `20261115090000_vat_settings.sql:266-279`
  - VAT immutable afterwards: `orders_vat_snapshot_guard`
- **`order_amount_due`** (`20261019240000_offline_payments_bit.sql:423-433`):
  - IMMUTABLE SQL, executable by PUBLIC.
  - Result: `round(total, 2)`, plus VAT when prices exclude VAT. It differs from `order_gross` only by the clamp `GREATEST(vat, 0)`.
  - Grow and the VAT report use it, so MAX should too: `amount_minor = round(order_amount_due(...) * 100)::bigint`.

**A4. Order creation and the payment triggers**

`place_order` (live):
- Base `20261019240000_offline_payments_bit.sql:252-338`, text-patched by `20261019260000_multi_store_members.sql:216-230`, `20261019360000_remove_hyp.sql:151-173` and `20261019520000_grow_payments.sql:188-205`.
- SECURITY INVOKER; executable by `authenticated` and `service_role`.
- Validation:
  - the user is logged in;
  - the cart has 1–400 items;
  - `checkout_shipping` and `normalize_checkout_details` pass.
- Inserts the order with total 0 and maps the payment method inline (bit / grow / else offline).
- Inserts lines sorted by product and variant, then calls `apply_order_gifts` and `order_coupon_verify`.
- RLS still applies: `"orders insert by customer or staff"` (`20260907130000_username_login_manual_orders_test_email.sql:110-116`), plus RESTRICTIVE `tenant_isolation` and `tenant_active_for_new_orders` (`20261013090000_platform_tenant_management.sql:58-61`).

`place_guest_order` (live; base `20261019240000_offline_payments_bit.sql:341-418`):
- SECURITY DEFINER; `service_role` only; requires `auth.uid()` to be NULL.
- Tenant comes from `current_tenant_id()`; VAT comes from `site_settings`.
- Lines are inserted with price 0 and repriced by the trigger.

BEFORE INSERT triggers on `orders`, alphabetical (this order is asserted by `remove-hyp.test.sql:74-84`):
`enforce_subscription_orders`, `orders_a_rate_guard`, `orders_apply_coupon`, `orders_assign_number`, **`orders_default_payment`**, `orders_enforce_kind`, `orders_pos_guard`, `orders_reject_blocked_user`, `orders_require_open_storefront`, `orders_shipping_and_total`, `orders_stamp_agent`, `orders_tracking_normalize`, `orders_vat_from_settings`.

`orders_default_payment` (live; base `20261019360000_remove_hyp.sql:46-99`, patched by `20261019520000_grow_payments.sql:137-169`):
- Resets all payment fields.
- Staff orders and quotes → `offline`.
- Bit → `awaiting`, due in 24 h. Grow → `awaiting`, due in 2 h.
- Anything else → `offline`, and it raises an error if phone payment is disabled.

`orders_payment_guard` (live; base `20261019360000_remove_hyp.sql:106-143`, patched by `20261019520000_grow_payments.sql:172-186`):
- Every payment column is reset to its old value unless `kobi.payment_update = 'on'`.
- An order that is awaiting payment (or awaiting verification) can only be `pending` or `cancelled`.

**A5. Stock reservation and expiry**
- **Reservation:** on line insert, strict for customers — `order_items_stock_sync` (`20261019120000_shipping_digital_variants.sql:997`) calls `order_item_reserve` (`:945`).
- **Release:** when the order becomes cancelled, via `orders_stock_sync` (`:1103`), under `kobi.stock_sync = 'on'`.
- **Expiry:** `expire_unpaid_orders()` (`20261019360000_remove_hyp.sql:179-200`; live identical) cancels pending orders that are awaiting payment and past `payment_due_at`. It runs every 5 minutes in every app process (`src/server/services/payment-expiry.ts:26-29`). Grow process rows are never expired.

**A6. Grow**

Tables (`20261019520000_grow_payments.sql:25-48`, `:53-80`):
- RLS is on with **no policies**; all access is revoked from PUBLIC, `anon` and `authenticated`; `service_role` has ALL.
- One pending process per order; `(process_id, sandbox)` is unique; `transaction_id` is not unique.
- `service_role` can SELECT the encrypted `api_key_enc` (live `has_column_privilege` = true).

`grow_mark_paid` (`:213-278`; live identical; SECURITY DEFINER; `service_role` only):
- Locks the process row, then the order row.
- Checks, in order:
  - token hash;
  - already `paid` / `paid_late`;
  - status code `'2'`;
  - **sum within ±0.01 of the process amount**;
  - order cancelled or no longer awaiting → `paid_late`, without reopening it.
- Sets `kobi.payment_update` before writing.
- The caller passes `sandbox`, and the webhook tries both values.

Credentials writer:
- `saveGrowSettings` upserts through `supabaseAdminUnscoped` (`src/lib/platform-grow.functions.ts:94-192`).
- The audit is written afterwards by `recordPlatformAudit`, which swallows errors (`src/lib/platform-files.server.ts:37-59`). The audit is therefore best-effort and not atomic with the change.

**A7. `site_settings` payment flags**
- Columns: `payment_phone_enabled` (default true), `payment_bit_enabled` (default false), `payment_bit_phone`, plus `site_settings_bit_phone_check`.
- `site_settings_payment_methods_guard` (INVOKER; BEFORE INSERT OR UPDATE; `20261019360000_remove_hyp.sql:209-234`) requires phone **or** Bit to stay on. Grow is not counted.
- Anyone can read the table (`"site settings readable by everyone"`, `20260907120000_b2b_beverage_platform.sql:463`), and any store admin can update it. MAX settings must not live here.

**A8. Tenant resolution**

`current_tenant_id()` (`20261019260000_multi_store_members.sql:96-147`):
- A logged-in member gets the header tenant only if they belong to it, or their single store when there is no header.
- A platform admin can override.
- `anon` and `service_role` get the header tenant.
- **With no header, `service_role` falls back to the default store** (live lines 41-48). In this DB the default is `kobi`; in production it is probably the platform's own store. So a missing tenant would seem to work in Phase 1 and fail open in Phase 2.

Other functions:
- `tenant_for_host` (`20261019110000_custom_domains.sql:101-117`): domain → verified custom domain → slug → default store.
- `tenant_is_active` (`20261013090000_platform_tenant_management.sql:45`).

**A9. Roles and grants**
- `service_role` has BYPASSRLS (`scripts/db-tests/supabase-stubs.sql:10`, the same as Supabase).
- Default privileges give ALL on new tables, functions and sequences to `anon`, `authenticated` and `service_role` (`supabase-stubs.sql:100-102`). Every new object therefore needs explicit REVOKEs.
- Effective grants today (live): `anon` and `authenticated` hold ALL, including TRUNCATE, on `orders`, `order_items`, `site_settings` and `user_roles`. Only RLS protects them; there is no permissive policy for `anon`.
- Tables limited to `service_role`: `tenants`, `platform_admins`, the Grow tables, `coupon_grants`, `license_audit`.
- Functions are executable by PUBLIC unless revoked.
- SECURITY DEFINER functions are owned by `postgres`, so they bypass RLS. Their own `WHERE tenant_id` clauses are the only isolation.

**A10. Role checks**
- `is_platform_admin(uid)` (`20261010090000_platform_admin.sql:26`): a row in `platform_admins` (RLS on, no policies, `service_role` only).
- `is_admin` = `is_super_admin`: an admin of `current_tenant_id()` who is not blocked, or a platform admin while a tenant is set.
- `store_staff_role` (`20261019390000_staff_roles_permissions.sql:78-100`): `owner` = platform admin or **the protected admin** (`is_protected`, `:4-5`); other admins are `manager`. `staff_can('billing.manage')` is true for the owner only.
- Memberships: `user_roles` (PK `(tenant_id, user_id)`, role ∈ {admin, agent, customer, warehouse, cashier}, plus `is_blocked` and `is_protected`). These checks depend on the request header, except `is_platform_admin`.
- Patterns to copy:
  - store owner: `store_save_vat_settings` (`authenticated`, checks `staff_can('billing.manage')`, audits in the same transaction);
  - platform admin through the server: `ai_require_platform_admin(_actor)` (`20261110100000_ai_assistant.sql:540`) inside `ai_admin_save_settings(_actor, _patch)` (`:768`), executable by `service_role` only (`:995-1030`), auditing changed field names but never the key.

**A11. Existing audit and history**
- `platform_audit_log` (`20261019510000_platform_customer_files.sql:102-128`): append-only on UPDATE (`platform_files_immutable`, `:173-176`); **DELETE is not blocked**; platform admins can read it; kept when a store is deleted (SEC-M5).
- Also present: `license_audit` (no-update trigger), `billing_history_guard`, `order_delivery_events`, `picking_events`, `marketing_consent_events`, `ai_subscription_events`, and audit logs in the hospitality and business-profile schemas.
- There is **no payment ledger or payment audit for stores**.

**A12. Existing rate limits**
- In the DB:
  - `orders_rate_guard` (`20261118110000_order_guard.sql:175-207`): advisory lock; 30 orders per 10 minutes and 300 per day per customer; guests and staff exempt.
  - `ai_rate_buckets` / `ai_quota_take` (`20261110100000_ai_assistant.sql:283,293`).
  - `hospitality.rate_buckets` (UNLOGGED) and `rate_check` / `rate_sweep`, shared by all app processes (`20261103090000_hosp_security.sql:21-87`, `20261105130000_hosp_rate_check.sql`).
- In the app: in-memory limits per process (`src/lib/rate-limit.server.ts:12,26`), for example guest orders 8 per 15 minutes per IP (`src/lib/checkout.functions.ts:110`).

**A13. Store deletion**
- `platform_delete_tenant` (`20261106170000_sec_m5_keep_platform_records.sql:27`; live) deletes every `public` table that has `tenant_id`, in passes. It skips `billing_history`, `platform_audit_log` and `platform_agreement_acceptances`.
- It catches only foreign-key and restrict violations, and sets `nuriel.deleting_tenant`. Any new trigger that raises on DELETE must allow that setting.

### B. Proposal

The DDL is in `evidence/06b-proposed-ddl.sql.txt`; section numbers below refer to it.

**Naming and credentials**
- New names start with `max_`, `payment_` or `platform_max_`. The new payment method value is `'max'`. `'credit_card'` cannot be reused because the tests require it to map to `offline` (`remove-hyp.test.sql:120-124`, `:174-180`).
- Credentials are stored as `v<key_version>:base64(iv‖tag‖ct)`, AES-256-GCM encrypted in the app with a key kept outside the database. A CHECK requires both encrypted values to carry the row's `key_version`.
- **The app should bind the encryption's additional authenticated data to tenant, field and key version** (the license/AI pattern). An encrypted value copied into another store's row would then fail to decrypt.

**Server flow**
1. Checkout: `place_order` / `place_guest_order` with `'max'` → order awaiting for 2 h.
2. Start: `max_attempt_open` → `max_account_secrets('sign')` → decrypt → SIGN → `max_attempt_signed` → redirect to Hyp.
3. Return:
   - parse the query, rejecting duplicate keys;
   - `max_attempt_record_return(host tenant, Order, sha256(raw query), …)`;
   - `max_account_secrets('verify')`;
   - VERIFY, with the parameters in their original order;
   - `max_attempt_mark_paid`;
   - send emails only on `paid`, using the returned `tenant_id`.
4. Every 5 minutes: `max_attempts_expire()`, then `expire_unpaid_orders()`.

**B1. Tables** (DDL §1–§5; file lines 16-195)

*`payment_provider_accounts`*
- Columns:
  - `(tenant_id, provider)` unique; `provider = 'max'`; `mode` (`test`/`live`); `enabled`
  - `terminal_number` (10 digits)
  - `api_key_enc`, `api_password_enc` (encrypted format)
  - `key_version`
  - `status` (`unverified`/`verified`/`failed`), `last_verified_at`, `last_verify_code`
  - `terminal_max_installments` (1–36)
  - `verified_methods` (≥1, from {card, bit, apple_pay, google_pay}), `verified_brands`
  - `created_at` / `created_by`, `updated_at` / `updated_by`
- CHECKs:
  - test mode ⇔ terminal starts with `00100` — Hyp's documented test-terminal prefix, so a live account cannot carry a test terminal;
  - `enabled` requires terminal and both credentials;
  - `verified` requires `last_verified_at`;
  - encryption prefix must equal `key_version`.
- A unique index on `(provider, terminal_number)` ensures one terminal belongs to one store. The success URL is set per terminal in Hyp's portal.

*`payment_store_settings`*
- PK `(tenant_id, provider)`, with a foreign key to the account.
- `max_installments` (1–36); `min_installments_amount_minor` (0–100M agorot); `allowed_methods` (≥1); `allowed_brands`.
- A trigger requires the choices to be a subset of what is verified and no more than `terminal_max_installments`.

*`payment_attempts`*
- Foreign key `(tenant_id, order_id)` → `orders(tenant_id, id)` ON DELETE **RESTRICT**: a store admin cannot delete payment evidence.
- `attempt_no` (1–5); snapshot of provider, mode, terminal and `key_version`.
- `amount_minor` (1..100M agorot); `currency` (`'ILS'`); `max_installments`.
- `reference`: 32-hex, unique, `replace(gen_random_uuid()::text, '-', '')` (the repo's token pattern).
- `customer_id`; `state` ∈ {created, redirected, returned, paid, failed, expired, cancelled, needs_review}; `expires_at`; timestamps.
- `provider_txn_id` (`^[0-9A-Za-z-]{1,40}$`), `approval_code`, `installments`, `card_brand`, **`card_last4` (exactly 4 digits)**, `failure_code`.
- `verification` (JSON, allowlisted keys, ≤1 KB); `review_reason`, `review_resolved_at` / `review_resolved_by`.
- CHECKs: `paid` requires transaction ID, `paid_at` and `verified_at`; `needs_review` requires a reason.
- Indexes:
  - **one active attempt per order**: partial unique index where state ∈ {created, redirected, returned};
  - **`(provider, terminal_number, provider_txn_id)` unique** where the transaction ID is not null;
  - expiry, tenant and review.

*`payment_events`*
- Columns:
  - identity primary key;
  - `(tenant_id, attempt_id)` foreign key → attempts, ON DELETE CASCADE;
  - `source` ∈ {open, sign, return, notify, verify, expire, cancel, review};
  - `payload_sha256`, required exactly for return / notify / verify;
  - `verification`, `result`;
  - `summary`: JSON whose keys must all be in {ccode, verify_ccode, txn_id, amount_minor, currency, installments, approval_code}, ≤1 KB.
- Replay index: unique `(attempt_id, source, payload_sha256)` for return and notify events.

*`payment_config_audit`*
- `actor_id`; `actor_role` ∈ {platform_admin, store_owner, system} (system ⇔ actor is NULL); `action` from a list of 12.
- `changed_fields`: a subset of 14 field names. **There is no value column**, so a value can never be logged.

How "no card data" is enforced:
- Values written to events and to `verification` are rebuilt inside SQL from validated scalar arguments (`max_event_summary`).
- No function accepts card expiry (`Tmonth`/`Tyear`), ID number (`UserId`), BIN, or free-form JSON.

**B2. RLS and grants** (§6)
- On all 5 tables: RLS enabled, plus a RESTRICTIVE `tenant_isolation` policy on `tenant_id = (SELECT current_tenant_id())`.
- `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` on all 5 tables.
- `service_role` then gets **column-level SELECT on the accounts table, excluding the two encrypted columns**, and SELECT on the other four tables.
- No API role gets INSERT, UPDATE or DELETE on any of them.
- Identity sequences: all privileges revoked.

**B3. Guard triggers** (§7)
- `payment_attempts_guard`:
  - snapshot columns are immutable, and so is the transaction ID once set;
  - state machine: created / redirected / returned → anything; failed → paid or needs_review; expired / cancelled → paid or needs_review; paid is final except the review fields;
  - DELETE only while the store is being deleted.
- `payment_rows_append_only` on events and audit: no UPDATE; DELETE only during store deletion.
- `payment_store_settings_guard`: the subset rule from B1.
- Amount locks: see B6.

**B4. Functions** (§8–§20)

All are SECURITY DEFINER, `search_path = ''`, revoked from PUBLIC, `anon` and `authenticated`, and executable by `service_role`. Helpers and trigger functions are revoked from `service_role` too. Exact guards:

- **`max_payments_active(_tenant, _actor)`**: global flag AND account enabled AND status `verified` AND the store is ecommerce AND (live mode OR the actor is a platform admin).
- **`max_attempt_open(_tenant, _order, _customer)`**:
  - locks the order in `_tenant`;
  - a logged-in customer's order must match `_customer`;
  - the order must be a normal order, method MAX, awaiting payment, pending;
  - MAX must be active;
  - amount = `order_amount_due` × 100, and must be > 0;
  - **refuses while an attempt is `returned`** (back from Hyp, not yet verified);
  - reuses the active attempt if more than 5 minutes remain and the amount, terminal and mode are unchanged; otherwise expires it;
  - at most 5 attempts per order;
  - `expires_at = LEAST(now + 30 min, order due − 15 min)`, and must be at least now + 5 min;
  - max installments = `LEAST(owner max, terminal max)` when the amount is at or above the owner's minimum, else 1.
- **`max_account_secrets(_tenant, _attempt, _purpose)`**:
  - returns encrypted values only for that attempt of that store, and only if the account still has the attempt's terminal and mode;
  - `sign`: only for created or redirected attempts, before expiry, while MAX is active;
  - `verify`: attempts up to 7 days old, **even if MAX is disabled**.
- **`platform_max_check_secrets(_actor, _tenant)`**: platform admin only; for the free connection check (SIGN only, nothing charged).
- **`max_attempt_signed`**: created → redirected or failed. Hyp's credential errors 901 and 902 mark the account `failed` and write a system audit row, so MAX switches itself off.
- **`max_attempt_record_return(_host_tenant, …)`**:
  - validates formats;
  - **the store from the Host must be the attempt's store**; otherwise it answers `unknown` and records nothing;
  - records the event idempotently (a repeat returns `replay`);
  - moves created or redirected → returned;
  - **never marks anything paid**.
- **`max_attempt_mark_paid(_tenant, _reference, _payload_sha256, _verify_ccode, _ccode, _terminal, _txn_id, _amount_minor, _currency, _installments, _approval_code, _card_brand, _card_last4)`**, in this order:
  1. validate formats; find the attempt by reference **and** `_tenant`;
  2. lock the **order first, then the attempt**;
  3. the payload hash must match a recorded `received` return event, else `unknown_payload`;
  4. record a verify event;
  5. VERIFY code ≠ 0 → `unverified`, no state change (a forged redirect can neither pay nor fail an attempt);
  6. attempt already `needs_review` → return; attempt `paid` → `already_paid`, or flag `duplicate_charge` when a different approved transaction arrives;
  7. verified decline → `failed`;
  8. go to `needs_review` when:
     - the transaction ID belongs to another attempt on the same terminal (`duplicate_txn`);
     - terminal, currency, exact amount in agorot, or installments do not match;
     - the order is no longer a pending, awaiting MAX order (`late` if the attempt had expired or been cancelled, else `order_not_awaiting`);
     - the order's current amount due differs from the attempt's amount;
  9. otherwise: set `kobi.payment_update`, mark the order paid (`paid_at`, due date cleared), mark the attempt paid, and cancel the order's other active attempts.

  An expired or superseded attempt is still accepted while the order is awaiting with the same amount, and the order is never reopened automatically.
- **`max_attempts_expire()`**: active attempts that are past expiry → `expired`; active attempts whose order is no longer awaiting → `cancelled`. Uses `FOR UPDATE SKIP LOCKED`, at most 500 per run.
- **`max_attempt_cancel(_actor, …)`**: a store admin who is not blocked, or a platform admin. Cancels active attempts so staff can edit the order.
- **`max_review_resolve`**: store owner or platform admin.
- **`max_order_payment_status(_tenant, _order)`**: no secrets; the server must authorize the viewer.
- **`max_account_status(_actor, _tenant)`**: store owner or platform admin. Masked terminal, `has_*` flags, verified methods and brands, store settings. Never encrypted values.
- **`max_store_settings_save(_actor, …)`**: the protected admin (not blocked) or a platform admin; audits changed field names.
- **`platform_max_account_save(_actor, _tenant, _patch)`**:
  - platform admin only; ecommerce store only; allowlisted keys; arrays type-checked;
  - clearing and replacing credentials cannot be combined;
  - **any change of terminal, mode or credential resets status to `unverified`**;
  - shrinks the owner's choices to what is still verified (and audits that);
  - audit row with field names; enable/disable gets its own audit row.
- **`platform_max_account_verified`**: platform admin; terminal fully configured; sets `verified` or `failed`; audit.

**B5. How `orders` accepts the new provider** (§21–§22, file lines 1057-1126)
- `orders_payment_check`: the only change is `'max'` in the method list. The Grow and Bit clauses are byte-identical, so a MAX row can never carry `grow_*` or `bit_*` values.
- No new columns on `orders`. Card details live on the paid attempt.
- `payment_status` reuses `awaiting → paid`, and `expired` through the existing expiry job.
- `orders_default_payment`: one `IF _requested = 'max'` branch, inserted before the same phone-payment anchor Grow used. Test mode is allowed only when `auth.uid()` is a platform admin; due time is 2 h.
- `place_order` / `place_guest_order`: one extra `WHEN … = 'max' THEN 'max'` after the Grow line.
- I checked live: each patch's text anchor appears exactly once; `= 'bit'` is still present; there are still exactly 2 `place_*` functions.
- `orders_payment_guard` needs **no change**: it already freezes payment columns unless the flag is on and already blocks awaiting orders for every method.
- `site_settings_payment_methods_guard` is unchanged.

**B6. Amount lock without breaking Grow or Bit** (§7d–§7e, file lines 308-372)

Two triggers:
- **`orders_payment_amount_lock`** (AFTER UPDATE, `WHEN (NEW.payment_method = 'max' AND OLD.total IS DISTINCT FROM NEW.total)`):
  - raises while an attempt is active, whatever caused the change (line insert, staff shipping or coupon edit);
  - it sees the final total after all BEFORE triggers;
  - it costs nothing for other methods, because the WHEN clause is evaluated without calling the function;
  - its query runs after the order-row lock, so it is safe in READ COMMITTED (code-reading).
- **`order_items_a_payment_lock`** (BEFORE INSERT/UPDATE/DELETE; its name makes it fire first):
  - rule 1: no line change by anyone while an attempt is active;
  - rule 2: **a non-staff caller cannot add or change lines of a MAX order after the transaction that created it** (checked as `orders.created_at = now()`; `place_order` and `place_guest_order` insert their lines in that same transaction). This blocks your probe's paid-order case for MAX;
  - exempt: internal stock sync, store deletion, and updates that do not touch line content (picking, serial numbers, licences).

Effect on other methods:
- Grow, Bit and offline behave exactly as today. Rule 2 needs method MAX, and rule 1 needs an attempt, which only MAX creates. The extra cost is one indexed lookup and one primary-key read per line write.
- To edit a MAX order, staff call `max_attempt_cancel`; the customer then opens a new attempt for the new amount.
- Defense in depth: `max_attempt_mark_paid` re-checks the exact amount against both the attempt and the current `order_amount_due`.
- The existing Grow/Bit drift is out of MAX scope (decision D10). One fix for all methods would be a RESTRICTIVE INSERT policy on `order_items`: `is_staff(auth.uid()) OR (the order was created in this transaction, o.created_at = now())`, plus a current-amount check in `grow_mark_paid`. It changes existing behavior.

**B7. Concurrency, idempotency and replay** (code-reading)
- **Lock order:** order, then attempt, in open, mark-paid and cancel. Record-return and signed lock only the attempt. Expiry locks only attempts, with SKIP LOCKED. There is no cycle.
- **Double click / two tabs:** order lock plus reuse of the active attempt, plus the one-active-per-order index. A new page is refused while an attempt is `returned`.
- **Replayed return:** replay index → `replay`; on a paid attempt → `already_paid`.
- **Genuine transaction replayed under another reference:** transaction-ID uniqueness → `duplicate_txn`.
- **Customer charged twice on the same reference:** `duplicate_charge` flag on the paid attempt.
- **Mark-paid racing `expire_unpaid_orders`:** both lock the order row, and the second one re-checks, so an order is never both paid and cancelled.
- **Test mode and broken credentials:** a CHECK ties test mode to the `00100` terminal prefix; test mode is offered only to platform admins; credential errors 901/902 switch MAX off automatically.
- **Kill switch:** turning the flag off stops new orders and SIGN, but VERIFY still settles payments already in progress.

**B8. `remove-hyp.test.sql` compliance** (static text check, the agent's static checker (kept outside the repo))

| assertion | status |
|---|---|
| `:42-44` tables `payment_intents`, `tenant_payment_secrets`, `platform_settings` | none created |
| `:45-49` columns `hyp\_%`, `payment_token`, `card_payments_enabled`, `card_clearing_live` | none of the 54 new columns |
| `:50-59` 22 banned function names | none of the 22 new names |
| `:60-63` function bodies matching `(hyp_\|payment_intent\|tenant_payment_secrets\|platform_settings\|card_payments_\|card_clearing\|platform_payments_\|checkout_payment_request\|payment_token)`, case-insensitive | 0 matches in the whole file, including text injected into patched functions |
| `:74-84` trigger position | no new BEFORE INSERT trigger on `orders` (only an AFTER UPDATE one) |
| `:85-88` `credit_card` kept in the CHECK | kept |
| `:89-92` `= 'bit'` mapping, exactly 2 functions | kept, no overload |
| `:120-124`, `:174-180` `credit_card` → `offline` | unchanged |

No assertion needs owner approval. Caveat: a future BEFORE INSERT trigger whose name sorts between `orders_assign_number` and `orders_enforce_kind` would break `:74-84`.

**B9. Other tests and files affected**
- **`scripts/db-classification.mjs`:** add `payment_attempts`, `payment_events` and `payment_store_settings` to ecommerce, and `payment_provider_accounts` and `payment_config_audit` to platform, as Grow is split. Then regenerate `scripts/db-tests/db-classification.test.sql` and `docs/architecture/db-classification.md`; that test fails otherwise.
- **`ecommerce-engine-guard.test.sql:41-53,66-70`:** unchanged, because the proposal adds no engine-guard triggers. If they are wanted, that test's list of 40 tables and its count must change.
- **`tenant-isolation-coverage`:** passes.
- **`grow-payments` and `remove-hyp` tests:** unchanged.
- **Store-deletion tests:** pass. The delete guards allow `nuriel.deleting_tenant`, and the RESTRICT foreign key is resolved by the deletion passes: `order_items`, then attempts / events, then `orders` in the next pass (code-reading).
- **`run.sh`** applies the newest migration twice. The proposal is idempotent.

### C. Migration plan (for owner approval)

**C1. Ordered steps**
1. Decisions D1–D12, plus Hyp's answers on signature coverage (Order, Amount, Coin), transaction ID format, whether Coin is echoed with MoreData, and payment-page validity.
2. Migration 208, `supabase/migrations/<ts>_max_payments_foundation.sql`. It is the proposed file: one transaction, in this order: flag → tables → RLS and grants → triggers → helpers → API → privileges → CHECK → patches → PostgREST reload.
3. Rollback file (C2).
4. Tests (C6), then `node scripts/db-classification.mjs`.
5. Run `run.sh`, `rollback-check.sh`, `rollback-guards.sh` and the new concurrency script locally.
6. App work (other agents) behind the same flag.
7. Release script (C4): `--check`, then `--deploy` only with the owner's approval.
8. Enable (C5).

**C2. Rollback** (`supabase/rollbacks/<ts>_max_payments_foundation.down.sql`)
1. Data guard (R-3 style): raise `'יש % שורות …'` ("there are % rows …") if any row exists in `payment_attempts`, `payment_provider_accounts` or `payment_config_audit`, or any order has `payment_method = 'max'`.
2. Drop both lock triggers.
3. Reverse the 3 patches by replacing the exact inserted text, failing loudly if it is not found.
4. Restore `orders_payment_check` verbatim from `20261019520000:96-110`.
5. Drop the 5 tables and the 22 functions.
6. Delete the `max_payments` flag; reload PostgREST.

Test coverage: `rollback-guards.sh` `check_guard` lines for those four, and `rollback-check.sh` confirming the schema is identical to migration 207.

**C3. Data safety**
- Everything is additive: new empty tables, a widened CHECK, patches that only add branches. No existing row is updated.
- The CHECK swap scans `orders` under ACCESS EXCLUSIVE. Use a quiet window, or `NOT VALID` followed by `VALIDATE`.
- Release guard: checksums before and after of:
  - `orders`: id, total, VAT, status, payment method/status, `paid_at`, `grow_*`;
  - `grow_payment_processes`: id, status, amount;
  - `tenant_grow_credentials`: tenant, enabled, sandbox, `updated_at` — never the encrypted columns;
  - `site_settings`: the payment columns.
- The rollback refuses when MAX data exists.
- Payment rows are deleted with the store, as Grow's are. Keeping them requires patching the deletion function's exclusion list (D3).

**C4. Shipping with the existing deploy scripts** (read only; I ran none)
- Copy the pattern of `deploy/release-crawl-parity.sh` (release 207):
  - modes `--check`, `--deploy`, `--print-migration-sql`, `--print-rollback-sql`, `--rollback-db`;
  - read-only preflight with `EXPECTED_BEFORE`;
  - pinned SHA-256 of the migration and rollback (`MIG_SHA` / `DOWN_SHA`, `:49-50`);
  - backup;
  - one transaction with a gate and a POST_CHECK;
  - guard checksums (pattern `deploy/release-next.sh:43-50`);
  - automatic app rollback; database rollback printed only, run manually with approval (`release-next.sh:90-97`).
- New `deploy/release-max-payments.sh` with `EXPECTED_BEFORE=207`.
- POST_CHECK should assert:
  - RLS on all 5 tables;
  - no `anon` or `authenticated` privileges;
  - `has_column_privilege('service_role', …, 'api_key_enc' / 'api_password_enc', 'SELECT')` is false;
  - no INSERT for `service_role`;
  - `authenticated` and `anon` cannot execute `max_attempt_mark_paid` or `max_attempt_open`;
  - the flag is false and the new tables are empty;
  - the CHECK contains both `credit_card` and `'max'`;
  - the 3 patched definitions contain their markers;
  - the md5 of `grow_mark_paid` is unchanged.
- If a new encryption-key environment variable is chosen: forward it in `docker-compose.yml` (enforced by `tests/unit/env-forwarding.test.ts`), generate it in `setup-selfhost.sh`, and add it to the backup list (`deploy/backup-daily.sh:228-229`). That belongs to the deploy and app agents.

**C5. Feature flag** (default off)
- `platform_feature_flags('max_payments', false)`, toggled only by the existing audited `platform_set_flag`.
- After deploy there are no account rows, so nothing can be offered, and a `'max'` request raises an error.
- Enable sequence:
  1. platform admin saves the test terminal (`00100…`) for the platform store;
  2. free connection check (`platform_max_check_secrets` → SIGN → `platform_max_account_verified`);
  3. flag on, account enabled — only platform admins see MAX;
  4. sandbox scenarios, with owner approval;
  5. live terminal, re-verify (status had reset to `unverified`), mode `live`.
- Kill switch: turn the flag off.

**C6. SQL tests to add**

New file `scripts/db-tests/max-payments.test.sql`. It needs its own error helper, because it runs before `remove-hyp`. Use non-default stores A and B (`70…0a` and `70…0b`) to catch the default-store fallback.
1. **Structure:**
   - RLS and policies on all 5 tables;
   - no `anon` or `authenticated` privileges;
   - no `service_role` SELECT on the encrypted columns;
   - 22 SECURITY DEFINER functions with `search_path = ""` and no `anon` / `authenticated` execute.
2. **Off by default:**
   - `max_payments_active` is false for every store;
   - `place_order` with `'max'` gives a clear error;
   - `credit_card` still maps to `offline`.
3. **Store owner vs platform admin:**
   - a store owner cannot call `platform_max_account_save`;
   - a manager (non-protected admin) and store B's owner cannot save A's settings;
   - the platform admin can do both;
   - status JSON has no `_enc` key and no `v1:` substring;
   - audit rows hold field names only and are append-only.
4. **Isolation between two stores:**
   - B cannot open, get secrets for, record a return for, or mark paid an attempt of A;
   - the same terminal cannot be used by both stores;
   - live mode with a `00100` terminal is rejected.
5. **State machine:**
   - reuse on a double call; refused while `returned`; cap of 5 attempts;
   - unverified → no change; unknown payload; decline → `failed`;
   - success → paid; repeat → `already_paid`; different transaction → `duplicate_charge`;
   - reused transaction ID → `duplicate_txn`; mismatches → `needs_review`;
   - expired attempt with the order still awaiting → paid; with the order expired → `late`, and the order stays cancelled;
   - illegal transitions and DELETE raise.
6. **Amount lock:**
   - a customer line insert during an active attempt fails, and so does one into a paid MAX order;
   - staff shipping edit during an attempt fails; after `max_attempt_cancel` staff may edit;
   - the same inserts on Grow / Bit orders still succeed (documents the existing defect);
   - `place_*` with `'max'` still inserts its lines.
7. **Grow / Bit unchanged:** pin the md5 of `grow_mark_paid`, `grow_payments_active`, `bit_payment_review` and `expire_unpaid_orders`; the Grow and Bit branches are still present.
8. **Store deletion:** `platform_delete_tenant` succeeds with MAX rows present, and the other store's rows are untouched.
9. **Expiry:** expires, cancels, and a second run returns 0.

New file `scripts/db-tests/max-payments-concurrency.sh`, in the style of `order-guard-concurrency.sh`:
1. two parallel opens → one attempt;
2. two parallel mark-paid calls → one `paid`, one `already_paid`;
3. mark-paid vs `expire_unpaid_orders` → never both;
4. mark-paid vs line insert;
5. one transaction ID on two orders → exactly one paid.

### D. Owner decisions
- **D1** `'max'` as the method value.
- **D2** Store owner = protected admin only.
- **D3** Payment rows deleted with the store (default) or kept like `billing_history`.
- **D4** RESTRICT foreign key from attempts to orders (the store admin's `deleteOrder` would then fail with an FK error for MAX orders, `src/lib/admin.functions.ts:698`).
- **D5** Windows: order 2 h, attempt 30 min, grace 15 min, at most 5 attempts.
- **D6** Late payments go to `needs_review` and are never auto-reopened.
- **D7** Store `card_last4` and `card_brand` (precedent: `grow_card`).
- **D8** Test mode only for platform admins.
- **D9** Card-only stores: the guard stays as is.
- **D10** Fix the existing Grow/Bit drift (separate change).
- **D11** Installment range 1–36 and the brand list.
- **D12** Dedicated audit table vs reusing `platform_audit_log`.
- **Guests:** the server must hold a capability token, e.g. a stateless HMAC issued by `place_guest_order`, before `max_attempt_open` or status calls. Today the order UUID alone opens Grow's page (map §11).

### E. Riskiest points
1. **VERIFY coverage.** The research file says the signature algorithm and its covered fields are not documented. The plugin's local HMAC covers Order and Amount, but that is plugin code only. If VERIFY does not bind Order, Amount and Coin, the database checks can be met by a forged redirect that reuses a genuine cheap transaction; only transaction-ID uniqueness catches it, after the fact.
2. **Amount drift.** Fixed for MAX by two triggers, which must not regress Grow or Bit. The Grow/Bit defect itself remains.
3. **Three text patches** of live definitions. They are anchored, fail loudly, and need an exact reverse in the rollback.
4. **Default-store fallback** in `current_tenant_id()`. Use an explicit tenant everywhere and test on non-default stores.
5. **Default privileges.** Every object needs explicit REVOKEs, asserted by the POST_CHECK.
6. **Test payments marking real orders paid** (the Grow sandbox issue). Mitigated by the CHECK and the platform-admin-only rule.
7. **Unexecuted SQL.** Expect fixes when `run.sh` first runs it.