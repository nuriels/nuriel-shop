-- ============================================================
-- Hospitality — מיגרציה 25: אבטחה לפני פתיחת האתר לציבור (שלב D1)
--
--   • rate_buckets — מונים משותפים לכל שרתי האפליקציה: הגבלת קצב, ואסימוני אימות (CAPTCHA)
--     שכבר נוצלו. המפתח הוא HMAC שמחושב בשרת האפליקציה — במסד אין כתובות IP, טוקנים או
--     פרטי קשר גלויים. UNLOGGED: מונים זמניים (בלי WAL; אחרי קריסה של המסד הם מתאפסים —
--     בדיוק כמו הגבלה בזיכרון, אבל משותפים לכל השרתים).
--   • rate_check(_rules) — ספירה ובדיקה אטומית של עד 8 כללים בקריאה אחת (חלון קבוע לכל כלל).
--     הנעילות לפי סדר המפתחות — בלי deadlock בין בקשות מקבילות. שירות בלבד.
--   • rate_sweep() — ניקוי מונים שפג תוקפם (תהליך הרקע, כל 10 דקות). שירות בלבד.
--   • request_booking / request_booking_type — רק לשרת האפליקציה (service_role). עד עכשיו אפשר
--     היה לקרוא להן ישירות דרך ה-REST הציבורי של Supabase (המפתח הציבורי / חשבון שנרשם),
--     וכך לעקוף את האימות נגד בוטים ואת הגבלת הקצב של האתר. הבקשה של האורח עוברת עכשיו
--     רק דרך השרת: אימות (CAPTCHA) → הגבלת קצב משותפת → המסד. שיוך הזמנה לחשבון של אורח
--     מחובר — דרך claim_guest_bookings (אימייל מאומת), כמו שהיה להזמנות קודמות.
-- ============================================================

-- ------------------------------------------------------------
-- 1. מונים משותפים
-- ------------------------------------------------------------
CREATE UNLOGGED TABLE IF NOT EXISTS hospitality.rate_buckets (
  key text PRIMARY KEY CHECK (key ~ '^[A-Za-z0-9_-]{16,64}$'),
  hits integer NOT NULL CHECK (hits >= 1),
  window_ends timestamptz NOT NULL
);
COMMENT ON TABLE hospitality.rate_buckets IS
  'Shared rate-limit counters (all app servers). key = HMAC computed by the app — no raw IPs, tokens or contact details.';
CREATE INDEX IF NOT EXISTS rate_buckets_window_idx ON hospitality.rate_buckets (window_ends);
ALTER TABLE hospitality.rate_buckets ENABLE ROW LEVEL SECURITY;
-- בלי שום גישה מה-API (גם לא service_role ישירות) — רק דרך הפונקציות
REVOKE ALL ON hospitality.rate_buckets FROM PUBLIC, anon, authenticated, service_role;

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

CREATE OR REPLACE FUNCTION hospitality.rate_sweep()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH gone AS (
    DELETE FROM hospitality.rate_buckets WHERE window_ends < now() - interval '1 minute' RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;
REVOKE ALL ON FUNCTION hospitality.rate_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.rate_sweep() TO service_role;

-- ------------------------------------------------------------
-- 2. בקשת הזמנה מהאתר — רק דרך שרת האפליקציה
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION hospitality.request_booking(uuid, date, date, text, text, text, text, boolean, text,
  integer, integer, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking(uuid, date, date, text, text, text, text, boolean, text,
  integer, integer, text, text, boolean, text) TO service_role;
REVOKE EXECUTE ON FUNCTION hospitality.request_booking_type(uuid, date, date, text, text, text, text, boolean, text,
  integer, integer, text, text, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_type(uuid, date, date, text, text, text, text, boolean, text,
  integer, integer, text, text, boolean, text, uuid) TO service_role;
-- הצעת המחיר לסוג חדר — גם לשרת (כמו quote)
GRANT EXECUTE ON FUNCTION hospitality.quote_type(uuid, date, date, integer, integer, text, uuid) TO service_role;
