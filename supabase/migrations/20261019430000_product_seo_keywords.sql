-- ============================================================
-- חלק 36: SEO פרטני למוצר — מילות מפתח / תגיות
--
-- טבלת המוצרים של החנויות היא global_products. כותרת ותיאור לגוגל
-- (seo_title / seo_description) כבר קיימים מחלק 14 — כאן מוודאים שהם קיימים,
-- ומוסיפים seo_keywords: מילות מפתח מופרדות בפסיקים, שמוזרקות לתגית
-- <meta name="keywords"> בעמוד המוצר.
--
-- הניקוי נעשה במסד (טריגר): פיצול לפי פסיק / נקודה-פסיק / שורה חדשה,
-- רווחים מיותרים, כפילויות (בלי הבדל אותיות גדולות/קטנות) — ונשמר כ-
-- "מילה, מילה, מילה". עד 30 מילים, עד 60 תווים למילה, עד 500 תווים בסך הכל.
-- ריק = NULL (בעמוד המוצר אין אז תגית keywords).
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_keywords text;

ALTER TABLE public.global_products DROP CONSTRAINT IF EXISTS global_products_seo_keywords_check;
ALTER TABLE public.global_products ADD CONSTRAINT global_products_seo_keywords_check
  CHECK (seo_keywords IS NULL OR char_length(seo_keywords) BETWEEN 1 AND 500);

COMMENT ON COLUMN public.global_products.seo_keywords IS
  'חלק 36: מילות מפתח / תגיות לגוגל (מופרדות בפסיקים) — <meta name="keywords"> בעמוד המוצר';

-- ניקוי רשימת מילות המפתח
CREATE OR REPLACE FUNCTION public.normalize_seo_keywords(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_word text;
  v_seen text[] := '{}';
  v_out text[] := '{}';
BEGIN
  IF _raw IS NULL OR btrim(_raw) = '' THEN
    RETURN NULL;
  END IF;
  FOREACH v_word IN ARRAY regexp_split_to_array(_raw, '[,;،\n\r]+') LOOP
    v_word := btrim(regexp_replace(v_word, '\s+', ' ', 'g'));
    CONTINUE WHEN v_word = '';
    IF char_length(v_word) > 60 THEN
      RAISE EXCEPTION 'מילת מפתח ארוכה מדי (עד 60 תווים): "%"', left(v_word, 40) || '…'
        USING ERRCODE = 'check_violation';
    END IF;
    CONTINUE WHEN lower(v_word) = ANY (v_seen);
    v_seen := v_seen || lower(v_word);
    v_out := v_out || v_word;
  END LOOP;
  IF cardinality(v_out) = 0 THEN
    RETURN NULL;
  END IF;
  IF cardinality(v_out) > 30 THEN
    RAISE EXCEPTION 'יותר מדי מילות מפתח (עד 30)' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(array_to_string(v_out, ', ')) > 500 THEN
    RAISE EXCEPTION 'מילות המפתח ארוכות מדי (עד 500 תווים בסך הכל)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN array_to_string(v_out, ', ');
END $$;
GRANT EXECUTE ON FUNCTION public.normalize_seo_keywords(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.global_products_seo_keywords()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.seo_keywords := public.normalize_seo_keywords(NEW.seo_keywords);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS global_products_seo_keywords ON public.global_products;
CREATE TRIGGER global_products_seo_keywords
  BEFORE INSERT OR UPDATE OF seo_keywords ON public.global_products
  FOR EACH ROW EXECUTE FUNCTION public.global_products_seo_keywords();

NOTIFY pgrst, 'reload schema';

COMMIT;
