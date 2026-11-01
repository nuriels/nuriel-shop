-- Rollback of 20261103110000_hosp_channel_alerts.sql (D3: conflict emails, occupancy source on the board).
-- Drops the conflict trigger and its function, and restores _block_json of migration 14 exactly.
-- Conflict emails already in the outbox stay there (rows of the existing queue).
BEGIN;
DROP TRIGGER IF EXISTS channel_conflicts_notify ON hospitality.channel_calendars;
DROP FUNCTION IF EXISTS hospitality.channel_conflicts_notify();
CREATE OR REPLACE FUNCTION hospitality._block_json(k hospitality.blocks, _unit_name text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', k.id, 'unit_id', k.unit_id, 'unit_name', _unit_name, 'start_date', k.start_date,
                            'end_date', k.end_date, 'reason', k.reason);
$$;
COMMIT;
