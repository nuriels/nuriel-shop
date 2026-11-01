-- ============================================================
-- הקמת חנות מהשער עם פרטי העסק (שלב E1): portal_create_store_business, portal_set_store_logo
--   • שירות בלבד (לא anon / משתמש מחובר)
--   • בדיקות הקלט — ושום חנות לא נפתחת כשהפרטים לא תקינים
--   • הפרטים נשמרים בשדות של הגדרות החנות (התקנון / המסמכים קוראים מהם): שם רשמי, ח.פ,
--     סוג עוסק (חברה = מורשה; פטור → מע"מ 0), מחירים כוללים מע"מ, טלפון, כתובת, אימייל
--   • לוגו — רק לחנות של האימייל, ורק לנתיב של החנות
-- ============================================================
\set U '''a0000000-0000-0000-0000-0000000e1b01'''
\set U2 '''a0000000-0000-0000-0000-0000000e1b02'''
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000e1b01', 'portal.biz@test.local'),
  ('a0000000-0000-0000-0000-0000000e1b02', 'portal.other@test.local')
ON CONFLICT (id) DO NOTHING;

-- מריץ ומחזיר את הודעת השגיאה (או NULL) — כמנהל המסד, כמו השרת (service_role)
CREATE OR REPLACE FUNCTION pg_temp.err_of(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

-- ---------- הרשאות ----------
SELECT tests.run('portal business: anon cannot create',
  $$SELECT public.portal_create_store_business('portal.biz@test.local', 'חנות', 'pb-anon', '{}'::jsonb)$$,
  NULL, 'permission denied');
SELECT tests.run('portal business: a signed-in store owner cannot call it directly',
  $$SELECT public.portal_create_store_business('portal.biz@test.local', 'חנות', 'pb-owner', '{}'::jsonb)$$,
  'a0000000-0000-0000-0000-0000000000a1', 'permission denied');
SELECT tests.run('portal business: logo setter is service-only',
  $$SELECT public.portal_set_store_logo('owner.a@test.local', '70000000-0000-0000-0000-00000000000a', 'x')$$,
  'a0000000-0000-0000-0000-0000000000a1', 'permission denied');

-- ---------- בדיקות קלט ----------
SELECT tests.check('portal business: legal name required',
  $$SELECT pg_temp.err_of($q$SELECT public.portal_create_store_business('portal.biz@test.local', 'חנות בדיקה', 'pb-bad',
      '{"legal_name":" ","business_type":"authorized","tax_id":"514000001","phone":"050-1234567"}')$q$) LIKE '%שם העסק%'$$);
SELECT tests.check('portal business: business type required',
  $$SELECT pg_temp.err_of($q$SELECT public.portal_create_store_business('portal.biz@test.local', 'חנות בדיקה', 'pb-bad',
      '{"legal_name":"עסק בע\"מ","business_type":"other","tax_id":"514000001","phone":"050-1234567"}')$q$) LIKE '%סוג העסק%'$$);
SELECT tests.check('portal business: tax id must be 5-12 digits',
  $$SELECT pg_temp.err_of($q$SELECT public.portal_create_store_business('portal.biz@test.local', 'חנות בדיקה', 'pb-bad',
      '{"legal_name":"עסק","business_type":"authorized","tax_id":"12ab","phone":"050-1234567"}')$q$) LIKE '%ח.פ%'$$);
SELECT tests.check('portal business: customer-service phone required',
  $$SELECT pg_temp.err_of($q$SELECT public.portal_create_store_business('portal.biz@test.local', 'חנות בדיקה', 'pb-bad',
      '{"legal_name":"עסק","business_type":"authorized","tax_id":"514000001","phone":"123"}')$q$) LIKE '%טלפון%'$$);
SELECT tests.check('portal business: address up to 200 chars',
  $$SELECT pg_temp.err_of(format($q$SELECT public.portal_create_store_business('portal.biz@test.local', 'חנות בדיקה', 'pb-bad', %L)$q$,
      jsonb_build_object('legal_name', 'עסק', 'business_type', 'authorized', 'tax_id', '514000001',
                         'phone', '0501234567', 'address', repeat('א', 201))::text)) LIKE '%כתובת%'$$);
SELECT tests.check('portal business: details must be an object',
  $$SELECT pg_temp.err_of($q$SELECT public.portal_create_store_business('portal.biz@test.local', 'חנות בדיקה', 'pb-bad', '[]')$q$) LIKE '%פרטי העסק%'$$);
SELECT tests.check('portal business: no store was opened by the rejected attempts',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'pb-bad')$$);

-- ---------- עוסק מורשה, מחירים לפני מע"מ ----------
SELECT tests.check('portal business: authorized dealer store opens',
  $$SELECT pg_temp.err_of($q$SELECT public.portal_create_store_business('Portal.Biz@test.local', 'הקפה של דנה', 'pb-authorized',
      '{"legal_name":"  דנה   כהן  ","business_type":"authorized","tax_id":"0-3456789-1","phone":"050-123 4567",
        "prices_include_vat":false,"address":"הרצל 1, תל אביב"}')$q$) IS NULL$$);
SELECT tests.check('portal business: settings filled — name, tax id, type, VAT, phone, address, email',
  $$SELECT s.business_name = 'דנה כהן' AND s.site_title = 'הקפה של דנה' AND s.business_tax_id = '034567891'
       AND s.business_type = 'authorized' AND s.prices_include_vat = false AND s.vat_rate = 18
       AND s.support_phone = '0501234567' AND s.business_phone = '0501234567'
       AND s.business_address = 'הרצל 1, תל אביב' AND s.business_email = 'portal.biz@test.local'
     FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id WHERE t.slug = 'pb-authorized'$$);
SELECT tests.check('portal business: tenant tax id + owner admin role',
  $$SELECT t.tax_id = '034567891' AND t.name = 'הקפה של דנה' AND EXISTS (
       SELECT 1 FROM public.user_roles ur WHERE ur.tenant_id = t.id AND ur.role = 'admin'
          AND ur.user_id = 'a0000000-0000-0000-0000-0000000e1b01')
     FROM public.tenants t WHERE t.slug = 'pb-authorized'$$);
SELECT tests.check('portal business: terms variables come from the new details',
  $$SELECT s.business_name <> '' AND s.business_tax_id <> '' AND s.support_phone <> '' AND s.business_email <> ''
     FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id WHERE t.slug = 'pb-authorized'$$);

-- ---------- עוסק פטור → מע"מ 0 ----------
SELECT tests.check('portal business: exempt dealer store opens',
  $$SELECT pg_temp.err_of($q$SELECT public.portal_create_store_business('portal.biz@test.local', 'יוגה עם רונית', 'pb-exempt',
      '{"legal_name":"רונית לוי","business_type":"exempt","tax_id":"123456782","phone":"+972521234567","prices_include_vat":false}')$q$) IS NULL$$);
SELECT tests.check('portal business: exempt → VAT 0, prices flag irrelevant (true), no address kept empty',
  $$SELECT s.business_type = 'exempt' AND s.vat_rate = 0 AND s.prices_include_vat = true
       AND s.support_phone = '+972521234567' AND s.business_address = ''
     FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id WHERE t.slug = 'pb-exempt'$$);

-- ---------- חברה = מורשה לעניין מע"מ; ברירת מחדל: מחירים כוללים מע"מ ----------
SELECT tests.check('portal business: company store opens',
  $$SELECT pg_temp.err_of($q$SELECT public.portal_create_store_business('portal.biz@test.local', 'גאדג׳טים', 'pb-company',
      '{"legal_name":"גאדג׳טים בע\"מ","business_type":"company","tax_id":"514000001","phone":"03-1234567"}')$q$) IS NULL$$);
SELECT tests.check('portal business: company → authorized, prices include VAT by default',
  $$SELECT s.business_type = 'authorized' AND s.prices_include_vat = true AND s.vat_rate = 18
       AND s.business_name = 'גאדג׳טים בע"מ' AND s.support_phone = '031234567'
     FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id WHERE t.slug = 'pb-company'$$);

-- ---------- הכללים של הפתיחה הרגילה נשמרים (פונקציה אחת) ----------
SELECT tests.check('portal business: taken address refused like the plain flow',
  $$SELECT pg_temp.err_of($q$SELECT public.portal_create_store_business('portal.biz@test.local', 'שוב', 'pb-company',
      '{"legal_name":"עסק","business_type":"authorized","tax_id":"514000001","phone":"0501234567"}')$q$) LIKE '%תפוסה%'$$);
SELECT tests.check('portal business: unknown account refused like the plain flow',
  $$SELECT pg_temp.err_of($q$SELECT public.portal_create_store_business('nobody@test.local', 'חנות', 'pb-nobody',
      '{"legal_name":"עסק","business_type":"authorized","tax_id":"514000001","phone":"0501234567"}')$q$) LIKE '%החשבון לא נמצא%'$$);

-- ---------- לוגו ----------
SELECT tests.check('portal logo: owner sets the logo path of their new store',
  $$SELECT pg_temp.err_of(format($q$SELECT public.portal_set_store_logo('portal.biz@test.local', %L, %L)$q$,
      t.id, t.id || '/site/logo-1730000000000.png')) IS NULL
     FROM public.tenants t WHERE t.slug = 'pb-authorized'$$);
SELECT tests.check('portal logo: saved in the store settings',
  $$SELECT s.logo_path = t.id || '/site/logo-1730000000000.png'
     FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id WHERE t.slug = 'pb-authorized'$$);
SELECT tests.check('portal logo: another account cannot set it',
  $$SELECT pg_temp.err_of(format($q$SELECT public.portal_set_store_logo('portal.other@test.local', %L, %L)$q$,
      t.id, t.id || '/site/logo-1730000000001.png')) LIKE '%לא נמצאה%'
     FROM public.tenants t WHERE t.slug = 'pb-authorized'$$);
SELECT tests.check('portal logo: path of another store refused',
  $$SELECT pg_temp.err_of(format($q$SELECT public.portal_set_store_logo('portal.biz@test.local', %L, %L)$q$,
      t.id, '70000000-0000-0000-0000-00000000000a/site/logo-1730000000002.png')) LIKE '%לא תקין%'
     FROM public.tenants t WHERE t.slug = 'pb-authorized'$$);
SELECT tests.check('portal logo: path traversal refused',
  $$SELECT pg_temp.err_of(format($q$SELECT public.portal_set_store_logo('portal.biz@test.local', %L, %L)$q$,
      t.id, t.id || '/site/../logo-1730000000003.png')) LIKE '%לא תקין%'
     FROM public.tenants t WHERE t.slug = 'pb-authorized'$$);
SELECT tests.check('portal logo: refused attempts did not change the logo',
  $$SELECT s.logo_path = t.id || '/site/logo-1730000000000.png'
     FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id WHERE t.slug = 'pb-authorized'$$);

-- ---------- ניקוי ----------
-- מחיקה כמו בפאנל (platform_delete_tenant מוחק את כל מה ששייך לחנות, כולל הבעלים המוגן)
CREATE OR REPLACE FUNCTION pg_temp.drop_store(_slug text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _t uuid;
BEGIN
  SELECT id INTO _t FROM public.tenants WHERE slug = _slug;
  IF _t IS NULL THEN RETURN; END IF;
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  PERFORM public.platform_delete_tenant(_t, _slug);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;
SELECT pg_temp.drop_store(x) FROM unnest(ARRAY['pb-authorized', 'pb-exempt', 'pb-company']) AS x;
SELECT tests.check('portal business: test stores removed',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug LIKE 'pb-%')$$);
DELETE FROM auth.users WHERE id IN (:U, :U2);
