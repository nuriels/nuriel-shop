-- ============================================================
-- Rollback: 20261101120000_hosp_booking.sql
-- מסיר את טבלאות 12–18, הטריגרים והפונקציות של מנוע ההזמנות, ומחזיר את
-- ההגדרות למצב של מיגרציה 3. נעצר אם יש הזמנות, אורחים, חסימות או מיילים
-- בתור (אין מחיקה שקטה של נתוני לקוחות). התוסף btree_gist נשאר (סטנדרטי, לא מזיק).
-- הסכמה hospitality וטבלאות 1–11 לא נוגעים בהן.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regclass('hospitality.bookings') IS NOT NULL AND (
       EXISTS (SELECT 1 FROM hospitality.bookings) OR EXISTS (SELECT 1 FROM hospitality.guests)
       OR EXISTS (SELECT 1 FROM hospitality.blocks) OR EXISTS (SELECT 1 FROM hospitality.notifications)) THEN
    RAISE EXCEPTION 'יש הזמנות / אורחים / חסימות / מיילים — גבו ומחקו אותם לפני rollback של מנוע ההזמנות';
  END IF;
END $$;

DROP TRIGGER IF EXISTS unit_members_occupancy_guard ON hospitality.unit_members;

-- הסדר חשוב: (1) פונקציות רגילות (חלקן משתמשות בסוג השורה של הטבלאות),
-- (2) הטבלאות (עם הטריגרים שלהן), (3) פונקציות הטריגר והנרמול (עמודות מחושבות).
CREATE TEMP TABLE hosp_1d_functions (name text, phase integer) ON COMMIT DROP;
INSERT INTO hosp_1d_functions VALUES
  ('apply_retention', 1), ('mark_notification', 1), ('claim_notifications', 1), ('confirm_payment', 1), ('expire_holds', 1),
  ('anonymize_guest', 1), ('export_guest', 1), ('_anonymize_guest', 1), ('set_stay_status', 1), ('decline_cancellation', 1),
  ('_finish_cancellation', 1), ('approve_cancellation', 1), ('cancel_booking', 1), ('modify_booking', 1),
  ('decline_booking', 1), ('approve_booking', 1), ('create_manual_booking', 1), ('_staff_booking', 1), ('_staff_tenant', 1),
  ('claim_guest_bookings', 1), ('my_bookings', 1), ('request_cancellation', 1), ('cancellation_quote', 1),
  ('get_booking_by_token', 1), ('request_booking', 1), ('quote', 1), ('_guest_booking', 1), ('_public_tenant', 1),
  ('_guest_view', 1), ('_cancellation_outcome', 1), ('_create_booking', 1), ('_quote', 1), ('_resolve_policy', 1),
  ('_price_nights', 1), ('_expire_due', 1), ('_enqueue', 1), ('_owner_emails', 1), ('_lock_inventory', 1), ('_set_actor', 1),
  ('_fanout_units', 1), ('_holding', 1), ('_header', 1), ('_hash', 1), ('_policy_rules', 1), ('_snapshot', 1), ('fee_at', 1),
  ('policy_schedule', 1), ('_fee_amount', 1), ('_ts', 1),
  ('unit_members_occupancy_guard', 3), ('blocks_before_update', 3), ('blocks_after_write', 3), ('booking_events_append_only', 3),
  ('bookings_consistency', 3), ('bookings_after_write', 3), ('bookings_before_write', 3), ('normalize_phone', 3),
  ('normalize_email', 3);

DO $$
DECLARE
  _f regprocedure;
BEGIN
  FOR _f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN hosp_1d_functions x ON x.name = p.proname AND x.phase = 1
             WHERE p.pronamespace = 'hospitality'::regnamespace LOOP
    EXECUTE format('DROP FUNCTION %s', _f);
  END LOOP;
END $$;

DROP TABLE IF EXISTS hospitality.unit_occupancy;
DROP TABLE IF EXISTS hospitality.notifications;
DROP TABLE IF EXISTS hospitality.booking_events;
DROP TABLE IF EXISTS hospitality.booking_nights;
DROP TABLE IF EXISTS hospitality.blocks;
DROP TABLE IF EXISTS hospitality.bookings;
DROP TABLE IF EXISTS hospitality.guests;

DO $$
DECLARE
  _f regprocedure;
BEGIN
  FOR _f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN hosp_1d_functions x ON x.name = p.proname AND x.phase = 3
             WHERE p.pronamespace = 'hospitality'::regnamespace LOOP
    EXECUTE format('DROP FUNCTION %s', _f);
  END LOOP;
END $$;

-- ההגדרות — כמו אחרי מיגרציה 3
ALTER TABLE hospitality.settings DROP COLUMN IF EXISTS last_booking_number;
UPDATE hospitality.settings SET guest_retention_months = 36 WHERE guest_retention_months IS NULL;
ALTER TABLE hospitality.settings ALTER COLUMN guest_retention_months SET DEFAULT 36;
ALTER TABLE hospitality.settings ALTER COLUMN guest_retention_months SET NOT NULL;
REVOKE UPDATE ON hospitality.settings FROM authenticated;
GRANT SELECT, UPDATE ON hospitality.settings TO authenticated;

COMMIT;
