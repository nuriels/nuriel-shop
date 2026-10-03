-- ============================================================
-- חלק 12: שער הכניסה לפלטפורמה (החנות nuriel-app2)
--
-- באתר של nuriel-app2 במקום הקטלוג מוצג דף נחיתה של הפלטפורמה: מזינים
-- אימייל → קוד למייל (אותו מנגנון קודים של חלק 8) → רואים את החנויות
-- שלכם, או פותחים חנות חדשה בעצמכם (שם + כתובת באנגלית) ונכנסים ישר
-- לניהול שלה.
--
-- • tenant_slug_problem — בדיקת הכתובת (פורמט / שמורה / תפוסה) בלי בדיקת
--   הרשאה, לשימוש השרת בלבד. platform_slug_problem של פאנל הפלטפורמה
--   נשארת כמו שהיא (מנהל-על בלבד) וקוראת לה — אותה בדיקה בשני המקומות.
-- • portal_account — מה שהשער צריך לדעת על כתובת מייל מאומתת: החשבון,
--   החנויות שהיא מנהלת, ושיוך אחר (לקוח / צוות בחנות אחרת) שמונע פתיחת
--   חנות. חשבון התחברות אחד לכל מייל בכל הפלטפורמה (user_roles.user_id
--   הוא המפתח) — ולכן מייל אחד מנהל חנות אחת.
-- • portal_create_store — הקמת חנות ע"י בעליה: החנות (שורות ההגדרות
--   נוצרות בטריגר tenants_seed_settings), שם העסק בהגדרות, ושורת מנהל
--   (role = admin) למשתמש — הכל בטרנזקציה אחת. חשבון ההתחברות (Auth)
--   נוצר קודם בשרת האפליקציה.
-- • portal_store_state — מצב חנות של הבעלים (כולל תעודת ה-SSL של הכתובת
--   החדשה): השער מחכה שהתעודה תונפק לפני שהוא שולח לשם.
-- • platform_admin_handoffs.kind — קוד הכניסה החד-פעמי לאתר החנות משמש
--   עכשיו גם את בעלי החנות (store_owner), לא רק מנהל-על.
-- כל הפונקציות כאן — service_role בלבד (השער לא מחובר כמשתמש של Supabase;
-- השרת מאמת את המייל בקוד ומחזיק אסימון חתום משלו).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. בדיקת כתובת אחת לפאנל הפלטפורמה ולשער
-- ------------------------------------------------------------
-- NULL = הכתובת תקינה ופנויה; אחרת — הסיבה, בעברית, להצגה בטופס
CREATE OR REPLACE FUNCTION public.tenant_slug_problem(_slug text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s text := lower(btrim(COALESCE(_slug, '')));
BEGIN
  IF _s = '' THEN
    RETURN 'יש להזין כתובת באנגלית';
  END IF;
  IF _s !~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$' THEN
    RETURN 'כתובת: 3-63 תווים, אותיות אנגליות קטנות, ספרות ומקפים (לא בהתחלה או בסוף)';
  END IF;
  IF _s = ANY (public.platform_reserved_slugs()) OR _s LIKE 'api-%' THEN
    RETURN format('הכתובת "%s" שמורה — בחרו כתובת אחרת', _s);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = _s) THEN
    RETURN format('הכתובת "%s" כבר תפוסה ע"י חנות אחרת', _s);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.tenant_slug_problem(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_slug_problem(text) TO service_role;

-- פאנל הפלטפורמה: אותה בדיקה, רק למנהל-על (כמו קודם)
CREATE OR REPLACE FUNCTION public.platform_slug_problem(_slug text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול להקים חנויות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN public.tenant_slug_problem(_slug);
END $$;
REVOKE ALL ON FUNCTION public.platform_slug_problem(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_slug_problem(text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. קוד כניסה לאתר החנות — גם לבעלי החנות
-- ------------------------------------------------------------
-- platform_admin: "היכנס לניהול" מפאנל הפלטפורמה (נבדק שהמשתמש מנהל-על)
-- store_owner:    מהשער לחנות שלכם (נבדק שהמשתמש מנהל של החנות הזו)
ALTER TABLE public.platform_admin_handoffs
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'platform_admin';
ALTER TABLE public.platform_admin_handoffs
  DROP CONSTRAINT IF EXISTS platform_admin_handoffs_kind_check;
ALTER TABLE public.platform_admin_handoffs
  ADD CONSTRAINT platform_admin_handoffs_kind_check CHECK (kind IN ('platform_admin', 'store_owner'));
COMMENT ON COLUMN public.platform_admin_handoffs.kind IS
  'platform_admin = כניסת מנהל-על מהפאנל; store_owner = כניסת בעל החנות משער הפלטפורמה';

-- ------------------------------------------------------------
-- 3. החשבון של מייל מאומת: החנויות שלו ומה מותר לו
-- ------------------------------------------------------------
-- {
--   user_id: uuid | null           (null = אין עדיין חשבון — ייווצר בהקמת חנות)
--   platform_admin: boolean
--   stores: [{ id, slug, name, status, is_default, domain, custom_domain,
--              custom_domain_status, is_blocked, created_at, ssl_status }]
--   other: null | { role, tenant_name }   (שיוך שאינו ניהול — לקוח / צוות)
--   can_create: boolean                   (אין לחשבון שום שיוך לחנות)
-- }
CREATE OR REPLACE FUNCTION public.portal_account(_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _e text := lower(btrim(COALESCE(_email, '')));
  _uid uuid;
  ur public.user_roles;
  _stores jsonb := '[]'::jsonb;
  _other jsonb;
BEGIN
  IF _e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'כתובת אימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;

  SELECT u.id INTO _uid
    FROM auth.users u
   WHERE lower(u.email) = _e
   ORDER BY u.created_at
   LIMIT 1;

  IF _uid IS NOT NULL THEN
    SELECT * INTO ur FROM public.user_roles WHERE user_id = _uid;
  END IF;
  -- שורת תפקיד בלי חשבון התחברות תואם (נשארה מחשבון שנמחק) — עדיין תופסת את המייל
  IF ur.user_id IS NULL THEN
    SELECT * INTO ur FROM public.user_roles WHERE lower(btrim(email)) = _e LIMIT 1;
  END IF;

  IF ur.user_id IS NOT NULL AND ur.role = 'admin' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', t.id,
             'slug', t.slug,
             'name', COALESCE(NULLIF(btrim(s.business_name), ''), t.name),
             'status', t.status,
             'is_default', t.is_default,
             'domain', t.domain,
             'custom_domain', t.custom_domain,
             'custom_domain_status', t.custom_domain_status,
             'is_blocked', ur.is_blocked,
             'created_at', t.created_at,
             'ssl_status', ssl.status) ORDER BY t.created_at), '[]'::jsonb)
      INTO _stores
      FROM public.tenants t
      LEFT JOIN public.site_settings s ON s.tenant_id = t.id
      LEFT JOIN public.tenant_ssl ssl ON ssl.tenant_id = t.id
     WHERE t.id = ur.tenant_id;
  ELSIF ur.user_id IS NOT NULL THEN
    SELECT jsonb_build_object(
             'role', ur.role,
             'tenant_name', COALESCE(NULLIF(btrim(s.business_name), ''), t.name))
      INTO _other
      FROM public.tenants t
      LEFT JOIN public.site_settings s ON s.tenant_id = t.id
     WHERE t.id = ur.tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'user_id', _uid,
    'platform_admin', CASE WHEN _uid IS NULL THEN false
                           ELSE COALESCE(public.is_platform_admin(_uid), false) END,
    'stores', _stores,
    'other', _other,
    'can_create', ur.user_id IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.portal_account(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_account(text) TO service_role;

-- ------------------------------------------------------------
-- 4. הקמת חנות ע"י הבעלים
-- ------------------------------------------------------------
-- החשבון (auth.users) כבר קיים — השרת יוצר אותו לפני הקריאה, ומוחק אותו
-- אם ההקמה נכשלה וזה היה חשבון חדש.
CREATE OR REPLACE FUNCTION public.portal_create_store(_email text, _name text, _slug text)
RETURNS public.tenants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _e text := lower(btrim(COALESCE(_email, '')));
  -- רווחים כפולים / שורות חדשות בשם מצטמצמים לרווח אחד
  _n text := btrim(regexp_replace(COALESCE(_name, ''), '\s+', ' ', 'g'));
  _s text := lower(btrim(COALESCE(_slug, '')));
  _uid uuid;
  _existing public.user_roles;
  _problem text;
  t public.tenants;
BEGIN
  IF _e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'כתובת אימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF length(_n) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'שם החנות חייב להכיל 2 עד 120 תווים' USING ERRCODE = 'check_violation';
  END IF;

  SELECT u.id INTO _uid
    FROM auth.users u
   WHERE lower(u.email) = _e
   ORDER BY u.created_at
   LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'החשבון לא נמצא — התחילו מחדש מהזנת האימייל' USING ERRCODE = 'no_data_found';
  END IF;

  -- שתי לשוניות שלוחצות "צור חנות" באותו רגע — אחת אחרי השנייה
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-create:' || _uid::text, 7021));

  SELECT * INTO _existing
    FROM public.user_roles
   WHERE user_id = _uid OR lower(btrim(email)) = _e
   LIMIT 1;
  IF FOUND THEN
    IF _existing.role = 'admin' THEN
      RAISE EXCEPTION 'כבר יש לכם חנות במערכת. כל כתובת מייל מנהלת חנות אחת — לחנות נוספת השתמשו בכתובת אחרת.'
        USING ERRCODE = 'unique_violation';
    END IF;
    RAISE EXCEPTION 'כתובת המייל הזו כבר רשומה בחנות אחרת במערכת (כלקוח או כאיש צוות). כדי לפתוח חנות משלכם השתמשו בכתובת מייל אחרת.'
      USING ERRCODE = 'unique_violation';
  END IF;

  _problem := public.tenant_slug_problem(_s);
  IF _problem IS NOT NULL THEN
    RAISE EXCEPTION '%', _problem USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    INSERT INTO public.tenants (slug, name, owner_email, plan, status)
    VALUES (_s, _n, _e, 'trial', 'active')
    RETURNING * INTO t;   -- tenants_seed_settings יוצר את שורות ההגדרות
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'הכתובת "%" נתפסה הרגע ע"י חנות אחרת — בחרו כתובת אחרת', _s
      USING ERRCODE = 'check_violation';
  END;

  -- השם שהבעלים הקלידו הוא שם העסק באתר, בכותרת ובשולח המיילים
  UPDATE public.site_settings
     SET business_name = _n, site_title = _n
   WHERE tenant_id = t.id;

  BEGIN
    INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_blocked, must_change_password)
    VALUES (t.id, _uid, _e, 'admin', true, false, false);
  EXCEPTION WHEN unique_violation THEN
    -- נוצר שיוך בינתיים (הרשמה במקביל בחנות אחרת) — ההקמה כולה מתבטלת
    RAISE EXCEPTION 'כתובת המייל הזו שויכה הרגע לחנות אחרת — נסו שוב' USING ERRCODE = 'unique_violation';
  END;

  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.portal_create_store(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_create_store(text, text, text) TO service_role;

-- ------------------------------------------------------------
-- 5. מצב חנות של הבעלים (לפני כניסה): תעודת ה-SSL של הכתובת
-- ------------------------------------------------------------
-- זורק אם המייל אינו מנהל של החנות. user_id = חשבון המנהל (לקוד הכניסה).
-- agent_seen_at = הדיווח האחרון של
-- סקריפט התעודות בשרת על כל חנות שהיא (null / ישן = הסקריפט לא רץ).
CREATE OR REPLACE FUNCTION public.portal_store_state(_email text, _tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _e text := lower(btrim(COALESCE(_email, '')));
  t public.tenants;
  _uid uuid;
  _blocked boolean;
  ssl public.tenant_ssl;
BEGIN
  SELECT ur.user_id, ur.is_blocked INTO _uid, _blocked
    FROM public.user_roles ur
    JOIN auth.users u ON u.id = ur.user_id
   WHERE ur.tenant_id = _tenant AND ur.role = 'admin' AND lower(u.email) = _e
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החנות לא נמצאה בחשבון שלכם' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO t FROM public.tenants WHERE id = _tenant;

  SELECT * INTO ssl FROM public.tenant_ssl WHERE tenant_id = t.id;

  RETURN jsonb_build_object(
    'id', t.id,
    'slug', t.slug,
    'name', t.name,
    'status', t.status,
    'is_default', t.is_default,
    'domain', t.domain,
    'custom_domain', t.custom_domain,
    'custom_domain_status', t.custom_domain_status,
    'user_id', _uid,
    'is_blocked', COALESCE(_blocked, false),
    'ssl_status', ssl.status,
    'ssl_error', ssl.last_error,
    'agent_seen_at', (SELECT max(s.checked_at) FROM public.tenant_ssl s));
END $$;
REVOKE ALL ON FUNCTION public.portal_store_state(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_store_state(text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
