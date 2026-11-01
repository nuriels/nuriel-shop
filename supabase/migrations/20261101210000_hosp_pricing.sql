-- ============================================================
-- Hospitality Stage 2f — מחירים, כללי מחיר ומדיניות ביטול (ניהול)
--
-- תוספת בלבד. מנוע המחירים והמדיניות קיים משלב 1 (_price_nights, _resolve_policy,
-- policy_schedule, גרסאות מדיניות) — כאן רק הניהול:
--   1. בלי כתיבה ישירה של הצוות ל-rate_rules ול-policies — רק דרך הפונקציות (יומן,
--      בדיקות בעברית). מחירי היחידה — מאז מיגרציה 10 רק דרך פונקציות; כאן נוספת הפונקציה.
--   2. היסטוריית הגרסאות — הטבלה הקיימת policy_versions (שלב 1e) לקריאה דרך policy_history.
--   3. פונקציות: pricing_view, unit_prices_set, rate_rule_save, rate_rule_delete,
--      policy_save, policy_set_default, policy_archive, policy_history, policy_preview
--      (לוח הזמנים של מדיניות לדוגמה — אותו חישוב בדיוק כמו בהזמנה), price_preview (תצוגת
--      מחיר לצוות עם הרשאת pricing — אותו _quote של מנוע ההזמנות, גם כשההזמנות סגורות).
--   המחיר מחושב רק בשרת (quote / _price_nights); המסך מציג את מה שהשרת החזיר.
--
-- Rollback: supabase/rollbacks/20261101210000_hosp_pricing.down.sql
-- אידמפוטנטית.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. בלי כתיבה ישירה
-- ------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON hospitality.rate_rules FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON hospitality.policies FROM authenticated;

-- ------------------------------------------------------------
-- 3. עזרים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._cv_money(_v jsonb, _label text, _min numeric, _max numeric, _nullable boolean)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) = 'null' THEN
    IF _nullable THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'יש למלא את %', _label USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(_v) <> 'number' OR (_v #>> '{}')::numeric NOT BETWEEN _min AND _max
     OR round((_v #>> '{}')::numeric, 2) <> (_v #>> '{}')::numeric THEN
    RAISE EXCEPTION '% — סכום בין % ל-% (עד שתי ספרות אחרי הנקודה)', _label, _min, _max USING ERRCODE = 'check_violation';
  END IF;
  RETURN (_v #>> '{}')::numeric;
END $$;
REVOKE ALL ON FUNCTION hospitality._cv_money(jsonb, text, numeric, numeric, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._cv_date(_v jsonb, _label text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(_v) <> 'string' OR (_v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION '% — תאריך לא תקין', _label USING ERRCODE = 'check_violation';
  END IF;
  RETURN (_v #>> '{}')::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION '% — תאריך לא תקין', _label USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION hospitality._cv_date(jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._policy_json(p hospitality.policies)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', p.id, 'name', p.name, 'version', p.version, 'is_default', p.is_default,
                            'is_archived', p.is_archived, 'updated_at', hospitality._ts(p.updated_at),
                            'rules', hospitality._policy_rules(p) - 'house_rules');
$$;
REVOKE ALL ON FUNCTION hospitality._policy_json(hospitality.policies) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._rule_json(r hospitality.rate_rules)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', r.id, 'name', r.name, 'kind', r.kind, 'property_id', r.property_id,
                            'unit_id', r.unit_id, 'date_from', r.date_from, 'date_to', r.date_to,
                            'days_mask', r.days_mask, 'price_mode', r.price_mode, 'value', r.value,
                            'min_nights', r.min_nights, 'priority', r.priority, 'policy_id', r.policy_id,
                            'is_active', r.is_active);
$$;
REVOKE ALL ON FUNCTION hospitality._rule_json(hospitality.rate_rules) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. קריאה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.pricing_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('pricing');
  s hospitality.settings;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  RETURN jsonb_build_object(
    'currency', s.currency, 'weekend_nights', to_jsonb(s.weekend_nights), 'timezone', s.timezone,
    'check_in_time', to_char(s.check_in_time, 'HH24:MI'),
    'can_policies', hospitality.can('policies'),
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', u.id, 'name', u.name, 'kind', u.kind, 'property_id', u.property_id, 'property_name', p.name,
               'is_active', u.is_active, 'capacity', u.capacity, 'base_occupancy', u.base_occupancy,
               'base_price', u.base_price, 'extra_adult_price', u.extra_adult_price,
               'extra_child_price', u.extra_child_price, 'min_nights', u.min_nights,
               'price_floor', u.price_floor, 'price_ceiling', u.price_ceiling, 'policy_id', u.policy_id,
               'revision', u.revision)
             ORDER BY p.sort_order, p.created_at, (u.kind = 'whole_property'), u.sort_order, u.created_at)
        FROM hospitality.units u
        JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
       WHERE u.tenant_id = _t AND p.status <> 'archived'), '[]'::jsonb),
    'properties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.sort_order, p.created_at)
        FROM hospitality.properties p WHERE p.tenant_id = _t AND p.status <> 'archived'), '[]'::jsonb),
    'rules', COALESCE((
      SELECT jsonb_agg(hospitality._rule_json(r) ORDER BY r.is_active DESC, r.date_from NULLS FIRST, r.kind, r.name)
        FROM hospitality.rate_rules r WHERE r.tenant_id = _t), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(hospitality._policy_json(x) ORDER BY x.is_default DESC, x.is_archived, x.name)
        FROM hospitality.policies x WHERE x.tenant_id = _t), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.pricing_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.pricing_view() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. מחירי היחידה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.unit_prices_set(_id uuid, _changes jsonb, _expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('pricing');
  u hospitality.units;
  n hospitality.units;
  k text;
  v jsonb;
  _diff jsonb := '{}'::jsonb;
  f text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-catalog:' || _t::text, 0));
  IF _changes IS NULL OR jsonb_typeof(_changes) <> 'object' OR _changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'אין שינויים לשמירה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _expected_revision IS DISTINCT FROM u.revision THEN
    RAISE EXCEPTION 'היחידה עודכנה בינתיים — מרעננים' USING ERRCODE = 'HS409';
  END IF;
  n := u;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(_changes) e LOOP
    CASE k
      WHEN 'base_price' THEN n.base_price := hospitality._cv_money(v, 'מחיר ללילה', 0, 100000, false);
      WHEN 'extra_adult_price' THEN n.extra_adult_price := hospitality._cv_money(v, 'תוספת למבוגר', 0, 100000, false);
      WHEN 'extra_child_price' THEN n.extra_child_price := hospitality._cv_money(v, 'תוספת לילד', 0, 100000, false);
      WHEN 'min_nights' THEN n.min_nights := hospitality._cv_int(v, 'מינימום לילות', 1, 60);
      WHEN 'price_floor' THEN n.price_floor := hospitality._cv_money(v, 'מחיר מינימלי', 0, 100000, true);
      WHEN 'price_ceiling' THEN n.price_ceiling := hospitality._cv_money(v, 'מחיר מקסימלי', 0, 100000, true);
      WHEN 'policy_id' THEN
        IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
          n.policy_id := NULL;
        ELSE
          SELECT x.id INTO n.policy_id FROM hospitality.policies x
           WHERE x.tenant_id = _t AND x.id::text = (v #>> '{}') AND NOT x.is_archived;
          IF n.policy_id IS NULL THEN
            RAISE EXCEPTION 'מדיניות הביטול לא נמצאה' USING ERRCODE = 'no_data_found';
          END IF;
        END IF;
      ELSE RAISE EXCEPTION 'שדה לא מוכר: %', left(k, 40) USING ERRCODE = 'check_violation';
    END CASE;
  END LOOP;
  IF n.price_floor IS NOT NULL AND n.price_ceiling IS NOT NULL AND n.price_floor > n.price_ceiling THEN
    RAISE EXCEPTION 'המחיר המינימלי לא יכול להיות גבוה מהמקסימלי' USING ERRCODE = 'check_violation';
  END IF;
  FOREACH f IN ARRAY ARRAY['base_price', 'extra_adult_price', 'extra_child_price', 'min_nights', 'price_floor',
                           'price_ceiling', 'policy_id'] LOOP
    IF to_jsonb(n) -> f IS DISTINCT FROM to_jsonb(u) -> f THEN
      _diff := _diff || jsonb_build_object(f, jsonb_build_object('from', to_jsonb(u) -> f, 'to', to_jsonb(n) -> f));
    END IF;
  END LOOP;
  IF _diff = '{}'::jsonb THEN
    RETURN jsonb_build_object('id', u.id, 'revision', u.revision);
  END IF;
  UPDATE hospitality.units x
     SET base_price = n.base_price, extra_adult_price = n.extra_adult_price, extra_child_price = n.extra_child_price,
         min_nights = n.min_nights, price_floor = n.price_floor, price_ceiling = n.price_ceiling,
         policy_id = n.policy_id, revision = x.revision + 1
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING * INTO n;
  PERFORM hospitality._audit(_t, 'pricing.unit_prices', n.name, _diff);
  RETURN jsonb_build_object('id', n.id, 'revision', n.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_prices_set(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_prices_set(uuid, jsonb, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6. כללי מחיר (סוף שבוע, עונה, חג, ימי חול)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.rate_rule_save(_id uuid, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('pricing');
  r hospitality.rate_rules;
  o hospitality.rate_rules;
  k text;
  v jsonb;
  _creating boolean := _id IS NULL;
BEGIN
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' THEN
    RAISE EXCEPTION 'חסרים פרטי הכלל' USING ERRCODE = 'check_violation';
  END IF;
  IF _creating THEN
    r.tenant_id := _t; r.days_mask := 127; r.price_mode := 'fixed'; r.priority := 0; r.is_active := true;
    IF NOT (_data ? 'name') OR NOT (_data ? 'kind') OR NOT (_data ? 'value') THEN
      RAISE EXCEPTION 'יש למלא שם, סוג ומחיר לכלל' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO r FROM hospitality.rate_rules x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'הכלל לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
    o := r;
  END IF;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(_data) e LOOP
    CASE k
      WHEN 'name' THEN r.name := hospitality._cv_text(v, 'שם הכלל', 80, true);
      WHEN 'kind' THEN r.kind := hospitality._cv_choice(v, 'סוג הכלל', ARRAY['weekday', 'weekend', 'season', 'holiday']);
      WHEN 'scope' THEN
        -- {"unit_id": …} / {"property_id": …} / {} (כל היחידות)
        IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN
          RAISE EXCEPTION 'על מה הכלל חל — ערך לא תקין' USING ERRCODE = 'check_violation';
        END IF;
        r.unit_id := NULL; r.property_id := NULL;
        IF v ? 'unit_id' THEN
          SELECT u.id INTO r.unit_id FROM hospitality.units u WHERE u.tenant_id = _t AND u.id::text = v ->> 'unit_id';
          IF r.unit_id IS NULL THEN RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
        ELSIF v ? 'property_id' THEN
          SELECT p.id INTO r.property_id FROM hospitality.properties p WHERE p.tenant_id = _t AND p.id::text = v ->> 'property_id';
          IF r.property_id IS NULL THEN RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found'; END IF;
        END IF;
      WHEN 'date_from' THEN r.date_from := hospitality._cv_date(v, 'מתאריך');
      WHEN 'date_to' THEN r.date_to := hospitality._cv_date(v, 'עד תאריך');
      WHEN 'days_mask' THEN r.days_mask := hospitality._cv_int(v, 'ימים בשבוע', 1, 127);
      WHEN 'price_mode' THEN r.price_mode := hospitality._cv_choice(v, 'אופן המחיר', ARRAY['fixed', 'percent', 'amount']);
      WHEN 'value' THEN r.value := hospitality._cv_money(v, 'המחיר', -100000, 100000, false);
      WHEN 'min_nights' THEN
        r.min_nights := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                             ELSE hospitality._cv_int(v, 'מינימום לילות', 1, 60) END;
      WHEN 'priority' THEN r.priority := hospitality._cv_int(v, 'עדיפות', -1000, 1000);
      WHEN 'policy_id' THEN
        IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
          r.policy_id := NULL;
        ELSE
          SELECT x.id INTO r.policy_id FROM hospitality.policies x
           WHERE x.tenant_id = _t AND x.id::text = (v #>> '{}') AND NOT x.is_archived;
          IF r.policy_id IS NULL THEN RAISE EXCEPTION 'מדיניות הביטול לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
        END IF;
      WHEN 'is_active' THEN
        IF jsonb_typeof(v) <> 'boolean' THEN
          RAISE EXCEPTION 'מצב הכלל — ערך לא תקין' USING ERRCODE = 'check_violation';
        END IF;
        r.is_active := (v #>> '{}')::boolean;
      ELSE RAISE EXCEPTION 'שדה לא מוכר: %', left(k, 40) USING ERRCODE = 'check_violation';
    END CASE;
  END LOOP;
  IF r.kind IN ('season', 'holiday') AND (r.date_from IS NULL OR r.date_to IS NULL) THEN
    RAISE EXCEPTION 'לעונה ולחג יש לבחור תאריכים' USING ERRCODE = 'check_violation';
  END IF;
  IF (r.date_from IS NULL) <> (r.date_to IS NULL) THEN
    RAISE EXCEPTION 'יש לבחור גם מתאריך וגם עד תאריך' USING ERRCODE = 'check_violation';
  END IF;
  IF r.date_to IS NOT NULL AND r.date_to <= r.date_from THEN
    RAISE EXCEPTION '"עד תאריך" חייב להיות אחרי "מתאריך"' USING ERRCODE = 'check_violation';
  END IF;
  IF r.date_to IS NOT NULL AND r.date_to - r.date_from > 366 THEN
    RAISE EXCEPTION 'כלל אחד — עד שנה' USING ERRCODE = 'check_violation';
  END IF;
  IF r.price_mode = 'fixed' AND r.value < 0 THEN
    RAISE EXCEPTION 'מחיר ללילה לא יכול להיות שלילי' USING ERRCODE = 'check_violation';
  END IF;
  IF r.price_mode = 'percent' AND r.value NOT BETWEEN -90 AND 500 THEN
    RAISE EXCEPTION 'שינוי באחוזים — בין ‎-90%% ל-500%%' USING ERRCODE = 'check_violation';
  END IF;
  IF r.policy_id IS NOT NULL AND r.kind NOT IN ('season', 'holiday') THEN
    RAISE EXCEPTION 'מדיניות ביטול מיוחדת — רק לעונה או לחג' USING ERRCODE = 'check_violation';
  END IF;
  IF _creating THEN
    IF (SELECT count(*) FROM hospitality.rate_rules x WHERE x.tenant_id = _t) >= 300 THEN
      RAISE EXCEPTION 'אפשר להגדיר עד 300 כללי מחיר' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO hospitality.rate_rules (tenant_id, name, kind, property_id, unit_id, date_from, date_to, days_mask,
                                        price_mode, value, min_nights, priority, policy_id, is_active)
    VALUES (_t, r.name, r.kind, r.property_id, r.unit_id, r.date_from, r.date_to, r.days_mask, r.price_mode, r.value,
            r.min_nights, r.priority, r.policy_id, r.is_active)
    RETURNING * INTO r;
    PERFORM hospitality._audit(_t, 'pricing.rule_created', r.name, jsonb_build_object('kind', r.kind));
  ELSE
    UPDATE hospitality.rate_rules x
       SET name = r.name, kind = r.kind, property_id = r.property_id, unit_id = r.unit_id, date_from = r.date_from,
           date_to = r.date_to, days_mask = r.days_mask, price_mode = r.price_mode, value = r.value,
           min_nights = r.min_nights, priority = r.priority, policy_id = r.policy_id, is_active = r.is_active
     WHERE x.tenant_id = _t AND x.id = _id
    RETURNING * INTO r;
    PERFORM hospitality._audit(_t, 'pricing.rule_updated', r.name,
                               (SELECT COALESCE(jsonb_object_agg(e.key, jsonb_build_object('from', to_jsonb(o) -> e.key, 'to', e.value)), '{}'::jsonb)
                                  FROM jsonb_each(to_jsonb(r)) e
                                 WHERE e.key NOT IN ('updated_at', 'created_at') AND to_jsonb(o) -> e.key IS DISTINCT FROM e.value));
  END IF;
  RETURN hospitality._rule_json(r);
END $$;
REVOKE ALL ON FUNCTION hospitality.rate_rule_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.rate_rule_save(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.rate_rule_delete(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('pricing');
  r hospitality.rate_rules;
BEGIN
  DELETE FROM hospitality.rate_rules x WHERE x.tenant_id = _t AND x.id = _id RETURNING * INTO r;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'הכלל לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._audit(_t, 'pricing.rule_deleted', r.name, jsonb_build_object('kind', r.kind));
  RETURN jsonb_build_object('id', _id);
END $$;
REVOKE ALL ON FUNCTION hospitality.rate_rule_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.rate_rule_delete(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 7. מדיניות ביטול
-- ------------------------------------------------------------
-- יצירה (_id null) או עדכון עם הגרסה שנטענה. הבדיקות והגרסה — בטריגר הקיים (policies_validate).
-- כללי המקום לא כאן (שלב 2d — ברמת המתחם).
CREATE OR REPLACE FUNCTION hospitality.policy_save(_id uuid, _data jsonb, _expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('policies');
  p hospitality.policies;
  o hospitality.policies;
  k text;
  v jsonb;
BEGIN
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' OR _data = '{}'::jsonb THEN
    RAISE EXCEPTION 'אין שינויים לשמירה' USING ERRCODE = 'check_violation';
  END IF;
  IF _id IS NULL THEN
    IF NOT (_data ? 'name') THEN
      RAISE EXCEPTION 'יש למלא את שם המדיניות' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(*) FROM hospitality.policies x WHERE x.tenant_id = _t) >= 30 THEN
      RAISE EXCEPTION 'אפשר להגדיר עד 30 מדיניות ביטול' USING ERRCODE = 'check_violation';
    END IF;
    p.tenant_id := _t; p.deposit_kind := 'none'; p.deposit_value := 0; p.deposit_due := 'approval';
    p.fee_tiers := '[]'::jsonb; p.no_show_fee := 'full'; p.no_show_value := 0; p.auto_cancel := 'never';
    p.is_default := false; p.is_archived := false;
  ELSE
    SELECT * INTO p FROM hospitality.policies x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'מדיניות הביטול לא נמצאה' USING ERRCODE = 'no_data_found';
    END IF;
    IF _expected_version IS DISTINCT FROM p.version THEN
      RAISE EXCEPTION 'המדיניות עודכנה בינתיים — מרעננים' USING ERRCODE = 'HS409';
    END IF;
    IF p.is_archived THEN
      RAISE EXCEPTION 'המדיניות בארכיון — אי אפשר לשנות אותה' USING ERRCODE = 'check_violation';
    END IF;
    o := p;
  END IF;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(_data) e LOOP
    CASE k
      WHEN 'name' THEN p.name := hospitality._cv_text(v, 'שם המדיניות', 80, true);
      WHEN 'deposit_kind' THEN p.deposit_kind := hospitality._cv_choice(v, 'מקדמה', ARRAY['none', 'percent', 'fixed']);
      WHEN 'deposit_value' THEN p.deposit_value := hospitality._cv_money(v, 'גובה המקדמה', 0, 100000, false);
      WHEN 'deposit_due' THEN p.deposit_due := hospitality._cv_choice(v, 'מועד המקדמה', ARRAY['booking', 'approval']);
      WHEN 'free_cancel_days' THEN
        p.free_cancel_days := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                                   ELSE hospitality._cv_int(v, 'ביטול חינם עד (ימים)', 0, 365) END;
      WHEN 'free_cancel_time' THEN p.free_cancel_time := hospitality._cv_time(v, 'שעת הביטול');
      WHEN 'fee_tiers' THEN p.fee_tiers := v;
      WHEN 'no_show_fee' THEN
        p.no_show_fee := hospitality._cv_choice(v, 'דמי אי-הגעה', ARRAY['deposit', 'percent_total', 'fixed', 'full']);
      WHEN 'no_show_value' THEN p.no_show_value := hospitality._cv_money(v, 'דמי אי-הגעה', 0, 100000, false);
      WHEN 'auto_cancel' THEN
        p.auto_cancel := hospitality._cv_choice(v, 'ביטול אוטומטי', ARRAY['never', 'within_free_window', 'always']);
      WHEN 'guest_text' THEN p.guest_text := hospitality._cv_text(v, 'הסבר לאורח', 2000, false);
      ELSE RAISE EXCEPTION 'שדה לא מוכר: %', left(k, 40) USING ERRCODE = 'check_violation';
    END CASE;
  END LOOP;
  IF p.deposit_kind = 'none' THEN p.deposit_value := 0; END IF;
  IF p.no_show_fee IN ('deposit', 'full') THEN p.no_show_value := 0; END IF;
  IF p.deposit_kind <> 'none' AND p.deposit_value <= 0 THEN
    RAISE EXCEPTION 'גובה המקדמה חייב להיות גדול מ-0' USING ERRCODE = 'check_violation';
  END IF;
  IF p.deposit_kind = 'percent' AND p.deposit_value > 100 THEN
    RAISE EXCEPTION 'מקדמה באחוזים — עד 100%%' USING ERRCODE = 'check_violation';
  END IF;
  IF p.no_show_fee = 'percent_total' AND p.no_show_value > 100 THEN
    RAISE EXCEPTION 'דמי אי-הגעה באחוזים — עד 100%%' USING ERRCODE = 'check_violation';
  END IF;
  IF p.auto_cancel = 'within_free_window' AND p.free_cancel_days IS NULL THEN
    RAISE EXCEPTION 'ביטול אוטומטי בחלון החינם דורש חלון ביטול חינם' USING ERRCODE = 'check_violation';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO hospitality.policies (tenant_id, name, deposit_kind, deposit_value, deposit_due, free_cancel_days,
                                      free_cancel_time, fee_tiers, no_show_fee, no_show_value, auto_cancel, guest_text)
    VALUES (_t, p.name, p.deposit_kind, p.deposit_value, p.deposit_due, p.free_cancel_days, p.free_cancel_time,
            p.fee_tiers, p.no_show_fee, p.no_show_value, p.auto_cancel, p.guest_text)
    RETURNING * INTO p;
    PERFORM hospitality._audit(_t, 'policies.created', p.name, jsonb_build_object('version', p.version));
  ELSE
    UPDATE hospitality.policies x
       SET name = p.name, deposit_kind = p.deposit_kind, deposit_value = p.deposit_value, deposit_due = p.deposit_due,
           free_cancel_days = p.free_cancel_days, free_cancel_time = p.free_cancel_time, fee_tiers = p.fee_tiers,
           no_show_fee = p.no_show_fee, no_show_value = p.no_show_value, auto_cancel = p.auto_cancel,
           guest_text = p.guest_text
     WHERE x.tenant_id = _t AND x.id = _id
    RETURNING * INTO p;
    IF p.version <> o.version OR p.name <> o.name THEN
      PERFORM hospitality._audit(_t, 'policies.updated', p.name,
                                 jsonb_build_object('version', jsonb_build_object('from', o.version, 'to', p.version)));
    END IF;
  END IF;
  RETURN hospitality._policy_json(p);
END $$;
REVOKE ALL ON FUNCTION hospitality.policy_save(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.policy_save(uuid, jsonb, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.policy_set_default(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('policies');
  p hospitality.policies;
BEGIN
  SELECT * INTO p FROM hospitality.policies x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'מדיניות הביטול לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
  IF p.is_archived THEN RAISE EXCEPTION 'המדיניות בארכיון' USING ERRCODE = 'check_violation'; END IF;
  IF NOT p.is_default THEN
    UPDATE hospitality.policies x SET is_default = true WHERE x.tenant_id = _t AND x.id = _id;
    PERFORM hospitality._audit(_t, 'policies.default_set', p.name, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('id', _id);
END $$;
REVOKE ALL ON FUNCTION hospitality.policy_set_default(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.policy_set_default(uuid) TO authenticated, service_role;

-- ארכיון: לא ברירת המחדל; יחידות / כללים שהשתמשו בה עוברים לברירת המחדל. הזמנות שמורות
-- (ה-snapshot שלהן לא משתנה)
CREATE OR REPLACE FUNCTION hospitality.policy_archive(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('policies');
  p hospitality.policies;
  _units integer;
BEGIN
  SELECT * INTO p FROM hospitality.policies x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'מדיניות הביטול לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
  IF p.is_default THEN
    RAISE EXCEPTION 'אי אפשר להעביר לארכיון את ברירת המחדל — קודם בחרו ברירת מחדל אחרת' USING ERRCODE = 'check_violation';
  END IF;
  IF p.is_archived THEN RETURN jsonb_build_object('id', _id, 'units', 0); END IF;
  UPDATE hospitality.units u SET policy_id = NULL, revision = u.revision + 1 WHERE u.tenant_id = _t AND u.policy_id = _id;
  GET DIAGNOSTICS _units = ROW_COUNT;
  UPDATE hospitality.rate_rules r SET policy_id = NULL WHERE r.tenant_id = _t AND r.policy_id = _id;
  UPDATE hospitality.policies x SET is_archived = true WHERE x.tenant_id = _t AND x.id = _id;
  PERFORM hospitality._audit(_t, 'policies.archived', p.name, jsonb_build_object('units', _units));
  RETURN jsonb_build_object('id', _id, 'units', _units);
END $$;
REVOKE ALL ON FUNCTION hospitality.policy_archive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.policy_archive(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.policy_history(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('policies');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.policies x WHERE x.tenant_id = _t AND x.id = _id) THEN
    RAISE EXCEPTION 'מדיניות הביטול לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('version', v.version, 'name', v.name, 'rules', v.rules - 'house_rules',
                                        'saved_at', hospitality._ts(v.changed_at)) ORDER BY v.version DESC)
      FROM hospitality.policy_versions v WHERE v.tenant_id = _t AND v.policy_id = _id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.policy_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.policy_history(uuid) TO authenticated, service_role;

-- דוגמה חיה: אותו לוח זמנים בדיוק כמו בהזמנה (policy_schedule), לכללים שעוד לא נשמרו
CREATE OR REPLACE FUNCTION hospitality.policy_preview(_rules jsonb, _total numeric, _check_in date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid;
  s hospitality.settings;
BEGIN
  IF hospitality.can('policies') THEN _t := hospitality._manage_tenant('policies');
  ELSE _t := hospitality._manage_tenant('pricing'); END IF;
  IF _rules IS NULL OR jsonb_typeof(_rules) <> 'object' OR _total IS NULL OR _total < 0 OR _total > 1000000
     OR _check_in IS NULL THEN
    RAISE EXCEPTION 'פרטי הדוגמה לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  RETURN hospitality._snapshot(NULL, 0, 'דוגמה', _rules, s.timezone, s.check_in_time, s.currency, _check_in, _total)
         - 'policy_id' - 'version' - 'name';
END $$;
REVOKE ALL ON FUNCTION hospitality.policy_preview(jsonb, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.policy_preview(jsonb, numeric, date) TO authenticated, service_role;

-- תצוגת מחיר לצוות (הרשאת pricing): אותו חישוב בדיוק כמו בהזמנה (_quote, בלי כללי האתר הציבורי)
CREATE OR REPLACE FUNCTION hospitality.price_preview(_unit_id uuid, _check_in date, _check_out date,
                                                     _adults integer, _children integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('pricing');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = _unit_id) THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN hospitality._quote(_t, _unit_id, _check_in, _check_out, _adults, _children, NULL, false);
END $$;
REVOKE ALL ON FUNCTION hospitality.price_preview(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.price_preview(uuid, date, date, integer, integer) TO authenticated, service_role;

COMMIT;
