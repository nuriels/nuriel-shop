-- שיתוף סניפים + קישור קטלוג ציבורי.
-- אידמפוטנטי — בטוח להרצה חוזרת.

-- 1. קישור קטלוג לצפייה בלבד: טוקן ייחודי פר סניף (NULL = כבוי)
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS catalog_share_token UUID UNIQUE;

-- 2. טבלת שיתופי סניפים
CREATE TABLE IF NOT EXISTS public.store_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  invited_name    TEXT NOT NULL CHECK (length(btrim(invited_name)) BETWEEN 2 AND 60),
  invited_user_id UUID,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  invited_by      UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at    TIMESTAMPTZ
);

-- משתמש מקושר אחד לכל סניף; והזמנה-לפי-שם אחת (עד שתיקשר) לכל שם בסניף
CREATE UNIQUE INDEX IF NOT EXISTS store_shares_unique_user
  ON public.store_shares (store_id, invited_user_id) WHERE invited_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS store_shares_unique_pending_name
  ON public.store_shares (store_id, lower(btrim(invited_name))) WHERE invited_user_id IS NULL;
CREATE INDEX IF NOT EXISTS store_shares_invited_user_idx ON public.store_shares (invited_user_id);

-- הטבלה מנוהלת אך ורק דרך פונקציות שרת (service_role); אין גישה ישירה מהלקוח
GRANT ALL ON public.store_shares TO service_role;
ALTER TABLE public.store_shares ENABLE ROW LEVEL SECURITY;

-- 3. הרחבת פונקציית ההרשאות המרכזית: בעלים או שותף מאושר (או סופר-אדמין).
--    כל מדיניות המלאי הקיימת עוברת דרכה — כך שותפים מקבלים גישה מלאה למלאי,
--    בעוד שעדכון/מחיקת הסניף עצמו (שם, PIN, מחיקה) נשארים לבעלים בלבד.
CREATE OR REPLACE FUNCTION public.owns_store(_store_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR (public.is_approved(_user_id) AND (
        EXISTS (
          SELECT 1 FROM public.stores s
          WHERE s.id = _store_id AND s.owner_id = _user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.store_shares sh
          WHERE sh.store_id = _store_id
            AND sh.invited_user_id = _user_id
            AND sh.status = 'accepted'
        )
      ));
$$;

-- 4. קריאת סניפים: גם שותפים מאושרים רואים את הסניף ברשימה
DROP POLICY IF EXISTS "stores select" ON public.stores;
CREATE POLICY "stores select" ON public.stores
FOR SELECT TO authenticated
USING (public.owns_store(id, auth.uid()));
