// ============================================================
// Database classification (Hospitality Stage 1a, plan B4): which engine owns every
// table and function in the `public` schema. Regenerates:
//   docs/architecture/db-classification.md          (human-readable)
//   scripts/db-tests/db-classification.test.sql     (coverage test: a new public
//                                                    table/function must be classified)
// Usage (after scripts/db-tests/run.sh, local Postgres 16):
//   node scripts/db-classification.mjs
// The lists below are the source of truth; review them when adding objects.
// ============================================================
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const PSQL = [
  "-X",
  "-tA",
  "-h",
  "/tmp/pg",
  "-p",
  process.env.PGPORT ?? "5499",
  "-U",
  "postgres",
  "-d",
  "shop_test",
];
const q = (sql) =>
  execFileSync("psql", [...PSQL, "-c", sql], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);

// ---------- tables ----------
const TABLES = {
  ecommerce: `abandoned_carts cancellation_requests cart_promotions categories coupon_email_sends coupons
    customer_carts customer_emails customer_invites customer_profiles global_products grow_payment_processes
    home_banner_slides location_transfer_lines location_transfers order_courier_links order_delivery_events
    order_items order_number_counters orders pages pending_products picking_events price_tier_backup
    product_categories product_drafts product_locations product_relations product_reviews product_serials
    product_stickers product_variants service_agreements shared_carts shipping_methods stock_count_lines
    stock_counts tenant_addons tenant_subscriptions user_custom_prices`,
  platform: `tenants user_roles site_settings email_settings tenant_email_secrets login_codes
    password_reset_requests password_reset_tokens staff_notifications contact_messages support_tickets
    support_messages marketing_consents marketing_consent_events notification_logs tenant_ssl
    tenant_billing_profile billing_history upgrade_requests tenant_grow_credentials
    platform_product_roles platform_feature_flags tenant_feature_flags`,
  "platform-admin": `platform_addons platform_admin_handoffs platform_admins platform_agreement_acceptances
    platform_agreement_versions platform_audit_log platform_documents platform_email_log platform_plans
    platform_pricing_settings`,
};

// ---------- functions: explicit platform / shared-utility lists; everything else is Ecommerce ----------
const PLATFORM_FUNCTIONS = new RegExp(
  "^(" +
    [
      "platform_.*",
      "portal_.*",
      "tenants_.*",
      "tenant_for_host",
      "tenant_slug_problem",
      "tenant_is_active",
      "tenant_member_id",
      "current_tenant_id",
      "current_site_type",
      "is_platform_admin",
      "is_super_admin",
      "primary_platform_admin",
      "issue_login_code",
      "consume_login_code",
      "email_has_other_account",
      "google_login_no_duplicate_accounts",
      "resolve_login_email",
      "my_stores",
      "my_store_role",
      "store_link_existing_account",
      "user_roles_membership_guard",
      "user_roles_owner_guard",
      "user_roles_product_role_guard",
      "guard_protected_admin_.*",
      "custom_domain_.*",
      "ssl_agent_.*",
      "support_.*",
      "marketing_.*",
      "storage_path_in_current_tenant",
      "staff_display_names?",
      "site_inbox_.*",
      "contact_message_submit",
      "legal_.*",
      "store_legal_identity",
      "upgrade_request_.*",
      "billing_profile_json",
      "tenant_billing_profile_normalize",
      "enforce_plan_custom_domain",
      "site_settings_custom_domain_sync",
      "site_settings_legal_defaults",
    ].join("|") +
    ")$",
);
const SHARED_UTILITIES = new RegExp(
  "^(update_updated_at_column|uuid_or_null|normalize_phone|normalize_user_email|israeli_id_valid|" +
    "default_username_from_email|assign_default_username|normalize_seo_keywords)$",
);

const tables = q(
  "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1",
);
const functions = q(
  `select distinct proname from pg_proc p where pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1`,
);

const tableOwner = new Map();
for (const [owner, list] of Object.entries(TABLES))
  for (const t of list.split(/\s+/).filter(Boolean)) tableOwner.set(t, owner);
const unclassifiedTables = tables.filter((t) => !tableOwner.has(t));
if (unclassifiedTables.length) {
  console.error(`unclassified tables: ${unclassifiedTables.join(", ")} — add them to TABLES`);
  process.exit(1);
}
const fnOwner = (name) =>
  PLATFORM_FUNCTIONS.test(name)
    ? "platform"
    : SHARED_UTILITIES.test(name)
      ? "shared-utility"
      : "ecommerce";

// ---------- markdown ----------
const group = (entries) => {
  const by = {};
  for (const [name, owner] of entries) (by[owner] ??= []).push(name);
  return by;
};
const tableGroups = group(tables.map((t) => [t, tableOwner.get(t)]));
const fnGroups = group(functions.map((f) => [f, fnOwner(f)]));
const list = (names) => names.map((n) => `\`${n}\``).join(", ");
let md = `# Database classification (public schema)

Generated by \`node scripts/db-classification.mjs\` from a database built from all migrations.
Owner of every table and function in \`public\`: **ecommerce** (Ecommerce engine),
**platform** (shared infrastructure), **platform-admin** (platform panel),
**shared-utility** (generic helpers). The Hospitality engine lives in its own schema
\`hospitality\` and is not listed here.

\`scripts/db-tests/db-classification.test.sql\` fails when a public table or function is not
in these lists — every new object must be classified consciously (update the generator).

Function classification is explicit for platform and shared utilities; everything else is
Ecommerce by default (today's behaviour). It is reviewed whenever a function is moved to
the platform.

## Tables (${tables.length})
`;
for (const owner of ["ecommerce", "platform", "platform-admin"]) {
  md += `\n### ${owner} (${tableGroups[owner]?.length ?? 0})\n\n${list(tableGroups[owner] ?? [])}\n`;
}
md += `\n## Functions (${functions.length})\n`;
for (const owner of ["platform", "shared-utility", "ecommerce"]) {
  md += `\n### ${owner} (${fnGroups[owner]?.length ?? 0})\n\n${list(fnGroups[owner] ?? [])}\n`;
}
writeFileSync(new URL("../docs/architecture/db-classification.md", import.meta.url), md);

// ---------- coverage test ----------
const arr = (names) => `ARRAY[${names.map((n) => `'${n}'`).join(",")}]::text[]`;
const sql = `-- ============================================================
-- Coverage: every public table and function is classified (docs/architecture/db-classification.md)
-- Generated by scripts/db-classification.mjs — regenerate after adding objects.
-- ============================================================
SELECT tests.check('db classification: every public table is classified',
  $$SELECT NOT EXISTS (
      SELECT 1 FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND c.relname <> ALL (${arr(tables)}))$$);
SELECT tests.check('db classification: every public function is classified',
  $$SELECT NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
         AND p.proname <> ALL (${arr(functions)}))$$);
`;
writeFileSync(new URL("./db-tests/db-classification.test.sql", import.meta.url), sql);
console.log(`classified ${tables.length} tables and ${functions.length} functions`);
