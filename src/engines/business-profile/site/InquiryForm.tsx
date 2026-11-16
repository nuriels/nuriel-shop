// טופס הפנייה באתר העסק (מיגרציה 196) — נשמר ב"פניות מלקוחות" בממשק הניהול, ובעל העסק מקבל מייל.
// העיצוב — אותו מבנה של הטופס המקורי (שורת שם / אימייל / טלפון, שדה הודעה, כפתור). נגישות:
//   • לכל שדה תווית (לקוראי מסך) ושם נגיש; שדה חובה מסומן (aria-required), והשדות "טלפון או אימייל";
//   • שגיאה: הודעה מתחת לשדה (aria-describedby + aria-invalid), סיכום בהודעה חיה, והפוקוס עובר לשדה
//     הראשון שנכשל; טעות שתוקנה — ההודעה שלה נעלמת בהקלדה;
//   • שליחה: הכפתור נעול (aria-busy) עד התשובה — לחיצה כפולה לא שולחת פעמיים, וגם המפתח החד-פעמי
//     (clientKey) מבטיח פנייה אחת במסד; אישור ברור במקום הטופס, והפוקוס עובר אליו;
//   • שדה מלכודת לבוטים — מוסתר מכולם (גם מקוראי מסך), בלי tab.
// בתצוגה המקדימה (לפני הפרסום) — אותה שליחה, והפנייה נשמרת כ"פניית בדיקה".
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitInquiry } from "../api/inquiries.functions";
import {
  firstInvalid,
  validateInquiry,
  type FieldErrors,
  type InquiryField,
  type InquiryKind,
} from "../inquiries/logic";

export interface InquiryFormProps {
  id: string;
  kind: InquiryKind;
  formTitle: string;
  labels: { name: string; email: string; phone: string; message: string; submit: string };
  preview: boolean;
}

const EMPTY = { name: "", email: "", phone: "", message: "" };

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000".replace(/0/g, () =>
        Math.floor(Math.random() * 16).toString(16),
      );
}

export function InquiryForm({ id, kind, formTitle, labels, preview }: InquiryFormProps) {
  const send = useServerFn(submitInquiry);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; test: boolean } | null>(null);
  const key = useRef<string>("");
  const startedAt = useRef<number>(0);
  const trap = useRef<HTMLInputElement>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const fid = (name: string) => `${id}-${name}`;

  useEffect(() => {
    key.current = newKey();
    startedAt.current = Date.now();
  }, []);
  useEffect(() => {
    if (status === "done") doneHeading.current?.focus();
  }, [status]);

  const focusField = (field: InquiryField) =>
    (document.getElementById(fid(field)) as HTMLInputElement | null)?.focus();

  const onChange = (field: InquiryField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    // הודעת "טלפון או אימייל" יושבת על הטלפון — מתנקה גם כשממלאים אימייל
    if (errors[field] || (field === "email" && errors.phone)) {
      setErrors((e) => {
        const next = { ...e };
        delete next[field];
        if (field === "email" && value.trim() && !values.phone.trim()) delete next.phone;
        return next;
      });
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;
    setProblem(null);
    const checked = validateInquiry(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      const first = firstInvalid(checked.errors);
      if (first) focusField(first);
      return;
    }
    setErrors({});
    setStatus("sending");
    try {
      const r = await send({
        data: {
          clientKey: key.current || newKey(),
          kind,
          formTitle,
          pagePath: preview ? "/" : window.location.pathname,
          name: values.name,
          email: values.email,
          phone: values.phone,
          message: values.message,
          website: trap.current?.value ?? "",
          startedAt: startedAt.current,
          preview,
        },
      });
      if (r.ok) {
        setDone({ reference: r.reference, test: r.test });
        setStatus("done");
        return;
      }
      setStatus("idle");
      if (r.errors && Object.keys(r.errors).length) {
        setErrors(r.errors);
        const first = firstInvalid(r.errors);
        if (first) focusField(first);
      }
      setProblem(r.error ?? (r.errors ? null : "השליחה לא הצליחה. נסו שוב."));
    } catch {
      setStatus("idle");
      setProblem("השליחה לא הצליחה — בדקו את החיבור לאינטרנט ונסו שוב.");
    }
  };

  if (status === "done" && done) {
    return (
      <div className="bps-form bps-form-done" role="status" aria-live="polite">
        <h3 ref={doneHeading} tabIndex={-1} className="bps-form-done-title">
          תודה! הפנייה התקבלה
        </h3>
        <p>נחזור אליכם בהקדם.</p>
        <p className="bps-form-done-ref">
          מספר הפנייה: <bdi dir="ltr">{done.reference}</bdi>
        </p>
        {done.test && (
          <p className="bps-form-done-test">
            תצוגה מקדימה: הפנייה נשמרה כ"פניית בדיקה" באזור "פניות מלקוחות".
          </p>
        )}
        <button
          type="button"
          className="bps-form-again"
          onClick={() => {
            key.current = newKey();
            startedAt.current = Date.now();
            setValues(EMPTY);
            setDone(null);
            setStatus("idle");
          }}
        >
          שליחת פנייה נוספת
        </button>
      </div>
    );
  }

  const errorId = (f: InquiryField) => (errors[f] ? fid(`${f}-error`) : undefined);
  const describedBy = (f: InquiryField, hint?: string) =>
    [hint, errorId(f)].filter(Boolean).join(" ") || undefined;
  const fieldError = (f: InquiryField) =>
    errors[f] ? (
      <span id={fid(`${f}-error`)} className="bps-field-error">
        {errors[f]}
      </span>
    ) : null;
  const count = Object.keys(errors).length;
  const sending = status === "sending";

  return (
    <form
      className="bps-form"
      noValidate
      onSubmit={onSubmit}
      aria-label={formTitle || "טופס פנייה"}
      aria-describedby={fid("hint")}
    >
      <p id={fid("hint")} className="bps-sr">
        חובה למלא שם, וטלפון או אימייל לחזרה.
      </p>
      <div className="bps-form-row">
        <div className="bps-field">
          <label className="bps-sr" htmlFor={fid("name")}>
            {labels.name || "שם"} (חובה)
          </label>
          <input
            id={fid("name")}
            name="name"
            type="text"
            autoComplete="name"
            maxLength={120}
            aria-required="true"
            aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={describedBy("name")}
            placeholder={labels.name}
            value={values.name}
            onChange={(e) => onChange("name", e.target.value)}
          />
          {fieldError("name")}
        </div>
        <div className="bps-field">
          <label className="bps-sr" htmlFor={fid("email")}>
            {labels.email || "אימייל"} (טלפון או אימייל)
          </label>
          <input
            id={fid("email")}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            dir="ltr"
            aria-invalid={errors.email ? "true" : undefined}
            aria-describedby={describedBy("email")}
            placeholder={labels.email}
            value={values.email}
            onChange={(e) => onChange("email", e.target.value)}
          />
          {fieldError("email")}
        </div>
        <div className="bps-field">
          <label className="bps-sr" htmlFor={fid("phone")}>
            {labels.phone || "טלפון"} (טלפון או אימייל)
          </label>
          <input
            id={fid("phone")}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={30}
            dir="ltr"
            aria-invalid={errors.phone ? "true" : undefined}
            aria-describedby={describedBy("phone")}
            placeholder={labels.phone}
            value={values.phone}
            onChange={(e) => onChange("phone", e.target.value)}
          />
          {fieldError("phone")}
        </div>
      </div>
      <div className="bps-field">
        <label className="bps-sr" htmlFor={fid("message")}>
          {labels.message || "הודעה"}
        </label>
        <input
          id={fid("message")}
          name="message"
          type="text"
          maxLength={4000}
          aria-invalid={errors.message ? "true" : undefined}
          aria-describedby={describedBy("message")}
          placeholder={labels.message}
          value={values.message}
          onChange={(e) => onChange("message", e.target.value)}
        />
        {fieldError("message")}
      </div>
      {/* מלכודת לבוטים: גולש לא רואה ולא מגיע לשדה הזה */}
      <div className="bps-trap" aria-hidden="true">
        <label htmlFor={fid("website")}>אתר אינטרנט</label>
        <input
          ref={trap}
          id={fid("website")}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>
      <button
        type="submit"
        className="bps-form-submit"
        disabled={sending}
        aria-busy={sending ? "true" : undefined}
      >
        {sending ? "שולחים…" : labels.submit || "שליחה"}
      </button>
      <p className="bps-form-note" role="alert">
        {problem ??
          (count > 0
            ? count === 1
              ? "יש שדה אחד שצריך לתקן."
              : `יש ${count} שדות שצריך לתקן.`
            : "")}
      </p>
    </form>
  );
}
