-- ============================================================
-- LIC-1 (20261107100000_lic_digital_licenses.sql) — מודול הרישיונות הדיגיטליים.
-- גישה (שרת האפליקציה בלבד), דגל הפיילוט, הפרדת חנויות, אילוצים (כולל: המסד דוחה מפתח גלוי),
-- קבצים לפי סוג ומוצר, ברירות מחדל, הורדות (תקף / עד 3 / 7 ימים / בוטל / Token שגוי / חנות אחרת),
-- קישור נעוץ לגרסת הקובץ, יומן שלא נערך, ומחיקת חנות.
-- מקביליות של צריכת הורדה (חיבורים נפרדים באמת): scripts/db-tests/licenses-concurrency.sh
-- ============================================================

-- עזר: מריץ כשרת האפליקציה (service_role) בחנות שבכותרת, ומחזיר את התוצאה או {"error": ...}
CREATE OR REPLACE FUNCTION tests.lic_server(_tenant uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  r jsonb;
BEGIN
  BEGIN
    PERFORM set_config('request.headers', json_build_object('x-tenant-id', _tenant)::text, true);
    EXECUTE 'SET LOCAL ROLE service_role';
    EXECUTE _sql INTO r;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('error', SQLERRM);
  END;
  RETURN COALESCE(r, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION tests.lic_hash(_token text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(_token, 'UTF8')), 'hex')
$$;
GRANT USAGE ON SCHEMA tests TO service_role;
GRANT EXECUTE ON FUNCTION tests.lic_hash(text) TO service_role;

-- ---------- גישה: רק שרת האפליקציה ----------
SELECT tests.check('LIC: the browser roles have no privilege on any license table',
  $$SELECT bool_and(NOT has_table_privilege(r, 'public.' || t, p))
      FROM unnest(ARRAY['anon', 'authenticated']) r,
           unnest(ARRAY['license_files', 'license_deliveries', 'license_download_links', 'license_audit']) t,
           unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p$$);
SELECT tests.check('LIC: the app server (service_role) has full access to the license tables',
  $$SELECT bool_and(has_table_privilege('service_role', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE'))
      FROM unnest(ARRAY['license_files', 'license_deliveries', 'license_download_links', 'license_audit']) t$$);
SELECT tests.check('LIC: RLS is on for every license table (no policies — defence in depth)',
  $$SELECT bool_and(c.relrowsecurity) AND NOT EXISTS (
            SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename LIKE 'license\_%')
      FROM pg_class c
     WHERE c.oid IN ('public.license_files'::regclass, 'public.license_deliveries'::regclass,
                     'public.license_download_links'::regclass, 'public.license_audit'::regclass)$$);
SELECT tests.check('LIC: the link and file functions are server only',
  $$SELECT bool_and(NOT has_function_privilege(r, f, 'EXECUTE'))
      FROM unnest(ARRAY['anon', 'authenticated']) r,
           unnest(ARRAY['public.license_consume_download(text)', 'public.license_link_peek(text)',
                        'public.license_set_default_file(uuid)']) f$$);
SELECT tests.check('LIC: … and callable by the app server',
  $$SELECT has_function_privilege('service_role', 'public.license_consume_download(text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.license_link_peek(text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.license_set_default_file(uuid)', 'EXECUTE')$$);
SELECT tests.run('LIC: a signed-in store owner cannot read deliveries straight from the API',
  $$SELECT * FROM public.license_deliveries$$, 'a0000000-0000-0000-0000-0000000000a1', 'permission denied');
SELECT tests.run('LIC: … nor consume a download link',
  $$SELECT public.license_consume_download(repeat('a', 64))$$, 'a0000000-0000-0000-0000-0000000000a1', 'permission denied');
SELECT tests.run('LIC: a visitor cannot peek at a link',
  $$SELECT public.license_link_peek(repeat('a', 64))$$, NULL, 'permission denied');
SELECT tests.run('LIC: a visitor cannot read the audit log',
  $$SELECT * FROM public.license_audit$$, NULL, 'permission denied');

-- ---------- דגל הפיילוט ----------
SELECT tests.check('LIC: the pilot flag exists and is enabled for no store by the migration',
  $$SELECT (SELECT enabled FROM public.platform_feature_flags WHERE key = 'digital_licenses')
       AND NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags WHERE key = 'digital_licenses')
       AND NOT public.platform_feature_enabled('digital_licenses', '70000000-0000-0000-0000-00000000000a')
       AND NOT public.platform_feature_enabled('digital_licenses', '70000000-0000-0000-0000-00000000000b')$$);
INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
VALUES ('70000000-0000-0000-0000-00000000000a', 'digital_licenses', true);
SELECT tests.check('LIC: an explicit per-store switch enables it for that store only',
  $$SELECT public.platform_feature_enabled('digital_licenses', '70000000-0000-0000-0000-00000000000a')
       AND NOT public.platform_feature_enabled('digital_licenses', '70000000-0000-0000-0000-00000000000b')$$);

-- ---------- נתוני בדיקה (חנות A: Office + Windows; חנות B: Office) ----------
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
INSERT INTO public.license_files (id, tenant_id, product, kind, storage_path, file_name, size_bytes, is_default, archived_at, uploaded_by) VALUES
  ('1c000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-00000000000a', 'office', 'guide',
   '70000000-0000-0000-0000-00000000000a/1c000000-0000-0000-0000-0000000000a1.pdf', 'Nuriel-Office-Install-Guide.pdf', 755191, true, NULL, 'a0000000-0000-0000-0000-0000000000a1'),
  ('1c000000-0000-0000-0000-0000000000a2', '70000000-0000-0000-0000-00000000000a', 'office', 'installer',
   '70000000-0000-0000-0000-00000000000a/1c000000-0000-0000-0000-0000000000a2.exe', 'NurielOfficeTool.exe', 7861760, true, NULL, 'a0000000-0000-0000-0000-0000000000a1'),
  ('1c000000-0000-0000-0000-0000000000a3', '70000000-0000-0000-0000-00000000000a', 'office', 'installer',
   '70000000-0000-0000-0000-00000000000a/1c000000-0000-0000-0000-0000000000a3.exe', 'NurielOfficeTool-v2.exe', 7900000, false, NULL, 'a0000000-0000-0000-0000-0000000000a1'),
  ('1c000000-0000-0000-0000-0000000000a4', '70000000-0000-0000-0000-00000000000a', 'office', 'receipt',
   '70000000-0000-0000-0000-00000000000a/1c000000-0000-0000-0000-0000000000a4.pdf', 'receipt-1001.pdf', 120000, false, NULL, 'a0000000-0000-0000-0000-0000000000a1'),
  ('1c000000-0000-0000-0000-0000000000a5', '70000000-0000-0000-0000-00000000000a', 'windows', 'guide',
   '70000000-0000-0000-0000-00000000000a/1c000000-0000-0000-0000-0000000000a5.pdf', 'Windows-Guide.pdf', 300000, true, NULL, 'a0000000-0000-0000-0000-0000000000a1'),
  ('1c000000-0000-0000-0000-0000000000a6', '70000000-0000-0000-0000-00000000000a', 'windows', 'installer',
   '70000000-0000-0000-0000-00000000000a/1c000000-0000-0000-0000-0000000000a6.exe', 'NurielWindowsTool.exe', 5000000, true, NULL, 'a0000000-0000-0000-0000-0000000000a1'),
  ('1c000000-0000-0000-0000-0000000000a7', '70000000-0000-0000-0000-00000000000a', 'office', 'installer',
   '70000000-0000-0000-0000-00000000000a/1c000000-0000-0000-0000-0000000000a7.exe', 'old-tool.exe', 1000, false, now(), 'a0000000-0000-0000-0000-0000000000a1'),
  ('1c000000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-00000000000b', 'office', 'installer',
   '70000000-0000-0000-0000-00000000000b/1c000000-0000-0000-0000-0000000000b1.exe', 'b-tool.exe', 1000, true, NULL, 'a0000000-0000-0000-0000-0000000000b1'),
  ('1c000000-0000-0000-0000-0000000000b2', '70000000-0000-0000-0000-00000000000b', 'office', 'guide',
   '70000000-0000-0000-0000-00000000000b/1c000000-0000-0000-0000-0000000000b2.pdf', 'b-guide.pdf', 1000, true, NULL, 'a0000000-0000-0000-0000-0000000000b1');

INSERT INTO public.license_deliveries
  (id, tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone, business_id, order_number,
   key_ciphertext, key_tail, key_fingerprint, guide_file_id, installer_file_id, receipt_file_id, email_status, sent_by, sent_at)
VALUES
  ('1d000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-0000000000a1',
   'office', 'ישראל ישראלי', 'israel@example.com', '0501234567', '515151515', '1001',
   'v1:c2FtcGxlLWNpcGhlcnRleHQ=', 'K7Q2X', repeat('a', 64),
   '1c000000-0000-0000-0000-0000000000a1', '1c000000-0000-0000-0000-0000000000a2', '1c000000-0000-0000-0000-0000000000a4',
   'accepted', 'a0000000-0000-0000-0000-0000000000a1', now()),
  ('1d000000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-0000000000b1',
   'office', 'לקוח B', 'b@example.com', '0521234567', NULL, NULL,
   'v1:c2FtcGxlLWI=', 'B0000', repeat('b', 64),
   '1c000000-0000-0000-0000-0000000000b2', '1c000000-0000-0000-0000-0000000000b1', NULL,
   'accepted', 'a0000000-0000-0000-0000-0000000000b1', now());

INSERT INTO public.license_download_links (id, tenant_id, delivery_id, file_id, token_hash, expires_at, created_at, revoked_at, revoked_reason) VALUES
  ('1e000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-00000000000a', '1d000000-0000-0000-0000-0000000000a1',
   '1c000000-0000-0000-0000-0000000000a2', tests.lic_hash('lic-valid'), now() + interval '7 days', now(), NULL, NULL),
  ('1e000000-0000-0000-0000-0000000000a2', '70000000-0000-0000-0000-00000000000a', '1d000000-0000-0000-0000-0000000000a1',
   '1c000000-0000-0000-0000-0000000000a2', tests.lic_hash('lic-expired'), now() - interval '1 second', now() - interval '7 days', NULL, NULL),
  ('1e000000-0000-0000-0000-0000000000a3', '70000000-0000-0000-0000-00000000000a', '1d000000-0000-0000-0000-0000000000a1',
   '1c000000-0000-0000-0000-0000000000a2', tests.lic_hash('lic-revoked'), now() + interval '7 days', now(), now(), 'replaced'),
  ('1e000000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-00000000000b', '1d000000-0000-0000-0000-0000000000b1',
   '1c000000-0000-0000-0000-0000000000b1', tests.lic_hash('lic-b'), now() + interval '7 days', now(), NULL, NULL);
SELECT set_config('request.headers', '', false);

-- ---------- הורדות: בדיקה בלי לצרוך ----------
SELECT tests.check('LIC: peek — a valid link shows the file and 3 downloads left, and consumes nothing',
  $$SELECT r->>'state' = 'valid' AND (r->>'remaining')::int = 3 AND r->>'file_name' = 'NurielOfficeTool.exe'
       AND r->>'product' = 'office' AND r->>'storage_path' LIKE '70000000-0000-0000-0000-00000000000a/%.exe'
       AND (SELECT download_count FROM public.license_download_links WHERE id = '1e000000-0000-0000-0000-0000000000a1') = 0
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_link_peek(tests.lic_hash('lic-valid'))$q$) r$$);

-- ---------- הורדות: עד 3, ואז חסום ----------
SELECT tests.check('LIC: download 1 of 3 succeeds (2 left)',
  $$SELECT (r->>'ok')::boolean AND (r->>'downloads')::int = 1 AND (r->>'remaining')::int = 2
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_consume_download(tests.lic_hash('lic-valid'))$q$) r$$);
SELECT tests.check('LIC: download 2 of 3 succeeds (1 left)',
  $$SELECT (r->>'ok')::boolean AND (r->>'remaining')::int = 1
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_consume_download(tests.lic_hash('lic-valid'))$q$) r$$);
SELECT tests.check('LIC: download 3 of 3 succeeds (none left)',
  $$SELECT (r->>'ok')::boolean AND (r->>'remaining')::int = 0
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_consume_download(tests.lic_hash('lic-valid'))$q$) r$$);
SELECT tests.check('LIC: a 4th download is blocked (exhausted) and the counter stays at 3',
  $$SELECT NOT (r->>'ok')::boolean AND r->>'state' = 'exhausted'
       AND (SELECT download_count FROM public.license_download_links WHERE id = '1e000000-0000-0000-0000-0000000000a1') = 3
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_consume_download(tests.lic_hash('lic-valid'))$q$) r$$);
SELECT tests.check('LIC: peek after the limit says exhausted, 0 left',
  $$SELECT r->>'state' = 'exhausted' AND (r->>'remaining')::int = 0
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_link_peek(tests.lic_hash('lic-valid'))$q$) r$$);

-- ---------- הורדות: תוקף / ביטול / Token שגוי ----------
SELECT tests.check('LIC: a link past its 7 days is blocked (expired) and not counted',
  $$SELECT NOT (r->>'ok')::boolean AND r->>'state' = 'expired'
       AND (SELECT download_count FROM public.license_download_links WHERE id = '1e000000-0000-0000-0000-0000000000a2') = 0
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_consume_download(tests.lic_hash('lic-expired'))$q$) r$$);
SELECT tests.check('LIC: a revoked (replaced) link is blocked',
  $$SELECT NOT (r->>'ok')::boolean AND r->>'state' = 'revoked'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_consume_download(tests.lic_hash('lic-revoked'))$q$) r$$);
SELECT tests.check('LIC: an unknown token is simply not found',
  $$SELECT NOT (r->>'ok')::boolean AND r->>'state' = 'not_found'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_consume_download(tests.lic_hash('lic-guess'))$q$) r$$);
SELECT tests.check('LIC: a malformed token (not a SHA-256) is rejected without a query',
  $$SELECT r->>'state' = 'not_found'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_consume_download('lic-valid'' OR 1=1 --')$q$) r$$);

-- ---------- הפרדת חנויות ----------
SELECT tests.check('LIC: store B cannot use store A''s link (not found — the link is invisible there)',
  $$SELECT NOT (r->>'ok')::boolean AND r->>'state' = 'not_found'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000b',
                            $q$SELECT public.license_consume_download(tests.lic_hash('lic-expired'))$q$) r$$);
SELECT tests.check('LIC: … nor peek at it, and store A''s counters did not move',
  $$SELECT r->>'state' = 'not_found'
       AND (SELECT download_count FROM public.license_download_links WHERE id = '1e000000-0000-0000-0000-0000000000a2') = 0
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000b',
                            $q$SELECT public.license_link_peek(tests.lic_hash('lic-valid'))$q$) r$$);
SELECT tests.check('LIC: store A cannot use store B''s link either',
  $$SELECT r->>'state' = 'not_found'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_consume_download(tests.lic_hash('lic-b'))$q$) r$$);
SELECT tests.check('LIC: the composite (tenant, id) foreign keys exist on deliveries and links',
  $$SELECT count(*) = 5 FROM pg_constraint
     WHERE contype = 'f' AND conname IN ('license_deliveries_guide_fk', 'license_deliveries_installer_fk',
           'license_deliveries_receipt_fk', 'license_links_delivery_fk', 'license_links_file_fk')
       AND array_length(conkey, 1) = 2$$);
SELECT tests.check('LIC: a delivery cannot point at another store''s file',
  $$SELECT r->>'error' LIKE '%violates foreign key constraint%' OR r->>'error' LIKE '%of this product and store%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_deliveries
          (tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone, key_ciphertext, key_tail, key_fingerprint, installer_file_id)
          VALUES ('70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'office', 'שם בדיקה', 'x@example.com', '0501111111',
                  'v1:eA==', 'AAAAA', repeat('c', 64), '1c000000-0000-0000-0000-0000000000b1') RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);
SELECT tests.check('LIC: a link cannot point at another store''s file',
  $$SELECT r->>'error' LIKE '%violates foreign key constraint%' OR r->>'error' LIKE '%same product and store%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_download_links (tenant_id, delivery_id, file_id, token_hash, expires_at)
          VALUES ('70000000-0000-0000-0000-00000000000a', '1d000000-0000-0000-0000-0000000000a1',
                  '1c000000-0000-0000-0000-0000000000b1', tests.lic_hash('x1'), now() + interval '1 day') RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);
SELECT tests.check('LIC: a file path must sit in the store''s own folder',
  $$SELECT r->>'error' LIKE '%license_files_path_in_tenant%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_files (tenant_id, product, kind, storage_path, file_name, size_bytes)
          VALUES ('70000000-0000-0000-0000-00000000000a', 'office', 'guide',
                  '70000000-0000-0000-0000-00000000000b/1c000000-0000-0000-0000-0000000000c9.pdf', 'x.pdf', 10) RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);

-- ---------- אילוצים ----------
SELECT tests.check('LIC: the database refuses a plaintext license key (only v1: ciphertext)',
  $$SELECT r->>'error' LIKE '%license_deliveries_key_ciphertext_check%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_deliveries
          (tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone, key_ciphertext, key_tail, key_fingerprint)
          VALUES ('70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'office', 'שם בדיקה', 'x@example.com', '0501111111',
                  'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY', 'UVWXY', repeat('c', 64)) RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);
SELECT tests.check('LIC: the same idempotency key cannot send twice in a store (no double send)',
  $$SELECT r->>'error' LIKE '%license_deliveries_idempotency%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_deliveries
          (tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone, key_ciphertext, key_tail, key_fingerprint)
          VALUES ('70000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-0000000000a1', 'office', 'שם בדיקה', 'x@example.com',
                  '0501111111', 'v1:eA==', 'AAAAA', repeat('c', 64)) RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);
SELECT tests.check('LIC: customer email is stored lower-case only; phone digits only',
  $$SELECT (SELECT r->>'error' LIKE '%license_deliveries_customer_email_check%'
              FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
                WITH x AS (INSERT INTO public.license_deliveries
                  (tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone, key_ciphertext, key_tail, key_fingerprint)
                  VALUES ('70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'office', 'שם בדיקה', 'Mixed@Example.com',
                          '0501111111', 'v1:eA==', 'AAAAA', repeat('c', 64)) RETURNING id)
                SELECT to_jsonb(x) FROM x$q$) r)
       AND (SELECT r->>'error' LIKE '%license_deliveries_customer_phone_check%'
              FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
                WITH x AS (INSERT INTO public.license_deliveries
                  (tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone, key_ciphertext, key_tail, key_fingerprint)
                  VALUES ('70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'office', 'שם בדיקה', 'x@example.com',
                          '050-123<script>', 'v1:eA==', 'AAAAA', repeat('c', 64)) RETURNING id)
                SELECT to_jsonb(x) FROM x$q$) r)$$);
SELECT tests.check('LIC: a receipt is never a default file; an installer must be an .exe',
  $$SELECT (SELECT r->>'error' LIKE '%license_files_receipt_not_default%'
              FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
                WITH x AS (INSERT INTO public.license_files (tenant_id, product, kind, storage_path, file_name, size_bytes, is_default)
                  VALUES ('70000000-0000-0000-0000-00000000000a', 'office', 'receipt',
                          '70000000-0000-0000-0000-00000000000a/1c000000-0000-0000-0000-0000000000c1.pdf', 'r.pdf', 10, true) RETURNING id)
                SELECT to_jsonb(x) FROM x$q$) r)
       AND (SELECT r->>'error' LIKE '%license_files_ext_matches_kind%'
              FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
                WITH x AS (INSERT INTO public.license_files (tenant_id, product, kind, storage_path, file_name, size_bytes)
                  VALUES ('70000000-0000-0000-0000-00000000000a', 'office', 'installer',
                          '70000000-0000-0000-0000-00000000000a/1c000000-0000-0000-0000-0000000000c2.pdf', 'tool.pdf', 10) RETURNING id)
                SELECT to_jsonb(x) FROM x$q$) r)$$);
SELECT tests.check('LIC: one default per store, product and kind',
  $$SELECT r->>'error' LIKE '%license_files_one_default%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_files (tenant_id, product, kind, storage_path, file_name, size_bytes, is_default)
          VALUES ('70000000-0000-0000-0000-00000000000a', 'office', 'guide',
                  '70000000-0000-0000-0000-00000000000a/1c000000-0000-0000-0000-0000000000c3.pdf', 'g2.pdf', 10, true) RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);

-- ---------- הקבצים במשלוח: סוג נכון, מוצר נכון, לא מהארכיון ----------
SELECT tests.check('LIC: an installer cannot be sent as the PDF guide',
  $$SELECT r->>'error' LIKE '%guide file must be an active guide file%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_deliveries
          (tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone, key_ciphertext, key_tail, key_fingerprint, guide_file_id)
          VALUES ('70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'office', 'שם בדיקה', 'x@example.com', '0501111111',
                  'v1:eA==', 'AAAAA', repeat('c', 64), '1c000000-0000-0000-0000-0000000000a2') RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);
SELECT tests.check('LIC: a Windows license cannot carry the Office guide',
  $$SELECT r->>'error' LIKE '%guide file must be an active guide file%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_deliveries
          (tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone, key_ciphertext, key_tail, key_fingerprint, guide_file_id)
          VALUES ('70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'windows', 'שם בדיקה', 'x@example.com', '0501111111',
                  'v1:eA==', 'AAAAA', repeat('c', 64), '1c000000-0000-0000-0000-0000000000a1') RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);
SELECT tests.check('LIC: an archived installer cannot be sent again',
  $$SELECT r->>'error' LIKE '%installer file must be an active installer file%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_deliveries
          (tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone, key_ciphertext, key_tail, key_fingerprint, installer_file_id)
          VALUES ('70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'office', 'שם בדיקה', 'x@example.com', '0501111111',
                  'v1:eA==', 'AAAAA', repeat('c', 64), '1c000000-0000-0000-0000-0000000000a7') RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);
SELECT tests.check('LIC: a download link must point at an installer (not a guide / receipt)',
  $$SELECT r->>'error' LIKE '%must point to an installer%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_download_links (tenant_id, delivery_id, file_id, token_hash, expires_at)
          VALUES ('70000000-0000-0000-0000-00000000000a', '1d000000-0000-0000-0000-0000000000a1',
                  '1c000000-0000-0000-0000-0000000000a4', tests.lic_hash('x2'), now() + interval '1 day') RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);
SELECT tests.check('LIC: … of the delivery''s own product (no Windows tool on an Office license)',
  $$SELECT r->>'error' LIKE '%must point to an installer%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
        WITH x AS (INSERT INTO public.license_download_links (tenant_id, delivery_id, file_id, token_hash, expires_at)
          VALUES ('70000000-0000-0000-0000-00000000000a', '1d000000-0000-0000-0000-0000000000a1',
                  '1c000000-0000-0000-0000-0000000000a6', tests.lic_hash('x3'), now() + interval '1 day') RETURNING id)
        SELECT to_jsonb(x) FROM x$q$) r$$);

-- ---------- קישור חדש + החלפת קובץ ברירת המחדל לא שוברת קישור קיים ----------
SELECT tests.check('LIC: a new link (regenerate) works with 3 fresh downloads',
  $$SELECT (SELECT (r->>'id') IS NOT NULL FROM tests.lic_server('70000000-0000-0000-0000-00000000000a', $q$
              WITH x AS (INSERT INTO public.license_download_links (tenant_id, delivery_id, file_id, token_hash, expires_at)
                VALUES ('70000000-0000-0000-0000-00000000000a', '1d000000-0000-0000-0000-0000000000a1',
                        '1c000000-0000-0000-0000-0000000000a2', tests.lic_hash('lic-new'), now() + interval '7 days') RETURNING id)
              SELECT to_jsonb(x) FROM x$q$) r)
       AND (SELECT r->>'state' = 'valid' AND (r->>'remaining')::int = 3
              FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                                    $q$SELECT public.license_link_peek(tests.lic_hash('lic-new'))$q$) r)$$);
SELECT tests.check('LIC: the app server switches the default installer',
  $$SELECT (r->>'r')::boolean
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT jsonb_build_object('r', public.license_set_default_file('1c000000-0000-0000-0000-0000000000a3'))$q$) r$$);
SELECT tests.check('LIC: … atomically — exactly one default installer, the new one',
  $$SELECT (SELECT count(*) FROM public.license_files
             WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND product = 'office' AND kind = 'installer' AND is_default) = 1
       AND (SELECT is_default FROM public.license_files WHERE id = '1c000000-0000-0000-0000-0000000000a3')$$);
SELECT tests.check('LIC: … and the link already sent still serves the version it was sent with',
  $$SELECT r->>'file_name' = 'NurielOfficeTool.exe' AND r->>'state' = 'valid'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
                            $q$SELECT public.license_link_peek(tests.lic_hash('lic-new'))$q$) r$$);
SELECT tests.check('LIC: another store cannot switch store A''s default; a receipt / archived file cannot be a default',
  $$SELECT (SELECT NOT (r->>'r')::boolean FROM tests.lic_server('70000000-0000-0000-0000-00000000000b',
              $q$SELECT jsonb_build_object('r', public.license_set_default_file('1c000000-0000-0000-0000-0000000000a2'))$q$) r)
       AND (SELECT NOT (r->>'r')::boolean FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
              $q$SELECT jsonb_build_object('r', public.license_set_default_file('1c000000-0000-0000-0000-0000000000a4'))$q$) r)
       AND (SELECT NOT (r->>'r')::boolean FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
              $q$SELECT jsonb_build_object('r', public.license_set_default_file('1c000000-0000-0000-0000-0000000000a7'))$q$) r)
       AND (SELECT is_default FROM public.license_files WHERE id = '1c000000-0000-0000-0000-0000000000a3')$$);

-- ---------- יומן ----------
SELECT tests.check('LIC: every download and every refusal is in the audit log — without tokens',
  $$SELECT (SELECT count(*) FROM public.license_audit WHERE link_id = '1e000000-0000-0000-0000-0000000000a1' AND action = 'download') = 3
       AND (SELECT count(*) FROM public.license_audit WHERE link_id = '1e000000-0000-0000-0000-0000000000a1' AND action = 'download_denied') = 1
       AND EXISTS (SELECT 1 FROM public.license_audit WHERE link_id = '1e000000-0000-0000-0000-0000000000a2' AND details->>'state' = 'expired')
       AND NOT EXISTS (SELECT 1 FROM public.license_audit
                        WHERE details::text LIKE '%' || tests.lic_hash('lic-valid') || '%' OR details::text LIKE '%lic-valid%')
       AND NOT EXISTS (SELECT 1 FROM public.license_audit WHERE tenant_id = '70000000-0000-0000-0000-00000000000b')$$);
SELECT tests.check('LIC: the audit log cannot be edited, even by the app server',
  $$SELECT r->>'error' LIKE '%append-only%'
      FROM tests.lic_server('70000000-0000-0000-0000-00000000000a',
        $q$WITH x AS (UPDATE public.license_audit SET action = 'send' WHERE action = 'download' RETURNING id) SELECT to_jsonb(x) FROM x$q$) r$$);

-- ---------- מחיקת חנות: הכל נמחק בלי שגיאת מפתח זר ----------
INSERT INTO public.tenants (id, slug, name) VALUES ('70000000-0000-0000-0000-0000000000cc', 'lic-gone', 'חנות שנמחקת');
INSERT INTO public.license_files (id, tenant_id, product, kind, storage_path, file_name, size_bytes, is_default) VALUES
  ('1c000000-0000-0000-0000-0000000000c5', '70000000-0000-0000-0000-0000000000cc', 'office', 'installer',
   '70000000-0000-0000-0000-0000000000cc/1c000000-0000-0000-0000-0000000000c5.exe', 't.exe', 10, true);
INSERT INTO public.license_deliveries (id, tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone,
  key_ciphertext, key_tail, key_fingerprint, installer_file_id) VALUES
  ('1d000000-0000-0000-0000-0000000000c5', '70000000-0000-0000-0000-0000000000cc', gen_random_uuid(), 'office', 'נמחק',
   'gone@example.com', '0500000000', 'v1:eA==', 'AAAAA', repeat('d', 64), '1c000000-0000-0000-0000-0000000000c5');
INSERT INTO public.license_download_links (tenant_id, delivery_id, file_id, token_hash, expires_at) VALUES
  ('70000000-0000-0000-0000-0000000000cc', '1d000000-0000-0000-0000-0000000000c5', '1c000000-0000-0000-0000-0000000000c5',
   tests.lic_hash('lic-gone'), now() + interval '1 day');
INSERT INTO public.license_audit (tenant_id, action, delivery_id) VALUES
  ('70000000-0000-0000-0000-0000000000cc', 'send', '1d000000-0000-0000-0000-0000000000c5');
SELECT tests.run('LIC: the platform''s store deletion goes through the license tables (no foreign-key error)',
  $$SELECT public.platform_delete_tenant('70000000-0000-0000-0000-0000000000cc', 'lic-gone')$$,
  'a0000000-0000-0000-0000-0000000000f0');
SELECT tests.check('LIC: deleting a store removes its files, deliveries, links and log',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.license_files WHERE tenant_id = '70000000-0000-0000-0000-0000000000cc')
       AND NOT EXISTS (SELECT 1 FROM public.license_deliveries WHERE tenant_id = '70000000-0000-0000-0000-0000000000cc')
       AND NOT EXISTS (SELECT 1 FROM public.license_download_links WHERE tenant_id = '70000000-0000-0000-0000-0000000000cc')
       AND NOT EXISTS (SELECT 1 FROM public.license_audit WHERE tenant_id = '70000000-0000-0000-0000-0000000000cc')$$);

-- ---------- ניקוי (הבדיקות הבאות רצות על אותו מסד) ----------
DELETE FROM public.license_audit;
DELETE FROM public.license_download_links;
DELETE FROM public.license_deliveries;
DELETE FROM public.license_files;
DELETE FROM public.tenant_feature_flags WHERE key = 'digital_licenses';
