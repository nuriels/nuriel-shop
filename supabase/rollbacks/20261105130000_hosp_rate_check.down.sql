-- ============================================================
-- Rollback של 20261105130000_hosp_rate_check.sql (מיגרציה 36 — מונה הקצב)
-- rate_check חוזרת לגרסה של מיגרציה 25 — מילה במילה (כל ניסיון נספר בכל הכללים, גם כשנחסם).
-- בלי נתונים: המונים (rate_buckets) נשארים כמו שהם; הטבלה והחתימה לא השתנו.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- מונה הקצב — הגרסה של מיגרציה 25
-- _rules: [{"key": "<hmac>", "limit": 6, "window": 3600}, …] (1–8 כללים)
-- מחזיר: {"allowed": bool, "retry_after": שניות (0 כשמותר), "hits": [מספר הפניות לכל כלל, לפי הסדר שנשלח]}
-- כל ניסיון נספר — גם ניסיון שנחסם (מי שממשיך להציף נשאר חסום עד סוף החלון)
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
  _allowed boolean := true;
  _retry integer := 0;
  _counts integer[] := '{}';
BEGIN
  IF _rules IS NULL OR jsonb_typeof(_rules) <> 'array' OR jsonb_array_length(_rules) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'rate_check: 1 to 8 rules' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  _counts := array_fill(0, ARRAY[jsonb_array_length(_rules)]);
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
    INSERT INTO hospitality.rate_buckets AS b (key, hits, window_ends)
    VALUES (_key, 1, now() + make_interval(secs => _window))
    ON CONFLICT (key) DO UPDATE
      SET hits = CASE WHEN b.window_ends <= now() THEN 1 ELSE LEAST(b.hits + 1, 2000000000) END,
          window_ends = CASE WHEN b.window_ends <= now() THEN EXCLUDED.window_ends ELSE b.window_ends END
    RETURNING b.hits, b.window_ends INTO _hits, _ends;
    _counts[_ord] := _hits;
    IF _hits > _limit THEN
      _allowed := false;
      _retry := GREATEST(_retry, CEIL(EXTRACT(EPOCH FROM _ends - now()))::integer, 1);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('allowed', _allowed, 'retry_after', _retry, 'hits', to_jsonb(_counts));
END $$;
REVOKE ALL ON FUNCTION hospitality.rate_check(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.rate_check(jsonb) TO service_role;

COMMIT;
