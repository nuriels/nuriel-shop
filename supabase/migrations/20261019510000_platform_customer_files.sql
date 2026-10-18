-- ============================================================
-- חלק 42: תיק לקוח מרכזי בסופר-אדמין (בעלי חנויות מול מפעיל הפלטפורמה)
--
-- חדש (הטבלאות הקיימות service_agreements / customer_emails הן ברמת חנות-ללקוח
-- ולא משתנות):
--   platform_agreement_versions    — נוסחי הסכם השירות, גרסאות (נוסף בלבד, לא נדרס)
--   platform_agreement_acceptances — חתימת בעל החנות על גרסה: מי, מתי, מה ראה, IP
--   platform_documents             — מסמכים בתיק (חשבונית / קבלה / אחר), קבצי PDF בדלי פרטי
--   platform_email_log             — מיילים שהפלטפורמה שלחה לבעל החנות (בלי תוכן)
--   platform_audit_log             — פעולות מנהל-על (בלי סודות)
--   דלי פרטי platform-documents    — רק service_role (קישורים זמניים חתומים)
--
-- הרשאות: הכל פרטי ברמת הפלטפורמה. קריאה — מנהל-על בלבד (RLS); כתיבה — רק השרת
-- (service_role). חתימות שנחתמו והיומנים לא ניתנים לעדכון או מחיקה (טריגר).
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ---------- 1. גרסאות ההסכם ----------
CREATE TABLE IF NOT EXISTS public.platform_agreement_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version     integer NOT NULL UNIQUE CHECK (version >= 1),
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  content     text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 20 AND 60000),
  is_current  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- גרסה נוכחית אחת בלבד
CREATE UNIQUE INDEX IF NOT EXISTS platform_agreement_versions_current_idx
  ON public.platform_agreement_versions ((true)) WHERE is_current;

-- ---------- 2. חתימות ----------
CREATE TABLE IF NOT EXISTS public.platform_agreement_acceptances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- חתימה שנחתמה נשמרת גם אחרי מחיקת החנות (tenant_id הופך NULL; owner_email והנוסח נשארים)
  tenant_id        uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  owner_email      text NOT NULL CHECK (char_length(owner_email) BETWEEN 3 AND 254),
  owner_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  version_id       uuid NOT NULL REFERENCES public.platform_agreement_versions(id),
  version          integer NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'signed', 'superseded', 'expired')),
  token_hash       text UNIQUE,
  token_expires_at timestamptz,
  sent_at          timestamptz,
  signed_at        timestamptz,
  signer_name      text CHECK (signer_name IS NULL OR char_length(signer_name) BETWEEN 2 AND 160),
  signature_svg    text CHECK (signature_svg IS NULL OR char_length(signature_svg) <= 120000),
  terms_snapshot   text,
  content_sha256   text,
  signer_ip        text,
  signer_user_agent text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_acceptance_signed_check CHECK (
    status <> 'signed' OR (signed_at IS NOT NULL AND signer_name IS NOT NULL AND terms_snapshot IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS platform_acceptances_tenant_idx
  ON public.platform_agreement_acceptances (tenant_id, created_at DESC);

-- ---------- 3. מסמכים ----------
CREATE TABLE IF NOT EXISTS public.platform_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('invoice', 'receipt', 'agreement', 'other')),
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  file_name       text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  mime_type       text NOT NULL CHECK (mime_type = 'application/pdf'),
  size_bytes      integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  storage_path    text NOT NULL UNIQUE,
  doc_date        date,
  note            text CHECK (note IS NULL OR char_length(note) <= 500),
  billing_id      uuid REFERENCES public.billing_history(id) ON DELETE SET NULL,
  acceptance_id   uuid REFERENCES public.platform_agreement_acceptances(id) ON DELETE SET NULL,
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_archived     boolean NOT NULL DEFAULT false,
  uploaded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_email text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_documents_tenant_idx
  ON public.platform_documents (tenant_id, created_at DESC);

-- ---------- 4. יומן מיילים של הפלטפורמה ----------
CREATE TABLE IF NOT EXISTS public.platform_email_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  to_email            text NOT NULL CHECK (char_length(to_email) <= 1000),
  subject             text NOT NULL CHECK (char_length(subject) <= 300),
  kind                text NOT NULL CHECK (char_length(kind) BETWEEN 2 AND 40),
  status              text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  provider_message_id text CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  error               text CHECK (error IS NULL OR char_length(error) <= 500),
  acceptance_id       uuid REFERENCES public.platform_agreement_acceptances(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_email_log_tenant_idx
  ON public.platform_email_log (tenant_id, created_at DESC);

-- ---------- 5. יומן פעולות ----------
CREATE TABLE IF NOT EXISTS public.platform_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id    uuid,
  actor_email text,
  action      text NOT NULL CHECK (char_length(action) BETWEEN 2 AND 60),
  details     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(details) <= 4096),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_audit_log_tenant_idx
  ON public.platform_audit_log (tenant_id, created_at DESC);

-- ---------- 6. הרשאות: קריאה — מנהל-על; כתיבה — השרת ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_agreement_versions', 'platform_agreement_acceptances',
    'platform_documents', 'platform_email_log', 'platform_audit_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "platform admin reads" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "platform admin reads" ON public.%I
                      FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()))$p$, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------- 7. חתימות והיומנים אינם ניתנים לדריסה או מחיקה ----------
CREATE OR REPLACE FUNCTION public.platform_files_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'platform_agreement_versions' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'גרסת הסכם לא נמחקת' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- מותר רק להחליף את הסימון "הנוכחית"; הנוסח והכותרת קבועים
    IF NEW.version IS DISTINCT FROM OLD.version OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.title IS DISTINCT FROM OLD.title THEN
      RAISE EXCEPTION 'נוסח של גרסת הסכם לא משתנה — מפרסמים גרסה חדשה' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'platform_agreement_acceptances' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.status = 'signed' THEN
        RAISE EXCEPTION 'הסכם חתום לא נמחק' USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN OLD;
    END IF;
    IF OLD.status = 'signed' THEN
      -- היחיד שמותר: ניתוק מהחנות כשהיא נמחקת (ON DELETE SET NULL)
      IF NEW.tenant_id IS NULL AND (to_jsonb(NEW) - 'tenant_id') = (to_jsonb(OLD) - 'tenant_id') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'הסכם חתום לא משתנה' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'היומן הוא לקריאה בלבד' USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

DROP TRIGGER IF EXISTS platform_agreement_versions_immutable ON public.platform_agreement_versions;
CREATE TRIGGER platform_agreement_versions_immutable
  BEFORE UPDATE OR DELETE ON public.platform_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION public.platform_files_immutable();
DROP TRIGGER IF EXISTS platform_acceptances_immutable ON public.platform_agreement_acceptances;
CREATE TRIGGER platform_acceptances_immutable
  BEFORE UPDATE OR DELETE ON public.platform_agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.platform_files_immutable();
-- יומני מיילים ופעולות: נוסף בלבד (מחיקה רק בהסרת החנות עצמה — cascade)
DROP TRIGGER IF EXISTS platform_audit_immutable ON public.platform_audit_log;
CREATE TRIGGER platform_audit_immutable
  BEFORE UPDATE ON public.platform_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.platform_files_immutable();

-- ---------- 8. פונקציות (service_role בלבד) ----------
-- הנוסח הנוכחי: {{store_name}} / {{owner_email}} מוחלפים בפרטי החנות בפועל
CREATE OR REPLACE FUNCTION public.platform_agreement_render(_content text, _tenant uuid, _email text)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT replace(replace(_content, '{{store_name}}',
           COALESCE((SELECT t.name FROM public.tenants t WHERE t.id = _tenant), '')),
         '{{owner_email}}', COALESCE(_email, ''));
$$;

-- פותח בקשת חתימה ממתינה לבעל החנות (הקודמת שעוד ממתינה — מוחלפת). לא נשלח
-- אם כבר נחתמה הגרסה הנוכחית. מחזיר את מזהה הבקשה, או NULL אם כבר חתום.
CREATE OR REPLACE FUNCTION public.platform_agreement_issue(
  _tenant uuid, _email text, _user uuid, _token_hash text, _expires timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.platform_agreement_versions;
  _id uuid;
BEGIN
  SELECT * INTO v FROM public.platform_agreement_versions WHERE is_current;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'לא הוגדרה גרסה נוכחית של ההסכם';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant) THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_agreement_acceptances
              WHERE tenant_id = _tenant AND version_id = v.id AND status = 'signed') THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'already_signed', 'version', v.version);
  END IF;
  UPDATE public.platform_agreement_acceptances
     SET status = 'superseded', token_hash = NULL
   WHERE tenant_id = _tenant AND status = 'pending';
  INSERT INTO public.platform_agreement_acceptances
         (tenant_id, owner_email, owner_user_id, version_id, version, token_hash, token_expires_at, sent_at)
  VALUES (_tenant, lower(btrim(_email)), _user, v.id, v.version, _token_hash, _expires, now())
  RETURNING id INTO _id;
  RETURN jsonb_build_object('issued', true, 'id', _id, 'version', v.version);
END $$;

-- מה מוצג בעמוד החתימה (לפי טוקן). בלי מידע על חנויות אחרות.
CREATE OR REPLACE FUNCTION public.platform_agreement_form(_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.platform_agreement_acceptances;
  v public.platform_agreement_versions;
BEGIN
  SELECT * INTO a FROM public.platform_agreement_acceptances WHERE token_hash = _token_hash;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v FROM public.platform_agreement_versions WHERE id = a.version_id;
  RETURN jsonb_build_object(
    'status', CASE WHEN a.status = 'pending' AND a.token_expires_at < now() THEN 'expired' ELSE a.status END,
    'version', a.version,
    'title', v.title,
    'content', CASE WHEN a.status = 'signed' THEN a.terms_snapshot
                    ELSE public.platform_agreement_render(v.content, a.tenant_id, a.owner_email) END,
    'store_name', (SELECT t.name FROM public.tenants t WHERE t.id = a.tenant_id),
    'owner_email', a.owner_email,
    'signed_at', a.signed_at,
    'signer_name', a.signer_name);
END $$;

-- חתימה: אטומית, פעם אחת, רק על בקשה ממתינה שלא פג תוקפה
CREATE OR REPLACE FUNCTION public.platform_agreement_sign(
  _token_hash text, _signer_name text, _signature_svg text, _ip text, _user_agent text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.platform_agreement_acceptances;
  v public.platform_agreement_versions;
  _snapshot text;
BEGIN
  SELECT * INTO a FROM public.platform_agreement_acceptances WHERE token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הקישור אינו תקין';
  END IF;
  IF a.status = 'signed' THEN
    RAISE EXCEPTION 'ההסכם כבר נחתם';
  END IF;
  IF a.status <> 'pending' THEN
    RAISE EXCEPTION 'הקישור הוחלף בקישור חדש יותר';
  END IF;
  IF a.token_expires_at < now() THEN
    UPDATE public.platform_agreement_acceptances SET status = 'expired' WHERE id = a.id;
    RAISE EXCEPTION 'תוקף הקישור פג — יש לבקש קישור חדש';
  END IF;
  IF char_length(btrim(COALESCE(_signer_name, ''))) < 2 THEN
    RAISE EXCEPTION 'נא להזין שם מלא של החותם';
  END IF;
  SELECT * INTO v FROM public.platform_agreement_versions WHERE id = a.version_id;
  _snapshot := public.platform_agreement_render(v.content, a.tenant_id, a.owner_email);
  UPDATE public.platform_agreement_acceptances
     SET status = 'signed', signed_at = now(), signer_name = btrim(_signer_name),
         signature_svg = NULLIF(_signature_svg, ''), terms_snapshot = _snapshot,
         content_sha256 = encode(sha256(convert_to(_snapshot, 'UTF8')), 'hex'),
         signer_ip = left(_ip, 100), signer_user_agent = left(_user_agent, 300),
         token_hash = NULL
   WHERE id = a.id;
  RETURN jsonb_build_object('tenant_id', a.tenant_id, 'version', a.version, 'owner_email', a.owner_email);
END $$;

-- גרסה חדשה של ההסכם: הקודמות נשארות (עם החתימות עליהן)
CREATE OR REPLACE FUNCTION public.platform_agreement_publish(_title text, _content text, _by uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _next integer;
BEGIN
  SELECT COALESCE(max(version), 0) + 1 INTO _next FROM public.platform_agreement_versions;
  UPDATE public.platform_agreement_versions SET is_current = false WHERE is_current;
  INSERT INTO public.platform_agreement_versions (version, title, content, is_current, created_by)
  VALUES (_next, btrim(_title), _content, true, _by);
  RETURN _next;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'platform_agreement_render(text, uuid, text)',
    'platform_agreement_issue(uuid, text, uuid, text, timestamptz)',
    'platform_agreement_form(text)',
    'platform_agreement_sign(text, text, text, text, text)',
    'platform_agreement_publish(text, text, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- ---------- 8ב. מחיקת חנות לא נוגעת בהסכמים חתומים ----------
-- platform_delete_tenant מוחקת שורות מכל טבלה עם tenant_id. הסכם חתום לא נמחק —
-- מוציאים אותו מהרשימה, והמחיקה של החנות עצמה מנתקת אותו (ON DELETE SET NULL).
DO $$
DECLARE
  _def text;
  _fixed text;
BEGIN
  SELECT pg_get_functiondef('public.platform_delete_tenant(uuid, text)'::regprocedure) INTO _def;
  IF position('platform_agreement_acceptances' IN _def) = 0 THEN
    _fixed := replace(_def,
      'AND c.relname NOT IN (''tenants'', ''tenant_ssl'')',
      'AND c.relname NOT IN (''tenants'', ''tenant_ssl'', ''platform_agreement_acceptances'')');
    IF _fixed = _def THEN
      RAISE EXCEPTION 'part 42: platform_delete_tenant — the table list was not found';
    END IF;
    EXECUTE _fixed;
  END IF;
END $$;

-- ---------- 9. נוסח ההתחלה (גרסה 1) — ניתן להחלפה בגרסה חדשה מהתיק ----------
INSERT INTO public.platform_agreement_versions (version, title, content, is_current)
SELECT 1, 'הסכם שירות — פלטפורמת חנויות אונליין',
$txt$## 1. הצדדים והשירות
הסכם זה נערך בין מפעיל הפלטפורמה ("המפעיל") לבין בעל החנות {{store_name}} ("בעל החנות"), בכתובת הדוא"ל {{owner_email}}. המפעיל מעמיד לרשות בעל החנות חנות אינטרנטית, פאנל ניהול וכלים נלווים ("השירות").

## 2. תקופת ניסיון, מנוי ותשלומים
השירות ניתן תחילה בתקופת ניסיון, בהתאם לתנאים שפורסמו בעת ההרשמה. בתום התקופה המשך השימוש כרוך בחבילת מנוי בתשלום לפי המחירים שנקבעו בפלטפורמה. תוספים ושירותים נוספים מחויבים בנפרד, ופעילים רק לאחר אישור המפעיל וקבלת התשלום.

## 3. ביטול וסיום התקשרות
בעל החנות רשאי להפסיק את השימוש בכל עת בהודעה למפעיל. המפעיל רשאי להשעות או לסיים את השירות במקרה של הפרת ההסכם, אי-תשלום או שימוש בניגוד לדין, לאחר מתן הודעה סבירה ככל שניתן. ביטול מנוי כפוף להוראות הדין החלות.

## 4. אחריות בנוגע לחנות
בעל החנות אחראי באופן בלעדי לתוכן החנות, למוצרים, למחירים, למלאי, לאספקה, לשירות הלקוחות ולעמידה בדיני הגנת הצרכן ובכל דין החל על פעילותו. המפעיל אחראי להפעלת התשתית הטכנולוגית של הפלטפורמה.

## 5. מידע אישי של לקוחות החנות
מידע על לקוחות החנות נאסף ומנוהל לצורך פעילות החנות. בעל החנות קובע את מטרות השימוש במידע זה ואחראי למדיניות הפרטיות שלו, להסכמות לדיוור ולמענה לפניות של לקוחותיו. המפעיל מעבד את המידע עבור בעל החנות לצורך הפעלת השירות בלבד, ופועל לאבטחתו. סיווג מדויק של התפקידים ונספח עיבוד מידע — בהתאם לפעילות בפועל.

## 6. אבטחת מידע וספקים
המפעיל נוקט אמצעי אבטחה סבירים להגנה על המידע, ומדווח לבעל החנות על אירוע אבטחה מהותי שנוגע למידע שלו. השירות נעזר בספקי משנה (למשל אחסון, דיוור וסליקה), ובעל החנות מסכים לשימוש בהם.

## 7. שמירת מידע וייצואו
בסיום ההתקשרות יאפשר המפעיל לבעל החנות לייצא את המידע שלו בתוך תקופה סבירה, ולאחריה יימחק המידע בהתאם למדיניות השמירה ובכפוף לחובות שמירה חוקיות.

## 8. קניין ותכנים
התכנים שבעל החנות מעלה נשארים בבעלותו. הפלטפורמה, התוכנה והמותג שייכים למפעיל. בעל החנות מעניק למפעיל רישיון להציג ולעבד את התכנים לצורך הפעלת השירות.

## 9. הגבלת אחריות
המפעיל יעמיד את השירות ברמת מקצועיות סבירה, אך אינו מתחייב להיעדר הפרעות. אחריות המפעיל מוגבלת בהיקף המותר בדין, ואין בהסכם כדי לפגוע בזכויות שאינן ניתנות להתניה.

## 10. שינויים ויישוב מחלוקות
המפעיל רשאי לעדכן את ההסכם בהודעה מראש; גרסה חדשה תחייב לאחר אישורה. על ההסכם יחול הדין הישראלי, וסמכות השיפוט הבלעדית נתונה לבתי המשפט המוסמכים בישראל.$txt$,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.platform_agreement_versions);

-- ---------- 10. דלי פרטי למסמכים ----------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('platform-documents', 'platform-documents', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
