-- run(name, sql, uid, expected_error, expected_rows): מריץ כמשתמש מחובר (RLS פעיל)
CREATE SCHEMA IF NOT EXISTS tests;
CREATE TABLE IF NOT EXISTS tests.results (id SERIAL, name TEXT, ok BOOLEAN, detail TEXT);
CREATE OR REPLACE FUNCTION tests.run(
  _name TEXT, _sql TEXT, _uid UUID, _expect_error TEXT DEFAULT NULL, _expect_rows INT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  err TEXT := NULL;
  n INT := NULL;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
    PERFORM set_config('request.jwt.claim.role', CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END, true);
    EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
    EXECUTE _sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  IF _expect_error IS NULL THEN
    INSERT INTO tests.results (name, ok, detail)
    VALUES (_name, err IS NULL AND (_expect_rows IS NULL OR n = _expect_rows),
            COALESCE('ERROR: ' || err, 'rows=' || n));
  ELSE
    INSERT INTO tests.results (name, ok, detail)
    VALUES (_name, err IS NOT NULL AND err ILIKE '%' || _expect_error || '%',
            COALESCE('ERROR: ' || err, 'no error, rows=' || n));
  END IF;
END;
$$;

-- check(name, sql): שאילתה בוליאנית שרצה כמנהל המסד (בלי RLS) — לאימות תוצאה
CREATE OR REPLACE FUNCTION tests.check(_name TEXT, _sql TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v BOOLEAN;
  err TEXT;
BEGIN
  BEGIN
    EXECUTE _sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, COALESCE(v, false), COALESCE('ERROR: ' || err, 'value=' || COALESCE(v::text, 'null')));
END;
$$;
