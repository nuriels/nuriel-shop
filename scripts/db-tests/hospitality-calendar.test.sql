-- ============================================================
-- Hospitality: the calendar board and blocks (Stage 3a — 20261101220000_hosp_calendar.sql)
--   • no direct staff writes to blocks; functions DEFINER, never anon
--   • calendar(from, to): range limits; units; overlapping bookings (no declined / expired /
--     lapsed holds; cancelled only on request); blocks; no contact data; unit filter incl. the
--     whole property; the change stamp
--   • blocks: create (conflicts explained, past dates refused, whole property fans out), move,
--     release (dates free again), upcoming list, action log
--   • outsiders refused; isolation; Ecommerce data unchanged
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-000000000aa1'''
\set MGR_A '''a0000000-0000-0000-0000-000000000aa2'''
\set OWNER_B '''a0000000-0000-0000-0000-000000000ab1'''
\set GUEST '''a0000000-0000-0000-0000-000000000ac1'''
\set SHOP_OWNER '''a0000000-0000-0000-0000-000000000ae1'''
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set SHOP '''73a00000-0000-0000-0000-0000000000e1'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(_name text, _sql text, _pattern text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NOT NULL AND err ILIKE '%' || _pattern || '%', COALESCE('ERROR: ' || err, 'no error'));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.after(_name text, _action text, _check text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v boolean; err text;
BEGIN
  BEGIN
    EXECUTE _action INTO r;
    EXECUTE _check INTO v USING r;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NULL AND COALESCE(v, false),
          COALESCE('ERROR: ' || err, 'value=' || COALESCE(v::text, 'null') || ' result=' || left(COALESCE(r::text, 'null'), 300)));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.add_role(_site uuid, _uid uuid, _name text, _role text DEFAULT 'admin') RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, _role, true) RETURNING to_jsonb(true);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ecommerce_hash() RETURNS text LANGUAGE sql AS $f$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
       JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
       JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(x::text, ',' ORDER BY x.tenant_id) FROM public.tenant_subscriptions x)));
$f$;
-- a hospitality call as somebody, on a site — returns the function's jsonb
CREATE OR REPLACE FUNCTION pg_temp.h(_site text, _uid uuid, _call text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT to_jsonb(hospitality.' || _call || ')');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.h_sql(_site text, _uid uuid, _call text) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT pg_temp.h(%L, %L, %L)', _site, _uid, _call);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.rev(_unit uuid) RETURNS integer LANGUAGE sql AS $f$
  SELECT revision FROM hospitality.units WHERE id = _unit;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.prev(_property uuid) RETURNS integer LANGUAGE sql AS $f$
  SELECT revision FROM hospitality.properties WHERE id = _property;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.last_audit(_site uuid, _action text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT to_jsonb(a) FROM hospitality.audit_log a WHERE tenant_id = _site AND action = _action ORDER BY id DESC LIMIT 1;
$f$;
-- a site request (quote first, then the request with the quote's policy hash) as an anonymous visitor
CREATE OR REPLACE FUNCTION pg_temp.req(_site text, _unit uuid, _in date, _out date, _email text, _phone text, _key text,
                                       _adults integer DEFAULT 2, _children integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE q jsonb;
BEGIN
  q := pg_temp.call(_site, NULL, format('SELECT hospitality.quote(%L, %L, %L, %s, %s)', _unit, _in, _out, _adults, _children));
  RETURN pg_temp.call(_site, NULL, format(
    'SELECT hospitality.request_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _email => %L, _phone => %L, _idempotency_key => %L, _policy_accepted => true, _policy_hash => %L,
       _adults => %s, _children => %s)',
    _unit, _in, _out, 'אורח בדיקה', _email, _phone, _key, q ->> 'policy_hash', _adults, _children));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.manual(_site text, _uid uuid, _unit uuid, _in date, _out date,
                                          _adults integer DEFAULT 2, _children integer DEFAULT 0,
                                          _status text DEFAULT 'confirmed') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format(
    'SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _phone => %L, _terms_explained => true, _adults => %s, _children => %s, _status => %L)',
    _unit, _in, _out, 'אורח טלפוני', '0541234567', _adults, _children, _status));
$f$;

CREATE OR REPLACE FUNCTION pg_temp.cal(_site text, _uid uuid, _from date, _to date, _extra text DEFAULT '')
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format('SELECT hospitality.calendar(%L, %L%s)', _from, _to, _extra));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.free(_site text, _uid uuid, _unit uuid, _in date, _out date) RETURNS boolean LANGUAGE sql AS $f$
  SELECT (pg_temp.call(_site, _uid, format('SELECT hospitality.quote(%L, %L, %L, 2, 0)', _unit, _in, _out)) ->> 'available')::boolean;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000aa1', 'c3a.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-000000000aa2', 'c3a.mgr.a@test.local', now()),
  ('a0000000-0000-0000-0000-000000000ab1', 'c3a.owner.b@test.local', now()),
  ('a0000000-0000-0000-0000-000000000ac1', 'c3a.guest@test.local', now()),
  ('a0000000-0000-0000-0000-000000000ae1', 'c3a.shop.owner@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c3a-a', 'אירוח לוח A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c3a-b', 'אירוח לוח B'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'c3a-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'c3a-b' \gset
SELECT pg_temp.add_role(:'sa', :OWNER_A, 'c3a_owner_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :MGR_A, 'c3a_mgr_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sb', :OWNER_B, 'c3a_owner_b') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id IN (:OWNER_A, :OWNER_B);
INSERT INTO public.tenants (id, slug, name) VALUES (:SHOP, 'c3a-shop', 'חנות 3a');
SELECT pg_temp.add_role(:SHOP, :SHOP_OWNER, 'c3a_shop_owner') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id = :SHOP_OWNER;
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
CREATE TEMP TABLE c3a_before AS SELECT pg_temp.ecommerce_hash() AS h;
SELECT pg_temp.h(:'sa', :OWNER_A, $$property_create('{"name": "חוות הזית", "property_type": "zimmer_complex", "status": "active"}')$$) ->> 'id' AS pa \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר הזית", "unit_type": "zimmer"}')$$, :'pa')) ->> 'id' AS u1 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר האלון", "unit_type": "zimmer"}')$$, :'pa')) ->> 'id' AS u2 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר התמר", "unit_type": "zimmer"}')$$, :'pa')) ->> 'id' AS u3 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$whole_property_set(%L, true, ARRAY[%L, %L]::uuid[])$$, :'pa', :'u1', :'u2')) IS NOT NULL AS ok \gset
SELECT id AS uw FROM hospitality.units WHERE property_id = :'pa' AND kind = 'whole_property' \gset
-- bookings: confirmed on u1 (days 5–7), pending on u2 (days 6–8), whole property (days 20–22),
-- one cancelled on u3 (days 5–6)
SELECT pg_temp.manual(:'sa', :OWNER_A, :'u1', pg_temp.d(5), pg_temp.d(7)) ->> 'booking_id' AS b1 \gset
SELECT pg_temp.manual(:'sa', :OWNER_A, :'u2', pg_temp.d(6), pg_temp.d(8), 2, 0, 'pending_approval') ->> 'booking_id' AS b2 \gset
SELECT pg_temp.manual(:'sa', :OWNER_A, :'uw', pg_temp.d(20), pg_temp.d(22)) ->> 'booking_id' AS bw \gset
SELECT pg_temp.manual(:'sa', :OWNER_A, :'u3', pg_temp.d(5), pg_temp.d(6)) ->> 'booking_id' AS bc \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$cancel_booking(%L, 'בדיקה', NULL, NULL, %s)$$, :'bc',
                 (SELECT revision FROM hospitality.bookings WHERE id = :'bc'))) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. structure
-- ============================================================
SELECT tests.check('calendar: no direct INSERT / UPDATE / DELETE on blocks; SELECT kept',
  $$SELECT NOT has_table_privilege('authenticated', 'hospitality.blocks', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'hospitality.blocks', 'UPDATE')
       AND has_table_privilege('authenticated', 'hospitality.blocks', 'SELECT')$$);
SELECT tests.check('calendar: functions are SECURITY DEFINER, authenticated only (never anon)',
  $$SELECT bool_and(p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('calendar', 'calendar_stamp', 'block_create', 'block_update', 'block_release', 'blocks_upcoming')
    HAVING count(*) = 6$$);
SELECT tests.check('calendar: range indexes exist',
  $$SELECT to_regclass('hospitality.bookings_calendar_idx') IS NOT NULL AND to_regclass('hospitality.blocks_calendar_idx') IS NOT NULL$$);

-- ============================================================
-- 2. reading
-- ============================================================
SELECT pg_temp.after('calendar: the manager sees the units, the overlapping bookings (not the cancelled one) and today',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(0), pg_temp.d(28))$$, :'sa', :MGR_A),
  format($$SELECT jsonb_array_length($1 -> 'units') = 4
             AND (SELECT string_agg(b ->> 'number' || ':' || (b ->> 'status'), ',' ORDER BY (b ->> 'check_in'))
                    FROM jsonb_array_elements($1 -> 'bookings') b) IS NOT NULL
             AND jsonb_array_length($1 -> 'bookings') = 3
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($1 -> 'bookings') b WHERE b ->> 'id' = %L)
             AND ($1 ->> 'today')::date = (now() AT TIME ZONE 'Asia/Jerusalem')::date
             AND (SELECT jsonb_array_length(u -> 'member_ids') FROM jsonb_array_elements($1 -> 'units') u WHERE u ->> 'kind' = 'whole_property') = 2$$,
         :'bc'));
SELECT pg_temp.after('calendar: no contact details in the board — only the guest''s name',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(0), pg_temp.d(28))$$, :'sa', :MGR_A),
  $$SELECT bool_and(NOT (b ? 'email') AND NOT (b ? 'phone') AND NOT (b ? 'guest_email') AND b ->> 'guest_name' = 'אורח טלפוני')
      FROM jsonb_array_elements($1 -> 'bookings') b$$);
SELECT pg_temp.after('calendar: cancelled bookings only on request',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(0), pg_temp.d(28), ', NULL, true')$$, :'sa', :MGR_A),
  $$SELECT jsonb_array_length($1 -> 'bookings') = 4$$);
SELECT pg_temp.after('calendar: a range is half-open — a booking leaving on the first day is not in it',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(7), pg_temp.d(8))$$, :'sa', :MGR_A),
  $$SELECT (SELECT string_agg(b ->> 'status', ',') FROM jsonb_array_elements($1 -> 'bookings') b) = 'pending_approval'$$);
SELECT pg_temp.after('calendar: filtering one member unit still shows the whole-property booking',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(0), pg_temp.d(28), format(', ARRAY[%%L]::uuid[]', %L))$$, :'sa', :MGR_A, :'u1'),
  format($$SELECT jsonb_array_length($1 -> 'units') = 1
             AND (SELECT count(*) FROM jsonb_array_elements($1 -> 'bookings') b WHERE b ->> 'id' IN (%L, %L)) = 2$$, :'b1', :'bw'));
SELECT pg_temp.expect_error('calendar: "to" must be after "from"',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(5), pg_temp.d(5))$$, :'sa', :MGR_A), 'טווח התאריכים');
SELECT pg_temp.expect_error('calendar: at most 62 days at once',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(0), pg_temp.d(70))$$, :'sa', :MGR_A), 'עד 62 ימים');
SELECT pg_temp.call(:'sa', :MGR_A, format('SELECT to_jsonb(hospitality.calendar_stamp(%L, %L))', pg_temp.d(0), pg_temp.d(28))) AS stamp1 \gset
SELECT tests.check('stamp: unchanged when nothing changed',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.calendar_stamp(%%L, %%L))', pg_temp.d(0), pg_temp.d(28))) = %L::jsonb$$,
         :'sa', :MGR_A, :'stamp1'));

-- ============================================================
-- 3. blocks
-- ============================================================
SELECT pg_temp.h(:'sa', :MGR_A, format($$block_create(%L, %L, %L, 'שיפוץ')$$, :'u3', pg_temp.d(10), pg_temp.d(13))) ->> 'id' AS k1 \gset
SELECT tests.check('block: the manager blocks free dates — the quote says unavailable; logged',
  format($$SELECT NOT pg_temp.free(%1$L, %2$L, %3$L, pg_temp.d(11), pg_temp.d(12))
             AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %1$L AND action = 'calendar.block_created') = 1$$,
         :'sa', :OWNER_A, :'u3'));
SELECT tests.check('stamp: changes after a block',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.calendar_stamp(%%L, %%L))', pg_temp.d(0), pg_temp.d(28))) <> %L::jsonb$$,
         :'sa', :MGR_A, :'stamp1'));
SELECT pg_temp.expect_error('block: over a booking is refused with a clear message',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$block_create(%L, %L, %L)$$, :'u1', pg_temp.d(6), pg_temp.d(9))), 'יש הזמנה או חסימה בתאריכים האלה');
SELECT pg_temp.expect_error('block: over another block is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$block_create(%L, %L, %L)$$, :'u3', pg_temp.d(12), pg_temp.d(14))), 'יש הזמנה או חסימה');
SELECT pg_temp.expect_error('block: the whole property over a member''s booking is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$block_create(%L, %L, %L)$$, :'uw', pg_temp.d(5), pg_temp.d(6))), 'יש הזמנה או חסימה');
SELECT pg_temp.expect_error('block: past dates are refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$block_create(%L, %L, %L)$$, :'u3', pg_temp.d(-5), pg_temp.d(-2))), 'שעברו');
SELECT pg_temp.expect_error('block: at most a year',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$block_create(%L, %L, %L)$$, :'u3', pg_temp.d(100), pg_temp.d(500))), 'עד שנה');
SELECT pg_temp.expect_error('block: a reason over 300 characters is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$block_create(%L, %L, %L, %L)$$, :'u3', pg_temp.d(40), pg_temp.d(41), repeat('א', 301))), 'ארוך מדי');
SELECT pg_temp.h(:'sa', :OWNER_A, format($$block_create(%L, %L, %L, 'אירוע משפחתי')$$, :'uw', pg_temp.d(30), pg_temp.d(32))) ->> 'id' AS kw \gset
SELECT tests.check('block: the whole property blocks every member unit',
  format($$SELECT NOT pg_temp.free(%1$L, %2$L, %3$L, pg_temp.d(30), pg_temp.d(31)) AND NOT pg_temp.free(%1$L, %2$L, %4$L, pg_temp.d(31), pg_temp.d(32))
             AND pg_temp.free(%1$L, %2$L, %5$L, pg_temp.d(30), pg_temp.d(32))$$, :'sa', :OWNER_A, :'u1', :'u2', :'u3'));
SELECT pg_temp.after('block: moved to other dates — the old dates are free, the new ones not',
  pg_temp.h_sql(:'sa', :MGR_A, format($$block_update(%L, %L, %L, 'שיפוץ חדר רחצה')$$, :'k1', pg_temp.d(14), pg_temp.d(16))),
  format($$SELECT pg_temp.free(%1$L, %2$L, %3$L, pg_temp.d(10), pg_temp.d(13)) AND NOT pg_temp.free(%1$L, %2$L, %3$L, pg_temp.d(14), pg_temp.d(15))
             AND $1 ->> 'reason' = 'שיפוץ חדר רחצה'$$, :'sa', :OWNER_A, :'u3'));
SELECT pg_temp.after('upcoming: the active blocks with their unit names',
  pg_temp.h_sql(:'sa', :MGR_A, 'blocks_upcoming()'),
  $$SELECT jsonb_array_length($1) = 2 AND $1 -> 0 ->> 'unit_name' = 'צימר התמר'$$);
SELECT pg_temp.after('block: released — the dates are free again; kept in history; logged',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$block_release(%L)$$, :'k1')),
  format($$SELECT pg_temp.free(%1$L, %2$L, %3$L, pg_temp.d(14), pg_temp.d(16))
             AND (SELECT released_at IS NOT NULL FROM hospitality.blocks WHERE id = %4$L)
             AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %1$L AND action LIKE 'calendar.block_%%') = 4$$,
         :'sa', :OWNER_A, :'u3', :'k1'));
SELECT pg_temp.expect_error('block: a released block cannot be released or moved again',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$block_release(%L)$$, :'k1')), 'החסימה לא נמצאה');
SELECT pg_temp.after('calendar: shows the whole-property block and not the released one',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(0), pg_temp.d(40))$$, :'sa', :MGR_A),
  format($$SELECT jsonb_array_length($1 -> 'blocks') = 1 AND $1 -> 'blocks' -> 0 ->> 'id' = %L$$, :'kw'));

-- ============================================================
-- 4. outsiders, isolation
-- ============================================================
SELECT pg_temp.expect_error('outsiders: site B''s owner cannot read A''s board through A',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(0), pg_temp.d(28))$$, :'sa', :OWNER_B), 'אין הרשאה');
SELECT pg_temp.after('outsiders: through its own site, B''s board is empty',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(0), pg_temp.d(28))$$, :'sb', :OWNER_B),
  $$SELECT jsonb_array_length($1 -> 'bookings') = 0 AND jsonb_array_length($1 -> 'units') = 0$$);
SELECT pg_temp.expect_error('outsiders: B cannot block A''s unit',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$block_create(%L, %L, %L)$$, :'u3', pg_temp.d(50), pg_temp.d(51))), 'היחידה לא נמצאה');
SELECT pg_temp.expect_error('outsiders: B cannot release A''s block',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$block_release(%L)$$, :'kw')), 'החסימה לא נמצאה');
SELECT pg_temp.expect_error('outsiders: a signed-in guest cannot read the board',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(0), pg_temp.d(28))$$, :'sa', :GUEST), 'אין הרשאה');
SELECT pg_temp.expect_error('outsiders: anonymous callers cannot read the board',
  format($$SELECT pg_temp.cal(%L, NULL, pg_temp.d(0), pg_temp.d(28))$$, :'sa'), 'permission denied');
SELECT pg_temp.expect_error('outsiders: a store owner cannot use the board',
  format($$SELECT pg_temp.cal(%L, %L, pg_temp.d(0), pg_temp.d(28))$$, :SHOP, :SHOP_OWNER), 'אין הרשאה');
SELECT pg_temp.expect_error('direct write: staff cannot insert a block directly',
  format($$SELECT pg_temp.call(%L, %L, format('INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date) VALUES (%%L, %%L, current_date + 60, current_date + 61) RETURNING to_jsonb(true)', %L, %L))$$,
         :'sa', :OWNER_A, :'sa', :'u3'), 'permission denied');
SELECT tests.check('ecommerce: store data unchanged', $$SELECT pg_temp.ecommerce_hash() = (SELECT h FROM c3a_before)$$);

-- ---------- cleanup ----------
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_delete_tenant(%1$L, 'c3a-a'), public.platform_delete_tenant(%2$L, 'c3a-b')])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset
DROP TABLE c3a_before;
