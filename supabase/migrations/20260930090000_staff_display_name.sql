-- ============================================================
-- שם מלא בעברית לעובדים (סוכנים ומנהלים)
-- ============================================================
-- display_name מוצג ללקוחות במקום שם המשתמש/האימייל: במסמך ההזמנה,
-- בבון הליקוט ובאזור האישי ("סוכן מטפל"). רק מנהל (או השרת) יכול לשנות
-- אותו — סוכן לא יכול לשנות לעצמו את השם שמוצג ללקוחות.
--
-- אידמפוטנטי: בטוח להרצה חוזרת.

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS display_name TEXT;

DO $$
BEGIN
  ALTER TABLE public.user_roles
    ADD CONSTRAINT user_roles_display_name_check
    CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- אותה פונקציה כמו ב-20260911090000_user_onboarding, בתוספת display_name
CREATE OR REPLACE FUNCTION public.protect_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    NEW.role := OLD.role;
    NEW.is_approved := OLD.is_approved;
    NEW.is_blocked := OLD.is_blocked;
    NEW.email := OLD.email;
    NEW.agent_number := OLD.agent_number;
    NEW.must_change_password := OLD.must_change_password;
    NEW.display_name := OLD.display_name;
  END IF;
  -- is_protected אינו ניתן לשינוי מהאפליקציה בכלל, גם לא ע"י אדמין
  IF auth.uid() IS NOT NULL THEN
    NEW.is_protected := OLD.is_protected;
  END IF;
  RETURN NEW;
END; $$;

-- ============================================================
-- שמות עובדים להצגה ללקוח — רק שם בעברית ומספר סוכן, רק של עובדים.
-- (ללקוח אין הרשאה לקרוא את user_roles של אחרים — וטוב שכך, שם יש אימיילים.)
-- ============================================================
CREATE OR REPLACE FUNCTION public.staff_display_names(_ids UUID[])
RETURNS TABLE (user_id UUID, display_name TEXT, agent_number TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ur.user_id, NULLIF(btrim(ur.display_name), ''), ur.agent_number
    FROM public.user_roles ur
   WHERE ur.user_id = ANY(_ids)
     AND ur.role IN ('agent', 'admin');
$$;
REVOKE ALL ON FUNCTION public.staff_display_names(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_display_names(UUID[]) TO authenticated, service_role;
