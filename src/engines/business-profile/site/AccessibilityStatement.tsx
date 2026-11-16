// הצהרת הנגישות של אתר עסק (/accessibility) — לפי תקנה 35ה לתקנות שוויון זכויות לאנשים עם מוגבלות
// (התאמות נגישות לשירות), התשע"ג-2013. הפרטים — מהמסמך (doc.accessibility, נערכים בממשק הניהול);
// רשימת ההתאמות הקבועה — מה שהמערכת עושה בכל אתר עסק (בקוד, נבדק בבדיקות האוטומטיות).
// אין כאן הצהרה שהאתר "עומד בתקן": ההצהרה אומרת מה נבדק, מי בדק ומתי — ומה עוד לא נגיש.
import { tx } from "../document/normalize";
import { useSiteView } from "./context";

/** ההתאמות שהמערכת מבצעת בכל אתר עסק (אמת לכל אתר — לא טענה כללית) */
export const ENGINE_MEASURES: readonly string[] = [
  "מבנה כותרות היררכי ואזורי דף מסומנים (כותרת, תוכן, פוטר), כך שאפשר לנווט ביניהם בקורא מסך.",
  'קישור "דילוג לתוכן הראשי" בתחילת כל עמוד.',
  "ניווט מלא במקלדת, בסדר הגיוני, עם סימון פוקוס בולט.",
  "טקסט חלופי לתמונות תוכן; תמונות קישוט מוסתרות מקוראי מסך.",
  "תווית לכל שדה בטופס, הודעות שגיאה ברורות ליד השדה שמוקראות בקורא מסך, ואישור ברור אחרי שליחה.",
  "שם נגיש לכל כפתור ולכל קישור, כולל ציון של קישורים שנפתחים בחלון חדש.",
  "כפתור עצירה והפעלה לתוכן שזז מעצמו (קרוסלה ורצועת המלצות). כשבמכשיר מוגדרת העדפה להפחתת תנועה — התוכן לא זז מעצמו.",
  "הגלריה המוגדלת נפתחת ונסגרת במקלדת (Esc), עם מעבר בין התמונות בחיצים.",
  "שפת העמוד וכיוון הכתיבה (עברית, ימין לשמאל) מוגדרים לכל עמוד.",
  "תצוגה מותאמת לנייד ולהגדלת תצוגה עד 200% בלי לאבד תוכן.",
];

const AUDIT_TEXT = {
  not_audited:
    'האתר עדיין לא נבדק על ידי מורשה נגישות. ההתאמות שלמטה בוצעו ונבדקו בבדיקות אוטומטיות (axe) ובבדיקות ידניות של ניווט במקלדת. ייתכן שחלקים באתר עדיין לא נגישים במלואם — ראו את הסעיף "ליקויים ידועים".',
  internal:
    'האתר נבדק בבדיקה פנימית (לא על ידי מורשה נגישות), בבדיקות אוטומטיות (axe) ובבדיקות ידניות של ניווט במקלדת וקורא מסך. ייתכן שחלקים באתר עדיין לא נגישים במלואם — ראו את הסעיף "ליקויים ידועים".',
} as const;

export function formatYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : "";
}

function Paragraphs({ text }: { text: string }) {
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <p key={i} className="bps-statement-text">
          {p}
        </p>
      ))}
    </>
  );
}

export function AccessibilityStatement() {
  const { doc, locale, mode } = useSiteView();
  const a = doc.accessibility;
  const b = doc.business;
  const t = (x: { he: string; en?: string | undefined }) => tx(x, locale);
  const name = t(b.name) || "העסק";
  const contactName = t(a.contactName);
  // פרטי הקשר לנגישות; אם לא מולאו — הפרטים הכלליים של העסק (תמיד יש דרך לפנות)
  const phone = a.contactPhone || b.phone;
  const email = a.contactEmail || b.email;
  const whatsapp =
    !a.contactPhone && !b.phone && /^[1-9][0-9]{7,14}$/.test(b.whatsapp) ? b.whatsapp : "";
  const home = mode === "preview" ? "/studio/preview" : "/";
  const audit =
    a.auditStatus === "expert"
      ? `האתר נבדק על ידי מורשה נגישות${t(a.auditBy) ? ` (${t(a.auditBy)})` : ""}${
          a.auditOn ? ` בתאריך ${formatYmd(a.auditOn)}` : ""
        }. ממצאי הבדיקה והתיקונים מפורטים למטה.`
      : AUDIT_TEXT[a.auditStatus];

  return (
    <article className="bps-statement" aria-labelledby="statement-title">
      <div className="bps-wrap bps-statement-inner">
        <h1 id="statement-title" className="bps-statement-title">
          הצהרת נגישות
        </h1>
        <p className="bps-statement-text">
          באתר של {name} אנחנו רואים חשיבות רבה בהנגשת האתר לאנשים עם מוגבלות, ופועלים כדי שכל אחד
          ואחת יוכלו להשתמש בו בקלות. ההתאמות נעשות לפי חוק שוויון זכויות לאנשים עם מוגבלות,
          התשנ"ח-1998, ותקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע"ג-2013,
          ולפי דרישות התקן הישראלי ת"י 5568 ברמה AA.
        </p>

        <h2 className="bps-statement-h2">מצב הנגישות באתר</h2>
        <p className="bps-statement-text">{audit}</p>

        <h2 className="bps-statement-h2">התאמות שבוצעו באתר</h2>
        <ul className="bps-statement-list">
          {ENGINE_MEASURES.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        {t(a.measures) && <Paragraphs text={t(a.measures)} />}

        {t(a.limitations) && (
          <>
            <h2 className="bps-statement-h2">ליקויים ידועים</h2>
            <Paragraphs text={t(a.limitations)} />
          </>
        )}

        {t(a.alternatives) && (
          <>
            <h2 className="bps-statement-h2">דרכים נוספות לקבלת השירות</h2>
            <Paragraphs text={t(a.alternatives)} />
          </>
        )}

        {t(a.premises) && (
          <>
            <h2 className="bps-statement-h2">הסדרי הנגישות במקום מתן השירות</h2>
            <Paragraphs text={t(a.premises)} />
          </>
        )}

        <h2 className="bps-statement-h2">נתקלתם בבעיית נגישות?</h2>
        <p className="bps-statement-text">
          נשמח לשמוע ולתקן. כדי שנוכל לטפל בפנייה, כתבו באיזה עמוד הבעיה, מה קרה, ובאיזו דרך נוח
          לחזור אליכם.
        </p>
        <dl className="bps-statement-contact">
          {contactName && (
            <div>
              <dt>איש/אשת הקשר לנגישות</dt>
              <dd>{contactName}</dd>
            </div>
          )}
          {phone && (
            <div>
              <dt>טלפון</dt>
              <dd>
                <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} dir="ltr">
                  {phone}
                </a>
              </dd>
            </div>
          )}
          {whatsapp && (
            <div>
              <dt>WhatsApp</dt>
              <dd>
                <a
                  href={`https://wa.me/${whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                >
                  +{whatsapp}
                  <span className="bps-sr"> (נפתח בחלון חדש)</span>
                </a>
              </dd>
            </div>
          )}
          {email && (
            <div>
              <dt>אימייל</dt>
              <dd>
                <a href={`mailto:${email}`} dir="ltr">
                  {email}
                </a>
              </dd>
            </div>
          )}
        </dl>

        {a.coordinatorRequired && t(a.coordinatorName) && (
          <>
            <h2 className="bps-statement-h2">רכז/ת הנגישות</h2>
            <dl className="bps-statement-contact">
              <div>
                <dt>שם</dt>
                <dd>{t(a.coordinatorName)}</dd>
              </div>
              {a.coordinatorPhone && (
                <div>
                  <dt>טלפון</dt>
                  <dd>
                    <a href={`tel:${a.coordinatorPhone.replace(/[^0-9+]/g, "")}`} dir="ltr">
                      {a.coordinatorPhone}
                    </a>
                  </dd>
                </div>
              )}
              {a.coordinatorEmail && (
                <div>
                  <dt>אימייל</dt>
                  <dd>
                    <a href={`mailto:${a.coordinatorEmail}`} dir="ltr">
                      {a.coordinatorEmail}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </>
        )}

        <p className="bps-statement-updated">
          {a.updatedOn
            ? `ההצהרה עודכנה בתאריך ${formatYmd(a.updatedOn)}.`
            : "תאריך העדכון יתווסף בקרוב."}
        </p>
        <p>
          <a className="bps-statement-home" href={home}>
            חזרה לדף הבית
          </a>
        </p>
      </div>
    </article>
  );
}
