// טופס "פנייה חדשה" (E4): נושא, תחום, דחיפות, תיאור וקבצים (צילום מסך / PDF). בדיקה מוקדמת כאן;
// השרת בודק שוב (כולל תוכן הקבצים), והמסד — הרשאה, בידוד ומגבלת 10 פניות ביממה.
import { Paperclip, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SupportPriority, SupportTopic } from "../../types/support";
import {
  SUPPORT_ACCEPT,
  SUPPORT_MAX_FILES,
  SUPPORT_PRIORITIES,
  SUPPORT_TOPICS,
  checkSupportFiles,
} from "../../validation/support";
import { FormSheet } from "../catalog/CatalogSheets";
import { errorText } from "../catalog/refresh";
import { SelectField, TextAreaField, TextField } from "../lib/fields";
import { PRIORITY_HINT, PRIORITY_LABEL, TOPIC_LABEL, fileSizeText } from "./model";

const EMPTY = {
  subject: "",
  topic: "" as SupportTopic | "",
  priority: "normal" as SupportPriority,
  body: "",
};

export function NewTicketSheet({
  open,
  onClose,
  onSubmit,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [v, setV] = useState(EMPTY);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setV(EMPTY);
      setFiles([]);
      setSubmitted(false);
      setServerError(null);
      setFileError(null);
    }
  }, [open]);

  const errors = {
    subject:
      v.subject.trim().length < 3
        ? "כתבו נושא קצר (לפחות 3 תווים)"
        : v.subject.trim().length > 120
          ? "עד 120 תווים"
          : undefined,
    topic: v.topic ? undefined : "בחרו תחום",
    body:
      v.body.trim().length < 10
        ? "תארו מה קרה (לפחות 10 תווים)"
        : v.body.length > 5000
          ? "עד 5,000 תווים"
          : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean) || Boolean(fileError);
  const show = (e: string | undefined) => (submitted ? e : undefined);
  const dirty = v.subject !== "" || v.body !== "" || v.topic !== "" || files.length > 0;

  const addFiles = (list: FileList | null) => {
    const next = [...files, ...Array.from(list ?? [])];
    const problem = checkSupportFiles(next);
    setFileError(problem);
    if (!problem) setFiles(next);
  };

  return (
    <FormSheet
      open={open}
      title="פנייה חדשה לתמיכה"
      description="מה קרה ואיפה? כמה שיותר פרטים (ואולי צילום מסך) — כך נעזור מהר יותר."
      dirty={dirty}
      busy={busy}
      submitLabel="שליחת הפנייה"
      serverError={serverError}
      notice={null}
      hasErrors={hasErrors}
      submitted={submitted}
      onClose={onClose}
      onSubmit={async () => {
        setSubmitted(true);
        if (hasErrors) return;
        const form = new FormData();
        form.set("subject", v.subject.trim());
        form.set("topic", v.topic);
        form.set("priority", v.priority);
        form.set("body", v.body.trim());
        for (const f of files) form.append("files", f, f.name);
        setBusy(true);
        setServerError(null);
        try {
          await onSubmit(form);
        } catch (e) {
          setServerError(errorText(e));
          onError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField
        idPrefix="support-new"
        name="subject"
        label="נושא"
        placeholder="למשל: הזמנה לא מופיעה ביומן"
        value={v.subject}
        onChange={(subject) => setV({ ...v, subject })}
        error={show(errors.subject)}
        required
      />
      <SelectField<SupportTopic | "">
        idPrefix="support-new"
        name="topic"
        label="תחום"
        value={v.topic}
        options={[
          { value: "", label: "בחרו תחום…" },
          ...SUPPORT_TOPICS.map((t) => ({ value: t, label: TOPIC_LABEL[t] })),
        ]}
        onChange={(topic) => setV({ ...v, topic })}
        error={show(errors.topic)}
      />
      <SelectField<SupportPriority>
        idPrefix="support-new"
        name="priority"
        label="דחיפות"
        value={v.priority}
        options={SUPPORT_PRIORITIES.map((p) => ({
          value: p,
          label: `${PRIORITY_LABEL[p]} — ${PRIORITY_HINT[p]}`,
        }))}
        onChange={(priority) => setV({ ...v, priority })}
      />
      <TextAreaField
        idPrefix="support-new"
        name="body"
        label="תיאור"
        rows={6}
        hint="מה ניסיתם לעשות, מה קרה בפועל, ובאיזה מסך / הזמנה. בלי מספרי כרטיסי אשראי."
        value={v.body}
        onChange={(body) => setV({ ...v, body })}
        error={show(errors.body)}
      />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium" id="support-new-files-label">
          קבצים מצורפים (לא חובה)
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="support-new-files"
            type="file"
            multiple
            accept={SUPPORT_ACCEPT}
            className="peer sr-only"
            disabled={busy || files.length >= SUPPORT_MAX_FILES}
            aria-describedby="support-new-files-hint"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <label
            htmlFor="support-new-files"
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-medium hover:border-[var(--hm-lagoon-500)] peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
          >
            <Paperclip className="size-4" aria-hidden="true" />
            צירוף קבצים
          </label>
        </div>
        <p id="support-new-files-hint" className="text-xs text-muted-foreground">
          עד {SUPPORT_MAX_FILES} קבצים: תמונה (JPG / PNG / WebP) או PDF, עד 5MB כל אחד.
        </p>
        {fileError && (
          <p role="alert" className="text-sm text-destructive">
            {fileError}
          </p>
        )}
        {files.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-labelledby="support-new-files-label">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex min-h-10 items-center gap-2 rounded-xl border bg-[var(--hm-surface-2)] ps-3 text-sm"
              >
                <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {fileSizeText(f.size)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFiles(files.filter((_, j) => j !== i));
                    setFileError(null);
                  }}
                  className="inline-flex size-10 items-center justify-center rounded-xl hover:bg-[var(--hm-line-soft)]"
                  aria-label={`הסרת ${f.name}`}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormSheet>
  );
}
