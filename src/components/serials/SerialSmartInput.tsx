import { useEffect, useId, useRef, useState } from "react";
import { Loader2, ScanBarcode } from "lucide-react";
import { Input } from "@/components/ui/input";
import { loadAvailableSerials } from "@/lib/serials-data";
import { normalizeSerial, serialProblem, type AvailableSerial } from "@/lib/serials";
import { formatOrderDate } from "@/lib/orders";
import { cn } from "@/lib/utils";

/**
 * חלק 35: "קלט חכם" למספר סידורי.
 *  • סריקה בקורא ברקודים: הקורא "מקליד" את המספר ושולח Enter → נשלח מיד,
 *    והשדה מתנקה ונשאר בפוקוס לסריקה הבאה.
 *  • לחיצה על השדה פותחת את רשימת היחידות הפנויות של המוצר (הוותיקות קודם);
 *    הקלדה מסננת; בחירה ברשימה = שליחה.
 * `onPick` — מה עושים במספר (שיוך בהזמנה / הוספה לשורה בקופה); שגיאה ממנו
 * מוצגת מתחת לשדה.
 */
export function SerialSmartInput({
  productId,
  onPick,
  exclude = [],
  disabled = false,
  placeholder = "סרקו או הקלידו מספר סידורי",
  autoFocus = false,
  testId = "serial-input",
}: {
  productId: string;
  onPick: (serial: string) => Promise<void> | void;
  /** מספרים שכבר נבחרו (לא מוצגים ברשימה) */
  exclude?: string[];
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  testId?: string;
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<AvailableSerial[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // הרשימה נטענת כשהשדה פתוח (ושוב אחרי כל שיוך / הקלדה)
  useEffect(() => {
    if (!open || disabled) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      loadAvailableSerials(productId, value)
        .then((rows) => {
          if (!cancelled) {
            setOptions(rows);
            setActive(0);
          }
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, value, productId, disabled, refresh]);

  const excluded = new Set(exclude.map(normalizeSerial));
  const visible = options.filter((option) => !excluded.has(option.serial_number));

  const submit = async (raw: string) => {
    const problem = serialProblem(raw);
    if (problem) {
      setError(problem);
      return;
    }
    const serial = normalizeSerial(raw);
    if (excluded.has(serial)) {
      setError(`המספר הסידורי ${serial} כבר נבחר`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onPick(serial);
      setValue("");
      setRefresh((n) => n + 1);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "השיוך נכשל");
    } finally {
      setBusy(false);
      // נשאר בפוקוס — הסריקה הבאה נכנסת ישר לשדה
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <div className="relative" data-testid={testId}>
      <div className="relative">
        <ScanBarcode
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={inputRef}
          dir="ltr"
          value={value}
          disabled={disabled || busy}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={error ? true : undefined}
          role="combobox"
          className="h-9 pr-8 text-left font-mono text-sm placeholder:text-right placeholder:font-sans"
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              // חץ + Enter = בחירה מהרשימה; אחרת — מה שנסרק / הוקלד
              const highlighted = visible[active];
              const typed = normalizeSerial(value);
              void submit(typed === "" && highlighted ? highlighted.serial_number : typed || value);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(index + 1, Math.max(visible.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          data-testid={`${testId}-field`}
        />
        {busy && (
          <Loader2
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>

      {open && !disabled && (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          data-testid={`${testId}-list`}
        >
          {loading && visible.length === 0 ? (
            <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              טוען יחידות פנויות…
            </p>
          ) : visible.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {value.trim()
                ? "אין יחידה פנויה כזו — אפשר ללחוץ Enter לשיוך ישיר"
                : 'אין יחידות פנויות במלאי — קלטו קודם ב"קליטת סחורה"'}
            </p>
          ) : (
            <>
              <p className="px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground">
                {visible.length} יחידות פנויות — הוותיקות קודם
              </p>
              {visible.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  // mousedown — לפני שהשדה מאבד פוקוס
                  onMouseDown={(event) => {
                    event.preventDefault();
                    void submit(option.serial_number);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-right text-sm",
                    index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                  data-testid={`${testId}-option`}
                >
                  <span dir="ltr" className="font-mono">
                    {option.serial_number}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    נקלט {formatOrderDate(option.received_at).split(",")[0]}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-1 text-xs font-medium text-destructive"
          data-testid={`${testId}-error`}
        >
          {error}
        </p>
      )}
    </div>
  );
}
