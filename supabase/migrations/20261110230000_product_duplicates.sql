-- ============================================================
-- מוצרים כפולים בחנות (Ecommerce): זיהוי, "לא כפול", מיזוג — והצעות AI לחנויות עם NURIEL AI
--
-- 1. product_duplicate_groups() — קבוצות של מוצרים שנראים כפולים בחנות. שלושה סימנים: אותו שם (lower,
--    trim ורווחים מכווצים — אותו נרמול כמו import_products), אותו ברקוד (בפועל ייחודי לחנות — סימן
--    שמור לעתיד), ואותה תמונה (תמונה שיובאה נשמרת לפי התוכן שלה: אותה תמונה = אותו קובץ). קבוצה של
--    יותר מ-20 מוצרים לא מוצגת (למשל תמונת "אין תמונה" משותפת), וגם לא קבוצה שכל המוצרים שבה סומנו
--    יחד "לא כפול". לכל מוצר: הפרטים לתצוגה, כמה הזמנות / ביקורות, ולמה אי אפשר למחוק אותו (רק להסתיר).
-- 2. product_duplicate_cards(ids) — אותם פרטים למוצרים שנבחרו (להצעות ה-AI).
-- 3. product_duplicate_dismiss(ids) / product_duplicate_dismissals_clear() — "לא כפול" ו"להציג הכול שוב".
-- 4. product_merge(...) — מיזוג אטומי (הכול או כלום), עד 20 מוצרים:
--    • המוצר שנשאר מקבל כמות לפי הבחירה: להשאיר / מאחד המוצרים / סכום / מספר. הטריגרים הרגילים של
--      המלאי פועלים כמו בעריכה ידנית ("אזל" אוטומטי, ההתראה, המיקומים במחסן). למוצר עם מספרים סידוריים
--      אי אפשר להעלות כמות כאן (מוסיפים ב"קליטת סחורה").
--    • מה עובר למוצר שנשאר: ביקורות (אחת לכל לקוח — ביקורת של לקוח שכבר כתב על המוצר שנשאר נשארת
--      במקומה), מוצרים קשורים (עד 12, בלי כפילות ובלי קשר של מוצר לעצמו), מחירים מיוחדים ללקוחות (אחד
--      לכל לקוח) ומבצעי "מתנה בעגלה" שנותנים את המוצר (אחרת המחיקה הייתה מוחקת את המבצע).
--    • מה לא עובר: הזמנות (היסטוריה — לא משתנה), קטגוריות (המוצר שנשאר שומר על שלו), וריאציות, מספרים
--      סידוריים, ספירות מלאי והעברות בין מיקומים.
--    • כל מוצר אחר נמחק — אלא אם יש לו הזמנות, וריאציות, מספרים סידוריים, ספירות מלאי או העברות
--      (היסטוריה שאסור לאבד), או שהמנהל ביקש להסתיר אותו: אז הוא מוסתר והכמות שלו מתאפסת (בלי התראת
--      "אזל"; מוצר עם מספרים סידוריים / וריאציות שומר על הכמות שלו).
--    • product_merges — יומן מלא לשחזור על ידי התמיכה: צילום של המוצר שנשאר לפני המיזוג, של כל מוצר
--      שנמחק (השורה וכל השורות שתלויות בו, חוץ מביקורות) ושל כל מוצר שהוסתר, הכמות לפני ואחרי, מה עבר,
--      מי ומתי. ביקורות לא נשמרות ביומן (מידע של לקוחות): ביקורת שלא עברה נמחקת עם המוצר.
--    • עגלות שמורות (JSON) לא משתנות — כמו אחרי מחיקה רגילה של מוצר.
-- 5. product_duplicate_ai_candidates(tenant, category, limit) — לשרת האפליקציה בלבד (service_role):
--    המוצרים להצעות ה-AI (מזהה, שם, מק"ט, מחיר, קטגוריה — בלי שום מידע על לקוחות) והקבוצות שסומנו
--    "לא כפול". ה-AI רק מציע; הוא לא ממזג ולא משנה כלום.
-- שתי הטבלאות סגורות לדפדפן (רק דרך הפונקציות), עם RLS ובידוד חנויות. כמו טבלאות הרישיונות, הן לא
-- ברשימת 40 הטבלאות של הגנת מנוע ה-Ecommerce: רק הפונקציות כותבות אליהן, ורק למוצרים של החנות.
--
-- Rollback: supabase/rollbacks/20261110230000_product_duplicates.down.sql (נעצר כשיש מיזוגים ביומן).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 0. הנרמול של השם — כמו import_products
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_name_key(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(btrim(regexp_replace(COALESCE(_name, ''), '\s+', ' ', 'g')));
$$;

-- ------------------------------------------------------------
-- 1. הטבלאות
-- ------------------------------------------------------------
-- "לא כפול": קבוצת מוצרים (ממוינת) שהמנהל בדק ואמר שאינם אותו מוצר
CREATE TABLE IF NOT EXISTS public.product_duplicate_dismissals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_ids uuid[] NOT NULL CHECK (cardinality(product_ids) BETWEEN 2 AND 50),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_duplicate_dismissals_set_key UNIQUE (tenant_id, product_ids)
);
CREATE INDEX IF NOT EXISTS product_duplicate_dismissals_tenant_idx
  ON public.product_duplicate_dismissals (tenant_id);

-- יומן המיזוגים — לשחזור על ידי התמיכה (בלי FK למוצר שנשאר: היומן נשאר גם אם יימחק אחר כך)
CREATE TABLE IF NOT EXISTS public.product_merges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kept_product_id uuid NOT NULL,
  kept_name       text NOT NULL,
  stock_mode      text NOT NULL CHECK (stock_mode IN ('keep', 'from', 'sum', 'custom')),
  stock_before    integer,
  stock_after     integer,
  kept_before     jsonb NOT NULL,
  products        jsonb NOT NULL DEFAULT '[]'::jsonb,
  moved           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_merges_tenant_idx ON public.product_merges (tenant_id, created_at DESC);

ALTER TABLE public.product_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_merges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_duplicate_dismissals;
CREATE POLICY tenant_isolation ON public.product_duplicate_dismissals
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation ON public.product_merges;
CREATE POLICY tenant_isolation ON public.product_merges
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- הדפדפן — רק דרך הפונקציות
REVOKE ALL ON public.product_duplicate_dismissals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.product_merges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_duplicate_dismissals TO service_role;
GRANT ALL ON public.product_merges TO service_role;

-- ------------------------------------------------------------
-- 2. עזרים פנימיים (בלי הרשאה לדפדפן)
-- ------------------------------------------------------------
-- למה אסור למחוק את המוצר (רק להסתיר): היסטוריה שתלויה בו
CREATE OR REPLACE FUNCTION public._product_keep_reasons(_product uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN EXISTS (SELECT 1 FROM public.order_items x WHERE x.product_id = _product) THEN 'orders' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.product_variants x WHERE x.product_id = _product) THEN 'variants' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.product_serials x WHERE x.product_id = _product) THEN 'serials' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.stock_count_lines x WHERE x.product_id = _product) THEN 'stock_counts' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.location_transfer_lines x WHERE x.product_id = _product) THEN 'transfers' END
  ], NULL);
$$;

-- הכרטיס של כל מוצר (לתצוגה), לפי סדר ההוספה לחנות — רק מוצרים של החנות שהועברה
CREATE OR REPLACE FUNCTION public._product_duplicate_cards(_tenant uuid, _ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', g.id,
           'name', g.name,
           'sku', g.sku,
           'barcode', g.barcode,
           'price', g.price_tier1,
           'sale_price', g.sale_price,
           'stock', g.stock_quantity,
           'hidden', g.is_hidden,
           'out_of_stock', g.is_out_of_stock,
           'image_url', NULLIF(btrim(g.image_url), ''),
           'category', g.category,
           'created_at', g.created_at,
           'requires_serial', g.requires_serial,
           'orders', (SELECT count(*) FROM public.order_items oi WHERE oi.product_id = g.id),
           'reviews', (SELECT count(*) FROM public.product_reviews r
                        WHERE r.tenant_id = g.tenant_id AND r.product_id = g.id),
           'keep_reasons', to_jsonb(public._product_keep_reasons(g.id)))
         ORDER BY g.created_at, g.id), '[]'::jsonb)
    FROM public.global_products g
   WHERE g.tenant_id = _tenant AND g.id = ANY (COALESCE(_ids, '{}'::uuid[]));
$$;

-- ------------------------------------------------------------
-- 3. הקבוצות
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_duplicate_groups()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _groups jsonb;
  _total integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לראות מוצרים כפולים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;

  WITH keys AS (
    SELECT 'name'::text AS kind, public.product_name_key(g.name) AS k, g.id, g.created_at
      FROM public.global_products g
     WHERE g.tenant_id = _tenant
    UNION ALL
    SELECT 'barcode', btrim(g.barcode), g.id, g.created_at
      FROM public.global_products g
     WHERE g.tenant_id = _tenant AND NULLIF(btrim(g.barcode), '') IS NOT NULL
    UNION ALL
    SELECT 'image', btrim(g.image_url), g.id, g.created_at
      FROM public.global_products g
     WHERE g.tenant_id = _tenant AND NULLIF(btrim(g.image_url), '') IS NOT NULL
  ),
  raw AS (
    SELECT kind, array_agg(id ORDER BY id) AS ids, max(created_at) AS newest
      FROM keys
     WHERE k <> ''
     GROUP BY kind, k
    HAVING count(*) BETWEEN 2 AND 20
  ),
  -- אותה קבוצת מוצרים שנמצאה בכמה סימנים → קבוצה אחת עם כל הסימנים
  grouped AS (
    SELECT ids, array_agg(DISTINCT kind ORDER BY kind) AS reasons, max(newest) AS newest
      FROM raw
     GROUP BY ids
  ),
  shown AS (
    SELECT gr.*,
           CASE WHEN 'name' = ANY (gr.reasons) AND 'image' = ANY (gr.reasons) THEN 0
                WHEN 'barcode' = ANY (gr.reasons) THEN 1
                WHEN 'name' = ANY (gr.reasons) THEN 2
                ELSE 3 END AS strength
      FROM grouped gr
     WHERE NOT EXISTS (SELECT 1 FROM public.product_duplicate_dismissals d
                        WHERE d.tenant_id = _tenant AND gr.ids <@ d.product_ids)
  ),
  ranked AS (
    SELECT s.*, row_number() OVER (ORDER BY s.strength, s.newest DESC, s.ids) AS rn FROM shown s
  )
  SELECT count(*)::integer,
         COALESCE(jsonb_agg(jsonb_build_object(
                    'key', md5(array_to_string(r.ids, ',')),
                    'reasons', to_jsonb(r.reasons),
                    'products', public._product_duplicate_cards(_tenant, r.ids))
                  ORDER BY r.rn) FILTER (WHERE r.rn <= 200), '[]'::jsonb)
    INTO _total, _groups
    FROM ranked r;

  RETURN jsonb_build_object('groups', _groups, 'total', _total, 'truncated', _total > 200);
END $$;

CREATE OR REPLACE FUNCTION public.product_duplicate_cards(_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לראות מוצרים כפולים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF _ids IS NULL OR cardinality(_ids) > 200 THEN
    RAISE EXCEPTION 'עד 200 מוצרים בכל בקשה' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN public._product_duplicate_cards(_tenant, _ids);
END $$;

-- ------------------------------------------------------------
-- 4. "לא כפול"
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_duplicate_dismiss(_product_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _ids uuid[];
  _found integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לסמן מוצרים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO _ids
    FROM unnest(COALESCE(_product_ids, '{}'::uuid[])) AS x
   WHERE x IS NOT NULL;
  IF _ids IS NULL OR cardinality(_ids) < 2 OR cardinality(_ids) > 50 THEN
    RAISE EXCEPTION 'בחרו בין 2 ל-50 מוצרים' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT count(*) INTO _found FROM public.global_products g WHERE g.tenant_id = _tenant AND g.id = ANY (_ids);
  IF _found <> cardinality(_ids) THEN
    RAISE EXCEPTION 'חלק מהמוצרים לא נמצאו בחנות' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO public.product_duplicate_dismissals (tenant_id, product_ids, created_by)
  VALUES (_tenant, _ids, auth.uid())
  ON CONFLICT ON CONSTRAINT product_duplicate_dismissals_set_key DO NOTHING;
  RETURN jsonb_build_object('dismissed', cardinality(_ids));
END $$;

CREATE OR REPLACE FUNCTION public.product_duplicate_dismissals_clear()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לשנות את הסימונים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  DELETE FROM public.product_duplicate_dismissals d WHERE d.tenant_id = _tenant;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('cleared', _n);
END $$;

-- ------------------------------------------------------------
-- 5. המיזוג
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_merge(
  _keep uuid,
  _others uuid[],
  _stock_mode text,
  _stock_from uuid DEFAULT NULL,
  _stock integer DEFAULT NULL,
  _hide uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _ids uuid[];
  _all uuid[];
  _kept public.global_products;
  _kept_before jsonb;
  _stock_before integer;
  _stock_after integer;
  _o public.global_products;
  _reasons text[];
  _action text;
  _products jsonb := '[]'::jsonb;
  _children jsonb;
  _c jsonb;
  _r record;
  _deleted uuid[] := '{}';
  _hidden uuid[] := '{}';
  _moved_reviews jsonb;
  _old_relations jsonb;
  _relations_in integer := 0;
  _relations_out integer := 0;
  _capacity integer;
  _moved_prices jsonb;
  _moved_gifts jsonb;
  _reviews_left integer;
  _stock_internal text;
  _merge_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול למזג מוצרים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF _keep IS NULL THEN
    RAISE EXCEPTION 'בחרו איזה מוצר להשאיר' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO _ids
    FROM unnest(COALESCE(_others, '{}'::uuid[])) AS x
   WHERE x IS NOT NULL AND x <> _keep;
  IF _ids IS NULL THEN
    RAISE EXCEPTION 'בחרו לפחות מוצר אחד נוסף למיזוג' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF cardinality(_ids) > 19 THEN
    RAISE EXCEPTION 'אפשר למזג עד 20 מוצרים בפעם אחת' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _stock_mode IS NULL OR _stock_mode NOT IN ('keep', 'from', 'sum', 'custom') THEN
    RAISE EXCEPTION 'בחירת הכמות לא תקינה' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  _all := _keep || _ids;

  -- נעילה בסדר קבוע — שני מיזוגים במקביל לא נתקעים זה בזה, ואף אחד לא משנה את המוצרים באמצע
  PERFORM 1 FROM public.global_products g
    WHERE g.tenant_id = _tenant AND g.id = ANY (_all)
    ORDER BY g.id
    FOR UPDATE;
  IF (SELECT count(*) FROM public.global_products g WHERE g.tenant_id = _tenant AND g.id = ANY (_all))
     <> cardinality(_all) THEN
    RAISE EXCEPTION 'חלק מהמוצרים לא נמצאו בחנות (אולי כבר נמחקו או מוזגו) — רעננו את הרשימה'
      USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO _kept FROM public.global_products g WHERE g.tenant_id = _tenant AND g.id = _keep;
  _kept_before := to_jsonb(_kept);
  _stock_before := COALESCE(_kept.stock_quantity, 0);

  -- הכמות של המוצר שנשאר
  IF _stock_mode = 'keep' THEN
    _stock_after := _stock_before;
  ELSIF _stock_mode = 'from' THEN
    IF _stock_from IS NULL OR NOT (_stock_from = ANY (_all)) THEN
      RAISE EXCEPTION 'בחרו מאיזה מוצר לקחת את הכמות' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    SELECT COALESCE(g.stock_quantity, 0) INTO _stock_after FROM public.global_products g WHERE g.id = _stock_from;
  ELSIF _stock_mode = 'sum' THEN
    SELECT COALESCE(sum(GREATEST(COALESCE(g.stock_quantity, 0), 0)), 0) INTO _stock_after
      FROM public.global_products g
     WHERE g.tenant_id = _tenant AND g.id = ANY (_all);
  ELSE
    IF _stock IS NULL OR _stock < 0 OR _stock > 9999999 THEN
      RAISE EXCEPTION 'כמות לא תקינה — מספר שלם בין 0 ל-9,999,999' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    _stock_after := _stock;
  END IF;
  IF _stock_after < 0 THEN
    _stock_after := 0;
  END IF;
  IF _stock_after > 9999999 THEN
    RAISE EXCEPTION 'הכמות המחוברת גדולה מדי' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _kept.requires_serial AND _stock_after > _stock_before THEN
    RAISE EXCEPTION 'למוצר "%" יש מספר סידורי לכל יחידה, ולכן אי אפשר להוסיף לו כמות במיזוג (מוסיפים ב"קליטת סחורה"). בחרו "להשאיר את הכמות".',
      _kept.name USING ERRCODE = 'check_violation';
  END IF;

  -- צילום לפני השינוי: לכל מוצר אחר — מה יקרה לו ולמה, השורה עצמה, ולמוצר שיימחק גם השורות שתלויות בו
  -- (כל טבלה עם מפתח זר למוצרים — גם טבלאות שיתווספו בעתיד; חוץ מביקורות, שהן מידע של לקוחות)
  FOR _o IN SELECT * FROM public.global_products g
             WHERE g.tenant_id = _tenant AND g.id = ANY (_ids)
             ORDER BY g.created_at, g.id LOOP
    _reasons := public._product_keep_reasons(_o.id);
    IF cardinality(_reasons) > 0 THEN
      _action := 'hidden';
    ELSIF _o.id = ANY (COALESCE(_hide, '{}'::uuid[])) THEN
      _action := 'hidden';
      _reasons := ARRAY['requested'];
    ELSE
      _action := 'deleted';
    END IF;
    _children := '{}'::jsonb;
    IF _action = 'deleted' THEN
      FOR _r IN
        SELECT DISTINCT c.conrelid::regclass::text AS tbl, sa.attname::text AS col
          FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(src, dst)
          JOIN pg_attribute sa ON sa.attrelid = c.conrelid AND sa.attnum = k.src
          JOIN pg_attribute da ON da.attrelid = c.confrelid AND da.attnum = k.dst
         WHERE c.confrelid = 'public.global_products'::regclass AND c.contype = 'f' AND da.attname = 'id'
           AND c.conrelid <> 'public.product_reviews'::regclass
         ORDER BY 1, 2
      LOOP
        EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %s t WHERE t.%I = $1',
                       _r.tbl, _r.col)
          INTO _c USING _o.id;
        IF _c <> '[]'::jsonb THEN
          _children := _children || jsonb_build_object(_r.tbl || '.' || _r.col, _c);
        END IF;
      END LOOP;
      _deleted := _deleted || _o.id;
    ELSE
      _hidden := _hidden || _o.id;
    END IF;
    _products := _products || jsonb_build_array(jsonb_build_object(
      'id', _o.id, 'name', _o.name, 'sku', _o.sku, 'action', _action, 'reasons', to_jsonb(_reasons),
      'stock', _o.stock_quantity, 'row', to_jsonb(_o), 'children', _children));
  END LOOP;

  -- א. ביקורות → המוצר שנשאר (אחת לכל לקוח; לקוח שכבר כתב על המוצר שנשאר — הביקורת נשארת במקומה)
  WITH cand AS (
    SELECT r.id, r.product_id AS from_id, r.user_id,
           row_number() OVER (PARTITION BY r.user_id ORDER BY r.created_at DESC, r.id) AS rn
      FROM public.product_reviews r
     WHERE r.tenant_id = _tenant AND r.product_id = ANY (_ids)
       AND (r.user_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.product_reviews k
              WHERE k.tenant_id = _tenant AND k.product_id = _keep AND k.user_id = r.user_id))
  ),
  pick AS (
    SELECT c.id, c.from_id FROM cand c WHERE c.user_id IS NULL OR c.rn = 1
  ),
  upd AS (
    UPDATE public.product_reviews r SET product_id = _keep
      FROM pick p
     WHERE r.id = p.id
    RETURNING r.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'from', p.from_id)), '[]'::jsonb)
    INTO _moved_reviews
    FROM pick p
   WHERE p.id IN (SELECT u.id FROM upd u);
  SELECT count(*) INTO _reviews_left
    FROM public.product_reviews r
   WHERE r.tenant_id = _tenant AND r.product_id = ANY (_ids);

  -- ב. מוצרים קשורים: (מוצר X → כפול) הופך ל-(X → נשאר); (כפול → Y) הופך ל-(נשאר → Y), עד 12
  SELECT COALESCE(jsonb_agg(to_jsonb(pr) ORDER BY pr.product_id, pr.sort_order, pr.related_product_id), '[]'::jsonb)
    INTO _old_relations
    FROM public.product_relations pr
   WHERE pr.tenant_id = _tenant AND (pr.product_id = ANY (_ids) OR pr.related_product_id = ANY (_ids));
  DELETE FROM public.product_relations pr
   WHERE pr.tenant_id = _tenant AND (pr.product_id = ANY (_ids) OR pr.related_product_id = ANY (_ids));
  INSERT INTO public.product_relations (tenant_id, product_id, related_product_id, sort_order)
  SELECT DISTINCT ON (x.product_id) _tenant, x.product_id, _keep, x.sort_order
    FROM jsonb_to_recordset(_old_relations) AS x(product_id uuid, related_product_id uuid, sort_order integer)
   WHERE x.related_product_id = ANY (_ids)
     AND NOT (x.product_id = ANY (_all))
     AND NOT EXISTS (SELECT 1 FROM public.product_relations e
                      WHERE e.tenant_id = _tenant AND e.product_id = x.product_id AND e.related_product_id = _keep)
   ORDER BY x.product_id, x.sort_order;
  GET DIAGNOSTICS _relations_in = ROW_COUNT;
  SELECT 12 - count(*) INTO _capacity
    FROM public.product_relations e
   WHERE e.tenant_id = _tenant AND e.product_id = _keep;
  INSERT INTO public.product_relations (tenant_id, product_id, related_product_id, sort_order)
  SELECT _tenant, _keep, y.related_product_id, y.sort_order
    FROM (SELECT DISTINCT ON (x.related_product_id) x.related_product_id, x.sort_order
            FROM jsonb_to_recordset(_old_relations) AS x(product_id uuid, related_product_id uuid, sort_order integer)
           WHERE x.product_id = ANY (_ids)
             AND NOT (x.related_product_id = ANY (_all))
             AND NOT EXISTS (SELECT 1 FROM public.product_relations e
                              WHERE e.tenant_id = _tenant AND e.product_id = _keep
                                AND e.related_product_id = x.related_product_id)
           ORDER BY x.related_product_id, x.sort_order) y
   ORDER BY y.sort_order, y.related_product_id
   LIMIT GREATEST(_capacity, 0);
  GET DIAGNOSTICS _relations_out = ROW_COUNT;

  -- ג. מחירים מיוחדים ללקוחות → המוצר שנשאר (אחד לכל לקוח, שאין לו כבר מחיר למוצר שנשאר)
  WITH cand AS (
    SELECT u.user_id, u.product_id,
           row_number() OVER (PARTITION BY u.user_id ORDER BY u.updated_at DESC NULLS LAST, u.product_id) AS rn
      FROM public.user_custom_prices u
     WHERE u.tenant_id = _tenant AND u.product_id = ANY (_ids)
       AND NOT EXISTS (SELECT 1 FROM public.user_custom_prices k
                        WHERE k.user_id = u.user_id AND k.product_id = _keep)
  ),
  pick AS (
    SELECT c.user_id, c.product_id FROM cand c WHERE c.rn = 1
  ),
  upd AS (
    UPDATE public.user_custom_prices u SET product_id = _keep
      FROM pick p
     WHERE u.user_id = p.user_id AND u.product_id = p.product_id
    RETURNING u.user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'from', p.product_id)), '[]'::jsonb)
    INTO _moved_prices
    FROM pick p
   WHERE p.user_id IN (SELECT u.user_id FROM upd u);

  -- ד. מבצעי "מתנה בעגלה" שנותנים את אחד המוצרים → המוצר שנשאר
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', cp.id, 'from', cp.gift_product_id)), '[]'::jsonb)
    INTO _moved_gifts
    FROM public.cart_promotions cp
   WHERE cp.tenant_id = _tenant AND cp.gift_product_id = ANY (_ids);
  UPDATE public.cart_promotions cp SET gift_product_id = _keep
   WHERE cp.tenant_id = _tenant AND cp.gift_product_id = ANY (_ids);

  -- ה. הכמות של המוצר שנשאר — דרך הטריגרים הרגילים של המלאי
  IF _stock_after IS DISTINCT FROM _stock_before THEN
    UPDATE public.global_products g SET stock_quantity = _stock_after
     WHERE g.tenant_id = _tenant AND g.id = _keep;
  END IF;

  -- ו. המוצרים שמוסתרים: הסתרה וכמות 0 (בלי התראת "אזל" — הם יוצאים מהקטלוג, לא אזלו); מוצר עם מספרים
  --    סידוריים או וריאציות שומר על הכמות שלו (היא תלויה ביחידות / בווריאציות עצמן)
  IF cardinality(_hidden) > 0 THEN
    _stock_internal := current_setting('kobi.stock_internal', true);
    PERFORM set_config('kobi.stock_internal', 'on', true);
    UPDATE public.global_products g
       SET is_hidden = true,
           stock_quantity = CASE
             WHEN g.requires_serial OR EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = g.id)
               THEN g.stock_quantity
             ELSE 0 END
     WHERE g.tenant_id = _tenant AND g.id = ANY (_hidden);
    PERFORM set_config('kobi.stock_internal', COALESCE(_stock_internal, 'off'), true);
  END IF;

  -- ז. מחיקת שאר המוצרים (מה שתלוי בהם נמחק איתם — והצילום שלו ביומן)
  IF cardinality(_deleted) > 0 THEN
    DELETE FROM public.global_products g WHERE g.tenant_id = _tenant AND g.id = ANY (_deleted);
  END IF;

  INSERT INTO public.product_merges (tenant_id, kept_product_id, kept_name, stock_mode, stock_before,
                                     stock_after, kept_before, products, moved, created_by)
  VALUES (_tenant, _keep, _kept.name, _stock_mode, _stock_before, _stock_after, _kept_before, _products,
          jsonb_build_object('reviews', _moved_reviews,
                             'relations_before', _old_relations,
                             'relations_added', _relations_in + _relations_out,
                             'custom_prices', _moved_prices,
                             'gift_promotions', _moved_gifts),
          auth.uid())
  RETURNING id INTO _merge_id;

  RETURN jsonb_build_object(
    'merge_id', _merge_id,
    'kept', jsonb_build_object('id', _keep, 'name', _kept.name,
                               'stock_before', _stock_before, 'stock_after', _stock_after),
    'deleted', cardinality(_deleted),
    'hidden', cardinality(_hidden),
    'moved', jsonb_build_object('reviews', jsonb_array_length(_moved_reviews),
                                'relations', _relations_in + _relations_out,
                                'custom_prices', jsonb_array_length(_moved_prices),
                                'gift_promotions', jsonb_array_length(_moved_gifts)),
    'reviews_left', _reviews_left,
    'products', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p ->> 'id', 'name', p ->> 'name',
                                                              'action', p ->> 'action', 'reasons', p -> 'reasons')),
                                 '[]'::jsonb)
                   FROM jsonb_array_elements(_products) AS p));
END $$;

-- ------------------------------------------------------------
-- 6. להצעות ה-AI — לשרת בלבד: המוצרים (בלי מידע על לקוחות) והקבוצות שסומנו "לא כפול"
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_duplicate_ai_candidates(_tenant uuid, _category text DEFAULT NULL,
                                                                  _limit integer DEFAULT 300)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH scope AS (
    SELECT g.id, g.name, g.sku, g.price_tier1, g.category, g.created_at
      FROM public.global_products g
     WHERE g.tenant_id = _tenant
       AND (NULLIF(btrim(COALESCE(_category, '')), '') IS NULL OR g.category = btrim(_category))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM scope),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'sku', x.sku,
                                          'price', x.price_tier1, 'category', x.category)
                       ORDER BY x.created_at DESC, x.id)
        FROM (SELECT * FROM scope s ORDER BY s.created_at DESC, s.id
               LIMIT LEAST(GREATEST(COALESCE(_limit, 300), 1), 300)) x), '[]'::jsonb),
    'dismissed', COALESCE((
      SELECT jsonb_agg(to_jsonb(d.product_ids))
        FROM public.product_duplicate_dismissals d
       WHERE d.tenant_id = _tenant), '[]'::jsonb));
$$;

-- ------------------------------------------------------------
-- 7. הרשאות
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.product_name_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_keep_reasons(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_duplicate_cards(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_duplicate_groups() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_duplicate_cards(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_duplicate_dismiss(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_duplicate_dismissals_clear() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_merge(uuid, uuid[], text, uuid, integer, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_duplicate_ai_candidates(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_name_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.product_duplicate_groups() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_duplicate_cards(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_duplicate_dismiss(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_duplicate_dismissals_clear() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_merge(uuid, uuid[], text, uuid, integer, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_duplicate_ai_candidates(uuid, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
