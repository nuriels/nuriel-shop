-- אימות Google Search Console: פורמט מוקפד, ולכל חנות ערכים משלה
UPDATE public.site_settings SET google_site_verification = 'RE1mRQ-xbtZt0I8Cabc_defGHI123', google_verification_file = 'google6900fd33bb82a196.html'
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
SELECT tests.check('gsc: a valid meta value and file name are saved for store A',
  $$SELECT google_verification_file = 'google6900fd33bb82a196.html' FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('gsc: store B is not affected (each store has its own)',
  $$SELECT google_verification_file IS NULL AND google_site_verification IS NULL FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
DO $t$
DECLARE e1 text; e2 text;
BEGIN
  BEGIN UPDATE public.site_settings SET google_site_verification = '"><script>alert(1)</script>' WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
  EXCEPTION WHEN OTHERS THEN e1 := SQLERRM; END;
  BEGIN UPDATE public.site_settings SET google_verification_file = '../etc/passwd.html' WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
  EXCEPTION WHEN OTHERS THEN e2 := SQLERRM; END;
  INSERT INTO tests.results (name, ok, detail) VALUES
    ('gsc: a meta value with markup is rejected', e1 ILIKE '%google_verification_check%', COALESCE(e1, 'no error')),
    ('gsc: a file name that is not googleXXXX.html is rejected', e2 ILIKE '%google_verification_check%', COALESCE(e2, 'no error'));
END $t$;
UPDATE public.site_settings SET google_site_verification = NULL, google_verification_file = NULL WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
