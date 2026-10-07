-- ============================================================
-- חלק 30: עמודי תוכן (Pages CMS)
-- ============================================================
-- עמודי מידע שבעל החנות כותב בעצמו — "מדיניות משלוחים", "שאלות נפוצות",
-- "מדיניות החזרות" וכו':
--   • בחזית החנות: /pages/<slug>
--   • בתחתית האתר: העמודים שפורסמו, תחת "מידע שימושי"
--   • בניהול: לשונית "עמודי תוכן" (/admin/pages)
--
-- הכתובת (slug) — אותיות באנגלית קטנות, ספרות ומקפים; ייחודית בכל חנות.
-- התוכן — HTML מהעורך העשיר. הוא נשמר כמו שהוא ומנוקה בכל הצגה
-- (DOMPurify ברשימה סגורה, src/lib/rich-text.ts), כמו העמודים המשפטיים.
--
-- הדומיין האישי של החנות כבר קיים מחלק 9 (tenants.custom_domain + הניתוב
-- ב-tenant_for_host) — לא נוגעים בו כאן.
--
-- ניתן להרצה חוזרת.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.pages (
  id            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL DEFAULT public.current_tenant_id()
                REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  content_html  TEXT NOT NULL DEFAULT '',
  is_published  BOOLEAN NOT NULL DEFAULT true,
  -- הסדר ב"מידע שימושי" (קטן = ראשון)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pages_tenant_slug_key UNIQUE (tenant_id, slug),
  CONSTRAINT pages_slug_format CHECK (
    char_length(slug) BETWEEN 1 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT pages_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT pages_content_length CHECK (char_length(content_html) <= 200000)
);
CREATE INDEX IF NOT EXISTS pages_tenant_order_idx
  ON public.pages (tenant_id, sort_order, created_at);

COMMENT ON TABLE public.pages IS
  'עמודי תוכן של החנות (מדיניות משלוחים, שאלות נפוצות…) — /pages/<slug> ו"מידע שימושי" בתחתית האתר';

-- ניקוי + הודעות ברורות לפני ה-CHECK, עד 50 עמודים לחנות, סדר אוטומטי
CREATE OR REPLACE FUNCTION public.pages_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.title := btrim(regexp_replace(COALESCE(NEW.title, ''), '\s+', ' ', 'g'));
  NEW.slug := lower(btrim(COALESCE(NEW.slug, '')));
  NEW.content_html := COALESCE(NEW.content_html, '');

  IF NEW.title = '' THEN
    RAISE EXCEPTION 'כותרת העמוד היא שדה חובה' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(NEW.title) > 120 THEN
    RAISE EXCEPTION 'כותרת העמוד ארוכה מדי (עד 120 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.slug = '' OR char_length(NEW.slug) > 80
     OR NEW.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'כתובת העמוד: אותיות באנגלית קטנות, ספרות ומקפים בלבד (למשל shipping-policy), עד 80 תווים'
      USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(NEW.content_html) > 200000 THEN
    RAISE EXCEPTION 'תוכן העמוד ארוך מדי' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pages p
     WHERE p.tenant_id = NEW.tenant_id AND p.slug = NEW.slug AND p.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'כבר יש עמוד עם הכתובת /pages/% — בחרו כתובת אחרת', NEW.slug
      USING ERRCODE = 'unique_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF (SELECT count(*) FROM public.pages p WHERE p.tenant_id = NEW.tenant_id) >= 50 THEN
      RAISE EXCEPTION 'אפשר עד 50 עמודי תוכן לחנות — מחקו עמודים שלא בשימוש כדי להוסיף חדשים'
        USING ERRCODE = 'check_violation';
    END IF;
    -- עמוד חדש בלי סדר מפורש — בסוף הרשימה
    IF NEW.sort_order = 0 THEN
      NEW.sort_order := COALESCE(
        (SELECT max(p.sort_order) FROM public.pages p WHERE p.tenant_id = NEW.tenant_id), 0) + 1;
    END IF;
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pages_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pages_guard ON public.pages;
CREATE TRIGGER pages_guard
  BEFORE INSERT OR UPDATE ON public.pages
  FOR EACH ROW EXECUTE FUNCTION public.pages_guard();

-- ============================================================
-- הרשאות: כל חנות רואה רק את העמודים שלה. עמוד שפורסם — לכולם (גם
-- אורחים); טיוטה — רק למנהל החנות. כתיבה — מנהל החנות בלבד.
-- ============================================================
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.pages;
CREATE POLICY tenant_isolation ON public.pages
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));

DROP POLICY IF EXISTS "published pages are public" ON public.pages;
CREATE POLICY "published pages are public" ON public.pages
  FOR SELECT TO anon, authenticated
  USING (is_published);

DROP POLICY IF EXISTS "pages managed by admin" ON public.pages;
CREATE POLICY "pages managed by admin" ON public.pages
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

REVOKE ALL ON public.pages FROM anon, authenticated;
GRANT SELECT ON public.pages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pages TO authenticated;
GRANT ALL ON public.pages TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
