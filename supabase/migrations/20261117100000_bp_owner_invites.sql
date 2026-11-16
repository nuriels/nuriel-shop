-- ============================================================
-- Nuriel Websites — מיגרציה 198: הזמנת בעלת האתר (קישור חד-פעמי מפאנל הפלטפורמה)
-- ------------------------------------------------------------
-- מנהל הפלטפורמה יוצר בתיק האתר קישור הזמנה לבעלת האתר — כשעוד אין לנו את כתובת המייל שלה. הקישור נשלח ידנית
-- (וואטסאפ). בפתיחת הקישור היא בוחרת מייל וסיסמה, נפתח לה חשבון רגיל, והיא משויכת כבעלת האתר — לאתר הזה בלבד.
--
-- • הטוקן: 32 בתים אקראיים, נוצר בשרת האפליקציה; במסד נשמר רק ה-SHA-256 שלו. צמוד לאתר אחד (tenant).
-- • תוקף ברירת מחדל 72 שעות (1–168). הזמנה פתוחה אחת לכל אתר: יצירה חדשה מבטלת את הקודמת; אפשר לבטל.
-- • מימוש: פעם אחת בלבד (נעילת שורה), רק באתר שההזמנה שלו, רק כשאין לאתר בעלת אתר, רק לחשבון חדש שאין לו
--   שום שיוך. ההרשאה שניתנת: בעלת האתר (user_roles admin + is_protected) באתר הזה — לא מנהל פלטפורמה ולא אתר
--   אחר. בסיום נוצר קוד כניסה חד-פעמי (platform_admin_handoffs, store_owner, 2 דקות) — הכניסה הרגילה לממשק הניהול.
-- • יומן: יצירה, ביטול, מימוש וכל כישלון (קישור לא מוכר / של אתר אחר / שפג / שבוטל / שנוצל / יש כבר בעלת אתר /
--   חשבון לא מתאים) — ביומן הפלטפורמה (platform_audit_log) וביומן האתר. ה-IP — רק כטביעה (HMAC מהשרת).
-- • אימות מייל: המייל שהוזן לא מסומן כמאומת. email_verified_at נקבע רק אחרי קוד נכון שנשלח לתיבה (6 ספרות, נשמר
--   רק HMAC, 10 דקות, 5 ניסיונות); אז גם החשבון מסומן platform (SEC-H1 — כמו כניסה בקוד למייל). בלי שירות מיילים —
--   החשבון נפתח ופעיל, והאימות מחכה.
-- • מימוש ובדיקה — רק מהשרת (service_role); יצירה, ביטול ומצב — רק מנהל פלטפורמה.
--
-- Rollback: supabase/rollbacks/20261117100000_bp_owner_invites.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TABLE IF NOT EXISTS business_profile.owner_invites (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token_hash        text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  revoked_by        uuid,
  revoke_reason     text CHECK (revoke_reason IN ('revoked', 'replaced')),
  used_at           timestamptz,
  used_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_email        text CHECK (used_email IS NULL OR (used_email = lower(used_email) AND length(used_email) <= 254)),
  email_verified_at timestamptz,
  -- אימות המייל: קוד בן 6 ספרות שנשלח לתיבה (נשמר רק HMAC), 10 דקות, עד 5 ניסיונות
  verify_code_hash  text CHECK (verify_code_hash IS NULL OR verify_code_hash ~ '^[0-9a-f]{64}$'),
  verify_expires_at timestamptz,
  verify_sent_at    timestamptz,
  verify_attempts   integer NOT NULL DEFAULT 0 CHECK (verify_attempts >= 0),
  CHECK (expires_at > created_at),
  CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL)),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CHECK (email_verified_at IS NULL OR used_at IS NOT NULL)
);
-- הזמנה פתוחה אחת לכל אתר
CREATE UNIQUE INDEX IF NOT EXISTS bp_owner_invites_one_open
  ON business_profile.owner_invites (tenant_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS bp_owner_invites_tenant ON business_profile.owner_invites (tenant_id, created_at DESC);
ALTER TABLE business_profile.owner_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_profile.owner_invites;
CREATE POLICY tenant_isolation ON business_profile.owner_invites AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON business_profile.owner_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON business_profile.owner_invites TO service_role;

-- ---------- עזרים ----------
CREATE OR REPLACE FUNCTION business_profile._has_owner(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.tenant_id = _tenant AND ur.role = 'admin' AND ur.is_protected);
$$;
REVOKE ALL ON FUNCTION business_profile._has_owner(uuid) FROM PUBLIC, anon, authenticated;

-- יומן הפלטפורמה (כולל ניסיון עם קישור לא מוכר — בלי אתר) + יומן האתר; actor מפורש (מימוש רץ במפתח השירות)
CREATE OR REPLACE FUNCTION business_profile._invite_log(_tenant uuid, _actor uuid, _action text, _site_action text,
                                                         _details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, actor_email, action, details)
  VALUES (_tenant, _actor,
          (SELECT lower(u.email) FROM auth.users u WHERE u.id = _actor),
          _action, COALESCE(_details, '{}'::jsonb));
  IF _tenant IS NOT NULL THEN
    INSERT INTO business_profile.audit_log (tenant_id, actor_id, action, details)
    VALUES (_tenant, _actor, _site_action,
            COALESCE(_details, '{}'::jsonb)
              || CASE WHEN _actor IS NOT NULL AND public.is_platform_admin(_actor)
                      THEN '{"via": "platform_admin"}'::jsonb ELSE '{}'::jsonb END);
  END IF;
END $$;
REVOKE ALL ON FUNCTION business_profile._invite_log(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- מצב הזמנה (לפי השורה, בלי לחשוף פרטים לפונה)
CREATE OR REPLACE FUNCTION business_profile._invite_status(i business_profile.owner_invites)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN i.used_at IS NOT NULL THEN 'used'
              WHEN i.revoked_at IS NOT NULL THEN 'revoked'
              WHEN i.expires_at <= now() THEN 'expired'
              WHEN business_profile._has_owner(i.tenant_id) THEN 'owner_exists'
              ELSE 'valid' END;
$$;
REVOKE ALL ON FUNCTION business_profile._invite_status(business_profile.owner_invites) FROM PUBLIC, anon, authenticated;

-- ---------- 1. יצירה (מנהל הפלטפורמה) ----------
CREATE OR REPLACE FUNCTION public.platform_bp_invite_create(_tenant uuid, _token_hash text, _hours integer DEFAULT 72)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _h integer := COALESCE(_hours, 72);
  _old uuid;
  i business_profile.owner_invites;
BEGIN
  PERFORM business_profile._require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.site_type = 'business_profile') THEN
    RAISE EXCEPTION 'אתר העסק לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'קוד ההזמנה לא תקין' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _h NOT BETWEEN 1 AND 168 THEN
    RAISE EXCEPTION 'תוקף ההזמנה: 1 עד 168 שעות' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bp_owner:' || _tenant::text, 0));
  IF business_profile._has_owner(_tenant) THEN
    RAISE EXCEPTION 'לאתר כבר יש בעלת אתר — אין צורך בהזמנה' USING ERRCODE = 'check_violation';
  END IF;
  -- הזמנה קודמת שעוד פתוחה (גם אם פג תוקפה) — מבוטלת ומתועדת
  FOR _old IN
    UPDATE business_profile.owner_invites
       SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'replaced'
     WHERE tenant_id = _tenant AND used_at IS NULL AND revoked_at IS NULL
    RETURNING id
  LOOP
    PERFORM business_profile._invite_log(_tenant, auth.uid(), 'bp_owner_invite_revoked', 'owner_invite.revoked',
                                         jsonb_build_object('invite', _old, 'reason', 'replaced'));
  END LOOP;
  INSERT INTO business_profile.owner_invites (tenant_id, token_hash, created_by, expires_at)
  VALUES (_tenant, _token_hash, auth.uid(), now() + make_interval(hours => _h))
  RETURNING * INTO i;
  PERFORM business_profile._invite_log(_tenant, auth.uid(), 'bp_owner_invite_created', 'owner_invite.created',
                                       jsonb_build_object('invite', i.id, 'hours', _h, 'expires_at', i.expires_at));
  RETURN jsonb_build_object('id', i.id, 'expires_at', i.expires_at,
                            'slug', (SELECT t.slug FROM public.tenants t WHERE t.id = _tenant));
END $$;

-- ---------- 2. ביטול (מנהל הפלטפורמה) ----------
CREATE OR REPLACE FUNCTION public.platform_bp_invite_revoke(_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _id uuid;
  _n integer := 0;
BEGIN
  PERFORM business_profile._require_platform_admin();
  PERFORM pg_advisory_xact_lock(hashtextextended('bp_owner:' || _tenant::text, 0));
  FOR _id IN
    UPDATE business_profile.owner_invites
       SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'revoked'
     WHERE tenant_id = _tenant AND used_at IS NULL AND revoked_at IS NULL
    RETURNING id
  LOOP
    _n := _n + 1;
    PERFORM business_profile._invite_log(_tenant, auth.uid(), 'bp_owner_invite_revoked', 'owner_invite.revoked',
                                         jsonb_build_object('invite', _id, 'reason', 'revoked'));
  END LOOP;
  RETURN jsonb_build_object('revoked', _n);
END $$;

-- ---------- 3. מצב ההזמנה לתיק האתר (מנהל הפלטפורמה) ----------
CREATE OR REPLACE FUNCTION public.platform_bp_invite_state(_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _owner record;
BEGIN
  PERFORM business_profile._require_platform_admin();
  SELECT ur.user_id, lower(u.email) AS email INTO _owner
    FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
   WHERE ur.tenant_id = _tenant AND ur.role = 'admin' AND ur.is_protected
   ORDER BY ur.created_at LIMIT 1;
  RETURN jsonb_build_object(
    'has_owner', _owner.user_id IS NOT NULL,
    'owner_email', _owner.email,
    -- אימות המייל של בעלת האתר — רק אם נכנסה דרך הזמנה (אחרת: לא ידוע כאן)
    'owner_email_verified_at', (SELECT i.email_verified_at FROM business_profile.owner_invites i
                                 WHERE i.tenant_id = _tenant AND i.used_by = _owner.user_id
                                 ORDER BY i.used_at DESC LIMIT 1),
    'owner_via_invite', EXISTS (SELECT 1 FROM business_profile.owner_invites i
                                 WHERE i.tenant_id = _tenant AND i.used_by = _owner.user_id),
    'open', (SELECT jsonb_build_object('id', i.id, 'created_at', i.created_at, 'expires_at', i.expires_at,
                                       'expired', i.expires_at <= now(),
                                       'created_by', (SELECT lower(u.email) FROM auth.users u WHERE u.id = i.created_by))
               FROM business_profile.owner_invites i
              WHERE i.tenant_id = _tenant AND i.used_at IS NULL AND i.revoked_at IS NULL),
    'history', COALESCE((SELECT jsonb_agg(h ORDER BY h ->> 'created_at' DESC) FROM (
                 SELECT jsonb_build_object('id', i.id, 'created_at', i.created_at, 'expires_at', i.expires_at,
                                           'status', business_profile._invite_status(i),
                                           'revoked_at', i.revoked_at, 'revoke_reason', i.revoke_reason,
                                           'used_at', i.used_at, 'used_email', i.used_email,
                                           'email_verified_at', i.email_verified_at) AS h
                   FROM business_profile.owner_invites i
                  WHERE i.tenant_id = _tenant
                  ORDER BY i.created_at DESC LIMIT 10) x), '[]'::jsonb)
  );
END $$;

-- ---------- 4. בדיקת קישור (השרת — לפני הצגת הטופס) ----------
-- תשובה לפונה: valid / invalid / expired / used / revoked / owner_exists. קישור לא מוכר או של אתר אחר → invalid
-- (בלי לחשוף שקיים). כל תשובה שאינה valid נרשמת ביומן.
CREATE OR REPLACE FUNCTION public.bp_invite_check(_token_hash text, _tenant uuid, _ip text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i business_profile.owner_invites;
  _status text;
  _ip_tag jsonb := CASE WHEN _ip ~ '^[0-9a-f]{16,64}$' THEN jsonb_build_object('ip', left(_ip, 16)) ELSE '{}'::jsonb END;
BEGIN
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM business_profile._invite_log(NULL, NULL, 'bp_owner_invite_failed', 'owner_invite.failed',
                                         jsonb_build_object('reason', 'malformed', 'stage', 'check') || _ip_tag);
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  SELECT * INTO i FROM business_profile.owner_invites WHERE token_hash = _token_hash;
  IF NOT FOUND THEN
    PERFORM business_profile._invite_log(NULL, NULL, 'bp_owner_invite_failed', 'owner_invite.failed',
                                         jsonb_build_object('reason', 'unknown', 'stage', 'check') || _ip_tag);
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF i.tenant_id IS DISTINCT FROM _tenant THEN
    PERFORM business_profile._invite_log(i.tenant_id, NULL, 'bp_owner_invite_failed', 'owner_invite.failed',
                                         jsonb_build_object('invite', i.id, 'reason', 'wrong_site', 'stage', 'check') || _ip_tag);
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  _status := business_profile._invite_status(i);
  IF _status <> 'valid' THEN
    PERFORM business_profile._invite_log(i.tenant_id, NULL, 'bp_owner_invite_failed', 'owner_invite.failed',
                                         jsonb_build_object('invite', i.id, 'reason', _status, 'stage', 'check') || _ip_tag);
    RETURN jsonb_build_object('status', _status);
  END IF;
  RETURN jsonb_build_object('status', 'valid', 'expires_at', i.expires_at,
                            'site_name', (SELECT t.name FROM public.tenants t WHERE t.id = i.tenant_id));
END $$;

-- ---------- 5. מימוש (השרת — אחרי שפתח חשבון חדש) ----------
-- מחזיר ok=false (ונרשם ביומן) כשהקישור כבר לא תקף או החשבון לא מתאים — השרת מוחק אז את החשבון שפתח.
CREATE OR REPLACE FUNCTION public.bp_invite_redeem(_token_hash text, _tenant uuid, _user_id uuid,
                                                   _handoff_hash text, _ip text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i business_profile.owner_invites;
  _status text;
  _email text;
  _ip_tag jsonb := CASE WHEN _ip ~ '^[0-9a-f]{16,64}$' THEN jsonb_build_object('ip', left(_ip, 16)) ELSE '{}'::jsonb END;
  _fail text := NULL;
BEGIN
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$'
     OR _handoff_hash IS NULL OR _handoff_hash !~ '^[0-9a-f]{64}$' OR _handoff_hash = _token_hash THEN
    RAISE EXCEPTION 'בקשה לא תקינה' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO i FROM business_profile.owner_invites WHERE token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM business_profile._invite_log(NULL, _user_id, 'bp_owner_invite_failed', 'owner_invite.failed',
                                         jsonb_build_object('reason', 'unknown', 'stage', 'redeem') || _ip_tag);
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  IF i.tenant_id IS DISTINCT FROM _tenant THEN
    PERFORM business_profile._invite_log(i.tenant_id, _user_id, 'bp_owner_invite_failed', 'owner_invite.failed',
                                         jsonb_build_object('invite', i.id, 'reason', 'wrong_site', 'stage', 'redeem') || _ip_tag);
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bp_owner:' || i.tenant_id::text, 0));
  _status := business_profile._invite_status(i);

  SELECT lower(u.email) INTO _email FROM auth.users u WHERE u.id = _user_id AND u.deleted_at IS NULL;
  IF _status <> 'valid' THEN
    _fail := _status;
  ELSIF _email IS NULL THEN
    _fail := 'no_account';
  ELSIF public.is_platform_admin(_user_id) THEN
    _fail := 'platform_admin_account';
  ELSIF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id) THEN
    -- רק חשבון חדש לגמרי (בלי שום שיוך — לא לקוח, לא צוות, לא אתר אחר)
    _fail := 'account_has_roles';
  END IF;
  IF _fail IS NOT NULL THEN
    PERFORM business_profile._invite_log(i.tenant_id, _user_id, 'bp_owner_invite_failed', 'owner_invite.failed',
                                         jsonb_build_object('invite', i.id, 'reason', _fail, 'stage', 'redeem') || _ip_tag);
    RETURN jsonb_build_object('ok', false, 'reason', _fail);
  END IF;

  INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_protected)
  VALUES (i.tenant_id, _user_id, _email, 'admin', true, true);
  UPDATE public.tenants SET owner_email = _email WHERE id = i.tenant_id;
  UPDATE business_profile.owner_invites
     SET used_at = now(), used_by = _user_id, used_email = _email
   WHERE id = i.id;
  -- הכניסה הרגילה לממשק הניהול: קוד חד-פעמי לאתר הזה בלבד (בדיוק כמו "כניסה לניהול" מהשער)
  INSERT INTO public.platform_admin_handoffs (token_hash, user_id, tenant_id, expires_at, kind)
  VALUES (_handoff_hash, _user_id, i.tenant_id, now() + interval '2 minutes', 'store_owner');

  PERFORM business_profile._invite_log(i.tenant_id, _user_id, 'bp_owner_invite_redeemed', 'owner_invite.redeemed',
                                       jsonb_build_object('invite', i.id) || _ip_tag);
  PERFORM business_profile._invite_log(i.tenant_id, _user_id, 'bp_owner_set', 'site.owner_set', jsonb_build_object('via', 'invite'));
  RETURN jsonb_build_object('ok', true,
                            'slug', (SELECT t.slug FROM public.tenants t WHERE t.id = i.tenant_id),
                            'email', _email);
END $$;

-- ---------- 6. אימות המייל של בעלת האתר ----------
-- המצב למשתמשת המחוברת (ממשק הניהול): צריך אימות? (רק מי שנכנסה דרך הזמנה ועוד לא אימתה)
CREATE OR REPLACE FUNCTION public.bp_owner_email_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.request_site();
  i business_profile.owner_invites;
BEGIN
  IF auth.uid() IS NULL OR _t IS NULL THEN
    RETURN jsonb_build_object('needed', false);
  END IF;
  SELECT * INTO i FROM business_profile.owner_invites
   WHERE tenant_id = _t AND used_by = auth.uid()
   ORDER BY used_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('needed', false);
  END IF;
  RETURN jsonb_build_object('needed', i.email_verified_at IS NULL, 'email', i.used_email,
                            'verified_at', i.email_verified_at);
END $$;

-- השרת: קוד אימות חדש (אחרי שנשלח מייל) — רק למשתמשת שמימשה הזמנה באתר הזה ועוד לא אימתה. קוד חדש מחליף את
-- הקודם; לא יותר מקוד אחד בחצי דקה.
CREATE OR REPLACE FUNCTION public.bp_owner_email_code_issue(_tenant uuid, _user_id uuid, _code_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i business_profile.owner_invites;
BEGIN
  IF _code_hash IS NULL OR _code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'קוד לא תקין' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO i FROM business_profile.owner_invites
   WHERE tenant_id = _tenant AND used_by = _user_id
   ORDER BY used_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR i.email_verified_at IS NOT NULL THEN
    RETURN jsonb_build_object('needed', false);
  END IF;
  IF i.verify_sent_at IS NOT NULL AND i.verify_sent_at > now() - interval '30 seconds' THEN
    RAISE EXCEPTION 'קוד נשלח זה עתה — אפשר לבקש קוד חדש בעוד חצי דקה' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE business_profile.owner_invites
     SET verify_code_hash = _code_hash, verify_expires_at = now() + interval '10 minutes',
         verify_sent_at = now(), verify_attempts = 0
   WHERE id = i.id;
  RETURN jsonb_build_object('needed', true, 'email', i.used_email);
END $$;

-- השרת: בדיקת הקוד. נכון → המייל מאומת (ונרשם), והחשבון מסומן platform. שגוי → עוד ניסיון (עד 5).
CREATE OR REPLACE FUNCTION public.bp_owner_email_code_verify(_tenant uuid, _user_id uuid, _code_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i business_profile.owner_invites;
BEGIN
  SELECT * INTO i FROM business_profile.owner_invites
   WHERE tenant_id = _tenant AND used_by = _user_id
   ORDER BY used_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'none');
  END IF;
  IF i.email_verified_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'ok');
  END IF;
  IF i.verify_code_hash IS NULL THEN
    RETURN jsonb_build_object('result', 'none');
  END IF;
  IF i.verify_expires_at <= now() OR i.verify_attempts >= 5 THEN
    UPDATE business_profile.owner_invites SET verify_code_hash = NULL WHERE id = i.id;
    RETURN jsonb_build_object('result', 'expired');
  END IF;
  IF _code_hash IS DISTINCT FROM i.verify_code_hash THEN
    UPDATE business_profile.owner_invites
       SET verify_attempts = verify_attempts + 1,
           verify_code_hash = CASE WHEN verify_attempts + 1 >= 5 THEN NULL ELSE verify_code_hash END
     WHERE id = i.id;
    RETURN jsonb_build_object('result', CASE WHEN i.verify_attempts + 1 >= 5 THEN 'locked' ELSE 'invalid' END,
                              'left', greatest(0, 4 - i.verify_attempts));
  END IF;
  UPDATE business_profile.owner_invites
     SET email_verified_at = now(), verify_code_hash = NULL, verify_expires_at = NULL
   WHERE id = i.id;
  -- SEC-H1: קוד נכון שנשלח לתיבה = החשבון "מאומת" (כמו consume_login_code)
  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"platform": true}'::jsonb
   WHERE id = _user_id AND COALESCE(raw_app_meta_data ->> 'platform', '') <> 'true';
  PERFORM business_profile._invite_log(_tenant, _user_id, 'bp_owner_email_verified', 'owner.email_verified',
                                       jsonb_build_object('invite', i.id));
  RETURN jsonb_build_object('result', 'ok');
END $$;

-- השרת: כישלון שקרה לפני המימוש (למשל המייל כבר רשום במערכת) — ביומן, צמוד להזמנה אם היא של האתר הזה
CREATE OR REPLACE FUNCTION public.bp_invite_fail(_token_hash text, _tenant uuid, _reason text, _ip text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _id uuid;
  _ip_tag jsonb := CASE WHEN _ip ~ '^[0-9a-f]{16,64}$' THEN jsonb_build_object('ip', left(_ip, 16)) ELSE '{}'::jsonb END;
BEGIN
  IF _reason IS NULL OR _reason !~ '^[a-z_]{3,40}$' THEN
    RAISE EXCEPTION 'סיבה לא תקינה' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT i.id INTO _id FROM business_profile.owner_invites i
   WHERE i.token_hash = _token_hash AND i.tenant_id = _tenant;
  PERFORM business_profile._invite_log(CASE WHEN _id IS NULL THEN NULL ELSE _tenant END, NULL,
                                       'bp_owner_invite_failed', 'owner_invite.failed',
                                       jsonb_build_object('reason', _reason, 'stage', 'redeem')
                                         || CASE WHEN _id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('invite', _id) END
                                         || _ip_tag);
END $$;

-- ---------- הרשאות ----------
REVOKE ALL ON FUNCTION public.platform_bp_invite_create(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_bp_invite_revoke(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_bp_invite_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_bp_invite_create(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_bp_invite_revoke(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_bp_invite_state(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bp_invite_check(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_invite_redeem(text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_owner_email_code_issue(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_owner_email_code_verify(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_invite_fail(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_invite_check(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bp_invite_redeem(text, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bp_owner_email_code_issue(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bp_owner_email_code_verify(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bp_invite_fail(text, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.bp_owner_email_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_owner_email_status() TO authenticated, service_role;

COMMIT;
