// "הצהרת נגישות" בעורך: הפרטים שבעל העסק ממלא (תאריך עדכון, איש קשר לנגישות, מצב הבדיקה, ליקויים
// ידועים, הסדרים במקום, רכז/ת נגישות). רשימת ההתאמות הקבועה מוצגת לקריאה בלבד — היא מה שהמערכת עושה.
// אין אפשרות לכתוב "האתר עומד בתקן": מצב "נבדק על ידי מורשה נגישות" רק מציג מי בדק ומתי.
import { Button } from "@/platform/ui";
import type { AccessibilityStatement } from "../../document/schema";
import { ENGINE_MEASURES } from "../../site/AccessibilityStatement";
import { PlainField, Section, SelectField, TextField, ToggleField } from "./fields";
import type { PanelProps } from "./panels";

/** מה חסר בהצהרה (מוצג כאזהרה בעורך; ההצהרה מוצגת גם כשחסר) */
export function statementGaps(a: AccessibilityStatement, business: PanelProps["doc"]["business"]) {
  const gaps: string[] = [];
  if (!a.updatedOn) gaps.push("תאריך העדכון של ההצהרה");
  if (!a.contactName.he.trim()) gaps.push("שם איש/אשת הקשר לנגישות");
  if (!a.contactPhone && !a.contactEmail && !business.phone && !business.email)
    gaps.push("טלפון או אימייל לפניות בנושא נגישות");
  if (a.auditStatus === "expert" && (!a.auditBy.he.trim() || !a.auditOn))
    gaps.push("מי בדק את האתר ומתי (מורשה נגישות)");
  if (a.coordinatorRequired && !a.coordinatorName.he.trim()) gaps.push("שם רכז/ת הנגישות");
  return gaps;
}

export function AccessibilityPanel({ doc, setDoc }: PanelProps) {
  const a = doc.accessibility;
  const set = <K extends keyof AccessibilityStatement>(key: K, value: AccessibilityStatement[K]) =>
    setDoc((d) => ({ ...d, accessibility: { ...d.accessibility, [key]: value } }));
  const gaps = statementGaps(a, doc.business);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Section
      title="הצהרת נגישות"
      description="מוצגת בכתובת /accessibility, עם קישור בפוטר של כל עמוד. אחרי שינוי — שמרו ופרסמו כמו כל שינוי באתר."
    >
      {gaps.length > 0 && (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <p className="font-semibold">חסר בהצהרה:</p>
          <ul className="ms-4 list-disc">
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm">
        <a
          className="font-medium underline"
          href="/studio/preview?page=accessibility"
          target="_blank"
          rel="noopener"
        >
          תצוגה מקדימה של ההצהרה (נפתחת בלשונית חדשה)
        </a>
      </p>

      <div className="space-y-1.5">
        <PlainField
          label="תאריך העדכון של ההצהרה"
          type="date"
          value={a.updatedOn}
          max={10}
          onChange={(v) => set("updatedOn", v)}
        />
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={() => set("updatedOn", today)}
        >
          עדכון לתאריך של היום
        </Button>
      </div>

      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">פניות בנושא נגישות</legend>
        <TextField
          label="שם איש/אשת הקשר לנגישות"
          value={a.contactName}
          max={120}
          onChange={(v) => set("contactName", v)}
        />
        <PlainField
          label="טלפון לפניות נגישות"
          type="tel"
          value={a.contactPhone}
          max={20}
          hint="ריק — יוצג הטלפון של העסק (או ה-WhatsApp)."
          onChange={(v) => set("contactPhone", v)}
        />
        <PlainField
          label="אימייל לפניות נגישות"
          type="email"
          value={a.contactEmail}
          max={254}
          hint="ריק — יוצג האימייל של העסק."
          onChange={(v) => set("contactEmail", v)}
        />
      </fieldset>

      <SelectField
        label="מצב הבדיקה של האתר"
        value={a.auditStatus}
        options={[
          ["not_audited", "לא נבדק על ידי מורשה נגישות"],
          ["internal", "בדיקה פנימית (לא מורשה נגישות)"],
          ["expert", "נבדק על ידי מורשה נגישות"],
        ]}
        hint='ההצהרה לא אומרת שהאתר "עומד בתקן" — רק מה נבדק, על ידי מי ומתי.'
        onChange={(v) => set("auditStatus", v as AccessibilityStatement["auditStatus"])}
      />
      {a.auditStatus === "expert" && (
        <>
          <TextField
            label="שם מורשה הנגישות שבדק"
            value={a.auditBy}
            max={160}
            onChange={(v) => set("auditBy", v)}
          />
          <PlainField
            label="תאריך הבדיקה"
            type="date"
            value={a.auditOn}
            max={10}
            onChange={(v) => set("auditOn", v)}
          />
        </>
      )}

      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          ההתאמות שהמערכת מבצעת בכל אתר (מוצגות בהצהרה)
        </summary>
        <ul className="ms-4 mt-2 list-disc space-y-1 text-muted-foreground">
          {ENGINE_MEASURES.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </details>
      <TextField
        label="התאמות נוספות שביצעתם (לא חובה)"
        value={a.measures}
        max={2000}
        multiline
        onChange={(v) => set("measures", v)}
      />
      <TextField
        label="ליקויים ידועים ומה עושים לגביהם"
        value={a.limitations}
        max={3000}
        multiline
        hint="למשל: רכיב שעדיין לא נגיש במלואו, ומתי צפוי תיקון. שורה ריקה = פסקה חדשה."
        onChange={(v) => set("limitations", v)}
      />
      <TextField
        label="דרכים נוספות לקבלת השירות"
        value={a.alternatives}
        max={1000}
        multiline
        hint="למשל: שיחת טלפון, WhatsApp או פגישה, למי שמתקשה להשתמש באתר."
        onChange={(v) => set("alternatives", v)}
      />
      <TextField
        label="הסדרי הנגישות במקום מתן השירות (אם יש מקום כזה)"
        value={a.premises}
        max={2000}
        multiline
        hint="חניה, כניסה, שירותים וכדומה. אם השירות ניתן רק מרחוק — כתבו זאת."
        onChange={(v) => set("premises", v)}
      />

      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">רכז/ת נגישות</legend>
        <ToggleField
          label="בעסק 25 עובדים או יותר (חובה למנות רכז/ת נגישות)"
          checked={a.coordinatorRequired}
          onChange={(v) => set("coordinatorRequired", v)}
        />
        {a.coordinatorRequired && (
          <>
            <TextField
              label="שם רכז/ת הנגישות"
              value={a.coordinatorName}
              max={120}
              onChange={(v) => set("coordinatorName", v)}
            />
            <PlainField
              label="טלפון"
              type="tel"
              value={a.coordinatorPhone}
              max={20}
              onChange={(v) => set("coordinatorPhone", v)}
            />
            <PlainField
              label="אימייל"
              type="email"
              value={a.coordinatorEmail}
              max={254}
              onChange={(v) => set("coordinatorEmail", v)}
            />
          </>
        )}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        ההצהרה היא טיוטה שכדאי שמורשה נגישות או עורך/ת דין יעברו עליה לפני הפרסום.
      </p>
    </Section>
  );
}
