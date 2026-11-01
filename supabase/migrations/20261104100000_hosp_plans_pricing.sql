-- ============================================================
-- Hospitality — חבילות לצימרים: מחירים, דמי הקמה, פירוט והגבלות (שלב E3)
--
-- החלטת בעל הפלטפורמה: הקמה 2,000 ₪ (חד-פעמי), בסיסית 200 ₪ לחודש, פרימיום 400 ₪ לחודש.
--
--   1. plans — עמודות חדשות:
--        setup_fee        דמי הקמה (חד-פעמי)
--        tagline          משפט קצר לכרטיס החבילה
--        highlights       רשימת התכונות לתצוגה (עד 20)
--        max_properties   מתחמים (NULL = ללא הגבלה)
--        max_media        תמונות וסרטונים לגלריה (1–60; התקרה הטכנית נשארת 60)
--      features (jsonb, קיים) — מה פתוח בחבילה: channels (סנכרון Airbnb / Booking),
--      room_types (סוגי חדרים), promotions (קופונים ומבצעים).
--   2. החבילות (רק אם עוד לא הוגדרו — מחיר NULL; עריכה מהפאנל לא נדרסת):
--        basic    200 ₪, עד 3 יחידות, מתחם 1, 20 לגלריה, רק הבעלים, בלי ערוצים / סוגי חדרים / מבצעים
--        premium  400 ₪ (חדשה), ללא הגבלת יחידות ומתחמים, 60 לגלריה, הבעלים + 5, הכול פתוח
--        trial    ההקמה (14 יום, 20 יחידות) — הכול פתוח
--        pro / enterprise — החבילות הזמניות הקודמות: לא מפורסמות, הכול פתוח (לאתרים שכבר עליהן)
--   3. entitlements(): גם max_properties / properties_used, max_media.
--   4. אכיפה במסד — טריגרים לפני הוספה (כל מסלול, גם בקשות מקבילות):
--        מתחמים (properties), תמונות לגלריה (media), יומני ערוצים וקישור הייצוא
--        (channel_calendars / channel_feeds), סוגי חדרים (unit_categories), מבצעים (promotions).
--      מה שכבר קיים נשאר — מעבר לחבילה קטנה לא מוחק כלום, רק לא מוסיפים.
--   5. לפאנל ולשער:
--        admin_platform_flags() — החבילות עם המחירים והפירוט
--        admin_save_plan(_code, _plan) — עריכת חבילה (מנהל הפלטפורמה בלבד, ביומן)
--        public_plans() — החבילות המפורסמות (לשער — דרך השרת בלבד)
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261104100000_hosp_plans_pricing.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. עמודות
-- ------------------------------------------------------------
ALTER TABLE hospitality.plans ADD COLUMN IF NOT EXISTS setup_fee numeric(10,2)
  CONSTRAINT plans_setup_fee_check CHECK (setup_fee IS NULL OR setup_fee >= 0);
ALTER TABLE hospitality.plans ADD COLUMN IF NOT EXISTS tagline text NOT NULL DEFAULT ''
  CONSTRAINT plans_tagline_check CHECK (char_length(tagline) <= 160);
ALTER TABLE hospitality.plans ADD COLUMN IF NOT EXISTS highlights text[] NOT NULL DEFAULT '{}'
  CONSTRAINT plans_highlights_check CHECK (cardinality(highlights) <= 20);
ALTER TABLE hospitality.plans ADD COLUMN IF NOT EXISTS max_properties integer
  CONSTRAINT plans_max_properties_check CHECK (max_properties IS NULL OR max_properties >= 1);
ALTER TABLE hospitality.plans ADD COLUMN IF NOT EXISTS max_media integer
  CONSTRAINT plans_max_media_check CHECK (max_media IS NULL OR max_media BETWEEN 1 AND 60);
COMMENT ON COLUMN hospitality.plans.setup_fee IS 'דמי הקמה (חד-פעמי); NULL = אין';
COMMENT ON COLUMN hospitality.plans.highlights IS 'רשימת התכונות לתצוגה בכרטיס החבילה';
COMMENT ON COLUMN hospitality.plans.max_properties IS 'מתחמים פעילים; NULL = ללא הגבלה';
COMMENT ON COLUMN hospitality.plans.max_media IS 'תמונות וסרטונים לגלריה; NULL = התקרה הטכנית (60)';
COMMENT ON COLUMN hospitality.plans.features IS 'מה פתוח בחבילה: channels / room_types / promotions (true / false)';

-- ------------------------------------------------------------
-- 2. החבילות
-- ------------------------------------------------------------
INSERT INTO hospitality.plans (code, name, max_units, trial_days, sort_order)
VALUES ('premium', 'פרימיום', NULL, 0, 20)
ON CONFLICT (code) DO NOTHING;

UPDATE hospitality.plans SET
  name = 'בסיסית',
  tagline = 'אתר הזמנות מלא לצימר — עם תמיכה',
  price_monthly = 200, setup_fee = 2000,
  max_units = 3, max_properties = 1, max_media = 20, max_managers = 1,
  features = '{"channels": false, "room_types": false, "promotions": false}'::jsonb,
  highlights = ARRAY[
    'עד 3 יחידות (חדרים / בקתות)',
    'אתר עם הזמנות, לוח זמינות וגלריה',
    'עד 20 תמונות בגלריה',
    'תשלום טלפוני ויומן תשלומים',
    'מיילים לאורחים ולעסק',
    'תמיכה — מענה תוך יום עסקים'],
  is_published = true, sort_order = 10, updated_at = now()
WHERE code = 'basic' AND price_monthly IS NULL;

UPDATE hospitality.plans SET
  name = 'פרימיום',
  tagline = 'בלי הגבלות — עם סנכרון Airbnb / Booking.com ותמיכה מועדפת',
  price_monthly = 400, setup_fee = 2000,
  max_units = NULL, max_properties = NULL, max_media = 60, max_managers = 6,
  features = '{"channels": true, "room_types": true, "promotions": true}'::jsonb,
  highlights = ARRAY[
    'יחידות ומתחמים ללא הגבלה',
    'עד 60 תמונות וסרטונים בגלריה',
    'סנכרון Airbnb / Booking.com — בלי הזמנות כפולות',
    'סוגי חדרים (מצב מלון)',
    'קופונים ומבצעים',
    'עד 5 מנהלים נוספים',
    'תמיכה מועדפת — מענה באותו יום + WhatsApp',
    'עד שעת עדכוני תוכן בחודש',
    'דוח גוגל חודשי'],
  is_published = true, sort_order = 20, updated_at = now()
WHERE code = 'premium' AND price_monthly IS NULL;

-- ההקמה (ניסיון) והחבילות הזמניות הקודמות: הכול פתוח, לא מפורסמות
UPDATE hospitality.plans SET
  features = '{"channels": true, "room_types": true, "promotions": true}'::jsonb,
  max_media = 60,
  tagline = CASE code WHEN 'trial' THEN 'תקופת ההקמה — הכול פתוח' ELSE tagline END,
  sort_order = CASE code WHEN 'trial' THEN 0 WHEN 'pro' THEN 90 ELSE 95 END,
  updated_at = now()
WHERE code IN ('trial', 'pro', 'enterprise') AND features = '{}'::jsonb;

-- ------------------------------------------------------------
-- 3. הזכאות: גם מתחמים ותמונות לגלריה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._properties_used(_tenant_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::integer FROM hospitality.properties x
   WHERE x.tenant_id = _tenant_id AND x.status <> 'archived';
$$;
REVOKE ALL ON FUNCTION hospitality._properties_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality._properties_used(uuid) TO service_role;

CREATE OR REPLACE FUNCTION hospitality.entitlements(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tenants;
  s hospitality.subscriptions;
  p hospitality.plans;
  _implicit boolean := false;
  _active boolean;
  _max integer;
  _max_managers integer;
BEGIN
  SELECT * INTO t FROM public.tenants x WHERE x.id = _tenant_id AND x.site_type = 'hospitality';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM hospitality.subscriptions x WHERE x.tenant_id = _tenant_id;
  IF NOT FOUND THEN
    _implicit := true;
    SELECT * INTO p FROM hospitality.plans x WHERE x.code = 'trial';
    s.plan_code := 'trial';
    s.status := 'trialing';
    s.trial_ends_at := t.created_at + make_interval(days => p.trial_days);
    s.extra_units := 0;
    s.extra_managers := 0;
  ELSE
    SELECT * INTO p FROM hospitality.plans x WHERE x.code = s.plan_code;
  END IF;
  _active := t.status = 'active' AND CASE s.status
    WHEN 'trialing' THEN s.trial_ends_at > now()
    WHEN 'active' THEN s.current_period_end IS NULL OR s.current_period_end > now()
    WHEN 'past_due' THEN s.current_period_end IS NULL OR s.current_period_end + interval '7 days' > now()
    ELSE false END;
  _max := CASE WHEN p.max_units IS NULL THEN NULL ELSE p.max_units + s.extra_units END;
  _max_managers := CASE WHEN p.max_managers IS NULL THEN NULL ELSE p.max_managers + s.extra_managers END;
  RETURN jsonb_build_object(
    'plan', p.code, 'plan_name', p.name, 'status', s.status, 'active', _active, 'implicit', _implicit,
    'trial_ends_at', hospitality._ts(s.trial_ends_at), 'current_period_end', hospitality._ts(s.current_period_end),
    'max_units', _max, 'extra_units', s.extra_units, 'units_used', hospitality._units_used(_tenant_id),
    'max_managers', _max_managers, 'extra_managers', s.extra_managers,
    'managers_used', hospitality._managers_used(_tenant_id),
    'max_properties', p.max_properties, 'properties_used', hospitality._properties_used(_tenant_id),
    'max_media', LEAST(60, COALESCE(p.max_media, 60)),
    'features', p.features);
END $$;

-- תכונה פתוחה בחבילה של האתר? (מפתח חסר / חבילה בלי features = סגור)
CREATE OR REPLACE FUNCTION hospitality._plan_feature(_tenant_id uuid, _feature text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((hospitality.entitlements(_tenant_id) -> 'features' ->> _feature)::boolean, false);
$$;
REVOKE ALL ON FUNCTION hospitality._plan_feature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality._plan_feature(uuid, text) TO service_role;

-- ------------------------------------------------------------
-- 4. אכיפה
-- ------------------------------------------------------------
-- תכונה סגורה בחבילה → אי אפשר להוסיף (TG_ARGV: מפתח התכונה, שם לתצוגה)
CREATE OR REPLACE FUNCTION hospitality.plan_feature_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- לא אתר אירוח (אין זכאות) — החבילות לא רלוונטיות; שומרי סוג האתר מחליטים
  IF hospitality.entitlements(NEW.tenant_id) IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT hospitality._plan_feature(NEW.tenant_id, TG_ARGV[0]) THEN
    RAISE EXCEPTION '% לא כלול בחבילה של האתר — זמין בחבילת פרימיום', TG_ARGV[1]
      USING ERRCODE = 'check_violation', HINT = 'plan_feature:' || TG_ARGV[0];
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.plan_feature_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS channel_calendars_plan_guard ON hospitality.channel_calendars;
CREATE TRIGGER channel_calendars_plan_guard BEFORE INSERT ON hospitality.channel_calendars
FOR EACH ROW EXECUTE FUNCTION hospitality.plan_feature_guard('channels', 'סנכרון יומנים עם Airbnb / Booking.com');
DROP TRIGGER IF EXISTS channel_feeds_plan_guard ON hospitality.channel_feeds;
CREATE TRIGGER channel_feeds_plan_guard BEFORE INSERT ON hospitality.channel_feeds
FOR EACH ROW EXECUTE FUNCTION hospitality.plan_feature_guard('channels', 'קישור הייצוא ליומנים החיצוניים');
DROP TRIGGER IF EXISTS unit_categories_plan_guard ON hospitality.unit_categories;
CREATE TRIGGER unit_categories_plan_guard BEFORE INSERT ON hospitality.unit_categories
FOR EACH ROW EXECUTE FUNCTION hospitality.plan_feature_guard('room_types', 'סוגי חדרים');
DROP TRIGGER IF EXISTS promotions_plan_guard ON hospitality.promotions;
CREATE TRIGGER promotions_plan_guard BEFORE INSERT ON hospitality.promotions
FOR EACH ROW EXECUTE FUNCTION hospitality.plan_feature_guard('promotions', 'קופונים ומבצעים');

-- מתחמים: הוספה / הוצאה מארכיון — לפי המגבלה (נעילה לכל אתר — גם בקשות מקבילות)
CREATE OR REPLACE FUNCTION hospitality.properties_plan_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e jsonb;
BEGIN
  IF NEW.status = 'archived' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'archived' THEN
    RETURN NEW;  -- כבר נספר
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-properties:' || NEW.tenant_id::text, 0));
  e := hospitality.entitlements(NEW.tenant_id);
  IF e IS NULL THEN
    RETURN NEW;  -- לא אתר אירוח
  END IF;
  IF e ->> 'max_properties' IS NOT NULL
     AND hospitality._properties_used(NEW.tenant_id) >= (e ->> 'max_properties')::integer THEN
    RAISE EXCEPTION 'הגעתם למגבלת המתחמים בחבילה (%) — מתחמים נוספים בחבילת פרימיום', e ->> 'max_properties'
      USING ERRCODE = 'check_violation', HINT = 'plan_limit:properties';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.properties_plan_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS properties_plan_guard ON hospitality.properties;
CREATE TRIGGER properties_plan_guard BEFORE INSERT OR UPDATE OF status ON hospitality.properties
FOR EACH ROW EXECUTE FUNCTION hospitality.properties_plan_guard();

-- תמונות וסרטונים לגלריה: לפי החבילה (התקרה הטכנית 60 נשארת בפונקציות של מיגרציה 12)
CREATE OR REPLACE FUNCTION hospitality.media_plan_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e jsonb;
  _max integer;
BEGIN
  e := hospitality.entitlements(NEW.tenant_id);
  IF e IS NULL THEN
    RETURN NEW;  -- לא אתר אירוח
  END IF;
  _max := COALESCE((e ->> 'max_media')::integer, 60);
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-media-plan:' || NEW.tenant_id::text, 0));
  IF (SELECT count(*) FROM hospitality.media x
       WHERE x.tenant_id = NEW.tenant_id
         AND hospitality._media_in_gallery(x, NEW.owner_kind, NEW.property_id, NEW.unit_id)) >= _max THEN
    RAISE EXCEPTION 'הגעתם למגבלת התמונות בגלריה בחבילה (%) — עד 60 בחבילת פרימיום', _max
      USING ERRCODE = 'check_violation', HINT = 'plan_limit:media';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.media_plan_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS media_plan_guard ON hospitality.media;
CREATE TRIGGER media_plan_guard BEFORE INSERT ON hospitality.media
FOR EACH ROW EXECUTE FUNCTION hospitality.media_plan_guard();

-- ------------------------------------------------------------
-- 5. הפאנל והשער
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._plan_json(p hospitality.plans)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'code', p.code, 'name', p.name, 'tagline', p.tagline,
    'price_monthly', p.price_monthly, 'setup_fee', p.setup_fee, 'currency', p.currency,
    'max_units', p.max_units, 'max_properties', p.max_properties,
    'max_media', LEAST(60, COALESCE(p.max_media, 60)), 'max_managers', p.max_managers,
    'trial_days', p.trial_days, 'features', p.features, 'highlights', to_jsonb(p.highlights),
    'is_published', p.is_published, 'sort_order', p.sort_order);
$$;
REVOKE ALL ON FUNCTION hospitality._plan_json(hospitality.plans) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality._plan_json(hospitality.plans) TO service_role;

-- הדגלים הכלליים בפלטפורמה + החבילות (עם המחירים והפירוט) — כמו במיגרציה 15
CREATE OR REPLACE FUNCTION hospitality.admin_platform_flags()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  RETURN jsonb_build_object(
    'backend', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_backend_enabled'), false),
    'management', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_management_enabled'), false),
    'booking', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_booking_enabled'), false),
    'plans', COALESCE((SELECT jsonb_agg(hospitality._plan_json(p) ORDER BY p.sort_order, p.code)
                         FROM hospitality.plans p), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_platform_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_platform_flags() TO authenticated, service_role;

-- עריכת חבילה — מנהל הפלטפורמה בלבד. שדות שלא נשלחו נשארים. ביומן הפלטפורמה.
CREATE OR REPLACE FUNCTION hospitality.admin_save_plan(_code text, _plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p hospitality.plans;
  _d jsonb := COALESCE(_plan, '{}'::jsonb);
  _name text;
  _tagline text;
  _price numeric;
  _setup numeric;
  _highlights text[];
  _features jsonb;
  _int integer;
  _k text;
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF jsonb_typeof(_d) <> 'object' THEN
    RAISE EXCEPTION 'פרטי החבילה חסרים' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM hospitality.plans x WHERE x.code = COALESCE(_code, '') FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החבילה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;

  IF _d ? 'name' THEN
    _name := btrim(regexp_replace(COALESCE(_d ->> 'name', ''), '\s+', ' ', 'g'));
    IF length(_name) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'שם החבילה: 1 עד 60 תווים' USING ERRCODE = 'check_violation';
    END IF;
    p.name := _name;
  END IF;
  IF _d ? 'tagline' THEN
    _tagline := btrim(regexp_replace(COALESCE(_d ->> 'tagline', ''), '\s+', ' ', 'g'));
    IF length(_tagline) > 160 THEN
      RAISE EXCEPTION 'המשפט: עד 160 תווים' USING ERRCODE = 'check_violation';
    END IF;
    p.tagline := _tagline;
  END IF;
  IF _d ? 'price_monthly' THEN
    IF jsonb_typeof(_d -> 'price_monthly') = 'null' THEN
      p.price_monthly := NULL;
    ELSIF jsonb_typeof(_d -> 'price_monthly') <> 'number'
          OR (_d ->> 'price_monthly')::numeric NOT BETWEEN 0 AND 100000 THEN
      RAISE EXCEPTION 'מחיר חודשי: 0 עד 100,000' USING ERRCODE = 'check_violation';
    ELSE
      p.price_monthly := round((_d ->> 'price_monthly')::numeric, 2);
    END IF;
  END IF;
  IF _d ? 'setup_fee' THEN
    IF jsonb_typeof(_d -> 'setup_fee') = 'null' THEN
      p.setup_fee := NULL;
    ELSIF jsonb_typeof(_d -> 'setup_fee') <> 'number'
          OR (_d ->> 'setup_fee')::numeric NOT BETWEEN 0 AND 100000 THEN
      RAISE EXCEPTION 'דמי הקמה: 0 עד 100,000' USING ERRCODE = 'check_violation';
    ELSE
      p.setup_fee := round((_d ->> 'setup_fee')::numeric, 2);
    END IF;
  END IF;
  IF _d ? 'highlights' THEN
    IF jsonb_typeof(_d -> 'highlights') <> 'array' THEN
      RAISE EXCEPTION 'רשימת התכונות לא תקינה' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(array_agg(btrim(regexp_replace(v, '\s+', ' ', 'g')) ORDER BY o), '{}')
      INTO _highlights
      FROM jsonb_array_elements_text(_d -> 'highlights') WITH ORDINALITY AS h(v, o)
     WHERE btrim(v) <> '';
    IF cardinality(_highlights) > 20
       OR EXISTS (SELECT 1 FROM unnest(_highlights) x WHERE length(x) > 80) THEN
      RAISE EXCEPTION 'עד 20 תכונות, כל אחת עד 80 תווים' USING ERRCODE = 'check_violation';
    END IF;
    p.highlights := _highlights;
  END IF;
  -- מגבלות: null = ללא הגבלה (max_media: null = 60)
  FOREACH _k IN ARRAY ARRAY['max_units', 'max_properties', 'max_media', 'max_managers'] LOOP
    IF _d ? _k THEN
      IF jsonb_typeof(_d -> _k) = 'null' THEN
        _int := NULL;
      ELSIF jsonb_typeof(_d -> _k) <> 'number' OR (_d ->> _k) !~ '^\d{1,4}$' THEN
        RAISE EXCEPTION 'מגבלה לא תקינה: %', _k USING ERRCODE = 'check_violation';
      ELSE
        _int := (_d ->> _k)::integer;
      END IF;
      CASE _k
        WHEN 'max_units' THEN p.max_units := _int;
        WHEN 'max_properties' THEN p.max_properties := _int;
        WHEN 'max_media' THEN p.max_media := _int;
        WHEN 'max_managers' THEN p.max_managers := _int;
      END CASE;
    END IF;
  END LOOP;
  IF _d ? 'features' THEN
    IF jsonb_typeof(_d -> 'features') <> 'object' THEN
      RAISE EXCEPTION 'התכונות לא תקינות' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(jsonb_object_agg(k, COALESCE((_d -> 'features' ->> k)::boolean, false)), '{}'::jsonb)
      INTO _features
      FROM unnest(ARRAY['channels', 'room_types', 'promotions']) AS k;
    p.features := _features;
  END IF;
  IF _d ? 'is_published' THEN
    IF jsonb_typeof(_d -> 'is_published') <> 'boolean' THEN
      RAISE EXCEPTION 'הפרסום לא תקין' USING ERRCODE = 'check_violation';
    END IF;
    p.is_published := (_d ->> 'is_published')::boolean;
  END IF;

  UPDATE hospitality.plans x SET
    name = p.name, tagline = p.tagline, price_monthly = p.price_monthly, setup_fee = p.setup_fee,
    highlights = p.highlights, max_units = p.max_units, max_properties = p.max_properties,
    max_media = p.max_media, max_managers = p.max_managers, features = p.features,
    is_published = p.is_published, updated_at = now()
   WHERE x.code = p.code
  RETURNING * INTO p;

  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (NULL, auth.uid(), 'hosp_plan_saved',
          jsonb_build_object('code', p.code, 'price_monthly', p.price_monthly, 'setup_fee', p.setup_fee,
                             'published', p.is_published));
  RETURN hospitality._plan_json(p);
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_save_plan(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_save_plan(text, jsonb) TO authenticated, service_role;

-- החבילות המפורסמות — לשער ולאזור הניהול, דרך השרת בלבד (service_role)
CREATE OR REPLACE FUNCTION hospitality.public_plans()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(hospitality._plan_json(p) - 'is_published' ORDER BY p.sort_order, p.code), '[]'::jsonb)
    FROM hospitality.plans p WHERE p.is_published;
$$;
REVOKE ALL ON FUNCTION hospitality.public_plans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.public_plans() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
