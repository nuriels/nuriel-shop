-- ============================================================
-- billing_history → billing.ledger: דוח מיפוי בקריאה בלבד (DRY RUN). לא כותב, לא משנה ולא מוחק כלום.
--   • רץ בטרנזקציה READ ONLY ומסתיים ב-ROLLBACK — גם ניסיון כתיבה בטעות היה נכשל.
--   • מציג: מה יש היום, מה היה מועתק (ואיך כל שדה ממופה), מה לא היה מועתק ולמה, וסכומים לכל עסק.
--   • ההעתקה עצמה היא שלב נפרד שדורש אישור מפורש (docs/billing/billing-history-mapping.md).
-- שימוש (מקומי / בשרת, רק באישור): psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/billing/legacy-mapping-dry-run.sql
-- ============================================================
\pset pager off
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';

\echo '== 0. preconditions: the new layer exists, nothing was copied yet, no agreements were filled in'
SELECT to_regnamespace('billing') IS NOT NULL AS billing_schema_exists,
       (SELECT count(*) FROM billing.ledger WHERE source = 'legacy_import') AS already_copied_rows,
       (SELECT count(*) FROM billing.agreements) AS agreements_total;

\echo '== 1. what billing_history holds today (by kind / payment status / method)'
SELECT kind, payment_status, COALESCE(payment_method, '—') AS method, count(*) AS rows,
       sum(amount) AS amount_total, min(created_at)::date AS first, max(created_at)::date AS last
  FROM public.billing_history
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '== 2. businesses: live / deleted (store_label), engine'
SELECT CASE WHEN t.id IS NULL THEN 'deleted business' ELSE t.site_type END AS business, count(DISTINCT h.tenant_id) AS businesses,
       count(*) AS rows
  FROM public.billing_history h LEFT JOIN public.tenants t ON t.id = h.tenant_id
 GROUP BY 1 ORDER BY 1;

\echo '== 3. the mapping, row by row (what WOULD be written — nothing is written)'
WITH m AS (
  SELECT h.id AS legacy_ref, h.tenant_id,
         COALESCE(h.store_label, left(format('%s (%s)', t.name, t.slug), 200), h.tenant_id::text) AS tenant_label,
         'ecommerce' AS engine,
         CASE
           WHEN h.kind IN ('trial_extension', 'plan_change') THEN NULL               -- no money: not copied
           WHEN h.amount <= 0 THEN NULL                                              -- zero amount: not copied
           WHEN h.payment_status = 'paid' THEN 'payment'
           WHEN h.payment_status = 'due' THEN 'charge'
         END AS kind,
         CASE WHEN h.kind = 'addon' THEN 'other' ELSE 'subscription' END AS category,
         h.amount,
         0::numeric AS vat_rate,                                                     -- unknown then: stored as 0, not guessed
         COALESCE(h.paid_at, h.created_at)::date AS occurred_on,
         h.period_start::date AS period_start, h.period_end::date AS period_end,
         -- the old "method" was the payment plan (annual / installments / monthly), not the instrument
         CASE WHEN h.payment_method = 'credit_card' THEN 'credit_card' WHEN h.payment_status = 'paid' THEN 'other' END AS method,
         left(concat_ws(' · ', 'מההיסטוריה הקודמת',
                        CASE h.kind WHEN 'addon' THEN 'תוסף ' || h.addon_name ELSE 'מנוי ' || h.plan_type END,
                        CASE WHEN h.months IS NOT NULL THEN h.months || ' חודשים' END), 200) AS description,
         h.reference,
         left(concat_ws(' · ', h.note, 'שיטה ישנה: ' || h.payment_method, 'נרשם על ידי: ' || h.recorded_by_email), 500) AS internal_note,
         'manual' AS confirmation,                                                   -- never "provider"
         'legacy_import' AS source,
         h.kind AS old_kind, h.payment_status AS old_status, h.created_at,
         EXISTS (SELECT 1 FROM billing.ledger l WHERE l.legacy_ref = h.id) AS already_copied
    FROM public.billing_history h LEFT JOIN public.tenants t ON t.id = h.tenant_id
)
SELECT legacy_ref, tenant_label, old_kind, old_status, amount, kind AS new_kind, category, occurred_on, method,
       description, confirmation, source, already_copied
  FROM m ORDER BY created_at;

\echo '== 4. rows that would NOT be copied, and why (they stay in billing_history as they are)'
SELECT h.id, h.kind, h.payment_status, h.amount,
       CASE WHEN h.kind IN ('trial_extension', 'plan_change') THEN 'not money (extension / plan change) — stays in the old history'
            WHEN h.amount <= 0 THEN 'zero amount — nothing to record' END AS reason
  FROM public.billing_history h
 WHERE h.kind IN ('trial_extension', 'plan_change') OR h.amount <= 0
 ORDER BY h.created_at;

\echo '== 5. per business: what the new summary would show after the copy ("total paid" only — not netted against new charges)'
SELECT COALESCE(h.store_label, t.name || ' (' || t.slug || ')') AS business,
       count(*) FILTER (WHERE h.payment_status = 'paid' AND h.amount > 0 AND h.kind NOT IN ('trial_extension', 'plan_change')) AS payments,
       sum(h.amount) FILTER (WHERE h.payment_status = 'paid' AND h.amount > 0 AND h.kind NOT IN ('trial_extension', 'plan_change')) AS paid_total,
       count(*) FILTER (WHERE h.payment_status = 'due' AND h.amount > 0) AS open_charges,
       sum(h.amount) FILTER (WHERE h.payment_status = 'due' AND h.amount > 0) AS open_total
  FROM public.billing_history h LEFT JOIN public.tenants t ON t.id = h.tenant_id
 GROUP BY 1 ORDER BY 1;

\echo '== 6. Hospitality: there is no payment history to copy (nothing is invented)'
SELECT count(*) AS hospitality_rows_in_billing_history
  FROM public.billing_history h JOIN public.tenants t ON t.id = h.tenant_id WHERE t.site_type = 'hospitality';

\echo '== 7. existing customers without an agreement (shown "by the price list"; none is filled in automatically)'
SELECT t.site_type, count(*) AS businesses_without_agreement
  FROM public.tenants t
 WHERE NOT t.is_default AND NOT EXISTS (SELECT 1 FROM billing.agreements a WHERE a.tenant_id = t.id)
 GROUP BY 1 ORDER BY 1;

ROLLBACK;
\echo '== dry run finished: nothing was written'
