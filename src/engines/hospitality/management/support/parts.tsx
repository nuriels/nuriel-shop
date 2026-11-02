// רכיבים משותפים למסכי התמיכה (E4) — לעסק ולפאנל הפלטפורמה: שרשור ההודעות, קבצים מצורפים,
// ותיבת הכתיבה (טקסט + קבצים). התוכן מוצג כטקסט בלבד (בלי HTML), כך שאין הזרקת קוד.
import { FileText, ImageIcon, Loader2, LockKeyhole, Paperclip, Send, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Textarea, cn } from "@/platform/ui";
import type { SupportFile, SupportMessage, SupportSender } from "../../types/support";
import { SUPPORT_ACCEPT, SUPPORT_MAX_FILES, checkSupportFiles } from "../../validation/support";
import { dateTimeText } from "../bookings/model";
import { errorText } from "../catalog/refresh";
import { monogram } from "../lib/nav";
import { openSupportFile } from "./files";
import { fileSizeText } from "./model";

type OpenFile = (file: SupportFile) => Promise<{ url: string }>;

export function FileChips({ files, onOpen }: { files: SupportFile[]; onOpen: OpenFile }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (files.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label="קבצים מצורפים">
      {files.map((f) => {
        const Icon = f.mime === "application/pdf" ? FileText : ImageIcon;
        return (
          <li key={f.id} className="min-w-0">
            <button
              type="button"
              disabled={busy === f.id}
              onClick={async () => {
                setBusy(f.id);
                try {
                  await openSupportFile(f.mime, () => onOpen(f));
                } catch (e) {
                  toast.error(errorText(e));
                } finally {
                  setBusy(null);
                }
              }}
              className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border bg-card px-3 text-sm hover:border-[var(--hm-lagoon-500)]"
            >
              {busy === f.id ? (
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <Icon className="size-4 shrink-0 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
              )}
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">
                {fileSizeText(f.size)}
              </span>
              <span className="sr-only">
                {f.mime === "application/pdf" ? "(הורדה)" : "(נפתח בחלון חדש)"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** השרשור: כרטיס לכל הודעה (שם, זמן, טקסט, קבצים); תמיכה בגוון הלגונה, הערה פנימית — בשמפניה */
export function Thread({
  messages,
  side,
  onOpenFile,
}: {
  messages: SupportMessage[];
  /** מי צופה — "אתם" / "העסק" */
  side: SupportSender;
  onOpenFile: OpenFile;
}) {
  return (
    <ol className="flex flex-col gap-3" aria-label="ההודעות בפנייה">
      {messages.map((m) => {
        const team = m.sender_type === "platform";
        const name =
          side === "business"
            ? team
              ? (m.sender_name ?? "צוות התמיכה")
              : m.mine
                ? "את/ה"
                : (m.sender_name ?? "העסק")
            : team
              ? (m.sender_name ?? "צוות התמיכה")
              : (m.sender_name ?? "העסק");
        return (
          <li
            key={m.id}
            className={cn(
              "rounded-2xl border p-4 sm:p-5",
              m.internal
                ? "border-[var(--hm-champagne-500)] border-dashed bg-[var(--hm-champagne-100)]"
                : team
                  ? "border-[var(--hm-lagoon-100)] bg-[var(--hm-lagoon-50)]"
                  : "bg-card",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  team
                    ? "bg-[var(--hm-lagoon-900)] text-[var(--hm-champagne-500)]"
                    : "bg-[var(--hm-champagne-100)] text-[var(--hm-champagne-700)]",
                )}
              >
                {team ? "N" : monogram(name)}
              </span>
              <span className="font-semibold">{name}</span>
              {team && side === "business" && (
                <span className="text-xs text-muted-foreground">Nuriel Hospitality</span>
              )}
              {m.internal && (
                <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-[var(--hm-champagne-700)]">
                  <LockKeyhole className="size-3.5" aria-hidden="true" />
                  הערה פנימית — העסק לא רואה אותה
                </span>
              )}
              <time
                dateTime={m.created_at}
                className="ms-auto text-xs whitespace-nowrap text-muted-foreground"
              >
                {dateTimeText(m.created_at)}
              </time>
            </div>
            <p className="mt-3 text-[15px] leading-7 break-words whitespace-pre-wrap">{m.body}</p>
            <FileChips files={m.files} onOpen={onOpenFile} />
          </li>
        );
      })}
    </ol>
  );
}

/** תיבת כתיבה: טקסט + קבצים (בדיקה מוקדמת כאן; השרת בודק את התוכן עצמו) */
export function Composer({
  label,
  placeholder,
  submitLabel,
  onSend,
  children,
  tone = "default",
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  /** true — נשלח (התיבה מתרוקנת) */
  onSend: (body: string, files: File[]) => Promise<boolean>;
  /** פקדים נוספים (בפאנל: הערה פנימית, סטטוס) */
  children?: ReactNode;
  tone?: "default" | "internal";
}) {
  const id = useId();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    const next = [...files, ...Array.from(list ?? [])];
    const problem = checkSupportFiles(next);
    setError(problem);
    if (!problem) setFiles(next);
    if (input.current) input.current.value = "";
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!body.trim()) {
      setError("כתבו הודעה");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (await onSend(body.trim(), files)) {
        setBody("");
        setFiles([]);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className={cn(
        "rounded-2xl border bg-card p-4 shadow-[var(--hm-shadow-card)] sm:p-5",
        tone === "internal" && "border-dashed border-[var(--hm-champagne-500)]",
      )}
    >
      <label htmlFor={`${id}-body`} className="text-sm font-semibold">
        {label}
      </label>
      <Textarea
        id={`${id}-body`}
        rows={4}
        value={body}
        maxLength={5000}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
        className="mt-2 text-base"
      />
      <div
        id={`${id}-help`}
        className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"
      >
        <span>עד {SUPPORT_MAX_FILES} קבצים: תמונה (JPG / PNG / WebP) או PDF, עד 5MB כל אחד.</span>
        <span dir="ltr">{body.length.toLocaleString("he-IL")} / 5,000</span>
      </div>
      {files.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="קבצים לשליחה">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border bg-[var(--hm-surface-2)] ps-3 text-sm"
            >
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">
                {fileSizeText(f.size)}
              </span>
              <button
                type="button"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl hover:bg-[var(--hm-line-soft)]"
                aria-label={`הסרת ${f.name}`}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {children}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          ref={input}
          id={`${id}-files`}
          type="file"
          multiple
          accept={SUPPORT_ACCEPT}
          className="peer sr-only"
          disabled={busy || files.length >= SUPPORT_MAX_FILES}
          onChange={(e) => add(e.target.files)}
        />
        <label
          htmlFor={`${id}-files`}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-medium hover:border-[var(--hm-lagoon-500)] peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
        >
          <Paperclip className="size-4" aria-hidden="true" />
          צירוף קבצים
        </label>
        <Button type="submit" className="ms-auto min-h-11 gap-2 rounded-xl px-5" disabled={busy}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          )}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
