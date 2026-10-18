-- ============================================================
-- חלק 42: תיק לקוח מרכזי — הסכם בעל חנות, מסמכים, יומנים; פרטיות והרשאות
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set OB '''a0000000-0000-0000-0000-0000000000b1'''
\set PA '''a0000000-0000-0000-0000-0000000000f0'''
\set TA '''70000000-0000-0000-0000-00000000000a'''
\set TB '''70000000-0000-0000-0000-00000000000b'''

SELECT tests.check('v1 of the agreement exists and is the only current version',
  $$SELECT (SELECT count(*) FROM public.platform_agreement_versions WHERE is_current) = 1
       AND (SELECT version FROM public.platform_agreement_versions WHERE is_current) = 1$$);

-- 1. הנפקה
SELECT set_config('tests.hash1', encode(sha256(convert_to('tok-one', 'UTF8')), 'hex'), false);
SELECT set_config('tests.r', public.platform_agreement_issue('70000000-0000-0000-0000-00000000000a', 'Owner@Shop.Test', NULL,
            current_setting('tests.hash1'), now() + interval '14 days')::text, false);
SELECT tests.check('issue: a pending acceptance is created for the new owner (email normalized)',
  $$SELECT (current_setting('tests.r')::jsonb ->> 'issued')::boolean
       AND (SELECT status = 'pending' AND owner_email = 'owner@shop.test' AND version = 1
              FROM public.platform_agreement_acceptances WHERE tenant_id = '70000000-0000-0000-0000-00000000000a')$$);
SELECT set_config('tests.hash2', encode(sha256(convert_to('tok-two', 'UTF8')), 'hex'), false);
SELECT set_config('tests.r', public.platform_agreement_issue('70000000-0000-0000-0000-00000000000a', 'owner@shop.test', NULL,
            current_setting('tests.hash2'), now() + interval '14 days')::text, false);
SELECT tests.check('re-issue: a new request was issued',
  $$SELECT (current_setting('tests.r')::jsonb ->> 'issued')::boolean$$);
SELECT tests.check('re-issue: exactly one pending, the old one superseded with no token',
  $$SELECT (SELECT count(*) FROM public.platform_agreement_acceptances WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND status = 'pending') = 1
       AND (SELECT count(*) FROM public.platform_agreement_acceptances WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND status = 'superseded' AND token_hash IS NULL) = 1$$);
SELECT tests.check('old token no longer works (burned when superseded)',
  $$SELECT public.platform_agreement_form(current_setting('tests.hash1')) IS NULL$$);

-- 2. עמוד החתימה מציג את החנות של הטוקן בלבד, עם פרטי החנות בנוסח
SELECT tests.check('form: shows the store name inside the text, not placeholders',
  $$SELECT (f ->> 'status') = 'pending' AND (f ->> 'content') LIKE '%owner@shop.test%'
       AND (f ->> 'content') NOT LIKE '%{{%'
       AND (f ->> 'store_name') = (SELECT name FROM public.tenants WHERE id = '70000000-0000-0000-0000-00000000000a')
     FROM (SELECT public.platform_agreement_form(current_setting('tests.hash2')) f) x$$);
SELECT tests.check('form: unknown token → NULL',
  $$SELECT public.platform_agreement_form('nope') IS NULL$$);

-- 3. חתימה
SELECT tests.run('sign: too-short name is rejected',
  $$SELECT public.platform_agreement_sign(current_setting('tests.hash2'), 'א', '<svg/>', '1.2.3.4', 'UA')$$, NULL, 'permission denied');
SELECT set_config('tests.r', public.platform_agreement_sign(current_setting('tests.hash2'), '  דנה כהן ', '<svg></svg>', '1.2.3.4', 'UA-test')::text, false);
SELECT tests.check('sign: signs once with snapshot, hash, ip, UA; token is burned',
  $$SELECT (current_setting('tests.r')::jsonb ->> 'version')::int = 1
       AND (SELECT status = 'signed' AND signer_name = 'דנה כהן' AND signed_at IS NOT NULL AND token_hash IS NULL
                   AND signer_ip = '1.2.3.4' AND length(content_sha256) = 64
                   AND terms_snapshot LIKE '%owner@shop.test%'
              FROM public.platform_agreement_acceptances WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND status = 'signed')$$);
SELECT tests.check('sign again with the same token fails (token burned)',
  $$SELECT public.platform_agreement_form(current_setting('tests.hash2')) IS NULL$$);
SELECT set_config('tests.r', public.platform_agreement_issue('70000000-0000-0000-0000-00000000000a', 'owner@shop.test', NULL,
            encode(sha256(convert_to('tok-three', 'UTF8')), 'hex'), now() + interval '14 days')::text, false);
SELECT tests.check('issue after signing the current version → not issued again',
  $$SELECT NOT (current_setting('tests.r')::jsonb ->> 'issued')::boolean$$);

-- 4. חתום לא משתנה ולא נמחק (גם כמנהל-על / בעלים / שרת)
SELECT tests.check('signed acceptance cannot be updated',
  $$DO $b$ BEGIN
      UPDATE public.platform_agreement_acceptances SET signer_name = 'אחר' WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND status = 'signed';
      RAISE EXCEPTION 'updated';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END $b$ ; SELECT true$$);
SELECT tests.check('signed acceptance cannot be deleted',
  $$DO $b$ BEGIN
      DELETE FROM public.platform_agreement_acceptances WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND status = 'signed';
      RAISE EXCEPTION 'deleted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END $b$ ; SELECT true$$);

-- 5. גרסה חדשה: הקודמת וחתימות עליה נשמרות
SELECT set_config('tests.r', public.platform_agreement_publish('הסכם שירות — עדכון', repeat('נוסח חדש ', 10), NULL)::text, false);
SELECT tests.check('publish v2: v1 stays (not current), v2 is current, the signature on v1 is intact',
  $$SELECT current_setting('tests.r') = '2'
       AND (SELECT is_current FROM public.platform_agreement_versions WHERE version = 2)
       AND NOT (SELECT is_current FROM public.platform_agreement_versions WHERE version = 1)
       AND (SELECT count(*) FROM public.platform_agreement_acceptances WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND status = 'signed' AND version = 1) = 1$$);
SELECT tests.check('a version text cannot be edited',
  $$DO $b$ BEGIN
      UPDATE public.platform_agreement_versions SET content = repeat('x', 30) WHERE version = 1;
      RAISE EXCEPTION 'edited';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END $b$ ; SELECT true$$);
SELECT set_config('tests.r', public.platform_agreement_issue('70000000-0000-0000-0000-00000000000a', 'owner@shop.test', NULL,
            encode(sha256(convert_to('tok-four', 'UTF8')), 'hex'), now() + interval '14 days')::text, false);
SELECT tests.check('after v2 is current, the owner who signed v1 can be asked to sign v2',
  $$SELECT (current_setting('tests.r')::jsonb ->> 'issued')::boolean$$);

-- 6. תוקף
SELECT tests.check('expired token cannot sign',
  $$SELECT public.platform_agreement_issue('70000000-0000-0000-0000-00000000000b', 'b@shop.test', NULL, encode(sha256(convert_to('tok-exp', 'UTF8')), 'hex'), now() - interval '1 minute') IS NOT NULL$$);
SELECT tests.run('expired token → rejected',
  $$SELECT public.platform_agreement_sign(encode(sha256(convert_to('tok-exp', 'UTF8')), 'hex'), 'דנה כהן', '', '1.1.1.1', 'UA')$$, NULL, 'permission denied');

-- 7. הרשאות: רק מנהל-על קורא; בעלי חנויות ואורחים לא; אף אחד לא כותב ישירות
SELECT tests.run('guest cannot read acceptances', $$SELECT * FROM public.platform_agreement_acceptances$$, NULL, 'permission denied');
SELECT tests.run('store owner A cannot read the signed agreements table', $$SELECT * FROM public.platform_agreement_acceptances$$, :OA, NULL, 0);
SELECT tests.run('store owner B cannot see store A''s signature', $$SELECT 1 WHERE EXISTS (SELECT 1 FROM public.platform_agreement_acceptances WHERE tenant_id = '70000000-0000-0000-0000-00000000000a')$$, :OB, NULL, 0);
SELECT tests.run('platform admin reads the acceptances', $$SELECT 1 WHERE EXISTS (SELECT 1 FROM public.platform_agreement_acceptances WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND status = 'signed')$$, :PA, NULL, 1);
SELECT tests.run('owner cannot sign by calling the function', $$SELECT public.platform_agreement_sign('x', 'דנה כהן', '', '1.1.1.1', 'UA')$$, :OA, 'permission denied');
SELECT tests.run('owner cannot issue agreements', $$SELECT public.platform_agreement_issue('70000000-0000-0000-0000-00000000000a', 'a@b.co', NULL, 'h', now())$$, :OA, 'permission denied');
SELECT tests.run('platform admin cannot write the table directly (server only)', $$INSERT INTO public.platform_documents (tenant_id, kind, title, file_name, mime_type, size_bytes, storage_path) VALUES ('70000000-0000-0000-0000-00000000000a', 'invoice', 'x1', 'a.pdf', 'application/pdf', 10, 'p')$$, :PA, 'permission denied');

-- 8. מסמכים / מיילים / יומן — אילוצים וגישה
INSERT INTO public.platform_documents (tenant_id, kind, title, file_name, mime_type, size_bytes, storage_path)
VALUES ('70000000-0000-0000-0000-00000000000a', 'invoice', 'חשבונית 1001', 'inv-1001.pdf', 'application/pdf', 12345, 'a/inv-1001.pdf');
SELECT tests.run('documents: a non-PDF is rejected', $$DO $b$ BEGIN INSERT INTO public.platform_documents (tenant_id, kind, title, file_name, mime_type, size_bytes, storage_path) VALUES ('70000000-0000-0000-0000-00000000000a','other','xx','a.png','image/png',10,'a/x.png'); EXCEPTION WHEN check_violation THEN NULL; END $b$; SELECT 1$$, NULL, 'permission denied');
SELECT tests.run('documents: platform admin sees them', $$SELECT 1 WHERE EXISTS (SELECT 1 FROM public.platform_documents WHERE title = 'חשבונית 1001')$$, :PA, NULL, 1);
SELECT tests.run('documents: store owner sees none', $$SELECT 1 WHERE EXISTS (SELECT 1 FROM public.platform_documents)$$, :OA, NULL, 0);
INSERT INTO public.platform_audit_log (tenant_id, actor_email, action, details) VALUES ('70000000-0000-0000-0000-00000000000a', 'god@x.co', 'trial_extended', '{"days":10}');
SELECT tests.check('audit log cannot be edited',
  $$DO $b$ BEGIN UPDATE public.platform_audit_log SET action = 'x1'; RAISE EXCEPTION 'edited'; EXCEPTION WHEN insufficient_privilege THEN NULL; END $b$; SELECT true$$);
INSERT INTO public.platform_email_log (tenant_id, to_email, subject, kind, status, provider_message_id)
VALUES ('70000000-0000-0000-0000-00000000000a', 'owner@shop.test', 'הסכם שירות', 'agreement', 'sent', 'msg-1');
SELECT tests.run('email log: platform admin reads', $$SELECT 1 WHERE EXISTS (SELECT 1 FROM public.platform_email_log WHERE provider_message_id = 'msg-1')$$, :PA, NULL, 1);
SELECT tests.run('email log: store owner sees nothing', $$SELECT 1 WHERE EXISTS (SELECT 1 FROM public.platform_email_log)$$, :OA, NULL, 0);
SELECT tests.run('audit log: store owner sees nothing', $$SELECT 1 WHERE EXISTS (SELECT 1 FROM public.platform_audit_log)$$, :OA, NULL, 0);

-- מחיקת חנות לא נחסמת בגלל הסכם חתום, והחתימה נשמרת (מנותקת מהחנות)
INSERT INTO public.tenants (id, slug, name, owner_email) VALUES ('70000000-0000-0000-0000-0000000000dd', 'pf-del', 'חנות למחיקה', 'del@shop.test');
SELECT set_config('tests.r', (public.platform_agreement_issue('70000000-0000-0000-0000-0000000000dd', 'del@shop.test', NULL, 'hash-del-1', now() + interval '1 day'))::text, false);
SELECT public.platform_agreement_sign('hash-del-1', 'מוחק', NULL, '1.1.1.1', 'ua');
SELECT tests.run('platform admin deletes a store that has a signed agreement', $$SELECT public.platform_delete_tenant('70000000-0000-0000-0000-0000000000dd', 'pf-del')$$, :PA, NULL, 1);
SELECT tests.check('deleting a store keeps its signed agreement, detached',
  $$SELECT EXISTS (SELECT 1 FROM public.platform_agreement_acceptances WHERE owner_email = 'del@shop.test' AND status = 'signed' AND tenant_id IS NULL)$$);

-- ניקוי
DELETE FROM public.platform_documents WHERE storage_path = 'a/inv-1001.pdf';
DELETE FROM public.platform_email_log WHERE provider_message_id = 'msg-1';
SET session_replication_role = replica;
DELETE FROM public.platform_audit_log WHERE actor_email = 'god@x.co';
DELETE FROM public.platform_agreement_acceptances WHERE owner_email = 'del@shop.test' OR tenant_id IN ('70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000b');
DELETE FROM public.platform_agreement_versions WHERE version = 2;
UPDATE public.platform_agreement_versions SET is_current = true WHERE version = 1;
SET session_replication_role = origin;
