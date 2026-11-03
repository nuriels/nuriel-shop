-- ============================================================
-- Rollback ל-SEC-H1: החזרת שש פונקציות הקישור לגרסה שמזהה את החשבון המוקדם ביותר לפי אימייל,
-- והסרת העוזר public._platform_account_id. סימון app_metadata.platform בשורות auth.users נשאר
-- (נתון בלבד — לא סכמה, ואף פונקציה לא קוראת אותו אחרי ה-rollback; לא מזיק).
-- ============================================================
BEGIN;

-- admin_set_owner (גרסת המקור)
CREATE OR REPLACE FUNCTION hospitality.admin_set_owner(_tenant_id uuid, _email text, _display_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _e text := NULLIF(lower(btrim(COALESCE(_email, ''))), '');
  _name text := NULLIF(btrim(COALESCE(_display_name, '')), '');
  _uid uuid;
  _owner uuid;
  r public.user_roles;
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.site_type = 'hospitality') THEN
    RAISE EXCEPTION 'אתר האירוח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF _e IS NULL OR _e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(_e) > 254 THEN
    RAISE EXCEPTION 'אימייל בעל העסק לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _name IS NOT NULL AND char_length(_name) > 80 THEN
    RAISE EXCEPTION 'השם ארוך מדי (עד 80 תווים)' USING ERRCODE = 'check_violation';
  END IF;

  -- אתר אחד — בעלים אחד; פעולה מקבילה מחכה כאן
  PERFORM pg_advisory_xact_lock(hashtextextended('admin_seats:' || _tenant_id::text, 0));

  SELECT u.id INTO _uid FROM auth.users u
   WHERE lower(u.email) = _e AND u.deleted_at IS NULL
   ORDER BY u.created_at LIMIT 1;

  SELECT ur.user_id INTO _owner FROM public.user_roles ur
   WHERE ur.tenant_id = _tenant_id AND ur.role = 'admin' AND ur.is_protected
   ORDER BY ur.created_at LIMIT 1;
  IF _owner IS NOT NULL THEN
    IF _owner = _uid THEN
      RETURN jsonb_build_object('status', 'already_owner', 'user_id', _uid);
    END IF;
    RAISE EXCEPTION 'לאתר הזה כבר יש בעלים' USING ERRCODE = 'check_violation';
  END IF;

  IF _uid IS NULL THEN
    RETURN jsonb_build_object('status', 'needs_account');
  END IF;
  IF public.is_platform_admin(_uid) THEN
    RAISE EXCEPTION 'זה חשבון של מנהל הפלטפורמה — יש להזין את האימייל של בעל העסק' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'customer') THEN
    RAISE EXCEPTION 'האימייל הזה שייך לחשבון של לקוח בחנות — יש להשתמש באימייל אחר לבעל העסק'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO r FROM public.user_roles ur WHERE ur.tenant_id = _tenant_id AND ur.user_id = _uid;
  IF r.user_id IS NOT NULL THEN
    -- כבר מנהל באתר — לא הופכים מנהל לבעלים מכאן (העברת בעלות — החלטה נפרדת)
    RAISE EXCEPTION 'החשבון הזה כבר מנהל באתר — לא ניתן להגדיר אותו כבעלים מכאן' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_protected, display_name)
  VALUES (_tenant_id, _uid, _e, 'admin', true, true, _name);
  UPDATE public.tenants SET owner_email = _e WHERE id = _tenant_id;
  UPDATE hospitality.settings SET contact_email = COALESCE(contact_email, _e) WHERE tenant_id = _tenant_id;

  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant_id, auth.uid(), 'hosp_owner_set', jsonb_build_object('owner', hospitality.mask_email(_e)));
  RETURN jsonb_build_object('status', 'added', 'user_id', _uid);
END $function$;

-- team_add_manager (גרסת המקור)
CREATE OR REPLACE FUNCTION hospitality.team_add_manager(_email text, _display_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  _e text := lower(btrim(COALESCE(_email, '')));
  _name text := NULLIF(btrim(COALESCE(_display_name, '')), '');
  _ent jsonb;
  _uid uuid;
  _role text;
  _generic CONSTANT text := 'אי אפשר לצרף את החשבון הזה כמנהל. פנו לתמיכה.';
BEGIN
  IF _e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR char_length(_e) > 254 THEN
    RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _name IS NOT NULL AND char_length(_name) > 60 THEN
    RAISE EXCEPTION 'השם ארוך מדי (עד 60 תווים)' USING ERRCODE = 'check_violation';
  END IF;

  -- מנעול המקומות של האתר קודם לכל: הוספה מקבילה של אותו אדם מחכה כאן, ואחר כך
  -- רואה את השורה שנוספה (already_member) — ולא "הגעתם למגבלה" על המקום שהיא עצמה תפסה
  PERFORM pg_advisory_xact_lock(hashtextextended('admin_seats:' || _t::text, 0));

  SELECT u.id INTO _uid FROM auth.users u
   WHERE lower(u.email) = _e AND u.deleted_at IS NULL
   ORDER BY u.created_at LIMIT 1;

  IF _uid IS NOT NULL THEN
    SELECT ur.role INTO _role FROM public.user_roles ur WHERE ur.tenant_id = _t AND ur.user_id = _uid;
    IF _role = 'admin' THEN
      RETURN jsonb_build_object('status', 'already_member', 'user_id', _uid);
    ELSIF _role IS NOT NULL OR public.is_platform_admin(_uid)
          OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'customer') THEN
      -- לא חושפים למה (לקוח של חנות אחרת / מנהל פלטפורמה / תפקיד אחר)
      RAISE EXCEPTION '%', _generic USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- בדיקות שלא תלויות בחשבון — לפני שמבקשים מהשרת ליצור חשבון
  _ent := hospitality.entitlements(_t);
  IF NOT COALESCE((_ent ->> 'active')::boolean, false) THEN
    RAISE EXCEPTION 'המנוי של האתר אינו פעיל — אי אפשר להוסיף מנהלים' USING ERRCODE = 'check_violation';
  END IF;
  IF _ent ->> 'max_managers' IS NOT NULL
     AND (_ent ->> 'managers_used')::integer >= (_ent ->> 'max_managers')::integer THEN
    RAISE EXCEPTION 'הגעתם למגבלת המנהלים בחבילה (%). אפשר להסיר מנהל או לבקש מקומות נוספים.', _ent ->> 'max_managers'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _uid IS NULL THEN
    RETURN jsonb_build_object('status', 'needs_account');
  END IF;

  BEGIN
    INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, display_name)
    VALUES (_t, _uid, _e, 'admin', true, _name);
  EXCEPTION WHEN unique_violation THEN
    -- הוספה מקבילה של אותו אדם — כבר מנהל; כל סיבה אחרת — הודעה כללית
    IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.tenant_id = _t AND ur.user_id = _uid AND ur.role = 'admin') THEN
      RETURN jsonb_build_object('status', 'already_member', 'user_id', _uid);
    END IF;
    RAISE EXCEPTION '%', _generic USING ERRCODE = 'insufficient_privilege';
  END;
  PERFORM hospitality._audit(_t, 'team.manager_added', COALESCE(_name, hospitality.mask_email(_e)),
                             jsonb_build_object('email', hospitality.mask_email(_e)));
  RETURN jsonb_build_object('status', 'added', 'user_id', _uid);
END $function$;

-- portal_open_site (גרסת המקור)
CREATE OR REPLACE FUNCTION hospitality.portal_open_site(_email text, _slug text, _request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _e text := lower(btrim(COALESCE(_email, '')));
  _s text := lower(btrim(COALESCE(_slug, '')));
  _max CONSTANT integer := 10;
  _uid uuid;
  _problem text;
  _req jsonb;
  t public.tenants;
BEGIN
  IF _e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(_e) > 254 THEN
    RAISE EXCEPTION 'כתובת אימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  -- החשבון נפתח בשרת לפני הקריאה (אימייל מאומת בשער, בלי סיסמה)
  SELECT u.id INTO _uid FROM auth.users u
   WHERE lower(u.email) = _e AND u.deleted_at IS NULL
   ORDER BY u.created_at LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'החשבון לא נמצא — התחילו מחדש מהזנת האימייל' USING ERRCODE = 'check_violation';
  END IF;

  -- אותה נעילה כמו בפתיחת חנות מהשער: שתי לשוניות — אחת אחרי השנייה
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-create:' || _uid::text, 7021));

  IF public.is_platform_admin(_uid) THEN
    RAISE EXCEPTION 'זה חשבון של מנהל הפלטפורמה — לפתיחת עסק השתמשו באימייל של בעל העסק'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur
              WHERE (ur.user_id = _uid OR lower(btrim(ur.email)) = _e) AND ur.role = 'customer') THEN
    RAISE EXCEPTION 'כתובת המייל הזו רשומה כלקוח בחנות אחרת במערכת. כדי לפתוח עסק משלכם השתמשו בכתובת מייל אחרת.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'admin') >= _max THEN
    RAISE EXCEPTION 'הגעתם למספר האתרים המרבי לחשבון אחד (%). לאתרים נוספים פנו לתמיכה.', _max
      USING ERRCODE = 'check_violation';
  END IF;

  _problem := public.tenant_slug_problem(_s);
  IF _problem IS NOT NULL THEN
    RAISE EXCEPTION '%', _problem USING ERRCODE = 'check_violation';
  END IF;

  -- הבקשה — אותן בדיקות ואותה מגבלה (3 ביום לאימייל); מנהלי הפלטפורמה חוזרים לבעל העסק
  _req := hospitality.site_request_submit(_e, _request);

  BEGIN
    INSERT INTO public.tenants (slug, name, owner_email, site_type)
    VALUES (_s, _req ->> 'business_name', _e, 'hospitality')
    RETURNING * INTO t;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'הכתובת "%" נתפסה הרגע ע"י אתר אחר — בחרו כתובת אחרת', _s
      USING ERRCODE = 'check_violation';
  END;

  -- כמו admin_create_site: ההגדרות המשותפות, פרטי העסק (מנוי הניסיון נוצר בטריגר), מדיניות ראשונה
  PERFORM public.platform_seed_tenant_shared(t.id);
  INSERT INTO hospitality.settings (tenant_id, business_name, contact_email, contact_phone)
  VALUES (t.id, _req ->> 'business_name', _e, _req ->> 'phone');
  INSERT INTO hospitality.policies (tenant_id, name, is_default, free_cancel_days, fee_tiers, no_show_fee)
  VALUES (t.id, 'גמישה', true, 7, '[{"from_days": 7, "fee": "percent_total", "value": 50}]'::jsonb, 'full');

  -- כמו admin_open_site: המסד ואזור הניהול; האתר הציבורי וההזמנות — בפרסום (סעיף 4)
  INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
  VALUES (t.id, 'hospitality_backend_enabled', true), (t.id, 'hospitality_management_enabled', true)
  ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true;

  -- כמו admin_set_owner: בעל העסק — admin מוגן
  INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_protected)
  VALUES (t.id, _uid, _e, 'admin', true, true);

  UPDATE hospitality.site_requests r SET opened_tenant_id = t.id, opened_at = now()
   WHERE r.id = (_req ->> 'id')::uuid;

  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (t.id, _uid, 'hosp_site_opened',
          jsonb_build_object('slug', t.slug, 'plan', 'trial', 'owner', hospitality.mask_email(_e),
                             'source', 'portal', 'request', _req ->> 'id'));

  RETURN jsonb_build_object(
    'tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'domain', t.domain,
                                 'is_default', t.is_default, 'status', t.status,
                                 'custom_domain', t.custom_domain,
                                 'custom_domain_status', t.custom_domain_status,
                                 'created_at', t.created_at),
    'trial_ends_at', hospitality._ts((SELECT s.trial_ends_at FROM hospitality.subscriptions s WHERE s.tenant_id = t.id)),
    'request', _req);
END $function$;

-- platform_link_store_admin (גרסת המקור)
CREATE OR REPLACE FUNCTION public.platform_link_store_admin(_tenant uuid, _email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

-- portal_create_store (גרסת המקור)
CREATE OR REPLACE FUNCTION public.portal_create_store(_email text, _name text, _slug text)
 RETURNS tenants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

-- store_link_existing_account (גרסת המקור)
CREATE OR REPLACE FUNCTION public.store_link_existing_account(_email text, _role text, _display_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _e text := lower(btrim(COALESCE(_email, '')));
  _uid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can('staff.manage', auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לצרף אנשי צוות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF COALESCE(_role, '') NOT IN ('admin', 'agent', 'warehouse', 'cashier') THEN
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
END $function$;

-- consume_login_code (SEC-H1: כניסה בקוד מאמתת את החשבון) — גרסת המקור
CREATE OR REPLACE FUNCTION public.consume_login_code(_email text, _code_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _e text := lower(btrim(COALESCE(_email, '')));
  _max CONSTANT integer := 5;
  c RECORD;
  _uid uuid;
  _member uuid;
  _blocked boolean := false;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;

  SELECT * INTO c
    FROM public.login_codes
   WHERE tenant_id = _tenant AND email = _e AND consumed_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'none');
  END IF;

  IF c.expires_at <= now() THEN
    UPDATE public.login_codes SET consumed_at = now() WHERE id = c.id;
    RETURN jsonb_build_object('result', 'expired');
  END IF;

  IF _code_hash IS DISTINCT FROM c.code_hash THEN
    UPDATE public.login_codes
       SET attempts = attempts + 1,
           consumed_at = CASE WHEN attempts + 1 >= _max THEN now() ELSE NULL END
     WHERE id = c.id;
    IF c.attempts + 1 >= _max THEN
      RETURN jsonb_build_object('result', 'locked');
    END IF;
    RETURN jsonb_build_object('result', 'invalid', 'left', _max - c.attempts - 1);
  END IF;

  -- קוד נכון — חד-פעמי
  UPDATE public.login_codes SET consumed_at = now() WHERE id = c.id;

  SELECT u.id INTO _uid
    FROM auth.users u
   WHERE lower(u.email) = _e
   ORDER BY u.created_at
   LIMIT 1;
  IF _uid IS NOT NULL THEN
    SELECT ur.tenant_id, ur.is_blocked INTO _member, _blocked
      FROM public.user_roles ur
     WHERE ur.user_id = _uid
     ORDER BY (ur.tenant_id = _tenant) DESC
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'result', 'ok',
    'user_id', _uid,
    'member_tenant', _member,
    'same_store', COALESCE(_member = _tenant, false),
    'platform_admin', CASE WHEN _uid IS NULL THEN false
                           ELSE COALESCE(public.is_platform_admin(_uid), false) END,
    'blocked', COALESCE(_blocked, false)
  );
END $function$;

DROP FUNCTION IF EXISTS public._platform_account_id(text);

COMMIT;
