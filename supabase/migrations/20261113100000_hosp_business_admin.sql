-- ============================================================
-- מיגרציה 188: מנהל/ת עסק (Business Admin) באתרי צימר
-- הבעלים ממנה מנהל מסוים (לעסק הזה ולחשבון הזה בלבד) — וזה מקבל את כל ההרשאות של הבעלים, חוץ מ:
--   • מנוי / תשלום / מקומות בחבילה (billing.manage);
--   • בעלות (ownership): מינוי / ביטול / הסרה של מנהלי עסק; העברת בעלות נשארת בפאנל הפלטפורמה.
-- ברירת המחדל: אף אחד. נאכף במסד: can(), פונקציות הצוות, ושומר התפקידים של החנויות — שמתיר הוספה /
-- הסרה של מנהל על ידי מנהל/ת עסק רק מתוך פונקציית צוות (סימון לטרנזקציה; ביומן), לא בכתיבה ישירה.
-- חנויות: בלי שינוי (השומר מתנהג כמו קודם כשאין סימון). בלי שינוי נתונים.
-- ============================================================
BEGIN;

ALTER TABLE hospitality.staff_grants DROP CONSTRAINT IF EXISTS staff_grants_permission_check;
ALTER TABLE hospitality.staff_grants ADD CONSTRAINT staff_grants_permission_check
  CHECK (permission IN ('reports.finance', 'contracts', 'business.admin'));

-- מנהל/ת עסק בעסק הזה (הבעלים מינה במפורש; לפי עסק + חשבון). לשימוש פנימי של הפונקציות בלבד
CREATE OR REPLACE FUNCTION hospitality._is_business_admin(_tenant uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _tenant IS NOT NULL AND _user IS NOT NULL AND EXISTS (
    SELECT 1 FROM hospitality.staff_grants g
     WHERE g.tenant_id = _tenant AND g.user_id = _user AND g.permission = 'business.admin');
$$;
REVOKE ALL ON FUNCTION hospitality._is_business_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- שומר התפקידים של החנויות (user_roles_owner_guard): הוספה / הסרה של מנהל באתר צימר על ידי מי שאינו
-- הבעלים עוברת רק כשהיא מגיעה מתוך פונקציית צוות (סימון לטרנזקציה), באתר הנוכחי, למי שמנהל צוות,
-- ולא על שורת הבעלים או של מנהל/ת עסק (אלא אם זה הבעלים). כל דרך אחרת — הכללים הקיימים.
CREATE OR REPLACE FUNCTION hospitality._team_op_allows(_tenant uuid, _target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    current_setting('hospitality.team_op', true) = _tenant::text
    AND _tenant = public.current_tenant_id()
    AND public.current_site_type() = 'hospitality'
    AND hospitality.can('staff.managers')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                     WHERE ur.tenant_id = _tenant AND ur.user_id = _target AND ur.is_protected)
    AND (hospitality.can('ownership') OR NOT hospitality._is_business_admin(_tenant, _target)),
    false);
$$;
REVOKE ALL ON FUNCTION hospitality._team_op_allows(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage', 'guests.privacy', 'settings.owner',
               'catalog.owner', 'reports.finance', 'contracts', 'ownership']::text[];
$$;

CREATE OR REPLACE FUNCTION hospitality.can(_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    _permission = ANY (hospitality.permissions())
    AND public.current_site_type() = 'hospitality'
    AND CASE public.store_staff_role(auth.uid())
          WHEN 'owner' THEN true
          WHEN 'manager' THEN CASE
            -- מיגרציה 188: מנהל/ת עסק (הבעלים מינה במפורש, לעסק הזה ולחשבון הזה) — הכול, חוץ ממנוי /
            -- תשלום (billing.manage) ובעלות (ownership: מינוי מנהלי עסק, ובעתיד העברת בעלות)
            WHEN hospitality._is_business_admin(public.current_tenant_id(), auth.uid())
              THEN _permission NOT IN ('billing.manage', 'ownership')
            -- נתונים כספיים וחוזי לקוחות: רק מנהל שהבעלים נתן לו במפורש
            WHEN _permission IN ('reports.finance', 'contracts') THEN EXISTS (
              SELECT 1 FROM hospitality.staff_grants g
               WHERE g.tenant_id = public.current_tenant_id() AND g.user_id = auth.uid()
                 AND g.permission = _permission)
            ELSE _permission NOT IN ('staff.managers', 'billing.manage', 'guests.privacy',
                                     'settings.owner', 'catalog.owner', 'ownership')
          END
          ELSE false
        END,
    false);
$$;

CREATE OR REPLACE FUNCTION public.user_roles_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _trusted boolean := _me IS NULL OR public.is_platform_admin(_me);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT _trusted AND OLD.role = 'admin' AND NOT public.staff_can('staff.managers', _me)
       AND NOT hospitality._team_op_allows(OLD.tenant_id, OLD.user_id) THEN
      RAISE EXCEPTION 'רק בעל החנות יכול להסיר מנהל' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT _trusted THEN
      NEW.is_protected := false;
      IF NEW.role = 'admin' AND NOT public.staff_can('staff.managers', _me)
         AND NOT hospitality._team_op_allows(NEW.tenant_id, NEW.user_id) THEN
        RAISE EXCEPTION 'רק בעל החנות יכול להוסיף מנהלים' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW.role = 'admin' AND NOT NEW.is_protected AND NOT NEW.is_blocked THEN
      -- שתי הוספות במקביל לחנות חדשה — אחת אחרי השנייה
      PERFORM pg_advisory_xact_lock(hashtextextended('store-owner:' || NEW.tenant_id::text, 0));
      IF NOT EXISTS (SELECT 1 FROM public.user_roles
                      WHERE tenant_id = NEW.tenant_id AND is_protected) THEN
        NEW.is_protected := true;
        NEW.is_approved := true;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NOT _trusted AND NOT public.staff_can('staff.managers', _me) THEN
    IF NEW.role IS DISTINCT FROM OLD.role AND (OLD.role = 'admin' OR NEW.role = 'admin') THEN
      RAISE EXCEPTION 'רק בעל החנות יכול למנות מנהלים או לשנות תפקיד של מנהל'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- גם שחרור: מנהל שהבעלים חסם — רק הבעלים משחרר (לפני כן הכלל עצר רק חסימה, והכפתור "שחרור"
    -- בלשונית המשתמשים עדכן ישירות את user_roles — מנהל אחר יכול היה להחזיר מנהל שהבעלים חסם)
    IF OLD.role = 'admin' AND NEW.is_blocked IS DISTINCT FROM OLD.is_blocked THEN
      RAISE EXCEPTION 'רק בעל החנות יכול לחסום או לשחרר מנהל' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION hospitality.team_members()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  _e jsonb := hospitality.entitlements(_t);
BEGIN
  RETURN jsonb_build_object(
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', ur.user_id,
               'role', CASE WHEN ur.is_protected THEN 'owner' ELSE 'manager' END,
               'display_name', ur.display_name, 'username', ur.username, 'email', lower(u.email),
               'is_blocked', ur.is_blocked, 'added_at', hospitality._ts(ur.created_at),
               'last_sign_in_at', hospitality._ts(u.last_sign_in_at),
               'finance', ur.is_protected OR EXISTS (
                 SELECT 1 FROM hospitality.staff_grants g
                  WHERE g.tenant_id = _t AND g.user_id = ur.user_id AND g.permission IN ('reports.finance', 'business.admin')),
               'contracts', ur.is_protected OR EXISTS (
                 SELECT 1 FROM hospitality.staff_grants g
                  WHERE g.tenant_id = _t AND g.user_id = ur.user_id AND g.permission IN ('contracts', 'business.admin')),
               'business_admin', NOT ur.is_protected AND EXISTS (
                 SELECT 1 FROM hospitality.staff_grants g
                  WHERE g.tenant_id = _t AND g.user_id = ur.user_id AND g.permission = 'business.admin'))
             ORDER BY ur.is_protected DESC, ur.created_at, ur.user_id)
        FROM public.user_roles ur
        JOIN auth.users u ON u.id = ur.user_id
       WHERE ur.tenant_id = _t AND ur.role = 'admin' AND NOT public.is_platform_admin(ur.user_id)), '[]'::jsonb),
    'seats', jsonb_build_object('used', _e -> 'managers_used', 'limit', _e -> 'max_managers', 'active', _e -> 'active'));
END $$;

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

  _uid := public._platform_account_id(_e);  -- SEC-H1: רק חשבון שנוצר/אומת ע"י המערכת

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

  -- מיגרציה 188: סימון לטרנזקציה — שומר התפקידים מתיר את ההוספה גם למנהל/ת עסק, רק מכאן
  PERFORM set_config('hospitality.team_op', _t::text, true);
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
  PERFORM set_config('hospitality.team_op', '', true);
  PERFORM hospitality._audit(_t, 'team.manager_added', COALESCE(_name, hospitality.mask_email(_e)),
                             jsonb_build_object('email', hospitality.mask_email(_e)));
  RETURN jsonb_build_object('status', 'added', 'user_id', _uid);
END $function$;

CREATE OR REPLACE FUNCTION hospitality.team_remove_manager(_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  r public.user_roles;
  _email text;
BEGIN
  SELECT * INTO r FROM public.user_roles ur
   WHERE ur.tenant_id = _t AND ur.user_id = _user_id AND ur.role = 'admin' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המנהל לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.is_protected THEN
    RAISE EXCEPTION 'אי אפשר להסיר את בעל העסק' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- מיגרציה 188: מנהל/ת עסק — רק הבעלים מסיר
  IF hospitality._is_business_admin(_t, _user_id) AND NOT hospitality.can('ownership') THEN
    RAISE EXCEPTION 'רק בעל העסק יכול להסיר מנהל/ת עסק' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT lower(u.email) INTO _email FROM auth.users u WHERE u.id = _user_id;
  PERFORM set_config('hospitality.team_op', _t::text, true);
  DELETE FROM public.user_roles ur WHERE ur.tenant_id = _t AND ur.user_id = _user_id;
  PERFORM set_config('hospitality.team_op', '', true);
  DELETE FROM hospitality.staff_grants g WHERE g.tenant_id = _t AND g.user_id = _user_id;
  PERFORM hospitality._audit(_t, 'team.manager_removed',
                             COALESCE(NULLIF(btrim(r.display_name), ''), hospitality.mask_email(COALESCE(_email, r.email))),
                             jsonb_build_object('email', hospitality.mask_email(COALESCE(_email, r.email))));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION hospitality.team_set_finance(_user_id uuid, _enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  r public.user_roles;
  _label text;
BEGIN
  IF _user_id IS NULL OR _enabled IS NULL THEN
    RAISE EXCEPTION 'חסרים פרטים' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO r FROM public.user_roles ur
   WHERE ur.tenant_id = _t AND ur.user_id = _user_id AND ur.role = 'admin'
     AND NOT public.is_platform_admin(ur.user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המנהל לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.is_protected THEN
    RAISE EXCEPTION 'לבעלים יש תמיד גישה לנתונים הכספיים' USING ERRCODE = 'check_violation';
  END IF;
  -- מיגרציה 188: למנהל/ת עסק יש את כל ההרשאות — אין מתג נפרד
  IF hospitality._is_business_admin(_t, _user_id) THEN
    RAISE EXCEPTION 'למנהל/ת עסק יש כבר את כל ההרשאות' USING ERRCODE = 'check_violation';
  END IF;
  _label := COALESCE(NULLIF(btrim(r.display_name), ''), hospitality.mask_email(r.email), 'מנהל');
  IF _enabled THEN
    INSERT INTO hospitality.staff_grants (tenant_id, user_id, permission, granted_by)
    VALUES (_t, _user_id, 'reports.finance', auth.uid())
    ON CONFLICT (tenant_id, user_id, permission) DO NOTHING;
    IF FOUND THEN
      PERFORM hospitality._audit(_t, 'team.finance_granted', _label, '{}'::jsonb);
    END IF;
  ELSE
    DELETE FROM hospitality.staff_grants g
     WHERE g.tenant_id = _t AND g.user_id = _user_id AND g.permission = 'reports.finance';
    IF FOUND THEN
      PERFORM hospitality._audit(_t, 'team.finance_revoked', _label, '{}'::jsonb);
    END IF;
  END IF;
  RETURN hospitality.team_members();
END $$;

CREATE OR REPLACE FUNCTION hospitality.team_set_contracts(_user_id uuid, _enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  r public.user_roles;
  _label text;
BEGIN
  IF _user_id IS NULL OR _enabled IS NULL THEN
    RAISE EXCEPTION 'חסרים פרטים' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO r FROM public.user_roles ur
   WHERE ur.tenant_id = _t AND ur.user_id = _user_id AND ur.role = 'admin'
     AND NOT public.is_platform_admin(ur.user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המנהל לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.is_protected THEN
    RAISE EXCEPTION 'לבעלים יש תמיד גישה למסמכי הלקוחות' USING ERRCODE = 'check_violation';
  END IF;
  -- מיגרציה 188: למנהל/ת עסק יש את כל ההרשאות — אין מתג נפרד
  IF hospitality._is_business_admin(_t, _user_id) THEN
    RAISE EXCEPTION 'למנהל/ת עסק יש כבר את כל ההרשאות' USING ERRCODE = 'check_violation';
  END IF;
  _label := COALESCE(NULLIF(btrim(r.display_name), ''), hospitality.mask_email(r.email), 'מנהל');
  IF _enabled THEN
    INSERT INTO hospitality.staff_grants (tenant_id, user_id, permission, granted_by)
    VALUES (_t, _user_id, 'contracts', auth.uid())
    ON CONFLICT (tenant_id, user_id, permission) DO NOTHING;
    IF FOUND THEN
      PERFORM hospitality._audit(_t, 'team.contracts_granted', _label, '{}'::jsonb);
    END IF;
  ELSE
    DELETE FROM hospitality.staff_grants g
     WHERE g.tenant_id = _t AND g.user_id = _user_id AND g.permission = 'contracts';
    IF FOUND THEN
      PERFORM hospitality._audit(_t, 'team.contracts_revoked', _label, '{}'::jsonb);
    END IF;
  END IF;
  RETURN hospitality.team_members();
END $$;

-- הבעלים בלבד ממנה / מבטל מנהל/ת עסק (ביומן). למנהל/ת עסק יש את כל ההרשאות חוץ ממנוי ובעלות
CREATE OR REPLACE FUNCTION hospitality.team_set_business_admin(_user_id uuid, _enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('ownership');
  r public.user_roles;
  _label text;
BEGIN
  IF _user_id IS NULL OR _enabled IS NULL THEN
    RAISE EXCEPTION 'חסרים פרטים' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO r FROM public.user_roles ur
   WHERE ur.tenant_id = _t AND ur.user_id = _user_id AND ur.role = 'admin'
     AND NOT public.is_platform_admin(ur.user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המנהל לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.is_protected THEN
    RAISE EXCEPTION 'בעל העסק הוא כבר הבעלים' USING ERRCODE = 'check_violation';
  END IF;
  _label := COALESCE(NULLIF(btrim(r.display_name), ''), hospitality.mask_email(r.email), 'מנהל');
  IF _enabled THEN
    INSERT INTO hospitality.staff_grants (tenant_id, user_id, permission, granted_by)
    VALUES (_t, _user_id, 'business.admin', auth.uid())
    ON CONFLICT (tenant_id, user_id, permission) DO NOTHING;
    IF FOUND THEN
      PERFORM hospitality._audit(_t, 'team.business_admin_granted', _label, '{}'::jsonb);
    END IF;
  ELSE
    DELETE FROM hospitality.staff_grants g
     WHERE g.tenant_id = _t AND g.user_id = _user_id AND g.permission = 'business.admin';
    IF FOUND THEN
      PERFORM hospitality._audit(_t, 'team.business_admin_revoked', _label, '{}'::jsonb);
    END IF;
  END IF;
  RETURN hospitality.team_members();
END $$;
REVOKE ALL ON FUNCTION hospitality.team_set_business_admin(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_set_business_admin(uuid, boolean) TO authenticated, service_role;

COMMIT;
