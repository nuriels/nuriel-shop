-- ============================================================
-- חלק 18ב: חשבון אחד — כמה חנויות (מנהל של כמה חנויות / מותגים)
--
-- עד עכשיו: user_roles (השיוך משתמש ↔ חנות: tenant_id, user_id, role) היה
-- 1:1 בפועל — המפתח הראשי היה user_id בלבד, והאימייל ייחודי בכל הפלטפורמה.
-- לכן מנהל לא יכול היה להיות משויך ליותר מחנות אחת.
--
-- עכשיו user_roles היא טבלת קשר Many-to-Many אמיתית:
--   • המפתח הראשי: (tenant_id, user_id) — אותו משתמש בכמה חנויות, שורה לכל חנות
--     (כל 24 המפתחות הזרים אל user_roles כבר היו על (tenant_id, user_id)).
--   • האימייל ייחודי בתוך כל חנות (ולא בכל הפלטפורמה).
--   • אין העברת נתונים: tenant_id מעולם לא ישב על טבלת המשתמשים (auth.users) —
--     כל שיוך קיים כבר שורה ב-user_roles, והוא נשאר כמו שהוא (נבדק בסוף).
--   • role נשאר כמו שהיה: admin (מנהל) / agent / warehouse / customer.
--     "בעלים" = מנהל שהאימייל שלו הוא tenants.owner_email (my_stores מחזיר is_owner).
--
-- כלל: כמה חנויות — רק לצוות (admin / agent / warehouse). חשבון לקוח שייך
-- לחנות אחת (פרופיל הלקוח, העגלה וההסכם שלו מוגדרים לפי user_id) — נאכף
-- בטריגר user_roles_membership_guard.
--
-- החנות הפעילה של כל בקשה נקבעת לפי הכתובת של האתר (header x-tenant-id
-- שהשרת והדפדפן שולחים לפי הדומיין) — current_tenant_id() מחזיר אותה רק אם
-- המשתמש משויך אליה. מעבר בין חנויות ("מחליף החנויות" בניהול) = כניסה
-- חד-פעמית לכתובת של החנות האחרת (platform_admin_handoffs.kind='store_switch').
--
-- גם:
--   • פונקציות שקראו את user_roles לפי user_id בלבד — מסוננות עכשיו לפי החנות
--     (place_order, admin_dashboard, buyer_price_tier, customer_has_prices,
--     reject_blocked_user_orders, support_sender_name).
--   • platform_delete_tenant לא מוחק חשבון התחברות של משתמש שמשויך לחנות אחרת.
--   • שער הפלטפורמה: בעלים יכולים לפתוח עוד חנויות (עד 10 לחשבון).
--   • my_stores — החנויות של המשתמש המחובר (למחליף החנויות).
--   • store_link_existing_account — מנהל חנות מצרף חשבון קיים כאיש צוות / מנהל.
--   • platform_link_store_admin — מנהל-על מקים חנות לבעלים שכבר יש לו חשבון.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE _part18b_before ON COMMIT DROP AS
  SELECT count(*) AS n FROM public.user_roles;

-- ------------------------------------------------------------
-- 1. user_roles — טבלת קשר משתמש ↔ חנות
-- ------------------------------------------------------------
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (tenant_id, user_id);

-- חיפוש "החנויות של המשתמש" (המפתח הראשי מתחיל ב-tenant_id)
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON public.user_roles (user_id);

-- אימייל: ייחודי בכל חנות (אותו חשבון יכול להופיע בכמה חנויות)
DROP INDEX IF EXISTS public.user_roles_email_unique_idx;
CREATE UNIQUE INDEX user_roles_email_unique_idx
  ON public.user_roles (tenant_id, lower(btrim(email)));

COMMENT ON TABLE public.user_roles IS
  'השיוך משתמש ↔ חנות (Many-to-Many): שורה לכל חנות שהמשתמש שייך אליה, עם התפקיד בה. '
  'צוות (admin / agent / warehouse) יכול להיות בכמה חנויות; לקוח — בחנות אחת.';

-- ------------------------------------------------------------
-- 2. כמה חנויות — רק לצוות
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_roles_membership_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- שתי חנויות שמצרפות את אותו חשבון באותו רגע — אחת אחרי השנייה
  PERFORM pg_advisory_xact_lock(hashtextextended('user-membership:' || NEW.user_id::text, 18));
  IF NEW.role = 'customer' THEN
    IF EXISTS (SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = NEW.user_id AND ur.tenant_id <> NEW.tenant_id) THEN
      RAISE EXCEPTION 'החשבון הזה כבר משויך לחנות אחרת — חשבון לקוח שייך לחנות אחת בלבד'
        USING ERRCODE = 'unique_violation';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = NEW.user_id AND ur.tenant_id <> NEW.tenant_id
                   AND ur.role = 'customer') THEN
    RAISE EXCEPTION 'החשבון הזה רשום כלקוח בחנות אחרת — לכמה חנויות אפשר לצרף רק חשבון של צוות או מנהל'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.user_roles_membership_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_roles_membership_guard ON public.user_roles;
CREATE TRIGGER user_roles_membership_guard
  BEFORE INSERT OR UPDATE OF role, user_id, tenant_id ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_membership_guard();

-- ------------------------------------------------------------
-- 3. החנות של הבקשה — לפי כתובת האתר, ורק אם המשתמש משויך אליה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _hdr text := lower(NULLIF(btrim(
    NULLIF(current_setting('request.headers', true), '')::json ->> 'x-tenant-id'), ''));
  _hdr_tid uuid;
  _tid uuid;
  _memberships integer;
BEGIN
  IF _hdr ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT t.id INTO _hdr_tid FROM public.tenants t WHERE t.id = _hdr::uuid;
  END IF;

  -- א. משתמש מחובר עם שיוך לחנויות (user_roles):
  --    • האתר של חנות שהוא משויך אליה → החנות הזו (כל חנות בנפרד).
  --    • האתר של חנות אחרת → NULL, אין גישה לשום דבר — חוץ ממנהל-על
  --      (platform_admins), שמנהל את כל החנויות.
  --    • בלי header (גישה ישירה ל-API): חנות אחת → היא; כמה חנויות → אין הכרעה (NULL).
  IF _uid IS NOT NULL THEN
    IF _hdr_tid IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.tenant_id = _hdr_tid) THEN
      RETURN _hdr_tid;
    END IF;
    SELECT count(*), (array_agg(ur.tenant_id))[1] INTO _memberships, _tid
      FROM public.user_roles ur WHERE ur.user_id = _uid;
    IF _memberships > 0 THEN
      IF _hdr IS NULL THEN
        RETURN CASE WHEN _memberships = 1 THEN _tid ELSE NULL END;
      END IF;
      IF NOT public.is_platform_admin(_uid) THEN
        RETURN NULL;
      END IF;
    END IF;
  END IF;

  -- ב. header מפורש (אורח, נרשם חדש, מנהל-על, שרת עם service_role)
  IF _hdr IS NOT NULL THEN
    RETURN _hdr_tid;
  END IF;

  -- ג. גשר תאימות: חנות ברירת המחדל (אם מוגדרת)
  SELECT t.id INTO _tid FROM public.tenants t WHERE t.is_default;
  RETURN _tid;
END $$;

-- ------------------------------------------------------------
-- 4. פונקציות שקראו את user_roles לפי user_id בלבד — עכשיו לפי החנות
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_price_tier(_user_id uuid)
RETURNS smallint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT cp.price_tier
      FROM public.customer_profiles cp
      JOIN public.user_roles ur ON ur.user_id = cp.user_id AND ur.tenant_id = cp.tenant_id
     WHERE cp.user_id = _user_id
       AND cp.tenant_id = public.current_tenant_id()
       AND ur.is_approved AND NOT ur.is_blocked
       AND cp.price_tier IN (1, 2, 3)
  ), 1)::smallint;
$$;

CREATE OR REPLACE FUNCTION public.customer_has_prices(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- חסום בחנות הזו (חסימה בחנות אחרת לא משפיעה כאן)
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = _user_id AND ur.is_blocked
                        AND ur.tenant_id = public.current_tenant_id());
$$;

CREATE OR REPLACE FUNCTION public.reject_blocked_user_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = auth.uid() AND is_blocked AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'החשבון חסום — לא ניתן לשלוח הזמנות. לבירור פנו אלינו.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.support_sender_name(_side text, _tenant uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE WHEN _side = 'admin' THEN 'צוות התמיכה'
         ELSE COALESCE(
           (SELECT NULLIF(btrim(cp.contact_name), '') FROM public.customer_profiles cp
             WHERE cp.user_id = auth.uid() AND cp.tenant_id = _tenant),
           (SELECT NULLIF(btrim(ur.display_name), '') FROM public.user_roles ur
             WHERE ur.user_id = auth.uid() AND ur.tenant_id = _tenant),
           (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()),
           'מנהל החנות')
         END;
$$;

-- פונקציות ארוכות: תיקון נקודתי של השאילתה (ההגדרה נלקחת מהמסד, והתיקון
-- נכשל בקול אם הטקסט לא נמצא — לא משאירים פונקציה לא מתוקנת בשקט)
DO $$
DECLARE
  _def text;
  _fixed text;
BEGIN
  -- place_order: אימייל הלקוח הרשום — מהשורה שלו בחנות הזו
  SELECT pg_get_functiondef('public.place_order(text, jsonb, numeric, boolean, jsonb)'::regprocedure)
    INTO _def;
  IF position('ur.user_id = auth.uid() AND ur.tenant_id = public.current_tenant_id()' IN _def) = 0 THEN
    _fixed := replace(_def,
      '(SELECT ur.email FROM public.user_roles ur WHERE ur.user_id = auth.uid())',
      '(SELECT ur.email FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = public.current_tenant_id())');
    IF _fixed = _def THEN
      RAISE EXCEPTION 'part 18b: place_order — the customer email lookup was not found';
    END IF;
    EXECUTE _fixed;
  END IF;

  -- admin_dashboard: ההזמנות האחרונות — הלקוח מהשורה שלו בחנות של ההזמנה
  SELECT pg_get_functiondef('public.admin_dashboard()'::regprocedure) INTO _def;
  IF position('ur.tenant_id = o.tenant_id' IN _def) = 0 THEN
    _fixed := replace(replace(_def,
      'LEFT JOIN public.customer_profiles cp ON cp.user_id = o.customer_id',
      'LEFT JOIN public.customer_profiles cp ON cp.user_id = o.customer_id AND cp.tenant_id = o.tenant_id'),
      'LEFT JOIN public.user_roles ur ON ur.user_id = o.customer_id',
      'LEFT JOIN public.user_roles ur ON ur.user_id = o.customer_id AND ur.tenant_id = o.tenant_id');
    IF position('ur.tenant_id = o.tenant_id' IN _fixed) = 0 THEN
      RAISE EXCEPTION 'part 18b: admin_dashboard — the recent orders join was not found';
    END IF;
    EXECUTE _fixed;
  END IF;

  -- platform_delete_tenant: חשבון התחברות נמחק רק אם אין לו שיוך לחנות אחרת
  SELECT pg_get_functiondef('public.platform_delete_tenant(uuid, text)'::regprocedure) INTO _def;
  IF position('other.tenant_id <> _tenant' IN _def) = 0 THEN
    _fixed := replace(_def,
      'AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = ur.user_id);',
      'AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = ur.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles other
                      WHERE other.user_id = ur.user_id AND other.tenant_id <> _tenant);');
    IF _fixed = _def THEN
      RAISE EXCEPTION 'part 18b: platform_delete_tenant — the accounts query was not found';
    END IF;
    EXECUTE _fixed;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. מעבר בין חנויות: קוד כניסה חד-פעמי מסוג store_switch
-- ------------------------------------------------------------
-- platform_admin: "היכנס לניהול" מפאנל הפלטפורמה (נבדק שהמשתמש מנהל-על)
-- store_owner:    מהשער לחנות שלכם (נבדק שהמשתמש מנהל של החנות הזו)
-- store_switch:   ממחליף החנויות בניהול (נבדק שהמשתמש איש צוות בחנות היעד)
ALTER TABLE public.platform_admin_handoffs
  DROP CONSTRAINT IF EXISTS platform_admin_handoffs_kind_check;
ALTER TABLE public.platform_admin_handoffs
  ADD CONSTRAINT platform_admin_handoffs_kind_check
  CHECK (kind IN ('platform_admin', 'store_owner', 'store_switch'));
COMMENT ON COLUMN public.platform_admin_handoffs.kind IS
  'platform_admin = כניסת מנהל-על מהפאנל; store_owner = כניסת בעל החנות משער הפלטפורמה; '
  'store_switch = מעבר ממחליף החנויות לחנות אחרת של אותו משתמש';

-- ------------------------------------------------------------
-- 6. החנויות של המשתמש המחובר (מחליף החנויות)
-- ------------------------------------------------------------
-- רק חנויות שבהן הוא איש צוות (admin / agent / warehouse) ולא חסום.
-- החנות הנוכחית (לפי כתובת האתר) — ראשונה, ומסומנת is_current.
CREATE OR REPLACE FUNCTION public.my_stores()
RETURNS TABLE(
  tenant_id uuid, slug text, name text, role text, is_owner boolean, status text,
  is_default boolean, domain text, custom_domain text, custom_domain_status text,
  is_current boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid, public.current_tenant_id() AS current)
  SELECT t.id, t.slug,
         COALESCE(NULLIF(btrim(s.business_name), ''), t.name),
         ur.role,
         (ur.role = 'admin' AND t.owner_email IS NOT NULL
          AND lower(btrim(t.owner_email)) = lower(btrim(ur.email))),
         t.status, t.is_default, t.domain, t.custom_domain, t.custom_domain_status,
         t.id IS NOT DISTINCT FROM me.current
    FROM me
    JOIN public.user_roles ur ON ur.user_id = me.uid
    JOIN public.tenants t ON t.id = ur.tenant_id
    LEFT JOIN public.site_settings s ON s.tenant_id = t.id
   WHERE me.uid IS NOT NULL
     AND ur.role IN ('admin', 'agent', 'warehouse')
     AND NOT ur.is_blocked
   ORDER BY (t.id IS NOT DISTINCT FROM me.current) DESC,
            lower(COALESCE(NULLIF(btrim(s.business_name), ''), t.name)), t.created_at;
$$;
REVOKE ALL ON FUNCTION public.my_stores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_stores() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 7. מנהל החנות מצרף חשבון קיים (למשל מנהל של חנות אחרת) כאיש צוות / מנהל
-- ------------------------------------------------------------
-- NULL = אין חשבון עם האימייל הזה (השרת יוצר חשבון חדש כרגיל).
-- החשבון נכנס עם הסיסמה שכבר יש לו — לא נוצרת סיסמה חדשה.
CREATE OR REPLACE FUNCTION public.store_link_existing_account(
  _email text, _role text, _display_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _e text := lower(btrim(COALESCE(_email, '')));
  _uid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לצרף אנשי צוות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF COALESCE(_role, '') NOT IN ('admin', 'agent', 'warehouse') THEN
    RAISE EXCEPTION 'אפשר לצרף חשבון קיים רק כאיש צוות או כמנהל' USING ERRCODE = 'check_violation';
  END IF;
  IF _e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'כתובת אימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;

  SELECT u.id INTO _uid
    FROM auth.users u
   WHERE lower(u.email) = _e
   ORDER BY u.created_at
   LIMIT 1;
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'כתובת האימייל הזו כבר רשומה בחנות' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.user_roles
    (tenant_id, user_id, email, role, is_approved, is_blocked, must_change_password, display_name)
  VALUES
    (_tenant, _uid, _e, _role, true, false, false, NULLIF(btrim(COALESCE(_display_name, '')), ''));
  RETURN _uid;
END $$;
REVOKE ALL ON FUNCTION public.store_link_existing_account(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_link_existing_account(text, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 8. מנהל-על מקים חנות לבעלים שכבר יש לו חשבון (בחנות אחרת) — שרת בלבד
-- ------------------------------------------------------------
-- NULL = אין חשבון עם האימייל (השרת יוצר חשבון חדש עם סיסמה זמנית).
CREATE OR REPLACE FUNCTION public.platform_link_store_admin(_tenant uuid, _email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _e text := lower(btrim(COALESCE(_email, '')));
  _uid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant) THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;
  SELECT u.id INTO _uid
    FROM auth.users u
   WHERE lower(u.email) = _e
   ORDER BY u.created_at
   LIMIT 1;
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.user_roles
    (tenant_id, user_id, email, role, is_approved, is_blocked, must_change_password)
  VALUES (_tenant, _uid, _e, 'admin', true, false, false)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin', is_blocked = false;
  RETURN _uid;
END $$;
REVOKE ALL ON FUNCTION public.platform_link_store_admin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_link_store_admin(uuid, text) TO service_role;

-- ------------------------------------------------------------
-- 9. שער הפלטפורמה: כל החנויות של הבעלים, ופתיחת חנות נוספת
-- ------------------------------------------------------------
-- {
--   user_id: uuid | null           (null = אין עדיין חשבון — ייווצר בהקמת חנות)
--   platform_admin: boolean
--   stores: [{ id, slug, name, status, is_default, domain, custom_domain,
--              custom_domain_status, is_blocked, created_at, ssl_status }]   (כל החנויות שהוא מנהל)
--   other: null | { role, tenant_name }   (חשבון לקוח בחנות אחרת — חוסם פתיחת חנות)
--   can_create: boolean                   (לא לקוח בחנות אחרת, ופחות מ-10 חנויות)
--   max_stores: 10
-- }
CREATE OR REPLACE FUNCTION public.portal_account(_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _e text := lower(btrim(COALESCE(_email, '')));
  _max CONSTANT integer := 10;
  _uid uuid;
  _stores jsonb := '[]'::jsonb;
  _count integer := 0;
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

  -- השיוכים של החשבון (או — שורות שנשארו מחשבון שנמחק — לפי האימייל)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'slug', t.slug,
           'name', COALESCE(NULLIF(btrim(s.business_name), ''), t.name),
           'status', t.status,
           'is_default', t.is_default,
           'domain', t.domain,
           'custom_domain', t.custom_domain,
           'custom_domain_status', t.custom_domain_status,
           'is_blocked', r.is_blocked,
           'created_at', t.created_at,
           'ssl_status', ssl.status) ORDER BY t.created_at), '[]'::jsonb),
         count(*)
    INTO _stores, _count
    FROM public.user_roles r
    JOIN public.tenants t ON t.id = r.tenant_id
    LEFT JOIN public.site_settings s ON s.tenant_id = t.id
    LEFT JOIN public.tenant_ssl ssl ON ssl.tenant_id = t.id
   WHERE r.role = 'admin'
     AND ((_uid IS NOT NULL AND r.user_id = _uid)
          OR (_uid IS NULL AND lower(btrim(r.email)) = _e));

  SELECT jsonb_build_object(
           'role', r.role,
           'tenant_name', COALESCE(NULLIF(btrim(s.business_name), ''), t.name))
    INTO _other
    FROM public.user_roles r
    JOIN public.tenants t ON t.id = r.tenant_id
    LEFT JOIN public.site_settings s ON s.tenant_id = t.id
   WHERE r.role = 'customer'
     AND ((_uid IS NOT NULL AND r.user_id = _uid)
          OR (_uid IS NULL AND lower(btrim(r.email)) = _e))
   LIMIT 1;

  RETURN jsonb_build_object(
    'user_id', _uid,
    'platform_admin', CASE WHEN _uid IS NULL THEN false
                           ELSE COALESCE(public.is_platform_admin(_uid), false) END,
    'stores', _stores,
    'other', _other,
    'can_create', _other IS NULL AND _count < _max,
    'max_stores', _max);
END $$;
REVOKE ALL ON FUNCTION public.portal_account(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_account(text) TO service_role;

CREATE OR REPLACE FUNCTION public.portal_create_store(_email text, _name text, _slug text)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _e text := lower(btrim(COALESCE(_email, '')));
  -- רווחים כפולים / שורות חדשות בשם מצטמצמים לרווח אחד
  _n text := btrim(regexp_replace(COALESCE(_name, ''), '\s+', ' ', 'g'));
  _s text := lower(btrim(COALESCE(_slug, '')));
  _max CONSTANT integer := 10;
  _uid uuid;
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

  IF EXISTS (SELECT 1 FROM public.user_roles
              WHERE (user_id = _uid OR lower(btrim(email)) = _e) AND role = 'customer') THEN
    RAISE EXCEPTION 'כתובת המייל הזו רשומה כלקוח בחנות אחרת במערכת. כדי לפתוח חנות משלכם השתמשו בכתובת מייל אחרת.'
      USING ERRCODE = 'unique_violation';
  END IF;
  IF (SELECT count(*) FROM public.user_roles WHERE user_id = _uid AND role = 'admin') >= _max THEN
    RAISE EXCEPTION 'הגעתם למספר החנויות המרבי לחשבון אחד (%). לחנויות נוספות פנו לתמיכה.', _max
      USING ERRCODE = 'check_violation';
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

  -- הבעלים — מנהל החנות החדשה (גם אם הם כבר מנהלים חנויות אחרות)
  INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_blocked, must_change_password)
  VALUES (t.id, _uid, _e, 'admin', true, false, false);

  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.portal_create_store(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_create_store(text, text, text) TO service_role;

-- ------------------------------------------------------------
-- 10. בדיקה: אף שיוך לא אבד
-- ------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM public.user_roles) <> (SELECT n FROM _part18b_before) THEN
    RAISE EXCEPTION 'part 18b: user_roles row count changed during the migration';
  END IF;
END $$;

COMMIT;
