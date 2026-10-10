-- ============================================================
-- חלק 37: תקנון ומדיניות פרטיות מלאים לכל חנות (תבנית עם משתנים)
-- ============================================================
\set A '''70000000-0000-0000-0000-00000000000a'''
\set C '''70000000-0000-0000-0000-00000000000c'''

SELECT tests.check('legal: terms template has the store variables',
  $$SELECT position('{{store_name}}' IN public.legal_default_html('terms')) > 0
       AND position('{{store_email}}' IN public.legal_default_html('terms')) > 0
       AND position('{{store_phone}}' IN public.legal_default_html('terms')) > 0$$);
SELECT tests.check('legal: privacy template has store name + email + phone',
  $$SELECT position('{{store_name}}' IN public.legal_default_html('privacy')) > 0
       AND position('{{store_email}}' IN public.legal_default_html('privacy')) > 0
       AND position('{{store_phone}}' IN public.legal_default_html('privacy')) > 0$$);
SELECT tests.check('legal: full text as delivered (part 37b), with section headings',
  $$SELECT position('<h2>תקנון האתר - {{store_name}}</h2>' IN public.legal_default_html('terms')) = 1
       AND position('<h3>ביטול הזמנה</h3>' IN public.legal_default_html('terms')) > 0
       AND position('בין השעות 17:00-23:00' IN public.legal_default_html('terms')) > 0
       AND position('<h3>מסירת מידע לצדדים שלישיים</h3>' IN public.legal_default_html('privacy')) > 0
       AND position('פלטפורמת Nuri1' IN public.legal_default_html('privacy')) > 0$$);

-- חנויות (נוצרו אחרי המיגרציה בהרצה "נקייה", לפניה בהרצה "עם נתונים") — לכולן התבנית
SELECT tests.check('legal: every store has the full terms + privacy (new store trigger / existing-store fill)',
  $$SELECT bool_and(terms_content = public.legal_default_html('terms')
                    AND privacy_content = public.legal_default_html('privacy'))
     FROM public.site_settings WHERE tenant_id IN ('70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000c')$$);

-- נוסח שבעל החנות כתב — נשמר; הנוסח הקצר הקודם (לא נערך) — מוחלף; ריק — מתמלא
UPDATE public.site_settings SET terms_content = '<p>התקנון שלי — נכתב ע"י בעל החנות</p>',
  privacy_content = '<p><strong>1. עקרונות:</strong>  מדיניות זו מסבירה כיצד נאסף מידע אישי.</p><p><strong>2. מידע נאסף:</strong> פרטי זיהוי, מידע טכני ופרטי הזמנה. פרטי אשראי אינם נשמרים.</p><p><strong>3. איסוף ושימוש:</strong> אוטומטית או מהלקוח, לצורך השירות ושיפורו.</p><p><strong>4. צדדים שלישיים:</strong> המידע עשוי לעבור לספקי שירות ולפלטפורמת Nuri1. פרטי אשראי יועברו רק לחברת הסליקה.</p><p><strong>5. שמירת מידע:</strong> שמירה כל עוד המידע נחוץ.</p><p><strong>6. זכויותיך:</strong>&nbsp;עיון ומחיקה ע"י פנייה לשירות הלקוחות. לא מיועד לקטינים.</p>'
 WHERE tenant_id = :A;
UPDATE public.site_settings SET terms_content = $p37$<h2>תקנון אתר {{store_name}}</h2><p>הנך מתבקש לקרוא תקנון זה במלואו ובעיון, כתנאי מוקדם להתקשרות. החנות משמשת לרכישת מוצרים על ידי בני 18 ומעלה, בעלי דואר אלקטרוני וכתובת בישראל, וכרטיס אשראי תקף. רכישה מהווה הסכמה לתקנון. המחיר כולל מע"מ.</p>
<p><strong>בעל האתר:</strong> האתר והחנות מופעלים ומנוהלים על ידי {{store_name}} (ח.פ./ע.מ {{business_id}}), האחראי הבלעדי למוצרים, למכירות, לאספקה ולשירות. פלטפורמת המסחר שעליה פועל האתר משמשת ספקית טכנולוגיה בלבד ואינה צד לעסקאות באתר.</p>
<p><strong>רכישה וביטול:</strong> הרכישה הינה עד גמר המלאי. הלקוח רשאי לבטל את העיסקה בכפוף להוראות חוק הגנת הצרכן (14 יום מקבלת המוצר), בהודעה לכתובת הדוא"ל: {{store_email}}. בגין ביטול ינוכו 5% או 100 ₪ (הנמוך מביניהם). חובת החזרת המוצר חלה על הלקוח (באריזתו המקורית, שלם וללא נזק). הלקוח יחויב בדמי המשלוח אם המוצר כבר נשלח.</p>
<p><strong>אספקה ומשלוחים:</strong> אספקת המוצר לכתובת הלקוח עד 10 ימי עסקים (א'-ה'), לאחר אישור חברת האשראי. החנות אינה אחראית לאיחור בגין כוח עליון (מלחמה, שביתה, נזקי טבע).</p>
<p><strong>יצירת קשר:</strong> לבירורים ניתן לפנות טלפונית ל- {{store_phone}} או לדוא"ל {{store_email}}. אחריות ההתקנה חלה על הלקוח. התמונות להמחשה בלבד.</p>$p37$, privacy_content = '' WHERE tenant_id = :C;
SELECT public.legal_fill_default_pages();
SELECT tests.check('legal: owner-written terms are kept',
  $$SELECT terms_content = '<p>התקנון שלי — נכתב ע"י בעל החנות</p>' FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('legal: old short privacy (unedited, different HTML spacing) → full template',
  $$SELECT privacy_content = public.legal_default_html('privacy') FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('legal: part-37 template (unedited) / emptied page → new full template',
  $$SELECT terms_content = public.legal_default_html('terms') AND privacy_content = public.legal_default_html('privacy')
     FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000c'$$);
SELECT tests.check('legal: fill is idempotent (second run changes nothing)',
  $$SELECT public.legal_fill_default_pages() = 0$$);
SELECT tests.check('legal: store owners / customers cannot run the bulk fill',
  $$SELECT NOT has_function_privilege('authenticated', 'public.legal_fill_default_pages()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.legal_fill_default_pages()', 'EXECUTE')$$);

-- ניקוי: החזרת חנות A לתבנית
UPDATE public.site_settings SET terms_content = public.legal_default_html('terms') WHERE tenant_id = :A;
