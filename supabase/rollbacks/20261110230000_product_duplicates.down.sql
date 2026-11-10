-- Rollback של 20261110230000_product_duplicates.sql (מוצרים כפולים: זיהוי, "לא כפול", מיזוג, הצעות AI)
-- מוחק את הפונקציות ואת שתי הטבלאות. נעצר כשיש מיזוגים ביומן (product_merges) — היומן הוא הדרך היחידה
-- לשחזר מוצרים שמוזגו; מייצאים אותו קודם (pg_dump -t public.product_merges) ומוחקים אותו ידנית רק אחרי
-- החלטה. סימוני "לא כפול" נמחקים (אין בהם מידע שאי אפשר לשחזר — רק הסימון).
-- המוצרים עצמם, הביקורות, הקשרים והמחירים שעברו במיזוגים לא משתנים.
BEGIN;
SET LOCAL client_min_messages = warning;
DO $$
BEGIN
  IF to_regclass('public.product_merges') IS NOT NULL AND EXISTS (SELECT 1 FROM public.product_merges) THEN
    RAISE EXCEPTION 'product duplicates rollback stopped: public.product_merges has rows (the merge history is needed to restore merged products) — export it first'
      USING ERRCODE = 'object_in_use';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.product_merge(uuid, uuid[], text, uuid, integer, uuid[]);
DROP FUNCTION IF EXISTS public.product_duplicate_groups();
DROP FUNCTION IF EXISTS public.product_duplicate_cards(uuid[]);
DROP FUNCTION IF EXISTS public.product_duplicate_dismiss(uuid[]);
DROP FUNCTION IF EXISTS public.product_duplicate_dismissals_clear();
DROP FUNCTION IF EXISTS public.product_duplicate_ai_candidates(uuid, text, integer);
DROP FUNCTION IF EXISTS public._product_duplicate_cards(uuid, uuid[]);
DROP FUNCTION IF EXISTS public._product_keep_reasons(uuid);
DROP FUNCTION IF EXISTS public.product_name_key(text);
DROP TABLE IF EXISTS public.product_merges;
DROP TABLE IF EXISTS public.product_duplicate_dismissals;
NOTIFY pgrst, 'reload schema';
COMMIT;
