-- ============================================================
-- חלק 30: עמודי תוכן (Pages CMS)
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set AG '''a0000000-0000-0000-0000-0000000000a2'''
\set B1 '''a0000000-0000-0000-0000-0000000000b1'''
CREATE OR REPLACE FUNCTION tests.server(_name TEXT, _sql TEXT, _expect_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE err TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, CASE WHEN _expect_error IS NULL THEN err IS NULL ELSE COALESCE(err ILIKE '%' || _expect_error || '%', false) END,
          COALESCE('ERROR: ' || err, 'ok'));
END; $f$;
-- האתר של חנות A
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
DELETE FROM public.pages WHERE tenant_id IN ('70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000b');

-- ---------- יצירה ע"י מנהל החנות ----------
SELECT tests.run('pages: admin creates a page (tenant from the site)',
  $$INSERT INTO public.pages (slug, title, content_html) VALUES ('shipping-policy', 'מדיניות משלוחים', '<p>עד 3 ימי עסקים</p>')$$, :OA, NULL, 1);
SELECT tests.check('pages: stored for store A, published by default, first in order',
  $$SELECT tenant_id = '70000000-0000-0000-0000-00000000000a' AND is_published AND sort_order = 1
      FROM public.pages WHERE slug = 'shipping-policy'$$);
SELECT tests.run('pages: slug + title cleaned (case, spaces)',
  $$INSERT INTO public.pages (slug, title) VALUES ('  FAQ ', '  שאלות    נפוצות ')$$, :OA, NULL, 1);
SELECT tests.check('pages: slug lower-cased, title single-spaced, next in order',
  $$SELECT slug = 'faq' AND title = 'שאלות נפוצות' AND sort_order = 2 AND content_html = ''
      FROM public.pages WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND slug = 'faq'$$);
SELECT tests.run('pages: draft page',
  $$INSERT INTO public.pages (slug, title, is_published) VALUES ('returns', 'מדיניות החזרות', false)$$, :OA, NULL, 1);

-- ---------- ולידציה ----------
SELECT tests.run('pages: Hebrew slug refused (clear message)',
  $$INSERT INTO public.pages (slug, title) VALUES ('משלוחים', 'משלוחים')$$, :OA, 'אותיות באנגלית קטנות');
SELECT tests.run('pages: slug with spaces / slashes refused',
  $$INSERT INTO public.pages (slug, title) VALUES ('a/b c', 'x')$$, :OA, 'אותיות באנגלית קטנות');
SELECT tests.run('pages: slug with double hyphen refused',
  $$INSERT INTO public.pages (slug, title) VALUES ('a--b', 'x')$$, :OA, 'אותיות באנגלית קטנות');
SELECT tests.run('pages: empty title refused',
  $$INSERT INTO public.pages (slug, title) VALUES ('empty', '   ')$$, :OA, 'כותרת העמוד היא שדה חובה');
SELECT tests.run('pages: duplicate slug in the same store refused (friendly)',
  $$INSERT INTO public.pages (slug, title) VALUES ('Shipping-Policy', 'שוב')$$, :OA, 'כבר יש עמוד עם הכתובת /pages/shipping-policy');
SELECT tests.run('pages: renaming onto an existing slug refused',
  $$UPDATE public.pages SET slug = 'faq' WHERE slug = 'shipping-policy'$$, :OA, 'כבר יש עמוד');
SELECT tests.run('pages: content over 200,000 chars refused',
  $$INSERT INTO public.pages (slug, title, content_html) VALUES ('huge', 'ענק', repeat('א', 200001))$$, :OA, 'ארוך מדי');

-- ---------- הרשאות ----------
SELECT tests.run('pages: agent cannot create', $$INSERT INTO public.pages (slug, title) VALUES ('agent-page', 'x')$$, :AG, 'row-level security');
SELECT tests.run('pages: agent cannot edit', $$UPDATE public.pages SET title = 'x' WHERE slug = 'faq'$$, :AG, NULL, 0);
SELECT tests.run('pages: guest cannot create', $$INSERT INTO public.pages (slug, title) VALUES ('guest-page', 'x')$$, NULL, 'permission denied');
SELECT tests.run('pages: guest sees the published pages only', $$SELECT * FROM public.pages$$, NULL, NULL, 2);
SELECT tests.run('pages: guest cannot read a draft by slug', $$SELECT * FROM public.pages WHERE slug = 'returns'$$, NULL, NULL, 0);
SELECT tests.run('pages: agent sees the published pages only', $$SELECT * FROM public.pages$$, :AG, NULL, 2);
SELECT tests.run('pages: admin sees drafts too', $$SELECT * FROM public.pages$$, :OA, NULL, 3);

-- ---------- עריכה, פרסום, סדר ----------
SELECT tests.run('pages: admin edits + publishes the draft',
  $$UPDATE public.pages SET title = 'מדיניות החזרות והחלפות', is_published = true WHERE slug = 'returns'$$, :OA, NULL, 1);
SELECT tests.check('pages: updated_at moves, created_at kept',
  $$SELECT updated_at >= created_at AND title = 'מדיניות החזרות והחלפות' AND is_published FROM public.pages WHERE slug = 'returns'$$);
SELECT tests.run('pages: guest now sees 3', $$SELECT * FROM public.pages$$, NULL, NULL, 3);
SELECT tests.run('pages: admin reorders', $$UPDATE public.pages SET sort_order = 0 WHERE slug = 'faq'$$, :OA, NULL, 1);
SELECT tests.check('pages: order faq, shipping, returns',
  $$SELECT string_agg(slug, ',' ORDER BY sort_order, created_at) = 'faq,shipping-policy,returns'
      FROM public.pages WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.run('pages: admin unpublishes', $$UPDATE public.pages SET is_published = false WHERE slug = 'faq'$$, :OA, NULL, 1);
SELECT tests.run('pages: guest no longer sees it', $$SELECT * FROM public.pages WHERE slug = 'faq'$$, NULL, NULL, 0);

-- ---------- הפרדה בין חנויות ----------
SELECT tests.run('pages: admin of store B cannot touch store A (site of A)',
  $$UPDATE public.pages SET title = 'פרצה' WHERE slug = 'shipping-policy'$$, :B1, NULL, 0);
SELECT tests.run('pages: admin of store B cannot insert into store A',
  $$INSERT INTO public.pages (tenant_id, slug, title) VALUES ('70000000-0000-0000-0000-00000000000a', 'b-in-a', 'x')$$, :B1, 'row-level security');
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
SELECT tests.run('pages: store B site — guest sees none of A', $$SELECT * FROM public.pages$$, NULL, NULL, 0);
SELECT tests.run('pages: same slug allowed in another store',
  $$INSERT INTO public.pages (slug, title) VALUES ('shipping-policy', 'משלוחים בחנות B')$$, :B1, NULL, 1);
SELECT tests.run('pages: store B guest sees its own page', $$SELECT * FROM public.pages WHERE slug = 'shipping-policy'$$, NULL, NULL, 1);
SELECT tests.check('pages: B''s page belongs to B, first in B''s order',
  $$SELECT tenant_id = '70000000-0000-0000-0000-00000000000b' AND sort_order = 1 FROM public.pages
     WHERE slug = 'shipping-policy' AND title = 'משלוחים בחנות B'$$);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);

-- ---------- מחיקה + מגבלת 50 ----------
SELECT tests.run('pages: agent cannot delete', $$DELETE FROM public.pages WHERE slug = 'returns'$$, :AG, NULL, 0);
SELECT tests.run('pages: admin deletes', $$DELETE FROM public.pages WHERE slug = 'returns'$$, :OA, NULL, 1);
SELECT tests.server('pages: fill store A up to 50',
  $$INSERT INTO public.pages (tenant_id, slug, title)
    SELECT '70000000-0000-0000-0000-00000000000a', 'bulk-' || g, 'עמוד ' || g FROM generate_series(1, 48) g$$);
SELECT tests.server('pages: the 51st page refused',
  $$INSERT INTO public.pages (tenant_id, slug, title) VALUES ('70000000-0000-0000-0000-00000000000a', 'one-too-many', 'x')$$, 'עד 50 עמודי תוכן');
SELECT tests.check('pages: store A has exactly 50',
  $$SELECT count(*) = 50 FROM public.pages WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('pages: removed with the store (ON DELETE CASCADE)',
  $$SELECT confdeltype = 'c' FROM pg_constraint WHERE conrelid = 'public.pages'::regclass AND contype = 'f'$$);
DELETE FROM public.pages WHERE tenant_id IN ('70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000b');
