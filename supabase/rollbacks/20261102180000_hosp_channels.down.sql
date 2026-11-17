-- Rollback of 20261102180000_hosp_channels.sql (iCal channel sync).
-- Drops the channel functions, the two tables and the channel columns on blocks. Blocks created by
-- a sync stay as ordinary blocks (the owner can release them on the board).
BEGIN;

-- הגנת נתונים (ביקורת R-3): ה-rollback לא מוחק נתוני לקוחות בשקט. אם יש שורות — נעצר; ייצאו / גבו והחליטו
DO $$
DECLARE
  _n bigint;
  _t text;
  _w text;
  _what text;
BEGIN
  FOR _t, _w, _what IN VALUES
      ('hospitality.channel_calendars', 'true', 'יומני ערוצים מחוברים'),
      ('hospitality.channel_feeds', 'true', 'קישורי ייצוא יומן'),
      ('hospitality.blocks', 'channel_calendar_id IS NOT NULL OR external_uid IS NOT NULL', 'חסימות שיובאו מיומני ערוצים')
  LOOP
    IF to_regclass(_t) IS NOT NULL THEN
      BEGIN
        EXECUTE format('SELECT count(*) FROM %s WHERE %s', _t, _w) INTO _n;
      EXCEPTION WHEN undefined_column THEN
        _n := 0; -- העמודה כבר הוסרה (rollback חלקי קודם)
      END;
      IF _n > 0 THEN
        RAISE EXCEPTION 'יש % שורות: % — ייצאו אותן והחליטו לפני ה-rollback (לא מבוצע)', _n, _what;
      END IF;
    END IF;
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS hospitality.channel_calendars_due(integer);
DROP FUNCTION IF EXISTS hospitality.channel_sync_service(uuid, jsonb, text);
DROP FUNCTION IF EXISTS hospitality.channel_sync_apply(uuid, jsonb, text);
DROP FUNCTION IF EXISTS hospitality._channel_apply(uuid, uuid, jsonb, text);
DROP FUNCTION IF EXISTS hospitality.channel_calendar_remove(uuid);
DROP FUNCTION IF EXISTS hospitality.channel_calendar_add(uuid, text, text);
DROP FUNCTION IF EXISTS hospitality.channel_feed_token(uuid, boolean);
DROP FUNCTION IF EXISTS hospitality.channels_view();
DROP FUNCTION IF EXISTS hospitality.channel_feed(uuid, text);
DROP FUNCTION IF EXISTS hospitality._new_feed_token();
DROP INDEX IF EXISTS hospitality.blocks_channel_uid;
ALTER TABLE hospitality.blocks DROP CONSTRAINT IF EXISTS blocks_channel_fk;
ALTER TABLE hospitality.blocks DROP CONSTRAINT IF EXISTS blocks_external_uid_len;
ALTER TABLE hospitality.blocks DROP COLUMN IF EXISTS external_uid;
ALTER TABLE hospitality.blocks DROP COLUMN IF EXISTS channel_calendar_id;
DROP TABLE IF EXISTS hospitality.channel_calendars;
DROP TABLE IF EXISTS hospitality.channel_feeds;
COMMIT;
