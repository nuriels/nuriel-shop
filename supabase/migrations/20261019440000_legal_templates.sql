-- ============================================================
-- חלק 37: תקנון ומדיניות פרטיות מלאים לכל חנות — עם משתנים
--
-- דרישת חברות הסליקה (Max / Hyp): לכל חנות תקנון ומדיניות פרטיות מלאים,
-- שמיוחסים לבעל החנות. הנוסח הוא תבנית עם משתנים — {{store_name}},
-- {{store_email}}, {{store_phone}}, {{business_id}} — שהאתר מחליף בכל
-- הצגה בפרטי העסק של אותה חנות (site_settings). כך כל מסמך שייך ל-Tenant
-- שלו, ומתעדכן לבד כשבעל החנות משנה את פרטי העסק.
--
--  1. legal_default_html(key) — התבנית (זהה ל-DEFAULT_TERMS_HTML /
--     DEFAULT_PRIVACY_HTML ב-src/lib/legal-content.ts; בדיקת יחידה משווה).
--  2. legal_fill_default_pages() — חנויות קיימות: תקנון / פרטיות שעדיין ריקים,
--     או שעדיין בנוסח הקצר הקודם (לא נערך) — מקבלים את התבנית המלאה.
--     נוסח שבעל החנות כתב / ערך — לא נוגעים בו.
--  3. טריגר: חנות חדשה (שורת site_settings חדשה) מקבלת את התבנית כבר בהקמה.
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION public.legal_default_html(_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE _key
    WHEN 'terms' THEN $tpl$<h2>תקנון אתר {{store_name}}</h2><p>הנך מתבקש לקרוא תקנון זה במלואו ובעיון, כתנאי מוקדם להתקשרות. החנות משמשת לרכישת מוצרים על ידי בני 18 ומעלה, בעלי דואר אלקטרוני וכתובת בישראל, וכרטיס אשראי תקף. רכישה מהווה הסכמה לתקנון. המחיר כולל מע"מ.</p><p><strong>בעל האתר:</strong> האתר והחנות מופעלים ומנוהלים על ידי {{store_name}} (ח.פ./ע.מ {{business_id}}), האחראי הבלעדי למוצרים, למכירות, לאספקה ולשירות. פלטפורמת המסחר שעליה פועל האתר משמשת ספקית טכנולוגיה בלבד ואינה צד לעסקאות באתר.</p><p><strong>רכישה וביטול:</strong> הרכישה הינה עד גמר המלאי. הלקוח רשאי לבטל את העיסקה בכפוף להוראות חוק הגנת הצרכן (14 יום מקבלת המוצר), בהודעה לכתובת הדוא"ל: {{store_email}}. בגין ביטול ינוכו 5% או 100 ₪ (הנמוך מביניהם). חובת החזרת המוצר חלה על הלקוח (באריזתו המקורית, שלם וללא נזק). הלקוח יחויב בדמי המשלוח אם המוצר כבר נשלח.</p><p><strong>אספקה ומשלוחים:</strong> אספקת המוצר לכתובת הלקוח עד 10 ימי עסקים (א'-ה'), לאחר אישור חברת האשראי. החנות אינה אחראית לאיחור בגין כוח עליון (מלחמה, שביתה, נזקי טבע).</p><p><strong>יצירת קשר:</strong> לבירורים ניתן לפנות טלפונית ל- {{store_phone}} או לדוא"ל {{store_email}}. אחריות ההתקנה חלה על הלקוח. התמונות להמחשה בלבד.</p>$tpl$
    WHEN 'privacy' THEN $tpl$<h2>מדיניות פרטיות - {{store_name}}</h2><p>החברה מכירה בחשיבות השמירה על פרטיות המשתמשים באתר. שימושך וביצוע רכישה מהווים הסכמתך לשימוש במידע שייאסף.</p><p><strong>סליקה ואשראי:</strong> בעל העסק מתחייב כי פרטי האשראי של הלקוח לא יעברו לצד ג', למעט למסוף הסליקה ולחברת האשראי.</p><p><strong>מאגרי מידע:</strong> המידע שיימסר יישמר במאגרי המידע. החברה רשאית לעשות בו שימוש לצורך טיפול בהזמנות ושיפור השירות, וכן לפנות אליך בהצעות שיווקיות (דיוור ישיר). הינך רשאי בכל עת לפנות לשירות הלקוחות ב- {{store_email}} ולבקש הסרה מרשימת התפוצה.</p>$tpl$
  END
$fn$;
GRANT EXECUTE ON FUNCTION public.legal_default_html(text) TO anon, authenticated, service_role;

-- "טביעת אצבע" של נוסח: בלי תגיות HTML ובלי רווחים — כדי לזהות נוסח שלא נערך
-- גם אם העורך שמר אותו בכתיב HTML מעט שונה
CREATE OR REPLACE FUNCTION public.legal_text_fingerprint(_html text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT regexp_replace(
           regexp_replace(replace(coalesce(_html, ''), '&nbsp;', ' '), '<[^>]*>', '', 'g'),
           '\s+', '', 'g')
$fn$;

-- חנויות קיימות → התבנית המלאה (רק ריק / הנוסח הקצר הקודם שלא נערך)
CREATE OR REPLACE FUNCTION public.legal_fill_default_pages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- הנוסחים הקצרים הקודמים (חלק 16א) — כטביעת אצבע
  old_terms CONSTANT text := $old$מבוא:תקנוןזהמהווההסכםמשפטימחייב...תנאירכישה:הרכישהמותרתלבני18ומעלה,בעליכרטיסאשראיישראליתקף.המחיריםכולליםמע"מ.אישורעסקאות:הנהלתהאתרשומרתזכותלאימותטלפוניתוך24שעות.ביטוליםוהחזרות:ביטוליתאפשרתוך14ימיםמקבלתהמוצרכחוק.ינוכודמיביטולבשיעור5%או100₪(הנמוךמביניהם).אספקהומשלוחים:אספקהתבוצעתוך[10]ימיעסקים(א'-ה').איסוףעצמיבתיאוםמראשבין[17:00-23:00].יצירתקשר:טלפון[050-0000000],דוא"ל[example@email.com].$old$;
  old_privacy CONSTANT text := $old$1.עקרונות:מדיניותזומסבירהכיצדנאסףמידעאישי.2.מידענאסף:פרטיזיהוי,מידעטכניופרטיהזמנה.פרטיאשראיאינםנשמרים.3.איסוףושימוש:אוטומטיתאומהלקוח,לצורךהשירותושיפורו.4.צדדיםשלישיים:המידעעשוילעבורלספקישירותולפלטפורמתNuri1.פרטיאשראייועברורקלחברתהסליקה.5.שמירתמידע:שמירהכלעודהמידענחוץ.6.זכויותיך:עיוןומחיקהע"יפנייהלשירותהלקוחות.לאמיועדלקטינים.$old$;
  v_terms integer;
  v_privacy integer;
BEGIN
  UPDATE public.site_settings
     SET terms_content = public.legal_default_html('terms')
   WHERE btrim(coalesce(terms_content, '')) = ''
      OR public.legal_text_fingerprint(terms_content) = old_terms;
  GET DIAGNOSTICS v_terms = ROW_COUNT;
  UPDATE public.site_settings
     SET privacy_content = public.legal_default_html('privacy')
   WHERE btrim(coalesce(privacy_content, '')) = ''
      OR public.legal_text_fingerprint(privacy_content) = old_privacy;
  GET DIAGNOSTICS v_privacy = ROW_COUNT;
  RETURN v_terms + v_privacy;
END
$fn$;
REVOKE ALL ON FUNCTION public.legal_fill_default_pages() FROM PUBLIC, anon, authenticated;

-- חנות חדשה → התבנית כבר בהקמה
CREATE OR REPLACE FUNCTION public.site_settings_legal_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF btrim(coalesce(NEW.terms_content, '')) = '' THEN
    NEW.terms_content := public.legal_default_html('terms');
  END IF;
  IF btrim(coalesce(NEW.privacy_content, '')) = '' THEN
    NEW.privacy_content := public.legal_default_html('privacy');
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS site_settings_legal_defaults ON public.site_settings;
CREATE TRIGGER site_settings_legal_defaults
  BEFORE INSERT ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.site_settings_legal_defaults();

SELECT public.legal_fill_default_pages();

COMMIT;
