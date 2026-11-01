-- ============================================================
-- Hospitality — פתיחת עסק אירוח מפאנל הפלטפורמה (P1, "ניהול Hospitality")
--
-- עד עכשיו אתר אירוח נפתח רק בקריאה ישירה ל-admin_create_site, ובעל העסק שויך לאתר
-- ישירות במסד. כאן — פונקציות למסך של מנהל הפלטפורמה:
--   • admin_sites()        — רשימת אתרי האירוח: חבילה, יחידות, הזמנות, בעלים, דגלים;
--   • admin_open_site()    — פתיחת אתר: כתובת, שם, אימייל הבעלים, חבילה; מדליקה לאתר את
--                            המסד ואזור הניהול (הדגל הכללי בפלטפורמה נשאר החלטה נפרדת);
--   • admin_set_owner()    — שיוך בעל העסק לאתר לפי אימייל (החשבון נפתח בשרת רק כשהמסד
--                            מחזיר needs_account — כמו הוספת מנהל ב-2b.3);
--   • admin_platform_flags() — מצב הדגלים הכלליים של Hospitality בפלטפורמה.
-- הכול: מנהל הפלטפורמה בלבד (_require_platform_admin), ורישום ב-platform_audit_log.
-- מיגרציה שרק מוסיפה פונקציות — בלי טבלה או עמודה חדשה. אין שינוי בחנויות.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. רשימת האתרים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.admin_sites()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', t.id, 'slug', t.slug, 'name', t.name, 'domain', t.domain, 'status', t.status,
             'created_at', hospitality._ts(t.created_at),
             'plan', x.e ->> 'plan', 'plan_name', (SELECT p.name FROM hospitality.plans p WHERE p.code = x.e ->> 'plan'),
             'subscription_status', x.e ->> 'status', 'subscription_active', (x.e ->> 'active')::boolean,
             'trial_ends_at', x.e ->> 'trial_ends_at',
             'units_active', (x.e ->> 'units_used')::integer, 'units_limit', (x.e ->> 'max_units')::integer,
             'extra_units', COALESCE((SELECT s.extra_units FROM hospitality.subscriptions s WHERE s.tenant_id = t.id), 0),
             'properties', (SELECT count(*) FROM hospitality.properties p
                             WHERE p.tenant_id = t.id AND p.status <> 'archived'),
             'bookings_pending', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = t.id
                                    AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at > now()),
             'bookings_upcoming', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = t.id
                                     AND b.status IN ('confirmed', 'cancel_requested', 'checked_in')
                                     AND b.check_out >= current_date),
             'owner_email', (SELECT ur.email FROM public.user_roles ur
                              WHERE ur.tenant_id = t.id AND ur.role = 'admin' AND ur.is_protected
                              ORDER BY ur.created_at LIMIT 1),
             'managers', (SELECT count(*) FROM public.user_roles ur
                           WHERE ur.tenant_id = t.id AND ur.role = 'admin' AND NOT ur.is_protected),
             'backend_enabled', hospitality.flag_for('hospitality_backend_enabled', t.id),
             'management_enabled', hospitality.flag_for('hospitality_management_enabled', t.id),
             'booking_enabled', hospitality.flag_for('hospitality_booking_enabled', t.id),
             'site_flags', jsonb_build_object(
               'backend', COALESCE((SELECT tf.enabled FROM public.tenant_feature_flags tf
                                     WHERE tf.tenant_id = t.id AND tf.key = 'hospitality_backend_enabled'), false),
               'management', COALESCE((SELECT tf.enabled FROM public.tenant_feature_flags tf
                                        WHERE tf.tenant_id = t.id AND tf.key = 'hospitality_management_enabled'), false),
               'booking', COALESCE((SELECT tf.enabled FROM public.tenant_feature_flags tf
                                     WHERE tf.tenant_id = t.id AND tf.key = 'hospitality_booking_enabled'), false))
           ) ORDER BY t.created_at DESC)
      FROM public.tenants t
      CROSS JOIN LATERAL (SELECT hospitality.entitlements(t.id) AS e) x
     WHERE t.site_type = 'hospitality'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_sites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_sites() TO authenticated, service_role;

-- הדגלים הכלליים בפלטפורמה (המנוע פתוח בכלל?) — לתצוגה במסך; ההדלקה דרך platform_set_flag
CREATE OR REPLACE FUNCTION hospitality.admin_platform_flags()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  RETURN jsonb_build_object(
    'backend', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_backend_enabled'), false),
    'management', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_management_enabled'), false),
    'booking', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_booking_enabled'), false),
    'plans', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'max_units', p.max_units,
                                                           'trial_days', p.trial_days) ORDER BY p.sort_order, p.code)
                         FROM hospitality.plans p), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_platform_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_platform_flags() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. פתיחת אתר
-- ------------------------------------------------------------
-- הבדיקות של הכתובת, השם והאימייל — ב-admin_create_site (Stage 1e). חבילה "trial" =
-- הניסיון שנוצר אוטומטית עם האתר; חבילה אחרת = מנוי פעיל, עם תאריך סיום אם נקבע.
CREATE OR REPLACE FUNCTION hospitality.admin_open_site(
  _slug text, _name text, _owner_email text, _plan text DEFAULT 'trial', _period_end date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tenants;
  _e text := NULLIF(lower(btrim(COALESCE(_owner_email, ''))), '');
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF _e IS NULL THEN
    RAISE EXCEPTION 'יש להזין את האימייל של בעל העסק' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hospitality.plans p WHERE p.code = COALESCE(_plan, '')) THEN
    RAISE EXCEPTION 'חבילה לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  IF _period_end IS NOT NULL AND _period_end <= current_date THEN
    RAISE EXCEPTION 'תאריך סיום המנוי חייב להיות בעתיד' USING ERRCODE = 'check_violation';
  END IF;

  t := hospitality.admin_create_site(_slug, _name, _e);

  -- המסד ואזור הניהול — לאתר הזה (האתר הציבורי והזמנות אורחים נשארים כבויים)
  INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
  VALUES (t.id, 'hospitality_backend_enabled', true), (t.id, 'hospitality_management_enabled', true)
  ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true;

  IF _plan <> 'trial' THEN
    -- המנוי בתוקף עד סוף היום שנבחר (כולל)
    PERFORM hospitality.admin_set_subscription(t.id, _plan, 'active', NULL,
                                               (_period_end + 1)::timestamptz - interval '1 second', 0,
                                               'נפתח מהפאנל');
  END IF;

  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (t.id, auth.uid(), 'hosp_site_opened',
          jsonb_build_object('slug', t.slug, 'plan', _plan, 'owner', hospitality.mask_email(_e)));
  RETURN jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name);
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_open_site(text, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_open_site(text, text, text, text, date) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. שיוך בעל העסק
-- ------------------------------------------------------------
-- needs_account — אין עדיין חשבון לאימייל: השרת פותח חשבון (אימייל מאומת, בלי סיסמה)
-- וקורא שוב. הבעלים נכנס ל-/manage בקוד שנשלח למייל.
CREATE OR REPLACE FUNCTION hospitality.admin_set_owner(_tenant_id uuid, _email text, _display_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_set_owner(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_set_owner(uuid, text, text) TO authenticated, service_role;

COMMIT;
