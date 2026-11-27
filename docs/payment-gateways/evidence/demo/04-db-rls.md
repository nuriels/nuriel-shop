# 04 — DEMO stage: database and RLS (MAX/Hyp, platform vs tenant scopes)

Status: COMPLETE (2026-11-27). Proposal only: nothing was executed, no repository file was changed.
Author role: database and RLS agent. Research only; read-only SELECTs on the local test DB `shop_test` (`psql -X -h /tmp/pg -p 5499 -U postgres -d shop_test`).
Companion DDL (text only, never executed): `docs/payment-gateways/evidence/demo/04b-proposed-ddl-demo.sql.txt`

Legend: (a) = created in the DEMO migration; (b) = designed now, created later; (c) = out of scope.

## 1. Live-DB facts relied on (with SQL)

All queries ran on `shop_test` (PostgreSQL 16.15) with `SET default_transaction_read_only = on`, catalog reads and `SELECT` only. Raw outputs: `(working file, not in the repo)` (`schemas.txt`, `billing_constraints.txt`, `billing_triggers_grants.txt`, `billing_domain_*.txt`, `fingerprints.txt`, `schema_postures.txt`, `acl_checks.txt`, `orders_facts.txt`, `live_*.sql`). No `*_enc` column was ever selected.

### 1.1 Schemas, exposure and grants (the conventions a new schema must follow)

SQL: `SELECT nspname, pg_get_userbyid(nspowner), nspacl FROM pg_namespace ...`; `SELECT oid::regclass, relrowsecurity, relacl FROM pg_class WHERE relnamespace IN (...)`; `SELECT ... FROM pg_default_acl`.

| Fact (live) | Evidence |
| --- | --- |
| `billing` schema: USAGE for `service_role` only (`{postgres=UC,service_role=U}`); 4 tables, RLS on, **0 policies**, table ACL `service_role=r` only; all 30 `billing.*` functions `proacl={postgres=X/postgres}` (no API role can execute them) | `schemas.txt`; `billing_triggers_grants.txt`; created by `20261114100000_billing_agreements.sql:35-38,268-279,1339-1358` |
| `business_profile` schema: same closed pattern (USAGE `service_role` only); tables RLS on, `service_role=r`; 5 tables carry `tenant_isolation` RESTRICTIVE; only `public.bp_*` wrappers are callable | `schema_postures.txt`; `20261116090000_bp_engine.sql:42-44`; `scripts/db-classification.mjs:126-129` ("its tables live in its own closed schema … only its API functions are in public") |
| `hospitality` schema: open to PostgREST (USAGE `anon, authenticated, service_role`), RESTRICTIVE `tenant_isolation` + `backend_enabled` on every table | `schemas.txt`; `20261101110000_hosp_schema.sql:31-35`; `tenant-isolation-coverage.test.sql` hospitality block |
| The app reaches billing only through `public` RPCs, **with the user's own token**, and platform calls only from the platform host | `src/platform/billing/billing.server.ts:1-3,34-38,57-59` |
| `pg_default_acl` has rows **only for schema `public`** (tables `arwdDxt`, functions `X`, sequences `rwU` to `anon, authenticated, service_role`). A new non-public schema gets no API grants by default, but PostgreSQL's built-in PUBLIC EXECUTE on functions still applies → every new function needs an explicit REVOKE | `pg_default_acl` (3 rows, all `defaclnamespace = public`); `acl_checks.txt`: 0 of 589 functions in `billing`/`business_profile`/`hospitality` keep PUBLIC EXECUTE (all revoked explicitly) |
| Roles: `service_role` `rolbypassrls = t`, not superuser; `postgres` superuser; `anon`/`authenticated` no BYPASSRLS | `pg_roles` |
| `platform_feature_flags`: `service_role=arwdDxt` (the server can write any flag directly) | `relacl` of `public.platform_feature_flags` |
| Backups dump as `postgres` (`pg_dump -U postgres`), not as `service_role` | `deploy/backup-daily.sh:133` |

### 1.2 Tests that scope new objects (they decide public-prefixed vs dedicated schema)

| Test | Scope (verified in file) | Consequence |
| --- | --- | --- |
| `remove-hyp.test.sql:42-63` | tables, columns, banned function names and the body regex `(hyp_|payment_intent|tenant_payment_secrets|platform_settings|card_payments_|card_clearing|platform_payments_|checkout_payment_request|payment_token)` — **`public` only** | names in this proposal avoid all of them anyway (checked statically, §6.3) |
| `remove-hyp.test.sql:85-92` | `orders_payment_check` must contain `credit_card`; `place_order`/`place_guest_order` must contain `_details ->> 'payment_method' = 'bit'`, exactly 2 functions | Bit line is the patch anchor; no overloads |
| `remove-hyp.test.sql:227-232` | `store_billing()` and `addons_store()` must **not** return a key `payments_ready` | the platform terminal must expose its availability under another function, not by adding `payments_ready` |
| `tenant-isolation-coverage.test.sql:12-22` | `public` tables with `tenant_id` (+ a hospitality block) | a `payments` schema needs its own coverage block (§9) |
| `db-classification.test.sql` / `scripts/db-classification.mjs:3,168-176` | `public` tables and functions only | tables in `payments` need no classification; `public` API functions are classified by prefix: `platform_.*`, `my_billing_.*` → platform; `max_*` → ecommerce (default) |
| `ecommerce-engine-guard.test.sql:65-69` | "no platform (shared) table carries the Ecommerce guard": `tgname IN ('ecommerce_rows_guard','ecommerce_row_move_guard') AND c.relname NOT IN (<40 public names>)` — **no schema filter** | attaching `ecommerce_*` guard triggers to any new table outside its 40-name list fails this test; the 06b gap L9 ("add the guard triggers") is therefore wrong for a separate schema |

### 1.3 Tenant resolution and roles (live definitions, md5 in §6.3)

- `current_tenant_id()` (live, 1,720 bytes): member with header → header tenant; member without header → the single membership or NULL; member on another store's header → NULL unless platform admin; **no user (anon/`service_role`) with a header → header tenant; no header and no membership → the default store** (`SELECT t.id FROM tenants t WHERE t.is_default`). Live DB: 105 tenants, exactly 1 `is_default` (`kobi`, `00000000-…0001`). So no payment function may derive its tenant from `current_tenant_id()` when called by the server; all take an explicit `_tenant`.
- `is_super_admin(uid)` = admin of `current_tenant_id()` OR (`is_platform_admin(uid)` AND `current_tenant_id() IS NOT NULL`); `is_staff` = `is_admin` OR agent OR POS cashier. A platform admin is therefore staff on every store host.
- `store_staff_role(uid)`: platform admin → `owner`; protected admin → `owner`; other admin → `manager`; `staff_can('billing.manage')` is true for `owner` only.
- `auth.uid()` = `request.jwt.claim.sub` (stub, `scripts/db-tests/supabase-stubs.sql`); NULL in server calls without a user token.

### 1.4 Orders and the functions to patch

- `orders_payment_check` (live, md5 `816c22e1520ae95e394c6a5a094faaec`): method ∈ {offline, credit_card, bit, grow}; status ∈ {not_required, awaiting, awaiting_verification, paid, expired, rejected}; `paid ⇒ paid_at`; `bit_*` only on bit rows; `grow_*` only on grow rows; length limits. Full text in `fingerprints.txt`.
- `orders_tenant_id_key UNIQUE (tenant_id, id)` exists (composite FK target). There is **no BEFORE DELETE trigger on `orders`** today (27 triggers listed in `orders_facts.txt`).
- `orders_default_payment` (live): resets all payment fields, `IF NEW.kind <> 'order' OR public.is_staff(auth.uid()) THEN RETURN NEW` (line 26), Bit branch, Grow branch, then the phone block whose first line `  -- "תשלום טלפוני מול נציג" — רק אם החנות מאפשרת` occurs exactly once (line 54).
- `place_order` / `place_guest_order` (live): `CASE WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'` then `WHEN … = 'grow' THEN 'grow'` then `ELSE 'offline'` (lines 52-54 in both). The anchor `WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'` occurs exactly once in each (`grep -c` = 1).
- `orders_payment_guard` (live) freezes every payment column unless `kobi.payment_update = 'on'` and blocks an awaiting order from leaving `pending`/`cancelled` for **every** method → no change needed for `online`.
- `expire_unpaid_orders()` cancels every pending order with `payment_status='awaiting' AND payment_due_at < now()`, any method.
- No function body and no constraint contains `'online'` today; 0 orders with method `grow` or `online`; no `payments` schema and no `max_*` function exist (the DDL has never run).

### 1.5 Store deletion (decision 15)

`platform_delete_tenant(uuid, text)` (live, md5 `0830b7338656b03a1b13a59c8a1122df`) deletes from every table **in `public`** that has a `tenant_id` column (lines 43-50: `WHERE n.nspname = 'public'`), except `tenants, tenant_ssl, platform_agreement_acceptances, billing_history, platform_audit_log`; it retries only on `foreign_key_violation`/`restrict_violation` (line 66) and then raises; it sets `nuriel.deleting_tenant` (line 34) and finally `DELETE FROM public.tenants` (line 101), which cascades through any FK to `tenants` in any schema. `billing.*` tables survive because they have no FK to `tenants` (`20261114100000:30,62`).

### 1.6 The platform billing domain (what a platform payment can attach to)

| Object | Live facts |
| --- | --- |
| `billing.ledger` | append-only (`billing.guard()` raises on UPDATE/DELETE/TRUNCATE); running balance per `category` with **no allocation of payments to charges**; `billing.summary()` computes due/paid/balance per category and excludes reversed rows and reversal rows (`20261114100000:546-640`) |
| `billing.ledger` CHECKs (live, `billing_constraints.txt`) | `kind IN (charge,payment,credit,reversal)`; `category IN (subscription,setup,other)` (**no `addon`**); `amount > 0 AND amount <= 1000000`; `currency = 'ILS'`; `(kind = 'reversal') = (reverses_id IS NOT NULL)`; `reverses_id` UNIQUE (one reversal per row); `net_amount + vat_amount = amount`; `vat_business_type IS NOT NULL OR source = 'legacy_import'`; exempt ⇒ `vat_rate = 0 AND vat_amount = 0`; `period_end >= period_start`; `confirmation IN (manual,provider)`; `confirmation <> 'provider' OR provider_ref IS NOT NULL`; `provider_ref` ≤ 200; `reference` ≤ 120; `description` ≤ 200; `internal_note` ≤ 500; `method IN (bank_transfer,bit,credit_card,cash,check,other)`; `method IS NULL OR kind IN (payment, reversal)`; `source IN (platform_admin,renewal,plan_change,legacy_import,provider)`; FKs `agreement_id`, `upgrade_request_id`, `reverses_id` |
| `billing.guard()` (live md5 `805a177948e4964354a050987c561892`) | INSERT: `tenants.site_type` must equal `engine` (else raise unless `legacy_import`); a row with `confirmation='provider'` or `source='provider'` raises unless `current_setting('billing.provider_write', true) = 'on'` |
| `billing.add_entry` (live md5 `d42f07c3f709df2ca8f7c5b285846976`) | the only writer today; hard-codes `confirmation='manual'` and `recorded_by = auth.uid()`; splits VAT with `billing.gross_parts(amount, rate)` |
| `billing.upgrade_requests` | owner request; price is "display only — not binding" (`20261114100000:119`); approval creates an agreement version, not a payable amount |
| `public.billing_history` (legacy) | add-on charges live here: `addon_purchase()` inserts `kind='addon', payment_status='due'` and a `tenant_addons` row `status='pending'` with `billing_id`; `platform_approve_addon()` activates and sets the row paid; `billing_history_guard` allows only `due → paid` changing `payment_status, paid_at, reference`, and DELETE of `due` rows only |
| Add-on guards | `require_store_owner_billing` and `tenant_addons_activation_guard` both pass when `auth.uid() IS NULL` (server context) |
| AI packages | `ai_admin_activate/renew(..., payment_confirmed boolean)` are platform-admin/server functions; **no owner-side due record exists** |
| Migration policy | `docs/billing/billing-history-mapping.md:35-48`: "until stage 6, every payment is recorded in one place only"; new payments belong in the new ledger; `billing_history` add-on dues map to ledger `charge`/`other` only in a later approved copy |

## 2. Proposed schema and separation

DDL references below are `04b:<line>` = `docs/payment-gateways/evidence/demo/04b-proposed-ddl-demo.sql.txt`.

### 2.1 Recommendation: a closed schema `payments` + `public` wrappers

All payment tables and internal helpers live in a new schema `payments`; the only entry points are `public` SECURITY DEFINER functions. This is the `billing` (migration 189) and `business_profile` (migration 193) convention (§1.1), made one step stricter: **no API role gets USAGE on the schema, not even `service_role`** (04b:79-85).

| Criterion | `payments` schema (recommended) | `public.payment_*` tables (06b) |
| --- | --- | --- |
| Decision 15: records survive store deletion | automatic: `platform_delete_tenant` scans only `public` (live lines 43-50) and history tables have no FK to `tenants`; no patch to that function | needs a patch of its exclusion list **and** the FK redesign (09-review M6) |
| Default privileges | none: `pg_default_acl` has rows only for `public`; only the built-in PUBLIC EXECUTE on functions must be revoked | every table gets `arwdDxt` for `anon/authenticated/service_role` by default and needs explicit REVOKEs |
| PostgREST reach | none: no USAGE; the app's clients use `schema: "public"` (`src/platform/billing/billing.server.ts:36`) | the tables sit in the exposed schema, protected only by REVOKE + RLS |
| Existing tests | no change to `tenant-isolation-coverage` / `ecommerce-engine-guard` lists; a new coverage block for `payments` (§9) | classification lists, the 40-table ecommerce guard list and its count must change; guard triggers required |
| Cost | the new `public` API functions must still be classified (`node scripts/db-classification.mjs`) and revoked | same |

Rejected alternative: two schemas (`payments_platform`, `payments_tenant`). It adds a second set of grants and search paths for no extra isolation: the separation that matters is per table, per function, per terminal and per key (§2.3).

### 2.2 Object inventory

(a) = DEMO migration 208; (a*) = only if decision 14 is approved; (b) = designed now, created later (04b §16, commented out).

| Scope | Object | Kind | Purpose / key rules | DDL |
| --- | --- | --- | --- | --- |
| cross | `payments.environment` | (a) | one row, created **unset** (NULL = online payments off); the DB owner marks each database `demo` or `production`; guarded transitions (§4) | 04b:102-113, 564-607 |
| cross | `payments.test_users` | (a) | allow-list of non-staff test accounts (decision 13) | 04b:116-121 |
| cross | `payments.terminal_registry` | (a) | PK `(provider, terminal_number)`; `scope ∈ {platform, tenant}`; `(scope='platform') = (tenant_id IS NULL)`; never moved; deletable only if never used | 04b:126-138, 641-665 |
| platform | `payments.platform_accounts` | (a) | NURIEL's terminal, one per provider; **no tenant_id**; `mode`, `test_access`, `enabled`, encrypted `api_key_enc`/`api_password_enc` + `key_version`, `credentials_updated_at/_by`, `status`, installments for owners | 04b:144-188 |
| platform | `payments.platform_attempts` | (a) | one redirect = one payable item (`ledger_charge` or `addon_request`); `payer_tenant_id` (no FK), `payer_label`, `payer_user_id`; states incl. `test_paid`; `applied`; VERIFY lease; `ledger_payment_id` | 04b:194-280 |
| platform | `payments.platform_events` | (a) | append-only; closed JSON key list; replay index | 04b:282-302 |
| platform | `payments.platform_config_audit` | (a) | append-only; field **names** only, no value column | 04b:305-321 |
| tenant | `payments.tenant_accounts` | (a) | one per store; FK `tenants ON DELETE CASCADE` (credentials die with the store); registry FK incl. `tenant_id` | 04b:326-371 |
| tenant | `payments.tenant_store_settings` | (a) | owner's installments / minimum / methods ⊆ verified | 04b:373-387, 778-795 |
| tenant | `payments.tenant_attempts` | (a) | `tenant_id` (no FK), `store_label`, `order_number` snapshots; FK `(tenant_id, order_id) → orders ON DELETE SET NULL (order_id)`; registry FK | 04b:389-470 |
| tenant | `payments.tenant_events`, `payments.tenant_config_audit` | (a) | as platform, with `tenant_id` | 04b:472-516 |
| tenant | `payments.tenant_order_access` | (a) | sha256 of the guest's one-time token (decision 11); removed with the order | 04b:520-529 |
| both | `payments.tenant_returns`, `payments.platform_returns` | (a*) | encrypted raw return for VERIFY retries, ≤ 2 h, ≤ 20 per attempt | 04b:2659-2776 |
| both | `tenant_refunds`, `platform_refunds`, `tenant_external_documents`, `platform_external_documents` | (b) | §7 | 04b:2779-2882 |

Existing objects touched by (a) — all additive: `orders_payment_check` (+`'online'`), `orders_default_payment` (+1 branch), `place_order`/`place_guest_order` (+1 `WHEN`), three new triggers (`orders_online_payment_keep` BEFORE DELETE, `orders_payment_amount_lock` AFTER UPDATE, `order_items_a_payment_lock` BEFORE I/U/D), two flag rows. **No new column on `orders`; nothing in `billing.*`, `billing_history`, `tenant_addons`, Grow or Bit objects changes.** Totals: 13 tables (+2 a*), 32 public functions (+5 a*), 18 internal functions (checker output, §6.3).

### 2.3 How the separation is enforced

| Layer | Mechanism | Where |
| --- | --- | --- |
| Data | separate tables per scope; platform tables carry no `tenant_id` (the payer is `payer_tenant_id`, a reference, not an owner) | 04b §4 vs §5 |
| Terminal | one registry row per number; platform accounts/attempts FK `(provider, terminal_number, scope)`, tenant accounts/attempts FK `(provider, terminal_number, scope, tenant_id)` → a number can never serve two scopes or two stores, through any code path | 04b:126-138, 174-175, 251-252, 359-360, 447-448 |
| Functions | separate APIs: tenant `max_*` / `platform_store_terminal_*`; platform `platform_attempt_*` / `platform_billing_terminal_*` / `platform_card_*` / `my_billing_card_*`. Static check: no platform API body references `payments.tenant_*`, no tenant API body references `payments.platform_*` (only the cross-scope guards and the a* purge job see both) | §6.3 |
| Settle | `max_attempt_mark_paid` touches only orders + tenant tables; `platform_attempt_mark_paid` only billing targets + platform tables | 04b:1256, 2010 |
| Return | a tenant return must arrive on the attempt's store host (`_host_tenant`); a platform return goes to a function that searches only platform attempts | 04b:1202, 1974 |
| Keys | AAD binds scope + tenant/account + mode + field; HKDF label per scope (app side; comments 04b:153-156, 337-338) | architecture/security agents |
| Switches | `max_payments` (stores) and `platform_terminal_payments` (NURIEL) — the architecture agent's names | 04b:88-93 |
| People | platform admin configures both; store owner pays the platform terminal; customers pay the store terminal; platform admins cannot pay NURIEL's terminal nor be test users | 04b:1806-1808, 2464-2485 |

## 3. billing.ledger integration

### 3.1 What a platform attempt pays (recommendation)

| Candidate | Verdict | Reason (evidence) |
| --- | --- | --- |
| **Open `billing.ledger` charge** (`kind='charge'`, not reversed, not `legacy_import`) | **(a) DEMO** — `target_kind='ledger_charge'` | the ledger is the system of record for new payments (`docs/billing/billing-history-mapping.md:46-48`) and already models provider confirmations (`confirmation='provider'`, `source='provider'`, `provider_ref`, the `billing.provider_write` gate). Covers renewals (`platform_billing_renew`), plan changes, setup fees and any `other` charge the admin records |
| **Pending add-on request** (`tenant_addons.status='pending'` + its `billing_history` `due` row) | **(a) DEMO** — `target_kind='addon_request'` | add-on money still lives in `billing_history` (`addon_purchase()`); writing a ledger payment without a ledger charge would show a false credit in `billing.summary` (other_due − other_paid < 0). "One place only" rule (mapping doc :46-48) |
| Upgrade request (`billing.upgrade_requests`) | no | its price is "display only — not binding" (`20261114100000:119`); approval produces an agreement and possibly a charge — the owner pays that charge |
| AI package | (b) | no owner-side due record exists (`ai_admin_activate/renew(..., payment_confirmed)` are admin-only); needs a request + charge first |
| Whole category balance (`ledger_balance`) | (b) option | fits the running-balance model but loses the link to a period/charge; decide after DEMO |
| Hospitality payers | (b) | same ledger (`engine='hospitality'`), but their owner check is `hospitality.can('billing.manage')`; DEMO refuses non-ecommerce payers explicitly (04b:1810-1813) |

Because the ledger allocates no payment to a charge, "still payable" = **the category balance (computed by `billing.summary`, the same numbers the owner sees) still covers the charge** (04b:946-956), checked at open and again at settle (`target_settled` → review/refund).

### 3.2 The provider payment row, column by column, against the live CHECKs (§1.6)

`payments.ledger_provider_payment(charge, attempt, txn)` (04b:958-988), called only from `platform_attempt_mark_paid` when the payment is applied:

| Column | Value | Live CHECK satisfied |
| --- | --- | --- |
| `kind` | `'payment'`; `reverses_id` NULL | `ledger_kind_check`; `ledger_check` (`(kind='reversal') = (reverses_id IS NOT NULL)`) |
| `category` | the charge's (`subscription`/`setup`/`other`) | `ledger_category_check` |
| `amount` | the charge's amount (same 2-decimal numeric; attempt amount = amount × 100 exactly) | `ledger_amount_check` (`> 0 AND <= 1000000`) |
| `vat_business_type`, `vat_rate` | the charge's snapshot (non-legacy charges always have it) | `ledger_check2`, `ledger_vat_rate_check` |
| `net_amount`, `vat_amount` | `billing.gross_parts(amount, vat_rate)`: `vat = round(p·r/(100+r), 2)`, `net = p − vat` | `ledger_check1` (`net + vat = amount`); `ledger_check3` (exempt ⇒ rate 0 ⇒ vat 0) |
| `currency` | default `'ILS'` | `ledger_currency_check` |
| `occurred_on` | `billing.today()` (Asia/Jerusalem) | — |
| `period_start/_end` | the charge's | `ledger_check4` |
| `method` | `'credit_card'` | `ledger_method_check`; `ledger_check6` (method only on payment/reversal) |
| `description` | `'תשלום בכרטיס אשראי: <charge description>'` ≤ 200 (owner-visible) | `ledger_description_check` |
| `reference` | the attempt reference (32 hex, internal) | `ledger_reference_check` (≤ 120) |
| `internal_note` | attempt id, mode, charge number ≤ 500 | `ledger_internal_note_check` |
| `confirmation` / `provider_ref` | `'provider'` / `'max:<mode>:<txn id>'` ≤ 200 (not returned to owners by `billing.summary`) | `ledger_confirmation_check`; `ledger_check5`; `ledger_provider_ref_check` |
| `source` | `'provider'` | `ledger_source_check` |
| `agreement_id`, `upgrade_request_id` | the charge's | FKs |
| `recorded_by/_email` | NULL (no person recorded it; the attempt names the payer) | — |
| `tenant_label`, `engine` | `billing.tenant_label()`, `billing.engine_of()` | `billing.guard()` engine = `tenants.site_type` |

Gate: `billing.guard()` raises for provider rows unless `billing.provider_write = 'on'` (`20261114100000:221-226`); the helper sets it transaction-locally just for the INSERT and resets it (04b:971, 986). `billing.add_entry` is **not** used (it hard-codes `manual` and `auth.uid()`), and no billing object changes. The migration pins `billing.guard` and `billing_history_guard` by md5 in §0 (04b:71-75), so a later change to either fails the migration loudly instead of silently breaking the write.

### 3.3 Locking and double-payment protection

- Lock order in both platform functions: payable item first (`billing.ledger` row `FOR UPDATE`, the pattern `platform_billing_reverse_entry` already uses; or `tenant_addons` then `billing_history` `FOR UPDATE`, the order `platform_approve_addon`/`platform_reject_addon` use), then the attempt (04b:1779-1784).
- `platform_attempts_one_applied_idx` (04b:272-273): at most one applied payment per item; the ledger insert and the attempt update share one savepoint, so a unique violation undoes the ledger row too (04b:2129-2149).
- At settle: reversed charge → `target_changed`; balance no longer covers it (e.g. a bank transfer recorded meanwhile) → `target_settled`; add-on rejected/approved meanwhile → `target_changed`; store deleted → `payer_gone`. All → `needs_review` (refund case), never a second ledger row.

### 3.4 Add-on path (DEMO)

Applied payment sets the `billing_history` row `due → paid`, `paid_at`, `reference = 'max:<mode>:<txn>'` — exactly the one transition `billing_history_guard` allows (live definition, §1.6). Activation stays with the platform admin (`platform_approve_addon`), whose own `UPDATE … WHERE payment_status = 'due'` then simply matches nothing — no change to that function (decision D-8 asks whether to auto-activate later).

### 3.5 Test mode and the ledger

In a `demo` database a verified test payment **is applied** (ledger row with `provider_ref 'max:test:…'`, internal note naming the test mode) so the whole flow can be rehearsed; in `production` a test payment writes nothing to `billing.ledger`/`billing_history` and ends as `test_paid` (04b:2126-2128). A `demo` database that applied test payments can never be switched to `production` (§4.2).

### 3.6 Future refunds in the ledger (designed now, §7; no billing schema change needed)

- **Full refund:** a `reversal` row with `reverses_id` = the provider payment row, same category/amount/VAT snapshot, `method 'credit_card'`, `confirmation/source 'provider'`, `provider_ref` = refund transaction (`ledger_check`, `ledger_reverses_id_key` = one reversal per row). `billing.summary` then excludes both rows, so the charge is due again; cancelling the charge itself stays the admin's act (`platform_billing_reverse_entry` or a `credit`).
- **Partial refund:** "storno and rebook" — reverse the full payment row and book a new provider `payment` row for the retained amount; a second partial refund reverses the rebooked row. Fits today's CHECKs (`amount > 0`, one reversal per row).
- Alternative needing a billing migration (decision D-9): a new `kind 'refund'` with `refunds_id` and multiple partial rows.
- Add-on refunds: `billing_history_guard` forbids any change after `paid`, so they are recorded only in `platform_refunds` until add-on money moves to the ledger (mapping doc stages 4-6).

## 4. Test vs live and the environment guard

### 4.1 Mode at the DB level

| Rule | Enforced by | DDL |
| --- | --- | --- |
| Accounts and attempts carry `mode ∈ {test, live}`; the attempt snapshots the account's mode at open | columns + attempts guard (snapshot immutable) | 04b:148, 209, 401, 667-733 |
| A test attempt can never reach `paid`; a live one never `test_paid` | CHECK `state <> 'paid' OR mode = 'live'`; `state <> 'test_paid' OR mode = 'test'` (both scopes) | 04b:259-260, 450-451 |
| `paid ⇒ applied`; `applied ⇒ paid/test_paid`; one applied payment per order / per item | CHECKs + partial unique indexes | 04b:263-266, 272-273, 454-455, 461-462 |
| A live account cannot hold a test-prefixed terminal | CHECK (one direction, as decided in MAX-HYP-REPORT §6.3) | 04b:177, 361 |
| A live attempt cannot even be inserted outside `production` | attempts guard on INSERT | 04b:684-692 |
| In `production`, test mode only for listed test users; a test payment ends `test_paid`, **not applied** (order stays awaiting and expires; nothing written to billing) | `payments.mode_allowed`, settle `_apply` | 04b:879-887, 1380-1382, 2126-2128 |
| In `demo`, only test terminals can be saved (mode test **and** Hyp's documented test-terminal prefix), so no live terminal and no real charge is possible through NURIEL; `test_access='open'` lets every customer/owner pay with the test terminal (guests too) | accounts guard; CHECK `open ⇒ mode test` | 04b:609-639, 178, 362 |
| The app passes its own marker (`PAYMENTS_ENV`, architecture §3.4) as `_app_environment` to every start, terminal save **and settle**; NULL or mismatch → start/save refused; settle recorded but **not** settled, state unchanged (`environment_mismatch`) | open/save/settle functions | 04b:1044, 1293, 1620, 1803, 2051, 2310 |

### 4.2 The environment guard

- **What:** `payments.environment(name ∈ {NULL, demo, production})`, one row (PK `boolean`, `CHECK (id)`), created **unset** by the migration (04b:102-113): NULL = online payments off in both scopes (`payments.env()` returns NULL; every comparison is NULL-safe). The DB owner marks each database once: `UPDATE payments.environment SET name = 'demo', note = '<why, approved by>';` (approval required, §8); a production database would be marked `'production'` only at its own, later go-live. **Two keys must agree**: the DB marker and the app's `PAYMENTS_ENV`, passed as `_app_environment` (aligned with the architecture agent's §3.4).
- **Transitions (trigger, 04b:564-607):** to `demo` (from anything) refused if any live account, any non-test-prefixed terminal or any live attempt exists; to `production` (from anything) refused if any terminal is open for testing or any test payment was ever applied; back to NULL (off) always allowed; DELETE/TRUNCATE refused; every change writes a `system` row to `platform_config_audit`.
- **Who can flip it:**

| Actor | Can change it? | Why |
| --- | --- | --- |
| anon / authenticated (any tenant user, store owner) | no | no USAGE on schema `payments`, no table privilege (04b:85, 532-559); no `public` function writes it (static check) |
| `service_role` (the app server) | no | same; unlike `platform_feature_flags`, where `service_role` holds `arwdDxt` (live ACL) — which is why a flag was rejected as the guard |
| platform admin through the panel | no | no function exists for it |
| DB owner (`postgres`, via SSH/docker) | yes, within the transition rules | deliberate: an infrastructure fact, set at provisioning time |

### 4.3 Behaviour matrix

| Environment | Account mode | Who can start | Settle result | Order / ledger touched? |
| --- | --- | --- | --- | --- |
| unset (NULL), or app marker ≠ DB marker | any | nobody (starts and terminal saves refused) | `environment_mismatch`, no state change | no |
| demo | test, `allow_list` | listed test users | `test_paid` | **yes** (DEMO rehearsal) |
| demo | test, `open` | any non-staff customer / store owner (guests too) | `test_paid` | **yes** |
| demo | live | impossible (account cannot be saved) | — | — |
| production | test (`allow_list` only) | listed test users | `test_paid` | **no** |
| production | live | everyone eligible | `paid` | yes |

### 4.4 Robustness evaluation

| Threat | Result |
| --- | --- |
| A tenant (or a compromised store-owner token) flips DEMO on | impossible: no grant, no function; RLS deny-all as a second layer |
| The app server is compromised (service_role) | cannot flip the environment or write any payments table directly; can call the public API, whose rules still apply (test payments never applied in production) |
| A DBA flips it by mistake | `production → demo` refused once any live terminal/payment exists; release post-check must assert `production` (§8) |
| A database is copied across environments (restore of a dump) | the marker travels with the copy, so the two keys disagree on the target box (`PAYMENTS_ENV=production` vs `demo`, or the reverse) → everything off; a DEMO copy holds only test terminals anyway; `demo → production` is refused once test payments were applied |
| The app points at the wrong database | `_app_environment` mismatch refuses starts and terminal saves, and settles are recorded but not applied |
| Weakness | a superuser can bypass any trigger (`session_replication_role = replica`); the guard prevents accidents, not a malicious DBA. The terminal prefix rule relies on Hyp's documented prefix (decision D-5) |
| Rejected alternatives | a custom GUC (`ALTER DATABASE … SET`) can be overridden by any session with `SET`; a feature flag is writable by `service_role`; keying on `current_database()` couples to deployment naming |

## 5. RLS and grants

| Object | anon | authenticated | service_role | Notes |
| --- | --- | --- | --- | --- |
| schema `payments` | — | — | — (no USAGE) | 04b:85; post-check 04b:2629-2641 |
| every `payments` table / sequence | — | — | — | REVOKE ALL; RLS on everywhere; tenant tables `tenant_isolation` RESTRICTIVE (`tenant_id = (SELECT current_tenant_id())`); platform/cross tables `platform_only` RESTRICTIVE `USING (false)` (04b:532-559) |
| every `payments.*` function (18) | — | — | — | owner only (04b:2507-2509); trigger functions that run on `public.orders`/`order_items` are SECURITY DEFINER because the writer may be `authenticated` |
| 30 server API functions (`max_*`, `platform_store_terminal_*`, `platform_attempt_*`, `platform_attempts_expire`, `platform_card_*`, `platform_billing_terminal_*`, `platform_payment_tester*`) | — | — | EXECUTE | each takes the store and/or actor explicitly and checks it inside (04b:2510-2529) |
| `my_billing_card_payments()`, `my_billing_card_options()` | — | EXECUTE | EXECUTE | user's own token + store header, authorized by `billing.owner_tenant()` exactly like `my_billing_summary` (04b:2235, 2255, 2530-2535) |
| (a*) 5 return functions | — | — | EXECUTE | 04b:2769-2774 |

- **`current_tenant_id()`**: its default-store fallback (§1.3) makes it unusable for server calls; no payment function relies on it except the RLS policy (defense in depth) and `billing.owner_tenant()` for the two owner reads, which run with the user's token and the store header — the existing billing pattern.
- **Every function** pins `SET search_path = ''` and schema-qualifies every name (checker: 0 exceptions). 32 public + 18 internal; SECURITY DEFINER = all public ones + 3 trigger functions on public tables; the other internal helpers are INVOKER (only ever called by DEFINER code).
- **No ciphertext leaves the DB** except through `max_attempt_secrets`/`platform_attempt_secrets` (one attempt, one purpose, VERIFY lease) and the two connection-check functions (platform admin only); status functions return `has_*` flags and a masked terminal.
- **service_role vs 06b:** stricter — 06b gave `service_role` SELECT on non-secret columns; here it has no table access at all (backups use `postgres`, `deploy/backup-daily.sh:133`). If ad-hoc server reads are wanted, the 06b column grants can be added (decision D-11).
- The migration asserts all of this in its own transaction (§14 post-conditions, 04b:2615-2653): RLS on every table, no API privilege on tables/sequences/schema, no API EXECUTE on internal functions, settle functions not callable by `anon`/`authenticated`.

## 6. Fixes to 06b

### 6.1 The two named issues and the other corrections

| 06b | Problem | Fix in 04b |
| --- | --- | --- |
| `:1063`, `:1088-1101`, `:1110-1122`, all `'max'` method checks | method `'max'` contradicts decision 2 | `'online'` everywhere: CHECK 04b:2543-2559, branch 04b:2569-2593, mapping 04b:2595-2611, all `o.payment_method = 'online'` checks |
| `:1110-1122` | place_* patch anchored on the **Grow** line (would fail once Grow's line is removed) | anchored on `WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'` (once per function, live), inserting the online line right after it; the Bit text stays, so `remove-hyp.test.sql:89-92` holds; the Grow line is untouched (04b:2595-2611); post-check asserts both texts (04b:2619-2624) |
| `:1061-1076` | — | Grow clauses kept byte-for-byte (old Grow orders stay valid), `credit_card` kept (`remove-hyp.test.sql:85-88`) |
| `:23,65,85,152,183` | `tenant_id … ON DELETE CASCADE` on history tables (deleted with the store) | no FK to `tenants` on attempts/events/audit; credentials cascade (04b:331) |
| `:127-128` | `→ orders ON DELETE RESTRICT` blocks `platform_delete_tenant` | `ON DELETE SET NULL (order_id)` + `orders_online_payment_keep` (store admin cannot delete; tenant deletion can) (04b:445-446, 760-776) |
| `:415`, `:1088-1101` | test mode "platform admin only" — unworkable (H1) | allow-list + environment rules (§4) |
| `:477`, no extension | VERIFY retries outlast the order (M5) | `record_return` extends `payment_due_at` (+2 h, ≤ 24 h after creation) under the order lock (04b:1239-1246) |
| `:701-705`, `:733-734` | second paid page labelled `late` (M4) | `duplicate_charge` when the order was already paid by another applied attempt (04b:1355-1362) |
| `:118-120` | no reason for exhausted VERIFY / changed credentials (L10) | `verify_exhausted`, `credentials_changed` (+ `mode_not_allowed`) (04b:434-437) |
| — | no environment concept (owner requirements 8-9) | `payments.environment` + `_app_environment` on every start, terminal save and settle (§4) |
| — | no VERIFY lease (L10) | `verify_lease_until`, `verify_attempts`; taken in `*_secrets('verify')` (04b:1140-1158) |
| — | guest token hash, review note, one-paid-per-order index, `credentials_updated_at/_by` (L10) | `tenant_order_access`; `review_note`; `*_one_applied_idx`; columns (04b:520-529, 438, 461-462, 342-343) |
| L9 | "add `ecommerce_rows_guard` triggers" | **not applied**: would fail `ecommerce-engine-guard.test.sql:65-69` for tables outside `public`; ecommerce-only is enforced by the FK chain (attempts → orders, which carry the guard) and the save function's `site_type` check (04b:1623) |
| `:229`, `:278`, `:294` | guard functions without `search_path` checks on new types | all functions `SET search_path = ''` |
| `:212`, `:218-223` | `service_role` SELECT on tables | no table grants at all (§5) |
| `:658` + race | concurrent settle with the same transaction id raised an unhandled unique violation | caught per savepoint → `duplicate_txn` / `duplicate_charge` (04b:1383-1401) |
| `max_attempt_cancel` | cancelled a `returned` attempt (being verified) | refuses while an attempt is `returned` (04b:1462-1467) |

### 6.2 Every existing function the DEMO migration patches or depends on (live md5 of `pg_get_functiondef`, 2026-11-27)

SQL: `SELECT p.oid::regprocedure, md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid IN (...)` (`fingerprints.txt`). Today's text is byte-identical to the earlier phase's dumps (7 functions compared).

| Object | Role in 208 | md5 |
| --- | --- | --- |
| `public.orders_default_payment()` | **patched** (anchor: phone block, line 54) | `399a61c8498b9d8d40b937c51c06f8d6` |
| `public.place_order(text,jsonb,numeric,boolean,jsonb)` | **patched** (anchor: Bit line) | `4b0f65ed766f47e4bd86b00392b2a8fd` |
| `public.place_guest_order(text,jsonb,jsonb)` | **patched** (anchor: Bit line) | `2e0eff3b865bf32e5ceb0e99e50132ca` |
| constraint `orders_payment_check` (`pg_get_constraintdef`) | **replaced** (+`'online'`) | `816c22e1520ae95e394c6a5a094faaec` |
| `billing.guard()` | relied on (provider gate) — precondition | `805a177948e4964354a050987c561892` |
| `public.billing_history_guard()` | relied on (due → paid) — precondition | `8801e3da560c241242939bfa9441c168` |
| `public.platform_delete_tenant(uuid,text)` | relied on (scans `public` only) — test pin | `0830b7338656b03a1b13a59c8a1122df` |
| `public.current_tenant_id()` | RLS policy — test pin | `376715b1750ed5d9cb145658add34bf2` |
| `public.expire_unpaid_orders()` | unchanged; works for `online` — test pin | `8fa6bc8d47665c1d802a01a6cacbb0a7` |
| `public.orders_payment_guard()` | unchanged; covers `online` — test pin | `4c2ef1245ef538fd1cb68bfeaa1a3fea` |
| `public.order_amount_due(numeric,boolean,numeric)` | amount source — test pin | `6181e83dd4ac8ad1ce4171fc1e079cb4` |
| `public.grow_mark_paid(text,boolean,text,numeric,text,text,text,text,text,integer)` | must stay unchanged | `b8520c165606643c386251833c7a63dc` |
| `public.grow_payments_active(uuid)` | must stay unchanged | `9111e75769b233fef5a096125c6b0fb8` |
| `public.bit_payment_review(uuid,boolean)` / `bit_payments_active(uuid)` | must stay unchanged | `280d68c997b837e9b94d7c60d02d43f1` / `a73657ead2e492aaf77d3ae08c4d2c17` |
| `public.addon_purchase(text,numeric)` / `platform_approve_addon(uuid,text)` | relied on — test pin | `bd3c1a3b3dd09a327994c0e51dbe599c` / `fe6cbbe0dd576bda63c4f6d80c148a54` |
| `public.store_billing()` / `addons_store()` | must stay without `payments_ready` — test pin | `15576f49a14e7457e843679230ca0aa1` / `df874c3512475dcc8efac3bc689045ab` |
| `billing.add_entry(...)` | not used (hard-codes `manual`) — test pin | `d42f07c3f709df2ca8f7c5b285846976` |
| `public.is_staff(uuid)` / `is_platform_admin(uuid)` | used by locks/checks — test pin | `41ac5169df1cf53ed87e409ddbb7185a` / `8af3203fd488f8d9e8a3009a0539393b` |

The migration's §0 (04b:42-76) refuses to run if a patched object is neither the fingerprinted text nor already patched, or if a relied-on guard changed; the rollback proves exact restoration by the same four fingerprints (04b:3009-3018).

### 6.3 Static checks on 04b (no parser; `04-tools/check_ddl.py`, data-only read)

All PASS: first line exact; **0 matches of the `remove-hyp.test.sql:63` body regex in the whole file**; none of the 22 banned names (`:53-58`); no `payments_ready`; dollar-quote tags balanced; 3 BEGIN / 3 COMMIT (208, a*, rollback); every function has `SET search_path = ''`; every public function is in an explicit REVOKE/GRANT list; scope separation (above); no 10–19-digit runs (no terminal or card numbers); only the six md5 fingerprints as 32-hex literals. Not checked: SQL syntax and plpgsql semantics — the first real run (`run.sh`) will find what text review cannot.

## 7. Future refunds and documents — (b), designed now, created later (04b §16, commented out)

| Item | Design | Depends on |
| --- | --- | --- |
| `payments.tenant_refunds` / `payments.platform_refunds` | one row per refund: `amount_minor > 0`, `kind full/partial`, `channel` (`same_day_cancel` = CancelTrans, `refund_api` = zikoyAPI, `recorded_from_portal`), `state requested → submitted → succeeded/failed` (+`cancelled`), `idempotency_key` UNIQUE, `provider_refund_txn_id` UNIQUE per terminal, mode snapshot, `reason`, `requested_by`; one open refund per attempt (partial unique index); **Σ(requested+submitted+succeeded) ≤ attempt.amount_minor** checked under the attempt row lock and re-checked by a deferred constraint trigger; a `submitted` refund with unknown outcome is reconciled by a person, never re-sent automatically | Hyp: "You can cancel a transaction up until 22:00 Israel time on the same business day" (CancelTrans, `CCode=0` + `ReversalStatus=777`); zikoyAPI "perform a refund for a transaction that has already been settled", "a refund creates a brand-new transaction", amount "equal to or less than the original", error 33 = too high; `zPass` ambiguous (evidence `01-hyp-pay-official-docs.md:173-179`) → may need a third encrypted credential column |
| Platform refunds ↔ ledger | `ledger_reversal_id`, `ledger_rebook_id` (§3.6 storno-and-rebook) | no billing change, or decision D-9 |
| Order screen | the owner (or platform admin) requests a refund from the order; `orders.payment_status` stays `paid`; "refunded / partially refunded" derives from the refunds table (no provider columns on `orders`) | owner requirement 5, Hyp answers |
| `payments.tenant_external_documents` / `platform_external_documents` | `document_provider` = free identifier (`^[a-z][a-z0-9_]{1,30}$`, no enum, no FK — SmartBee or anything else later), `document_kind` (receipt / invoice_receipt / credit_note), `status pending/issued/failed/voided`, `external_id` UNIQUE per provider, `external_number`, amount, `idempotency_key`, exactly one source (attempt or refund; platform: + `ledger_entry_id`); no document URL stored | owner requirements 6-7: no connection, no dependency, no in-house invoicing |

## 8. Migration plan

1. **Approval first** (owner requirement 9): decisions §10, and Hyp's answers on VERIFY coverage and transaction-id format (MAX-HYP-REPORT §1.6 Q2/Q10) for the settle checks.
2. **Files** (written only after approval, on `payments/max-hyp`): `supabase/migrations/<YYYYMMDDhhmmss>_online_payments_foundation.sql` (migration 208, timestamp > `20261127100000`) = 04b:38-2656 (+ §15 if decision 14); `supabase/rollbacks/<same>_online_payments_foundation.down.sql` = 04b:2894-3021.
3. **Single transaction, idempotent:** `BEGIN … COMMIT`; `IF NOT EXISTS` / `DROP … IF EXISTS` / `ON CONFLICT DO NOTHING` / `CREATE OR REPLACE`; patches skipped when their marker is present; §0 preconditions accept "fingerprinted or already patched"; §14 post-conditions inside the transaction. Matches `run.sh`, which re-applies the newest migration twice on clean DBs and twice over fixture data (`scripts/db-tests/run.sh:63-74`).
4. **Data guards:** additive only — new empty tables, a widened CHECK, two flag rows (OFF), three triggers that act only on `online` orders, patches that add branches. No existing row is updated. The CHECK swap scans `orders` (small in DEMO; `NOT VALID` + `VALIDATE` for a future production run). The rollback refuses while any attempt, account, registry row, test user, store audit row, `online` order or provider ledger row exists (04b:2897-2913).
5. **Rollback:** guard → drop the three triggers → remove the inserted text verbatim (fails loudly) → restore `orders_payment_check` verbatim from `20261019520000:94-110` → drop the 37 public functions → `DROP SCHEMA payments CASCADE` → delete the two flags → md5 proof (04b:2894-3021). Add `check_guard` lines to `rollback-guards.sh` and the "identical to 207" comparison to `rollback-check.sh`.
6. **Order:** Release 207 (production, pending its own approval) → Grow retirement stage 1 (code only, no DB change, its own branch; no ordering constraint at DB level) → 208. 208 must sort after 207 in `supabase/migrations/` and depends on 207's schema only through the §0 check. Grow objects are untouched, so Grow stage 2 (file removal) never needs a DB step either.
7. **Where it is applied in this stage:** local `shop_test` (via `run.sh`), the CI database, the concurrency DBs (`conc_*`), and — after a separate approval — a non-production DEMO instance (none exists yet; `docs/hospitality/staging-plan.md` is only a plan). Until a database is marked, online payments stay off there. Local/CI: the new test files mark `shop_test` / `conc_*` themselves as `postgres` (and unmark at the end). A DEMO instance: after applying 208, the DB owner runs the one `UPDATE payments.environment SET name = 'demo'` (§4.2) and the app is deployed with `PAYMENTS_ENV=demo`. **Never production in this stage**; no `deploy/release-*.sh` is written now (a future one would assert `name = 'production'`, RLS, no API grants, flags off).
8. **Repo follow-ups in the same implementation change** (not done now): `node scripts/db-classification.mjs` (32–37 new public functions: `max_*` → ecommerce by default, `platform_*`/`my_billing_*` → platform); the new test files (§9); no change to `ecommerce-engine-guard`, `tenant-isolation-coverage` or `remove-hyp` tests.

## 9. SQL / concurrency / rollback test catalog

New file `scripts/db-tests/online-payments.test.sql` (tests.check / tests.run style; a local `tests.service(...)` helper that runs `SET LOCAL ROLE service_role` with an empty JWT sub, like `tests.server` in `remove-hyp.test.sql:8-20`). Non-default stores A/B (`70…0a`, `70…0b`) to catch the default-store fallback; the environment switched by the test itself as `postgres` and restored at the end.

| # | Group | Cases (expected) |
| --- | --- | --- |
| T1 | Structure | schema has no USAGE for anon/authenticated/service_role; RLS on all 13 tables; tenant tables have RESTRICTIVE `tenant_isolation`, platform/cross tables RESTRICTIVE `platform_only`; 0 table/sequence privileges for API roles; 18 internal functions not executable by API roles; 30 public functions `service_role` only, 2 `my_billing_card_*` `authenticated`; every function `search_path=""`; `remove-hyp` body regex 0 matches in `payments` too |
| T2 | Separation | registry: same number for store B after store A → error; store number reused by platform → error; platform number reused by a store → error; UPDATE of a registry row → error; DELETE of a used number → error; DELETE of an unused one → ok; platform function bodies contain no `payments.tenant_` (catalog query on `prosrc`) and vice versa; a store attempt reference sent to `platform_attempt_record_return` → `unknown` |
| T3 | Defaults | both flags off; `max_payments_active` false everywhere; `place_order` with `online` → clear error; `credit_card` → offline (existing tests still pass); `payments.environment.name` IS NULL and every start / terminal save refused until marked |
| T4 | Environment | NULL `_app_environment` or a mismatch → start/save refused, settle → `environment_mismatch` with the attempt unchanged (and a later matching settle succeeds); `production → demo` with a live account/attempt → error; `demo` + saving a live or non-prefixed terminal → error; `open` test access in production → error; `demo → production` after an applied test payment → error; DELETE/TRUNCATE → error; each change → one `environment_changed` audit row |
| T5 | Test vs live | production + test account: non-listed customer → not offered; listed tester → offered; settle → `test_paid`, `applied=false`, order still `awaiting`, no ledger/billing_history change; demo + `open`: guest → offered; settle → `test_paid`, `applied=true`, order `paid`; direct UPDATE to `paid` on a test attempt → CHECK error; live attempt INSERT in demo → error; `_app_environment` mismatch → error |
| T6 | Tenant settle rules | reuse on double open; refused while `returned`; cap 5; unverified → no change; unknown payload; decline → `failed`; success → `paid`/`test_paid`; repeat → `already_paid`; different txn on a settled attempt → `duplicate_charge`; reused txn → `duplicate_txn`; amount/currency/installments/terminal mismatch → `needs_review`; order changed amount → `amount_mismatch`; expired attempt + order awaiting → paid; order expired → `late`; second applied attempt → `duplicate_charge`; return extends `payment_due_at` (+2 h, ≤ 24 h); wrong host → `unknown` + `wrong_host` event; guest without token → `order not found` |
| T7 | Amount lock | customer line insert during an active attempt → error; into a paid online order → error; staff shipping edit during an attempt → error; after `max_attempt_cancel` → ok; `max_attempt_cancel` while `returned` → error; Grow/Bit orders unaffected |
| T8 | Platform + ledger | owner pays a charge (demo/test): one ledger row with `kind payment`, `confirmation provider`, `source provider`, `provider_ref` set, `method credit_card`, `net+vat=amount`, category/VAT = charge's; `billing.summary` balance drops by the amount; a second payment of the same charge → refused at open / `duplicate_charge` at settle; charge reversed meanwhile → `target_changed`; manual payment recorded meanwhile → `target_settled`; manual INSERT of a provider row without the gate → `billing.guard` error (unchanged); add-on: `billing_history` due → paid with reference, `tenant_addons` still `pending`, then `platform_approve_addon` succeeds; add-on rejected meanwhile → `target_changed`; platform admin as payer → error; manager (non-protected admin) → error; hospitality payer → error; `store_billing()`/`addons_store()` still without `payments_ready` |
| T9 | RLS / roles | as `authenticated` (owner of A): `SELECT` on any `payments` table → permission denied; `my_billing_card_payments()` returns A's rows only; on B's header → error; as `anon`: every public payment function → permission denied; as `service_role`: direct table access → permission denied |
| T10 | Secrets | `*_status` and lists contain no `_enc` key and no `v1:` substring; `*_secrets('sign')` refused for expired / other store's attempt; `'verify'` lease: second call → `busy`; 7th call → `exhausted` + `needs_review` |
| T11 | Audit | every config change writes exactly one audit row with field names only; UPDATE/DELETE of events/audit → error; credential change while `returned` without force → error; with force → `credentials_changed` review |
| T12 | Store deletion | `platform_delete_tenant` with attempts present succeeds; attempts/events/audit remain with `order_id` NULL and snapshots intact; credentials and store settings gone; registry row remains; store admin deleting an order with an attempt → error |
| T13 | Unchanged | md5 pins of §6.2 (Grow, Bit, expiry, guards, billing) |

Concurrency (`scripts/db-tests/online-payments-concurrency.sh`, the `order-guard-concurrency.sh` pattern: own DB, all migrations, parallel `psql` sessions released by an advisory-lock barrier): C1 two parallel opens → one attempt; C2 two parallel `max_attempt_mark_paid` (same payload) → one `paid`, one `already_paid`; C3 two returns with different payloads racing → both events, one due extension; C4 settle vs `expire_unpaid_orders` → never paid **and** cancelled; C5 settle vs `max_attempts_expire` (SKIP LOCKED) → paid; C6 one transaction id on two orders → one paid, one `duplicate_txn`; C7 two platform settles of the same charge → one ledger row; C8 platform settle vs `platform_approve_addon` / `platform_reject_addon` → consistent outcome, no deadlock; C9 two admins registering the same number for two stores → one wins.

Rollback: `rollback-guards.sh` `check_guard` for each guarded table (attempts, accounts, registry, test users, store audit, `online` order, provider ledger row); `rollback-check.sh`: apply 208 → rollback → schema identical to 207 and the four md5 fingerprints restored; apply → rollback → apply again (idempotent re-apply).

## 10. Decisions for the owner

| # | Decision | Recommendation |
| --- | --- | --- |
| D-1 | Dedicated closed schema `payments` vs prefixed `public` tables | `payments` (§2.1) |
| D-2 | Environment marker | created unset (off); each DEMO DB marked `demo` by the DB owner with your approval; app and DB markers must agree (§4.2; aligned with the architecture agent) |
| D-3 | In a DEMO DB, does a verified test payment mark the order paid / write the ledger? | yes (applied), so the whole flow is rehearsed; never in production (§4.3) |
| D-4 | `test_access='open'` (all customers incl. guests, DEMO only) | allow, to test guest checkout; production stays allow-list only |
| D-5 | In DEMO, require Hyp's documented test-terminal prefix | yes (no live terminal can even be saved); relax only if Hyp issues a test terminal without it |
| D-6 | Platform payables in DEMO | ledger charges + pending add-ons; AI packages, whole-balance payments and hospitality payers later |
| D-7 | Platform admins cannot pay NURIEL's terminal; testers are listed owner/customer accounts | yes |
| D-8 | Auto-activate an add-on after a provider-confirmed payment | not in DEMO (admin activates as today); revisit after DEMO |
| D-9 | Platform partial refunds in the ledger | storno-and-rebook (no billing change) vs a new `refund` kind (billing migration) — choose before refunds are built |
| D-10 | Keep the encrypted raw return (decision 14) | yes, `(a*)` §15 |
| D-11 | `service_role` read access to payment tables | none (stricter than 06b); add 06b's column grants only if ad-hoc server reads are needed |
| D-12 | Orders with a payment record cannot be deleted by a store admin (cancel instead) | yes (decision 15) |
| D-13 | Approve applying migration 208 to local/CI, and later to a DEMO instance | required before any of it happens; production excluded |
| D-14 | Test mode in production (later stage): allow-listed test users (Phase A decision 13 — what this DDL implements) or none at all (architecture agent's O-5) | either is fine for DEMO; O-5 is a two-line change (`payments.mode_allowed`, accounts guard). Pick one before production |
| D-15 | Root secrets: one per scope (`PAYMENTS_SECRETS_KEY` for stores, `PLATFORM_TERMINAL_SECRETS_KEY` for NURIEL — architecture O-4) | DB-neutral (the DB stores ciphertext + `key_version` only); recommended, it strengthens the separation |

**(c) Out of scope for this stage:** hospitality guest payments; wallets (Apple/Google Pay, bit via Hyp); tokens, recurring charges, J5/postpone; payouts; SmartBee or any document connection; an in-house invoicing system; fixing the existing Grow/Bit amount drift (decision 6 extension); any production change or release script.
