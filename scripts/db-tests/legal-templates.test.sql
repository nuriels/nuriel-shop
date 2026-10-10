-- ============================================================
-- חלק 37: תקנון ומדיניות פרטיות מלאים לכל חנות (תבנית עם משתנים)
-- ============================================================
\set A '''70000000-0000-0000-0000-00000000000a'''
\set C '''70000000-0000-0000-0000-00000000000c'''

SELECT tests.check('legal: terms template has the store variables',
  $$SELECT position('{{store_name}}' IN public.legal_default_html('terms')) > 0
       AND position('{{store_email}}' IN public.legal_default_html('terms')) > 0
       AND position('{{store_phone}}' IN public.legal_default_html('terms')) > 0
       AND position('{{business_id}}' IN public.legal_default_html('terms')) > 0$$);
SELECT tests.check('legal: privacy template has store name + email',
  $$SELECT position('{{store_name}}' IN public.legal_default_html('privacy')) > 0
       AND position('{{store_email}}' IN public.legal_default_html('privacy')) > 0$$);
SELECT tests.check('legal: full text (not the short summary)',
  $$SELECT position('חוק הגנת הצרכן' IN public.legal_default_html('terms')) > 0
       AND position('כוח עליון' IN public.legal_default_html('terms')) > 0
       AND position('דיוור ישיר' IN public.legal_default_html('privacy')) > 0$$);

-- חנויות (נוצרו אחרי המיגרציה בהרצה "נקייה", לפניה בהרצה "עם נתונים") — לכולן התבנית
SELECT tests.check('legal: every store has the full terms + privacy (new store trigger / existing-store fill)',
  $$SELECT bool_and(terms_content = public.legal_default_html('terms')
                    AND privacy_content = public.legal_default_html('privacy'))
     FROM public.site_settings WHERE tenant_id IN ('70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000c')$$);

-- נוסח שבעל החנות כתב — נשמר; הנוסח הקצר הקודם (לא נערך) — מוחלף; ריק — מתמלא
UPDATE public.site_settings SET terms_content = '<p>התקנון שלי — נכתב ע"י בעל החנות</p>',
  privacy_content = '<p><strong>1. עקרונות:</strong>  מדיניות זו מסבירה כיצד נאסף מידע אישי.</p><p><strong>2. מידע נאסף:</strong> פרטי זיהוי, מידע טכני ופרטי הזמנה. פרטי אשראי אינם נשמרים.</p><p><strong>3. איסוף ושימוש:</strong> אוטומטית או מהלקוח, לצורך השירות ושיפורו.</p><p><strong>4. צדדים שלישיים:</strong> המידע עשוי לעבור לספקי שירות ולפלטפורמת Nuri1. פרטי אשראי יועברו רק לחברת הסליקה.</p><p><strong>5. שמירת מידע:</strong> שמירה כל עוד המידע נחוץ.</p><p><strong>6. זכויותיך:</strong>&nbsp;עיון ומחיקה ע"י פנייה לשירות הלקוחות. לא מיועד לקטינים.</p>'
 WHERE tenant_id = :A;
UPDATE public.site_settings SET terms_content = '', privacy_content = '' WHERE tenant_id = :C;
SELECT public.legal_fill_default_pages();
SELECT tests.check('legal: owner-written terms are kept',
  $$SELECT terms_content = '<p>התקנון שלי — נכתב ע"י בעל החנות</p>' FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('legal: old short privacy (unedited, different HTML spacing) → full template',
  $$SELECT privacy_content = public.legal_default_html('privacy') FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('legal: emptied pages → full template',
  $$SELECT terms_content = public.legal_default_html('terms') AND privacy_content = public.legal_default_html('privacy')
     FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000c'$$);
SELECT tests.check('legal: fill is idempotent (second run changes nothing)',
  $$SELECT public.legal_fill_default_pages() = 0$$);
SELECT tests.check('legal: store owners / customers cannot run the bulk fill',
  $$SELECT NOT has_function_privilege('authenticated', 'public.legal_fill_default_pages()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.legal_fill_default_pages()', 'EXECUTE')$$);

-- ניקוי: החזרת חנות A לתבנית
UPDATE public.site_settings SET terms_content = public.legal_default_html('terms') WHERE tenant_id = :A;
