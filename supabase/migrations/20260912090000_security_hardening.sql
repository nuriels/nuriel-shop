-- ============================================================
-- חיזוק אבטחה בעקבות סריקת קוד.
-- ============================================================

-- ============================================================
-- 1. 🔴 מניעת מניפולציה על מחירים בהזמנה
-- ============================================================
-- מדיניות ה-RLS אפשרה ללקוח להוסיף שורות הזמנה משלו — אבל `unit_price`
-- הגיע מהדפדפן ולא נבדק. כלומר לקוח יכול היה לשלוח בקשת API ישירה
-- (עם המפתח הציבורי, בלי לגעת בממשק) ולהזמין ב-₪0.01.
-- מעתה: עבור מי שאינו מנהל/סוכן, מחיר היחידה נקבע *תמיד* בשרת לפי דרג
-- המחיר של הלקוח ומבצע פעיל, ומה שנשלח מהדפדפן פשוט מתעלמים ממנו.
CREATE OR REPLACE FUNCTION public.snapshot_order_item_product()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  parent RECORD;
  buyer_tier SMALLINT;
  authoritative NUMERIC;
BEGIN
  SELECT name, sku, barcode, category, image_url, shelf_location,
         price_tier1, price_tier2, price_tier3, sale_price, sale_starts_at, sale_ends_at
    INTO p
    FROM public.global_products WHERE id = NEW.product_id;

  IF FOUND THEN
    NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), p.name);
    NEW.product_sku := COALESCE(NEW.product_sku, p.sku);
    NEW.product_barcode := COALESCE(NEW.product_barcode, p.barcode);
    NEW.product_category := COALESCE(NEW.product_category, p.category);
    NEW.product_image_url := COALESCE(NEW.product_image_url, p.image_url);
    NEW.product_shelf_location := COALESCE(NEW.product_shelf_location, p.shelf_location);
  END IF;

  SELECT kind, customer_id INTO parent FROM public.orders WHERE id = NEW.order_id;

  IF FOUND AND NOT public.is_staff(auth.uid()) THEN
    IF parent.kind = 'quote' THEN
      -- בקשת הצעת מחיר אינה מכילה מחירים בכלל
      NEW.unit_price := 0;
    ELSIF p IS NOT NULL THEN
      SELECT cp.price_tier INTO buyer_tier
        FROM public.customer_profiles cp
       WHERE cp.user_id = parent.customer_id;

      authoritative := CASE buyer_tier
                         WHEN 1 THEN p.price_tier1
                         WHEN 2 THEN p.price_tier2
                         WHEN 3 THEN p.price_tier3
                       END;

      IF public.sale_is_active(p.sale_price, p.sale_starts_at, p.sale_ends_at) THEN
        authoritative := p.sale_price;
      END IF;

      -- אין דרג משויך = אין הרשאה לתמחר בכלל
      NEW.unit_price := COALESCE(authoritative, 0);
    END IF;
  END IF;

  RETURN NEW;
END; $$;

-- ============================================================
-- 2. 🔴 אכיפת סטטוס וסוג ההזמנה בצד השרת
-- ============================================================
-- לקוח יכול היה ליצור הזמנה עם `status = 'shipped'` (או כל סטטוס אחר)
-- ולעקוף את זרימת העבודה, וגם להזמין לפני שהשלים את פרטי העסק — מסך
-- ההשלמה נאכף עד כה בממשק בלבד.
CREATE OR REPLACE FUNCTION public.enforce_order_kind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE profile_ok BOOLEAN;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    -- הזמנה חדשה של לקוח נכנסת תמיד בתחילת הזרימה
    NEW.status := 'pending';
    NEW.total := 0;

    IF NOT public.customer_has_prices(NEW.customer_id) THEN
      NEW.kind := 'quote';
    END IF;

    SELECT COALESCE(cp.profile_completed, false) INTO profile_ok
      FROM public.customer_profiles cp
     WHERE cp.user_id = NEW.customer_id;

    IF profile_ok IS NOT TRUE THEN
      RAISE EXCEPTION 'יש להשלים את פרטי העסק לפני שליחת הזמנה או בקשה';
    END IF;
  END IF;

  IF NEW.kind NOT IN ('order', 'quote') THEN
    NEW.kind := 'order';
  END IF;
  RETURN NEW;
END; $$;

-- ============================================================
-- 3. 🟠 חסימת מנוי-אימיילים דרך פונקציית תרגום שם המשתמש
-- ============================================================
-- `resolve_login_email` הייתה חשופה ל-anon, כלומר כל אחד עם המפתח
-- הציבורי (שמופיע בקוד הדפדפן) יכול היה לשאול "מה האימייל של שם המשתמש
-- הזה" ולמפות שמות משתמש לכתובות מייל. ההתחברות עברה ל-server function
-- שמבצעת את התרגום בשרת ולא מחזירה את האימייל ללקוח.
REVOKE ALL ON FUNCTION public.resolve_login_email(text) FROM anon;

-- ============================================================
-- 4. 🟡 תוקף לקישור החתימה על תנאי השירות
-- ============================================================
-- הטוקן היה חסר תוקף, כלומר קישור שנשלח פעם אחת נשאר תקף לנצח.
ALTER TABLE public.service_agreements
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

UPDATE public.service_agreements
SET token_expires_at = COALESCE(sent_at, created_at) + INTERVAL '14 days'
WHERE token_expires_at IS NULL AND signed_at IS NULL;
