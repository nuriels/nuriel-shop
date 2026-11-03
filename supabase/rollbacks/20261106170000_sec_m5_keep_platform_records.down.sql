-- ============================================================
-- Rollback ל-SEC-M5: platform_delete_tenant חוזרת לגרסת המקור (מוחקת גם חיובים ויומן), ה-FK
-- המדורג חוזר לשתי הטבלאות, והעמודה store_label נמחקת.
-- שימו לב: שורות של חנויות שכבר נמחקו (מזהה חנות שלא קיים) נמחקות כאן — אחרת ה-FK לא חוזר.
-- זו ההתנהגות שלפני התיקון; אם צריך אותן — לגבות לפני ה-rollback.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.platform_delete_tenant(_tenant uuid, _confirm_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tenants;
  _tables regclass[];
  _tbl regclass;
  _n bigint;
  _total bigint := 0;
  _left text[];
  _pass int;
  _progress boolean;
  _users uuid[];
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול למחוק חנויות' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO t FROM public.tenants WHERE id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;
  IF t.is_default THEN
    RAISE EXCEPTION 'החנות הראשית של הפלטפורמה לא ניתנת למחיקה' USING ERRCODE = 'check_violation';
  END IF;
  IF lower(btrim(COALESCE(_confirm_slug, ''))) <> t.slug THEN
    RAISE EXCEPTION 'כדי למחוק, יש להקליד את כתובת החנות (%) בדיוק', t.slug
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('nuriel.deleting_tenant', _tenant::text, true);
  SELECT COALESCE(array_agg(ur.user_id), '{}') INTO _users
    FROM public.user_roles ur
   WHERE ur.tenant_id = _tenant
     AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = ur.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles other
                      WHERE other.user_id = ur.user_id AND other.tenant_id <> _tenant);

  -- כל הטבלאות עם tenant_id (חוץ מ-tenants ומ-tenant_ssl)
  SELECT COALESCE(array_agg(c.oid::regclass ORDER BY c.relname), '{}') INTO _tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND c.relname NOT IN ('tenants', 'tenant_ssl', 'platform_agreement_acceptances');

  -- הטבלאות קשורות זו לזו (מוצר ← קטגוריה, הזמנה ← לקוח…), וחלק מהקשרים
  -- RESTRICT. במקום לתחזק סדר ידני: מוחקים בסבבים — טבלה שעוד יש לה
  -- שורות תלויות מחכה לסבב הבא — עד שלא נשאר כלום.
  FOR _pass IN 1..20 LOOP
    _progress := false;
    _left := '{}';
    FOREACH _tbl IN ARRAY _tables LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE tenant_id = $1', _tbl) USING _tenant;
        GET DIAGNOSTICS _n = ROW_COUNT;
        IF _n > 0 THEN
          _total := _total + _n;
          _progress := true;
        END IF;
      EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
        _left := _left || _tbl::text;
      END;
    END LOOP;
    -- טריגרים יכולים להוסיף שורות בזמן המחיקה — בודקים שבאמת לא נשאר כלום
    IF cardinality(_left) = 0 THEN
      FOREACH _tbl IN ARRAY _tables LOOP
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE tenant_id = $1)', _tbl)
          INTO _progress USING _tenant;
        IF _progress THEN
          _left := _left || _tbl::text;
        END IF;
      END LOOP;
      EXIT WHEN cardinality(_left) = 0;
      _progress := true;
    END IF;
    IF NOT _progress THEN
      RAISE EXCEPTION 'המחיקה נעצרה — נשארו שורות שלא ניתן למחוק בטבלאות: %',
        array_to_string(_left, ', ');
    END IF;
  END LOOP;
  IF cardinality(_left) > 0 THEN
    RAISE EXCEPTION 'המחיקה לא הושלמה — נשארו שורות בטבלאות: %', array_to_string(_left, ', ');
  END IF;

  -- tenant_ssl.tenant_id מתאפס → השרת יודע למחוק את התעודה של הכתובת
  DELETE FROM public.tenants WHERE id = _tenant;

  RETURN jsonb_build_object('slug', t.slug, 'rows', _total, 'user_ids', to_jsonb(_users));
END $function$;

DELETE FROM public.billing_history b WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = b.tenant_id);
DELETE FROM public.platform_audit_log a
 WHERE a.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = a.tenant_id);
ALTER TABLE public.billing_history DROP CONSTRAINT IF EXISTS billing_history_tenant_id_fkey;
ALTER TABLE public.billing_history ADD CONSTRAINT billing_history_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.platform_audit_log DROP CONSTRAINT IF EXISTS platform_audit_log_tenant_id_fkey;
ALTER TABLE public.platform_audit_log ADD CONSTRAINT platform_audit_log_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.billing_history DROP CONSTRAINT IF EXISTS billing_history_store_label_check;
ALTER TABLE public.billing_history DROP COLUMN IF EXISTS store_label;

COMMIT;
