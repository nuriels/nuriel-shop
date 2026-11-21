-- נופי דורית — "חבילת הכלה VIP" + מדיניות ביטול נפרדת "חבילת כלה" (ההחלטות של בעל המערכת, 21.11.2026)
--
-- טרנזקציה אחת. כל בדיקה שנכשלת — הכול מתבטל ושום דבר לא משתנה.
--   1. בדיקה שהעסק בדיוק כמו בקריאה של 21.11: 202 מיגרציות; היחידות גן עדן VIP (עד 2), אדיר ומוריה (עד 5);
--      מדיניות אחת — "גמישה" (ברירת המחדל, גרסה 2, אותם כללים); 16 תמונות ב-VIP באותו סדר ובאותם גדלים;
--      אין חבילות (אין כפילות) ואין מדיניות בשם "חבילת כלה"; מנהל פלטפורמה אחד (או -v admin=<email>).
--   2. המדיניות "חבילת כלה" — policy_save (כמו מסך "מדיניות ביטול"), לא ברירת מחדל: מקדמה קבועה 1,000 ₪ לכל
--      הזמנה, כשמאשרים את ההזמנה; ביטול בלי דמי ביטול עד 7 ימים לפני ההגעה; מ-6 ימים לפני — 50% מסכום ההזמנה;
--      אי הגעה — הסכום המלא; ביטול מהאתר — בקשה לניהול, לא ביטול אוטומטי.
--   3. החבילה — package_save (כמו מסך "חבילות"): "חבילה מיוחדת" על גן עדן VIP, 2 לילות, 4,000 ₪, עד 2 אורחים,
--      התיאור המלא של בעל המערכת, 11 תמונות (14 ראשונה, ואחריה 10, 5, 4, 12, 13, 6, 7, 9, 3, 8), חדרים נוספים:
--      אדיר ומוריה, 1,200 ₪ ללילה לכל חדר, אפשר את שניהם; ואז package_set_active — מוצגת באתר.
--   4. בדיקה של מה שנשמר, והצעת מחיר כמו באתר (package_rooms_quote, לתאריך בעוד 60 יום): 4,000 + 2 × 2,400 =
--      8,800 ₪; מקדמה 1,000 ₪ לכל הזמנה; לוח הביטול של כל הזמנה.
--   5. בדיקה ש"גמישה", היחידות, התמונות, ההגדרות וההזמנות הקיימות לא השתנו.
-- בשם מנהל הפלטפורמה (יומן הפעולות מראה מי שינה), כשהעסק הוא נופי דורית — כמו "כניסה לניהול" מלוח הפלטפורמה.
-- בלי הזמנה, בלי תשלום, בלי מייל. אחרי ה-COMMIT — דוח לקריאה בלבד (READ ONLY): מה נשמר, הכתובת באתר, והזמינות.
-- שימוש (⛔ רק באישור): docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
--        < scripts/hospitality/nofi-dorit-bridal-package.sql
\set ON_ERROR_STOP on
\pset pager off
\if :{?admin}
SELECT set_config('bridal.admin_email', :'admin', false) IS NOT NULL AS ok \gset
\else
SELECT set_config('bridal.admin_email', '', false) IS NOT NULL AS ok \gset
\endif

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $bridal$
DECLARE
  -- ההחלטות (21.11.2026) ---------------------------------------------------------------------------------------
  c_slug        constant text := 'nofi-dorit';
  c_name        constant text := 'חבילת הכלה VIP – רגעים של קסם בנופי דורית ❤️';
  c_desc        constant text := $desc$היום המיוחד שלך מתחיל בחוויה בלתי נשכחת! בואי ליהנות משני לילות של פינוק, שלווה ואווירה קסומה ביחידת גן עדן VIP במתחם נופי דורית.

היחידה מציעה מרחב נעים ומפנק להתארגנות הכלה, כולל פינת איפור עם מראה, לצד פרטיות ואווירה רגועה עם האנשים הקרובים אלייך.

במהלך השהות תוכלו ליהנות מהחצר המטופחת, מהבריכה המשותפת, מאפשרות לערוך על האש ולבלות יחד באווירה מיוחדת. בקרוב צפויה להתווסף גם אפשרות ליהנות מג'קוזי מפנק במתחם.

ניתן להוסיף יחידות אירוח נוספות למלוות ולבני המשפחה, בהתאם לזמינות ובתשלום נוסף.

כי היום שלך ראוי להתחיל ברגעים של קסם, רוגע ופינוק – בנופי דורית.$desc$;
  c_policy      constant text := 'חבילת כלה';
  c_tiers       constant jsonb := '[{"from_days": 6, "fee": "percent_total", "value": 50}]';
  c_price       constant numeric := 4000;
  c_nights      constant integer := 2;
  c_guests      constant integer := 2;
  c_room_price  constant numeric := 1200;
  c_deposit     constant numeric := 1000;
  -- התמונות לפי המספור בקריאה של 21.11 (סדר הגלריה של VIP: sort_order, created_at, id)
  c_pick        constant integer[] := ARRAY[14, 10, 5, 4, 12, 13, 6, 7, 9, 3, 8];
  c_sizes       constant text[] := ARRAY['600x400', '180x120', '600x400', '600x400', '600x400', '600x400', '600x400',
                                         '600x400', '600x400', '600x400', '600x400', '900x600', '900x600', '900x600',
                                         '900x600', '900x600'];
  -- the slug package_save makes from the name (hospitality._package_slug)
  c_url_slug    constant text := 'חבילת-הכלה-vip-רגעים-של-קסם-בנופי-דורית';
  -- -----------------------------------------------------------------------------------------------------------------
  _t uuid;
  _tz text;
  _admin uuid;
  _admins integer;
  _n integer;
  _vip uuid;
  _adir uuid;
  _moriah uuid;
  _sizes text[];
  _cover integer[];
  _media uuid[];
  _flex hospitality.policies;
  _fp_flex text;
  _fp_units text;
  _fp_media text;
  _fp_settings text;
  _fp_bookings text;
  _bookings integer;
  _pol jsonb;
  _pol_id uuid;
  _pkg jsonb;
  _pkg_id uuid;
  p hospitality.packages;
  np hospitality.policies;
  _d date;
  _rooms jsonb;
  _q jsonb;
  _r jsonb;
BEGIN
  -- 0. הטקסטים הגיעו בדיוק כמו שנכתבו (UTF-8, בלי שינוי בדרך)
  IF md5(c_name) <> 'd8d3f785c2a1371c06a7f34b6f4a2a69' OR md5(c_desc) <> '0d68bf1882018655de7333c895b02845' THEN
    RAISE EXCEPTION 'עצירה: השם או התיאור לא הגיעו בדיוק כמו שנכתבו (קידוד) — שום דבר לא השתנה';
  END IF;
  -- 1. העסק — בדיוק כמו בקריאה של 21.11 ---------------------------------------------------------------------------
  SELECT t.id INTO _t FROM public.tenants t
   WHERE t.slug = c_slug AND t.site_type = 'hospitality' AND t.status = 'active';
  IF _t IS NULL THEN
    RAISE EXCEPTION 'עצירה: % אינו עסק אירוח פעיל — שום דבר לא השתנה', c_slug;
  END IF;
  SELECT s.timezone INTO _tz FROM hospitality.settings s WHERE s.tenant_id = _t;
  IF (SELECT count(*) FROM public._migrations_applied) <> 202
     OR NOT EXISTS (SELECT 1 FROM public._migrations_applied
                     WHERE filename = '20261121100000_hosp_package_addon_rooms.sql') THEN
    RAISE EXCEPTION 'עצירה: צפויות 202 מיגרציות כולל 202 (החדרים הנוספים) — שום דבר לא השתנה';
  END IF;
  -- מי מבצע: מנהל הפלטפורמה (ההרשאה "כניסה לניהול"), לא בעל העסק
  SELECT count(*) INTO _admins FROM public.platform_admins;
  IF current_setting('bridal.admin_email', true) <> '' THEN
    SELECT a.user_id INTO _admin FROM public.platform_admins a JOIN auth.users u ON u.id = a.user_id
     WHERE lower(u.email) = lower(current_setting('bridal.admin_email'));
  ELSIF _admins = 1 THEN
    SELECT a.user_id INTO _admin FROM public.platform_admins a;
  END IF;
  IF _admin IS NULL THEN
    RAISE EXCEPTION 'עצירה: לא ברור מי מנהל הפלטפורמה (% מנהלים) — להריץ שוב עם -v admin=<email>; שום דבר לא השתנה', _admins;
  END IF;
  IF (SELECT count(*) FROM public.user_roles ur
       WHERE ur.tenant_id = _t AND ur.role = 'admin' AND ur.is_protected AND NOT ur.is_blocked) <> 1 THEN
    RAISE EXCEPTION 'עצירה: צפוי בעל עסק אחד בנופי דורית — שום דבר לא השתנה';
  END IF;
  -- אין כפילות: אין עדיין חבילה בעסק, ואין מדיניות בשם הזה
  SELECT count(*) INTO _n FROM hospitality.packages x WHERE x.tenant_id = _t;
  IF _n <> 0 THEN
    RAISE EXCEPTION 'עצירה: כבר יש בעסק % חבילות — לא יוצרים כפילות; שום דבר לא השתנה', _n;
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.policies x WHERE x.tenant_id = _t AND btrim(x.name) = c_policy) THEN
    RAISE EXCEPTION 'עצירה: כבר יש מדיניות בשם "%" — לא יוצרים כפילות; שום דבר לא השתנה', c_policy;
  END IF;
  -- "גמישה" — המדיניות היחידה, ברירת המחדל, גרסה 2, הכללים שנקראו
  SELECT count(*) INTO _n FROM hospitality.policies x WHERE x.tenant_id = _t;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'עצירה: צפויה מדיניות אחת ("גמישה"), נמצאו % — שום דבר לא השתנה', _n;
  END IF;
  SELECT * INTO _flex FROM hospitality.policies x WHERE x.tenant_id = _t;
  IF _flex.name <> 'גמישה' OR NOT _flex.is_default OR _flex.is_archived OR _flex.version <> 2
     OR _flex.deposit_kind <> 'none' OR _flex.deposit_due <> 'approval' OR _flex.free_cancel_days IS DISTINCT FROM 7
     OR _flex.free_cancel_time IS NOT NULL OR _flex.fee_tiers <> c_tiers OR _flex.no_show_fee <> 'full'
     OR _flex.auto_cancel <> 'never' THEN
    RAISE EXCEPTION 'עצירה: המדיניות "גמישה" לא כמו בקריאה של 21.11 — שום דבר לא השתנה';
  END IF;
  -- היחידות: VIP (עד 2), אדיר ומוריה (עד 5) — כל אחת פעם אחת, פעילה, לא "כל המתחם" ולא חדר מלון לפי סוג
  SELECT count(*), min(u.id::text)::uuid INTO _n, _vip FROM hospitality.units u
   WHERE u.tenant_id = _t AND u.name = 'גן עדן VIP' AND u.kind = 'unit' AND u.capacity = 2 AND u.is_active
     AND u.category_id IS NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'עצירה: היחידה "גן עדן VIP" (עד 2) לא נמצאה פעם אחת — שום דבר לא השתנה'; END IF;
  SELECT count(*), min(u.id::text)::uuid INTO _n, _adir FROM hospitality.units u
   WHERE u.tenant_id = _t AND u.name = 'אדיר' AND u.kind = 'unit' AND u.capacity = 5 AND u.is_active
     AND u.category_id IS NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'עצירה: היחידה "אדיר" (עד 5) לא נמצאה פעם אחת — שום דבר לא השתנה'; END IF;
  SELECT count(*), min(u.id::text)::uuid INTO _n, _moriah FROM hospitality.units u
   WHERE u.tenant_id = _t AND u.name = 'מוריה' AND u.kind = 'unit' AND u.capacity = 5 AND u.is_active
     AND u.category_id IS NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'עצירה: היחידה "מוריה" (עד 5) לא נמצאה פעם אחת — שום דבר לא השתנה'; END IF;
  -- התמונות של VIP: 16, באותו סדר ובאותם גדלים, הראשונה — תמונת השער
  SELECT array_agg(m.width || 'x' || m.height ORDER BY m.sort_order, m.created_at, m.id),
         array_agg(x.n ORDER BY x.n) FILTER (WHERE m.is_cover)
    INTO _sizes, _cover
    FROM hospitality.media m
    JOIN (SELECT y.id, row_number() OVER (ORDER BY y.sort_order, y.created_at, y.id)::integer AS n
            FROM hospitality.media y
           WHERE y.tenant_id = _t AND y.owner_kind = 'unit' AND y.unit_id = _vip AND y.kind = 'image') x ON x.id = m.id;
  IF _sizes IS DISTINCT FROM c_sizes OR _cover IS DISTINCT FROM ARRAY[1] THEN
    RAISE EXCEPTION 'עצירה: התמונות של VIP לא כמו בקריאה של 21.11 (%) — שום דבר לא השתנה', array_to_string(_sizes, ' ');
  END IF;
  SELECT array_agg(x.id ORDER BY k.ord) INTO _media
    FROM (SELECT y.id, row_number() OVER (ORDER BY y.sort_order, y.created_at, y.id)::integer AS n
            FROM hospitality.media y
           WHERE y.tenant_id = _t AND y.owner_kind = 'unit' AND y.unit_id = _vip AND y.kind = 'image') x
    JOIN unnest(c_pick) WITH ORDINALITY AS k(n, ord) ON k.n = x.n;
  IF cardinality(_media) IS DISTINCT FROM 11 THEN
    RAISE EXCEPTION 'עצירה: לא נמצאו 11 התמונות שנבחרו — שום דבר לא השתנה';
  END IF;
  -- טביעות אצבע של מה שאסור לשנות
  _fp_flex := md5(row_to_json(_flex)::text);
  SELECT md5(string_agg(row_to_json(u)::text, '|' ORDER BY u.id)) INTO _fp_units FROM hospitality.units u WHERE u.tenant_id = _t;
  SELECT md5(string_agg(row_to_json(m)::text, '|' ORDER BY m.id)) INTO _fp_media FROM hospitality.media m WHERE m.tenant_id = _t;
  SELECT md5(row_to_json(s)::text) INTO _fp_settings FROM hospitality.settings s WHERE s.tenant_id = _t;
  SELECT count(*), md5(COALESCE(string_agg(row_to_json(b)::text, '|' ORDER BY b.id), ''))
    INTO _bookings, _fp_bookings FROM hospitality.bookings b WHERE b.tenant_id = _t;
  RAISE NOTICE 'בדיקה מקדימה — תקין: 202 מיגרציות; VIP (עד 2), אדיר ומוריה (עד 5); "גמישה" גרסה 2; 16 תמונות ב-VIP; 0 חבילות; % הזמנות קיימות', _bookings;

  -- 2. מי מבצע: מנהל הפלטפורמה, בתוך העסק (כמו "כניסה לניהול") -----------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', _admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.headers',
                     json_build_object('x-tenant-id', _t, 'user-agent', 'ops: nofi-dorit bridal package')::text, true);

  -- 3. המדיניות "חבילת כלה" ------------------------------------------------------------------------------------------
  _pol := hospitality.policy_save(NULL, jsonb_build_object(
            'name', c_policy, 'deposit_kind', 'fixed', 'deposit_value', c_deposit, 'deposit_due', 'approval',
            'free_cancel_days', 7, 'fee_tiers', c_tiers, 'no_show_fee', 'full', 'auto_cancel', 'never'), NULL);
  _pol_id := (_pol ->> 'id')::uuid;

  -- 4. החבילה (package_save יוצרת אותה מוסתרת) ואז הצגה באתר ----------------------------------------------------------
  _pkg := hospitality.package_save(
            _id => NULL, _unit_id => _vip, _kind => 'special', _name => c_name, _nights => c_nights, _price => c_price,
            _max_guests => c_guests, _description => c_desc, _terms => NULL, _stay_from => NULL, _stay_to => NULL,
            _policy_id => _pol_id, _media_ids => _media, _expected_revision => NULL,
            _addons => jsonb_build_object('unit_ids', jsonb_build_array(_adir, _moriah),
                                          'nightly_price', c_room_price, 'max', 2));
  _pkg_id := (_pkg ->> 'id')::uuid;
  PERFORM hospitality.package_set_active(_pkg_id, true);

  -- 5. מה נשמר -------------------------------------------------------------------------------------------------------
  SELECT * INTO np FROM hospitality.policies x WHERE x.id = _pol_id;
  IF NOT (np.tenant_id = _t AND np.name = c_policy AND NOT np.is_default AND NOT np.is_archived
          AND np.deposit_kind = 'fixed' AND np.deposit_value = c_deposit AND np.deposit_due = 'approval'
          AND np.free_cancel_days = 7 AND np.free_cancel_time IS NULL AND np.fee_tiers = c_tiers
          AND np.no_show_fee = 'full' AND np.no_show_value = 0 AND np.auto_cancel = 'never' AND np.guest_text IS NULL) THEN
    RAISE EXCEPTION 'עצירה: המדיניות נשמרה אחרת ממה שהוחלט — הכול מתבטל';
  END IF;
  SELECT * INTO p FROM hospitality.packages x WHERE x.id = _pkg_id;
  IF NOT (p.tenant_id = _t AND p.unit_id = _vip AND p.kind = 'special' AND p.name = c_name AND p.nights = c_nights
          AND p.price = c_price AND p.max_guests = c_guests AND p.description = c_desc AND p.terms IS NULL
          AND p.stay_from IS NULL AND p.stay_to IS NULL AND p.policy_id = _pol_id AND p.media_ids = _media
          AND p.addon_unit_ids = ARRAY[_adir, _moriah] AND p.addon_nightly_price = c_room_price AND p.addon_max = 2
          AND p.is_active AND p.slug = c_url_slug) THEN
    RAISE EXCEPTION 'עצירה: החבילה נשמרה אחרת ממה שהוחלט (slug: %) — הכול מתבטל', p.slug;
  END IF;
  IF (SELECT count(*) FROM hospitality.packages x WHERE x.tenant_id = _t) <> 1
     OR (SELECT count(*) FROM hospitality.policies x WHERE x.tenant_id = _t) <> 2
     OR (SELECT x.id FROM hospitality.policies x WHERE x.tenant_id = _t AND x.is_default) <> _flex.id THEN
    RAISE EXCEPTION 'עצירה: מספר החבילות / המדיניות לא כצפוי — הכול מתבטל';
  END IF;
  RAISE NOTICE 'נוצרה המדיניות "%": מקדמה קבועה % ₪ לכל הזמנה (כשמאשרים); ביטול בלי דמי ביטול עד 7 ימים לפני; מ-6 ימים — 50%%; אי הגעה — הסכום המלא; ביטול מהאתר — בקשה לניהול', c_policy, c_deposit;
  RAISE NOTICE 'נוצרה החבילה "%": חבילה מיוחדת, % לילות, % ₪, עד % אורחים, % תמונות, חדרים נוספים אדיר + מוריה ב-% ₪ ללילה (עד 2), מוצגת באתר',
               p.name, p.nights, p.price, p.max_guests, cardinality(p.media_ids), p.addon_nightly_price;

  -- 6. הצעת מחיר כמו באתר (שרת האתר: service_role, בלי משתמש), לתאריך בעוד 60 יום ---------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  _d := (now() AT TIME ZONE COALESCE(_tz, 'Asia/Jerusalem'))::date + 60;
  _rooms := jsonb_build_array(jsonb_build_object('unit_id', _adir, 'adults', 2, 'children', 0),
                              jsonb_build_object('unit_id', _moriah, 'adults', 2, 'children', 0));
  _q := hospitality.package_rooms_quote(_pkg_id, _d, 2, 0, _rooms);
  IF NOT ((_q ->> 'total')::numeric = c_price AND (_q ->> 'deposit_amount')::numeric = c_deposit
          AND (_q ->> 'rooms_total')::numeric = 2 * c_nights * c_room_price
          AND (_q ->> 'grand_total')::numeric = c_price + 2 * c_nights * c_room_price
          AND _q -> 'policy' ->> 'name' = c_policy AND jsonb_array_length(_q -> 'rooms') = 2) THEN
    RAISE EXCEPTION 'עצירה: הצעת המחיר לא כצפוי (%) — הכול מתבטל', _q::text;
  END IF;
  FOR _r IN SELECT x FROM jsonb_array_elements(_q -> 'rooms') x LOOP
    IF NOT ((_r ->> 'nightly_price')::numeric = c_room_price AND (_r ->> 'nights_count')::integer = c_nights
            AND (_r ->> 'total')::numeric = c_nights * c_room_price AND (_r ->> 'deposit_amount')::numeric = c_deposit
            AND _r -> 'policy' ->> 'name' = c_policy) THEN
      RAISE EXCEPTION 'עצירה: הצעת המחיר לחדר הנוסף לא כצפויה (%) — הכול מתבטל', _r::text;
    END IF;
  END LOOP;
  RAISE NOTICE 'הצעת מחיר (הגעה %, עזיבה %): החבילה % ₪ (מקדמה %) + אדיר % ₪ (מקדמה %) + מוריה % ₪ (מקדמה %) = % ₪; מקדמות: % ₪',
               _d, _q ->> 'check_out', _q ->> 'total', _q ->> 'deposit_amount',
               _q -> 'rooms' -> 0 ->> 'total', _q -> 'rooms' -> 0 ->> 'deposit_amount',
               _q -> 'rooms' -> 1 ->> 'total', _q -> 'rooms' -> 1 ->> 'deposit_amount', _q ->> 'grand_total',
               (_q ->> 'deposit_amount')::numeric + (_q -> 'rooms' -> 0 ->> 'deposit_amount')::numeric
                 + (_q -> 'rooms' -> 1 ->> 'deposit_amount')::numeric;
  RAISE NOTICE 'לוח הביטול של החבילה: %', _q -> 'policy' -> 'schedule';
  RAISE NOTICE 'לוח הביטול של חדר נוסף: %', _q -> 'rooms' -> 0 -> 'policy' -> 'schedule';

  -- 7. מה שאסור היה לשנות — לא השתנה ------------------------------------------------------------------------------
  IF md5(row_to_json((SELECT x FROM hospitality.policies x WHERE x.id = _flex.id))::text) <> _fp_flex THEN
    RAISE EXCEPTION 'עצירה: "גמישה" השתנתה — הכול מתבטל';
  END IF;
  IF (SELECT md5(string_agg(row_to_json(u)::text, '|' ORDER BY u.id)) FROM hospitality.units u WHERE u.tenant_id = _t) <> _fp_units
     OR (SELECT md5(string_agg(row_to_json(m)::text, '|' ORDER BY m.id)) FROM hospitality.media m WHERE m.tenant_id = _t) <> _fp_media
     OR (SELECT md5(row_to_json(s)::text) FROM hospitality.settings s WHERE s.tenant_id = _t) <> _fp_settings
     OR (SELECT md5(COALESCE(string_agg(row_to_json(b)::text, '|' ORDER BY b.id), '')) FROM hospitality.bookings b
          WHERE b.tenant_id = _t) <> _fp_bookings THEN
    RAISE EXCEPTION 'עצירה: יחידות / תמונות / הגדרות / הזמנות השתנו — הכול מתבטל';
  END IF;
  RAISE NOTICE 'לא השתנו: "גמישה", היחידות, התמונות, ההגדרות, % ההזמנות הקיימות', _bookings;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
END $bridal$;
COMMIT;

-- ===================================================================================================================
-- דוח אחרי השמירה — קריאה בלבד (READ ONLY, בסוף ROLLBACK): מה נשמר, הכתובת באתר, והזמינות ב-120 הימים הבאים
-- ===================================================================================================================
BEGIN READ ONLY;
SELECT set_config('request.headers', json_build_object('x-tenant-id', t.id)::text, true) IS NOT NULL AS h,
       set_config('request.jwt.claim.role', 'service_role', true) IS NOT NULL AS r,
       set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true) IS NOT NULL AS c
  FROM public.tenants t WHERE t.slug = 'nofi-dorit' \gset
\echo '== החבילה כפי שנשמרה'
SELECT p.name AS "שם", p.kind AS "סוג", p.nights AS "לילות", p.price AS "מחיר", p.max_guests AS "אורחים",
       p.is_active AS "מוצגת", cardinality(p.media_ids) AS "תמונות",
       (SELECT string_agg(u.name, ' + ' ORDER BY array_position(p.addon_unit_ids, u.id))
          FROM hospitality.units u WHERE u.id = ANY (p.addon_unit_ids)) AS "חדרים נוספים",
       p.addon_nightly_price AS "ללילה", p.addon_max AS "עד", po.name AS "מדיניות"
  FROM hospitality.packages p JOIN public.tenants t ON t.id = p.tenant_id
  LEFT JOIN hospitality.policies po ON po.id = p.policy_id
 WHERE t.slug = 'nofi-dorit';
\echo '== המדיניות של העסק'
SELECT po.name AS "שם", po.is_default AS "ברירת מחדל", po.version AS "גרסה", po.deposit_kind AS "מקדמה",
       po.deposit_value AS "סכום", po.deposit_due AS "מתי", po.free_cancel_days AS "חינם עד (ימים)",
       po.fee_tiers AS "מדרגות", po.no_show_fee AS "אי הגעה", po.auto_cancel AS "ביטול מהאתר"
  FROM hospitality.policies po JOIN public.tenants t ON t.id = po.tenant_id
 WHERE t.slug = 'nofi-dorit' ORDER BY po.is_default DESC, po.name;
\echo '== הכתובת באתר'
SELECT 'https://nofi-dorit.nuri1.fit/stay/packages/'
       || (SELECT string_agg(CASE WHEN c ~ '^[A-Za-z0-9_.~-]$' THEN c
                                  ELSE regexp_replace(upper(encode(convert_to(c, 'UTF8'), 'hex')), '(..)', '%\1', 'g') END,
                             '' ORDER BY i)
             FROM regexp_split_to_table(p.slug, '') WITH ORDINALITY AS x(c, i)) AS url
  FROM hospitality.packages p JOIN public.tenants t ON t.id = p.tenant_id WHERE t.slug = 'nofi-dorit';
\echo '== הזמינות ב-120 הימים הבאים (הגעה, 2 לילות): תאריכים שהחבילה פנויה בהם, ואילו חדרים נוספים פנויים'
WITH pk AS (
  SELECT p.id, (now() AT TIME ZONE s.timezone)::date AS today
    FROM hospitality.packages p JOIN public.tenants t ON t.id = p.tenant_id
    JOIN hospitality.settings s ON s.tenant_id = t.id
   WHERE t.slug = 'nofi-dorit'),
d AS (
  SELECT g::date AS d, hospitality.package_rooms_quote(pk.id, g::date, 2, 0, '[]'::jsonb) AS q,
         hospitality.package_addons_quote(pk.id, g::date) AS a
    FROM pk, generate_series(pk.today + 1, pk.today + 120, interval '1 day') g)
SELECT count(*) FILTER (WHERE (q ->> 'available')::boolean) AS "ימי הגעה פנויים לחבילה",
       count(*) FILTER (WHERE (q ->> 'available')::boolean AND jsonb_array_length(a -> 'units') = 2) AS "עם שני החדרים",
       count(*) FILTER (WHERE (q ->> 'available')::boolean AND jsonb_array_length(a -> 'units') = 1) AS "עם חדר אחד",
       count(*) FILTER (WHERE (q ->> 'available')::boolean AND jsonb_array_length(a -> 'units') = 0) AS "בלי חדר נוסף",
       min(d) FILTER (WHERE (q ->> 'available')::boolean) AS "ההגעה הקרובה"
  FROM d;
WITH pk AS (
  SELECT p.id, (now() AT TIME ZONE s.timezone)::date AS today
    FROM hospitality.packages p JOIN public.tenants t ON t.id = p.tenant_id
    JOIN hospitality.settings s ON s.tenant_id = t.id
   WHERE t.slug = 'nofi-dorit'),
d AS (
  SELECT g::date AS d, hospitality.package_rooms_quote(pk.id, g::date, 2, 0, '[]'::jsonb) AS q,
         hospitality.package_addons_quote(pk.id, g::date) AS a
    FROM pk, generate_series(pk.today + 1, pk.today + 120, interval '1 day') g)
SELECT d AS "הגעה", (q ->> 'check_out')::date AS "עזיבה", (q ->> 'total')::numeric AS "החבילה",
       COALESCE((SELECT string_agg(u ->> 'unit_name' || ' ' || (u ->> 'total'), ', ')
                   FROM jsonb_array_elements(a -> 'units') u), '—') AS "חדרים נוספים פנויים (לשני לילות)"
  FROM d WHERE (q ->> 'available')::boolean ORDER BY d LIMIT 8;
\echo '== ג׳קוזי באתר היום (קריאה בלבד; הסקריפט לא נוגע בזה): מתקן ברשימת המתקנים / טקסט באתר / תיאור יחידה או מתחם'
SELECT 'מתקן ברשימה: ' || a.name || ' — ' || COALESCE(u.name, pr.name, '') AS "איפה זה מופיע כרגע"
  FROM hospitality.unit_amenities l
  JOIN hospitality.amenities a ON a.id = l.amenity_id
  JOIN public.tenants t ON t.id = l.tenant_id
  LEFT JOIN hospitality.units u ON u.id = l.unit_id
  LEFT JOIN hospitality.properties pr ON pr.id = l.property_id
 WHERE t.slug = 'nofi-dorit' AND (a.preset_code = 'jacuzzi' OR a.name ~* '(קוזי|jacuzzi)')
UNION ALL
SELECT 'טקסט באתר (הגרסה המפורסמת ' || v.version || ')'
  FROM hospitality.site_versions v JOIN public.tenants t ON t.id = v.tenant_id
 WHERE t.slug = 'nofi-dorit' AND v.kind = 'published' AND v.document::text ~* '(קוזי|jacuzzi)'
   AND v.version = (SELECT max(x.version) FROM hospitality.site_versions x WHERE x.tenant_id = v.tenant_id AND x.kind = 'published')
UNION ALL
SELECT 'תיאור היחידה: ' || u.name
  FROM hospitality.units u JOIN public.tenants t ON t.id = u.tenant_id
 WHERE t.slug = 'nofi-dorit' AND u.description ~* '(קוזי|jacuzzi)'
UNION ALL
SELECT 'תיאור המתחם: ' || pr.name
  FROM hospitality.properties pr JOIN public.tenants t ON t.id = pr.tenant_id
 WHERE t.slug = 'nofi-dorit' AND (pr.description ~* '(קוזי|jacuzzi)' OR pr.guest_info ~* '(קוזי|jacuzzi)');
\echo '== תאריכים פתוחים להזמנה באתר (open_until)'
SELECT u.name AS "יחידה", u.open_until AS "פתוח עד"
  FROM hospitality.units u JOIN public.tenants t ON t.id = u.tenant_id
 WHERE t.slug = 'nofi-dorit' AND u.name IN ('גן עדן VIP', 'אדיר', 'מוריה') ORDER BY u.sort_order;
ROLLBACK;
