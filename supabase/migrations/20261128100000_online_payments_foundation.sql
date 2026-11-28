-- ============================================================================================================
-- מיגרציה 208 — יסודות התשלום המקוון בכרטיס (MAX / Hyp Pay, דף תשלום מאובטח) — שלב DEMO
-- Migration 208 — online card payments foundation (MAX / Hyp Pay hosted payment page), DEMO stage.
--
-- WHERE (this stage): the local test database and CI only (owner approval for D3). Never a production database.
-- BASE: docs/payment-gateways/evidence/demo/04b-proposed-ddl-demo.sql.txt (DB agent; text only, never executed),
--       with every delta of MAX-DEMO-PLAN.md §5.4 and DEMO-IMPLEMENTATION-CONTRACT.md §5:
--   1. names outside my_billing_* / platform_billing_* (billing-agreements.test.sql pins exactly 14 of those):
--      my_billing_card_payments / _options → platform_card_my_payments / _options; platform_billing_terminal_* →
--      platform_terminal_*. A function that takes _actor is never granted to authenticated (finding H1).
--   2. both settle functions take _return_flags text[] (document | hk | multi). A returned Hesh / HeshASM →
--      needs_review 'document_issued'; only the flag is kept, never the value (H2, decision ה-6).
--   3. CCode 600 / 700 / 800, HKId or MULTI → needs_review 'unexpected_hold', before the generic "failed" branch (M3).
--   4. a database that was ever DEMO never becomes production; production marks a fresh database only (M5).
--   5. a paid online order: total and lines locked for everyone, staff included, until a refund path exists (M11).
--   6. payments.unknown_returns + platform_payment_unknown_return(): a return with no attempt is recorded (L1).
--   7. platform_attempts.return_origin, validated against the store's own hosts at open (L2).
--   8. terminal hint = the last 2 digits, everywhere (L5).
--   9. the decision-14 raw-return tables are inside this one transaction (L6).
--  10. no add-on target: a platform attempt pays one open billing.ledger charge (decision ה-3).
--  11. no test users: payments.test_users, platform_payment_tester_* and test_access are gone. A DEMO database
--      holds test terminals only (00100… required); a production database live ones only (00100… refused) (ה-4, L7).
--  12. test mode: at most ₪50 per attempt, in both attempt tables (ENV-5).
--  13. NURIEL's terminal is saved only after a step-up code was consumed (platform_stepup_issue / _consume: the DB
--      keeps HMACs only; 10 minutes; at most 5 tries; single use; platform admins only) (M6).
--  14. DEMO: one payment only — max installments = 1 everywhere (M10).
--   +  the "sent to Hyp, never returned" lists: max_unreturned_attempts / platform_unreturned_attempts (M9).
--   +  ciphertext columns take the app's sealed format "v1:<kid>:<iv>:<tag>:<ct>" (base64url, contract §4).
-- Additive only: no existing row changes; Grow, Bit, billing.*, billing_history and add-on objects are untouched.
-- Patched by exact text (md5-pinned below, idempotent): orders_default_payment, place_order, place_guest_order and
-- the orders_payment_check constraint. One BEGIN … COMMIT; safe to run again.
-- Rollback: supabase/rollbacks/20261128100000_online_payments_foundation.down.sql (refuses while payment data exists).
-- ============================================================================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------------------------------------------------------
-- §0. Preconditions: fail loudly on drift. A patched object is either exactly the reviewed live text (md5 of
--     pg_get_functiondef / pg_get_constraintdef, shop_test 2026-11-27, re-checked 2026-11-28) or already patched by
--     this migration (second run). billing.guard is relied on (the provider-write gate of the ledger).
-- ------------------------------------------------------------------------------------------------------------
DO $pre$
DECLARE
  _def text;
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'online payments: PostgreSQL 15 or later is required (ON DELETE SET NULL (column))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'global_products' AND column_name = 'item_condition') THEN
    RAISE EXCEPTION 'online payments: migration 207 (20261127100000_product_brand_condition) is not applied';
  END IF;
  _def := pg_get_functiondef('public.orders_default_payment()'::regprocedure);
  IF position('max_payments_active' IN _def) = 0 AND md5(_def) <> '399a61c8498b9d8d40b937c51c06f8d6' THEN
    RAISE EXCEPTION 'online payments: orders_default_payment drifted from the reviewed text — re-derive the patch';
  END IF;
  _def := pg_get_functiondef('public.place_order(text, jsonb, numeric, boolean, jsonb)'::regprocedure);
  IF position('= ''online''' IN _def) = 0 AND md5(_def) <> '4b0f65ed766f47e4bd86b00392b2a8fd' THEN
    RAISE EXCEPTION 'online payments: place_order drifted from the reviewed text — re-derive the patch';
  END IF;
  _def := pg_get_functiondef('public.place_guest_order(text, jsonb, jsonb)'::regprocedure);
  IF position('= ''online''' IN _def) = 0 AND md5(_def) <> '2e0eff3b865bf32e5ceb0e99e50132ca' THEN
    RAISE EXCEPTION 'online payments: place_guest_order drifted from the reviewed text — re-derive the patch';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO _def FROM pg_constraint c
   WHERE c.conrelid = 'public.orders'::regclass AND c.conname = 'orders_payment_check';
  IF _def IS NULL OR (position('''online''' IN _def) = 0 AND md5(_def) <> '816c22e1520ae95e394c6a5a094faaec') THEN
    RAISE EXCEPTION 'online payments: orders_payment_check drifted from the reviewed text';
  END IF;
  IF md5(pg_get_functiondef('billing.guard()'::regprocedure)) <> '805a177948e4964354a050987c561892' THEN
    RAISE EXCEPTION 'online payments: billing.guard changed — re-check the provider write to the ledger';
  END IF;
END $pre$;

-- ------------------------------------------------------------------------------------------------------------
-- §1. The closed schema (billing / business_profile posture, stricter: not even service_role gets USAGE — every
--     read and write goes through the public SECURITY DEFINER functions below)
-- ------------------------------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS payments;
COMMENT ON SCHEMA payments IS
  'Online card payments: NURIEL''s platform terminal and the stores'' terminals, strictly separated. Closed schema — reached only through public SECURITY DEFINER functions (migration 208)';
REVOKE ALL ON SCHEMA payments FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------
-- §2. Kill switches (default OFF), one per scope; toggled by the audited platform_set_flag. The per-store switch is
--     the store terminal's own "enabled".
-- ------------------------------------------------------------------------------------------------------------
INSERT INTO public.platform_feature_flags (key, enabled, description) VALUES
  ('max_payments', false, 'MAX card payments in store checkouts (store terminals) — global switch'),
  ('platform_terminal_payments', false, 'MAX card payments to NURIEL for open charges (platform terminal) — global switch')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------
-- §3. Cross-scope: environment, terminal registry, unknown returns (no secrets, no personal data in any of them)
-- ------------------------------------------------------------------------------------------------------------
-- 3a. Environment. One row, created UNSET (name NULL = online payments off in both scopes). The database owner marks
--     a database 'demo' or 'production' (never a migration, never an API role: no USAGE, no function writes it).
--     demo_since records that the database was ever DEMO; it is never cleared, and such a database never becomes
--     production (M5). The app sends its own marker (PAYMENTS_ENV) to every start, terminal save and settle.
CREATE TABLE IF NOT EXISTS payments.environment (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  name       text CHECK (name IS NULL OR name IN ('demo', 'production')),
  demo_since timestamptz,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL DEFAULT session_user::text,
  note       text CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT environment_demo_stamped CHECK (name IS DISTINCT FROM 'demo' OR demo_since IS NOT NULL)
);
INSERT INTO payments.environment (id, name, note)
VALUES (true, NULL, 'created unset by migration 208: online payments are off until the DB owner marks this database')
ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE payments.environment IS
  'NULL: online payments off. demo: test terminals (00100…) only, verified test payments are applied (DEMO flows); never becomes production. production: live terminals only';

-- 3b. Terminal registry: a terminal number exists once, in one scope, and for a store terminal in one store.
--     Accounts and attempts reference it with composite FKs, so no code path binds one terminal to two scopes or two
--     stores. A row is permanent once the terminal took an attempt; no FK to tenants.
CREATE TABLE IF NOT EXISTS payments.terminal_registry (
  provider        text NOT NULL CHECK (provider IN ('max')),
  terminal_number text NOT NULL CHECK (terminal_number ~ '^[0-9]{10}$'),
  scope           text NOT NULL CHECK (scope IN ('platform', 'tenant')),
  tenant_id       uuid,
  registered_at   timestamptz NOT NULL DEFAULT now(),
  registered_by   uuid,
  CONSTRAINT terminal_registry_pkey PRIMARY KEY (provider, terminal_number),
  CONSTRAINT terminal_registry_owner CHECK ((scope = 'platform') = (tenant_id IS NULL)),
  CONSTRAINT terminal_registry_scope_key UNIQUE (provider, terminal_number, scope),
  CONSTRAINT terminal_registry_tenant_key UNIQUE (provider, terminal_number, scope, tenant_id)
);

-- 3c. Returns that matched no attempt (finding L1): scope, the host it arrived on, the payload hash and the time —
--     nothing else (no reference, no amount, no personal data). Counted for the misconfiguration alert.
CREATE TABLE IF NOT EXISTS payments.unknown_returns (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope          text NOT NULL CHECK (scope IN ('platform', 'tenant')),
  host           text NOT NULL CHECK (host ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:[0-9]{1,5})?$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unknown_returns_once UNIQUE (scope, payload_sha256)
);
CREATE INDEX IF NOT EXISTS unknown_returns_recent_idx ON payments.unknown_returns (scope, received_at DESC);

-- ------------------------------------------------------------------------------------------------------------
-- §4. PLATFORM SCOPE — NURIEL's own terminal. No tenant_id in these tables: the platform owns them. The paying
--     business is recorded as payer_* (no FK: kept after the business is deleted, like billing.ledger).
-- ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments.platform_accounts (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope                         text NOT NULL DEFAULT 'platform' CHECK (scope = 'platform'),
  provider                      text NOT NULL CHECK (provider IN ('max')),
  -- test: DEMO databases only, with a 00100… terminal; live: production databases only (decision ה-4)
  mode                          text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  enabled                       boolean NOT NULL DEFAULT false,
  terminal_number               text CHECK (terminal_number IS NULL OR terminal_number ~ '^[0-9]{10}$'),
  -- AES-256-GCM sealed by the app (contract §4): 'v1:<kid>:<iv>:<tag>:<ct>' (base64url). Root secret of THIS scope
  -- only (PLATFORM_TERMINAL_SECRETS_KEY); AAD binds environment, scope, mode, account and field. Never returned by any
  -- function except the secret functions, which return ciphertext only.
  api_key_enc                   text CHECK (api_key_enc IS NULL OR api_key_enc
                                  ~ '^v1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{2,4000}$'),
  api_password_enc              text CHECK (api_password_enc IS NULL OR api_password_enc
                                  ~ '^v1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{2,4000}$'),
  key_version                   smallint NOT NULL DEFAULT 1 CHECK (key_version BETWEEN 1 AND 9999),
  credentials_updated_at        timestamptz,
  credentials_updated_by        uuid,
  status                        text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'failed')),
  last_verified_at              timestamptz,
  last_verify_code              text CHECK (last_verify_code IS NULL OR last_verify_code ~ '^[0-9A-Za-z_-]{1,16}$'),
  terminal_max_installments     smallint NOT NULL DEFAULT 1 CHECK (terminal_max_installments BETWEEN 1 AND 36),
  -- what store owners are offered when they pay NURIEL (set by the platform admin; bounded by the terminal)
  max_installments              smallint NOT NULL DEFAULT 1 CHECK (max_installments BETWEEN 1 AND 36),
  min_installments_amount_minor bigint NOT NULL DEFAULT 0 CHECK (min_installments_amount_minor BETWEEN 0 AND 100000000),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by                    uuid,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid,
  CONSTRAINT platform_accounts_one_per_provider UNIQUE (provider),
  CONSTRAINT platform_accounts_terminal_fkey FOREIGN KEY (provider, terminal_number, scope)
    REFERENCES payments.terminal_registry (provider, terminal_number, scope),
  CONSTRAINT platform_accounts_live_terminal CHECK (mode <> 'live' OR terminal_number IS NULL OR terminal_number NOT LIKE '00100%'),
  CONSTRAINT platform_accounts_test_terminal CHECK (mode <> 'test' OR terminal_number IS NULL OR terminal_number LIKE '00100%'),
  CONSTRAINT platform_accounts_test_one_payment CHECK (mode <> 'test' OR (terminal_max_installments = 1 AND max_installments = 1)),
  CONSTRAINT platform_accounts_enabled_needs_creds CHECK (
    NOT enabled OR (terminal_number IS NOT NULL AND api_key_enc IS NOT NULL AND api_password_enc IS NOT NULL)),
  CONSTRAINT platform_accounts_verified_at CHECK (status <> 'verified' OR last_verified_at IS NOT NULL),
  CONSTRAINT platform_accounts_installments CHECK (max_installments <= terminal_max_installments),
  CONSTRAINT platform_accounts_creds_stamped CHECK (
    (api_key_enc IS NULL AND api_password_enc IS NULL) OR credentials_updated_at IS NOT NULL)
);

-- One attempt = one redirect to the hosted page, paying one open billing.ledger charge of the paying store
-- (kind 'charge': subscription renewal, plan change, setup, other). Add-ons, AI packages and upgrades: later (ה-3).
CREATE TABLE IF NOT EXISTS payments.platform_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope              text NOT NULL DEFAULT 'platform' CHECK (scope = 'platform'),
  payer_tenant_id    uuid NOT NULL,
  payer_label        text NOT NULL CHECK (char_length(payer_label) BETWEEN 1 AND 200),
  payer_engine       text NOT NULL CHECK (payer_engine IN ('ecommerce', 'hospitality')),
  payer_user_id      uuid NOT NULL,
  target_kind        text NOT NULL CHECK (target_kind IN ('ledger_charge')),
  target_id          uuid NOT NULL,
  ledger_charge_id   uuid NOT NULL REFERENCES billing.ledger (id),
  target_label       text NOT NULL CHECK (char_length(target_label) BETWEEN 1 AND 200),
  -- the store address the owner started from, checked against that store's own hosts at open (L2); the platform
  -- return sends the browser back there. NULL: the app falls back to the store's subdomain.
  return_origin      text CHECK (return_origin IS NULL OR (char_length(return_origin) <= 300
                       AND return_origin ~ '^(https://[a-z0-9.-]+|http://[a-z0-9.-]*localhost(:[0-9]{1,5})?)$')),
  attempt_no         smallint NOT NULL CHECK (attempt_no BETWEEN 1 AND 5),
  provider           text NOT NULL CHECK (provider IN ('max')),
  mode               text NOT NULL CHECK (mode IN ('test', 'live')),
  terminal_number    text NOT NULL CHECK (terminal_number ~ '^[0-9]{10}$'),
  key_version        smallint NOT NULL CHECK (key_version BETWEEN 1 AND 9999),
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 100000000),
  currency           text NOT NULL DEFAULT 'ILS' CHECK (currency IN ('ILS')),
  max_installments   smallint NOT NULL DEFAULT 1 CHECK (max_installments BETWEEN 1 AND 36),
  reference          text NOT NULL CHECK (reference ~ '^[0-9a-f]{32}$'),
  state              text NOT NULL DEFAULT 'created'
                     CHECK (state IN ('created', 'redirected', 'returned', 'paid', 'test_paid', 'failed', 'expired',
                                      'cancelled', 'needs_review')),
  -- true when the payment was applied to its charge (the provider row in billing.ledger was written)
  applied            boolean NOT NULL DEFAULT false,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  signed_at          timestamptz,
  returned_at        timestamptz,
  verified_at        timestamptz,
  paid_at            timestamptz,
  verify_lease_until timestamptz,
  verify_attempts    smallint NOT NULL DEFAULT 0 CHECK (verify_attempts BETWEEN 0 AND 20),
  provider_txn_id    text CHECK (provider_txn_id IS NULL OR provider_txn_id ~ '^[0-9A-Za-z-]{1,40}$'),
  approval_code      text CHECK (approval_code IS NULL OR approval_code ~ '^[0-9A-Za-z]{1,16}$'),
  installments       smallint CHECK (installments IS NULL OR installments BETWEEN 1 AND 36),
  card_brand         text CHECK (card_brand IS NULL OR card_brand ~ '^[a-z_]{2,20}$'),
  card_last4         text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  failure_code       text CHECK (failure_code IS NULL OR failure_code ~ '^[0-9A-Za-z_-]{1,16}$'),
  -- presence flags of the verified return: document (Hesh / HeshASM non-empty and not 0), hk (HKId), multi (MULTI).
  -- The values themselves are never stored.
  return_flags       text[] NOT NULL DEFAULT '{}'::text[]
                     CHECK (return_flags <@ ARRAY['document', 'hk', 'multi']::text[]),
  verification       jsonb NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(verification) = 'object'
                            AND (verification - ARRAY['ccode', 'verify_ccode', 'txn_id', 'amount_minor', 'currency',
                                                      'installments', 'approval_code', 'flags']::text[]) = '{}'::jsonb
                            AND octet_length(verification::text) <= 1024),
  review_reason      text CHECK (review_reason IS NULL OR review_reason IN (
                       'amount_mismatch', 'currency_mismatch', 'terminal_mismatch', 'installments_exceeded',
                       'duplicate_txn', 'duplicate_charge', 'late', 'target_settled', 'target_changed', 'payer_gone',
                       'verify_exhausted', 'credentials_changed', 'mode_not_allowed', 'document_issued',
                       'unexpected_hold')),
  review_note        text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  review_resolved_at timestamptz,
  review_resolved_by uuid,
  ledger_payment_id  uuid UNIQUE REFERENCES billing.ledger (id),
  CONSTRAINT platform_attempts_reference_key UNIQUE (reference),
  CONSTRAINT platform_attempts_target_no_key UNIQUE (target_kind, target_id, attempt_no),
  CONSTRAINT platform_attempts_terminal_fkey FOREIGN KEY (provider, terminal_number, scope)
    REFERENCES payments.terminal_registry (provider, terminal_number, scope),
  CONSTRAINT platform_attempts_target_shape CHECK (target_id = ledger_charge_id),
  CONSTRAINT platform_attempts_expiry CHECK (expires_at > created_at),
  -- a test attempt can never be 'paid'; a live one can never be 'test_paid'
  CONSTRAINT platform_attempts_paid_is_live CHECK (state <> 'paid' OR mode = 'live'),
  CONSTRAINT platform_attempts_test_paid_is_test CHECK (state <> 'test_paid' OR mode = 'test'),
  CONSTRAINT platform_attempts_settled_fields CHECK (
    state NOT IN ('paid', 'test_paid') OR (provider_txn_id IS NOT NULL AND paid_at IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT platform_attempts_live_applied CHECK (state <> 'paid' OR applied),
  CONSTRAINT platform_attempts_applied_state CHECK (NOT applied OR state IN ('paid', 'test_paid')),
  CONSTRAINT platform_attempts_ledger_link CHECK (ledger_payment_id IS NULL OR applied),
  CONSTRAINT platform_attempts_review_fields CHECK (state <> 'needs_review' OR review_reason IS NOT NULL),
  CONSTRAINT platform_attempts_resolved_pair CHECK ((review_resolved_at IS NULL) = (review_resolved_by IS NULL)),
  -- test mode: at most ₪50, one payment (ENV-5, M10)
  CONSTRAINT platform_attempts_test_cap CHECK (mode <> 'test' OR amount_minor <= 5000),
  CONSTRAINT platform_attempts_test_one_payment CHECK (mode <> 'test' OR max_installments = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_attempts_one_active_idx
  ON payments.platform_attempts (target_kind, target_id) WHERE state IN ('created', 'redirected', 'returned');
CREATE UNIQUE INDEX IF NOT EXISTS platform_attempts_one_applied_idx
  ON payments.platform_attempts (target_kind, target_id) WHERE applied;
CREATE UNIQUE INDEX IF NOT EXISTS platform_attempts_provider_txn_idx
  ON payments.platform_attempts (provider, terminal_number, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_attempts_expiry_idx
  ON payments.platform_attempts (expires_at) WHERE state IN ('created', 'redirected', 'returned');
CREATE INDEX IF NOT EXISTS platform_attempts_payer_idx ON payments.platform_attempts (payer_tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_attempts_review_idx ON payments.platform_attempts (created_at DESC)
  WHERE state = 'needs_review' OR (review_reason IS NOT NULL AND review_resolved_at IS NULL);
CREATE INDEX IF NOT EXISTS platform_attempts_unreturned_idx ON payments.platform_attempts (signed_at DESC)
  WHERE signed_at IS NOT NULL AND returned_at IS NULL;

CREATE TABLE IF NOT EXISTS payments.platform_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id     uuid NOT NULL REFERENCES payments.platform_attempts (id),
  source         text NOT NULL CHECK (source IN ('open', 'sign', 'return', 'notify', 'verify', 'expire', 'cancel',
                                                 'review')),
  payload_sha256 text CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'),
  verification   text NOT NULL DEFAULT 'not_applicable'
                 CHECK (verification IN ('not_applicable', 'pending', 'verified', 'rejected', 'error')),
  result         text NOT NULL CHECK (result ~ '^[a-z0-9_]{2,40}$'),
  summary        jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(summary) = 'object'
                        AND (summary - ARRAY['ccode', 'verify_ccode', 'txn_id', 'amount_minor', 'currency',
                                             'installments', 'approval_code', 'flags']::text[]) = '{}'::jsonb
                        AND octet_length(summary::text) <= 1024),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_events_payload_rule CHECK ((source IN ('return', 'notify', 'verify')) = (payload_sha256 IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_events_replay_idx
  ON payments.platform_events (attempt_id, source, payload_sha256)
  WHERE payload_sha256 IS NOT NULL AND source IN ('return', 'notify');
CREATE INDEX IF NOT EXISTS platform_events_attempt_idx ON payments.platform_events (attempt_id, created_at);

-- Config audit, written in the same transaction as the change. Field NAMES only — there is no value column.
CREATE TABLE IF NOT EXISTS payments.platform_config_audit (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider       text CHECK (provider IS NULL OR provider IN ('max')),
  actor_id       uuid,
  actor_role     text NOT NULL CHECK (actor_role IN ('platform_admin', 'system')),
  action         text NOT NULL CHECK (action IN ('account_created', 'credentials_replaced', 'credentials_cleared',
                   'terminal_changed', 'mode_changed', 'enabled', 'disabled', 'verified', 'verify_failed',
                   'capabilities_changed', 'environment_changed', 'review_resolved')),
  changed_fields text[] NOT NULL DEFAULT '{}'::text[]
                 CHECK (changed_fields <@ ARRAY['mode', 'terminal_number', 'api_key', 'api_password', 'key_version',
                   'enabled', 'status', 'terminal_max_installments', 'max_installments',
                   'min_installments_amount_minor', 'environment', 'review']::text[]),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_config_audit_actor CHECK ((actor_role = 'system') = (actor_id IS NULL))
);
CREATE INDEX IF NOT EXISTS platform_config_audit_created_idx ON payments.platform_config_audit (created_at DESC);

-- Step-up for editing NURIEL's terminal (M6): an action-bound one-time code sent by email. The DB keeps only what the
-- app derived from it — the HMAC of the code and the hash of the purpose (actor + action + payload) — never the code.
CREATE TABLE IF NOT EXISTS payments.platform_stepup_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL,
  purpose_hash  text NOT NULL CHECK (purpose_hash ~ '^[A-Za-z0-9_-]{32,128}$'),
  code_hmac     text NOT NULL CHECK (code_hmac ~ '^[A-Za-z0-9_-]{32,128}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  tries         smallint NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5),
  consumed_at   timestamptz,
  -- the terminal save that used this proof (a consumed code authorizes exactly one save)
  spent_at      timestamptz,
  superseded_at timestamptz,
  CONSTRAINT platform_stepup_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CONSTRAINT platform_stepup_spent CHECK (spent_at IS NULL OR consumed_at IS NOT NULL),
  CONSTRAINT platform_stepup_one_end CHECK (consumed_at IS NULL OR superseded_at IS NULL)
);
CREATE INDEX IF NOT EXISTS platform_stepup_actor_idx ON payments.platform_stepup_challenges (actor_id, created_at DESC);

-- ------------------------------------------------------------------------------------------------------------
-- §5. TENANT SCOPE — one terminal per store, for that store's end customers. tenant_id on every row.
-- ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments.tenant_accounts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope                     text NOT NULL DEFAULT 'tenant' CHECK (scope = 'tenant'),
  -- the credentials go with the store (CASCADE inside platform_delete_tenant's final DELETE FROM tenants);
  -- attempts, events and audit have no FK to tenants and stay (decision 15)
  tenant_id                 uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  provider                  text NOT NULL CHECK (provider IN ('max')),
  mode                      text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  enabled                   boolean NOT NULL DEFAULT false,
  terminal_number           text CHECK (terminal_number IS NULL OR terminal_number ~ '^[0-9]{10}$'),
  -- root secret PAYMENTS_SECRETS_KEY (store terminals only); AAD binds environment, 'tenant', tenant, mode, account
  -- and field (a ciphertext copied to another store, field or scope fails to decrypt)
  api_key_enc               text CHECK (api_key_enc IS NULL OR api_key_enc
                              ~ '^v1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{2,4000}$'),
  api_password_enc          text CHECK (api_password_enc IS NULL OR api_password_enc
                              ~ '^v1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{2,4000}$'),
  key_version               smallint NOT NULL DEFAULT 1 CHECK (key_version BETWEEN 1 AND 9999),
  credentials_updated_at    timestamptz,
  credentials_updated_by    uuid,
  status                    text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'failed')),
  last_verified_at          timestamptz,
  last_verify_code          text CHECK (last_verify_code IS NULL OR last_verify_code ~ '^[0-9A-Za-z_-]{1,16}$'),
  terminal_max_installments smallint NOT NULL DEFAULT 1 CHECK (terminal_max_installments BETWEEN 1 AND 36),
  verified_methods          text[] NOT NULL DEFAULT ARRAY['card']::text[]
                            CHECK (cardinality(verified_methods) >= 1
                                   AND verified_methods <@ ARRAY['card', 'bit', 'apple_pay', 'google_pay']::text[]),
  verified_brands           text[] NOT NULL DEFAULT '{}'::text[]
                            CHECK (verified_brands <@ ARRAY['visa', 'mastercard', 'isracard', 'amex', 'diners']::text[]),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid,
  CONSTRAINT tenant_accounts_one_per_store UNIQUE (tenant_id, provider),
  CONSTRAINT tenant_accounts_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT tenant_accounts_terminal_fkey FOREIGN KEY (provider, terminal_number, scope, tenant_id)
    REFERENCES payments.terminal_registry (provider, terminal_number, scope, tenant_id),
  CONSTRAINT tenant_accounts_live_terminal CHECK (mode <> 'live' OR terminal_number IS NULL OR terminal_number NOT LIKE '00100%'),
  CONSTRAINT tenant_accounts_test_terminal CHECK (mode <> 'test' OR terminal_number IS NULL OR terminal_number LIKE '00100%'),
  CONSTRAINT tenant_accounts_test_one_payment CHECK (mode <> 'test' OR terminal_max_installments = 1),
  CONSTRAINT tenant_accounts_enabled_needs_creds CHECK (
    NOT enabled OR (terminal_number IS NOT NULL AND api_key_enc IS NOT NULL AND api_password_enc IS NOT NULL)),
  CONSTRAINT tenant_accounts_verified_at CHECK (status <> 'verified' OR last_verified_at IS NOT NULL),
  CONSTRAINT tenant_accounts_creds_stamped CHECK (
    (api_key_enc IS NULL AND api_password_enc IS NULL) OR credentials_updated_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS payments.tenant_store_settings (
  tenant_id                     uuid NOT NULL,
  provider                      text NOT NULL CHECK (provider IN ('max')),
  max_installments              smallint NOT NULL DEFAULT 1 CHECK (max_installments BETWEEN 1 AND 36),
  min_installments_amount_minor bigint NOT NULL DEFAULT 0 CHECK (min_installments_amount_minor BETWEEN 0 AND 100000000),
  allowed_methods               text[] NOT NULL DEFAULT ARRAY['card']::text[]
                                CHECK (cardinality(allowed_methods) >= 1
                                       AND allowed_methods <@ ARRAY['card', 'bit', 'apple_pay', 'google_pay']::text[]),
  allowed_brands                text[] NOT NULL DEFAULT '{}'::text[]
                                CHECK (allowed_brands <@ ARRAY['visa', 'mastercard', 'isracard', 'amex', 'diners']::text[]),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid,
  PRIMARY KEY (tenant_id, provider),
  FOREIGN KEY (tenant_id, provider) REFERENCES payments.tenant_accounts (tenant_id, provider) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments.tenant_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope              text NOT NULL DEFAULT 'tenant' CHECK (scope = 'tenant'),
  -- no FK to tenants: payment records outlive the store (decision 15); the labels are snapshots
  tenant_id          uuid NOT NULL,
  store_label        text NOT NULL CHECK (char_length(store_label) BETWEEN 1 AND 200),
  -- NULL only after platform_delete_tenant removed the store's orders (ON DELETE SET NULL (order_id) below). A store
  -- admin cannot delete an order that has attempts (orders_online_payment_keep, §8): cancel it instead.
  order_id           uuid,
  order_number       text NOT NULL CHECK (char_length(order_number) BETWEEN 1 AND 40),
  attempt_no         smallint NOT NULL CHECK (attempt_no BETWEEN 1 AND 5),
  provider           text NOT NULL CHECK (provider IN ('max')),
  mode               text NOT NULL CHECK (mode IN ('test', 'live')),
  terminal_number    text NOT NULL CHECK (terminal_number ~ '^[0-9]{10}$'),
  key_version        smallint NOT NULL CHECK (key_version BETWEEN 1 AND 9999),
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 100000000),
  currency           text NOT NULL DEFAULT 'ILS' CHECK (currency IN ('ILS')),
  max_installments   smallint NOT NULL DEFAULT 1 CHECK (max_installments BETWEEN 1 AND 36),
  reference          text NOT NULL CHECK (reference ~ '^[0-9a-f]{32}$'),
  customer_id        uuid,
  state              text NOT NULL DEFAULT 'created'
                     CHECK (state IN ('created', 'redirected', 'returned', 'paid', 'test_paid', 'failed', 'expired',
                                      'cancelled', 'needs_review')),
  -- true when the payment marked the order paid
  applied            boolean NOT NULL DEFAULT false,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  signed_at          timestamptz,
  returned_at        timestamptz,
  verified_at        timestamptz,
  paid_at            timestamptz,
  verify_lease_until timestamptz,
  verify_attempts    smallint NOT NULL DEFAULT 0 CHECK (verify_attempts BETWEEN 0 AND 20),
  provider_txn_id    text CHECK (provider_txn_id IS NULL OR provider_txn_id ~ '^[0-9A-Za-z-]{1,40}$'),
  approval_code      text CHECK (approval_code IS NULL OR approval_code ~ '^[0-9A-Za-z]{1,16}$'),
  installments       smallint CHECK (installments IS NULL OR installments BETWEEN 1 AND 36),
  card_brand         text CHECK (card_brand IS NULL OR card_brand ~ '^[a-z_]{2,20}$'),
  card_last4         text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  failure_code       text CHECK (failure_code IS NULL OR failure_code ~ '^[0-9A-Za-z_-]{1,16}$'),
  return_flags       text[] NOT NULL DEFAULT '{}'::text[]
                     CHECK (return_flags <@ ARRAY['document', 'hk', 'multi']::text[]),
  verification       jsonb NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(verification) = 'object'
                            AND (verification - ARRAY['ccode', 'verify_ccode', 'txn_id', 'amount_minor', 'currency',
                                                      'installments', 'approval_code', 'flags']::text[]) = '{}'::jsonb
                            AND octet_length(verification::text) <= 1024),
  review_reason      text CHECK (review_reason IS NULL OR review_reason IN (
                       'amount_mismatch', 'currency_mismatch', 'terminal_mismatch', 'installments_exceeded',
                       'duplicate_txn', 'duplicate_charge', 'order_not_awaiting', 'late', 'verify_exhausted',
                       'credentials_changed', 'mode_not_allowed', 'document_issued', 'unexpected_hold')),
  review_note        text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  review_resolved_at timestamptz,
  review_resolved_by uuid,
  CONSTRAINT tenant_attempts_reference_key UNIQUE (reference),
  CONSTRAINT tenant_attempts_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT tenant_attempts_order_no_key UNIQUE (order_id, attempt_no),
  -- PostgreSQL 15+: SET NULL on one column of a composite FK (tenant_id stays)
  CONSTRAINT tenant_attempts_order_fkey FOREIGN KEY (tenant_id, order_id)
    REFERENCES public.orders (tenant_id, id) ON DELETE SET NULL (order_id),
  CONSTRAINT tenant_attempts_terminal_fkey FOREIGN KEY (provider, terminal_number, scope, tenant_id)
    REFERENCES payments.terminal_registry (provider, terminal_number, scope, tenant_id),
  CONSTRAINT tenant_attempts_expiry CHECK (expires_at > created_at),
  CONSTRAINT tenant_attempts_paid_is_live CHECK (state <> 'paid' OR mode = 'live'),
  CONSTRAINT tenant_attempts_test_paid_is_test CHECK (state <> 'test_paid' OR mode = 'test'),
  CONSTRAINT tenant_attempts_settled_fields CHECK (
    state NOT IN ('paid', 'test_paid') OR (provider_txn_id IS NOT NULL AND paid_at IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT tenant_attempts_live_applied CHECK (state <> 'paid' OR applied),
  CONSTRAINT tenant_attempts_applied_state CHECK (NOT applied OR state IN ('paid', 'test_paid')),
  CONSTRAINT tenant_attempts_review_fields CHECK (state <> 'needs_review' OR review_reason IS NOT NULL),
  CONSTRAINT tenant_attempts_resolved_pair CHECK ((review_resolved_at IS NULL) = (review_resolved_by IS NULL)),
  CONSTRAINT tenant_attempts_test_cap CHECK (mode <> 'test' OR amount_minor <= 5000),
  CONSTRAINT tenant_attempts_test_one_payment CHECK (mode <> 'test' OR max_installments = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_attempts_one_active_idx
  ON payments.tenant_attempts (order_id) WHERE state IN ('created', 'redirected', 'returned');
CREATE UNIQUE INDEX IF NOT EXISTS tenant_attempts_one_applied_idx
  ON payments.tenant_attempts (order_id) WHERE applied;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_attempts_provider_txn_idx
  ON payments.tenant_attempts (provider, terminal_number, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tenant_attempts_expiry_idx
  ON payments.tenant_attempts (expires_at) WHERE state IN ('created', 'redirected', 'returned');
CREATE INDEX IF NOT EXISTS tenant_attempts_tenant_idx ON payments.tenant_attempts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_attempts_order_idx ON payments.tenant_attempts (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS tenant_attempts_review_idx ON payments.tenant_attempts (tenant_id, created_at DESC)
  WHERE state = 'needs_review' OR (review_reason IS NOT NULL AND review_resolved_at IS NULL);
CREATE INDEX IF NOT EXISTS tenant_attempts_unreturned_idx ON payments.tenant_attempts (tenant_id, signed_at DESC)
  WHERE signed_at IS NOT NULL AND returned_at IS NULL;

CREATE TABLE IF NOT EXISTS payments.tenant_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  attempt_id     uuid NOT NULL,
  source         text NOT NULL CHECK (source IN ('open', 'sign', 'return', 'notify', 'verify', 'expire', 'cancel',
                                                 'review', 'wrong_host')),
  payload_sha256 text CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'),
  verification   text NOT NULL DEFAULT 'not_applicable'
                 CHECK (verification IN ('not_applicable', 'pending', 'verified', 'rejected', 'error')),
  result         text NOT NULL CHECK (result ~ '^[a-z0-9_]{2,40}$'),
  summary        jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(summary) = 'object'
                        AND (summary - ARRAY['ccode', 'verify_ccode', 'txn_id', 'amount_minor', 'currency',
                                             'installments', 'approval_code', 'flags']::text[]) = '{}'::jsonb
                        AND octet_length(summary::text) <= 1024),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_events_attempt_fkey FOREIGN KEY (tenant_id, attempt_id)
    REFERENCES payments.tenant_attempts (tenant_id, id),
  CONSTRAINT tenant_events_payload_rule CHECK ((source IN ('return', 'notify', 'verify')) = (payload_sha256 IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_events_replay_idx
  ON payments.tenant_events (attempt_id, source, payload_sha256)
  WHERE payload_sha256 IS NOT NULL AND source IN ('return', 'notify');
CREATE INDEX IF NOT EXISTS tenant_events_attempt_idx ON payments.tenant_events (attempt_id, created_at);
CREATE INDEX IF NOT EXISTS tenant_events_tenant_idx ON payments.tenant_events (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payments.tenant_config_audit (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  provider       text NOT NULL CHECK (provider IN ('max')),
  actor_id       uuid,
  actor_role     text NOT NULL CHECK (actor_role IN ('platform_admin', 'store_owner', 'system')),
  action         text NOT NULL CHECK (action IN ('account_created', 'credentials_replaced', 'credentials_cleared',
                   'terminal_changed', 'mode_changed', 'enabled', 'disabled', 'verified', 'verify_failed',
                   'capabilities_changed', 'store_settings_changed', 'store_settings_clamped', 'review_resolved')),
  changed_fields text[] NOT NULL DEFAULT '{}'::text[]
                 CHECK (changed_fields <@ ARRAY['mode', 'terminal_number', 'api_key', 'api_password', 'key_version',
                   'enabled', 'status', 'terminal_max_installments', 'verified_methods', 'verified_brands',
                   'max_installments', 'min_installments_amount_minor', 'allowed_methods', 'allowed_brands',
                   'review']::text[]),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_config_audit_actor CHECK ((actor_role = 'system') = (actor_id IS NULL))
);
CREATE INDEX IF NOT EXISTS tenant_config_audit_tenant_idx ON payments.tenant_config_audit (tenant_id, created_at DESC);

-- Guest capability (decision 11): sha256 of a one-time token the server issues right after place_guest_order.
-- The order UUID alone never opens the payment page. Ephemeral: removed with the order.
CREATE TABLE IF NOT EXISTS payments.tenant_order_access (
  tenant_id    uuid NOT NULL,
  order_id     uuid PRIMARY KEY,
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  CONSTRAINT tenant_order_access_order_fkey FOREIGN KEY (tenant_id, order_id)
    REFERENCES public.orders (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT tenant_order_access_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '48 hours')
);

-- ------------------------------------------------------------------------------------------------------------
-- §5b. Decision 14 — the encrypted raw return, kept briefly so the server can repeat VERIFY after a transient
--      failure (Hyp Pay documents no server-to-server notification). In this same transaction (finding L6).
-- ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments.tenant_returns (
  tenant_id      uuid NOT NULL,
  attempt_id     uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  -- the raw query exactly as received (VERIFY needs every parameter in its original order), sealed by the app with
  -- the store scope's key. With MoreData it carries card expiry, BIN and last 4 digits: hence the 2-hour ceiling.
  return_enc     text NOT NULL
                 CHECK (return_enc ~ '^v1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{2,20000}$'),
  received_at    timestamptz NOT NULL DEFAULT now(),
  purge_after    timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  PRIMARY KEY (attempt_id, payload_sha256),
  CONSTRAINT tenant_returns_attempt_fkey FOREIGN KEY (tenant_id, attempt_id)
    REFERENCES payments.tenant_attempts (tenant_id, id),
  CONSTRAINT tenant_returns_ceiling CHECK (purge_after <= received_at + interval '2 hours')
);
CREATE INDEX IF NOT EXISTS tenant_returns_purge_idx ON payments.tenant_returns (purge_after);

CREATE TABLE IF NOT EXISTS payments.platform_returns (
  attempt_id     uuid NOT NULL REFERENCES payments.platform_attempts (id),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  return_enc     text NOT NULL
                 CHECK (return_enc ~ '^v1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{8,64}:[A-Za-z0-9_-]{2,20000}$'),
  received_at    timestamptz NOT NULL DEFAULT now(),
  purge_after    timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  PRIMARY KEY (attempt_id, payload_sha256),
  CONSTRAINT platform_returns_ceiling CHECK (purge_after <= received_at + interval '2 hours')
);
CREATE INDEX IF NOT EXISTS platform_returns_purge_idx ON payments.platform_returns (purge_after);

-- ------------------------------------------------------------------------------------------------------------
-- §6. RLS and grants. No API role (anon, authenticated, service_role) gets any privilege on any table or sequence of
--     the schema, and no USAGE (§1). RLS is a second layer: RESTRICTIVE tenant_isolation on tenant tables (as
--     everywhere else) and RESTRICTIVE deny-all on the platform and cross-scope tables.
-- ------------------------------------------------------------------------------------------------------------
DO $rls$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['tenant_accounts', 'tenant_store_settings', 'tenant_attempts', 'tenant_events',
                            'tenant_config_audit', 'tenant_order_access', 'tenant_returns'] LOOP
    EXECUTE format('ALTER TABLE payments.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON payments.%I', _t);
    EXECUTE format('CREATE POLICY tenant_isolation ON payments.%I AS RESTRICTIVE FOR ALL TO public '
                   'USING (tenant_id = (SELECT public.current_tenant_id())) '
                   'WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))', _t);
    EXECUTE format('REVOKE ALL ON payments.%I FROM PUBLIC, anon, authenticated, service_role', _t);
  END LOOP;
  FOREACH _t IN ARRAY ARRAY['environment', 'terminal_registry', 'unknown_returns', 'platform_accounts',
                            'platform_attempts', 'platform_events', 'platform_config_audit',
                            'platform_stepup_challenges', 'platform_returns'] LOOP
    EXECUTE format('ALTER TABLE payments.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('DROP POLICY IF EXISTS platform_only ON payments.%I', _t);
    EXECUTE format('CREATE POLICY platform_only ON payments.%I AS RESTRICTIVE FOR ALL TO public '
                   'USING (false) WITH CHECK (false)', _t);
    EXECUTE format('REVOKE ALL ON payments.%I FROM PUBLIC, anon, authenticated, service_role', _t);
  END LOOP;
  FOR _t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'payments'::regnamespace AND c.relkind = 'S' LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE payments.%I FROM PUBLIC, anon, authenticated, service_role', _t);
  END LOOP;
END $rls$;

-- ------------------------------------------------------------------------------------------------------------
-- §7. Internal helpers (schema payments; no role but the owner can execute them, §13). SQL bodies are validated at
--     creation, so they come in dependency order.
-- ------------------------------------------------------------------------------------------------------------
-- NULL while the database is unmarked: every caller treats NULL as "off" (NULL-safe comparisons throughout)
CREATE OR REPLACE FUNCTION payments.env()
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (SELECT e.name FROM payments.environment e WHERE e.id);
$$;

-- the application's marker (PAYMENTS_ENV) must equal the database marker; an unmarked database matches nothing
CREATE OR REPLACE FUNCTION payments.app_env_ok(_app_environment text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(_app_environment IN ('demo', 'production') AND _app_environment = payments.env(), false);
$$;

CREATE OR REPLACE FUNCTION payments.flag(_key text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = _key), false);
$$;

-- Decision ה-4: a test terminal works only in a DEMO database, a live one only in a production database. There is no
-- test mode in production and no allow-list of test users.
CREATE OR REPLACE FUNCTION payments.mode_allowed(_mode text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(CASE _mode WHEN 'test' THEN payments.env() = 'demo'
                             WHEN 'live' THEN payments.env() = 'production' END, false);
$$;

-- The store owner = the protected, unblocked admin of that store (store_staff_role 'owner' without its platform-admin
-- branch). Explicit store: never current_tenant_id(), which falls back to the default store.
CREATE OR REPLACE FUNCTION payments.store_owner(_actor uuid, _tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT _actor IS NOT NULL AND _tenant IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.tenant_id = _tenant AND ur.user_id = _actor AND ur.role = 'admin' AND ur.is_protected
       AND NOT ur.is_blocked);
$$;

CREATE OR REPLACE FUNCTION payments.actor_role(_actor uuid, _tenant uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _actor IS NULL OR _tenant IS NULL THEN NULL
    WHEN public.is_platform_admin(_actor) THEN 'platform_admin'
    WHEN payments.store_owner(_actor, _tenant) THEN 'store_owner'
  END;
$$;

-- A terminal number is not a secret (it is in the payer's address bar), but records and screens show only its last
-- two digits (finding L5)
CREATE OR REPLACE FUNCTION payments.terminal_hint(_terminal text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN _terminal IS NOT NULL THEN '********' || right(_terminal, 2) END;
$$;

-- The return flags the app parsed (contract ReturnFlag): sorted and distinct; NULL = an unknown flag (malformed call)
CREATE OR REPLACE FUNCTION payments.clean_flags(_flags text[])
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _flags IS NULL THEN '{}'::text[]
    WHEN EXISTS (SELECT 1 FROM unnest(_flags) f WHERE f IS NULL OR f NOT IN ('document', 'hk', 'multi')) THEN NULL
    ELSE ARRAY(SELECT DISTINCT f FROM unnest(_flags) f ORDER BY f) END;
$$;

-- Values are rebuilt from validated scalars: nothing free-form from the app reaches an event or an attempt.
CREATE OR REPLACE FUNCTION payments.event_summary(_ccode text, _verify_ccode text, _txn_id text,
  _amount_minor bigint, _currency text, _installments integer, _approval_code text, _flags text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'ccode',         CASE WHEN _ccode ~ '^[0-9]{1,4}$' THEN _ccode END,
    'verify_ccode',  CASE WHEN _verify_ccode ~ '^[0-9]{1,4}$' THEN _verify_ccode END,
    'txn_id',        CASE WHEN _txn_id ~ '^[0-9A-Za-z-]{1,40}$' THEN _txn_id END,
    'amount_minor',  CASE WHEN _amount_minor BETWEEN 0 AND 100000000 THEN _amount_minor END,
    'currency',      CASE WHEN _currency IN ('ILS', 'USD', 'EUR', 'GBP') THEN _currency END,
    'installments',  CASE WHEN _installments BETWEEN 1 AND 99 THEN _installments END,
    'approval_code', CASE WHEN _approval_code ~ '^[0-9A-Za-z]{1,16}$' THEN _approval_code END,
    'flags',         CASE WHEN cardinality(_flags) > 0
                            AND _flags <@ ARRAY['document', 'hk', 'multi']::text[] THEN to_jsonb(_flags) END));
$$;

-- Binds a terminal number to one scope (and one store). A number already bound elsewhere raises.
CREATE OR REPLACE FUNCTION payments.register_terminal(_scope text, _tenant uuid, _provider text, _terminal text,
  _actor uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  r payments.terminal_registry;
BEGIN
  IF _terminal IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO payments.terminal_registry (provider, terminal_number, scope, tenant_id, registered_by)
  VALUES (_provider, _terminal, _scope, CASE WHEN _scope = 'tenant' THEN _tenant END, _actor)
  ON CONFLICT (provider, terminal_number) DO NOTHING;
  SELECT * INTO r FROM payments.terminal_registry x WHERE x.provider = _provider AND x.terminal_number = _terminal;
  IF r.scope IS DISTINCT FROM _scope OR r.tenant_id IS DISTINCT FROM (CASE WHEN _scope = 'tenant' THEN _tenant END) THEN
    RAISE EXCEPTION 'this terminal number is already registered to %',
      CASE WHEN r.scope = 'platform' THEN 'the NURIEL platform terminal' ELSE 'another store' END
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

-- The balance of one ledger category exactly as the owner and the panel see it (billing.summary). The ledger
-- allocates no payment to a charge, so "this charge is still payable" means "the category balance still covers it".
CREATE OR REPLACE FUNCTION payments.ledger_balance(_tenant uuid, _category text)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  s jsonb := billing.summary(_tenant, true);
BEGIN
  RETURN CASE _category
    WHEN 'subscription' THEN (s -> 'subscription_money' ->> 'balance')::numeric
    WHEN 'setup' THEN (s -> 'setup' ->> 'balance')::numeric
    WHEN 'other' THEN (s -> 'other' ->> 'balance')::numeric
  END;
END $$;

-- A provider-confirmed payment row in billing.ledger, inside its CHECKs (evidence 04 §3.2): kind 'payment', the
-- charge's category, amount, VAT snapshot and period; net / vat from billing.gross_parts; method 'credit_card';
-- confirmation 'provider' with provider_ref; source 'provider'. billing.guard() admits it only while
-- billing.provider_write = 'on' (20261114100000:221-226): set for this INSERT only. recorded_by stays NULL.
CREATE OR REPLACE FUNCTION payments.ledger_provider_payment(_charge billing.ledger, _attempt payments.platform_attempts,
  _txn_id text)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  _parts jsonb := billing.gross_parts(_charge.amount, _charge.vat_rate);
  _id    uuid;
BEGIN
  PERFORM set_config('billing.provider_write', 'on', true);
  INSERT INTO billing.ledger (tenant_id, tenant_label, engine, kind, category, amount, vat_business_type, vat_rate,
                              vat_amount, net_amount, occurred_on, period_start, period_end, method, description,
                              reference, internal_note, confirmation, provider_ref, source, agreement_id,
                              upgrade_request_id, recorded_by, recorded_by_email)
  VALUES (_charge.tenant_id, COALESCE(billing.tenant_label(_charge.tenant_id), _charge.tenant_label),
          billing.engine_of(_charge.tenant_id), 'payment', _charge.category, _charge.amount,
          _charge.vat_business_type, _charge.vat_rate, (_parts ->> 'vat')::numeric, (_parts ->> 'net')::numeric,
          billing.today(), _charge.period_start, _charge.period_end, 'credit_card',
          left(format('תשלום בכרטיס אשראי: %s', COALESCE(_charge.description, 'חיוב #' || _charge.entry_no)), 200),
          _attempt.reference,
          left(format('online payment %s (%s mode), charge #%s', _attempt.id, _attempt.mode, _charge.entry_no), 500),
          'provider', left(format('max:%s:%s', _attempt.mode, _txn_id), 200), 'provider',
          _charge.agreement_id, _charge.upgrade_request_id, NULL, NULL)
  RETURNING id INTO _id;
  PERFORM set_config('billing.provider_write', 'off', true);
  RETURN _id;
END $$;

-- The store address a platform payment started from (finding L2): https://<host> (no path, no port), or for the
-- local / E2E stack http://[<label>.]*localhost[:port]. The host must belong to THIS store the way tenant_for_host
-- resolves it — its own domain, its verified custom domain, or <slug>.<base> — and never by the default-store
-- fallback. NULL / empty = no origin (the app falls back to the store's subdomain). The database does not know the
-- platform's base domain: the app passes the origin of the request host it already resolved to this store.
CREATE OR REPLACE FUNCTION payments.store_origin(_tenant uuid, _origin text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  _o    text := lower(btrim(COALESCE(_origin, '')));
  _host text;
BEGIN
  IF _o = '' THEN
    RETURN NULL;
  END IF;
  IF char_length(_o) <= 300
     AND _o ~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' THEN
    _host := substr(_o, 9);
  ELSIF char_length(_o) <= 300
        AND _o ~ '^http://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*localhost(:[0-9]{1,5})?$' THEN
    _host := split_part(substr(_o, 8), ':', 1);
  ELSE
    RAISE EXCEPTION 'online payment: the return address is not a store address' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF public.tenant_for_host(_host) IS DISTINCT FROM _tenant
     OR NOT EXISTS (SELECT 1 FROM public.tenants t
                     WHERE t.id = _tenant
                       AND (t.domain = _host
                            OR (t.custom_domain = _host AND t.custom_domain_verified_at IS NOT NULL)
                            OR (_host LIKE '%.%.%' AND t.slug = split_part(_host, '.', 1)))) THEN
    RAISE EXCEPTION 'online payment: the return address is not one of this store''s addresses'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN _o;
END $$;

-- ------------------------------------------------------------------------------------------------------------
-- §8. Guard triggers (plpgsql bodies resolve names at call time; every object they use exists before COMMIT)
-- ------------------------------------------------------------------------------------------------------------
-- 8a. Environment: one row, never deleted; unsafe transitions refused; every change audited (system actor).
CREATE OR REPLACE FUNCTION payments.environment_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'payments.environment is never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'payments.environment has exactly one row' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.demo_since IS NOT NULL AND NEW.demo_since IS DISTINCT FROM OLD.demo_since THEN
    RAISE EXCEPTION 'a database that was DEMO stays marked as such (demo_since is never cleared)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    -- → demo: only a database that never held a live terminal or a live payment
    IF NEW.name = 'demo' AND (
         EXISTS (SELECT 1 FROM payments.platform_accounts x WHERE x.mode = 'live')
      OR EXISTS (SELECT 1 FROM payments.tenant_accounts x WHERE x.mode = 'live')
      OR EXISTS (SELECT 1 FROM payments.terminal_registry x WHERE x.terminal_number NOT LIKE '00100%')
      OR EXISTS (SELECT 1 FROM payments.platform_attempts x WHERE x.mode = 'live')
      OR EXISTS (SELECT 1 FROM payments.tenant_attempts x WHERE x.mode = 'live')) THEN
      RAISE EXCEPTION 'this database holds live terminals or live payments: it cannot become a DEMO database'
        USING ERRCODE = 'check_violation';
    END IF;
    -- → production: never a database that was DEMO (M5) — production marks a fresh database, at an approved go-live
    IF NEW.name = 'production' AND (OLD.demo_since IS NOT NULL OR OLD.name = 'demo') THEN
      RAISE EXCEPTION 'this database was a DEMO database: it can never become production (mark a fresh database)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.name = 'production' AND (
         EXISTS (SELECT 1 FROM payments.platform_accounts x WHERE x.mode = 'test')
      OR EXISTS (SELECT 1 FROM payments.tenant_accounts x WHERE x.mode = 'test')
      OR EXISTS (SELECT 1 FROM payments.terminal_registry x WHERE x.terminal_number LIKE '00100%')
      OR EXISTS (SELECT 1 FROM payments.platform_attempts x WHERE x.mode = 'test')
      OR EXISTS (SELECT 1 FROM payments.tenant_attempts x WHERE x.mode = 'test')) THEN
      RAISE EXCEPTION 'this database holds test terminals or test payments: it cannot become production'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.name = 'demo' AND NEW.demo_since IS NULL THEN
      NEW.demo_since := now();
    END IF;
    INSERT INTO payments.platform_config_audit (provider, actor_id, actor_role, action, changed_fields)
    VALUES (NULL, NULL, 'system', 'environment_changed', ARRAY['environment']);
  END IF;
  NEW.changed_at := now();
  NEW.changed_by := session_user::text;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS environment_guard ON payments.environment;
CREATE TRIGGER environment_guard BEFORE UPDATE OR DELETE ON payments.environment
  FOR EACH ROW EXECUTE FUNCTION payments.environment_guard();
DROP TRIGGER IF EXISTS environment_no_truncate ON payments.environment;
CREATE TRIGGER environment_no_truncate BEFORE TRUNCATE ON payments.environment
  FOR EACH STATEMENT EXECUTE FUNCTION payments.environment_guard();

-- 8b. Accounts (both scopes), decision ה-4. A DEMO database holds only test terminals (mode 'test', Hyp's documented
--     test prefix 00100…); a production database only live ones (00100… refused); an unmarked database takes no new
--     terminal at all. A store terminal is deleted only with its store.
CREATE OR REPLACE FUNCTION payments.accounts_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  _env     text := payments.env();
  _binding boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'tenant_accounts'
       AND COALESCE(current_setting('nuriel.deleting_tenant', true), '') = (to_jsonb(OLD) ->> 'tenant_id') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'payment terminals are disabled, never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    _binding := true;
  ELSE
    _binding := NEW.mode IS DISTINCT FROM OLD.mode OR NEW.terminal_number IS DISTINCT FROM OLD.terminal_number
                OR NEW.api_key_enc IS DISTINCT FROM OLD.api_key_enc
                OR NEW.api_password_enc IS DISTINCT FROM OLD.api_password_enc
                OR (NEW.enabled AND NOT OLD.enabled);
  END IF;
  IF _binding THEN
    IF _env IS NULL THEN
      RAISE EXCEPTION 'online payments are off in this database (payments.environment is not marked): no terminal can be set up'
        USING ERRCODE = 'check_violation';
    ELSIF _env = 'demo' AND (NEW.mode <> 'test'
                             OR (NEW.terminal_number IS NOT NULL AND NEW.terminal_number NOT LIKE '00100%')) THEN
      RAISE EXCEPTION 'DEMO database: only test terminals (mode test, terminal number 00100…) can be saved'
        USING ERRCODE = 'check_violation';
    ELSIF _env = 'production' AND (NEW.mode <> 'live'
                                   OR (NEW.terminal_number IS NOT NULL AND NEW.terminal_number LIKE '00100%')) THEN
      RAISE EXCEPTION 'production database: only live terminals can be saved; test terminals (00100…) are refused'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS platform_accounts_guard ON payments.platform_accounts;
CREATE TRIGGER platform_accounts_guard BEFORE INSERT OR UPDATE OR DELETE ON payments.platform_accounts
  FOR EACH ROW EXECUTE FUNCTION payments.accounts_guard();
DROP TRIGGER IF EXISTS tenant_accounts_guard ON payments.tenant_accounts;
CREATE TRIGGER tenant_accounts_guard BEFORE INSERT OR UPDATE OR DELETE ON payments.tenant_accounts
  FOR EACH ROW EXECUTE FUNCTION payments.accounts_guard();

-- 8c. Registry: never moved; deleted only if the terminal never took an attempt in either scope (an account that
--     still references it blocks the delete through its FK).
CREATE OR REPLACE FUNCTION payments.registry_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'the terminal registry is never truncated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'a registered terminal cannot be moved to another owner' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM payments.platform_attempts a
              WHERE a.provider = OLD.provider AND a.terminal_number = OLD.terminal_number)
     OR EXISTS (SELECT 1 FROM payments.tenant_attempts a
                 WHERE a.provider = OLD.provider AND a.terminal_number = OLD.terminal_number) THEN
    RAISE EXCEPTION 'this terminal took payments: it stays bound to its owner' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS terminal_registry_guard ON payments.terminal_registry;
CREATE TRIGGER terminal_registry_guard BEFORE UPDATE OR DELETE ON payments.terminal_registry
  FOR EACH ROW EXECUTE FUNCTION payments.registry_guard();
DROP TRIGGER IF EXISTS terminal_registry_no_truncate ON payments.terminal_registry;
CREATE TRIGGER terminal_registry_no_truncate BEFORE TRUNCATE ON payments.terminal_registry
  FOR EACH STATEMENT EXECUTE FUNCTION payments.registry_guard();

-- 8d. Attempts (both scopes): kept forever; snapshot immutable; state machine; settled / reviewed attempts final except
--     the review fields. A test attempt starts only in a DEMO database, a live one only in a production database.
CREATE OR REPLACE FUNCTION payments.attempts_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  _mutable constant text[] := ARRAY['state', 'applied', 'updated_at', 'signed_at', 'returned_at', 'verified_at',
    'paid_at', 'verify_lease_until', 'verify_attempts', 'provider_txn_id', 'approval_code', 'installments',
    'card_brand', 'card_last4', 'failure_code', 'return_flags', 'verification', 'review_reason', 'review_note',
    'review_resolved_at', 'review_resolved_by', 'order_id', 'ledger_payment_id'];
  _after_final constant text[] := ARRAY['review_reason', 'review_note', 'review_resolved_at', 'review_resolved_by',
    'updated_at', 'verify_lease_until', 'verify_attempts', 'order_id'];
  _o jsonb;
  _n jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment attempts are payment records: they are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.mode = 'live' AND payments.env() IS DISTINCT FROM 'production' THEN
      RAISE EXCEPTION 'a live payment can start only in a production database' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.mode = 'test' AND payments.env() IS DISTINCT FROM 'demo' THEN
      RAISE EXCEPTION 'a test payment can start only in a DEMO database' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state <> 'created' OR NEW.applied THEN
      RAISE EXCEPTION 'a payment attempt starts as created' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  _o := to_jsonb(OLD);
  _n := to_jsonb(NEW);
  IF (_n - _mutable) IS DISTINCT FROM (_o - _mutable) THEN
    RAISE EXCEPTION 'payment attempt: the snapshot cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- order_id (tenant scope): only cleared, only while platform_delete_tenant removes that store's orders
  IF (_n ->> 'order_id') IS DISTINCT FROM (_o ->> 'order_id')
     AND NOT ((_n ->> 'order_id') IS NULL
              AND COALESCE(current_setting('nuriel.deleting_tenant', true), '') = (_o ->> 'tenant_id')) THEN
    RAISE EXCEPTION 'payment attempt: the order link cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (_o ->> 'provider_txn_id') IS NOT NULL AND (_n ->> 'provider_txn_id') IS DISTINCT FROM (_o ->> 'provider_txn_id') THEN
    RAISE EXCEPTION 'payment attempt: the provider transaction id cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (_o ->> 'ledger_payment_id') IS NOT NULL
     AND (_n ->> 'ledger_payment_id') IS DISTINCT FROM (_o ->> 'ledger_payment_id') THEN
    RAISE EXCEPTION 'payment attempt: the ledger link cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.applied AND NOT NEW.applied THEN
    RAISE EXCEPTION 'payment attempt: an applied payment stays applied' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state IN ('paid', 'test_paid', 'needs_review')
     AND (_n - _after_final) IS DISTINCT FROM (_o - _after_final) THEN
    RAISE EXCEPTION 'payment attempt: a settled or reviewed attempt is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'created' AND NEW.state = 'redirected')
    OR (OLD.state IN ('created', 'redirected', 'returned')
        AND NEW.state IN ('returned', 'paid', 'test_paid', 'failed', 'expired', 'cancelled', 'needs_review'))
    OR (OLD.state IN ('failed', 'expired', 'cancelled') AND NEW.state IN ('paid', 'test_paid', 'needs_review'))) THEN
    RAISE EXCEPTION 'payment attempt: % -> % is not allowed', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS platform_attempts_guard ON payments.platform_attempts;
CREATE TRIGGER platform_attempts_guard BEFORE INSERT OR UPDATE OR DELETE ON payments.platform_attempts
  FOR EACH ROW EXECUTE FUNCTION payments.attempts_guard();
DROP TRIGGER IF EXISTS tenant_attempts_guard ON payments.tenant_attempts;
CREATE TRIGGER tenant_attempts_guard BEFORE INSERT OR UPDATE OR DELETE ON payments.tenant_attempts
  FOR EACH ROW EXECUTE FUNCTION payments.attempts_guard();

-- 8e. Events and config audit (both scopes): append-only, no exception (they outlive a deleted store). No TRUNCATE
--     on any record table.
CREATE OR REPLACE FUNCTION payments.rows_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'payments.% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
DO $ao$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['platform_events', 'platform_config_audit', 'tenant_events', 'tenant_config_audit'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON payments.%I', _t || '_append_only', _t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON payments.%I '
                   'FOR EACH ROW EXECUTE FUNCTION payments.rows_append_only()', _t || '_append_only', _t);
  END LOOP;
  FOREACH _t IN ARRAY ARRAY['platform_accounts', 'platform_attempts', 'platform_events', 'platform_config_audit',
                            'tenant_accounts', 'tenant_attempts', 'tenant_events', 'tenant_config_audit',
                            'unknown_returns', 'platform_stepup_challenges'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON payments.%I', _t || '_no_truncate', _t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON payments.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION payments.rows_append_only()', _t || '_no_truncate', _t);
  END LOOP;
END $ao$;

-- 8f. Unknown returns: never changed; removed only by the purge, after 30 days
CREATE OR REPLACE FUNCTION payments.unknown_returns_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'payments.unknown_returns is append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.received_at > now() - interval '30 days' THEN
    RAISE EXCEPTION 'an unknown return is kept for 30 days' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS unknown_returns_guard ON payments.unknown_returns;
CREATE TRIGGER unknown_returns_guard BEFORE UPDATE OR DELETE ON payments.unknown_returns
  FOR EACH ROW EXECUTE FUNCTION payments.unknown_returns_guard();

-- 8g. Step-up challenges only move forward: identity, hashes and times never change; tries only grow; consumed,
--     spent and superseded are set once. Removed only by the purge, after a day.
CREATE OR REPLACE FUNCTION payments.stepup_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.created_at > now() - interval '1 day' THEN
      RAISE EXCEPTION 'a step-up challenge is kept for a day' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.purpose_hash IS DISTINCT FROM OLD.purpose_hash OR NEW.code_hmac IS DISTINCT FROM OLD.code_hmac
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.tries < OLD.tries
     OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
     OR (OLD.spent_at IS NOT NULL AND NEW.spent_at IS DISTINCT FROM OLD.spent_at)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'a step-up challenge only moves forward' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS platform_stepup_guard ON payments.platform_stepup_challenges;
CREATE TRIGGER platform_stepup_guard BEFORE UPDATE OR DELETE ON payments.platform_stepup_challenges
  FOR EACH ROW EXECUTE FUNCTION payments.stepup_guard();

-- 8h. Decision 15 on public.orders: a store admin cannot delete an order that has an online payment record (cancel it
--     instead). Inside platform_delete_tenant (nuriel.deleting_tenant = this store) the delete proceeds and the FK sets
--     tenant_attempts.order_id to NULL; the attempt stays. BEFORE DELETE — not a BEFORE INSERT trigger, so the
--     trigger-order assertion of remove-hyp.test.sql is unaffected.
CREATE OR REPLACE FUNCTION payments.orders_online_payment_keep()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(current_setting('nuriel.deleting_tenant', true), '') <> OLD.tenant_id::text
     AND EXISTS (SELECT 1 FROM payments.tenant_attempts a WHERE a.tenant_id = OLD.tenant_id AND a.order_id = OLD.id) THEN
    RAISE EXCEPTION 'order % has an online payment record: cancel the order instead of deleting it', OLD.order_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS orders_online_payment_keep ON public.orders;
CREATE TRIGGER orders_online_payment_keep BEFORE DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION payments.orders_online_payment_keep();

-- 8i. Store settings ⊆ what is verified for the store's terminal (one payment only for a test terminal: its
--     terminal_max_installments is 1)
CREATE OR REPLACE FUNCTION payments.store_settings_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  acc payments.tenant_accounts;
BEGIN
  SELECT * INTO acc FROM payments.tenant_accounts a WHERE a.tenant_id = NEW.tenant_id AND a.provider = NEW.provider;
  IF NOT (NEW.allowed_methods <@ acc.verified_methods) OR NOT (NEW.allowed_brands <@ acc.verified_brands)
     OR NEW.max_installments > acc.terminal_max_installments THEN
    RAISE EXCEPTION 'only methods, brands and installments verified for the terminal can be offered'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenant_store_settings_guard ON payments.tenant_store_settings;
CREATE TRIGGER tenant_store_settings_guard BEFORE INSERT OR UPDATE ON payments.tenant_store_settings
  FOR EACH ROW EXECUTE FUNCTION payments.store_settings_guard();

-- 8j. Amount lock (MX-01, M11), online orders only. While an attempt is active — and after an online payment was
--     applied, until a refund path exists — the order total cannot change, for anyone (staff included), whatever path
--     changed it. Grow, Bit and offline orders are unaffected.
CREATE OR REPLACE FUNCTION payments.orders_amount_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payments.tenant_attempts a
              WHERE a.tenant_id = NEW.tenant_id AND a.order_id = NEW.id
                AND a.state IN ('created', 'redirected', 'returned')) THEN
    RAISE EXCEPTION 'order % is being paid online: its amount cannot change; cancel the payment attempt first',
      NEW.order_number USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM payments.tenant_attempts a
              WHERE a.tenant_id = NEW.tenant_id AND a.order_id = NEW.id AND a.applied) THEN
    RAISE EXCEPTION 'order % was paid online: its amount and lines are locked (no refund path yet)',
      NEW.order_number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS orders_payment_amount_lock ON public.orders;
CREATE TRIGGER orders_payment_amount_lock AFTER UPDATE ON public.orders
  FOR EACH ROW WHEN (NEW.payment_method = 'online' AND OLD.total IS DISTINCT FROM NEW.total)
  EXECUTE FUNCTION payments.orders_amount_lock();

-- Lines of an online order: no change while an attempt is active, none at all once paid online (staff included), and
-- a non-staff caller never adds or changes lines after the transaction that created the order (place_order /
-- place_guest_order insert their lines in that transaction: orders.created_at = now()). Only platform_delete_tenant
-- passes through (nuriel.deleting_tenant). Columns that do not change the amount (picking, reservations) are free.
CREATE OR REPLACE FUNCTION payments.order_items_amount_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _row    public.order_items;
  _orders uuid[];
  _method text;
  _born   timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _row := OLD;
  ELSE
    _row := NEW;
  END IF;
  IF COALESCE(current_setting('nuriel.deleting_tenant', true), '') = _row.tenant_id::text
     OR (TG_OP = 'UPDATE'
         AND (NEW.order_id, NEW.product_id, NEW.variant_id, NEW.quantity, NEW.unit_price, NEW.is_deposit, NEW.is_gift)
             IS NOT DISTINCT FROM
             (OLD.order_id, OLD.product_id, OLD.variant_id, OLD.quantity, OLD.unit_price, OLD.is_deposit, OLD.is_gift)) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  _orders := CASE WHEN TG_OP = 'UPDATE' THEN ARRAY[NEW.order_id, OLD.order_id] ELSE ARRAY[_row.order_id] END;
  IF EXISTS (SELECT 1 FROM payments.tenant_attempts a
              WHERE a.order_id = ANY (_orders) AND a.state IN ('created', 'redirected', 'returned')) THEN
    RAISE EXCEPTION 'the order is being paid online: its lines cannot change; cancel the payment attempt first'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM payments.tenant_attempts a WHERE a.order_id = ANY (_orders) AND a.applied) THEN
    RAISE EXCEPTION 'the order was paid online: its lines are locked (no refund path yet)'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT o.payment_method, o.created_at INTO _method, _born FROM public.orders o WHERE o.id = _row.order_id;
  IF _method = 'online' AND _born IS DISTINCT FROM now() AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'lines of an online-paid order are changed only by the store' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_items_a_payment_lock ON public.order_items;
CREATE TRIGGER order_items_a_payment_lock BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION payments.order_items_amount_lock();

-- ------------------------------------------------------------------------------------------------------------
-- §9. TENANT SCOPE API (public; EXECUTE for service_role only, §13). Every function takes the store explicitly.
--     Lock order everywhere: public.orders row → payments.tenant_attempts row.
-- ------------------------------------------------------------------------------------------------------------
-- 9a. Availability (checkout and orders_default_payment). A suspended store offers nothing; the settle path does not
--     call this, so a payment already on its way still settles (MX-05). _actor is kept for the API shape; with no
--     test users (ה-4) it no longer changes the answer.
CREATE OR REPLACE FUNCTION public.max_payments_active(_tenant uuid, _actor uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT payments.flag('max_payments')
     AND EXISTS (
       SELECT 1 FROM payments.tenant_accounts a
         JOIN public.tenants t ON t.id = a.tenant_id
        WHERE a.tenant_id = _tenant AND a.provider = 'max' AND a.enabled AND a.status = 'verified'
          AND t.site_type = 'ecommerce' AND t.status = 'active'
          AND payments.mode_allowed(a.mode));
$$;

-- 9b. Guest capability (decision 11): the server stores sha256(token) right after place_guest_order; first one wins.
CREATE OR REPLACE FUNCTION public.max_order_access_issue(_tenant uuid, _order uuid, _token_sha256 text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _token_sha256 IS NULL OR _token_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'online payment: malformed token hash' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders o
                  WHERE o.id = _order AND o.tenant_id = _tenant AND o.customer_id IS NULL AND o.kind = 'order'
                    AND o.payment_method = 'online' AND o.payment_status = 'awaiting' AND o.status = 'pending') THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO payments.tenant_order_access (tenant_id, order_id, token_sha256, expires_at)
  VALUES (_tenant, _order, _token_sha256, now() + interval '24 hours')
  ON CONFLICT (order_id) DO NOTHING;
  RETURN FOUND;
END $$;

-- 9c. Open (or reuse) an attempt — the server calls it before SIGN. Test mode: at most ₪50, one payment.
CREATE OR REPLACE FUNCTION public.max_attempt_open(_tenant uuid, _order uuid, _customer uuid,
  _guest_token_sha256 text, _app_environment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o        public.orders;
  acc      payments.tenant_accounts;
  st       payments.tenant_store_settings;
  a        payments.tenant_attempts;
  _amount  bigint;
  _expires timestamptz;
  _n       integer;
  _tash    smallint;
BEGIN
  IF _tenant IS NULL OR _order IS NULL THEN
    RAISE EXCEPTION 'online payment: store and order are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- the application states which environment it believes it runs in; a demo app on a production database (or the
  -- reverse, or an unmarked database) stops here
  IF NOT payments.app_env_ok(_app_environment) THEN
    RAISE EXCEPTION 'online payment: application and database environments differ' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO o FROM public.orders x WHERE x.id = _order AND x.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND
     OR (o.customer_id IS NOT NULL AND o.customer_id IS DISTINCT FROM _customer)
     OR (o.customer_id IS NULL AND NOT EXISTS (
           SELECT 1 FROM payments.tenant_order_access g
            WHERE g.order_id = o.id AND g.tenant_id = _tenant AND g.expires_at > now()
              AND g.token_sha256 = _guest_token_sha256)) THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF o.kind <> 'order' OR o.payment_method <> 'online' OR o.payment_status <> 'awaiting' OR o.status <> 'pending' THEN
    RAISE EXCEPTION 'order % is not awaiting an online payment', o.order_number USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.max_payments_active(_tenant, o.customer_id) THEN
    RAISE EXCEPTION 'online payment is not available in this store right now' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO acc FROM payments.tenant_accounts x WHERE x.tenant_id = _tenant AND x.provider = 'max' FOR SHARE;
  _amount := round(public.order_amount_due(o.total, o.prices_include_vat, o.vat_rate) * 100)::bigint;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000000 THEN
    RAISE EXCEPTION 'order % has no payable amount', o.order_number USING ERRCODE = 'check_violation';
  END IF;
  IF acc.mode = 'test' AND _amount > 5000 THEN
    RAISE EXCEPTION 'test payments are limited to 50 ILS (order %)', o.order_number USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO a FROM payments.tenant_attempts x
   WHERE x.order_id = o.id AND x.state IN ('created', 'redirected', 'returned') FOR UPDATE;
  IF FOUND THEN
    -- back from the payment page and not verified yet: a new page now could charge twice
    IF a.state = 'returned' THEN
      RAISE EXCEPTION 'the payment of order % is being verified', o.order_number USING ERRCODE = 'check_violation';
    END IF;
    IF a.expires_at > now() + interval '5 minutes' AND a.amount_minor = _amount
       AND a.terminal_number = acc.terminal_number AND a.mode = acc.mode THEN
      RETURN jsonb_build_object('attempt_id', a.id, 'reference', a.reference, 'amount_minor', a.amount_minor,
        'currency', a.currency, 'terminal_number', a.terminal_number, 'mode', a.mode,
        'max_installments', a.max_installments, 'expires_at', a.expires_at, 'reused', true);
    END IF;
    UPDATE payments.tenant_attempts SET state = 'expired' WHERE id = a.id;
    INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result) VALUES (a.tenant_id, a.id, 'open', 'superseded');
  END IF;

  SELECT count(*) INTO _n FROM payments.tenant_attempts x WHERE x.order_id = o.id;
  IF _n >= 5 THEN
    RAISE EXCEPTION 'too many payment attempts for order %', o.order_number USING ERRCODE = 'check_violation';
  END IF;
  -- each attempt ends at least 15 minutes before the order expires (grace for a late return + VERIFY)
  _expires := LEAST(now() + interval '30 minutes', o.payment_due_at - interval '15 minutes');
  IF _expires IS NULL OR _expires < now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'the payment window of order % is closing; place the order again', o.order_number
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO st FROM payments.tenant_store_settings x WHERE x.tenant_id = _tenant AND x.provider = 'max';
  _tash := CASE WHEN acc.mode = 'test' THEN 1
                WHEN st.tenant_id IS NOT NULL AND _amount >= st.min_installments_amount_minor
                  THEN LEAST(st.max_installments, acc.terminal_max_installments)
                ELSE 1 END;

  INSERT INTO payments.tenant_attempts (tenant_id, store_label, order_id, order_number, attempt_no, provider, mode,
         terminal_number, key_version, amount_minor, currency, max_installments, reference, customer_id, expires_at)
  VALUES (o.tenant_id,
          COALESCE((SELECT left(format('%s (%s)', t.name, t.slug), 200) FROM public.tenants t WHERE t.id = o.tenant_id),
                   o.tenant_id::text),
          o.id, COALESCE(o.order_number, o.id::text), _n + 1, 'max', acc.mode, acc.terminal_number, acc.key_version,
          _amount, 'ILS', _tash, replace(gen_random_uuid()::text, '-', ''), o.customer_id, _expires)
  RETURNING * INTO a;
  INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result) VALUES (a.tenant_id, a.id, 'open', 'created');
  RETURN jsonb_build_object('attempt_id', a.id, 'reference', a.reference, 'amount_minor', a.amount_minor,
    'currency', a.currency, 'terminal_number', a.terminal_number, 'mode', a.mode,
    'max_installments', a.max_installments, 'expires_at', a.expires_at, 'reused', false);
END $$;

-- 9d. Ciphertext for SIGN / VERIFY of ONE attempt of ONE store (the app decrypts with its key). 'verify' takes a
--     45-second lease (one VERIFY at a time per attempt) and counts calls; the 7th call parks the attempt in
--     needs_review ('verify_exhausted').
CREATE OR REPLACE FUNCTION public.max_attempt_secrets(_tenant uuid, _attempt uuid, _purpose text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a   payments.tenant_attempts;
  acc payments.tenant_accounts;
BEGIN
  IF _purpose IS NULL OR _purpose NOT IN ('sign', 'verify') THEN
    RAISE EXCEPTION 'online payment: unknown purpose' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO a FROM payments.tenant_attempts x WHERE x.id = _attempt AND x.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'online payment: unknown attempt' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO acc FROM payments.tenant_accounts x WHERE x.tenant_id = _tenant AND x.provider = a.provider;
  IF NOT FOUND OR acc.terminal_number IS DISTINCT FROM a.terminal_number OR acc.mode IS DISTINCT FROM a.mode
     OR acc.api_key_enc IS NULL OR acc.api_password_enc IS NULL THEN
    RAISE EXCEPTION 'online payment: the terminal of this attempt is no longer configured' USING ERRCODE = 'check_violation';
  END IF;
  IF _purpose = 'sign' THEN
    IF a.state NOT IN ('created', 'redirected') OR a.expires_at <= now()
       OR NOT public.max_payments_active(_tenant, a.customer_id) THEN
      RAISE EXCEPTION 'online payment: this attempt cannot be signed' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF a.returned_at IS NULL OR a.created_at < now() - interval '7 days' THEN
      RAISE EXCEPTION 'online payment: nothing to verify for this attempt' USING ERRCODE = 'check_violation';
    END IF;
    IF a.verify_lease_until IS NOT NULL AND a.verify_lease_until > now() THEN
      RETURN jsonb_build_object('result', 'busy', 'retry_after_seconds',
                                ceil(extract(epoch FROM a.verify_lease_until - now()))::int);
    END IF;
    IF a.verify_attempts >= 6 THEN
      IF a.state IN ('created', 'redirected', 'returned') THEN
        UPDATE payments.tenant_attempts SET state = 'needs_review', review_reason = 'verify_exhausted' WHERE id = a.id;
        INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result)
        VALUES (a.tenant_id, a.id, 'review', 'verify_exhausted');
      END IF;
      RETURN jsonb_build_object('result', 'exhausted');
    END IF;
    UPDATE payments.tenant_attempts
       SET verify_lease_until = now() + interval '45 seconds', verify_attempts = verify_attempts + 1
     WHERE id = a.id;
  END IF;
  RETURN jsonb_build_object('result', 'ok', 'terminal_number', acc.terminal_number, 'mode', acc.mode,
                            'key_version', acc.key_version, 'api_key_enc', acc.api_key_enc,
                            'api_password_enc', acc.api_password_enc);
END $$;

-- 9e. SIGN result (created → redirected | failed). Credential errors switch the account off (fail closed).
CREATE OR REPLACE FUNCTION public.max_attempt_signed(_tenant uuid, _attempt uuid, _ok boolean, _code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a  payments.tenant_attempts;
  _c text := CASE WHEN _code ~ '^[0-9]{1,4}$' THEN _code END;
BEGIN
  SELECT * INTO a FROM payments.tenant_attempts x WHERE x.id = _attempt AND x.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'online payment: unknown attempt' USING ERRCODE = 'no_data_found';
  END IF;
  IF a.state <> 'created' THEN
    RETURN jsonb_build_object('result', 'ignored', 'state', a.state);
  END IF;
  IF _ok THEN
    UPDATE payments.tenant_attempts SET state = 'redirected', signed_at = now() WHERE id = a.id;
  ELSE
    UPDATE payments.tenant_attempts SET state = 'failed', failure_code = _c WHERE id = a.id;
    IF _c IN ('901', '902') THEN
      UPDATE payments.tenant_accounts x SET status = 'failed', last_verify_code = _c
       WHERE x.tenant_id = _tenant AND x.provider = 'max' AND x.terminal_number = a.terminal_number AND x.status <> 'failed';
      IF FOUND THEN
        INSERT INTO payments.tenant_config_audit (tenant_id, provider, actor_id, actor_role, action, changed_fields)
        VALUES (_tenant, 'max', NULL, 'system', 'verify_failed', ARRAY['status']);
      END IF;
    END IF;
  END IF;
  INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result, summary)
  VALUES (a.tenant_id, a.id, 'sign', CASE WHEN _ok THEN 'ok' ELSE 'error' END,
          payments.event_summary(_c, NULL, NULL, NULL, NULL, NULL, NULL));
  RETURN jsonb_build_object('result', CASE WHEN _ok THEN 'redirected' ELSE 'failed' END);
END $$;

-- 9f. Browser return: record only — it never pays. The store of the Host must be the store of the attempt; a return
--     on another store's host is answered like an unknown reference and leaves a payload-less 'wrong_host' event (it
--     reveals a portal misconfiguration and cannot take the replay slot of the genuine return). The first receipt of a
--     payload extends the order's payment window (+2 h, at most 24 h after the order was created) so
--     expire_unpaid_orders() cannot cancel an order whose payment is being verified. A reference that matches no
--     attempt: the app records it with platform_payment_unknown_return('tenant', host, hash).
CREATE OR REPLACE FUNCTION public.max_attempt_record_return(_host_tenant uuid, _reference text,
  _payload_sha256 text, _ccode text, _txn_id text, _amount_minor bigint, _installments integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _id     uuid;
  _tenant uuid;
  _order  uuid;
  a       payments.tenant_attempts;
  _n      integer;
BEGIN
  IF _host_tenant IS NULL OR _reference IS NULL OR _reference !~ '^[0-9a-f]{32}$'
     OR _payload_sha256 IS NULL OR _payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('result', 'malformed');
  END IF;
  SELECT x.id, x.tenant_id, x.order_id INTO _id, _tenant, _order
    FROM payments.tenant_attempts x WHERE x.reference = _reference;
  IF _id IS NULL THEN
    RETURN jsonb_build_object('result', 'unknown');
  END IF;
  IF _tenant IS DISTINCT FROM _host_tenant THEN
    INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result) VALUES (_tenant, _id, 'wrong_host', 'ignored');
    RETURN jsonb_build_object('result', 'unknown');
  END IF;
  IF _order IS NOT NULL THEN
    PERFORM 1 FROM public.orders o WHERE o.id = _order AND o.tenant_id = _tenant FOR UPDATE;
  END IF;
  SELECT * INTO a FROM payments.tenant_attempts x WHERE x.id = _id FOR UPDATE;
  INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, payload_sha256, verification, result, summary)
  VALUES (a.tenant_id, a.id, 'return', _payload_sha256, 'pending', 'received',
          payments.event_summary(_ccode, NULL, _txn_id, _amount_minor, NULL, _installments, NULL))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF a.state IN ('created', 'redirected') THEN
    UPDATE payments.tenant_attempts SET state = 'returned', returned_at = now() WHERE id = a.id;
  ELSIF a.returned_at IS NULL AND a.state IN ('failed', 'expired', 'cancelled') THEN
    UPDATE payments.tenant_attempts SET returned_at = now() WHERE id = a.id;
  END IF;
  IF _n > 0 AND _order IS NOT NULL THEN
    PERFORM set_config('kobi.payment_update', 'on', true);
    UPDATE public.orders o
       SET payment_due_at = LEAST(GREATEST(o.payment_due_at, now() + interval '2 hours'), o.created_at + interval '24 hours')
     WHERE o.id = _order AND o.tenant_id = _tenant AND o.payment_method = 'online'
       AND o.payment_status = 'awaiting' AND o.status = 'pending';
    PERFORM set_config('kobi.payment_update', 'off', true);
  END IF;
  RETURN jsonb_build_object('result', CASE WHEN _n = 0 THEN 'replay' ELSE 'received' END,
    'attempt_id', a.id, 'tenant_id', a.tenant_id, 'order_id', a.order_id,
    'state', CASE WHEN a.state IN ('created', 'redirected') THEN 'returned' ELSE a.state END,
    'terminal_number', a.terminal_number, 'mode', a.mode);
END $$;

-- 9g. Settle after the server-to-server VERIFY — the ONLY path that marks an order paid online (anchor name).
--     Outcomes: test_paid / paid (applied) | needs_review (reason) | not_paid | unverified | already_paid |
--     duplicate_charge | environment_mismatch | unknown | unknown_payload | malformed.
--     _return_flags (contract ReturnFlag): document → needs_review 'document_issued'; hk / multi, and CCode
--     600 / 700 / 800 → needs_review 'unexpected_hold' — both checked before the generic "failed" branch.
CREATE OR REPLACE FUNCTION public.max_attempt_mark_paid(_tenant uuid, _reference text, _payload_sha256 text,
  _verify_ccode text, _ccode text, _terminal text, _txn_id text, _amount_minor bigint, _currency text,
  _installments integer, _approval_code text, _card_brand text, _card_last4 text, _return_flags text[],
  _app_environment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _flags   text[] := payments.clean_flags(_return_flags);
  _id      uuid;
  _order   uuid;
  o        public.orders;
  a        payments.tenant_attempts;
  _reason  text;
  _due     bigint;
  _hold    boolean;
  _doc     boolean;
  _cname   text;
  _summary jsonb;
BEGIN
  IF _tenant IS NULL OR _reference IS NULL OR _reference !~ '^[0-9a-f]{32}$'
     OR _payload_sha256 IS NULL OR _payload_sha256 !~ '^[0-9a-f]{64}$' OR _flags IS NULL THEN
    RETURN jsonb_build_object('result', 'malformed');
  END IF;
  _summary := payments.event_summary(_ccode, _verify_ccode, _txn_id, _amount_minor, _currency, _installments,
                                     _approval_code, _flags);
  SELECT x.id, x.order_id INTO _id, _order FROM payments.tenant_attempts x
   WHERE x.reference = _reference AND x.tenant_id = _tenant;
  IF _id IS NULL THEN
    RETURN jsonb_build_object('result', 'unknown');
  END IF;
  IF _order IS NOT NULL THEN
    SELECT * INTO o FROM public.orders x WHERE x.id = _order AND x.tenant_id = _tenant FOR UPDATE;
  END IF;
  SELECT * INTO a FROM payments.tenant_attempts x WHERE x.id = _id FOR UPDATE;
  -- the verified payload must be one that actually arrived for this attempt
  IF NOT EXISTS (SELECT 1 FROM payments.tenant_events e
                  WHERE e.attempt_id = a.id AND e.source IN ('return', 'notify')
                    AND e.payload_sha256 = _payload_sha256 AND e.result = 'received') THEN
    RETURN jsonb_build_object('result', 'unknown_payload');
  END IF;
  -- the app and the database must agree on the environment: otherwise recorded, NOT settled, no state change
  IF NOT payments.app_env_ok(_app_environment) THEN
    INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, payload_sha256, verification, result)
    VALUES (a.tenant_id, a.id, 'verify', _payload_sha256, 'error', 'env_mismatch');
    UPDATE payments.tenant_attempts SET verify_lease_until = NULL WHERE id = a.id AND verify_lease_until IS NOT NULL;
    RETURN jsonb_build_object('result', 'environment_mismatch', 'attempt_id', a.id);
  END IF;
  INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, payload_sha256, verification, result, summary)
  VALUES (a.tenant_id, a.id, 'verify', _payload_sha256,
          CASE WHEN _verify_ccode = '0' THEN 'verified' WHEN _verify_ccode IS NULL THEN 'error' ELSE 'rejected' END,
          'checked', _summary);
  -- the VERIFY lease taken by max_attempt_secrets('verify') ends here, whatever the outcome
  UPDATE payments.tenant_attempts SET verify_lease_until = NULL WHERE id = a.id AND verify_lease_until IS NOT NULL;
  -- a payload the provider did not confirm changes nothing: a forged redirect can neither pay nor fail an attempt
  IF _verify_ccode IS DISTINCT FROM '0' THEN
    RETURN jsonb_build_object('result', 'unverified', 'attempt_id', a.id);
  END IF;
  IF _txn_id IS NULL OR _txn_id !~ '^[0-9A-Za-z-]{1,40}$' THEN
    RETURN jsonb_build_object('result', 'malformed', 'attempt_id', a.id);
  END IF;
  IF a.state = 'needs_review' THEN
    RETURN jsonb_build_object('result', 'needs_review', 'reason', a.review_reason, 'attempt_id', a.id,
                              'order_id', a.order_id, 'tenant_id', a.tenant_id);
  END IF;
  IF a.state IN ('paid', 'test_paid') THEN
    IF a.provider_txn_id = _txn_id OR _ccode IS DISTINCT FROM '0' THEN
      RETURN jsonb_build_object('result', 'already_paid', 'state', a.state, 'attempt_id', a.id,
                                'order_id', a.order_id, 'tenant_id', a.tenant_id);
    END IF;
    -- a second, different approved charge for an attempt that is already settled → a refund case
    UPDATE payments.tenant_attempts SET review_reason = 'duplicate_charge' WHERE id = a.id AND review_reason IS NULL;
    RETURN jsonb_build_object('result', 'duplicate_charge', 'attempt_id', a.id, 'order_id', a.order_id,
                              'tenant_id', a.tenant_id);
  END IF;
  _doc := 'document' = ANY (_flags);
  _hold := _ccode IN ('600', '700', '800') OR 'hk' = ANY (_flags) OR 'multi' = ANY (_flags);
  -- a plain decline: failed. A hold (600 J2 / 700 J5 / 800 postponed), a standing order (HKId), a multi-transaction
  -- (MULTI) or an issued document is never a plain decline — it goes to a person below (M3, H2)
  IF _ccode IS DISTINCT FROM '0' AND NOT _hold AND NOT _doc THEN
    IF a.state IN ('created', 'redirected', 'returned') THEN
      UPDATE payments.tenant_attempts
         SET state = 'failed', verified_at = now(), verification = _summary, return_flags = _flags,
             failure_code = CASE WHEN _ccode ~ '^[0-9A-Za-z_-]{1,16}$' THEN _ccode END
       WHERE id = a.id;
    END IF;
    RETURN jsonb_build_object('result', 'not_paid', 'attempt_id', a.id, 'order_id', a.order_id,
                              'tenant_id', a.tenant_id);
  END IF;

  -- approved and verified (or a hold / document): every mismatch goes to a person (needs_review), never to "paid"
  IF EXISTS (SELECT 1 FROM payments.tenant_attempts x
              WHERE x.provider = a.provider AND x.terminal_number = a.terminal_number
                AND x.provider_txn_id = _txn_id AND x.id <> a.id) THEN
    _reason := 'duplicate_txn';
  ELSIF _doc THEN
    -- Hyp issued (or may have issued) a tax document: the DEMO runs without documents (decision ה-6)
    _reason := 'document_issued';
  ELSIF _hold THEN
    _reason := 'unexpected_hold';
  ELSIF _terminal IS DISTINCT FROM a.terminal_number THEN
    -- consistency check only: the return carries no terminal; the binding is VERIFY with this attempt's credentials
    _reason := 'terminal_mismatch';
  ELSIF _currency IS DISTINCT FROM a.currency THEN
    _reason := 'currency_mismatch';
  ELSIF _amount_minor IS DISTINCT FROM a.amount_minor THEN
    _reason := 'amount_mismatch';
  ELSIF COALESCE(_installments, 1) NOT BETWEEN 1 AND a.max_installments THEN
    _reason := 'installments_exceeded';
  ELSIF NOT payments.mode_allowed(a.mode) THEN
    _reason := 'mode_not_allowed';
  ELSIF o.id IS NULL OR o.kind <> 'order' OR o.payment_method <> 'online' OR o.payment_status <> 'awaiting'
        OR o.status <> 'pending' THEN
    -- an expired / superseded / staff-cancelled attempt is still accepted below while the order itself still awaits the
    -- same amount; once the order moved on it is a person's decision
    _reason := CASE
      WHEN o.id IS NOT NULL AND o.payment_status = 'paid'
           AND EXISTS (SELECT 1 FROM payments.tenant_attempts x WHERE x.order_id = o.id AND x.applied AND x.id <> a.id)
        THEN 'duplicate_charge'
      WHEN a.state IN ('expired', 'cancelled') THEN 'late'
      ELSE 'order_not_awaiting' END;
  ELSE
    _due := round(public.order_amount_due(o.total, o.prices_include_vat, o.vat_rate) * 100)::bigint;
    IF _due IS DISTINCT FROM a.amount_minor THEN
      _reason := 'amount_mismatch';
    END IF;
  END IF;

  IF _reason IS NOT NULL THEN
    BEGIN
      UPDATE payments.tenant_attempts
         SET state = 'needs_review', review_reason = _reason, verified_at = now(), verification = _summary,
             return_flags = _flags,
             provider_txn_id = CASE WHEN _reason = 'duplicate_txn' THEN NULL ELSE _txn_id END,
             approval_code = CASE WHEN _approval_code ~ '^[0-9A-Za-z]{1,16}$' THEN _approval_code END
       WHERE id = a.id;
    EXCEPTION WHEN unique_violation THEN
      -- the same transaction id was taken concurrently by another attempt of this terminal
      _reason := 'duplicate_txn';
      UPDATE payments.tenant_attempts
         SET state = 'needs_review', review_reason = _reason, verified_at = now(), verification = _summary,
             return_flags = _flags
       WHERE id = a.id;
    END;
    INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result) VALUES (a.tenant_id, a.id, 'review', _reason);
    RETURN jsonb_build_object('result', 'needs_review', 'reason', _reason, 'attempt_id', a.id,
                              'order_id', a.order_id, 'tenant_id', a.tenant_id);
  END IF;

  -- applied: a test payment in a DEMO database (the whole flow is rehearsed), a live one in production
  BEGIN
    UPDATE payments.tenant_attempts
       SET state = CASE WHEN a.mode = 'live' THEN 'paid' ELSE 'test_paid' END, applied = true,
           paid_at = now(), verified_at = now(), provider_txn_id = _txn_id, verification = _summary,
           return_flags = _flags, installments = GREATEST(COALESCE(_installments, 1), 1),
           approval_code = CASE WHEN _approval_code ~ '^[0-9A-Za-z]{1,16}$' THEN _approval_code END,
           card_brand = CASE WHEN _card_brand ~ '^[a-z_]{2,20}$' THEN _card_brand END,
           card_last4 = CASE WHEN _card_last4 ~ '^[0-9]{4}$' THEN _card_last4 END
     WHERE id = a.id;
  EXCEPTION WHEN unique_violation THEN
    -- the same transaction id was settled concurrently under another reference, or another attempt was applied
    GET STACKED DIAGNOSTICS _cname = CONSTRAINT_NAME;
    _reason := CASE WHEN _cname LIKE '%provider_txn%' THEN 'duplicate_txn' ELSE 'duplicate_charge' END;
    UPDATE payments.tenant_attempts
       SET state = 'needs_review', review_reason = _reason, verified_at = now(), verification = _summary,
           return_flags = _flags
     WHERE id = a.id;
    INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result) VALUES (a.tenant_id, a.id, 'review', _reason);
    RETURN jsonb_build_object('result', 'needs_review', 'reason', _reason, 'attempt_id', a.id,
                              'order_id', a.order_id, 'tenant_id', a.tenant_id);
  END;
  PERFORM set_config('kobi.payment_update', 'on', true);
  UPDATE public.orders SET payment_status = 'paid', paid_at = now(), payment_due_at = NULL WHERE id = o.id;
  PERFORM set_config('kobi.payment_update', 'off', true);
  WITH done AS (
    UPDATE payments.tenant_attempts SET state = 'cancelled'
     WHERE order_id = o.id AND id <> a.id AND state IN ('created', 'redirected', 'returned')
    RETURNING id, tenant_id
  )
  INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result)
  SELECT d.tenant_id, d.id, 'cancel', 'order_paid' FROM done d;
  RETURN jsonb_build_object('result', CASE WHEN a.mode = 'live' THEN 'paid' ELSE 'test_paid' END,
                            'applied', true, 'mode', a.mode, 'attempt_id', a.id, 'order_id', a.order_id,
                            'tenant_id', a.tenant_id);
END $$;

-- 9h. Expiry sweep (same 5-minute job as expire_unpaid_orders; never blocks a settling attempt)
CREATE OR REPLACE FUNCTION public.max_attempts_expire()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n integer;
BEGIN
  WITH due AS (
    SELECT a.id, a.expires_at < now() AS timed_out
      FROM payments.tenant_attempts a
     WHERE a.state IN ('created', 'redirected', 'returned')
       AND (a.expires_at < now()
            OR NOT EXISTS (SELECT 1 FROM public.orders o
                            WHERE o.id = a.order_id AND o.status = 'pending' AND o.payment_status = 'awaiting'))
     ORDER BY a.expires_at
     LIMIT 500
     FOR UPDATE OF a SKIP LOCKED
  ), done AS (
    UPDATE payments.tenant_attempts a
       SET state = CASE WHEN due.timed_out THEN 'expired' ELSE 'cancelled' END
      FROM due WHERE a.id = due.id
    RETURNING a.id, a.tenant_id, a.state
  )
  INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result)
  SELECT d.tenant_id, d.id, 'expire', d.state FROM done d;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- 9i. Staff unlock: cancel the active attempt so the order can be edited (the customer then opens a new attempt)
CREATE OR REPLACE FUNCTION public.max_attempt_cancel(_actor uuid, _tenant uuid, _order uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n integer;
BEGIN
  IF _actor IS NULL OR NOT (public.is_platform_admin(_actor) OR EXISTS (
       SELECT 1 FROM public.user_roles ur WHERE ur.tenant_id = _tenant AND ur.user_id = _actor
          AND ur.role = 'admin' AND NOT ur.is_blocked)) THEN
    RAISE EXCEPTION 'only a store admin can cancel a payment attempt' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM public.orders x WHERE x.id = _order AND x.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'no_data_found';
  END IF;
  -- a returned attempt is being verified: it is not cancelled (the payment may be real; it settles or goes to review)
  IF EXISTS (SELECT 1 FROM payments.tenant_attempts x
              WHERE x.tenant_id = _tenant AND x.order_id = _order AND x.state = 'returned') THEN
    RAISE EXCEPTION 'the payment of this order is being verified; try again in a few minutes'
      USING ERRCODE = 'check_violation';
  END IF;
  WITH done AS (
    UPDATE payments.tenant_attempts SET state = 'cancelled'
     WHERE order_id = _order AND tenant_id = _tenant AND state IN ('created', 'redirected')
    RETURNING id, tenant_id
  )
  INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result)
  SELECT d.tenant_id, d.id, 'cancel', 'staff' FROM done d;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- 9j. Review resolution (store owner or platform admin), with a note; field names only in the audit
CREATE OR REPLACE FUNCTION public.max_review_resolve(_actor uuid, _tenant uuid, _attempt uuid, _note text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _role text := payments.actor_role(_actor, _tenant);
BEGIN
  IF _role IS NULL THEN
    RAISE EXCEPTION 'only the store owner or the platform admin can resolve' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE payments.tenant_attempts
     SET review_resolved_at = now(), review_resolved_by = _actor,
         review_note = NULLIF(left(btrim(COALESCE(_note, '')), 500), '')
   WHERE id = _attempt AND tenant_id = _tenant AND review_resolved_at IS NULL
     AND (state = 'needs_review' OR review_reason IS NOT NULL);
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO payments.tenant_events (tenant_id, attempt_id, source, result) VALUES (_tenant, _attempt, 'review', 'resolved');
  INSERT INTO payments.tenant_config_audit (tenant_id, provider, actor_id, actor_role, action, changed_fields)
  VALUES (_tenant, 'max', _actor, _role, 'review_resolved', ARRAY['review']);
  RETURN true;
END $$;

-- 9k. Order payment status without secrets. The DB authorizes the viewer: the order's customer, the holder of the
--     guest token, staff of that store, or a platform admin; anyone else gets NULL.
CREATE OR REPLACE FUNCTION public.max_order_payment_status(_tenant uuid, _order uuid, _viewer uuid,
  _guest_token_sha256 text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'order_number', o.order_number, 'status', o.status, 'payment_method', o.payment_method,
    'payment_status', o.payment_status, 'payment_due_at', o.payment_due_at,
    'attempt', (SELECT jsonb_build_object('state', a.state, 'mode', a.mode, 'applied', a.applied,
                  'expires_at', a.expires_at, 'amount_minor', a.amount_minor, 'currency', a.currency,
                  'paid_at', a.paid_at, 'installments', a.installments, 'card_brand', a.card_brand,
                  'card_last4', a.card_last4, 'approval_code', a.approval_code)
                  FROM payments.tenant_attempts a WHERE a.tenant_id = o.tenant_id AND a.order_id = o.id
                 ORDER BY a.attempt_no DESC LIMIT 1))
    FROM public.orders o
   WHERE o.id = _order AND o.tenant_id = _tenant
     AND ((o.customer_id IS NOT NULL AND o.customer_id = _viewer)
          OR (o.customer_id IS NULL AND EXISTS (SELECT 1 FROM payments.tenant_order_access g
                                                 WHERE g.order_id = o.id AND g.token_sha256 = _guest_token_sha256))
          OR EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.tenant_id = o.tenant_id AND ur.user_id = _viewer AND ur.role IN ('admin', 'agent')
                        AND NOT ur.is_blocked)
          OR public.is_platform_admin(_viewer));
$$;

-- 9l. Terminal status for the store owner and the platform admin: last 2 digits of the terminal, has_* flags,
--     capabilities, the owner's installment settings. Never ciphertext.
CREATE OR REPLACE FUNCTION public.max_account_status(_actor uuid, _tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a payments.tenant_accounts;
  s payments.tenant_store_settings;
BEGIN
  IF payments.actor_role(_actor, _tenant) IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM payments.tenant_accounts x WHERE x.tenant_id = _tenant AND x.provider = 'max';
  SELECT * INTO s FROM payments.tenant_store_settings x WHERE x.tenant_id = _tenant AND x.provider = 'max';
  RETURN jsonb_build_object(
    'configured', a.id IS NOT NULL, 'active', public.max_payments_active(_tenant, _actor),
    'environment', payments.env(), 'enabled', COALESCE(a.enabled, false), 'mode', a.mode,
    'status', a.status, 'last_verified_at', a.last_verified_at,
    'terminal_hint', payments.terminal_hint(a.terminal_number),
    'has_api_key', a.api_key_enc IS NOT NULL, 'has_api_password', a.api_password_enc IS NOT NULL,
    'credentials_updated_at', a.credentials_updated_at,
    'terminal_max_installments', a.terminal_max_installments,
    'test_amount_cap_minor', CASE WHEN a.mode = 'test' THEN 5000 END,
    'verified_methods', to_jsonb(a.verified_methods), 'verified_brands', to_jsonb(a.verified_brands),
    'store', jsonb_build_object(
      'max_installments', COALESCE(s.max_installments, 1),
      'min_installments_amount_minor', COALESCE(s.min_installments_amount_minor, 0),
      'allowed_methods', to_jsonb(COALESCE(s.allowed_methods, ARRAY['card']::text[])),
      'allowed_brands', to_jsonb(COALESCE(s.allowed_brands, '{}'::text[]))),
    'updated_at', a.updated_at);
END $$;

-- 9m. Store owner (or platform admin): installments / minimum / methods / brands, bounded by the terminal. DEMO: one
--     payment only (M10).
CREATE OR REPLACE FUNCTION public.max_store_settings_save(_actor uuid, _tenant uuid, _max_installments integer,
  _min_installments_amount_minor bigint, _allowed_methods text[], _allowed_brands text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _role    text := payments.actor_role(_actor, _tenant);
  old      payments.tenant_store_settings;
  cur      payments.tenant_store_settings;
  _changed text[];
BEGIN
  IF _role IS NULL THEN
    RAISE EXCEPTION 'only the store owner sets the card-payment options' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payments.tenant_accounts x WHERE x.tenant_id = _tenant AND x.provider = 'max') THEN
    RAISE EXCEPTION 'online payments are not set up for this store' USING ERRCODE = 'no_data_found';
  END IF;
  IF payments.env() = 'demo' AND COALESCE(_max_installments, 1) <> 1 THEN
    RAISE EXCEPTION 'DEMO: card payments are one payment only (max installments 1)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO old FROM payments.tenant_store_settings x WHERE x.tenant_id = _tenant AND x.provider = 'max' FOR UPDATE;
  INSERT INTO payments.tenant_store_settings AS s (tenant_id, provider, max_installments,
         min_installments_amount_minor, allowed_methods, allowed_brands, updated_by)
  VALUES (_tenant, 'max', COALESCE(_max_installments, 1), COALESCE(_min_installments_amount_minor, 0),
          COALESCE(_allowed_methods, ARRAY['card']::text[]), COALESCE(_allowed_brands, '{}'::text[]), _actor)
  ON CONFLICT (tenant_id, provider) DO UPDATE
     SET max_installments = EXCLUDED.max_installments,
         min_installments_amount_minor = EXCLUDED.min_installments_amount_minor,
         allowed_methods = EXCLUDED.allowed_methods, allowed_brands = EXCLUDED.allowed_brands,
         updated_by = EXCLUDED.updated_by
  RETURNING * INTO cur;
  _changed := array_remove(ARRAY[
    CASE WHEN cur.max_installments IS DISTINCT FROM old.max_installments THEN 'max_installments' END,
    CASE WHEN cur.min_installments_amount_minor IS DISTINCT FROM old.min_installments_amount_minor
         THEN 'min_installments_amount_minor' END,
    CASE WHEN cur.allowed_methods IS DISTINCT FROM old.allowed_methods THEN 'allowed_methods' END,
    CASE WHEN cur.allowed_brands IS DISTINCT FROM old.allowed_brands THEN 'allowed_brands' END], NULL);
  IF cardinality(_changed) > 0 THEN
    INSERT INTO payments.tenant_config_audit (tenant_id, provider, actor_id, actor_role, action, changed_fields)
    VALUES (_tenant, 'max', _actor, _role, 'store_settings_changed', _changed);
  END IF;
  RETURN public.max_account_status(_actor, _tenant);
END $$;

-- 9n. Attempts of one store that went to the payment page (signed) and never came back, and are over (expired /
--     cancelled, or past their time): the reconciliation list against the Hyp portal (M9). Store owner or platform
--     admin. The reference is shown in full (it is the Order field in the portal).
CREATE OR REPLACE FUNCTION public.max_unreturned_attempts(_actor uuid, _tenant uuid, _limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF payments.actor_role(_actor, _tenant) IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'order_id', a.order_id, 'order_number', a.order_number, 'attempt_no', a.attempt_no,
             'reference', a.reference, 'amount_minor', a.amount_minor, 'currency', a.currency, 'mode', a.mode,
             'state', a.state, 'terminal_hint', payments.terminal_hint(a.terminal_number),
             'created_at', a.created_at, 'signed_at', a.signed_at, 'expires_at', a.expires_at)
           ORDER BY a.signed_at DESC)
      FROM (SELECT * FROM payments.tenant_attempts x
             WHERE x.tenant_id = _tenant AND x.signed_at IS NOT NULL AND x.returned_at IS NULL
               AND (x.state IN ('expired', 'cancelled') OR (x.state = 'redirected' AND x.expires_at < now()))
             ORDER BY x.signed_at DESC LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 500)) a), '[]'::jsonb);
END $$;

-- 9o. Platform admin: a STORE's terminal + credentials (write-only) + enable/disable + verified capabilities. Any change
--     of terminal, mode or credentials resets the status to unverified. While an attempt of that store is 'returned'
--     (VERIFY pending) such a change needs {"force": true}, and those attempts go to needs_review
--     ('credentials_changed'). Environment rule (ה-4) in payments.accounts_guard.
CREATE OR REPLACE FUNCTION public.platform_store_terminal_save(_actor uuid, _tenant uuid, _patch jsonb,
  _app_environment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _keys    constant text[] := ARRAY['mode', 'terminal_number', 'api_key_enc', 'api_password_enc', 'key_version',
                                    'enabled', 'terminal_max_installments', 'verified_methods', 'verified_brands',
                                    'clear_credentials', 'force'];
  _clear   boolean;
  _force   boolean;
  _created boolean;
  _new_tn  text;
  old      payments.tenant_accounts;
  cur      payments.tenant_accounts;
  _changed text[];
  _binding boolean;
BEGIN
  IF payments.actor_role(_actor, _tenant) IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'only the platform admin sets up a payment terminal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT payments.app_env_ok(_app_environment) THEN
    RAISE EXCEPTION 'online payment: application and database environments differ' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.site_type = 'ecommerce') THEN
    RAISE EXCEPTION 'store not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(_patch) k WHERE k <> ALL (_keys))
     OR (_patch ? 'verified_methods' AND jsonb_typeof(_patch -> 'verified_methods') <> 'array')
     OR (_patch ? 'verified_brands' AND jsonb_typeof(_patch -> 'verified_brands') <> 'array') THEN
    RAISE EXCEPTION 'online payment: invalid settings' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF payments.env() = 'demo' AND COALESCE((_patch ->> 'terminal_max_installments')::integer, 1) <> 1 THEN
    RAISE EXCEPTION 'DEMO: card payments are one payment only (max installments 1)' USING ERRCODE = 'check_violation';
  END IF;
  _clear := COALESCE((_patch ->> 'clear_credentials')::boolean, false);
  _force := COALESCE((_patch ->> 'force')::boolean, false);
  IF _clear AND (_patch ? 'api_key_enc' OR _patch ? 'api_password_enc') THEN
    RAISE EXCEPTION 'online payment: clear or replace the credentials, not both' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO payments.tenant_accounts (tenant_id, provider, mode, created_by, updated_by)
  VALUES (_tenant, 'max', CASE WHEN payments.env() = 'production' THEN 'live' ELSE 'test' END, _actor, _actor)
  ON CONFLICT (tenant_id, provider) DO NOTHING;
  _created := FOUND;
  SELECT * INTO old FROM payments.tenant_accounts x WHERE x.tenant_id = _tenant AND x.provider = 'max' FOR UPDATE;
  _new_tn := CASE WHEN _patch ? 'terminal_number' THEN NULLIF(btrim(_patch ->> 'terminal_number'), '')
                  ELSE old.terminal_number END;
  _binding := _clear OR _patch ? 'api_key_enc' OR _patch ? 'api_password_enc'
              OR _new_tn IS DISTINCT FROM old.terminal_number
              OR COALESCE(_patch ->> 'mode', old.mode) IS DISTINCT FROM old.mode;
  IF _binding AND EXISTS (SELECT 1 FROM payments.tenant_attempts x
                           WHERE x.tenant_id = _tenant AND x.state = 'returned') THEN
    IF NOT _force THEN
      RAISE EXCEPTION 'a payment of this store is being verified; save again with force to park it for review'
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE payments.tenant_attempts SET state = 'needs_review', review_reason = 'credentials_changed'
     WHERE tenant_id = _tenant AND state = 'returned';
  END IF;
  -- the registry binds the number to this store (raises if it belongs to the platform or another store)
  PERFORM payments.register_terminal('tenant', _tenant, 'max', _new_tn, _actor);

  UPDATE payments.tenant_accounts x SET
    mode = COALESCE(_patch ->> 'mode', x.mode),
    terminal_number = _new_tn,
    api_key_enc = CASE WHEN _clear THEN NULL ELSE COALESCE(_patch ->> 'api_key_enc', x.api_key_enc) END,
    api_password_enc = CASE WHEN _clear THEN NULL ELSE COALESCE(_patch ->> 'api_password_enc', x.api_password_enc) END,
    key_version = COALESCE((_patch ->> 'key_version')::smallint, x.key_version),
    credentials_updated_at = CASE WHEN _clear OR _patch ? 'api_key_enc' OR _patch ? 'api_password_enc'
                                  THEN now() ELSE x.credentials_updated_at END,
    credentials_updated_by = CASE WHEN _clear OR _patch ? 'api_key_enc' OR _patch ? 'api_password_enc'
                                  THEN _actor ELSE x.credentials_updated_by END,
    enabled = CASE WHEN _clear THEN false ELSE COALESCE((_patch ->> 'enabled')::boolean, x.enabled) END,
    terminal_max_installments = COALESCE((_patch ->> 'terminal_max_installments')::smallint, x.terminal_max_installments),
    verified_methods = CASE WHEN _patch ? 'verified_methods'
      THEN ARRAY(SELECT DISTINCT m FROM jsonb_array_elements_text(_patch -> 'verified_methods') m ORDER BY m)
      ELSE x.verified_methods END,
    verified_brands = CASE WHEN _patch ? 'verified_brands'
      THEN ARRAY(SELECT DISTINCT b FROM jsonb_array_elements_text(_patch -> 'verified_brands') b ORDER BY b)
      ELSE x.verified_brands END,
    updated_by = _actor
  WHERE x.tenant_id = _tenant AND x.provider = 'max'
  RETURNING * INTO cur;

  IF cur.terminal_number IS DISTINCT FROM old.terminal_number OR cur.mode IS DISTINCT FROM old.mode
     OR cur.api_key_enc IS DISTINCT FROM old.api_key_enc OR cur.api_password_enc IS DISTINCT FROM old.api_password_enc THEN
    UPDATE payments.tenant_accounts x
       SET status = 'unverified', last_verified_at = NULL, last_verify_code = NULL
     WHERE x.tenant_id = _tenant AND x.provider = 'max'
    RETURNING * INTO cur;
  END IF;

  -- the owner's choices shrink with what is verified for the terminal
  UPDATE payments.tenant_store_settings s
     SET allowed_methods = COALESCE(NULLIF(ARRAY(SELECT m FROM unnest(s.allowed_methods) m
                                                  WHERE m = ANY (cur.verified_methods)), '{}'::text[]),
                                    cur.verified_methods[1:1]),
         allowed_brands = ARRAY(SELECT b FROM unnest(s.allowed_brands) b WHERE b = ANY (cur.verified_brands)),
         max_installments = LEAST(s.max_installments, cur.terminal_max_installments),
         updated_by = _actor
   WHERE s.tenant_id = _tenant AND s.provider = 'max'
     AND (NOT s.allowed_methods <@ cur.verified_methods OR NOT s.allowed_brands <@ cur.verified_brands
          OR s.max_installments > cur.terminal_max_installments);
  IF FOUND THEN
    INSERT INTO payments.tenant_config_audit (tenant_id, provider, actor_id, actor_role, action, changed_fields)
    VALUES (_tenant, 'max', _actor, 'platform_admin', 'store_settings_clamped',
            ARRAY['allowed_methods', 'allowed_brands', 'max_installments']);
  END IF;

  _changed := array_remove(ARRAY[
    CASE WHEN cur.mode IS DISTINCT FROM old.mode THEN 'mode' END,
    CASE WHEN cur.terminal_number IS DISTINCT FROM old.terminal_number THEN 'terminal_number' END,
    CASE WHEN cur.api_key_enc IS DISTINCT FROM old.api_key_enc THEN 'api_key' END,
    CASE WHEN cur.api_password_enc IS DISTINCT FROM old.api_password_enc THEN 'api_password' END,
    CASE WHEN cur.key_version IS DISTINCT FROM old.key_version THEN 'key_version' END,
    CASE WHEN cur.status IS DISTINCT FROM old.status THEN 'status' END,
    CASE WHEN cur.terminal_max_installments IS DISTINCT FROM old.terminal_max_installments
         THEN 'terminal_max_installments' END,
    CASE WHEN cur.verified_methods IS DISTINCT FROM old.verified_methods THEN 'verified_methods' END,
    CASE WHEN cur.verified_brands IS DISTINCT FROM old.verified_brands THEN 'verified_brands' END], NULL);
  IF _created OR cardinality(_changed) > 0 THEN
    INSERT INTO payments.tenant_config_audit (tenant_id, provider, actor_id, actor_role, action, changed_fields)
    VALUES (_tenant, 'max', _actor, 'platform_admin',
            CASE WHEN _created THEN 'account_created'
                 WHEN _clear THEN 'credentials_cleared'
                 WHEN 'api_key' = ANY (_changed) OR 'api_password' = ANY (_changed) THEN 'credentials_replaced'
                 WHEN 'terminal_number' = ANY (_changed) THEN 'terminal_changed'
                 WHEN 'mode' = ANY (_changed) THEN 'mode_changed'
                 ELSE 'capabilities_changed' END,
            _changed);
  END IF;
  IF cur.enabled IS DISTINCT FROM old.enabled THEN
    INSERT INTO payments.tenant_config_audit (tenant_id, provider, actor_id, actor_role, action, changed_fields)
    VALUES (_tenant, 'max', _actor, 'platform_admin', CASE WHEN cur.enabled THEN 'enabled' ELSE 'disabled' END,
            ARRAY['enabled']);
  END IF;
  RETURN public.max_account_status(_actor, _tenant);
END $$;

-- 9p. Result of the free connection check (SIGN only, nothing charged), run by the server for the platform admin
CREATE OR REPLACE FUNCTION public.platform_store_terminal_verified(_actor uuid, _tenant uuid, _ok boolean, _code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF payments.actor_role(_actor, _tenant) IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'only the platform admin verifies a terminal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE payments.tenant_accounts x
     SET status = CASE WHEN _ok THEN 'verified' ELSE 'failed' END,
         last_verified_at = CASE WHEN _ok THEN now() ELSE x.last_verified_at END,
         last_verify_code = CASE WHEN _code ~ '^[0-9A-Za-z_-]{1,16}$' THEN _code END,
         updated_by = _actor
   WHERE x.tenant_id = _tenant AND x.provider = 'max'
     AND x.terminal_number IS NOT NULL AND x.api_key_enc IS NOT NULL AND x.api_password_enc IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the terminal is not fully configured' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO payments.tenant_config_audit (tenant_id, provider, actor_id, actor_role, action, changed_fields)
  VALUES (_tenant, 'max', _actor, 'platform_admin', CASE WHEN _ok THEN 'verified' ELSE 'verify_failed' END,
          ARRAY['status']);
  RETURN public.max_account_status(_actor, _tenant);
END $$;

-- 9q. Ciphertext for the platform admin's free connection check of a store terminal (no attempt row)
CREATE OR REPLACE FUNCTION public.platform_store_terminal_check_secrets(_actor uuid, _tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  acc payments.tenant_accounts;
BEGIN
  IF payments.actor_role(_actor, _tenant) IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'only the platform admin checks a terminal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO acc FROM payments.tenant_accounts x WHERE x.tenant_id = _tenant AND x.provider = 'max';
  IF NOT FOUND OR acc.terminal_number IS NULL OR acc.api_key_enc IS NULL OR acc.api_password_enc IS NULL THEN
    RAISE EXCEPTION 'the terminal is not fully configured' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('terminal_number', acc.terminal_number, 'mode', acc.mode, 'key_version', acc.key_version,
                            'api_key_enc', acc.api_key_enc, 'api_password_enc', acc.api_password_enc);
END $$;

-- 9r. Decision 14 (store scope): keep the sealed raw return of a payload recorded as received for that attempt (at
--     most 20 per attempt; first one wins), read it back while it is younger than its purge time.
CREATE OR REPLACE FUNCTION public.max_return_keep(_tenant uuid, _attempt uuid, _payload_sha256 text, _return_enc text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payments.tenant_events e
                  WHERE e.tenant_id = _tenant AND e.attempt_id = _attempt AND e.source = 'return'
                    AND e.payload_sha256 = _payload_sha256 AND e.result = 'received')
     OR (SELECT count(*) FROM payments.tenant_returns r WHERE r.attempt_id = _attempt) >= 20 THEN
    RETURN false;
  END IF;
  INSERT INTO payments.tenant_returns (tenant_id, attempt_id, payload_sha256, return_enc)
  VALUES (_tenant, _attempt, _payload_sha256, _return_enc) ON CONFLICT DO NOTHING;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.max_return_get(_tenant uuid, _attempt uuid, _payload_sha256 text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.return_enc FROM payments.tenant_returns r
   WHERE r.tenant_id = _tenant AND r.attempt_id = _attempt AND r.payload_sha256 = _payload_sha256
     AND r.purge_after > now();
$$;

-- ------------------------------------------------------------------------------------------------------------
-- §10. PLATFORM SCOPE API — NURIEL's terminal. Server-only except the two platform_card_my_* reads (§13).
--      These functions never read a tenant_* payments table, and the §9 functions never read a platform_* one.
--      Lock order: the billing.ledger charge row → payments.platform_attempts row.
-- ------------------------------------------------------------------------------------------------------------
-- 10a. Open (or reuse) an attempt for one open charge of the paying store. The payer is that store's owner (the
--      protected, unblocked admin); NURIEL's own staff (platform admins) never pay NURIEL's terminal (ה-8).
CREATE OR REPLACE FUNCTION public.platform_attempt_open(_actor uuid, _tenant uuid, _target_kind text, _target_id uuid,
  _return_origin text, _app_environment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t       public.tenants;
  acc     payments.platform_accounts;
  ch      billing.ledger;
  a       payments.platform_attempts;
  _amount bigint;
  _label  text;
  _bal    numeric;
  _n      integer;
  _tash   smallint;
  _origin text;
BEGIN
  IF NOT payments.app_env_ok(_app_environment) THEN
    RAISE EXCEPTION 'online payment: application and database environments differ' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT payments.store_owner(_actor, _tenant) OR public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'only the owner of the business pays NURIEL online' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO t FROM public.tenants x WHERE x.id = _tenant;
  IF t.id IS NULL OR t.site_type <> 'ecommerce' THEN
    -- DEMO scope: stores. Hospitality businesses share billing.ledger and can be added later without schema change.
    RAISE EXCEPTION 'online payment to NURIEL is not available for this business yet' USING ERRCODE = 'check_violation';
  END IF;
  IF _target_kind IS DISTINCT FROM 'ledger_charge' THEN
    RAISE EXCEPTION 'online payment: unknown payable item' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO ch FROM billing.ledger l WHERE l.id = _target_id AND l.tenant_id = _tenant FOR UPDATE;
  IF ch.id IS NULL OR ch.kind <> 'charge' OR ch.source = 'legacy_import'
     OR EXISTS (SELECT 1 FROM billing.ledger r WHERE r.reverses_id = ch.id) THEN
    RAISE EXCEPTION 'this charge cannot be paid online' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM payments.platform_attempts x
              WHERE x.target_kind = _target_kind AND x.target_id = _target_id AND x.applied) THEN
    RAISE EXCEPTION 'this item is already paid' USING ERRCODE = 'check_violation';
  END IF;
  _bal := payments.ledger_balance(_tenant, ch.category);
  IF _bal IS NULL OR _bal < ch.amount THEN
    RAISE EXCEPTION 'this charge is already covered' USING ERRCODE = 'check_violation';
  END IF;
  _amount := round(ch.amount * 100)::bigint;
  _label := left(COALESCE(NULLIF(ch.description, ''), format('חיוב #%s', ch.entry_no)), 200);
  IF _amount <= 0 OR _amount > 100000000 THEN
    RAISE EXCEPTION 'online payment: amount out of range' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT payments.flag('platform_terminal_payments') THEN
    RAISE EXCEPTION 'online payment to NURIEL is not available right now' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO acc FROM payments.platform_accounts x WHERE x.provider = 'max' FOR SHARE;
  IF acc.id IS NULL OR NOT acc.enabled OR acc.status <> 'verified' OR NOT payments.mode_allowed(acc.mode) THEN
    RAISE EXCEPTION 'online payment to NURIEL is not available right now' USING ERRCODE = 'check_violation';
  END IF;
  IF acc.mode = 'test' AND _amount > 5000 THEN
    RAISE EXCEPTION 'test payments are limited to 50 ILS' USING ERRCODE = 'check_violation';
  END IF;
  _origin := payments.store_origin(_tenant, _return_origin);

  SELECT * INTO a FROM payments.platform_attempts x
   WHERE x.target_kind = _target_kind AND x.target_id = _target_id AND x.state IN ('created', 'redirected', 'returned')
     FOR UPDATE;
  IF FOUND THEN
    IF a.state = 'returned' THEN
      RAISE EXCEPTION 'the payment of this item is being verified' USING ERRCODE = 'check_violation';
    END IF;
    IF a.payer_user_id = _actor AND a.expires_at > now() + interval '5 minutes' AND a.amount_minor = _amount
       AND a.terminal_number = acc.terminal_number AND a.mode = acc.mode
       AND a.return_origin IS NOT DISTINCT FROM _origin THEN
      RETURN jsonb_build_object('attempt_id', a.id, 'reference', a.reference, 'amount_minor', a.amount_minor,
        'currency', a.currency, 'terminal_number', a.terminal_number, 'mode', a.mode,
        'max_installments', a.max_installments, 'expires_at', a.expires_at, 'return_origin', a.return_origin,
        'reused', true);
    END IF;
    UPDATE payments.platform_attempts SET state = 'expired' WHERE id = a.id;
    INSERT INTO payments.platform_events (attempt_id, source, result) VALUES (a.id, 'open', 'superseded');
  END IF;
  SELECT count(*) INTO _n FROM payments.platform_attempts x WHERE x.target_kind = _target_kind AND x.target_id = _target_id;
  IF _n >= 5 THEN
    RAISE EXCEPTION 'too many payment attempts for this item' USING ERRCODE = 'check_violation';
  END IF;
  _tash := CASE WHEN acc.mode = 'test' THEN 1
                WHEN _amount >= acc.min_installments_amount_minor THEN acc.max_installments ELSE 1 END;
  INSERT INTO payments.platform_attempts (payer_tenant_id, payer_label, payer_engine, payer_user_id, target_kind,
         target_id, ledger_charge_id, target_label, return_origin, attempt_no, provider, mode, terminal_number,
         key_version, amount_minor, currency, max_installments, reference, expires_at)
  VALUES (_tenant, left(format('%s (%s)', t.name, t.slug), 200), t.site_type, _actor, _target_kind, _target_id,
          ch.id, _label, _origin, _n + 1, 'max', acc.mode, acc.terminal_number, acc.key_version, _amount, 'ILS',
          _tash, replace(gen_random_uuid()::text, '-', ''), now() + interval '30 minutes')
  RETURNING * INTO a;
  INSERT INTO payments.platform_events (attempt_id, source, result) VALUES (a.id, 'open', 'created');
  RETURN jsonb_build_object('attempt_id', a.id, 'reference', a.reference, 'amount_minor', a.amount_minor,
    'currency', a.currency, 'terminal_number', a.terminal_number, 'mode', a.mode,
    'max_installments', a.max_installments, 'expires_at', a.expires_at, 'return_origin', a.return_origin,
    'reused', false);
END $$;

-- 10b. Ciphertext of NURIEL's terminal for SIGN / VERIFY of one platform attempt (lease and counter as in 9d)
CREATE OR REPLACE FUNCTION public.platform_attempt_secrets(_attempt uuid, _purpose text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a   payments.platform_attempts;
  acc payments.platform_accounts;
BEGIN
  IF _purpose IS NULL OR _purpose NOT IN ('sign', 'verify') THEN
    RAISE EXCEPTION 'online payment: unknown purpose' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO a FROM payments.platform_attempts x WHERE x.id = _attempt FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'online payment: unknown attempt' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO acc FROM payments.platform_accounts x WHERE x.provider = a.provider;
  IF NOT FOUND OR acc.terminal_number IS DISTINCT FROM a.terminal_number OR acc.mode IS DISTINCT FROM a.mode
     OR acc.api_key_enc IS NULL OR acc.api_password_enc IS NULL THEN
    RAISE EXCEPTION 'online payment: the terminal of this attempt is no longer configured' USING ERRCODE = 'check_violation';
  END IF;
  IF _purpose = 'sign' THEN
    IF a.state NOT IN ('created', 'redirected') OR a.expires_at <= now() OR NOT payments.flag('platform_terminal_payments')
       OR NOT acc.enabled OR acc.status <> 'verified' OR NOT payments.mode_allowed(acc.mode) THEN
      RAISE EXCEPTION 'online payment: this attempt cannot be signed' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF a.returned_at IS NULL OR a.created_at < now() - interval '7 days' THEN
      RAISE EXCEPTION 'online payment: nothing to verify for this attempt' USING ERRCODE = 'check_violation';
    END IF;
    IF a.verify_lease_until IS NOT NULL AND a.verify_lease_until > now() THEN
      RETURN jsonb_build_object('result', 'busy', 'retry_after_seconds',
                                ceil(extract(epoch FROM a.verify_lease_until - now()))::int);
    END IF;
    IF a.verify_attempts >= 6 THEN
      IF a.state IN ('created', 'redirected', 'returned') THEN
        UPDATE payments.platform_attempts SET state = 'needs_review', review_reason = 'verify_exhausted' WHERE id = a.id;
        INSERT INTO payments.platform_events (attempt_id, source, result) VALUES (a.id, 'review', 'verify_exhausted');
      END IF;
      RETURN jsonb_build_object('result', 'exhausted');
    END IF;
    UPDATE payments.platform_attempts
       SET verify_lease_until = now() + interval '45 seconds', verify_attempts = verify_attempts + 1
     WHERE id = a.id;
  END IF;
  RETURN jsonb_build_object('result', 'ok', 'terminal_number', acc.terminal_number, 'mode', acc.mode,
                            'key_version', acc.key_version, 'api_key_enc', acc.api_key_enc,
                            'api_password_enc', acc.api_password_enc);
END $$;

-- 10c. SIGN result; credential errors switch NURIEL's terminal off (fail closed) with a system audit row
CREATE OR REPLACE FUNCTION public.platform_attempt_signed(_attempt uuid, _ok boolean, _code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a  payments.platform_attempts;
  _c text := CASE WHEN _code ~ '^[0-9]{1,4}$' THEN _code END;
BEGIN
  SELECT * INTO a FROM payments.platform_attempts x WHERE x.id = _attempt FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'online payment: unknown attempt' USING ERRCODE = 'no_data_found';
  END IF;
  IF a.state <> 'created' THEN
    RETURN jsonb_build_object('result', 'ignored', 'state', a.state);
  END IF;
  IF _ok THEN
    UPDATE payments.platform_attempts SET state = 'redirected', signed_at = now() WHERE id = a.id;
  ELSE
    UPDATE payments.platform_attempts SET state = 'failed', failure_code = _c WHERE id = a.id;
    IF _c IN ('901', '902') THEN
      UPDATE payments.platform_accounts x SET status = 'failed', last_verify_code = _c
       WHERE x.provider = 'max' AND x.terminal_number = a.terminal_number AND x.status <> 'failed';
      IF FOUND THEN
        INSERT INTO payments.platform_config_audit (provider, actor_id, actor_role, action, changed_fields)
        VALUES ('max', NULL, 'system', 'verify_failed', ARRAY['status']);
      END IF;
    END IF;
  END IF;
  INSERT INTO payments.platform_events (attempt_id, source, result, summary)
  VALUES (a.id, 'sign', CASE WHEN _ok THEN 'ok' ELSE 'error' END,
          payments.event_summary(_c, NULL, NULL, NULL, NULL, NULL, NULL));
  RETURN jsonb_build_object('result', CASE WHEN _ok THEN 'redirected' ELSE 'failed' END);
END $$;

-- 10d. Browser return on the platform host: record only, never pays. The server routes only the platform return path
--      here (the platform terminal's success URL is configured on NURIEL's own domain in the Hyp portal); a reference
--      of a store attempt is simply unknown in this table (the app then calls platform_payment_unknown_return).
CREATE OR REPLACE FUNCTION public.platform_attempt_record_return(_reference text, _payload_sha256 text, _ccode text,
  _txn_id text, _amount_minor bigint, _installments integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a  payments.platform_attempts;
  _n integer;
BEGIN
  IF _reference IS NULL OR _reference !~ '^[0-9a-f]{32}$' OR _payload_sha256 IS NULL
     OR _payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('result', 'malformed');
  END IF;
  SELECT * INTO a FROM payments.platform_attempts x WHERE x.reference = _reference FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'unknown');
  END IF;
  INSERT INTO payments.platform_events (attempt_id, source, payload_sha256, verification, result, summary)
  VALUES (a.id, 'return', _payload_sha256, 'pending', 'received',
          payments.event_summary(_ccode, NULL, _txn_id, _amount_minor, NULL, _installments, NULL))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF a.state IN ('created', 'redirected') THEN
    UPDATE payments.platform_attempts SET state = 'returned', returned_at = now() WHERE id = a.id;
  ELSIF a.returned_at IS NULL AND a.state IN ('failed', 'expired', 'cancelled') THEN
    UPDATE payments.platform_attempts SET returned_at = now() WHERE id = a.id;
  END IF;
  RETURN jsonb_build_object('result', CASE WHEN _n = 0 THEN 'replay' ELSE 'received' END, 'attempt_id', a.id,
    'payer_tenant_id', a.payer_tenant_id,
    'state', CASE WHEN a.state IN ('created', 'redirected') THEN 'returned' ELSE a.state END,
    'terminal_number', a.terminal_number, 'mode', a.mode, 'return_origin', a.return_origin);
END $$;

-- 10e. Settle after VERIFY — the ONLY path that records a card payment to NURIEL (anchor name). Applied payment: one
--      provider-confirmed 'payment' row in billing.ledger (payments.ledger_provider_payment). Nothing is activated or
--      renewed (ה-3). _return_flags as in 9g.
CREATE OR REPLACE FUNCTION public.platform_attempt_mark_paid(_reference text, _payload_sha256 text, _verify_ccode text,
  _ccode text, _terminal text, _txn_id text, _amount_minor bigint, _currency text, _installments integer,
  _approval_code text, _card_brand text, _card_last4 text, _return_flags text[], _app_environment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _flags   text[] := payments.clean_flags(_return_flags);
  _id      uuid;
  _target  uuid;
  a        payments.platform_attempts;
  ch       billing.ledger;
  _reason  text;
  _hold    boolean;
  _doc     boolean;
  _cname   text;
  _ledger  uuid;
  _summary jsonb;
BEGIN
  IF _reference IS NULL OR _reference !~ '^[0-9a-f]{32}$' OR _payload_sha256 IS NULL
     OR _payload_sha256 !~ '^[0-9a-f]{64}$' OR _flags IS NULL THEN
    RETURN jsonb_build_object('result', 'malformed');
  END IF;
  _summary := payments.event_summary(_ccode, _verify_ccode, _txn_id, _amount_minor, _currency, _installments,
                                     _approval_code, _flags);
  SELECT x.id, x.ledger_charge_id INTO _id, _target FROM payments.platform_attempts x WHERE x.reference = _reference;
  IF _id IS NULL THEN
    RETURN jsonb_build_object('result', 'unknown');
  END IF;
  SELECT * INTO ch FROM billing.ledger l WHERE l.id = _target FOR UPDATE;
  SELECT * INTO a FROM payments.platform_attempts x WHERE x.id = _id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM payments.platform_events e
                  WHERE e.attempt_id = a.id AND e.source IN ('return', 'notify')
                    AND e.payload_sha256 = _payload_sha256 AND e.result = 'received') THEN
    RETURN jsonb_build_object('result', 'unknown_payload');
  END IF;
  IF NOT payments.app_env_ok(_app_environment) THEN
    INSERT INTO payments.platform_events (attempt_id, source, payload_sha256, verification, result)
    VALUES (a.id, 'verify', _payload_sha256, 'error', 'env_mismatch');
    UPDATE payments.platform_attempts SET verify_lease_until = NULL WHERE id = a.id AND verify_lease_until IS NOT NULL;
    RETURN jsonb_build_object('result', 'environment_mismatch', 'attempt_id', a.id);
  END IF;
  INSERT INTO payments.platform_events (attempt_id, source, payload_sha256, verification, result, summary)
  VALUES (a.id, 'verify', _payload_sha256,
          CASE WHEN _verify_ccode = '0' THEN 'verified' WHEN _verify_ccode IS NULL THEN 'error' ELSE 'rejected' END,
          'checked', _summary);
  UPDATE payments.platform_attempts SET verify_lease_until = NULL WHERE id = a.id AND verify_lease_until IS NOT NULL;
  IF _verify_ccode IS DISTINCT FROM '0' THEN
    RETURN jsonb_build_object('result', 'unverified', 'attempt_id', a.id);
  END IF;
  IF _txn_id IS NULL OR _txn_id !~ '^[0-9A-Za-z-]{1,40}$' THEN
    RETURN jsonb_build_object('result', 'malformed', 'attempt_id', a.id);
  END IF;
  IF a.state = 'needs_review' THEN
    RETURN jsonb_build_object('result', 'needs_review', 'reason', a.review_reason, 'attempt_id', a.id,
                              'payer_tenant_id', a.payer_tenant_id, 'return_origin', a.return_origin);
  END IF;
  IF a.state IN ('paid', 'test_paid') THEN
    IF a.provider_txn_id = _txn_id OR _ccode IS DISTINCT FROM '0' THEN
      RETURN jsonb_build_object('result', 'already_paid', 'state', a.state, 'attempt_id', a.id,
                                'payer_tenant_id', a.payer_tenant_id, 'return_origin', a.return_origin);
    END IF;
    UPDATE payments.platform_attempts SET review_reason = 'duplicate_charge' WHERE id = a.id AND review_reason IS NULL;
    RETURN jsonb_build_object('result', 'duplicate_charge', 'attempt_id', a.id, 'payer_tenant_id', a.payer_tenant_id,
                              'return_origin', a.return_origin);
  END IF;
  _doc := 'document' = ANY (_flags);
  _hold := _ccode IN ('600', '700', '800') OR 'hk' = ANY (_flags) OR 'multi' = ANY (_flags);
  IF _ccode IS DISTINCT FROM '0' AND NOT _hold AND NOT _doc THEN
    IF a.state IN ('created', 'redirected', 'returned') THEN
      UPDATE payments.platform_attempts
         SET state = 'failed', verified_at = now(), verification = _summary, return_flags = _flags,
             failure_code = CASE WHEN _ccode ~ '^[0-9A-Za-z_-]{1,16}$' THEN _ccode END
       WHERE id = a.id;
    END IF;
    RETURN jsonb_build_object('result', 'not_paid', 'attempt_id', a.id, 'payer_tenant_id', a.payer_tenant_id,
                              'return_origin', a.return_origin);
  END IF;

  IF EXISTS (SELECT 1 FROM payments.platform_attempts x
              WHERE x.provider = a.provider AND x.terminal_number = a.terminal_number
                AND x.provider_txn_id = _txn_id AND x.id <> a.id) THEN
    _reason := 'duplicate_txn';
  ELSIF _doc THEN
    _reason := 'document_issued';
  ELSIF _hold THEN
    _reason := 'unexpected_hold';
  ELSIF _terminal IS DISTINCT FROM a.terminal_number THEN
    _reason := 'terminal_mismatch';
  ELSIF _currency IS DISTINCT FROM a.currency THEN
    _reason := 'currency_mismatch';
  ELSIF _amount_minor IS DISTINCT FROM a.amount_minor THEN
    _reason := 'amount_mismatch';
  ELSIF COALESCE(_installments, 1) NOT BETWEEN 1 AND a.max_installments THEN
    _reason := 'installments_exceeded';
  ELSIF NOT payments.mode_allowed(a.mode) THEN
    _reason := 'mode_not_allowed';
  ELSIF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = a.payer_tenant_id) THEN
    _reason := 'payer_gone';
  ELSIF EXISTS (SELECT 1 FROM payments.platform_attempts x
                 WHERE x.target_kind = a.target_kind AND x.target_id = a.target_id AND x.applied AND x.id <> a.id) THEN
    _reason := 'duplicate_charge';
  ELSIF ch.id IS NULL OR EXISTS (SELECT 1 FROM billing.ledger r WHERE r.reverses_id = ch.id) THEN
    _reason := 'target_changed';
  ELSIF COALESCE(payments.ledger_balance(a.payer_tenant_id, ch.category), 0) < ch.amount THEN
    -- paid meanwhile by another means (for example a bank transfer recorded by the platform admin): a refund case
    _reason := 'target_settled';
  END IF;

  IF _reason IS NOT NULL THEN
    BEGIN
      UPDATE payments.platform_attempts
         SET state = 'needs_review', review_reason = _reason, verified_at = now(), verification = _summary,
             return_flags = _flags,
             provider_txn_id = CASE WHEN _reason = 'duplicate_txn' THEN NULL ELSE _txn_id END,
             approval_code = CASE WHEN _approval_code ~ '^[0-9A-Za-z]{1,16}$' THEN _approval_code END
       WHERE id = a.id;
    EXCEPTION WHEN unique_violation THEN
      _reason := 'duplicate_txn';
      UPDATE payments.platform_attempts
         SET state = 'needs_review', review_reason = _reason, verified_at = now(), verification = _summary,
             return_flags = _flags
       WHERE id = a.id;
    END;
    INSERT INTO payments.platform_events (attempt_id, source, result) VALUES (a.id, 'review', _reason);
    RETURN jsonb_build_object('result', 'needs_review', 'reason', _reason, 'attempt_id', a.id,
                              'payer_tenant_id', a.payer_tenant_id, 'return_origin', a.return_origin);
  END IF;

  BEGIN
    _ledger := payments.ledger_provider_payment(ch, a, _txn_id);
    UPDATE payments.platform_attempts
       SET state = CASE WHEN a.mode = 'live' THEN 'paid' ELSE 'test_paid' END, applied = true,
           ledger_payment_id = _ledger, paid_at = now(), verified_at = now(), provider_txn_id = _txn_id,
           verification = _summary, return_flags = _flags, installments = GREATEST(COALESCE(_installments, 1), 1),
           approval_code = CASE WHEN _approval_code ~ '^[0-9A-Za-z]{1,16}$' THEN _approval_code END,
           card_brand = CASE WHEN _card_brand ~ '^[a-z_]{2,20}$' THEN _card_brand END,
           card_last4 = CASE WHEN _card_last4 ~ '^[0-9]{4}$' THEN _card_last4 END
     WHERE id = a.id;
  EXCEPTION WHEN unique_violation THEN
    -- the savepoint also undoes the ledger row written above
    GET STACKED DIAGNOSTICS _cname = CONSTRAINT_NAME;
    _reason := CASE WHEN _cname LIKE '%provider_txn%' THEN 'duplicate_txn' ELSE 'duplicate_charge' END;
    UPDATE payments.platform_attempts
       SET state = 'needs_review', review_reason = _reason, verified_at = now(), verification = _summary,
           return_flags = _flags
     WHERE id = a.id;
    INSERT INTO payments.platform_events (attempt_id, source, result) VALUES (a.id, 'review', _reason);
    RETURN jsonb_build_object('result', 'needs_review', 'reason', _reason, 'attempt_id', a.id,
                              'payer_tenant_id', a.payer_tenant_id, 'return_origin', a.return_origin);
  END;
  WITH done AS (
    UPDATE payments.platform_attempts SET state = 'cancelled'
     WHERE target_kind = a.target_kind AND target_id = a.target_id AND id <> a.id
       AND state IN ('created', 'redirected', 'returned')
    RETURNING id
  )
  INSERT INTO payments.platform_events (attempt_id, source, result) SELECT d.id, 'cancel', 'item_paid' FROM done d;
  RETURN jsonb_build_object('result', CASE WHEN a.mode = 'live' THEN 'paid' ELSE 'test_paid' END, 'applied', true,
                            'mode', a.mode, 'attempt_id', a.id, 'payer_tenant_id', a.payer_tenant_id,
                            'target_kind', a.target_kind, 'target_id', a.target_id, 'ledger_payment_id', _ledger,
                            'return_origin', a.return_origin);
END $$;

-- 10f. Expiry sweep for platform attempts (time-based; a charge that changed is caught at settle)
CREATE OR REPLACE FUNCTION public.platform_attempts_expire()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n integer;
BEGIN
  WITH due AS (
    SELECT a.id FROM payments.platform_attempts a
     WHERE a.state IN ('created', 'redirected', 'returned') AND a.expires_at < now()
     ORDER BY a.expires_at
     LIMIT 500
     FOR UPDATE OF a SKIP LOCKED
  ), done AS (
    UPDATE payments.platform_attempts a SET state = 'expired' FROM due WHERE a.id = due.id
    RETURNING a.id
  )
  INSERT INTO payments.platform_events (attempt_id, source, result) SELECT d.id, 'expire', 'expired' FROM done d;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- 10g. Review resolution of a platform payment (platform admin only)
CREATE OR REPLACE FUNCTION public.platform_card_payment_resolve(_actor uuid, _attempt uuid, _note text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'only the platform admin resolves NURIEL payments' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE payments.platform_attempts
     SET review_resolved_at = now(), review_resolved_by = _actor,
         review_note = NULLIF(left(btrim(COALESCE(_note, '')), 500), '')
   WHERE id = _attempt AND review_resolved_at IS NULL AND (state = 'needs_review' OR review_reason IS NOT NULL);
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO payments.platform_events (attempt_id, source, result) VALUES (_attempt, 'review', 'resolved');
  INSERT INTO payments.platform_config_audit (provider, actor_id, actor_role, action, changed_fields)
  VALUES ('max', _actor, 'platform_admin', 'review_resolved', ARRAY['review']);
  RETURN true;
END $$;

-- 10h. Platform admin list of payments to NURIEL (no secrets; last 2 digits of the terminal)
CREATE OR REPLACE FUNCTION public.platform_card_payments(_actor uuid, _tenant uuid DEFAULT NULL, _limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'only the platform admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'payer_tenant_id', a.payer_tenant_id, 'payer_label', a.payer_label,
             'target_kind', a.target_kind, 'target_id', a.target_id, 'target_label', a.target_label,
             'amount_minor', a.amount_minor, 'currency', a.currency, 'state', a.state, 'mode', a.mode,
             'applied', a.applied, 'installments', a.installments, 'card_brand', a.card_brand,
             'card_last4', a.card_last4, 'approval_code', a.approval_code, 'provider_txn_id', a.provider_txn_id,
             'terminal_hint', payments.terminal_hint(a.terminal_number), 'return_flags', to_jsonb(a.return_flags),
             'review_reason', a.review_reason, 'review_resolved_at', a.review_resolved_at,
             'ledger_payment_id', a.ledger_payment_id, 'created_at', a.created_at, 'paid_at', a.paid_at)
           ORDER BY a.created_at DESC)
      FROM (SELECT * FROM payments.platform_attempts x
             WHERE _tenant IS NULL OR x.payer_tenant_id = _tenant
             ORDER BY x.created_at DESC LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 500)) a), '[]'::jsonb);
END $$;

-- 10i. Platform attempts that went to the payment page and never came back (M9): the reconciliation list against the
--      platform terminal's portal. Platform admin only.
CREATE OR REPLACE FUNCTION public.platform_unreturned_attempts(_actor uuid, _limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'only the platform admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'payer_tenant_id', a.payer_tenant_id, 'payer_label', a.payer_label,
             'target_id', a.target_id, 'target_label', a.target_label, 'attempt_no', a.attempt_no,
             'reference', a.reference, 'amount_minor', a.amount_minor, 'currency', a.currency, 'mode', a.mode,
             'state', a.state, 'terminal_hint', payments.terminal_hint(a.terminal_number),
             'created_at', a.created_at, 'signed_at', a.signed_at, 'expires_at', a.expires_at)
           ORDER BY a.signed_at DESC)
      FROM (SELECT * FROM payments.platform_attempts x
             WHERE x.signed_at IS NOT NULL AND x.returned_at IS NULL
               AND (x.state IN ('expired', 'cancelled') OR (x.state = 'redirected' AND x.expires_at < now()))
             ORDER BY x.signed_at DESC LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 500)) a), '[]'::jsonb);
END $$;

-- 10j. The store owner's own payments to NURIEL — the user's own token and the store header, exactly like
--      my_billing_summary (billing.owner_tenant: the owner of the request's business only). No terminal, no provider
--      ids, no internal fields. (Renamed from my_billing_card_payments, finding H1.)
CREATE OR REPLACE FUNCTION public.platform_card_my_payments()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := billing.owner_tenant();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'target_kind', a.target_kind, 'target_id', a.target_id, 'target_label', a.target_label,
             'amount_minor', a.amount_minor, 'currency', a.currency,
             'state', CASE WHEN a.state IN ('created', 'redirected', 'returned') THEN 'in_progress' ELSE a.state END,
             'test', a.mode = 'test', 'installments', a.installments, 'card_brand', a.card_brand,
             'card_last4', a.card_last4, 'approval_code', a.approval_code, 'created_at', a.created_at,
             'paid_at', a.paid_at) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM payments.platform_attempts x WHERE x.payer_tenant_id = _t
             ORDER BY x.created_at DESC LIMIT 50) a), '[]'::jsonb);
END $$;

-- 10k. What the store owner can pay to NURIEL online right now (availability + the open charges). A separate function
--      on purpose: store_billing() and addons_store() must not gain a 'payments_ready' key (remove-hyp.test.sql).
--      (Renamed from my_billing_card_options, finding H1.)
CREATE OR REPLACE FUNCTION public.platform_card_my_options()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t     uuid := billing.owner_tenant();
  acc    payments.platform_accounts;
  _avail boolean;
BEGIN
  SELECT * INTO acc FROM payments.platform_accounts x WHERE x.provider = 'max';
  _avail := COALESCE(payments.flag('platform_terminal_payments') AND acc.id IS NOT NULL AND acc.enabled
                     AND acc.status = 'verified' AND payments.mode_allowed(acc.mode)
                     AND payments.store_owner(auth.uid(), _t) AND NOT public.is_platform_admin(auth.uid())
                     AND billing.engine_of(_t) = 'ecommerce', false);
  RETURN jsonb_build_object(
    'available', _avail, 'test', acc.mode = 'test', 'environment', payments.env(),
    'max_installments', CASE WHEN _avail THEN acc.max_installments ELSE 1 END,
    'min_installments_amount_minor', acc.min_installments_amount_minor,
    'test_amount_cap_minor', CASE WHEN acc.mode = 'test' THEN 5000 END,
    'charges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'no', l.entry_no, 'category', l.category, 'amount', l.amount,
               'amount_minor', round(l.amount * 100)::bigint, 'description', l.description,
               'occurred_on', l.occurred_on, 'period_start', l.period_start, 'period_end', l.period_end,
               'paid_online', EXISTS (SELECT 1 FROM payments.platform_attempts p
                                       WHERE p.target_kind = 'ledger_charge' AND p.target_id = l.id AND p.applied),
               'payable', _avail AND payments.ledger_balance(_t, l.category) >= l.amount
                          AND (acc.mode IS DISTINCT FROM 'test' OR round(l.amount * 100) <= 5000)
                          AND NOT EXISTS (SELECT 1 FROM payments.platform_attempts p
                                           WHERE p.target_kind = 'ledger_charge' AND p.target_id = l.id AND p.applied))
             ORDER BY l.occurred_on DESC, l.entry_no DESC)
        FROM (SELECT * FROM billing.ledger x
               WHERE x.tenant_id = _t AND x.kind = 'charge' AND x.source <> 'legacy_import'
                 AND NOT EXISTS (SELECT 1 FROM billing.ledger r WHERE r.reverses_id = x.id)
               ORDER BY x.occurred_on DESC, x.entry_no DESC LIMIT 20) l), '[]'::jsonb));
END $$;

-- 10l. Platform admin: NURIEL's own terminal (one per provider). Same rules as 9o, platform audit table. Requires a
--      step-up code the same platform admin consumed in the last 10 minutes (platform_stepup_consume) and not yet used
--      by a save: each consumed code authorizes exactly one save (M6). (Renamed from platform_billing_terminal_save.)
CREATE OR REPLACE FUNCTION public.platform_terminal_save(_actor uuid, _patch jsonb, _app_environment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _keys    constant text[] := ARRAY['mode', 'terminal_number', 'api_key_enc', 'api_password_enc', 'key_version',
                                    'enabled', 'terminal_max_installments', 'max_installments',
                                    'min_installments_amount_minor', 'clear_credentials', 'force'];
  _clear   boolean;
  _force   boolean;
  _created boolean;
  _new_tn  text;
  _binding boolean;
  _proof   uuid;
  old      payments.platform_accounts;
  cur      payments.platform_accounts;
  _changed text[];
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'only the platform admin sets up NURIEL''s terminal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT payments.app_env_ok(_app_environment) THEN
    RAISE EXCEPTION 'online payment: application and database environments differ' USING ERRCODE = 'check_violation';
  END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(_patch) k WHERE k <> ALL (_keys)) THEN
    RAISE EXCEPTION 'online payment: invalid settings' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF payments.env() = 'demo' AND (COALESCE((_patch ->> 'terminal_max_installments')::integer, 1) <> 1
                                  OR COALESCE((_patch ->> 'max_installments')::integer, 1) <> 1) THEN
    RAISE EXCEPTION 'DEMO: card payments are one payment only (max installments 1)' USING ERRCODE = 'check_violation';
  END IF;
  -- the step-up proof: a code this admin consumed within 10 minutes, not used by another save
  SELECT x.id INTO _proof FROM payments.platform_stepup_challenges x
   WHERE x.actor_id = _actor AND x.consumed_at IS NOT NULL AND x.spent_at IS NULL
     AND x.consumed_at > now() - interval '10 minutes'
   ORDER BY x.consumed_at DESC LIMIT 1 FOR UPDATE;
  IF _proof IS NULL THEN
    RAISE EXCEPTION 'confirm with the verification code sent by email first (step-up)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE payments.platform_stepup_challenges SET spent_at = now() WHERE id = _proof;
  _clear := COALESCE((_patch ->> 'clear_credentials')::boolean, false);
  _force := COALESCE((_patch ->> 'force')::boolean, false);
  IF _clear AND (_patch ? 'api_key_enc' OR _patch ? 'api_password_enc') THEN
    RAISE EXCEPTION 'online payment: clear or replace the credentials, not both' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO payments.platform_accounts (provider, mode, created_by, updated_by)
  VALUES ('max', CASE WHEN payments.env() = 'production' THEN 'live' ELSE 'test' END, _actor, _actor)
  ON CONFLICT (provider) DO NOTHING;
  _created := FOUND;
  SELECT * INTO old FROM payments.platform_accounts x WHERE x.provider = 'max' FOR UPDATE;
  _new_tn := CASE WHEN _patch ? 'terminal_number' THEN NULLIF(btrim(_patch ->> 'terminal_number'), '')
                  ELSE old.terminal_number END;
  _binding := _clear OR _patch ? 'api_key_enc' OR _patch ? 'api_password_enc'
              OR _new_tn IS DISTINCT FROM old.terminal_number
              OR COALESCE(_patch ->> 'mode', old.mode) IS DISTINCT FROM old.mode;
  IF _binding AND EXISTS (SELECT 1 FROM payments.platform_attempts x WHERE x.state = 'returned') THEN
    IF NOT _force THEN
      RAISE EXCEPTION 'a payment to NURIEL is being verified; save again with force to park it for review'
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE payments.platform_attempts SET state = 'needs_review', review_reason = 'credentials_changed'
     WHERE state = 'returned';
  END IF;
  PERFORM payments.register_terminal('platform', NULL, 'max', _new_tn, _actor);

  UPDATE payments.platform_accounts x SET
    mode = COALESCE(_patch ->> 'mode', x.mode),
    terminal_number = _new_tn,
    api_key_enc = CASE WHEN _clear THEN NULL ELSE COALESCE(_patch ->> 'api_key_enc', x.api_key_enc) END,
    api_password_enc = CASE WHEN _clear THEN NULL ELSE COALESCE(_patch ->> 'api_password_enc', x.api_password_enc) END,
    key_version = COALESCE((_patch ->> 'key_version')::smallint, x.key_version),
    credentials_updated_at = CASE WHEN _clear OR _patch ? 'api_key_enc' OR _patch ? 'api_password_enc'
                                  THEN now() ELSE x.credentials_updated_at END,
    credentials_updated_by = CASE WHEN _clear OR _patch ? 'api_key_enc' OR _patch ? 'api_password_enc'
                                  THEN _actor ELSE x.credentials_updated_by END,
    enabled = CASE WHEN _clear THEN false ELSE COALESCE((_patch ->> 'enabled')::boolean, x.enabled) END,
    terminal_max_installments = COALESCE((_patch ->> 'terminal_max_installments')::smallint, x.terminal_max_installments),
    max_installments = LEAST(COALESCE((_patch ->> 'max_installments')::smallint, x.max_installments),
                             COALESCE((_patch ->> 'terminal_max_installments')::smallint, x.terminal_max_installments)),
    min_installments_amount_minor = COALESCE((_patch ->> 'min_installments_amount_minor')::bigint,
                                             x.min_installments_amount_minor),
    updated_by = _actor
  WHERE x.provider = 'max'
  RETURNING * INTO cur;
  IF cur.terminal_number IS DISTINCT FROM old.terminal_number OR cur.mode IS DISTINCT FROM old.mode
     OR cur.api_key_enc IS DISTINCT FROM old.api_key_enc OR cur.api_password_enc IS DISTINCT FROM old.api_password_enc THEN
    UPDATE payments.platform_accounts x
       SET status = 'unverified', last_verified_at = NULL, last_verify_code = NULL
     WHERE x.provider = 'max'
    RETURNING * INTO cur;
  END IF;
  _changed := array_remove(ARRAY[
    CASE WHEN cur.mode IS DISTINCT FROM old.mode THEN 'mode' END,
    CASE WHEN cur.terminal_number IS DISTINCT FROM old.terminal_number THEN 'terminal_number' END,
    CASE WHEN cur.api_key_enc IS DISTINCT FROM old.api_key_enc THEN 'api_key' END,
    CASE WHEN cur.api_password_enc IS DISTINCT FROM old.api_password_enc THEN 'api_password' END,
    CASE WHEN cur.key_version IS DISTINCT FROM old.key_version THEN 'key_version' END,
    CASE WHEN cur.status IS DISTINCT FROM old.status THEN 'status' END,
    CASE WHEN cur.terminal_max_installments IS DISTINCT FROM old.terminal_max_installments
         THEN 'terminal_max_installments' END,
    CASE WHEN cur.max_installments IS DISTINCT FROM old.max_installments THEN 'max_installments' END,
    CASE WHEN cur.min_installments_amount_minor IS DISTINCT FROM old.min_installments_amount_minor
         THEN 'min_installments_amount_minor' END], NULL);
  IF _created OR cardinality(_changed) > 0 THEN
    INSERT INTO payments.platform_config_audit (provider, actor_id, actor_role, action, changed_fields)
    VALUES ('max', _actor, 'platform_admin',
            CASE WHEN _created THEN 'account_created'
                 WHEN _clear THEN 'credentials_cleared'
                 WHEN 'api_key' = ANY (_changed) OR 'api_password' = ANY (_changed) THEN 'credentials_replaced'
                 WHEN 'terminal_number' = ANY (_changed) THEN 'terminal_changed'
                 WHEN 'mode' = ANY (_changed) THEN 'mode_changed'
                 ELSE 'capabilities_changed' END,
            _changed);
  END IF;
  IF cur.enabled IS DISTINCT FROM old.enabled THEN
    INSERT INTO payments.platform_config_audit (provider, actor_id, actor_role, action, changed_fields)
    VALUES ('max', _actor, 'platform_admin', CASE WHEN cur.enabled THEN 'enabled' ELSE 'disabled' END, ARRAY['enabled']);
  END IF;
  RETURN public.platform_terminal_status(_actor);
END $$;

-- 10m. Status of NURIEL's terminal for the platform admin (never ciphertext). unknown_returns: the misconfiguration
--      alert's counts (L1). (Renamed from platform_billing_terminal_status.) Created before 10n/10o, which return it.
CREATE OR REPLACE FUNCTION public.platform_terminal_status(_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a payments.platform_accounts;
BEGIN
  IF NOT public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'only the platform admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM payments.platform_accounts x WHERE x.provider = 'max';
  RETURN jsonb_build_object(
    'configured', a.id IS NOT NULL, 'environment', payments.env(), 'flag', payments.flag('platform_terminal_payments'),
    'enabled', COALESCE(a.enabled, false), 'mode', a.mode, 'status', a.status,
    'last_verified_at', a.last_verified_at, 'terminal_hint', payments.terminal_hint(a.terminal_number),
    'has_api_key', a.api_key_enc IS NOT NULL, 'has_api_password', a.api_password_enc IS NOT NULL,
    'credentials_updated_at', a.credentials_updated_at, 'terminal_max_installments', a.terminal_max_installments,
    'max_installments', a.max_installments, 'min_installments_amount_minor', a.min_installments_amount_minor,
    'test_amount_cap_minor', CASE WHEN a.mode = 'test' THEN 5000 END, 'stepup_required', true,
    'unknown_returns', jsonb_build_object(
      'platform_24h', (SELECT count(*) FROM payments.unknown_returns u
                        WHERE u.scope = 'platform' AND u.received_at > now() - interval '24 hours'),
      'tenant_24h', (SELECT count(*) FROM payments.unknown_returns u
                      WHERE u.scope = 'tenant' AND u.received_at > now() - interval '24 hours'),
      'last_at', (SELECT max(u.received_at) FROM payments.unknown_returns u)),
    'updated_at', a.updated_at);
END $$;

-- 10n. Result of the free connection check of NURIEL's terminal (SIGN only, nothing charged)
CREATE OR REPLACE FUNCTION public.platform_terminal_verified(_actor uuid, _ok boolean, _code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'only the platform admin verifies NURIEL''s terminal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE payments.platform_accounts x
     SET status = CASE WHEN _ok THEN 'verified' ELSE 'failed' END,
         last_verified_at = CASE WHEN _ok THEN now() ELSE x.last_verified_at END,
         last_verify_code = CASE WHEN _code ~ '^[0-9A-Za-z_-]{1,16}$' THEN _code END,
         updated_by = _actor
   WHERE x.provider = 'max' AND x.terminal_number IS NOT NULL AND x.api_key_enc IS NOT NULL
     AND x.api_password_enc IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the terminal is not fully configured' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO payments.platform_config_audit (provider, actor_id, actor_role, action, changed_fields)
  VALUES ('max', _actor, 'platform_admin', CASE WHEN _ok THEN 'verified' ELSE 'verify_failed' END, ARRAY['status']);
  RETURN public.platform_terminal_status(_actor);
END $$;

-- 10o. Ciphertext of NURIEL's terminal for that free connection check (no attempt row)
CREATE OR REPLACE FUNCTION public.platform_terminal_check_secrets(_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  acc payments.platform_accounts;
BEGIN
  IF NOT public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'only the platform admin checks NURIEL''s terminal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO acc FROM payments.platform_accounts x WHERE x.provider = 'max';
  IF NOT FOUND OR acc.terminal_number IS NULL OR acc.api_key_enc IS NULL OR acc.api_password_enc IS NULL THEN
    RAISE EXCEPTION 'the terminal is not fully configured' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('terminal_number', acc.terminal_number, 'mode', acc.mode, 'key_version', acc.key_version,
                            'api_key_enc', acc.api_key_enc, 'api_password_enc', acc.api_password_enc);
END $$;

-- 10p. Decision 14 (platform scope): the sealed raw return, as 9r
CREATE OR REPLACE FUNCTION public.platform_return_keep(_attempt uuid, _payload_sha256 text, _return_enc text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payments.platform_events e
                  WHERE e.attempt_id = _attempt AND e.source = 'return' AND e.payload_sha256 = _payload_sha256
                    AND e.result = 'received')
     OR (SELECT count(*) FROM payments.platform_returns r WHERE r.attempt_id = _attempt) >= 20 THEN
    RETURN false;
  END IF;
  INSERT INTO payments.platform_returns (attempt_id, payload_sha256, return_enc)
  VALUES (_attempt, _payload_sha256, _return_enc) ON CONFLICT DO NOTHING;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.platform_return_get(_attempt uuid, _payload_sha256 text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.return_enc FROM payments.platform_returns r
   WHERE r.attempt_id = _attempt AND r.payload_sha256 = _payload_sha256 AND r.purge_after > now();
$$;

-- ------------------------------------------------------------------------------------------------------------
-- §11. Step-up (M6) and unknown returns (L1)
-- ------------------------------------------------------------------------------------------------------------
-- 11a. Issue a step-up challenge for a platform admin. The app generates the 6-digit code, emails it and passes only
--      HMAC(step-up key, code) and the purpose hash; the DB never sees the code. 10 minutes; a new challenge
--      supersedes the actor's open ones; at most 5 challenges per actor per 10 minutes.
CREATE OR REPLACE FUNCTION public.platform_stepup_issue(_actor uuid, _purpose_hash text, _code_hmac text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c payments.platform_stepup_challenges;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'only a platform admin can request a verification code' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _purpose_hash IS NULL OR _purpose_hash !~ '^[A-Za-z0-9_-]{32,128}$'
     OR _code_hmac IS NULL OR _code_hmac !~ '^[A-Za-z0-9_-]{32,128}$' THEN
    RAISE EXCEPTION 'step-up: malformed input' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- one issue at a time per actor (the count below must see the previous one)
  PERFORM pg_advisory_xact_lock(hashtextextended('payments.stepup:' || _actor::text, 0));
  IF (SELECT count(*) FROM payments.platform_stepup_challenges x
       WHERE x.actor_id = _actor AND x.created_at > now() - interval '10 minutes') >= 5 THEN
    RAISE EXCEPTION 'too many verification codes were requested; try again in a few minutes'
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE payments.platform_stepup_challenges SET superseded_at = now()
   WHERE actor_id = _actor AND consumed_at IS NULL AND superseded_at IS NULL;
  INSERT INTO payments.platform_stepup_challenges (actor_id, purpose_hash, code_hmac)
  VALUES (_actor, _purpose_hash, _code_hmac)
  RETURNING * INTO c;
  RETURN jsonb_build_object('challenge_id', c.id, 'expires_at', c.expires_at);
END $$;

-- 11b. Consume: {ok} or {ok: false, reason}. A wrong code or a different purpose counts a try; the 5th wrong try locks
--      the challenge. Single use: a consumed challenge never verifies again. Reasons: not_found, used, superseded,
--      expired, locked, purpose_mismatch, wrong_code.
CREATE OR REPLACE FUNCTION public.platform_stepup_consume(_actor uuid, _challenge uuid, _purpose_hash text,
  _code_hmac text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c      payments.platform_stepup_challenges;
  _tries smallint;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'only a platform admin can use a verification code' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM payments.platform_stepup_challenges x WHERE x.id = _challenge AND x.actor_id = _actor FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF c.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'used');
  END IF;
  IF c.superseded_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'superseded');
  END IF;
  IF c.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF c.tries >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked');
  END IF;
  IF _purpose_hash IS DISTINCT FROM c.purpose_hash OR _code_hmac IS DISTINCT FROM c.code_hmac THEN
    UPDATE payments.platform_stepup_challenges SET tries = tries + 1 WHERE id = c.id RETURNING tries INTO _tries;
    RETURN jsonb_build_object('ok', false, 'reason',
      CASE WHEN _tries >= 5 THEN 'locked'
           WHEN _purpose_hash IS DISTINCT FROM c.purpose_hash THEN 'purpose_mismatch'
           ELSE 'wrong_code' END);
  END IF;
  UPDATE payments.platform_stepup_challenges SET consumed_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 11c. A return that matched no attempt (L1): scope, host, payload hash, time — no personal data. true = recorded;
--      false = already recorded, malformed, or over the flood bound (200 per scope per hour; the alert needs counts).
CREATE OR REPLACE FUNCTION public.platform_payment_unknown_return(_scope text, _host text, _payload_sha256 text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _h text := lower(btrim(COALESCE(_host, '')));
  _n integer;
BEGIN
  IF _scope IS NULL OR _scope NOT IN ('platform', 'tenant')
     OR _payload_sha256 IS NULL OR _payload_sha256 !~ '^[0-9a-f]{64}$'
     OR _h !~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:[0-9]{1,5})?$' THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM payments.unknown_returns u
       WHERE u.scope = _scope AND u.received_at > now() - interval '1 hour') >= 200 THEN
    RETURN false;
  END IF;
  INSERT INTO payments.unknown_returns (scope, host, payload_sha256) VALUES (_scope, _h, _payload_sha256)
  ON CONFLICT (scope, payload_sha256) DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END $$;

-- 11d. Purge (both scopes; the 5-minute job and after every settle): raw returns past their 2-hour ceiling, whose VERIFY
--      concluded, or whose attempt exhausted VERIFY; unknown returns older than 30 days; step-up challenges older than
--      a day. Returns the number of raw returns removed.
CREATE OR REPLACE FUNCTION public.platform_payment_returns_purge()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _a integer;
  _b integer;
BEGIN
  DELETE FROM payments.tenant_returns r
   WHERE r.purge_after <= now()
      OR EXISTS (SELECT 1 FROM payments.tenant_events e WHERE e.attempt_id = r.attempt_id AND e.source = 'verify'
                   AND e.payload_sha256 = r.payload_sha256 AND e.verification IN ('verified', 'rejected'))
      OR EXISTS (SELECT 1 FROM payments.tenant_attempts a WHERE a.id = r.attempt_id AND a.verify_attempts >= 6);
  GET DIAGNOSTICS _a = ROW_COUNT;
  DELETE FROM payments.platform_returns r
   WHERE r.purge_after <= now()
      OR EXISTS (SELECT 1 FROM payments.platform_events e WHERE e.attempt_id = r.attempt_id AND e.source = 'verify'
                   AND e.payload_sha256 = r.payload_sha256 AND e.verification IN ('verified', 'rejected'))
      OR EXISTS (SELECT 1 FROM payments.platform_attempts a WHERE a.id = r.attempt_id AND a.verify_attempts >= 6);
  GET DIAGNOSTICS _b = ROW_COUNT;
  DELETE FROM payments.unknown_returns u WHERE u.received_at <= now() - interval '30 days';
  DELETE FROM payments.platform_stepup_challenges s WHERE s.created_at <= now() - interval '1 day';
  RETURN _a + _b;
END $$;

-- ------------------------------------------------------------------------------------------------------------
-- §12. (none — the decision-14 functions are in §9r / §10p / §11d)
-- §13. Function privileges. Every function in schema payments: owner only (PostgreSQL's built-in PUBLIC EXECUTE applies
--      in every schema; pg_default_acl adds anon / authenticated / service_role in public). The public API: service_role
--      only, except the owner's two reads (the user's own token, like my_billing_summary). A function that takes
--      _actor is never granted to authenticated (H1).
-- ------------------------------------------------------------------------------------------------------------
DO $priv$
DECLARE
  _f record;
BEGIN
  FOR _f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace = 'payments'::regnamespace LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', _f.sig);
  END LOOP;
  FOR _f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname IN (
                 -- tenant scope (store terminals)
                 'max_payments_active', 'max_order_access_issue', 'max_attempt_open', 'max_attempt_secrets',
                 'max_attempt_signed', 'max_attempt_record_return', 'max_attempt_mark_paid', 'max_attempts_expire',
                 'max_attempt_cancel', 'max_review_resolve', 'max_order_payment_status', 'max_account_status',
                 'max_store_settings_save', 'max_unreturned_attempts', 'max_return_keep', 'max_return_get',
                 'platform_store_terminal_save', 'platform_store_terminal_verified',
                 'platform_store_terminal_check_secrets',
                 -- platform scope (NURIEL's terminal)
                 'platform_attempt_open', 'platform_attempt_secrets', 'platform_attempt_signed',
                 'platform_attempt_record_return', 'platform_attempt_mark_paid', 'platform_attempts_expire',
                 'platform_card_payment_resolve', 'platform_card_payments', 'platform_unreturned_attempts',
                 'platform_terminal_save', 'platform_terminal_verified', 'platform_terminal_check_secrets',
                 'platform_terminal_status', 'platform_stepup_issue', 'platform_stepup_consume',
                 'platform_return_keep', 'platform_return_get',
                 -- both
                 'platform_payment_unknown_return', 'platform_payment_returns_purge') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', _f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _f.sig);
  END LOOP;
  FOR _f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname IN ('platform_card_my_payments', 'platform_card_my_options') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', _f.sig);
  END LOOP;
END $priv$;

-- ------------------------------------------------------------------------------------------------------------
-- §14. public.orders accepts 'online'. Bit and Grow clauses byte-for-byte as in 20261019520000:96-110 (old Grow orders
--      stay valid; credit_card stays, remove-hyp.test.sql). Small DEMO tables: a plain ADD (a future production run:
--      ADD … NOT VALID, then VALIDATE CONSTRAINT in a quiet window).
-- ------------------------------------------------------------------------------------------------------------
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_check CHECK (
    -- offline = תשלום טלפוני מול נציג | credit_card = ישן | bit = העברה בביט |
    -- grow = תשלום מקוון דרך Grow (אשראי / ביט / Apple Pay / Google Pay) | online = תשלום מקוון (MAX), הפרטים בניסיון התשלום
    payment_method IN ('offline', 'credit_card', 'bit', 'grow', 'online')
    AND payment_status IN ('not_required', 'awaiting', 'awaiting_verification', 'paid',
                           'expired', 'rejected')
    AND (payment_status <> 'paid' OR paid_at IS NOT NULL)
    AND (payment_method = 'bit' OR (bit_transaction_id IS NULL AND bit_receipt_url IS NULL))
    AND (bit_transaction_id IS NULL OR char_length(bit_transaction_id) BETWEEN 2 AND 64)
    AND (bit_receipt_url IS NULL OR char_length(bit_receipt_url) <= 300)
    AND (payment_method = 'grow' OR (grow_asmachta IS NULL AND grow_transaction_id IS NULL
                                     AND grow_card IS NULL AND grow_installments IS NULL))
    AND (grow_asmachta IS NULL OR char_length(grow_asmachta) <= 64)
    AND (grow_transaction_id IS NULL OR char_length(grow_transaction_id) <= 64)
    AND (grow_card IS NULL OR char_length(grow_card) <= 40));

-- Text patches of the LIVE definitions: each anchor occurs exactly once (checked on shop_test); a missing anchor fails
-- loudly; an already-patched definition is skipped (idempotent). The rollback removes the inserted text exactly and
-- fails loudly if it is not found.
DO $patch$
DECLARE
  _def   text;
  _fixed text;
BEGIN
  -- 14a. orders_default_payment: an 'online' branch before the phone-payment block (anchor = that block's first line;
  --      it is not Grow's and survives the Grow retirement). It sits after the staff early return: staff orders stay
  --      offline, so DEMO payments are made by ordinary customer accounts.
  SELECT pg_get_functiondef('public.orders_default_payment()'::regprocedure) INTO _def;
  IF position('max_payments_active' IN _def) = 0 THEN
    _fixed := replace(_def,
      '  -- "תשלום טלפוני מול נציג" — רק אם החנות מאפשרת',
      '  -- תשלום מקוון (MAX): ההזמנה נשמרת "ממתינה לתשלום" לפני המעבר לדף התשלום
  IF _requested = ''online'' THEN
    IF NOT public.max_payments_active(NEW.tenant_id, auth.uid()) THEN
      RAISE EXCEPTION ''התשלום המקוון בכרטיס אינו זמין כרגע בחנות — בחרו אמצעי תשלום אחר''
        USING ERRCODE = ''check_violation'';
    END IF;
    NEW.payment_method := ''online'';
    NEW.payment_status := ''awaiting'';
    NEW.payment_due_at := now() + interval ''2 hours'';
    RETURN NEW;
  END IF;

  -- "תשלום טלפוני מול נציג" — רק אם החנות מאפשרת');
    IF _fixed = _def THEN
      RAISE EXCEPTION 'online payments: orders_default_payment — the phone-payment anchor was not found';
    END IF;
    EXECUTE _fixed;
  END IF;

  -- 14b. place_order / place_guest_order: the request 'online' is passed on. Anchored on the Bit line, which
  --      remove-hyp.test.sql requires to stay; the Grow line is untouched and no longer an anchor.
  FOR _def IN
    SELECT pg_get_functiondef(f::regprocedure)
      FROM unnest(ARRAY['public.place_order(text, jsonb, numeric, boolean, jsonb)',
                        'public.place_guest_order(text, jsonb, jsonb)']) AS f
  LOOP
    CONTINUE WHEN position('= ''online''' IN _def) > 0;
    _fixed := replace(_def,
      $r$WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'$r$,
      $r$WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'
           WHEN _details ->> 'payment_method' = 'online' THEN 'online'$r$);
    IF _fixed = _def THEN
      RAISE EXCEPTION 'online payments: place_order / place_guest_order — the Bit mapping anchor was not found';
    END IF;
    EXECUTE _fixed;
  END LOOP;
END $patch$;

-- ------------------------------------------------------------------------------------------------------------
-- §15. Post-conditions inside the same transaction (a failure rolls everything back), then PostgREST reload.
-- ------------------------------------------------------------------------------------------------------------
DO $post$
DECLARE
  _api constant text[] := ARRAY[
    'max_payments_active', 'max_order_access_issue', 'max_attempt_open', 'max_attempt_secrets', 'max_attempt_signed',
    'max_attempt_record_return', 'max_attempt_mark_paid', 'max_attempts_expire', 'max_attempt_cancel',
    'max_review_resolve', 'max_order_payment_status', 'max_account_status', 'max_store_settings_save',
    'max_unreturned_attempts', 'max_return_keep', 'max_return_get', 'platform_store_terminal_save',
    'platform_store_terminal_verified', 'platform_store_terminal_check_secrets', 'platform_attempt_open',
    'platform_attempt_secrets', 'platform_attempt_signed', 'platform_attempt_record_return',
    'platform_attempt_mark_paid', 'platform_attempts_expire', 'platform_card_payment_resolve',
    'platform_card_payments', 'platform_unreturned_attempts', 'platform_card_my_payments',
    'platform_card_my_options', 'platform_terminal_save', 'platform_terminal_verified',
    'platform_terminal_check_secrets', 'platform_terminal_status', 'platform_stepup_issue',
    'platform_stepup_consume', 'platform_payment_unknown_return', 'platform_return_keep', 'platform_return_get',
    'platform_payment_returns_purge'];
  _bad text;
BEGIN
  -- the API: each function exactly once (no overload), SECURITY DEFINER with an empty search_path
  SELECT string_agg(n, ', ') INTO _bad FROM unnest(_api) n
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = n
             AND p.prosecdef AND 'search_path=""' = ANY (COALESCE(p.proconfig, '{}'::text[]))) <> 1;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'online payments post-check: API function missing, overloaded or not DEFINER with an empty search_path: %', _bad;
  END IF;
  -- grants: service_role on all; authenticated only on the two owner reads; anon on none; never authenticated on a
  -- function that takes _actor (H1)
  SELECT string_agg(p.proname, ', ') INTO _bad FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (_api)
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
             <> (p.proname IN ('platform_card_my_payments', 'platform_card_my_options'))
          OR ('_actor' = ANY (COALESCE(p.proargnames, '{}'::text[]))
              AND has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'online payments post-check: wrong grants on %', _bad;
  END IF;
  -- naming bans (contract §2): no new my_billing_* / platform_billing_* / hosp* name; no body matching the remove-hyp
  -- pattern; no payments_ready key — in the API, the patched functions and every payments.* function
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _bad FROM pg_proc p
   WHERE (p.pronamespace = 'payments'::regnamespace
          OR (p.pronamespace = 'public'::regnamespace
              AND (p.proname = ANY (_api) OR p.proname IN ('orders_default_payment', 'place_order', 'place_guest_order'))))
     AND (p.proname LIKE 'my\_billing\_%' OR p.proname LIKE 'platform\_billing\_%' OR p.proname LIKE 'hosp%'
          OR p.prosrc ~* '(hyp_|payment_intent|tenant_payment_secrets|platform_settings|card_payments_|card_clearing|platform_payments_|checkout_payment_request|payment_token)'
          OR p.prosrc LIKE '%payments\_ready%');
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'online payments post-check: a name or body matches an existing name-pattern assertion: %', _bad;
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND (p.proname LIKE 'my\_billing\_%' OR (p.proname LIKE 'platform\_billing\_%' AND p.proname <> 'platform_billing_history'))) <> 14 THEN
    RAISE EXCEPTION 'online payments post-check: the 14 my_billing_* / platform_billing_* functions changed';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.proname IN ('place_order', 'place_guest_order')
        AND p.pronamespace = 'public'::regnamespace
        AND pg_get_functiondef(p.oid) LIKE '%_details ->> ''payment_method'' = ''bit''%'
        AND pg_get_functiondef(p.oid) LIKE '%_details ->> ''payment_method'' = ''online''%') <> 2 THEN
    RAISE EXCEPTION 'online payments post-check: place_* mapping';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'payments'::regnamespace AND c.relkind IN ('r', 'p')
               AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'online payments post-check: a payments table without RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) r(role)
              WHERE c.relnamespace = 'payments'::regnamespace AND c.relkind IN ('r', 'p')
                AND (has_table_privilege(r.role, c.oid, 'SELECT') OR has_table_privilege(r.role, c.oid, 'INSERT')
                     OR has_table_privilege(r.role, c.oid, 'UPDATE') OR has_table_privilege(r.role, c.oid, 'DELETE')
                     OR has_table_privilege(r.role, c.oid, 'TRUNCATE')))
     OR EXISTS (SELECT 1 FROM pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) r(role)
                 WHERE c.relnamespace = 'payments'::regnamespace AND c.relkind = 'S'
                   AND (has_sequence_privilege(r.role, c.oid, 'USAGE') OR has_sequence_privilege(r.role, c.oid, 'SELECT')
                        OR has_sequence_privilege(r.role, c.oid, 'UPDATE')))
     OR has_schema_privilege('anon', 'payments', 'USAGE') OR has_schema_privilege('authenticated', 'payments', 'USAGE')
     OR has_schema_privilege('service_role', 'payments', 'USAGE') THEN
    RAISE EXCEPTION 'online payments post-check: an API role can reach a payments table';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'payments'::regnamespace
               AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'online payments post-check: an API role can execute an internal payments function';
  END IF;
  -- no Ecommerce guard trigger on a payments table (ecommerce-engine-guard.test.sql: relname without a schema filter)
  IF EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
              WHERE c.relnamespace = 'payments'::regnamespace
                AND tg.tgname IN ('ecommerce_rows_guard', 'ecommerce_row_move_guard')) THEN
    RAISE EXCEPTION 'online payments post-check: an Ecommerce guard trigger on a payments table';
  END IF;
END $post$;

NOTIFY pgrst, 'reload schema';
COMMIT;
