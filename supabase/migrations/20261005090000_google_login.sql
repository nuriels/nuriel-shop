-- ============================================================
-- קובי: התחברות עם Google (05.10.2026)
-- ============================================================
-- מדיניות קובי לא משתנה: משתמש חדש מ-Google נרשם כלקוח **ממתין לאישור מנהל**
-- (אותה שורת "כניסה ראשונה" שכבר קיימת ב-useAuthState), ורואה מחירים רק אחרי
-- אישור — בדיוק כמו כל הרשמה.
-- כאן רק: אין חשבון כפול. חשבון חדש דרך Google עם אימייל שכבר שייך לחשבון אחר
-- נחסם (חשבון קיים עם אותו אימייל — GoTrue מחבר אליו את Google אוטומטית).
-- אידמפוטנטי.
-- ============================================================
CREATE OR REPLACE FUNCTION public.email_has_other_account(_email text, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r
                  WHERE lower(r.email) = lower(_email) AND r.user_id <> _user_id)
      OR EXISTS (SELECT 1 FROM auth.users u
                  WHERE lower(u.email) = lower(_email) AND u.id <> _user_id);
$$;
REVOKE ALL ON FUNCTION public.email_has_other_account(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_has_other_account(text, uuid) TO supabase_auth_admin;

-- SECURITY INVOKER בכוונה: רץ על כל יצירת זהות (כל התחברות ראשונה) בתפקיד של
-- GoTrue, שהוא הבעלים של auth.*. החיפוש בטבלאות public עובר דרך ה-helper בלבד.
CREATE OR REPLACE FUNCTION public.google_login_no_duplicate_accounts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = auth, public AS $$
DECLARE
  v_email text;
BEGIN
  IF NEW.provider <> 'google' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.identities i
              WHERE i.user_id = NEW.user_id AND i.provider <> 'google') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u
                  WHERE u.id = NEW.user_id
                    AND u.created_at > clock_timestamp() - interval '2 minutes') THEN
    RETURN NEW;
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = NEW.user_id;
  IF v_email IS NOT NULL AND public.email_has_other_account(v_email, NEW.user_id) THEN
    RAISE EXCEPTION 'google_login_email_taken'
      USING HINT = 'This email already belongs to an account - sign in with email and password',
            ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.google_login_no_duplicate_accounts() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS google_login_no_duplicate_accounts ON auth.identities;
CREATE TRIGGER google_login_no_duplicate_accounts
BEFORE INSERT ON auth.identities
FOR EACH ROW EXECUTE FUNCTION public.google_login_no_duplicate_accounts();
