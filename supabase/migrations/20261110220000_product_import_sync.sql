-- ============================================================
-- STORE-2 — ייבוא מוצרים שמזהה את המוצרים שכבר בחנות: בלי כפולים, עדכון כמויות (גם 0) ומחירים לפי
-- בחירה של המנהל, דוח שינויים וביטול יבוא. (מיגרציה 64)
--
-- למה: import_products (חלק 18) מדלג רק על שורה עם ברקוד קיים או עם מק"ט של 8 ספרות שכבר קיים.
-- מק"ט אחר (של הספק) מוחלף במק"ט פנימי חדש והמוצר נוסף שוב; אין התאמה לפי שם ואין עדכון של מוצר
-- קיים — ולכן ייבוא חוזר של אותו קובץ הכפיל את הקטלוג.
--
-- מה נוסף (הכול חדש; import_products לא השתנה — סריקת אתר מקור (חלק 44) ממשיכה להשתמש בה, וגם
-- היצירה כאן עוברת דרכה: אותן בדיקות, תמונות, קטגוריות ומגבלת חבילה):
--   • product_supplier_keys — המק"ט מהקובץ (של הספק), כשהוא לא המק"ט הפנימי. הייבוא הבא מזהה את
--     המוצר לפיו. מפתח אחד = מוצר אחד בחנות.
--   • product_imports / product_import_changes — כל יבוא, והשינוי בכל מוצר (לפני / אחרי) — לדוח
--     השינויים ולביטול. היסטוריה בלבד: נשמרת גם אחרי שמוצר נמחק.
--   • product_import_match(_rows) — קריאה בלבד: לכל שורה — חדש / קיים (ברקוד → מק"ט → מק"ט ספק →
--     שם) / לא חד-משמעי (כמה מוצרים מתאימים) / לא תקין.
--   • product_import_missing_count — כמה מוצרים בחנות לא בקובץ (לאזהרה לפני איפוס / הסתרה).
--   • product_import_begin → product_import_apply (מנות) → product_import_finish — הייבוא לפי הבחירה:
--     מוצרים קיימים — עדכון מלאי / מלאי ומחיר / בלי שינוי; חדשים — להוסיף או לא; מוצרים שלא בקובץ —
--     להשאיר / לאפס מלאי / להסתיר. השרת בודק שוב כל החלטה: אף פעם לא נוצר מוצר שכבר קיים.
--   • product_import_report / product_imports_recent / product_import_undo.
--
-- מלאי: אותם כללים כמו באישור ספירת מלאי (apply_stock_count) — פחות ממארז אחד = "אזל" (אוטומטי),
-- חזרה למלאי מסירה "אזל" אוטומטי, "אזל" שסומן ידנית נשאר. בלי התראה לכל מוצר (kobi.stock_internal).
-- מוצר עם מספרים סידוריים — המלאי לא משתנה (כמו בעריכת מוצר). מחיר — רק כשלמוצר מחיר אחיד.
--
-- גישה: הטבלאות — בלי הרשאות ל-anon / authenticated (רק דרך הפונקציות, service_role לשרת); הפונקציות —
-- SECURITY DEFINER, רק מנהל החנות הנוכחית (is_admin בתוך current_tenant_id), ובכל שאילתה tenant_id של
-- החנות. אידמפוטנטי. Rollback: supabase/rollbacks/20261110220000_product_import_sync.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. הטבלאות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_supplier_keys (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  -- המפתח להשוואה: אותיות קטנות, בלי רווחים
  sku_norm   text NOT NULL CHECK (char_length(sku_norm) BETWEEN 1 AND 100),
  -- כפי שהופיע בקובץ (לתצוגה)
  sku_raw    text NOT NULL CHECK (char_length(sku_raw) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sku_norm),
  CONSTRAINT product_supplier_keys_product_fk
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.global_products (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS product_supplier_keys_product_idx ON public.product_supplier_keys (product_id);
COMMENT ON TABLE public.product_supplier_keys IS
  'STORE-2: המק"ט של הספק מקובץ הייבוא (כשהוא לא המק"ט הפנימי) — כדי שהייבוא הבא יזהה את המוצר';

CREATE TABLE IF NOT EXISTS public.product_imports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name      text NOT NULL DEFAULT '' CHECK (char_length(file_name) <= 200),
  -- {existing: stock | stock_price | none, create_new: bool, missing: keep | zero | hide}
  options        jsonb NOT NULL,
  -- כמה שורות מוצרים בקובץ (finish מוודא שכולן טופלו לפני שינוי מוצרים שלא בקובץ)
  expected_rows  integer NOT NULL CHECK (expected_rows BETWEEN 1 AND 5000),
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'undone')),
  counts         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- קטגוריות שהייבוא יצר (בביטול — נמחקות אם נשארו ריקות)
  new_categories text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  undone_at      timestamptz,
  CONSTRAINT product_imports_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT product_imports_options_check CHECK (
    jsonb_typeof(options) = 'object'
    AND options ->> 'existing' IN ('stock', 'stock_price', 'none')
    AND jsonb_typeof(options -> 'create_new') = 'boolean'
    AND options ->> 'missing' IN ('keep', 'zero', 'hide'))
);
CREATE INDEX IF NOT EXISTS product_imports_tenant_idx ON public.product_imports (tenant_id, created_at DESC);
COMMENT ON TABLE public.product_imports IS
  'STORE-2: יבוא מוצרים מקובץ — הבחירות של המנהל, הסטטוס והמונים (לדוח השינויים ולביטול)';

CREATE TABLE IF NOT EXISTS public.product_import_changes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id    uuid NOT NULL,
  tenant_id    uuid NOT NULL,
  -- בלי מפתח זר: ההיסטוריה נשארת גם כשהמוצר נמחק (בביטול או ידנית)
  product_id   uuid,
  -- שורה שדולגה בלי בחירה בין כמה מוצרים מתאימים — כולם נחשבים "בקובץ"
  candidates   uuid[] NOT NULL DEFAULT '{}',
  product_name text NOT NULL DEFAULT '' CHECK (char_length(product_name) <= 200),
  file_row     integer CHECK (file_row BETWEEN 1 AND 10000000),
  action       text NOT NULL
               CHECK (action IN ('created', 'updated', 'unchanged', 'zeroed', 'hidden', 'skipped', 'failed')),
  match_kind   text CHECK (match_kind IN ('barcode', 'sku', 'supplier_sku', 'name', 'chosen')),
  -- רק השדות שהשתנו
  before       jsonb NOT NULL DEFAULT '{}'::jsonb,
  after        jsonb NOT NULL DEFAULT '{}'::jsonb,
  message      text CHECK (char_length(message) <= 500),
  undone       text CHECK (undone IN ('restored', 'deleted', 'hidden', 'conflict', 'skipped')),
  undo_message text CHECK (char_length(undo_message) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_import_changes_import_fk
    FOREIGN KEY (tenant_id, import_id) REFERENCES public.product_imports (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS product_import_changes_import_idx
  ON public.product_import_changes (import_id, file_row, id);
CREATE INDEX IF NOT EXISTS product_import_changes_product_idx
  ON public.product_import_changes (tenant_id, product_id);
COMMENT ON TABLE public.product_import_changes IS
  'STORE-2: מה כל יבוא עשה בכל שורה / מוצר — לפני ואחרי (רק השדות שהשתנו), ומה הביטול עשה';

-- RLS: בלי מדיניות לדפדפן — גישה רק דרך הפונקציות למטה (ו-service_role לשרת)
ALTER TABLE public.product_supplier_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_import_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_supplier_keys;
CREATE POLICY tenant_isolation ON public.product_supplier_keys AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation ON public.product_imports;
CREATE POLICY tenant_isolation ON public.product_imports AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation ON public.product_import_changes;
CREATE POLICY tenant_isolation ON public.product_import_changes AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.product_supplier_keys, public.product_imports, public.product_import_changes
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_supplier_keys, public.product_imports, public.product_import_changes TO service_role;

-- ------------------------------------------------------------
-- 2. עזרים פנימיים
-- ------------------------------------------------------------
-- מפתח שם להשוואה: כמו השם שנשמר בייבוא (רווחים מכווצים, עד 200), באותיות קטנות
CREATE OR REPLACE FUNCTION public._product_import_name_key(_name text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT lower(left(btrim(regexp_replace(COALESCE(_name, ''), '\s+', ' ', 'g')), 200))
$$;

-- מפתח מק"ט להשוואה: אותיות קטנות, בלי רווחים ("ABC 12" = "abc12")
CREATE OR REPLACE FUNCTION public._product_import_sku_key(_sku text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT lower(left(regexp_replace(COALESCE(_sku, ''), '\s+', '', 'g'), 100))
$$;

-- החנות הנוכחית — רק למנהל שלה (ורק חנות מסוג ecommerce)
CREATE OR REPLACE FUNCTION public._product_import_tenant()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לייבא מוצרים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.site_type = 'ecommerce') THEN
    RAISE EXCEPTION 'ייבוא מוצרים זמין רק בחנות אונליין';
  END IF;
  RETURN _tenant;
END $$;

-- מוצרים בחנות שלא בקובץ ושהפעולה תשנה (אותה רשימה בספירה לפני הייבוא ובביצוע בסוף).
-- מוצר דיגיטלי — אף פעם; איפוס — לא מוצר עם מספרים סידוריים ולא מה שכבר 0 ו"אזל"; הסתרה — מה שמוצג.
CREATE OR REPLACE FUNCTION public._product_import_missing_ids(_tenant uuid, _present uuid[], _missing text)
RETURNS TABLE (id uuid)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT gp.id
    FROM public.global_products gp
   WHERE gp.tenant_id = _tenant
     AND NOT gp.is_digital
     AND CASE _missing
           WHEN 'zero' THEN NOT gp.requires_serial AND (gp.stock_quantity > 0 OR NOT gp.is_out_of_stock)
           WHEN 'hide' THEN NOT gp.is_hidden
           ELSE false
         END
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(_present, '{}'::uuid[])) AS p(id) WHERE p.id = gp.id)
$$;

-- כרטיס מוצר לתצוגה בבדיקת ההתאמה
CREATE OR REPLACE FUNCTION public._product_import_card(_tenant uuid, _id uuid, _tiers boolean)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'id', gp.id, 'name', gp.name, 'sku', gp.sku, 'barcode', gp.barcode,
           'stock', gp.stock_quantity, 'price', gp.price_tier1,
           'hidden', gp.is_hidden, 'out_of_stock', gp.is_out_of_stock,
           'serial', gp.requires_serial, 'digital', gp.is_digital,
           'price_editable', (NOT _tiers OR gp.uniform_price),
           'ordered', EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.product_id = gp.id))
    FROM public.global_products gp
   WHERE gp.id = _id AND gp.tenant_id = _tenant
$$;

CREATE OR REPLACE FUNCTION public._product_import_json(_imp public.product_imports)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'id', _imp.id, 'file_name', _imp.file_name, 'options', _imp.options,
           'expected_rows', _imp.expected_rows, 'status', _imp.status,
           'created_at', _imp.created_at, 'finished_at', _imp.finished_at, 'undone_at', _imp.undone_at,
           'new_categories', to_jsonb(_imp.new_categories),
           'counts', COALESCE((SELECT jsonb_object_agg(s.action, s.n)
                                 FROM (SELECT c.action, count(*) AS n
                                         FROM public.product_import_changes c
                                        WHERE c.import_id = _imp.id AND c.tenant_id = _imp.tenant_id
                                        GROUP BY c.action) s), '{}'::jsonb)
                     || jsonb_build_object('missing_applied', COALESCE((_imp.counts ->> 'missing_applied')::boolean, false)))
$$;

-- ------------------------------------------------------------
-- 3. בדיקת התאמה (קריאה בלבד)
-- ------------------------------------------------------------
-- _rows: [{row, name, price, sku, barcode, stock, ...}] כמו לייבוא. לכל שורה:
--   status: new | matched | ambiguous | invalid, kind: barcode | sku | supplier_sku | name,
--   products: המוצר (או עד 5 מועמדים), total: כמה מוצרים מתאימים, ids: עד 50 המזהים שלהם,
--   problem: למה לא תקין.
-- הסדר: ברקוד → מק"ט (גם לא 8 ספרות) → מק"ט ספק שנשמר → שם. המפתח החזק ביותר שמצא משהו קובע.
-- שם זהה עם ברקוד אחר (לשניהם יש ברקוד) — מוצר אחר, לא התאמה.
CREATE OR REPLACE FUNCTION public.product_import_match(_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public._product_import_tenant();
  _tiers boolean := public.price_tiers_enabled();
  _out jsonb;
BEGIN
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'קובץ הייבוא לא תקין';
  END IF;
  IF jsonb_array_length(_rows) > 500 THEN
    RAISE EXCEPTION 'עד 500 שורות בכל שליחה';
  END IF;

  WITH input AS (
    SELECT e.ord,
           CASE WHEN (e.r ->> 'row') ~ '^[0-9]{1,7}$' THEN (e.r ->> 'row')::integer ELSE e.ord::integer END AS file_row,
           left(btrim(regexp_replace(COALESCE(e.r ->> 'name', ''), '\s+', ' ', 'g')), 200) AS name,
           public._product_import_name_key(e.r ->> 'name') AS name_key,
           NULLIF(btrim(COALESCE(e.r ->> 'barcode', '')), '') AS barcode,
           NULLIF(public._product_import_sku_key(e.r ->> 'sku'), '') AS sku_key,
           COALESCE(e.r ->> 'price', '') AS price,
           COALESCE(e.r ->> 'stock', '') AS stock
      FROM jsonb_array_elements(_rows) WITH ORDINALITY AS e(r, ord)
  ),
  products AS MATERIALIZED (
    SELECT gp.id, gp.created_at, gp.barcode,
           NULLIF(public._product_import_sku_key(gp.sku), '') AS sku_key,
           public._product_import_name_key(gp.name) AS name_key
      FROM public.global_products gp
     WHERE gp.tenant_id = _tenant
  ),
  hits AS (
    SELECT i.ord, 1 AS rank, 'barcode'::text AS kind, p.id, p.created_at
      FROM input i JOIN products p ON p.barcode = i.barcode
    UNION ALL
    SELECT i.ord, 2, 'sku', p.id, p.created_at
      FROM input i JOIN products p ON p.sku_key = i.sku_key
    UNION ALL
    SELECT i.ord, 3, 'supplier_sku', p.id, p.created_at
      FROM input i
      JOIN public.product_supplier_keys k ON k.tenant_id = _tenant AND k.sku_norm = i.sku_key
      JOIN products p ON p.id = k.product_id
    UNION ALL
    SELECT i.ord, 4, 'name', p.id, p.created_at
      FROM input i JOIN products p ON p.name_key = i.name_key
     WHERE i.name_key <> ''
       AND NOT (p.barcode IS NOT NULL AND i.barcode IS NOT NULL AND p.barcode <> i.barcode)
  ),
  best AS (
    SELECT DISTINCT ON (h.ord) h.ord, h.rank, h.kind FROM hits h ORDER BY h.ord, h.rank
  ),
  chosen AS (
    SELECT h.ord, b.kind, array_agg(h.id ORDER BY h.created_at, h.id) AS ids
      FROM (SELECT DISTINCT ord, rank, id, created_at FROM hits) h
      JOIN best b ON b.ord = h.ord AND b.rank = h.rank
     GROUP BY h.ord, b.kind
  ),
  checked AS (
    SELECT i.*,
           CASE WHEN i.name = '' THEN 'חסר שם מוצר'
                WHEN i.price !~ '^[0-9]{1,8}(\.[0-9]{1,4})?$' THEN 'מחיר לא תקין: "' || left(i.price, 40) || '"'
                WHEN i.stock <> '' AND i.stock !~ '^[0-9]{1,7}$' THEN 'כמות מלאי לא תקינה: "' || left(i.stock, 40) || '"'
           END AS problem,
           c.kind, c.ids
      FROM input i LEFT JOIN chosen c ON c.ord = i.ord
  )
  SELECT jsonb_build_object(
           'tiers', _tiers,
           'rows', COALESCE(jsonb_agg(jsonb_build_object(
             'row', ch.file_row,
             'status', CASE WHEN ch.problem IS NOT NULL THEN 'invalid'
                            WHEN ch.ids IS NULL THEN 'new'
                            WHEN cardinality(ch.ids) = 1 THEN 'matched'
                            ELSE 'ambiguous' END,
             'kind', ch.kind,
             'problem', ch.problem,
             'total', COALESCE(cardinality(ch.ids), 0),
             'ids', COALESCE(to_jsonb(ch.ids[1:50]), '[]'::jsonb),
             'products', COALESCE((SELECT jsonb_agg(public._product_import_card(_tenant, u.id, _tiers) ORDER BY u.n)
                                     FROM unnest(ch.ids[1:5]) WITH ORDINALITY AS u(id, n)), '[]'::jsonb))
             ORDER BY ch.ord), '[]'::jsonb))
    INTO _out
    FROM checked ch;
  RETURN _out;
END $$;

-- כמה מוצרים בחנות לא בקובץ ישתנו (איפוס / הסתרה) — לאזהרה לפני הייבוא, עם עד 10 דוגמאות
CREATE OR REPLACE FUNCTION public.product_import_missing_count(_present uuid[], _missing text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public._product_import_tenant();
  _count integer;
  _sample jsonb;
BEGIN
  IF COALESCE(_missing, '') NOT IN ('zero', 'hide') THEN
    RETURN jsonb_build_object('count', 0, 'sample', '[]'::jsonb);
  END IF;
  IF cardinality(COALESCE(_present, '{}'::uuid[])) > 20000 THEN
    RAISE EXCEPTION 'יותר מדי מוצרים בבקשה אחת';
  END IF;
  SELECT count(*) INTO _count FROM public._product_import_missing_ids(_tenant, _present, _missing);
  SELECT COALESCE(jsonb_agg(s.name ORDER BY s.name), '[]'::jsonb) INTO _sample
    FROM (SELECT gp.name
            FROM public.global_products gp
            JOIN public._product_import_missing_ids(_tenant, _present, _missing) m ON m.id = gp.id
           WHERE gp.tenant_id = _tenant
           ORDER BY gp.name
           LIMIT 10) s;
  RETURN jsonb_build_object('count', _count, 'sample', _sample);
END $$;

-- ------------------------------------------------------------
-- 4. הייבוא: התחלה, מנות, סיום
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_import_begin(_file_name text, _options jsonb, _expected_rows integer)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public._product_import_tenant();
  _id uuid;
BEGIN
  IF _options IS NULL OR jsonb_typeof(_options) <> 'object'
     OR COALESCE(_options ->> 'existing', '') NOT IN ('stock', 'stock_price', 'none')
     OR jsonb_typeof(_options -> 'create_new') IS DISTINCT FROM 'boolean'
     OR COALESCE(_options ->> 'missing', '') NOT IN ('keep', 'zero', 'hide') THEN
    RAISE EXCEPTION 'בחרו מה לעשות במוצרים שכבר קיימים, במוצרים חדשים ובמוצרים שלא בקובץ';
  END IF;
  IF _expected_rows IS NULL OR _expected_rows < 1 OR _expected_rows > 5000 THEN
    RAISE EXCEPTION 'מספר המוצרים בקובץ לא תקין';
  END IF;
  INSERT INTO public.product_imports (tenant_id, created_by, file_name, options, expected_rows)
  VALUES (_tenant, auth.uid(), left(btrim(COALESCE(_file_name, '')), 200),
          jsonb_build_object('existing', _options ->> 'existing',
                             'create_new', (_options ->> 'create_new')::boolean,
                             'missing', _options ->> 'missing'),
          _expected_rows)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- מוצר חדש: אף פעם לא כשיש כבר מוצר עם אותו ברקוד / מק"ט / מק"ט ספק; שם זהה — רק כשהמנהל סימן
-- "מוצר חדש" (force_new). היצירה עצמה — import_products (אותן בדיקות, תמונות, קטגוריות, מגבלת
-- חבילה) עם מק"ט פנימי שנקבע כאן מראש, כדי לדעת איזה מוצר נוצר. מק"ט הספק נשמר כמפתח.
CREATE OR REPLACE FUNCTION public._product_import_create(_tenant uuid, _import uuid, _options jsonb, r jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row integer := CASE WHEN (r ->> 'row') ~ '^[0-9]{1,7}$' THEN (r ->> 'row')::integer END;
  _name text := left(btrim(regexp_replace(COALESCE(r ->> 'name', ''), '\s+', ' ', 'g')), 200);
  _barcode text := NULLIF(btrim(COALESCE(r ->> 'barcode', '')), '');
  _file_sku text := btrim(COALESCE(r ->> 'sku', ''));
  _sku_key text := public._product_import_sku_key(r ->> 'sku');
  _same text;
  _sku text;
  _tries integer := 0;
  _res jsonb;
  p record;
BEGIN
  IF NOT COALESCE((_options ->> 'create_new')::boolean, false) THEN
    RAISE EXCEPTION 'לא נוסף — נבחר לא להוסיף מוצרים חדשים';
  END IF;
  IF _name = '' THEN
    RAISE EXCEPTION 'חסר שם מוצר';
  END IF;
  SELECT gp.name INTO _same
    FROM public.global_products gp
   WHERE gp.tenant_id = _tenant
     AND ((_barcode IS NOT NULL AND gp.barcode = _barcode)
          OR (_sku_key <> '' AND public._product_import_sku_key(gp.sku) = _sku_key)
          OR (_sku_key <> '' AND EXISTS (SELECT 1 FROM public.product_supplier_keys k
                                          WHERE k.tenant_id = _tenant AND k.sku_norm = _sku_key
                                            AND k.product_id = gp.id)))
   LIMIT 1;
  IF _same IS NOT NULL THEN
    RAISE EXCEPTION 'לא נוסף — כבר יש בחנות מוצר עם אותו ברקוד / מק"ט ("%")', _same;
  END IF;
  IF COALESCE(r ->> 'force_new', '') <> 'true' AND EXISTS (
       SELECT 1 FROM public.global_products gp
        WHERE gp.tenant_id = _tenant
          AND public._product_import_name_key(gp.name) = public._product_import_name_key(_name)
          AND NOT (gp.barcode IS NOT NULL AND _barcode IS NOT NULL AND gp.barcode <> _barcode)) THEN
    RAISE EXCEPTION 'לא נוסף — כבר יש בחנות מוצר בשם הזה. אפשר לבחור לעדכן אותו, או לסמן שזה מוצר חדש';
  END IF;

  IF _file_sku ~ '^[0-9]{8}$' THEN
    _sku := _file_sku;
  ELSE
    LOOP
      _sku := lpad(floor(random() * 100000000)::bigint::text, 8, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.global_products gp
                             WHERE gp.tenant_id = _tenant AND gp.sku = _sku);
      _tries := _tries + 1;
      IF _tries > 20 THEN
        RAISE EXCEPTION 'לא נמצא מק"ט פנוי — נסו שוב';
      END IF;
    END LOOP;
  END IF;

  _res := public.import_products(jsonb_build_array(
            (r - 'action' - 'product_id' - 'force_new' - 'match' - 'candidates' - 'reason')
            || jsonb_build_object('sku', _sku)));
  IF COALESCE((_res ->> 'created')::integer, 0) <> 1 THEN
    RAISE EXCEPTION '%', COALESCE(_res -> 'errors' -> 0 ->> 'message', 'המוצר לא נוסף');
  END IF;

  -- כמות 0 מפורשת בקובץ = "אזל" (כמו בעדכון). תא ריק — כמו קודם (החנות אולי לא מנהלת מלאי)
  IF COALESCE(r ->> 'stock', '') ~ '^[0-9]{1,7}$' AND (r ->> 'stock')::integer = 0 THEN
    UPDATE public.global_products
       SET is_out_of_stock = true, out_of_stock_auto = true
     WHERE tenant_id = _tenant AND sku = _sku AND NOT is_out_of_stock;
  END IF;
  SELECT gp.id, gp.name, gp.sku, gp.stock_quantity, gp.price_tier1, gp.is_hidden, gp.is_out_of_stock INTO p
    FROM public.global_products gp
   WHERE gp.tenant_id = _tenant AND gp.sku = _sku;
  IF _file_sku <> '' AND _file_sku !~ '^[0-9]{8}$' AND _sku_key <> '' THEN
    INSERT INTO public.product_supplier_keys (tenant_id, product_id, sku_norm, sku_raw)
    VALUES (_tenant, p.id, _sku_key, left(_file_sku, 100))
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.product_import_changes
    (import_id, tenant_id, product_id, product_name, file_row, action, after, message)
  VALUES (_import, _tenant, p.id, p.name, _row, 'created',
          jsonb_build_object('sku', p.sku, 'stock', p.stock_quantity, 'price', p.price_tier1, 'hidden', p.is_hidden,
                             'out_of_stock', p.is_out_of_stock),
          left(_res -> 'warnings' -> 0 ->> 'message', 500));
  RETURN jsonb_build_object('action', 'created', 'product_id', p.id,
                            'warning', _res -> 'warnings' -> 0 ->> 'message',
                            'new_categories', COALESCE(_res -> 'new_categories', '[]'::jsonb));
END $$;

-- מוצר קיים: מלאי (גם 0) ומחיר לפי הבחירה. נרשם רק מה שהשתנה (לפני / אחרי).
CREATE OR REPLACE FUNCTION public._product_import_update(_tenant uuid, _import uuid, _options jsonb,
                                                         _tiers boolean, r jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row integer := CASE WHEN (r ->> 'row') ~ '^[0-9]{1,7}$' THEN (r ->> 'row')::integer END;
  _kind text := CASE WHEN r ->> 'match' IN ('barcode', 'sku', 'supplier_sku', 'name', 'chosen')
                     THEN r ->> 'match' END;
  _existing text := _options ->> 'existing';
  _file_sku text := btrim(COALESCE(r ->> 'sku', ''));
  _sku_key text := public._product_import_sku_key(r ->> 'sku');
  _pid uuid;
  p record;
  _prev integer;
  _before jsonb := '{}'::jsonb;
  _after jsonb := '{}'::jsonb;
  _notes text[] := '{}';
  _stock integer;
  _min_sell integer;
  _oos boolean;
  _auto boolean;
  _price numeric;
  _t2 numeric;
  _t3 numeric;
  _key_owner uuid;
  _action text;
BEGIN
  IF COALESCE(r ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'לא נבחר מוצר לעדכון';
  END IF;
  _pid := (r ->> 'product_id')::uuid;
  SELECT gp.id, gp.name, gp.sku, gp.stock_quantity, gp.is_out_of_stock, gp.out_of_stock_auto, gp.pack_size,
         gp.requires_serial, gp.uniform_price, gp.price_tier1, gp.price_tier2, gp.price_tier3
    INTO p
    FROM public.global_products gp
   WHERE gp.id = _pid AND gp.tenant_id = _tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המוצר לא נמצא בחנות';
  END IF;

  -- אותו מוצר פעמיים בקובץ: רק השורה הראשונה משנה אותו
  SELECT c.file_row INTO _prev
    FROM public.product_import_changes c
   WHERE c.import_id = _import AND c.tenant_id = _tenant AND c.product_id = _pid
     AND c.action IN ('created', 'updated', 'unchanged')
   ORDER BY c.id
   LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.product_import_changes
      (import_id, tenant_id, product_id, product_name, file_row, action, match_kind, message)
    VALUES (_import, _tenant, _pid, p.name, _row, 'skipped', _kind,
            'המוצר כבר עודכן' || COALESCE(' בשורה ' || _prev, '') || ' בקובץ — השורה הזו דולגה');
    RETURN jsonb_build_object('action', 'skipped', 'product_id', _pid,
                              'warning', 'המוצר כבר עודכן' || COALESCE(' בשורה ' || _prev, '') || ' בקובץ — השורה הזו דולגה');
  END IF;

  -- מלאי
  IF _existing IN ('stock', 'stock_price') THEN
    IF COALESCE(r ->> 'stock', '') = '' THEN
      _notes := _notes || 'אין כמות בקובץ — המלאי לא השתנה'::text;
    ELSIF (r ->> 'stock') !~ '^[0-9]{1,7}$' THEN
      RAISE EXCEPTION 'כמות מלאי לא תקינה: "%"', r ->> 'stock';
    ELSIF p.requires_serial THEN
      _notes := _notes || 'מוצר עם מספרים סידוריים — המלאי לא עודכן (מוסיפים מלאי ב"קליטת סחורה")'::text;
    ELSE
      _stock := (r ->> 'stock')::integer;
      _min_sell := CASE WHEN p.pack_size IS NOT NULL AND p.pack_size >= 2 THEN p.pack_size ELSE 1 END;
      _oos := p.is_out_of_stock;
      _auto := COALESCE(p.out_of_stock_auto, false);
      IF _stock < _min_sell THEN
        IF NOT p.is_out_of_stock THEN
          _oos := true;
          _auto := true;
        END IF;
      ELSIF p.is_out_of_stock AND COALESCE(p.out_of_stock_auto, false) THEN
        _oos := false;
        _auto := false;
      ELSIF p.is_out_of_stock THEN
        _notes := _notes || 'המוצר מסומן "אזל" ידנית — הסימון נשאר'::text;
      END IF;
      IF _stock IS DISTINCT FROM p.stock_quantity OR _oos IS DISTINCT FROM p.is_out_of_stock
         OR _auto IS DISTINCT FROM COALESCE(p.out_of_stock_auto, false) THEN
        UPDATE public.global_products
           SET stock_quantity = _stock, is_out_of_stock = _oos, out_of_stock_auto = _auto
         WHERE id = _pid AND tenant_id = _tenant;
        _before := _before || jsonb_build_object('stock', p.stock_quantity, 'out_of_stock', p.is_out_of_stock,
                                                 'out_of_stock_auto', COALESCE(p.out_of_stock_auto, false));
        _after := _after || jsonb_build_object('stock', _stock, 'out_of_stock', _oos, 'out_of_stock_auto', _auto);
      END IF;
    END IF;
  END IF;

  -- מחיר: רק למחיר אחיד (או כשאין דרגות מחיר בחנות — כמו בעריכת מוצר)
  IF _existing = 'stock_price' THEN
    IF COALESCE(r ->> 'price', '') !~ '^[0-9]{1,8}(\.[0-9]{1,4})?$' THEN
      RAISE EXCEPTION 'מחיר לא תקין: "%"', COALESCE(r ->> 'price', '');
    END IF;
    _price := (r ->> 'price')::numeric;
    IF _tiers AND NOT p.uniform_price THEN
      _notes := _notes || 'למוצר מחירים שונים לדרגות לקוחות — המחיר לא עודכן'::text;
    ELSE
      _t2 := CASE WHEN p.uniform_price THEN _price ELSE p.price_tier2 END;
      _t3 := CASE WHEN p.uniform_price THEN _price ELSE p.price_tier3 END;
      IF _price IS DISTINCT FROM p.price_tier1 OR _t2 IS DISTINCT FROM p.price_tier2
         OR _t3 IS DISTINCT FROM p.price_tier3 THEN
        BEGIN
          UPDATE public.global_products
             SET price_tier1 = _price, price_tier2 = _t2, price_tier3 = _t3
           WHERE id = _pid AND tenant_id = _tenant;
          _before := _before || jsonb_build_object('price', p.price_tier1, 'price_tier2', p.price_tier2,
                                                   'price_tier3', p.price_tier3);
          _after := _after || jsonb_build_object('price', _price, 'price_tier2', _t2, 'price_tier3', _t3);
        EXCEPTION WHEN OTHERS THEN
          _notes := _notes || ('המחיר לא עודכן: ' || SQLERRM);
        END;
      END IF;
    END IF;
  END IF;

  -- מק"ט הספק → מפתח לזיהוי בייבוא הבא
  IF _file_sku <> '' AND _sku_key <> '' AND _sku_key <> public._product_import_sku_key(p.sku) THEN
    SELECT k.product_id INTO _key_owner
      FROM public.product_supplier_keys k
     WHERE k.tenant_id = _tenant AND k.sku_norm = _sku_key;
    IF _key_owner IS NULL THEN
      INSERT INTO public.product_supplier_keys (tenant_id, product_id, sku_norm, sku_raw)
      VALUES (_tenant, _pid, _sku_key, left(_file_sku, 100))
      ON CONFLICT DO NOTHING;
    ELSIF _key_owner <> _pid THEN
      _notes := _notes || ('המק"ט "' || left(_file_sku, 40) || '" כבר משויך למוצר אחר בחנות');
    END IF;
  END IF;

  _action := CASE WHEN _after = '{}'::jsonb THEN 'unchanged' ELSE 'updated' END;
  INSERT INTO public.product_import_changes
    (import_id, tenant_id, product_id, product_name, file_row, action, match_kind, before, after, message)
  VALUES (_import, _tenant, _pid, p.name, _row, _action, _kind, _before, _after,
          NULLIF(left(array_to_string(_notes, ' · '), 500), ''));
  RETURN jsonb_build_object('action', _action, 'product_id', _pid,
                            'warning', NULLIF(array_to_string(_notes, ' · '), ''));
END $$;

-- שורה שלא מייבאים (בחירה / כפילות בקובץ / לא תקינה). המוצר שהתאים (או המועמדים) — נחשב "בקובץ".
CREATE OR REPLACE FUNCTION public._product_import_skip(_tenant uuid, _import uuid, r jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row integer := CASE WHEN (r ->> 'row') ~ '^[0-9]{1,7}$' THEN (r ->> 'row')::integer END;
  _name text := left(btrim(regexp_replace(COALESCE(r ->> 'name', ''), '\s+', ' ', 'g')), 200);
  _pid uuid;
  _candidates uuid[] := '{}';
BEGIN
  IF COALESCE(r ->> 'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT gp.id INTO _pid FROM public.global_products gp
     WHERE gp.id = (r ->> 'product_id')::uuid AND gp.tenant_id = _tenant;
  END IF;
  IF jsonb_typeof(r -> 'candidates') = 'array' THEN
    SELECT COALESCE(array_agg(gp.id), '{}') INTO _candidates
      FROM public.global_products gp
     WHERE gp.tenant_id = _tenant
       AND gp.id IN (SELECT v.value::uuid
                       FROM jsonb_array_elements_text(r -> 'candidates') AS v(value)
                      WHERE v.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      LIMIT 20);
  END IF;
  INSERT INTO public.product_import_changes
    (import_id, tenant_id, product_id, candidates, product_name, file_row, action, message)
  VALUES (_import, _tenant, _pid, _candidates, _name, _row, 'skipped',
          NULLIF(left(btrim(COALESCE(r ->> 'reason', '')), 300), ''));
  RETURN jsonb_build_object('action', 'skipped', 'product_id', _pid);
END $$;

-- מנה של שורות עם ההחלטה לכל שורה: action create | update | skip (+ product_id, force_new, match,
-- candidates, reason). שורה שנכשלת נרשמת ולא עוצרת את האחרות.
CREATE OR REPLACE FUNCTION public.product_import_apply(_import uuid, _rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public._product_import_tenant();
  _imp public.product_imports%ROWTYPE;
  _tiers boolean := public.price_tiers_enabled();
  r jsonb;
  _row integer;
  _name text;
  _action text;
  _res jsonb;
  _created integer := 0;
  _updated integer := 0;
  _unchanged integer := 0;
  _skipped integer := 0;
  _failed integer := 0;
  _limit boolean := false;
  _errors jsonb := '[]'::jsonb;
  _warnings jsonb := '[]'::jsonb;
  _new_categories text[] := '{}';
  _cat text;
BEGIN
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'קובץ הייבוא לא תקין';
  END IF;
  IF jsonb_array_length(_rows) > 500 THEN
    RAISE EXCEPTION 'עד 500 שורות בכל שליחה';
  END IF;
  SELECT * INTO _imp FROM public.product_imports
   WHERE id = _import AND tenant_id = _tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'היבוא לא נמצא';
  END IF;
  IF _imp.status <> 'running' THEN
    RAISE EXCEPTION 'היבוא הזה כבר הסתיים — אפשר להתחיל יבוא חדש';
  END IF;
  IF _imp.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'את היבוא הזה התחיל מנהל אחר';
  END IF;

  -- בלי "אזל" אוטומטי בטריגר ובלי התראה לכל מוצר — הסימונים נקבעים כאן (כמו באישור ספירה)
  PERFORM set_config('kobi.stock_internal', 'on', true);
  FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    _row := CASE WHEN (r ->> 'row') ~ '^[0-9]{1,7}$' THEN (r ->> 'row')::integer END;
    _name := left(btrim(regexp_replace(COALESCE(r ->> 'name', ''), '\s+', ' ', 'g')), 200);
    _action := COALESCE(r ->> 'action', '');
    BEGIN
      IF jsonb_typeof(r) <> 'object' THEN
        RAISE EXCEPTION 'שורה לא תקינה';
      ELSIF _action = 'create' THEN
        IF _limit THEN
          RAISE EXCEPTION 'לא נוסף — הגעתם למגבלת המוצרים של החבילה';
        END IF;
        _res := public._product_import_create(_tenant, _import, _imp.options, r);
      ELSIF _action = 'update' THEN
        _res := public._product_import_update(_tenant, _import, _imp.options, _tiers, r);
      ELSIF _action = 'skip' THEN
        _res := public._product_import_skip(_tenant, _import, r);
      ELSE
        RAISE EXCEPTION 'פעולה לא מוכרת בשורה';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'בחבילה הבסיסית אפשר עד%' THEN
        _limit := true;
      END IF;
      _res := jsonb_build_object('action', 'failed', 'message', SQLERRM);
      INSERT INTO public.product_import_changes (import_id, tenant_id, product_name, file_row, action, message)
      VALUES (_import, _tenant, _name, _row, 'failed', left(SQLERRM, 500));
    END;

    CASE _res ->> 'action'
      WHEN 'created' THEN _created := _created + 1;
      WHEN 'updated' THEN _updated := _updated + 1;
      WHEN 'unchanged' THEN _unchanged := _unchanged + 1;
      WHEN 'skipped' THEN _skipped := _skipped + 1;
      ELSE _failed := _failed + 1;
    END CASE;
    IF _res ->> 'action' = 'failed' THEN
      _errors := _errors || jsonb_build_object('row', _row, 'name', _name, 'message', _res ->> 'message');
    ELSIF _res ->> 'warning' IS NOT NULL THEN
      _warnings := _warnings || jsonb_build_object('row', _row, 'name', _name, 'message', _res ->> 'warning');
    END IF;
    IF jsonb_typeof(_res -> 'new_categories') = 'array' THEN
      FOR _cat IN SELECT jsonb_array_elements_text(_res -> 'new_categories') LOOP
        IF NOT _cat = ANY (_new_categories) THEN
          _new_categories := _new_categories || _cat;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  PERFORM set_config('kobi.stock_internal', 'off', true);

  IF cardinality(_new_categories) > 0 THEN
    UPDATE public.product_imports
       SET new_categories = new_categories
                            || ARRAY(SELECT c FROM unnest(_new_categories) AS c WHERE NOT c = ANY (new_categories))
     WHERE id = _import AND tenant_id = _tenant;
  END IF;
  RETURN jsonb_build_object(
    'created', _created, 'updated', _updated, 'unchanged', _unchanged, 'skipped', _skipped,
    'failed', _failed, 'limit_reached', _limit, 'new_categories', to_jsonb(_new_categories),
    'errors', _errors, 'warnings', _warnings);
END $$;

-- סיום: מוצרים שלא בקובץ (רק כשכל השורות טופלו, והמספר לא גדל מעבר למה שהמנהל ראה ואישר).
-- _confirm_missing = NULL — מסיימים בלי לשנות מוצרים שלא בקובץ (למשל אחרי עצירה באמצע).
CREATE OR REPLACE FUNCTION public.product_import_finish(_import uuid, _confirm_missing integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public._product_import_tenant();
  _imp public.product_imports%ROWTYPE;
  _missing text;
  _logged integer;
  _present uuid[];
  _count integer;
  _applied boolean := false;
  p record;
BEGIN
  SELECT * INTO _imp FROM public.product_imports
   WHERE id = _import AND tenant_id = _tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'היבוא לא נמצא';
  END IF;
  IF _imp.status <> 'running' THEN
    RAISE EXCEPTION 'היבוא הזה כבר הסתיים';
  END IF;
  IF _imp.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'את היבוא הזה התחיל מנהל אחר';
  END IF;

  _missing := _imp.options ->> 'missing';
  IF _missing IN ('zero', 'hide') AND _confirm_missing IS NOT NULL THEN
    SELECT count(*) INTO _logged
      FROM public.product_import_changes c
     WHERE c.import_id = _import AND c.tenant_id = _tenant
       AND c.action IN ('created', 'updated', 'unchanged', 'skipped', 'failed');
    IF _logged < _imp.expected_rows THEN
      RAISE EXCEPTION 'היבוא לא הושלם (% מתוך % שורות) — מוצרים שלא בקובץ לא שונו', _logged, _imp.expected_rows;
    END IF;
    SELECT COALESCE(array_agg(DISTINCT s.id), '{}') INTO _present
      FROM (SELECT c.product_id AS id
              FROM public.product_import_changes c
             WHERE c.import_id = _import AND c.tenant_id = _tenant AND c.product_id IS NOT NULL
            UNION ALL
            SELECT unnest(c.candidates)
              FROM public.product_import_changes c
             WHERE c.import_id = _import AND c.tenant_id = _tenant) s
     WHERE s.id IS NOT NULL;
    SELECT count(*) INTO _count FROM public._product_import_missing_ids(_tenant, _present, _missing);
    IF _count > _confirm_missing THEN
      RAISE EXCEPTION 'מספר המוצרים שלא בקובץ גדל מאז הבדיקה (% במקום %) — הם לא שונו', _count, _confirm_missing;
    END IF;

    PERFORM set_config('kobi.stock_internal', 'on', true);
    FOR p IN
      SELECT gp.id, gp.name, gp.stock_quantity, gp.is_out_of_stock, gp.out_of_stock_auto
        FROM public.global_products gp
       WHERE gp.tenant_id = _tenant
         AND gp.id IN (SELECT m.id FROM public._product_import_missing_ids(_tenant, _present, _missing) m)
       ORDER BY gp.name, gp.id
       FOR UPDATE
    LOOP
      IF _missing = 'zero' THEN
        UPDATE public.global_products
           SET stock_quantity = 0, is_out_of_stock = true,
               out_of_stock_auto = CASE WHEN p.is_out_of_stock THEN COALESCE(p.out_of_stock_auto, false) ELSE true END
         WHERE id = p.id AND tenant_id = _tenant;
        INSERT INTO public.product_import_changes
          (import_id, tenant_id, product_id, product_name, action, before, after)
        VALUES (_import, _tenant, p.id, p.name, 'zeroed',
                jsonb_build_object('stock', p.stock_quantity, 'out_of_stock', p.is_out_of_stock,
                                   'out_of_stock_auto', COALESCE(p.out_of_stock_auto, false)),
                jsonb_build_object('stock', 0, 'out_of_stock', true,
                                   'out_of_stock_auto', CASE WHEN p.is_out_of_stock
                                                             THEN COALESCE(p.out_of_stock_auto, false) ELSE true END));
      ELSE
        UPDATE public.global_products SET is_hidden = true WHERE id = p.id AND tenant_id = _tenant;
        INSERT INTO public.product_import_changes
          (import_id, tenant_id, product_id, product_name, action, before, after)
        VALUES (_import, _tenant, p.id, p.name, 'hidden',
                jsonb_build_object('hidden', false), jsonb_build_object('hidden', true));
      END IF;
    END LOOP;
    PERFORM set_config('kobi.stock_internal', 'off', true);
    _applied := true;
  END IF;

  UPDATE public.product_imports
     SET status = 'done', finished_at = now(),
         counts = jsonb_build_object('missing_applied', _applied)
   WHERE id = _import AND tenant_id = _tenant
  RETURNING * INTO _imp;
  UPDATE public.product_imports
     SET counts = public._product_import_json(_imp) -> 'counts'
   WHERE id = _import AND tenant_id = _tenant
  RETURNING * INTO _imp;
  RETURN public._product_import_json(_imp);
END $$;

-- ------------------------------------------------------------
-- 5. דוח, יבואים אחרונים, ביטול
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_import_report(_import uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public._product_import_tenant();
  _imp public.product_imports%ROWTYPE;
  _rows jsonb;
BEGIN
  SELECT * INTO _imp FROM public.product_imports WHERE id = _import AND tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'היבוא לא נמצא';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'row', c.file_row, 'action', c.action, 'product_id', c.product_id, 'name', c.product_name,
           'sku', gp.sku, 'match', c.match_kind, 'before', c.before, 'after', c.after,
           'message', c.message, 'undone', c.undone, 'undo_message', c.undo_message)
         ORDER BY c.file_row NULLS LAST, c.id), '[]'::jsonb)
    INTO _rows
    FROM (SELECT * FROM public.product_import_changes x
           WHERE x.import_id = _import AND x.tenant_id = _tenant
           ORDER BY x.file_row NULLS LAST, x.id
           LIMIT 20000) c
    LEFT JOIN public.global_products gp ON gp.id = c.product_id AND gp.tenant_id = _tenant;
  RETURN jsonb_build_object('import', public._product_import_json(_imp), 'rows', _rows);
END $$;

CREATE OR REPLACE FUNCTION public.product_imports_recent()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public._product_import_tenant();
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(public._product_import_json(i) ORDER BY i.created_at DESC)
                     FROM public.product_imports i
                    WHERE i.tenant_id = _tenant
                      AND i.id IN (SELECT x.id FROM public.product_imports x
                                    WHERE x.tenant_id = _tenant
                                    ORDER BY x.created_at DESC
                                    LIMIT 10)), '[]'::jsonb);
END $$;

-- ביטול: מה שנוסף — נמחק (מוצר שכבר הוזמן — מוסתר); מה שעודכן / אופס / הוסתר — חוזר למה שהיה,
-- רק כשהערך עכשיו הוא עדיין מה שהיבוא קבע (אחרת — "התנגשות", בלי לגעת). קטגוריות שהיבוא יצר
-- ונשארו ריקות — נמחקות.
CREATE OR REPLACE FUNCTION public.product_import_undo(_import uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public._product_import_tenant();
  _imp public.product_imports%ROWTYPE;
  c record;
  p record;
  _state text;
  _msg text;
  _conflict boolean;
  _deleted integer := 0;
  _hidden integer := 0;
  _restored integer := 0;
  _conflicts integer := 0;
  _gone integer := 0;
  _categories integer := 0;
  _n integer;
  _list jsonb := '[]'::jsonb;
  _cat text;
BEGIN
  SELECT * INTO _imp FROM public.product_imports
   WHERE id = _import AND tenant_id = _tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'היבוא לא נמצא';
  END IF;
  IF _imp.status = 'undone' THEN
    RAISE EXCEPTION 'היבוא הזה כבר בוטל';
  END IF;

  PERFORM set_config('kobi.stock_internal', 'on', true);
  FOR c IN
    SELECT * FROM public.product_import_changes x
     WHERE x.import_id = _import AND x.tenant_id = _tenant
       AND x.action IN ('created', 'updated', 'zeroed', 'hidden') AND x.undone IS NULL
     ORDER BY x.id DESC
  LOOP
    _state := NULL;
    _msg := NULL;
    _conflict := false;
    SELECT gp.id, gp.stock_quantity, gp.is_out_of_stock, gp.out_of_stock_auto, gp.is_hidden,
           gp.price_tier1, gp.price_tier2, gp.price_tier3
      INTO p
      FROM public.global_products gp
     WHERE gp.id = c.product_id AND gp.tenant_id = _tenant
     FOR UPDATE;
    IF NOT FOUND THEN
      _state := 'skipped';
      _msg := 'המוצר כבר לא קיים בחנות';
      _gone := _gone + 1;
    ELSIF c.action = 'created' THEN
      BEGIN
        DELETE FROM public.global_products WHERE id = p.id AND tenant_id = _tenant;
        _state := 'deleted';
        _deleted := _deleted + 1;
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.global_products SET is_hidden = true WHERE id = p.id AND tenant_id = _tenant;
        _state := 'hidden';
        _msg := CASE WHEN SQLSTATE = '23503' THEN 'המוצר כבר הוזמן — הוסתר מהאתר במקום למחוק'
                     ELSE 'המוצר לא נמחק (' || SQLERRM || ') — הוסתר מהאתר' END;
        _hidden := _hidden + 1;
      END;
    ELSIF c.action = 'hidden' THEN
      IF p.is_hidden THEN
        UPDATE public.global_products SET is_hidden = false WHERE id = p.id AND tenant_id = _tenant;
        _state := 'restored';
        _restored := _restored + 1;
      ELSE
        _state := 'skipped';
        _msg := 'המוצר כבר מוצג באתר';
      END IF;
    ELSE
      -- updated / zeroed
      IF c.after ? 'stock' THEN
        IF p.stock_quantity = (c.after ->> 'stock')::integer
           AND p.is_out_of_stock = (c.after ->> 'out_of_stock')::boolean
           AND COALESCE(p.out_of_stock_auto, false) = COALESCE((c.after ->> 'out_of_stock_auto')::boolean, false) THEN
          UPDATE public.global_products
             SET stock_quantity = (c.before ->> 'stock')::integer,
                 is_out_of_stock = (c.before ->> 'out_of_stock')::boolean,
                 out_of_stock_auto = COALESCE((c.before ->> 'out_of_stock_auto')::boolean, false)
           WHERE id = p.id AND tenant_id = _tenant;
        ELSE
          _conflict := true;
          _msg := 'המלאי השתנה מאז היבוא (עכשיו ' || p.stock_quantity || ') — לא שוחזר';
        END IF;
      END IF;
      IF c.after ? 'price' THEN
        IF p.price_tier1 = (c.after ->> 'price')::numeric
           AND p.price_tier2 = (c.after ->> 'price_tier2')::numeric
           AND p.price_tier3 = (c.after ->> 'price_tier3')::numeric THEN
          BEGIN
            UPDATE public.global_products
               SET price_tier1 = (c.before ->> 'price')::numeric,
                   price_tier2 = (c.before ->> 'price_tier2')::numeric,
                   price_tier3 = (c.before ->> 'price_tier3')::numeric
             WHERE id = p.id AND tenant_id = _tenant;
          EXCEPTION WHEN OTHERS THEN
            _conflict := true;
            _msg := concat_ws(' · ', _msg, 'המחיר לא שוחזר: ' || SQLERRM);
          END;
        ELSE
          _conflict := true;
          _msg := concat_ws(' · ', _msg, 'המחיר השתנה מאז היבוא — לא שוחזר');
        END IF;
      END IF;
      IF _conflict THEN
        _state := 'conflict';
        _conflicts := _conflicts + 1;
      ELSE
        _state := 'restored';
        _restored := _restored + 1;
      END IF;
    END IF;

    UPDATE public.product_import_changes
       SET undone = _state, undo_message = NULLIF(left(COALESCE(_msg, ''), 500), '')
     WHERE id = c.id;
    IF _state IN ('conflict', 'hidden') AND jsonb_array_length(_list) < 300 THEN
      _list := _list || jsonb_build_object('row', c.file_row, 'name', c.product_name, 'message', _msg);
    END IF;
  END LOOP;
  PERFORM set_config('kobi.stock_internal', 'off', true);

  -- קטגוריות שהיבוא יצר ונשארו ריקות (מהעמוקה לשורש)
  FOR _cat IN SELECT u.name FROM unnest(_imp.new_categories) WITH ORDINALITY AS u(name, n) ORDER BY u.n DESC LOOP
    BEGIN
      DELETE FROM public.categories cat
       WHERE cat.tenant_id = _tenant AND cat.name = _cat
         AND NOT EXISTS (SELECT 1 FROM public.global_products gp WHERE gp.tenant_id = _tenant AND gp.category = _cat)
         AND NOT EXISTS (SELECT 1 FROM public.product_categories pc WHERE pc.category_id = cat.id)
         AND NOT EXISTS (SELECT 1 FROM public.categories ch WHERE ch.tenant_id = _tenant AND ch.parent_name = _cat);
      GET DIAGNOSTICS _n = ROW_COUNT;
      _categories := _categories + _n;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- קטגוריה שאי אפשר למחוק — נשארת
    END;
  END LOOP;

  UPDATE public.product_imports
     SET status = 'undone', undone_at = now()
   WHERE id = _import AND tenant_id = _tenant;
  RETURN jsonb_build_object('deleted', _deleted, 'hidden', _hidden, 'restored', _restored,
                            'conflicts', _conflicts, 'gone', _gone, 'categories_removed', _categories,
                            'rows', _list);
END $$;

-- ------------------------------------------------------------
-- 6. הרשאות: הפונקציות הציבוריות — למשתמש מחובר (הבדיקה בפנים: מנהל החנות); העזרים — לאף אחד
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public._product_import_name_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_import_sku_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_import_tenant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_import_missing_ids(uuid, uuid[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_import_card(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_import_json(public.product_imports) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_import_create(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_import_update(uuid, uuid, jsonb, boolean, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_import_skip(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.product_import_match(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_import_missing_count(uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_import_begin(text, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_import_apply(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_import_finish(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_import_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_imports_recent() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_import_undo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_import_match(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_import_missing_count(uuid[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_import_begin(text, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_import_apply(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_import_finish(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_import_report(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_imports_recent() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_import_undo(uuid) TO authenticated, service_role;

COMMIT;
