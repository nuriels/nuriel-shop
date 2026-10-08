import { useEffect, useRef, useState } from "react";
import { Loader2, PackagePlus, ScanBarcode, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { receiveSerials } from "@/lib/serials-data";
import {
  parseSerialList,
  SERIAL_RECEIVE_MAX,
  SERIALS_CHANGED,
  type ReceiveMode,
  type ReceiveResult,
} from "@/lib/serials";

/**
 * חלק 35: קליטת סחורה למוצר עם מספרים סידוריים — מספר לכל יחידה.
 *  • סריקה בקורא ברקודים: כל סריקה (Enter) נכנסת לרשימה, והשדה מתנקה.
 *  • אפשר גם להדביק רשימה (שורה לכל מספר / מופרד בפסיק).
 *  • "קליטת סחורה חדשה" — המלאי עולה בכמות שנסרקה.
 *    "רישום יחידות קיימות" — למוצר שעבר עכשיו למספרים סידוריים: המלאי לא
 *    משתנה, רק מקבל מספר לכל יחידה שכבר על המדף.
 */
export function SerialReceiveDialog({
  open,
  onOpenChange,
  productId,
  productName,
  mode = "receive",
  missing = 0,
  onReceived,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  mode?: ReceiveMode;
  /** "existing": כמה יחידות במלאי עוד בלי מספר */
  missing?: number;
  onReceived?: (result: ReceiveResult) => void;
}) {
  const [serials, setSerials] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSerials([]);
      setDraft("");
      setNotice(null);
    }
  }, [open]);

  const add = (text: string) => {
    const parsed = parseSerialList(text);
    const fresh: string[] = [];
    const repeated: string[] = [...parsed.duplicates];
    for (const serial of parsed.serials) {
      if (serials.includes(serial) || fresh.includes(serial)) repeated.push(serial);
      else fresh.push(serial);
    }
    const room = SERIAL_RECEIVE_MAX - serials.length;
    const accepted = fresh.slice(0, Math.max(room, 0));
    if (accepted.length > 0) setSerials((current) => [...current, ...accepted]);
    const messages: string[] = [];
    if (repeated.length > 0) messages.push(`כבר ברשימה: ${[...new Set(repeated)].join(", ")}`);
    if (parsed.invalid.length > 0) {
      messages.push(
        `לא תקין (אותיות באנגלית, ספרות ו- . _ / # : -): ${parsed.invalid.slice(0, 5).join(", ")}`,
      );
    }
    if (fresh.length > accepted.length) messages.push(`עד ${SERIAL_RECEIVE_MAX} יחידות בקליטה אחת`);
    setNotice(messages.length > 0 ? messages.join(" · ") : null);
    setDraft("");
  };

  const submit = async () => {
    if (serials.length === 0) {
      setNotice("סרקו או הקלידו לפחות מספר סידורי אחד");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await receiveSerials(productId, serials, mode);
      toast.success(
        mode === "receive"
          ? `נקלטו ${result.added} יחידות של "${productName}" — במלאי עכשיו ${result.stock_quantity}`
          : `נרשמו ${result.added} יחידות קיימות של "${productName}"`,
      );
      window.dispatchEvent(new Event(SERIALS_CHANGED));
      onReceived?.(result);
      onOpenChange(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "הקליטה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const overExisting = mode === "existing" && serials.length > missing;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent dir="rtl" className="max-w-lg" data-testid="serial-receive-dialog">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="size-5 text-primary" aria-hidden="true" />
            {mode === "receive" ? "קליטת סחורה" : "רישום יחידות קיימות"} — {productName}
          </DialogTitle>
          <DialogDescription>
            {mode === "receive"
              ? "סרקו את המספר הסידורי של כל יחידה (או הדביקו רשימה). המלאי יעלה בכמות שנסרקה."
              : `למוצר יש ${missing} יחידות במלאי בלי מספר סידורי. סרקו את המספר של כל יחידה שכבר על המדף — המלאי לא משתנה.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="serial-receive-input" className="flex items-center gap-1.5">
            <ScanBarcode className="size-4" aria-hidden="true" />
            מספר סידורי
          </Label>
          <Input
            id="serial-receive-input"
            ref={inputRef}
            dir="ltr"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder="סרקו / הקלידו ולחצו Enter"
            className="text-left font-mono placeholder:text-right placeholder:font-sans"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add(draft);
              }
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              if (/[\s,;]/.test(text.trim())) {
                event.preventDefault();
                add(text);
              }
            }}
            data-testid="serial-receive-input"
          />
          {notice && (
            <p
              role="alert"
              className="text-xs font-medium text-destructive"
              data-testid="serial-receive-notice"
            >
              {notice}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
            <span className="font-semibold" data-testid="serial-receive-count">
              נסרקו {serials.length} יחידות
              {mode === "existing" && ` (מתוך ${missing} בלי מספר)`}
            </span>
            {serials.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground"
                onClick={() => setSerials([])}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                ניקוי
              </Button>
            )}
          </div>
          {serials.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              עדיין לא נסרקו יחידות
            </p>
          ) : (
            <ul className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto p-3">
              {serials.map((serial) => (
                <li
                  key={serial}
                  dir="ltr"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2 py-0.5 font-mono text-xs"
                  data-testid="serial-receive-chip"
                >
                  {serial}
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                    onClick={() => setSerials((current) => current.filter((s) => s !== serial))}
                    aria-label={`הסרת ${serial}`}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {overExisting && (
          <p className="text-xs font-medium text-destructive">
            נסרקו יותר יחידות מהמלאי שבלי מספר — לסחורה חדשה השתמשו ב"קליטת סחורה".
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            onClick={() => void submit()}
            disabled={busy || serials.length === 0 || overExisting}
            data-testid="serial-receive-submit"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PackagePlus className="size-4" />
            )}
            {mode === "receive"
              ? `קליטת ${serials.length} יחידות למלאי`
              : `רישום ${serials.length} יחידות`}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
