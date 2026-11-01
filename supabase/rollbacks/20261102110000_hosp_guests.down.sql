-- Rollback of 20261102110000_hosp_guests.sql (Stage 2j — guests and privacy).
-- Drops the new functions, restores anonymize_guest without the log entry and the direct
-- export_guest grant. Guest notes saved meanwhile stay (the column existed before).
BEGIN;
DROP FUNCTION IF EXISTS hospitality.export_guest_logged(uuid);
DROP FUNCTION IF EXISTS hospitality.update_guest_notes(uuid, text);
DROP FUNCTION IF EXISTS hospitality.staff_guest_detail(uuid);
DROP FUNCTION IF EXISTS hospitality.staff_guests(text, integer, integer);
GRANT EXECUTE ON FUNCTION hospitality.export_guest(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION hospitality.anonymize_guest(_guest_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('guests.privacy');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _guest_id) THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._anonymize_guest(_t, _guest_id);
  RETURN true;
END $$;
COMMIT;
