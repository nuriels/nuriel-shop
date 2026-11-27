# Payments map: what exists today, to inform the design of a native MAX / Hyp (Yaad Sarig) redirect provider

**Repo:** `(repo root)`, branch `payments/max-hyp`, HEAD `910b1f9`. This is the same commit as the docs/CI head. The branch has no Hyp or MAX work on it yet.

I only read files and ran `git log`/`git show`. I modified nothing and ran no tests. I printed no secret values; env vars appear by name only. Statements marked **(code-reading)** are inferences from source that I did not execute.

---

## 1. Store checkout payments today

### 1.1 Methods and providers that exist

The latest `orders_payment_check` is in `supabase/migrations/20261019520000_grow_payments.sql:94-110`:

```sql
payment_method IN ('offline', 'credit_card', 'bit', 'grow')
AND payment_status IN ('not_required','awaiting','awaiting_verification','paid','expired','rejected')
AND (payment_status <> 'paid' OR paid_at IS NOT NULL)
AND (payment_method = 'bit' OR (bit_transaction_id IS NULL AND bit_receipt_url IS NULL))
AND (payment_method = 'grow' OR (grow_asmachta IS NULL AND grow_transaction_id IS NULL
                                 AND grow_card IS NULL AND grow_installments IS NULL))
```

| Method | Enabled by | How "paid" is established | Main code |
|---|---|---|---|
| `offline` ("תשלום טלפוני מול נציג") | `site_settings.payment_phone_enabled`, default true (`.../20261019240000_offline_payments_bit.sql:35-38`) | Never tracked: `payment_status='not_required'` | `orders_default_payment` (`.../20261019360000_remove_hyp.sql:46-100`) |
| `bit` (manual transfer to the owner's phone) | `site_settings.payment_bit_enabled` + `payment_bit_phone`; `bit_payments_active(_tenant)` (`.../20261019240000_offline_payments_bit.sql:87-99`) | Manual. The customer sends a reference or screenshot (`bit_payment_submit` → `awaiting_verification`). The store admin approves or rejects with `bit_payment_review`, called directly from the browser (`src/components/orders/BitPaymentReview.tsx:87`). | `src/lib/bit-payments.functions.ts` (getBitPayment :66, submitBitPayment :85, getBitReceipt :182), `bit-payments.ts`, `bit-receipts.server.ts`, route `src/routes/checkout_.bit.$orderId.tsx`, `src/components/checkout/BitPaymentPage.tsx`, private bucket `payment-receipts` (`.../20261019240000_offline_payments_bit.sql:682-689`) |
| `grow` (Meshulam hosted page: card, Bit, Apple Pay, Google Pay) | `tenant_grow_credentials.enabled`, set **only by the platform admin**; checked by `grow_payments_active(_tenant)` (`.../20261019520000_grow_payments.sql:115-126`) | Server webhook → `grow_mark_paid` | See §1.2 |
| POS (staff cash register) | `staff_can('pos')` | The cashier records `orders.pos_payment_method` ∈ `cash, card, bit, transfer, check, later` (`.../20261019380000_admin_pos_barcode_labels.sql:41-54`, `src/lib/pos.ts:15`) | `orders_pos_guard` |
| `credit_card` (Hyp/MAX) | **Removed** in Part 28 | Allowed only for old rows; any new request maps to `offline` | §5 |

There is **no provider abstraction, interface or registry**. Each method is hard-wired in all of these places:
- the CHECK constraint above;
- `orders_default_payment` (one branch per method);
- the inline `CASE` in `place_order` and `place_guest_order`;
- `cleanPayload` (`src/lib/checkout.functions.ts:51`);
- `PaymentMethodChoice` (`src/lib/checkout.ts:157`);
- `PaymentMethod` (`src/lib/bit-payments.ts:17`) and `orders.ts:314`;
- the per-provider column families (`bit_*`, `grow_*`) and their locks in `orders_payment_guard`;
- the radio options in `src/routes/checkout.tsx:335-349,1475-1546`;
- email text in `src/server/services/notifications.ts:396` and `src/lib/order-emails.server.ts:82`;
- `src/components/orders/PaymentBadge.tsx` and `GrowPaymentInfo.tsx`.

### 1.2 Grow flow (the only online provider)

Parts 43 and R-2. Files:
- `src/lib/grow.server.ts`
- `src/lib/grow-payments.functions.ts`
- `src/lib/grow-webhook.server.ts`
- `src/lib/grow-crypto.server.ts`
- `src/lib/platform-grow.functions.ts`
- `src/routes/api.webhooks.grow.ts`
- `src/routes/checkout_.grow.$orderId.tsx`
- `src/components/checkout/GrowPaymentPage.tsx`

Steps:

1. **The order is created first.** It is saved as `payment_method='grow'`, `payment_status='awaiting'`, `payment_due_at = now()+2h`. This is done by a string patch of `orders_default_payment` (`.../20261019520000_grow_payments.sql:151-169`).
2. **The client goes to `/checkout/grow/<orderId>?start=1`** (`checkout.tsx:818-832`).
3. **`startGrowPayment`** (`grow-payments.functions.ts:31-112`):
   - IP rate limit `grow-start:` 20 per 15 minutes.
   - Loads the order through the tenant-scoped `supabaseAdmin`. Requires `payment_method='grow'`, `payment_status='awaiting'` and `status='pending'`.
   - Computes the amount **server-side**:
     ```ts
     const { data: due, error: dueError } = await supabaseAdmin.rpc("order_amount_due", {
       _total: order.total, _prices_include_vat: order.prices_include_vat, _vat_rate: order.vat_rate });
     ```
   - Calls `createGrowPaymentProcess` (`grow.server.ts:124-161`) with:
     - `successUrl=${tenantSiteOrigin()}/checkout/grow/<id>` and `cancelUrl=...?cancelled=1` (store origin taken from the DB, not from request headers);
     - `notifyUrl=${portalOrigin()}/api/webhooks/grow` — a fixed platform gateway; `portalOrigin()` is in `src/lib/platform-files.server.ts:24`;
     - `cField1=orderId`.
   - Supersedes any older `pending` process, then inserts a `grow_payment_processes` row containing `process_id`, `sha256(processToken)`, `amount` and `sandbox` (`:93-106`). Only `url` goes back to the browser.
   - It does **not** extend `payment_due_at`.
4. **Return page.** `GrowPaymentPage` polls `getGrowPaymentStatus` (`grow-payments.functions.ts:114-147`, IP 240 per 15 minutes) every 3 s, up to 20 times (`GrowPaymentPage.tsx:20-21`). **The return page never marks paid.**
5. **Webhook** `POST /api/webhooks/grow` (`api.webhooks.grow.ts:13-33`):
   - Unauthenticated; rate limit `grow-webhook:` 300 per 10 minutes per IP.
   - `parseGrowWebhook` (`grow.server.ts:203-275`) accepts form `data[...]` or JSON and requires `processId` and `processToken`.
   - `processGrowWebhook` (`grow-webhook.server.ts:30-101`) tries `grow_mark_paid` with sandbox=false, then sandbox=true.
   - On `paid` it calls `approveGrowTransaction` (result ignored), writes an audit row, and sends order emails inside `runWithTenant` (`:104-117`).
   - On `paid_late` it writes an audit row and rings the store admins' bell (`alertStaffPaidLate`, `:123-159`).
   - HTTP mapping (`:22-26`): `malformed`→400, `error`→500 (so Grow retries; fix B-1 `15d2fa6`), everything else→200.

**Mark-paid** is `public.grow_mark_paid(...)` (`.../20261019520000_grow_payments.sql:213-278`). It is SECURITY DEFINER and executable by service_role only:

```sql
SELECT * INTO p FROM public.grow_payment_processes WHERE process_id = _process_id AND sandbox = _sandbox FOR UPDATE;
IF NOT FOUND THEN RETURN jsonb_build_object('result', 'unknown'); END IF;
IF p.process_token_hash IS DISTINCT FROM _token_hash THEN RETURN jsonb_build_object('result', 'bad_token'); END IF;
IF p.status IN ('paid', 'paid_late') THEN RETURN ... 'already_paid' ...
IF _status_code IS DISTINCT FROM '2' THEN UPDATE ... SET status = 'failed' ... 'not_paid'
IF _sum IS NULL OR abs(_sum - p.amount) > 0.01 THEN ... 'amount_mismatch'
SELECT * INTO o FROM public.orders WHERE id = p.order_id FOR UPDATE;
IF o.status = 'cancelled' OR o.payment_status NOT IN ('awaiting') THEN ... 'paid_late' (order NOT reopened)
PERFORM set_config('kobi.payment_update', 'on', true);
UPDATE public.orders SET payment_status='paid', paid_at=now(), payment_due_at=NULL, grow_asmachta=..., ...
```

**How a payment is verified today:** the `processToken` hash must match, `statusCode` must be `'2'`, and the sum must be within ±0.01 of the **amount stored on the process** (not the current order total). The update is atomic and one-time.

**What is not verified:** there is no server-to-server re-check with Grow (`getTransactionInfo` / `getPaymentProcessInfo`), no callback signature, and no uniqueness on `transaction_id`. This is the open finding S-2. Details:
- `docs/audit/GROW-VERIFICATION.md` §2–5 says the Grow docs hosts were blocked by the environment's network, and no call was implemented against a guessed schema. Its recommendation is not to enable Grow for more stores until this is verified.
- `docs/audit/SECURITY-FINDINGS.md:42-54` gives the same finding.
- Also noted there: a sandbox process can mark a real order paid, and nothing visible flags it.

Grow's `approveTransaction` is "required by the docs, but the transaction clears even without it" (`grow.server.ts:3-6`). It is called only after `paid` and is not retried on `already_paid` (bug-hunter F2).

### 1.3 Payment status transitions

- **INSERT** (`orders_default_payment`): every payment field is reset first ("not from the browser"). Then:
  - staff orders and quotes → `offline` / `not_required`;
  - `'bit'` → `awaiting`, due in 24 h;
  - `'grow'` → `awaiting`, due in 2 h;
  - anything else → `offline` / `not_required`, and it raises an error if phone payment is disabled.
- **Bit:** `awaiting` → `awaiting_verification` (submit; due cleared) → `paid` on approve (this also reopens a `cancelled` order as `pending`), or `rejected` + `cancelled` on reject. A manual cancel of `awaiting_verification` becomes `rejected`; un-cancelling goes back (`orders_payment_guard`).
- **Grow:** `awaiting` → `paid` (`grow_mark_paid`). Process statuses: `pending | paid | paid_late | failed | amount_mismatch | superseded`.
- **Expiry:** `awaiting` with `payment_due_at < now()` and `status='pending'` → `status='cancelled'`, `payment_status='expired'` (§2.8).
- **Guard** (`orders_payment_guard`, latest Grow-patched; base `.../20261019360000_remove_hyp.sql:106-143`, patch `.../20261019520000_grow_payments.sql:172-186`):
  - payment columns are reset to OLD unless `current_setting('kobi.payment_update')='on'`;
  - an order in `awaiting` or `awaiting_verification` can only be `pending` or `cancelled` (it cannot move to picking).

### 1.4 Flags and switches

- **Grow:**
  - `tenant_grow_credentials.enabled` and `sandbox`, `max_payments` (1–12), `transaction_types` ⊆ {1, 6, 13, 14}. Set by the platform admin in `saveGrowSettings` (`platform-grow.functions.ts:94-192`, with an `is_platform_admin` check).
  - Read by `getGrowAvailability` (`grow-payments.functions.ts:150-159`). The checkout loads it at `checkout.tsx:236-243`.
- **Bit and phone:** the `site_settings` columns above. `site_settings_payment_methods_guard` (`.../20261019360000_remove_hyp.sql:209-234`) requires phone **or** Bit to stay enabled. Grow is not counted, so a store cannot be card-only.
- **Generic feature flags** exist (`src/platform/feature-flags/flags.server.ts:8`, `platform_feature_enabled`) but no payment code uses them.
- **Removed Hyp switches:** `platform_settings.card_clearing_live`, `site_settings.card_payments_enabled`, `hyp_terminal_number`, `hyp_max_payments`.

### 1.5 Env var names used by payment code

- `GROW_SECRETS_KEY`: the AES key source; must be ≥24 chars (`grow-crypto.server.ts:15`).
- `GROW_API_URL`: production base URL; HTTPS is required and the code throws if it is missing (`grow.server.ts:33-35`).
- `GROW_SANDBOX_URL`: test hook only (`grow.server.ts:31,156`); listed as TEST_ONLY in `tests/unit/env-forwarding.test.ts`.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `TENANT_BASE_DOMAIN`, `PUBLIC_SITE_URL`, `PLATFORM_ADMIN_HOST`: origins (`src/integrations/supabase/tenant.server.ts:223-229`).
- `NODE_ENV`: the expiry job is off when it is `test`.
- Removed Hyp code also used `HYP_API_URL` and `PLATFORM_ADMIN_HOST`.
- Deploy: `GROW_SECRETS_KEY` and `GROW_API_URL` are forwarded in `docker-compose.yml:51,53`. The key is generated once by `deploy/setup-selfhost.sh:117-127` and is never overwritten. It is age-encrypted in backups (`deploy/backup-daily.sh:228-229`).

### 1.6 `payment_test_charge`

- **Hyp era, removed:** `supabase/migrations/20261019200000_payment_test_charge.sql`. This was a **real ₪1 charge** through the Hyp page (`payment_intents.kind='test'`, `amount=1`, 10 per hour per terminal at `:94-99`). There was also a free "connection check" that sent a SIGN request only (commit `bf90e0f`).
- **Today (Grow):** `testGrowConnection` (`platform-grow.functions.ts:198-237`) creates a ₪1 process to verify credentials. Nothing is charged, and the process is not saved.

---

## 2. Checkout and order flow

### 2.1 Client

- Main checkout: `src/routes/checkout.tsx` (1752 lines).
- Components: `src/components/checkout/*` (CheckoutSummary, CouponBox, FirstOrderOfferCard, PickupNotice, CheckoutSuccess, BitPaymentPage, GrowPaymentPage).
- Payment routes: `checkout_.bit.$orderId.tsx`, `checkout_.grow.$orderId.tsx`.
- Totals on screen: `calculateVat(...)` at `checkout.tsx:460-464`. This is **display and analytics only**; `trackPurchase(..., grandTotal)` is at `:933`.
- `orderLinesFromCart` (`checkout.ts:204-211`) sends `unit_price: item.price`. The DB ignores it for non-staff.
- The payload's `payment_method` is a request only (`checkout.tsx:775-784`).

### 2.2 Who creates the order

- **Logged-in customer:** the browser calls the RPC directly via PostgREST with the user JWT (`checkout.tsx:842-848`):
  ```ts
  const { data, error } = await supabase.rpc("place_order", { _kind: kind, _items: lines,
    _vat_rate: Number(settings?.vat_rate ?? DEFAULT_VAT_RATE), _prices_include_vat: settings?.prices_include_vat ?? true,
    _details: details });
  ```
  For Bit or Grow orders, checkout skips the emails and navigates to the payment page (`:853-870`).
- **Guest:** the server function `placeGuestOrder` (`checkout.functions.ts:99-163`):
  - `requireStoreOpen` middleware;
  - in-memory limit `guest-order:${ip}` of 8 per 15 minutes;
  - `supabaseAdmin.rpc("place_guest_order")`;
  - returns `{bit, grow, orderId, ...}`; emails are skipped for Bit and Grow (`:139-149`).
- **Other INSERT paths:**
  - `reorderOrder` (`src/lib/orders.functions.ts:19`, service role, so `auth.uid()` is NULL and the payment is always offline);
  - POS `admin_create_order`;
  - staff manual orders, quotes, shared carts.
  - All of them pass through the same triggers.

### 2.3 Latest `place_order` / `place_guest_order`

The **newest full** `CREATE OR REPLACE` is in `supabase/migrations/20261019240000_offline_payments_bit.sql`:
- `place_order` at `:252-338`: `RETURNS TABLE(id, order_number, kind)`, **SECURITY INVOKER**, granted to `authenticated` and `service_role`.
- `place_guest_order` at `:341-418`: **SECURITY DEFINER**, service_role only, requires `auth.uid() IS NULL`, tenant from `current_tenant_id()`.

The effective DB body differs from that file. It was string-patched later (`pg_get_functiondef` + `replace` + `EXECUTE`, which fails loudly if the target text is not found):
- `.../20261019260000_multi_store_members.sql:216-230`: the customer email lookup is scoped to the tenant.
- `.../20261019360000_remove_hyp.sql:151-173`: `checkout_payment_request(_details)` becomes an inline `CASE`.
- `.../20261019520000_grow_payments.sql:188-205`: the `CASE` now reads `CASE WHEN _details ->> 'payment_method' = 'bit' THEN 'bit' WHEN ... = 'grow' THEN 'grow' ELSE 'offline' END`.

To see the true body, run `pg_get_functiondef` on a DB built from all migrations. The same patching technique was used on `orders_default_payment` and `orders_payment_guard`.

The core of `place_order` (`:290-331`): INSERT the order with `total=0` → INSERT items sorted by `(product_id, variant_id)` for lock ordering (gift lines dropped; deposit lines dropped for non-staff) → `apply_order_gifts` → `order_coupon_verify` (minimum order and coupon minimum; latest at `.../20261106190000_sec_p3_helpers_quote_email.sql:28-75`).

### 2.4 How the total is computed server-side

All of this happens in triggers, for non-staff callers:

- **Unit price.** `snapshot_order_item_product` (BEFORE INSERT on `order_items`; latest `.../20261019120000_shipping_digital_variants.sql:654-847`, pricing at `:805-844`):
  - quote or gift → 0;
  - deposit line → `deposit_price × deposit_units`;
  - variant with its own price → that price;
  - otherwise the tier price from `buyer_price_tier`, replaced by `active_custom_price` (personal price list) if one exists, then `LEAST(price, sale_price)` if `sale_is_active`.
  - Staff-entered prices are kept as sent.
- **Sale snapshot:** `order_items_snapshot_sale` sets `on_sale` (`.../20261019550000_coupon_rules.sql:33-59`).
- **Deposits:** `ensure_order_item_deposit` (AFTER INSERT, `...shipping_digital_variants.sql:853`) adds one deposit line per product.
- **Coupon.** `orders_apply_coupon` (latest `.../20261118110000_order_guard.sql:92-172`) snapshots the coupon fields. A logged-in customer must hold a `coupon_grants` row created by `check_coupon` through the server's `checkCoupon` (`src/lib/marketing.functions.ts:34`, 20 per 10 minutes per IP).
- **Shipping and total.** `orders_shipping_and_total` (BEFORE INSERT OR UPDATE; latest `.../20261019550000_coupon_rules.sql:224-330`) uses `shipping_methods.price`, the free-shipping threshold, the coupon discount and the manual POS discount:
  `NEW.total := v_items + NEW.shipping_price - v_discount - v_manual;`
  `recompute_order_total` (AFTER INSERT, UPDATE or DELETE on `order_items`, `...shipping_digital_variants.sql:244-255`) re-runs it with `UPDATE orders SET total = total`.
- **VAT.** `orders_vat_from_settings` (BEFORE INSERT, `.../20261115090000_vat_settings.sql:266-279`) **overrides** the client's `_vat_rate` and `_prices_include_vat` using `tenant_vat_profile`. `orders_vat_snapshot_guard` (`:282-294`) makes them immutable afterwards. The STORED generated columns `gross_amount`, `vat_amount` and `net_amount` are at `:251-258`.
- **Amount to charge:** `order_amount_due(total, prices_include_vat, vat_rate)` (`.../20261019240000_offline_payments_bit.sql:423-433`). It equals `order_gross`: `round(total,2)` [+ `round(round(total,2)*vat/100,2)` when prices exclude VAT].
- **POS fields:** `orders_pos_guard` (`.../20261019390000_staff_roles_permissions.sql`, ~line 480) nulls `manual_discount_*` and `pos_payment_method` for non-POS callers, and sets `manual_discount_amount` from the DB only.

### 2.5 Order statuses

`orders_status_check` (`.../20261018090000_delivery_couriers_labels.sql:26-28`): `pending, agent_review, picking, picked, awaiting_courier, shipped, delivered, cancelled`. TypeScript mirror: `src/lib/orders.ts:81-128`. Kind is `order` or `quote`.

### 2.6 Idempotency, rate limits and the order guard

- **Migration 200** (`.../20261118110000_order_guard.sql`):
  - `coupon_grants` (`:28-42`): one-time, 2 h, consumed atomically by `orders_apply_coupon`.
  - `orders_rate_guard`, trigger `orders_a_rate_guard` (`:175-207`): per customer per tenant, 30 orders per 10 minutes and 300 per day, serialized by an advisory lock. Guests and staff are exempt.
- **In-memory limiters** (`src/lib/rate-limit.server.ts`): per process, reset on restart, keyed by `requestIp()` (X-Real-IP).
- **There is no idempotency key on order creation.** Bug-hunter F18 (`docs/audit/interim/bug-hunter.md:240-241`): a double submit creates two orders and two stock holds.
- **Grow uniqueness:**
  - `grow_processes_one_pending_idx` allows one `pending` process per order;
  - `grow_processes_process_id_idx` is unique on `(process_id, sandbox)`;
  - `transaction_id` is not unique.

### 2.7 Stock holds

- Reserved at **order-item INSERT**: `order_items_stock_sync` (`...shipping_digital_variants.sql:997-1100`) calls `order_item_reserve(..., _strict := is_customer)` (`:945`), which decrements `stock_quantity` and records `reserved_quantity` and `reserved_from_variant`. Strict for customers: it fails when stock is insufficient.
- Released when the order changes to `cancelled`: `orders_stock_sync` (AFTER UPDATE OF status, kind; `:1103-~1150`).

### 2.8 Unpaid orders

- `src/server/services/payment-expiry.ts` runs `setInterval` every 5 minutes in every app process. It is started from `src/server.ts:49` and calls `expire_unpaid_orders()` (latest `.../20261019360000_remove_hyp.sql:179-200`):
  ```sql
  UPDATE public.orders SET status = 'cancelled', payment_status = 'expired'
   WHERE payment_status = 'awaiting' AND payment_due_at < now() AND status = 'pending'
  ```
- Effects: stock is released, and coupon uses are freed because `coupon_customer_uses` ignores cancelled orders. Grow process rows are **not** expired and stay `pending`.
- If staff cancels an awaiting Grow order by hand, its `payment_status` stays `awaiting`.
- `notify_new_order` (`.../20261017090000_god_mode_public_checkout.sql`) rings "הזמנה חדשה התקבלה" on INSERT, **even for unpaid orders**.

---

## 3. Database: payment tables, RLS, SECURITY DEFINER functions, grants

### 3.1 Tables and payment columns

- **`public.orders`**:
  - `payment_method`, `payment_status`, `payment_due_at`, `paid_at`
  - `bit_transaction_id`, `bit_receipt_url`, `payment_reported_at`, `payment_confirmed_by`
  - `grow_asmachta`, `grow_transaction_id`, `grow_card`, `grow_installments`
  - `pos_payment_method`, `order_source`, `manual_discount_*`, `discount_amount`
  - `coupon_*`, `shipping_*`, `total`, `vat_rate`, `prices_include_vat`, `vat_business_type`, `gross_amount`, `vat_amount`, `net_amount`
  - Index `orders_awaiting_payment_idx` on `(payment_due_at) WHERE payment_status='awaiting'` (`.../20261019190000_hyp_payments.sql:408-409`).
- **`public.order_items`**: `unit_price`, `quantity`, `is_deposit`, `is_gift`, `on_sale`, `reserved_quantity`, `reserved_from_variant`.
- **`public.tenant_grow_credentials`** (`.../20261019520000_grow_payments.sql:25-48`): `user_id_enc`, `page_code_enc`, `api_key_enc`, `sandbox`, `enabled`, `max_payments`, `transaction_types`, `updated_at`, `updated_by`.
- **`public.grow_payment_processes`** (`:53-80`): `tenant_id`, `order_id`, `process_id`, `process_token_hash`, `amount numeric(12,2)`, `sandbox`, `status`, `asmachta`, `transaction_id`, `paid_at`.
- **`public.coupon_grants`** (order guard).
- **`site_settings`**: `payment_phone_enabled`, `payment_bit_enabled`, `payment_bit_phone`. This table is **publicly readable**: `GRANT SELECT ... TO anon, authenticated` and policy "site settings readable by everyone" (`.../20260907120000_b2b_beverage_platform.sql:454-463`).
- There is **no store payments ledger**. Hyp's `payment_intents` was dropped; contrast `hospitality.payments`. The VAT report says there are no partial payments or refunds in stores.

### 3.2 RLS

- **`orders`** (`.../20260907120000_b2b_beverage_platform.sql:355-368`, insert policy replaced at `.../20260907130000_username_login_manual_orders_test_email.sql:109-116`):
  - `"orders select"` FOR SELECT TO authenticated `USING (public.can_view_order(customer_id, agent_id))`
  - `"orders insert by customer or staff"` FOR INSERT `WITH CHECK (customer_id = auth.uid() OR public.is_admin(auth.uid()) OR (public.is_agent(auth.uid()) AND public.is_agent_of_customer(auth.uid(), customer_id)))`
  - `"orders update by staff"` `USING/WITH CHECK (public.is_admin(auth.uid()) OR agent_id = auth.uid())`
  - `"orders delete by admin"` `USING (public.is_admin(auth.uid()))`
  - `tenant_active_for_new_orders` AS RESTRICTIVE FOR INSERT TO public `WITH CHECK (public.tenant_is_active(tenant_id) OR public.is_staff(auth.uid()))` (`.../20261013090000_platform_tenant_management.sql:58-61`)
- **`order_items`**: `"order items select"`, `"order items update by staff"` and `"order items delete by staff"` (admin or agent) are at `...b2b_beverage_platform.sql:370-390`. The insert policy is latest at `.../20260928090000_order_integrity.sql:151-157`:
  ```sql
  CREATE POLICY "order items insert" ON public.order_items
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = order_id
      AND ((o.customer_id = auth.uid() AND o.status = 'pending')
           OR public.is_admin(auth.uid()) OR o.agent_id = auth.uid())));
  ```
- **Every table with `tenant_id`** gets `tenant_isolation` AS RESTRICTIVE FOR ALL TO public, `USING/WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))`. It was created by a loop at `.../20261008090000_multi_tenant_foundation.sql:366-380`.
- **Grow tables:** RLS is enabled, there are no policies, and access is revoked from PUBLIC, anon and authenticated. The ecommerce engine guard triggers also cover `grow_payment_processes` and `orders` (`.../20261101100000_ecommerce_engine_guard.sql:89-92`).

### 3.3 Grants

- `orders`, `order_items`: `SELECT, INSERT, UPDATE, DELETE` to authenticated and `ALL` to service_role (`...b2b_beverage_platform.sql:338-341`). anon has none. There are no column-level grants.
- `tenant_grow_credentials`, `grow_payment_processes`: `REVOKE ALL FROM PUBLIC, anon, authenticated`; `GRANT ALL TO service_role`.
- Functions:

| Function | Who can execute | Security mode |
|---|---|---|
| `place_order` | authenticated, service_role | INVOKER |
| `place_guest_order` | service_role | DEFINER |
| `grow_mark_paid`, `grow_payments_active` | service_role | DEFINER |
| `bit_payments_active`, `bit_payment_info`, `bit_payment_submit` | service_role | DEFINER |
| `bit_payment_review` | authenticated, service_role (checks `is_admin`) | DEFINER |
| `expire_unpaid_orders`, `check_coupon` | service_role | DEFINER |
| `order_coupon_verify` | authenticated, service_role | DEFINER |
| `order_amount_due` | no explicit grant | IMMUTABLE SQL |

- SECURITY DEFINER trigger functions: `orders_default_payment`, `orders_payment_guard`, `orders_shipping_and_total`, `recompute_order_total`, `snapshot_order_item_product`, `order_items_snapshot_sale`, `order_items_stock_sync`, `orders_stock_sync`, `orders_apply_coupon`, `orders_rate_guard`, `orders_vat_from_settings`, `orders_pos_guard`. `orders_vat_snapshot_guard` is not DEFINER.

---

## 4. Tenant separation and per-tenant secrets

### 4.1 Per-request tenant

- **`src/server.ts:145-226`:**
  - `requestHost` reads x-forwarded-host or host;
  - `resolveTenant(host)` calls RPC `tenant_for_host` + `loadTenantById` with a 15 s cache (`tenant.server.ts:81-98`);
  - `isUnknownStoreHost` (`:261-275`) rejects unknown hosts;
  - the request then runs inside `runWithTenant(host, tenant, () => storeGate(pathname) ?? handle(...))` (AsyncLocalStorage, `tenant.server.ts:201-203`).
  - Static paths run with a null tenant, except `/_serverFn`.
  - `storeGate` (`server.ts:71-89`) returns 403 for every path on a suspended or expired store except `SUSPENDED_ALLOWED_PATHS` (`src/lib/blocked-pages.ts:30-31`) and `/_serverFn`.
- **`currentTenantId()`** fails closed (`tenant.server.ts:216-220`).
- **`tenant_for_host`** (`.../20261019110000_custom_domains.sql:101-117`) matches in this order: domain → verified custom domain → slug → default tenant.
- **`supabaseAdmin`** (`src/integrations/supabase/client.server.ts:132-148`) is a Proxy: `select/update/delete` get `.eq("tenant_id")`; `insert/upsert` are stamped and throw on a foreign `tenant_id`; RPC and storage carry an `x-tenant-id` header. `supabaseAdminUnscoped` crosses tenants; webhooks use it.
- The browser client (`src/integrations/supabase/client.ts:64`) and `requireSupabaseAuth` (`auth-middleware.ts:75-83`) send `x-tenant-id`.
- **DB `current_tenant_id()`** (latest `.../20261019260000_multi_store_members.sql:96-147`): an authenticated user gets the header tenant only if they are a member of it; with no header and a single membership, that tenant; a platform admin may override. anon and service_role get the header tenant; the fallback is the default tenant.
- **Webhooks** have no tenant context. Grow derives it from `grow_payment_processes.tenant_id`, then calls `runWithTenant(tenant.domain ?? tenant.slug, tenant, ...)` for emails.

### 4.2 How per-tenant and platform secrets are stored today (no pgcrypto or Vault anywhere)

| What | Storage | Crypto |
|---|---|---|
| Grow terminal (`userId`, `pageCode`, `apiKey`) | `tenant_grow_credentials`, service_role only | `src/lib/grow-crypto.server.ts`: AES-256-GCM, key = `sha256(GROW_SECRETS_KEY)`, format `"v1:"+base64(iv12+tag16+ct)`. **No AAD, no HKDF.** Write-only UI: `getGrowSettings` (`platform-grow.functions.ts:58-79`) never selects the `_enc` columns. Changes are audited via `recordPlatformAudit`. |
| NURIEL AI key | `ai_settings.api_key_encrypted`; a DB CHECK enforces the `v1.` format (`.../20261110100000_ai_assistant.sql:195`) | `src/platform/ai/secrets.server.ts`: AES-256-GCM, HKDF-SHA256 (salt and info), constant AAD; secret `AI_ASSISTANT_SECRET` (≥32), falling back to `SUPABASE_SERVICE_ROLE_KEY` |
| Google GSC refresh token | `seo_gsc_connections.refresh_token_encrypted` (`.../20261122100000_seo_engine.sql:118`) | Same AI helper with its own label (`src/platform/seo/gsc/api.server.ts:42-44`) |
| License keys | encrypted columns | `src/lib/license-crypto.server.ts`: HKDF from `LICENSE_KEYS_SECRET`, **AAD = `license:${tenantId}:${deliveryId}`**, plus an HMAC fingerprint |
| Hospitality HMACs | — | `src/engines/hospitality/security/secret.server.ts` (`HOSPITALITY_SECRET`, then `LOGIN_CODE_SECRET`, then the service key) |
| Store Resend key | `tenant_email_secrets.resend_api_key` (`.../20261019230000_domains_email_notifications.sql:96-120`) | **Plaintext**, service_role only; open item PRV-9 (`docs/security/remediation-2026-11.md:68`) |
| Hyp era (removed) | `tenant_payment_secrets.hyp_api_password` and `hyp_api_key` | **Plaintext**; see §5 |

**What fits a per-store MAX terminal password or API key:**
- Mirror `tenant_grow_credentials`: a dedicated tenant-keyed table, RLS enabled with no policies, access revoked from anon and authenticated, `GRANT ALL TO service_role`.
- Encrypt in the app layer, server-side only. The UI should never return values (show "configured" at most).
- Prefer the stronger license/AI pattern over the plain Grow helper: an HKDF subkey with a MAX label, **AAD binding `tenant_id` + field** so a ciphertext copied to another tenant's row will not decrypt, and a version prefix for rotation.
- Never put it in `site_settings`, which is world-readable.
- Choose deliberately between reusing `GROW_SECRETS_KEY` through an HKDF label and adding a new env var. A new variable must be forwarded in `docker-compose.yml` (enforced by `env-forwarding.test.ts`), generated by `setup-selfhost.sh`, and added to the backup secret list.

---

## 5. The removed Hyp / MAX integration

### 5.1 Timeline

`git log`:

| Commit | Date | What |
|---|---|---|
| `c137c91` | 2026-10-05 | Part 16: Hyp/MAX card payments for the platform and the stores, billing profile; migration `20261019190000` |
| `23d2f90` | 2026-10-05 | ₪1 test charge; migration `20261019200000` |
| `bf90e0f` | 2026-10-05 | Free connection check (a SIGN request only) |
| `b83bb3c` | 2026-10-05 | Part 16b: "ready but hidden until approval"; master switch `card_clearing_live=false`, POST signing with GET fallback, `Coin`, new IPN `/api/webhooks/hyp`; migration `20261019220000` |
| `8559360` | 2026-10-06 | Part 27: "Hyp stays frozen ... The full removal is left for a separate batch" |
| `9bbc37c` | 2026-10-06 | Part 28: "remove Hyp card clearing completely (clean slate)"; migration `20261019360000`, test `scripts/db-tests/remove-hyp.test.sql` |
| `651c15f`, `8a82fe0` | 2026-10-19 | Part 43: Grow replaces it (encrypted credentials, managed by the platform admin) |

### 5.2 Files that existed at `9bbc37c^` (all deleted in `9bbc37c`)

- `src/server/services/hyp.ts` (345 lines): protocol client.
- `src/server/services/payments.ts` (507 lines): orchestration, return and IPN handlers, expiry job.
- `src/lib/payments.functions.ts` (452 lines) and `src/lib/payments.ts`.
- `src/routes/payment.result.tsx`.
- `src/components/payments/PaymentSettingsPanel.tsx`, `PaymentTerminalForm.tsx`, `src/components/platform/PlatformPaymentsCard.tsx`, `src/components/billing/PlanPayDialog.tsx`.
- Wiring in `src/server.ts`, which ran **before the store lock** "so an expired store can renew":
  ```ts
  const HYP_RETURN_PATH = "/payments/hyp/return";
  const HYP_WEBHOOK_PATH = "/api/webhooks/hyp";
  if (pathname === HYP_RETURN_PATH) { ... runWithTenant(host, tenant, () => handleHypReturn(request, requestOrigin(request))) }
  if (pathname === HYP_WEBHOOK_PATH) { ... runWithTenant(host, tenant, () => handleHypWebhook(request)) }
  ```

### 5.3 Endpoints and parameters

From `git show 9bbc37c^:src/server/services/hyp.ts`.

- **Base URL:** `HYP_DEFAULT_URL = "https://pay.hyp.co.il/p/"`, overridable by `HYP_API_URL`.
- **SIGN** (`buildSignParams`): sent as `POST` x-www-form-urlencoded to the base URL, falling back to the documented `GET <base>?<query>`.
  ```ts
  params.set("action", "APISign"); params.set("What", "SIGN");
  params.set("KEY", creds.apiKey); params.set("PassP", creds.apiPassword); params.set("Masof", creds.terminal);
  params.set("Order", req.order); params.set("Info", ...); params.set("Amount", formatHypAmount(req.amount));
  params.set("UTF8", "True"); params.set("UTF8out", "True"); params.set("Sign", "True"); params.set("MoreData", "True");
  params.set("Coin", HYP_COIN[...]);   // ILS "1", USD "2", EUR "3"
  params.set("PageLang", "HEB"); params.set("tmp", "1"); params.set("Tash", String(maxPayments)); params.set("FixTash", "False");
  params.set("J5", "False"); params.set("Postpone", "False"); params.set("SendHesh", "False"); params.set("sendemail", "False");
  // optional: ClientName, ClientLName, email, cell, UserId (9-digit tax id), street, city, zip
  ```
- **SIGN response:** a query string containing `signature`. The payment page is `${base}?action=pay&${signed}` after removing `action`. CCode `901`/`902` meant wrong terminal credentials.
- **Return and IPN parameters read:** `Order` (our 32-hex intent token), `Id`, `CCode` (0 = approved), `Amount`, `Payments`, `L4digit`. Everything else is passed through verbatim, including `ACode` and `Sign`.
- **Return and IPN URLs were configured in the terminal, not sent in the request.** The code comment says: "Hyp לוקח אותן מהגדרות המסוף (דף הצלחה / דף כישלון, והודעת שרת-לשרת) — לא מהבקשה". The paths were `<store origin>/payments/hyp/return` and `<store origin>/api/webhooks/hyp`. The result page was `/payment/result?token=…&status=failed|unverified|unknown`.

### 5.4 How the return and the IPN were verified (`settleHypResult` in `payments.ts`)

1. `parseHypReturn` rejects any duplicated parameter key (case-insensitive).
2. Look up the intent by `Order`. If it is already paid, return success (idempotent).
3. If `CCode !== "0"`, call `payment_intent_fail`.
4. **Server-to-server signature check** (`verifyHypReturn`): the raw string must contain `Sign=`. It is then sent as
   `GET <base>?action=APISign&What=VERIFY&KEY=…&PassP=…&Masof=…&<all returned params minus action/what/key/passp/masof>`.
   It is accepted only if the response has `CCode === "0"`. **The credentials travelled in the URL query.**
5. `Id` and `Amount` must be present.
6. `payment_intent_complete` (`.../20261019190000_hyp_payments.sql:816-921`):
   - `FOR UPDATE`, idempotent;
   - the transaction id must match `^[0-9A-Za-z-]{1,40}$`;
   - **amount check** `abs(_amount - i.amount) > 0.01` → the intent fails. As with Grow, this compares against the **intent's** amount, not the current order total.
   - `payment_intents.hyp_transaction_id` was UNIQUE.
   - A payment that arrived after the order expired **reopened** the order (`status → 'pending'`, stock re-reserved).
7. The redirect origin was trusted only if it resolved to the same tenant.
8. The IPN had an in-memory limit of 120 per minute per IP and a body of at most 4000 chars. Responses: 200 OK PAID / OK ALREADY PAID / OK DECLINED, 400 UNVERIFIED, 404, 429.

Amounts were set in the DB only: `order_payment_intent` (`:533-607`) extended `payment_due_at` by 30 minutes per attempt, and the unpaid window was 30 minutes.

### 5.5 Where the credentials were stored

From `.../20261019190000_hyp_payments.sql`:
- **Store terminal number:** `site_settings.hyp_terminal_number` (`:173-184`) — in the public table.
- **Store API password and API key:** `tenant_payment_secrets.hyp_api_password` and `hyp_api_key` (`:187-202`), **plaintext**, with RLS `tenant_isolation`, revoked from anon and authenticated, service_role only.
- **Platform terminal (for subscriptions and add-ons):** the `platform_settings` singleton (`:64-82`), also plaintext.
- Access was through `hyp_credentials(_scope,_tenant)` (service_role, `:318-336`).
- The **store admin** could save credentials (`store_save_payment_settings`, `:256-315`). The admin saw a `key_hint` with the last 4 characters (`:249`).

### 5.6 Why it was removed

Header of `supabase/migrations/20261019360000_remove_hyp.sql:4-8`:

```
-- הסליקה (חלקים 16–16ב) מעולם לא נפתחה (card_clearing_live = false).
-- ההחלטה: להסיר הכל — פרטי המסופים השמורים (של הפלטפורמה ושל החנויות),
-- כוונות התשלום (היסטוריית החיובים של Hyp, כולל חיובי הבדיקה של ₪1), ...
```

The reason it was hidden in Part 16b (`.../20261019220000_card_clearing_hidden.sql:4-6`): "עד שחברת האשראי מאשרת את העסק, הממשק מוסתר בקוד".

So: the integration never went live (it was waiting for the card company's approval), and the owner chose a complete "clean slate" removal. **No document or commit records a technical failure of the Hyp code.** Platform billing became manual (`addon_purchase` records "due"; `platform_record_payment`). Old `credit_card` rows are kept and mapped as manually confirmed (`docs/billing/billing-history-mapping.md:95`).

### 5.7 Docs about providers and decisions

- `docs/audit/GROW-VERIFICATION.md`: what is proven vs. unknown about Grow (token exposure, `getTransactionInfo` schema, signature, retries), a 5-step plan, and "do not enable for more stores".
- `docs/audit/SECURITY-FINDINGS.md` (S-2) and `docs/audit/interim/security-auditor.md:112-129`: same finding; suggested fixes are a server-side confirm and `transactionId` uniqueness.
- `docs/audit/interim/bug-hunter.md`:
  - F1: 200 on failure (fixed, B-1);
  - F2: paid_late or crash-after-mark notifies nobody (an alert was added);
  - F18: guest order is not idempotent;
  - a note that `Number(sum)` turns "1,234.50" into NaN.
- `docs/audit/BUGS-AND-FIXES.md:14,27,48`.
- Release and deploy rules:
  - `docs/audit/PRE-MERGE-READINESS.md:31,69`, `DEPLOY-HANDOFF-2026-11-17.md:345,400`: "לא מפעילים Grow בעסקים נוספים", "לא לשלוח webhook אמיתי של Grow".
  - `RELEASE-2026-11-21.md:199`: "Grow נשאר כבוי".
- `docs/billing/vat-report.md:92`: card and Bit amounts come from `order_amount_due` (server).
- `docs/billing/billing-agreements-report.md:329`: no automatic charging at the platform level.
- `docs/hospitality/payments-channels-plan.md:29-40` and `docs/hospitality/stage-1-plan.md:385-396,1607`:
  - open decision **OD-16**: should each business have its own terminal, or should the platform collect payments as a marketplace;
  - a planned neutral `src/platform/payments/grow` adapter. It does **not exist** (`src/platform/payments` is absent).

---

## 6. Hospitality payments: completely separate

- Everything lives in schema `hospitality`. The `hospitality.payments` ledger (`supabase/migrations/20261102170000_hosp_payments.sql:15-40`) has unique `(tenant_id, provider, provider_ref)`. Related objects:
  - `bookings.payment_status`, `bookings.amount_paid` (synced by `_payments_sync`), `bookings.payment_method` (bank, bit, phone, other);
  - `payment_settings`, the payment instructions table (`.../20261105140000_hosp_payment_instructions.sql:34`);
  - `payment_proofs` with bucket `hosp-payment-proofs` (`.../20261108100000_hosp_bank_transfer.sql:80`);
  - functions `payment_record`, `payment_void`, `guest_payment_info`, `public_payment_methods`.
- **Decision D4** (`docs/hospitality/phone-payments-d4.md:3`): no online clearing.
- A ready hook exists for a future provider: `hospitality.payment_provider_record(_tenant_id, _booking_id, _kind, _amount, _provider, _provider_ref, _paid_at)`. It is service_role only and idempotent by `provider_ref` (`.../20261102170000_hosp_payments.sql:231-260`).
- Hospitality RLS policies are `tenant_isolation` and `backend_enabled`, both RESTRICTIVE, plus `staff`, created per table by loops. Hospitality billing is separate "from tenant_subscriptions / platform_plans / Grow" (`.../20261101130000_hosp_billing_admin.sql:7`). The ecommerce engine guard blocks store tables (`orders`, `grow_payment_processes`) for non-ecommerce sites.
- **Conclusion:** a store-checkout provider built on `public.orders` does not touch hospitality, unless you deliberately build a shared adapter.

---

## Risks and gaps for adding a redirect-based provider

1. **The order exists before payment.** It is created from the browser (`place_order` via PostgREST, logged-in customers) or from the server (`place_guest_order`, guests). Stock is decremented at insert. The provider must start payment for an existing order id. You need your own `payment_due_at` window in `orders_default_payment` (Bit 24 h, Grow 2 h, Hyp was 30 min and was extended per attempt).
2. **The amount is recomputed server-side.** Client `unit_price` and `_vat_rate`/`_prices_include_vat` are overridden for non-staff; use `order_amount_due` / `gross_amount`. Only analytics `trackPurchase` uses the client total. Staff orders keep staff prices but never go to online payment.
3. **(code-reading) The amount can drift after payment starts.** The `"order items insert"` policy (`.../20260928090000_order_integrity.sql:151-157`) lets a logged-in customer add lines to their own `pending` order, and an awaiting order is `pending`. No trigger checks `payment_status`. `grow_mark_paid` (like Hyp's `payment_intent_complete`) compares only against the stored process amount. So a customer can pay the old, lower amount and the bigger order gets marked paid. Staff edits have the same effect. For MAX: compare against the current `order_amount_due` at callback time and/or block item changes while `awaiting`.
4. **No idempotency key on order creation** (F18): duplicate orders and duplicate holds are possible. Grow relies on one pending process per order and a unique `(process_id, sandbox)`, but `transaction_id` is not unique. Hyp had UNIQUE `hyp_transaction_id`. Add a UNIQUE constraint on the provider transaction id.
5. **Verification model.** The removed Hyp code did server-to-server `APISign/VERIFY`, which is stronger than Grow today (Grow trusts the token; S-2 is open). Reuse the VERIFY pattern, but keep `KEY`/`PassP` out of GET URLs if the provider allows it. Confirm with the provider's docs whether success and failure URLs are per-terminal or per-request; the old code assumed per-terminal.
6. **Callback routing and tenant.**
   - If callbacks land on the store's domain, a locked (suspended or expired) store returns 403 for non-allowed paths through `storeGate`. Hyp handled this before the lock in `src/server.ts`. Grow avoids it with a fixed portal `notifyUrl`.
   - Derive the tenant from the payment row, never from the host. Use `supabaseAdminUnscoped` and then `runWithTenant` for emails.
7. **Marking paid.** Follow the existing pattern: a SECURITY DEFINER function granted to service_role only, `FOR UPDATE` on the payment row and the order, `set_config('kobi.payment_update','on',true)`.
   - Extend `orders_payment_check` and `orders_payment_guard` (column locks), add a branch to `orders_default_payment`, and patch the `CASE` in `place_order` and `place_guest_order`.
   - These were string-patched several times, so read the live definitions from a built DB; the migration files are misleading.
   - Add a rollback in `supabase/rollbacks/` following the R-3 guard rules.
8. **Test constraints you will hit** (`scripts/db-tests/remove-hyp.test.sql`):
   - `:45-49`: no `public` column may match `hyp\_%`;
   - `:50-59`: none of the old Hyp function names may come back (e.g. `order_payment_intent`, `store_payment_settings`);
   - `:60-63`: no public function body may match `(hyp_|payment_intent|tenant_payment_secrets|platform_settings|card_payments_|card_clearing|platform_payments_|checkout_payment_request|payment_token)`;
   - `:74-84`: the `orders_default_payment` trigger must stay immediately between `orders_assign_number` and `orders_enforce_kind`;
   - `:120-124`: a `credit_card` request must still map to `offline`.

   Either use non-`hyp` names and a new method value (e.g. `max`), or change the test deliberately. Also update `scripts/db-classification.mjs` (enforced by `db-classification.test.sql`), the ecommerce engine guard table list, and `docker-compose.yml` for any new env var (`env-forwarding.test.ts`).
9. **Late payments.** Hyp reopened expired orders and re-reserved stock non-strictly. Grow marks `paid_late` and alerts the admins. Pick one for MAX. Also expire provider attempt rows; Grow's stay `pending`.
10. **Emails and notifications.**
    - A new-order bell fires for unpaid orders.
    - `sendOrderEmails` (`src/lib/email.functions.ts:10-44`) does not check payment status, so a customer can trigger confirmation emails before paying.
    - Checkout correctly skips emails for Bit and Grow and leaves them to the webhook.
11. **Capability URLs.** The order UUID alone opens `/checkout/grow/<id>` and `startGrowPayment` with no ownership check. Whoever has the UUID gets a provider page pre-filled with the customer's name, phone and email. The old Hyp code required an authenticated owner (`payForOrder`) or a 32-hex retry token.
12. **Credentials.** Do not repeat the Hyp plaintext tables, and stay out of the world-readable `site_settings`. Grow's AES-GCM has no AAD and no tenant binding (§4.2). Decide who enters credentials: the platform admin only (Grow) or the store admin (Hyp era). There is a sandbox risk: sandbox processes can mark real orders paid.
13. **Other constraints:**
    - `site_settings_payment_methods_guard` forces phone or Bit to stay enabled, so card-only stores are impossible.
    - The in-memory rate limits are per process and reset on restart.
    - The expiry job runs in every process (safe, because the SQL is idempotent).
    - Stores have no payments ledger (one payment per order on `orders`), so refunds and partial captures are not modelled. `hospitality.payments` is the reference design if you need one.
