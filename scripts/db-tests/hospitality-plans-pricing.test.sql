-- ============================================================
-- Hospitality: plans with prices, setup fee, details and enforced limits (stage E3 —
-- 20261104100000_hosp_plans_pricing.sql)
--   basic 200 / premium 400 (+ setup 2,000), trial and the old placeholders fully open;
--   enforcement in the database (triggers): properties, photos per gallery, channel calendars
--   and the export link, room types, promotions; downgrade keeps what exists;
--   admin_save_plan (platform admin only), public_plans (server only)
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set OWNER_X '''a0000000-0000-0000-0000-0000000e3a01'''

CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
-- runs _sql (as the database owner, like the app server) and returns the error message or NULL
CREATE OR REPLACE FUNCTION pg_temp.err_of(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.plan_of(_site uuid, _plan text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.as_platform(format('SELECT hospitality.admin_set_subscription(%L, %L, %L)', _site, _plan, 'active'));
END $f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000e3a01', 'owner.e3x@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('e3-plans-x', 'צימר E3', 'owner.e3x@test.local'))$$) IS NOT NULL AS ok \gset
SELECT id AS sx FROM public.tenants WHERE slug = 'e3-plans-x' \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:'sx', :OWNER_X, 'owner.e3x@test.local', 'owner_e3x', 'admin', true);

-- ============================================================
-- 1. The catalogue
-- ============================================================
SELECT tests.check('plans: basic — 200 ₪ a month, 2,000 ₪ setup, 3 units, 1 property, 20 photos, owner only, published',
  $$SELECT price_monthly = 200 AND setup_fee = 2000 AND max_units = 3 AND max_properties = 1 AND max_media = 20
       AND max_managers = 1 AND is_published AND cardinality(highlights) BETWEEN 1 AND 20 AND tagline <> ''
       AND features = '{"channels": false, "room_types": false, "promotions": false}'::jsonb
      FROM hospitality.plans WHERE code = 'basic'$$);
SELECT tests.check('plans: premium — 400 ₪ a month, 2,000 ₪ setup, unlimited units and properties, 60 photos, owner + 5, everything open',
  $$SELECT price_monthly = 400 AND setup_fee = 2000 AND max_units IS NULL AND max_properties IS NULL AND max_media = 60
       AND max_managers = 6 AND is_published
       AND features = '{"channels": true, "room_types": true, "promotions": true}'::jsonb
      FROM hospitality.plans WHERE code = 'premium'$$);
SELECT tests.check('plans: trial and the old placeholders — unpublished, everything open (no site loses a feature)',
  $$SELECT count(*) = 3 AND bool_and(NOT is_published)
       AND bool_and(features = '{"channels": true, "room_types": true, "promotions": true}'::jsonb)
      FROM hospitality.plans WHERE code IN ('trial', 'pro', 'enterprise')$$);
SELECT tests.check('plans: still no API access to the table (functions only)',
  $$SELECT NOT bool_or(has_table_privilege(r, 'hospitality.plans', p))
      FROM unnest(ARRAY['anon', 'authenticated']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p$$);

SELECT tests.run('public plans: guests cannot call it',
  $$SELECT hospitality.public_plans()$$, NULL, 'permission denied');
SELECT tests.run('public plans: signed-in users cannot call it either (server only)',
  $$SELECT hospitality.public_plans()$$, 'a0000000-0000-0000-0000-0000000e3a01', 'permission denied');
SELECT tests.check('public plans: the app server gets the two published plans, cheapest first, without internal flags',
  $$SELECT jsonb_array_length(p) = 2 AND p -> 0 ->> 'code' = 'basic' AND p -> 1 ->> 'code' = 'premium'
       AND (p -> 0 ->> 'price_monthly')::numeric = 200 AND (p -> 1 ->> 'setup_fee')::numeric = 2000
       AND NOT (p -> 0) ? 'is_published' AND jsonb_typeof(p -> 1 -> 'highlights') = 'array'
      FROM (SELECT hospitality.public_plans() AS p) x$$);
SELECT tests.check('platform panel: the plans come with prices and details',
  $$SELECT (SELECT bool_and(pl ? 'price_monthly' AND pl ? 'setup_fee' AND pl ? 'highlights' AND pl ? 'features')
              FROM jsonb_array_elements(f -> 'plans') pl)
      FROM (SELECT pg_temp.as_platform('SELECT hospitality.admin_platform_flags()') AS f) x$$);

-- ============================================================
-- 2. Entitlements
-- ============================================================
SELECT tests.check('entitlements: a new site (implicit trial) has everything open and 60 photos per gallery',
  format($$SELECT e ->> 'plan' = 'trial' AND (e -> 'features' ->> 'channels')::boolean
              AND (e ->> 'max_media')::integer = 60 AND e ->> 'max_properties' IS NULL
              AND (e ->> 'properties_used')::integer = 0
             FROM (SELECT hospitality.entitlements(%L) AS e) x$$, :'sx'));
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status)
VALUES ('71e30000-0000-0000-0000-0000000e3b01', :'sx', 'מתחם ראשי', 'main', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, name, slug, base_price)
VALUES ('71e30000-0000-0000-0000-0000000e3c01', :'sx', '71e30000-0000-0000-0000-0000000e3b01', 'צימר 1', 'z1', 500);
SELECT pg_temp.plan_of(:'sx', 'basic');
SELECT tests.check('entitlements: on basic — 1 property (used 1), 20 photos per gallery, channels / room types / promotions closed',
  format($$SELECT e ->> 'plan' = 'basic' AND (e ->> 'max_properties')::integer = 1
              AND (e ->> 'properties_used')::integer = 1 AND (e ->> 'max_media')::integer = 20
              AND NOT (e -> 'features' ->> 'channels')::boolean AND NOT (e -> 'features' ->> 'room_types')::boolean
              AND NOT (e -> 'features' ->> 'promotions')::boolean
             FROM (SELECT hospitality.entitlements(%L) AS e) x$$, :'sx'));

-- ============================================================
-- 3. Enforcement on basic (triggers — every path, also direct writes)
-- ============================================================
SELECT tests.check('basic: a second active property is refused',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.properties (tenant_id, name, slug, status) VALUES (%%L, %%L, %%L, %%L)',
           %L, 'מתחם שני', 'second', 'active')) LIKE '%%מגבלת המתחמים%%'$$, :'sx'));
SELECT tests.check('basic: an archived property does not count (allowed)',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES (%%L, %%L, %%L, %%L, %%L)',
           '71e30000-0000-0000-0000-0000000e3b02', %L, 'מתחם בארכיון', 'archived-one', 'archived')) IS NULL$$, :'sx'));
SELECT tests.check('basic: taking it out of the archive is refused at the limit',
  $$SELECT pg_temp.err_of('UPDATE hospitality.properties SET status = ''active'' WHERE id = ''71e30000-0000-0000-0000-0000000e3b02''') LIKE '%מגבלת המתחמים%'$$);
SELECT tests.check('basic: connecting an external calendar is refused (premium feature)',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.channel_calendars (tenant_id, unit_id, channel, url) VALUES (%%L, %%L, %%L, %%L)',
           %L, '71e30000-0000-0000-0000-0000000e3c01', 'airbnb', 'https://www.airbnb.com/calendar/ical/1.ics')) LIKE '%%זמין בחבילת פרימיום%%'$$, :'sx'));
SELECT tests.check('basic: the calendar export link is refused (premium feature)',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.channel_feeds (tenant_id, unit_id, token) VALUES (%%L, %%L, %%L)',
           %L, '71e30000-0000-0000-0000-0000000e3c01', repeat('a', 40))) LIKE '%%זמין בחבילת פרימיום%%'$$, :'sx'));
SELECT tests.check('basic: room types are refused (premium feature)',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.unit_categories (tenant_id, property_id, name, slug) VALUES (%%L, %%L, %%L, %%L)',
           %L, '71e30000-0000-0000-0000-0000000e3b01', 'חדר זוגי', 'double')) LIKE '%%סוגי חדרים%%'$$, :'sx'));
SELECT tests.check('basic: promotions are refused (premium feature)',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.promotions (tenant_id, name, code, discount_kind, value) VALUES (%%L, %%L, %%L, %%L, %%s)',
           %L, 'מבצע', 'E3PLAN10', 'percent', 10)) LIKE '%%קופונים ומבצעים%%'$$, :'sx'));
INSERT INTO hospitality.media (tenant_id, owner_kind, kind, embed_provider, embed_id, sort_order)
SELECT :'sx', 'site', 'embed', 'youtube', 'vid' || lpad(i::text, 8, '0'), i FROM generate_series(1, 20) i;
SELECT tests.check('basic: 20 photos / videos in a gallery are fine',
  format($$SELECT count(*) = 20 FROM hospitality.media WHERE tenant_id = %L AND owner_kind = 'site'$$, :'sx'));
SELECT tests.check('basic: the 21st in the same gallery is refused',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.media (tenant_id, owner_kind, kind, embed_provider, embed_id) VALUES (%%L, %%L, %%L, %%L, %%L)',
           %L, 'site', 'embed', 'youtube', 'vid00000021')) LIKE '%%מגבלת התמונות%%'$$, :'sx'));
SELECT tests.check('basic: another gallery (the unit) has its own count',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.media (tenant_id, owner_kind, unit_id, kind, embed_provider, embed_id) VALUES (%%L, %%L, %%L, %%L, %%L, %%L)',
           %L, 'unit', '71e30000-0000-0000-0000-0000000e3c01', 'embed', 'youtube', 'unitvid0001')) IS NULL$$, :'sx'));

-- ============================================================
-- 4. Premium opens everything
-- ============================================================
SELECT pg_temp.plan_of(:'sx', 'premium');
SELECT tests.check('premium: the archived property can come back',
  $$SELECT pg_temp.err_of('UPDATE hospitality.properties SET status = ''active'' WHERE id = ''71e30000-0000-0000-0000-0000000e3b02''') IS NULL$$);
SELECT tests.check('premium: external calendar, room type and promotion are allowed',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.channel_calendars (tenant_id, unit_id, channel, url) VALUES (%%L, %%L, %%L, %%L)',
             %1$L, '71e30000-0000-0000-0000-0000000e3c01', 'airbnb', 'https://www.airbnb.com/calendar/ical/1.ics')) IS NULL
          AND pg_temp.err_of(format('INSERT INTO hospitality.unit_categories (tenant_id, property_id, name, slug) VALUES (%%L, %%L, %%L, %%L)',
             %1$L, '71e30000-0000-0000-0000-0000000e3b01', 'חדר זוגי', 'double')) IS NULL
          AND pg_temp.err_of(format('INSERT INTO hospitality.promotions (tenant_id, name, code, discount_kind, value) VALUES (%%L, %%L, %%L, %%L, %%s)',
             %1$L, 'מבצע', 'E3PLAN10', 'percent', 10)) IS NULL$$, :'sx'));
SELECT tests.check('premium: the 21st photo in the gallery is allowed',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.media (tenant_id, owner_kind, kind, embed_provider, embed_id) VALUES (%%L, %%L, %%L, %%L, %%L)',
           %L, 'site', 'embed', 'youtube', 'vid00000021')) IS NULL$$, :'sx'));

-- ============================================================
-- 5. Downgrade keeps what exists, only blocks adding
-- ============================================================
SELECT pg_temp.plan_of(:'sx', 'basic');
SELECT tests.check('downgrade: nothing was deleted (2 properties, calendar, room type, promotion, 21 photos)',
  format($$SELECT (SELECT count(*) FROM hospitality.properties WHERE tenant_id = %1$L AND status = 'active') = 2
          AND (SELECT count(*) FROM hospitality.channel_calendars WHERE tenant_id = %1$L) = 1
          AND (SELECT count(*) FROM hospitality.unit_categories WHERE tenant_id = %1$L) = 1
          AND (SELECT count(*) FROM hospitality.promotions WHERE tenant_id = %1$L) = 1
          AND (SELECT count(*) FROM hospitality.media WHERE tenant_id = %1$L AND owner_kind = 'site') = 21$$, :'sx'));
SELECT tests.check('downgrade: adding another calendar is refused again',
  format($$SELECT pg_temp.err_of(format('INSERT INTO hospitality.channel_calendars (tenant_id, unit_id, channel, url) VALUES (%%L, %%L, %%L, %%L)',
           %L, '71e30000-0000-0000-0000-0000000e3c01', 'booking', 'https://admin.booking.com/ical/2.ics')) LIKE '%%זמין בחבילת פרימיום%%'$$, :'sx'));
SELECT tests.check('downgrade: renaming an existing promotion still works (only adding is blocked)',
  format($$SELECT pg_temp.err_of(format('UPDATE hospitality.promotions SET name = %%L WHERE tenant_id = %%L', 'מבצע קיץ', %L)) IS NULL$$, :'sx'));

SELECT tests.check('not a hospitality site: the plan guards do not apply (store-type rules decide)',
  $$SELECT hospitality.entitlements('70000000-0000-0000-0000-00000000000a') IS NULL$$);

-- ============================================================
-- 6. Editing a plan (platform admin only)
-- ============================================================
SELECT tests.check('edit plan: a site owner is refused',
  $$SELECT pg_temp.err_of($q$SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000e3a01', true),
                                   hospitality.admin_save_plan('basic', '{"price_monthly": 1}')$q$) LIKE '%מנהל הפלטפורמה%'$$);
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tests.run('edit plan: guests cannot call it',
  $$SELECT hospitality.admin_save_plan('basic', '{}')$$, NULL, 'permission denied');
SELECT tests.check('edit plan: the platform admin changes price, setup fee and the list; untouched fields stay',
  $$SELECT (r ->> 'price_monthly')::numeric = 250 AND (r ->> 'setup_fee')::numeric = 1500
       AND r -> 'highlights' = '["עד 3 יחידות", "תמיכה"]'::jsonb AND (r ->> 'max_units')::integer = 3
       AND r ->> 'name' = 'בסיסית'
      FROM (SELECT pg_temp.as_platform($q$SELECT hospitality.admin_save_plan('basic',
              '{"price_monthly": 250, "setup_fee": 1500, "highlights": [" עד 3  יחידות ", "", "תמיכה"]}')$q$) AS r) x$$);
SELECT tests.check('edit plan: features keep only the three known keys',
  $$SELECT r -> 'features' = '{"channels": true, "room_types": false, "promotions": false}'::jsonb
      FROM (SELECT pg_temp.as_platform($q$SELECT hospitality.admin_save_plan('basic',
              '{"features": {"channels": true, "anything": true}}')$q$) AS r) x$$);
SELECT tests.check('edit plan: invalid price / limit / list are refused',
  $$SELECT pg_temp.err_of($q$SELECT pg_temp.as_platform('SELECT hospitality.admin_save_plan(''basic'', ''{"price_monthly": -1}'')')$q$) LIKE '%מחיר%'
       AND pg_temp.err_of($q$SELECT pg_temp.as_platform('SELECT hospitality.admin_save_plan(''basic'', ''{"max_units": "x"}'')')$q$) LIKE '%מגבלה%'
       AND pg_temp.err_of($q$SELECT pg_temp.as_platform('SELECT hospitality.admin_save_plan(''basic'', ''{"max_media": 61}'')')$q$) IS NOT NULL
       AND pg_temp.err_of($q$SELECT pg_temp.as_platform(format('SELECT hospitality.admin_save_plan(''basic'', %L)',
             jsonb_build_object('highlights', array_fill('x'::text, ARRAY[21]))))$q$) LIKE '%20 תכונות%'
       AND pg_temp.err_of($q$SELECT pg_temp.as_platform('SELECT hospitality.admin_save_plan(''nope'', ''{}'')')$q$) LIKE '%לא נמצאה%'$$);
SELECT tests.check('edit plan: recorded in the platform log',
  $$SELECT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE action = 'hosp_plan_saved' AND details ->> 'code' = 'basic'
                    AND actor_id = 'a0000000-0000-0000-0000-0000000000f0')$$);
-- back to the decided values (other files read them)
SELECT pg_temp.as_platform($q$SELECT hospitality.admin_save_plan('basic', jsonb_build_object(
  'price_monthly', 200, 'setup_fee', 2000,
  'features', '{"channels": false, "room_types": false, "promotions": false}'::jsonb,
  'highlights', to_jsonb(ARRAY['עד 3 יחידות (חדרים / בקתות)', 'אתר עם הזמנות, לוח זמינות וגלריה',
    'עד 20 תמונות בגלריה', 'תשלום טלפוני ויומן תשלומים', 'מיילים לאורחים ולעסק', 'תמיכה — מענה תוך יום עסקים'])))$q$) IS NOT NULL AS ok \gset
SELECT tests.check('edit plan: basic restored',
  $$SELECT price_monthly = 200 AND setup_fee = 2000 AND features ->> 'channels' = 'false' FROM hospitality.plans WHERE code = 'basic'$$);
