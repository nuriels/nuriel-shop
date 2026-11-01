-- Rollback of 20261102180000_hosp_channels.sql (iCal channel sync).
-- Drops the channel functions, the two tables and the channel columns on blocks. Blocks created by
-- a sync stay as ordinary blocks (the owner can release them on the board).
BEGIN;
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
