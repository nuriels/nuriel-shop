// שדות הטופס של הגדרות העסק: תווית, הסבר קצר, הודעת שגיאה בעברית ליד השדה
// (aria-invalid + aria-describedby), גובה 44px לפחות, מותאם לטלפון.
import { useId, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Button, Input, Label, cn } from "@/platform/ui";

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}

function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function TextField(props: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  type?: "text" | "tel" | "email" | "time" | undefined;
  dir?: "ltr" | "rtl" | undefined;
  autoComplete?: string | undefined;
  required?: boolean | undefined;
}) {
  const id = `settings-${props.name}`;
  return (
    <FieldShell id={id} label={props.label} hint={props.hint} error={props.error}>
      <Input
        id={id}
        name={props.name}
        type={props.type ?? "text"}
        dir={props.dir}
        inputMode={props.type === "tel" ? "tel" : props.type === "email" ? "email" : undefined}
        autoComplete={props.autoComplete ?? "off"}
        required={props.required}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props.hint, props.error)}
        className={cn(
          "min-h-11",
          props.dir === "ltr" && "text-start",
          props.error && "border-destructive",
        )}
      />
    </FieldShell>
  );
}

export function SelectField<T extends string | number | null>(props: {
  name: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const id = `settings-${props.name}`;
  const index = props.options.findIndex((o) => o.value === props.value);
  return (
    <FieldShell id={id} label={props.label} hint={props.hint} error={props.error}>
      <select
        id={id}
        name={props.name}
        value={String(index)}
        onChange={(e) => props.onChange(props.options[Number(e.target.value)]!.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props.hint, props.error)}
        className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {props.options.map((o, i) => (
          <option key={String(o.value)} value={String(i)}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** ימים לבחירה (כפתורי סימון), למשל לילות סוף השבוע */
export function DaysField(props: {
  name: string;
  label: string;
  labels: string[];
  value: number[];
  onChange: (v: number[]) => void;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const id = `settings-${props.name}`;
  const toggle = (d: number) =>
    props.onChange(
      props.value.includes(d)
        ? props.value.filter((x) => x !== d)
        : [...props.value, d].sort((a, b) => a - b),
    );
  return (
    <fieldset
      className="flex flex-col gap-1.5"
      aria-describedby={describedBy(id, props.hint, props.error)}
      aria-invalid={props.error ? true : undefined}
    >
      <legend className="mb-1.5 text-sm font-medium">{props.label}</legend>
      <div className="flex flex-wrap gap-2">
        {props.labels.map((label, d) => {
          const checked = props.value.includes(d);
          return (
            <label
              key={label}
              className={cn(
                "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border px-3 text-sm",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                checked ? "border-primary bg-primary text-primary-foreground" : "bg-background",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                name={props.name}
                checked={checked}
                onChange={() => toggle(d)}
              />
              {label}
            </label>
          );
        })}
      </div>
      {props.hint && !props.error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {props.error}
        </p>
      )}
    </fieldset>
  );
}

/** רשימת אימיילים (עד max), הוספה והסרה */
export function EmailListField(props: {
  name: string;
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  max: number;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const base = useId();
  const id = `settings-${props.name}`;
  const set = (i: number, v: string) =>
    props.onChange(props.value.map((e, j) => (j === i ? v : e)));
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={describedBy(id, props.hint, props.error)}
    >
      <legend className="mb-1 text-sm font-medium">{props.label}</legend>
      {props.value.length === 0 && (
        <p className="text-sm text-muted-foreground">אין כתובות — המיילים נשלחים לאימייל העסק.</p>
      )}
      {props.value.map((email, i) => (
        <div key={`${base}-${i}`} className="flex items-center gap-2">
          <Input
            type="email"
            dir="ltr"
            inputMode="email"
            autoComplete="off"
            aria-label={`${props.label} — כתובת ${i + 1}`}
            value={email}
            onChange={(e) => set(i, e.target.value)}
            aria-invalid={props.error ? true : undefined}
            className="min-h-11 text-start"
          />
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-11 shrink-0"
            aria-label={`הסרת כתובת ${i + 1}`}
            onClick={() => props.onChange(props.value.filter((_, j) => j !== i))}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      {props.value.length < props.max && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-fit gap-2"
          onClick={() => props.onChange([...props.value, ""])}
        >
          <Plus className="size-4" aria-hidden="true" />
          הוספת כתובת
        </Button>
      )}
      {props.hint && !props.error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {props.error}
        </p>
      )}
    </fieldset>
  );
}
