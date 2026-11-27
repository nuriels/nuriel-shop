-- ============================================================
-- Ecommerce — מיגרציה 207: מותג ומצב המוצר (חדש / מחודש / משומש) — לנתונים המובנים של גוגל, באישור בעל החנות
--
-- הבעיה (בכל החנויות, במנוע המשותף): ב-JSON-LD של כל מוצר brand היה שם החנות, ו-itemCondition היה
-- NewCondition לכל מוצר — גם למחשבים מחודשים. Google Search Central (Product structured data): brand — המותג
-- של המוצר "if known" (לא שם המוכר); itemCondition — המצב האמיתי (New / Refurbished / Used). לא היה איפה
-- לשמור לא את המותג ולא את המצב.
--
-- התיקון:
--   1. global_products.brand (1–80 תווים, בלי < >) ו-global_products.item_condition ('new' | 'refurbished' |
--      'used'). ריק = לא ידוע: האתר לא מציג מותג, ולמצב — מה שבעל החנות כתב בשם המוצר / בקטגוריה ("מחודש",
--      "משומש"), אחרת חדש (הקוד: src/lib/structured-data.ts).
--   2. הצעות SEO למוצר גם לשני השדות (store_seo_proposals.field 'brand' / 'item_condition' — למוצר בלבד), באותו
--      מסלול: ממתינה → אישור (עם עריכה) / דחייה / "אחר כך", היסטוריה ושחזור, "התיישנה" כשבעל החנות שינה בינתיים.
--      הן לעולם לא מוחלות אוטומטית — גם כשבעל החנות הפעיל החלה אוטומטית לכותרות ולתיאורים.
--   3. store_seo_snapshot מחזיר גם 'facts': המותג והמצב של המוצרים שחסר להם אחד מהם (השרת מציע רק כשהמותג / המצב
--      כתוב בשם המוצר או בקטגוריה שבעל החנות כתב — לא ממציאים מותג ולא מצב).
-- הנתונים הקיימים לא משתנים: שום מוצר לא מתעדכן, אין מילוי אוטומטי. אידמפוטנטי (בטוח להרצה חוזרת).
-- Rollback: supabase/rollbacks/20261127100000_product_brand_condition.down.sql (נעצר כשנשמר מותג / מצב / הצעה).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. העמודות
-- ------------------------------------------------------------
ALTER TABLE public.global_products ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.global_products ADD COLUMN IF NOT EXISTS item_condition text;
ALTER TABLE public.global_products DROP CONSTRAINT IF EXISTS global_products_brand_check;
ALTER TABLE public.global_products ADD CONSTRAINT global_products_brand_check
  CHECK (brand IS NULL OR (char_length(btrim(brand)) BETWEEN 1 AND 80 AND brand !~ '[<>]'));
ALTER TABLE public.global_products DROP CONSTRAINT IF EXISTS global_products_item_condition_check;
ALTER TABLE public.global_products ADD CONSTRAINT global_products_item_condition_check
  CHECK (item_condition IS NULL OR item_condition IN ('new', 'refurbished', 'used'));
COMMENT ON COLUMN public.global_products.brand IS
  'המותג / היצרן של המוצר (לא שם החנות) — Product.brand בנתונים המובנים. ריק = לא ידוע (לא מוצג)';
COMMENT ON COLUMN public.global_products.item_condition IS
  'מצב המוצר: new / refurbished / used — Offer.itemCondition. ריק = לפי המילים בשם / בקטגוריה, אחרת חדש';

-- ------------------------------------------------------------
-- 2. הצעות SEO: שני השדות החדשים — למוצר בלבד
-- ------------------------------------------------------------
-- ה-CHECK המקורי על field (שם אוטומטי) — נמצא לפי העמודה, לא לפי השם
DO $$
DECLARE
  _c record;
BEGIN
  FOR _c IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'public.store_seo_proposals'::regclass AND con.contype = 'c'
       AND con.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                                WHERE a.attrelid = 'public.store_seo_proposals'::regclass AND a.attname = 'field')]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.store_seo_proposals DROP CONSTRAINT %I', _c.conname);
  END LOOP;
END $$;
ALTER TABLE public.store_seo_proposals ADD CONSTRAINT store_seo_proposals_field_check
  CHECK (field IN ('seo_title', 'seo_description', 'seo_keywords', 'brand', 'item_condition'));
ALTER TABLE public.store_seo_proposals DROP CONSTRAINT IF EXISTS store_seo_proposals_product_fields;
ALTER TABLE public.store_seo_proposals ADD CONSTRAINT store_seo_proposals_product_fields
  CHECK (field NOT IN ('brand', 'item_condition') OR target_kind = 'product');

CREATE OR REPLACE FUNCTION public._store_seo_max(_field text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _field WHEN 'seo_title' THEN 120 WHEN 'seo_description' THEN 320 WHEN 'seo_keywords' THEN 500
                     WHEN 'brand' THEN 80 WHEN 'item_condition' THEN 11 END;
$$;

CREATE OR REPLACE FUNCTION public._store_seo_clean(_field text, _v text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  _c text := btrim(regexp_replace(COALESCE(_v, ''), '\s+', ' ', 'g'));
BEGIN
  IF _field = 'seo_keywords' THEN
    _c := COALESCE(public.normalize_seo_keywords(_c), '');
  ELSIF _field = 'item_condition' THEN
    -- רק אחד משלושת הערכים — לא טקסט חופשי
    _c := lower(_c);
    IF _c NOT IN ('new', 'refurbished', 'used') THEN
      RETURN NULL;
    END IF;
  END IF;
  IF _c = '' OR _c ~ '[<>]' OR char_length(_c) > public._store_seo_max(_field) THEN
    RETURN NULL;
  END IF;
  RETURN _c;
END $$;

-- NULL = the target does not exist (any more); '' = an empty field
CREATE OR REPLACE FUNCTION public._store_seo_current(_t uuid, _kind text, _target uuid, _field text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v text;
  _found boolean;
BEGIN
  IF _kind = 'store' THEN
    SELECT CASE _field WHEN 'seo_title' THEN s.seo_title WHEN 'seo_description' THEN s.seo_description
                       WHEN 'seo_keywords' THEN s.seo_keywords END, true
      INTO v, _found FROM public.site_settings s WHERE s.tenant_id = _t LIMIT 1;
  ELSIF _kind = 'product' THEN
    SELECT CASE _field WHEN 'seo_title' THEN p.seo_title WHEN 'seo_description' THEN p.seo_description
                       WHEN 'seo_keywords' THEN p.seo_keywords WHEN 'brand' THEN p.brand
                       WHEN 'item_condition' THEN p.item_condition END, true
      INTO v, _found FROM public.global_products p WHERE p.tenant_id = _t AND p.id = _target;
  ELSIF _kind = 'category' THEN
    SELECT CASE _field WHEN 'seo_title' THEN c.seo_title WHEN 'seo_description' THEN c.seo_description END, true
      INTO v, _found FROM public.categories c WHERE c.tenant_id = _t AND c.id = _target;
  END IF;
  IF NOT COALESCE(_found, false) THEN
    RETURN NULL;
  END IF;
  RETURN COALESCE(v, '');
END $$;

-- כתיבה רק לעמודות המותרות לכל סוג יעד (שם העמודה = שם השדה; הגנה נוספת מעבר ל-CHECK של הטבלה)
CREATE OR REPLACE FUNCTION public._store_seo_write(_t uuid, _kind text, _target uuid, _field text, _v text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT ((_kind = 'store' AND _field IN ('seo_title', 'seo_description', 'seo_keywords'))
          OR (_kind = 'product' AND _field IN ('seo_title', 'seo_description', 'seo_keywords', 'brand', 'item_condition'))
          OR (_kind = 'category' AND _field IN ('seo_title', 'seo_description'))) THEN
    RAISE EXCEPTION 'שדה לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind = 'store' THEN
    EXECUTE format('UPDATE public.site_settings SET %I = $1 WHERE tenant_id = $2', _field) USING COALESCE(_v, ''), _t;
  ELSIF _kind = 'product' THEN
    EXECUTE format('UPDATE public.global_products SET %I = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3', _field)
      USING NULLIF(_v, ''), _t, _target;
  ELSIF _kind = 'category' THEN
    EXECUTE format('UPDATE public.categories SET %I = $1 WHERE tenant_id = $2 AND id = $3', _field)
      USING NULLIF(_v, ''), _t, _target;
  END IF;
END $$;

-- the server adds proposals (templates / AI); _only_empty: only fields that are empty today.
-- brand / item_condition: product only, and NEVER auto-applied (the auto switches cover Google texts only)
CREATE OR REPLACE FUNCTION public.store_seo_proposals_add(_tenant uuid, _items jsonb, _only_empty boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _i jsonb;
  _kind text;
  _target uuid;
  _field text;
  _text text;
  _cur text;
  _src text;
  _added integer := 0;
  _auto integer := 0;
  _skipped integer := 0;
  _auto_apply jsonb;
  p public.store_seo_proposals;
BEGIN
  IF _tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.site_type = 'ecommerce') THEN
    RAISE EXCEPTION 'not a store' USING ERRCODE = 'check_violation';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) > 300 THEN
    RAISE EXCEPTION 'bad proposals' USING ERRCODE = 'check_violation';
  END IF;
  SELECT s.auto_apply INTO _auto_apply FROM public.seo_settings s WHERE s.tenant_id = _tenant;
  FOR _i IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _kind := _i ->> 'target_kind';
    _field := _i ->> 'field';
    _src := COALESCE(_i ->> 'source', 'template');
    BEGIN
      _target := NULLIF(_i ->> 'target_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END;
    IF _kind NOT IN ('store', 'product', 'category')
       OR _field NOT IN ('seo_title', 'seo_description', 'seo_keywords', 'brand', 'item_condition')
       OR (_kind = 'category' AND _field = 'seo_keywords')
       OR (_kind <> 'product' AND _field IN ('brand', 'item_condition'))
       OR ((_kind = 'store') <> (_target IS NULL))
       OR _src NOT IN ('template', 'ai', 'gsc') THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    _text := public._store_seo_clean(_field, _i ->> 'text');
    _cur := public._store_seo_current(_tenant, _kind, _target, _field);
    IF _text IS NULL OR _cur IS NULL OR _text = _cur OR (_only_empty AND _cur <> '') THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM public.store_seo_proposals x WHERE x.tenant_id = _tenant AND x.status IN ('pending', 'later')) >= 500 THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    UPDATE public.store_seo_proposals x SET status = 'superseded', decided_at = now()
     WHERE x.tenant_id = _tenant AND x.target_kind = _kind AND x.target_id IS NOT DISTINCT FROM _target AND x.field = _field
       AND x.status IN ('pending', 'later');
    INSERT INTO public.store_seo_proposals (tenant_id, target_kind, target_id, field, proposed, base, reason, source)
    VALUES (_tenant, _kind, _target, _field, _text, _cur, left(_i ->> 'reason', 300), _src)
    RETURNING * INTO p;
    _added := _added + 1;
    -- auto-apply only when the owner turned it on for this kind of field (all OFF by default), and only into an
    -- EMPTY field — never over text the owner wrote. Never the brand / the condition (facts about the product)
    IF _cur = '' AND ((_field IN ('seo_title', 'seo_description') AND COALESCE((_auto_apply ->> 'meta')::boolean, false))
       OR (_field = 'seo_keywords' AND COALESCE((_auto_apply ->> 'keywords')::boolean, false))) THEN
      PERFORM public._store_seo_write(_tenant, _kind, _target, _field, _text);
      UPDATE public.store_seo_proposals x SET status = 'approved', applied = _text, decided_at = now() WHERE x.id = p.id;
      INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
      VALUES (_tenant, NULL, 'seo.proposal_auto_applied',
              jsonb_build_object('proposal', p.id, 'target', _kind, 'target_id', _target, 'field', _field));
      _auto := _auto + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('added', _added, 'auto_applied', _auto, 'skipped', _skipped);
END $$;

-- the worker: what a store looks like for SEO (no prices, no customers) — the server builds templates / AI from it.
-- 'facts': the products missing a brand or a condition (newest first), with the fields that already have an open /
-- rejected proposal ('blocked' — not proposed again)
CREATE OR REPLACE FUNCTION public.store_seo_snapshot(_tenant uuid, _only_missing boolean DEFAULT true, _limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    -- the store's name as the store itself shows it (footer, labels): its business name, else its site title, else the
    -- tenant's name. Most stores never fill the business name, and the templates make nothing without a name
    'store', (SELECT jsonb_build_object('name', COALESCE(NULLIF(btrim(s.business_name), ''), NULLIF(btrim(s.site_title), ''),
                                                         NULLIF(btrim(t.name), '')),
                                        'seo_title', s.seo_title,
                                        'seo_description', s.seo_description, 'seo_keywords', s.seo_keywords)
                FROM public.tenants t LEFT JOIN public.site_settings s ON s.tenant_id = t.id WHERE t.id = _tenant),
    'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'parent', c.parent_name,
                                                                'seo_title', c.seo_title, 'seo_description', c.seo_description,
                                                                'products', (SELECT count(*) FROM public.global_products g
                                                                              WHERE g.tenant_id = _tenant AND g.category = c.name
                                                                                AND NOT COALESCE(g.is_hidden, false)),
                                                                -- real product names of the category (its description)
                                                                'top', COALESCE((SELECT jsonb_agg(x.name) FROM (
                                                                          SELECT g.name FROM public.global_products g
                                                                           WHERE g.tenant_id = _tenant AND g.category = c.name
                                                                             AND NOT COALESCE(g.is_hidden, false)
                                                                           ORDER BY g.created_at DESC LIMIT 3) x), '[]'::jsonb))
                                             ORDER BY c.sort_order, c.name)
                              FROM public.categories c WHERE c.tenant_id = _tenant
                                AND (NOT _only_missing OR c.seo_title IS NULL OR c.seo_description IS NULL)), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
                            SELECT g.id, g.name, g.category, left(g.description, 1200) AS description, g.seo_title,
                                   g.seo_description, g.seo_keywords, g.created_at
                              FROM public.global_products g
                             WHERE g.tenant_id = _tenant AND NOT COALESCE(g.is_hidden, false)
                               AND (NOT _only_missing OR g.seo_title IS NULL OR g.seo_description IS NULL)
                               AND NOT EXISTS (SELECT 1 FROM public.store_seo_proposals p
                                                WHERE p.tenant_id = _tenant AND p.target_kind = 'product' AND p.target_id = g.id
                                                  AND p.field IN ('seo_title', 'seo_description', 'seo_keywords')
                                                  AND p.status IN ('pending', 'later', 'rejected'))
                             ORDER BY g.created_at DESC LIMIT LEAST(GREATEST(COALESCE(_limit, 60), 1), 200)) x), '[]'::jsonb),
    'facts', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
                         SELECT g.id, g.name, g.category, g.brand, g.item_condition, g.created_at,
                                COALESCE((SELECT jsonb_agg(DISTINCT p.field) FROM public.store_seo_proposals p
                                           WHERE p.tenant_id = _tenant AND p.target_kind = 'product' AND p.target_id = g.id
                                             AND p.field IN ('brand', 'item_condition')
                                             AND p.status IN ('pending', 'later', 'rejected')), '[]'::jsonb) AS blocked
                           FROM public.global_products g
                          WHERE g.tenant_id = _tenant AND NOT COALESCE(g.is_hidden, false)
                            AND (g.brand IS NULL OR g.item_condition IS NULL)
                          ORDER BY g.created_at DESC LIMIT 1000) x), '[]'::jsonb));
$$;

-- (grants unchanged: CREATE OR REPLACE keeps them — server functions for service_role only, the helpers for none)

NOTIFY pgrst, 'reload schema';
COMMIT;
