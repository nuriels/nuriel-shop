-- ============================================================
-- SEC-M5 (חלק הקוד): מחיקת חנות לא מוחקת את הרשומות של Nuriel עצמה
-- ------------------------------------------------------------
-- platform_delete_tenant מחקה כל טבלה עם tenant_id — כולל billing_history (החיובים והתשלומים
-- של Nuriel, שחובה לשמור) ו-platform_audit_log (יומן הפלטפורמה), ובלי לרשום את המחיקה עצמה.
-- מעכשיו (כמו ההסכמים החתומים):
--   • שתי הטבלאות לא נמחקות עם החנות; ה-FK המדורג הוסר, כך שהשורות שומרות את מזהה החנות
--     (ייחוס) — יומן הפלטפורמה הוא append-only, ולכן לא SET NULL;
--   • billing_history.store_label — שם וכתובת החנות שנמחקה (תמונת מצב ברגע המחיקה);
--   • אירוע tenant_deleted ביומן (מי מחק, כתובת, שם, כמה שורות ומשתמשים).
-- לוח-זמנים לשמירת מידע (retention), ייצוא לפני סגירה ומחיקת קבצי האחסון של חנות שנמחקה —
-- החלטה עסקית/משפטית ושלב שרת; לא כאן.
-- ============================================================
BEGIN;

ALTER TABLE public.billing_history ADD COLUMN IF NOT EXISTS store_label text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_history_store_label_check') THEN
    ALTER TABLE public.billing_history ADD CONSTRAINT billing_history_store_label_check
      CHECK (store_label IS NULL OR char_length(store_label) <= 200);
  END IF;
END $$;
ALTER TABLE public.billing_history DROP CONSTRAINT IF EXISTS billing_history_tenant_id_fkey;
ALTER TABLE public.platform_audit_log DROP CONSTRAINT IF EXISTS platform_audit_log_tenant_id_fkey;

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
     -- SEC-M5: רשומות של Nuriel עצמה (חיובים / יומן הפלטפורמה) לא נמחקות עם החנות
     AND c.relname NOT IN ('tenants', 'tenant_ssl', 'platform_agreement_acceptances',
                           'billing_history', 'platform_audit_log');

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

  -- SEC-M5: רשומות החיוב של Nuriel נשמרות (חובת שמירת מסמכים) — עם שם וכתובת החנות שנמחקה,
  -- והמחיקה עצמה נרשמת ביומן הפלטפורמה (המזהה של החנות נשאר בשורות — בלי קשר FK).
  UPDATE public.billing_history
     SET store_label = left(format('%s (%s)', t.name, t.slug), 200)
   WHERE tenant_id = _tenant AND store_label IS NULL;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, actor_email, action, details)
  VALUES (_tenant, auth.uid(), (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), 'tenant_deleted',
          jsonb_build_object('slug', t.slug, 'name', t.name, 'rows', _total, 'users', cardinality(_users)));

  -- tenant_ssl.tenant_id מתאפס → השרת יודע למחוק את התעודה של הכתובת
  DELETE FROM public.tenants WHERE id = _tenant;

  RETURN jsonb_build_object('slug', t.slug, 'rows', _total, 'user_ids', to_jsonb(_users));
END $function$;

COMMIT;
