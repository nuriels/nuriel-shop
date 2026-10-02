-- ============================================================
-- התראות מערכת בפעמון המנהלים (03.10.2026)
-- ============================================================
-- משמש את סקריפט הגיבוי היומי (deploy/backup-daily.sh): גיבוי שנכשל מופיע
-- בפעמון של כל מנהל, במקום להיכשל בשקט בלוג שאף אחד לא קורא.
-- אידמפוטנטי: בטוח להרצה חוזרת.

DO $$ BEGIN
  ALTER TABLE public.staff_notifications DROP CONSTRAINT IF EXISTS staff_notifications_kind_check;
  ALTER TABLE public.staff_notifications
    ADD CONSTRAINT staff_notifications_kind_check
    CHECK (kind IN ('new_customer', 'new_order', 'out_of_stock', 'system'));
END $$;

-- נקרא רק מהשרת (psql כ-postgres מתוך הסקריפט). אין הרשאה למשתמשי האתר —
-- אחרת כל אחד היה יכול לשלוח "התראות מערכת" למנהלים.
CREATE OR REPLACE FUNCTION public.notify_admins_system(_title TEXT, _body TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sent INTEGER;
BEGIN
  INSERT INTO public.staff_notifications (user_id, kind, title, body, link)
  SELECT ur.user_id, 'system', _title, COALESCE(_body, ''), NULL
    FROM public.user_roles ur
   WHERE ur.role = 'admin' AND NOT ur.is_blocked;
  GET DIAGNOSTICS sent = ROW_COUNT;
  RETURN sent;
END; $$;
REVOKE ALL ON FUNCTION public.notify_admins_system(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_admins_system(TEXT, TEXT) TO service_role;
