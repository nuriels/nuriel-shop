-- ============================================================
-- Rollback: 20261123100000_hosp_unit_delete_safe.sql — safe unit delete (migration 205)
--   • no guard needed: only functions change, no table and no data. Units deleted while 205 was applied stay
--     deleted (as with any delete); packages keep the add-on rooms list they have now.
--   • drops unit_delete_preview and the shared block helper; unit_delete goes back to migration 10 word for word
--     (RETURNS boolean, so DROP + CREATE).
--   • afterwards the schema is identical to the one before the migration (scripts/db-tests/rollback-check.sh).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS hospitality.unit_delete_preview(uuid);
DROP FUNCTION IF EXISTS hospitality.unit_delete(uuid);
DROP FUNCTION IF EXISTS hospitality._unit_delete_block(uuid, uuid);

-- migration 10 (20261101180000_hosp_catalog.sql), word for word
CREATE OR REPLACE FUNCTION hospitality.unit_delete(_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant('למחוק יחידה');
  u hospitality.units;
BEGIN
  PERFORM hospitality._inventory_lock(_t);
  BEGIN
    SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'היחידה בשימוש ממש עכשיו (הזמנה או חסימה נכתבת) — נסו שוב בעוד רגע' USING ERRCODE = 'lock_not_available';
  END;
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF hospitality._unit_has_history(_t, _id) THEN
    RAISE EXCEPTION 'ליחידה יש הזמנות או חסימות — אפשר להשבית אותה במקום למחוק' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.unit_members m WHERE m.tenant_id = _t AND m.member_unit_id = _id) THEN
    RAISE EXCEPTION 'היחידה כלולה ב"כל המתחם" — יש להסיר אותה משם קודם' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _id;
  PERFORM hospitality._audit(_t, 'catalog.unit_deleted', u.name, '{}'::jsonb);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_delete(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
