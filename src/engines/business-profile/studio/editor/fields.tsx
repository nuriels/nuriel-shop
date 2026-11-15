// שדות העורך — תווית מחוברת לכל שדה (נגישות), טקסט בעברית (האנגלית נשמרת אם קיימת), ומונה תווים
import { useId, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2 } from "lucide-react";
import { Button, Input, Label, Switch, Textarea } from "@/platform/ui";
import type { LocalizedText } from "../../document/schema";
import { setHe } from "./doc-ops";

export function TextField({
  label,
  value,
  onChange,
  max,
  multiline = false,
  dir,
  placeholder,
  hint,
}: {
  label: string;
  value: LocalizedText | undefined;
  onChange: (v: LocalizedText) => void;
  max: number;
  multiline?: boolean;
  dir?: "ltr" | "rtl";
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  const text = value?.he ?? "";
  const common = {
    id,
    value: text,
    maxLength: max,
    placeholder,
    dir,
    "aria-describedby": hint ? `${id}-hint` : undefined,
    onChange: (e: { target: { value: string } }) => onChange(setHe(value, e.target.value)),
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground" aria-hidden="true">
          {text.length}/{max}
        </span>
      </div>
      {multiline ? <Textarea rows={4} {...common} /> : <Input {...common} />}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** שדה טקסט פשוט (לא לפי שפה): טלפון, אימייל, קישור */
export function PlainField({
  label,
  value,
  onChange,
  max,
  type = "text",
  dir = "ltr",
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  type?: string;
  dir?: "ltr" | "rtl";
  hint?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        dir={dir}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function ParagraphsField({
  label,
  value,
  onChange,
  maxEach,
  maxCount,
}: {
  label: string;
  value: LocalizedText[];
  onChange: (v: LocalizedText[]) => void;
  maxEach: number;
  maxCount: number;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{label}</legend>
      {value.map((p, i) => (
        <div key={i} className="space-y-1">
          <TextField
            label={`פסקה ${i + 1}`}
            value={p}
            max={maxEach}
            multiline
            onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-4" aria-hidden="true" /> הסרת הפסקה
          </Button>
        </div>
      ))}
      {value.length < maxCount && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, { he: "" }])}
        >
          הוספת פסקה
        </Button>
      )}
    </fieldset>
  );
}

/** שורת פעולות לפריט ברשימה: למעלה / למטה / הסתרה / מחיקה */
export function RowActions({
  label,
  index,
  count,
  hidden,
  onMove,
  onToggle,
  onRemove,
}: {
  label: string;
  index: number;
  count: number;
  hidden?: boolean | undefined;
  onMove: (delta: -1 | 1) => void;
  onToggle?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={`הזזת ${label} למעלה`}
      >
        <ArrowUp className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        aria-label={`הזזת ${label} למטה`}
      >
        <ArrowDown className="size-4" aria-hidden="true" />
      </Button>
      {onToggle && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggle}
          aria-pressed={hidden}
          aria-label={hidden ? `הצגת ${label}` : `הסתרת ${label}`}
        >
          {hidden ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </Button>
      )}
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={`מחיקת ${label}`}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
