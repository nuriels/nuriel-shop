-- ============================================================
-- חלק 27: סלים נטושים — שליחה אוטומטית של תזכורות (בינתיים בהפעלה ידנית מהניהול)
--
-- מה כבר היה (חלק 14) ולא נבנה מחדש: abandoned_carts — נשמרת מהקופה ברגע שיש אימייל
-- (גם ללקוח מחובר), נסגרת לבד כשאותו אימייל משלים הזמנה; email = כתובת הנוטש,
-- last_reminder_at + reminder_count = "נשלחה תזכורת" (לכן לא נוספו customer_email /
-- abandoned_email_sent_at כפולים); מייל תזכורת עם המוצרים והלוגו וקישור שמשחזר את הסל
-- בקופה; מסך "עגלות נטושות" בניהול.
--
-- חדש: abandoned_carts_due — הסלים של החנות שמחכים לתזכורת ראשונה: פתוחים, עם אימייל
-- ומוצרים, בלי תזכורת, ועודכנו לפני יותר מ-X שעות (ברירת מחדל 4). מנהל החנות בלבד.
-- אידמפוטנטית.
-- ============================================================

CREATE OR REPLACE FUNCTION public.abandoned_carts_due(_min_age_hours INTEGER DEFAULT 4, _limit INTEGER DEFAULT 25)
RETURNS SETOF UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid UUID := public.current_tenant_id();
BEGIN
  IF _tid IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT c.id FROM public.abandoned_carts c
     WHERE c.tenant_id = _tid AND c.status = 'open'
       AND c.email IS NOT NULL AND btrim(c.email) <> ''
       AND COALESCE(c.item_count, 0) > 0
       AND COALESCE(c.reminder_count, 0) = 0
       AND c.updated_at < now() - make_interval(hours => GREATEST(1, LEAST(COALESCE(_min_age_hours, 4), 720)))
     ORDER BY c.updated_at
     LIMIT GREATEST(1, LEAST(COALESCE(_limit, 25), 100));
END; $$;
REVOKE ALL ON FUNCTION public.abandoned_carts_due(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abandoned_carts_due(INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
