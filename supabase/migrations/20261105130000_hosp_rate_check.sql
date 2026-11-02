-- ============================================================
-- Hospitality — מיגרציה 36: מונה הקצב המשותף לא "שורף" מכסות על ניסיון שנחסם
--
-- הבעיה (rate_check, מיגרציה 25): כל קריאה ספרה +1 בכל הכללים שנשלחו — גם כשכלל אחד כבר חסם את
-- הניסיון. כך כתובת אחת שמציפה (וחסומה בכלל של הכתובת) המשיכה לצרוך את המכסה של העסק כולו, של
-- הרשת (/24) או של המשתמש — ואחרי מספר ניסיונות חסמה גם את כל השאר (למשל: בקשות הזמנה לעסק, או
-- פניות תמיכה). ובאסימון חד-פעמי (CAPTCHA) — ניסיון שנחסם בכלל אחר "שרף" גם את האסימון.
--
-- עכשיו, באותה קריאה אחת ובאותה חתימה:
--   1. בדיקת הכללים ונעילה של המונה של כל כלל (נעילת advisory לטרנזקציה, לפי סדר המפתחות — בלי
--      deadlock בין קריאות מקבילות). הנעילה מחזיקה עד סוף הטרנזקציה, כך שקריאה מקבילה עם מפתח
--      משותף מחכה ואז רואה את התוצאה של הקודמת — גם כשהמונה עוד לא קיים (בלי "שני ראשונים").
--   2. בדיקה בלי ספירה: האם הניסיון עובר את כל הכללים (הספירה הנוכחית בחלון + 1 ≤ המגבלה).
--   3. עובר → נספר בכל הכללים (כמו קודם). נחסם → לא נספר באף כלל.
--
-- נשאר כמו שהיה: החלון הקבוע לכל כלל, המגבלות (המכסות העסקיות לא השתנו), המפתחות (HMAC), עד 8
-- כללים, "retry_after", וההרשאות (שירות בלבד). "hits" מחזיר לכל כלל את מספר הניסיון — גם כשנחסם
-- (למשל 2 לאסימון חד-פעמי שכבר נוצל), כך שהשרת ממשיך להבחין בין "האסימון נוצל" ל"יותר מדי בקשות".
-- מי שממשיך להציף נשאר חסום עד סוף החלון — החלון קבוע, וניסיונות חסומים לא האריכו אותו גם קודם.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105130000_hosp_rate_check.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- _rules: [{"key": "<hmac>", "limit": 6, "window": 3600}, …] (1–8 כללים)
-- מחזיר: {"allowed": bool, "retry_after": שניות (0 כשמותר), "hits": [מספר הניסיון לכל כלל, לפי הסדר שנשלח]}
CREATE OR REPLACE FUNCTION hospitality.rate_check(_rules jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _rule jsonb;
  _ord integer;
  _key text;
  _limit integer;
  _window integer;
  _hits integer;
  _ends timestamptz;
  _attempt integer;
  _pending jsonb := '{}';
  _allowed boolean := true;
  _retry integer := 0;
  _counts integer[] := '{}';
BEGIN
  IF _rules IS NULL OR jsonb_typeof(_rules) <> 'array' OR jsonb_array_length(_rules) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'rate_check: 1 to 8 rules' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  _counts := array_fill(0, ARRAY[jsonb_array_length(_rules)]);

  -- 1. בדיקת הכללים ונעילת המונים (לפי סדר המפתחות)
  FOR _rule, _ord IN
    SELECT r.value, r.ord::integer FROM jsonb_array_elements(_rules) WITH ORDINALITY AS r(value, ord)
     ORDER BY r.value ->> 'key', r.ord
  LOOP
    _key := _rule ->> 'key';
    _limit := CASE WHEN (_rule ->> 'limit') ~ '^\d{1,7}$' THEN (_rule ->> 'limit')::integer END;
    _window := CASE WHEN (_rule ->> 'window') ~ '^\d{1,5}$' THEN (_rule ->> 'window')::integer END;
    IF _key IS NULL OR _key !~ '^[A-Za-z0-9_-]{16,64}$'
       OR _limit IS NULL OR _limit < 1 OR _window IS NULL OR _window NOT BETWEEN 1 AND 86400 THEN
      RAISE EXCEPTION 'rate_check: invalid rule %', _ord USING ERRCODE = 'invalid_parameter_value';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('hosp-rate:' || _key, 0));
  END LOOP;

  -- 2. האם הניסיון עובר את כל הכללים — בלי לספור (מפתח שמופיע פעמיים נספר פעמיים, כמו קודם)
  FOR _rule, _ord IN
    SELECT r.value, r.ord::integer FROM jsonb_array_elements(_rules) WITH ORDINALITY AS r(value, ord)
     ORDER BY r.value ->> 'key', r.ord
  LOOP
    _key := _rule ->> 'key';
    _limit := (_rule ->> 'limit')::integer;
    _window := (_rule ->> 'window')::integer;
    SELECT b.hits, b.window_ends INTO _hits, _ends FROM hospitality.rate_buckets b WHERE b.key = _key;
    IF NOT FOUND OR _ends <= now() THEN
      _hits := 0;
      _ends := now() + make_interval(secs => _window);
    END IF;
    _attempt := LEAST(_hits + COALESCE((_pending ->> _key)::integer, 0) + 1, 2000000000);
    _pending := jsonb_set(_pending, ARRAY[_key], to_jsonb(COALESCE((_pending ->> _key)::integer, 0) + 1));
    _counts[_ord] := _attempt;
    IF _attempt > _limit THEN
      _allowed := false;
      _retry := GREATEST(_retry, CEIL(EXTRACT(EPOCH FROM _ends - now()))::integer, 1);
    END IF;
  END LOOP;

  -- 3. נחסם → שום כלל לא נספר. עובר → נספר בכל הכללים
  IF _allowed THEN
    FOR _rule, _ord IN
      SELECT r.value, r.ord::integer FROM jsonb_array_elements(_rules) WITH ORDINALITY AS r(value, ord)
       ORDER BY r.value ->> 'key', r.ord
    LOOP
      _key := _rule ->> 'key';
      _window := (_rule ->> 'window')::integer;
      INSERT INTO hospitality.rate_buckets AS b (key, hits, window_ends)
      VALUES (_key, 1, now() + make_interval(secs => _window))
      ON CONFLICT (key) DO UPDATE
        SET hits = CASE WHEN b.window_ends <= now() THEN 1 ELSE LEAST(b.hits + 1, 2000000000) END,
            window_ends = CASE WHEN b.window_ends <= now() THEN EXCLUDED.window_ends ELSE b.window_ends END
      RETURNING b.hits INTO _hits;
      _counts[_ord] := _hits;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('allowed', _allowed, 'retry_after', _retry, 'hits', to_jsonb(_counts));
END $$;
REVOKE ALL ON FUNCTION hospitality.rate_check(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.rate_check(jsonb) TO service_role;

COMMIT;
