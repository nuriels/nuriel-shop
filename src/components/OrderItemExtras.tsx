import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, KeyRound, Loader2, MailCheck, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendDigitalLicense } from "@/lib/license.functions";
import {
  ITEM_STATUS_TONE,
  LICENSE_KEY_MAX,
  itemStatusLabel,
  licenseKeyProblem,
  normalizeLicenseKey,
  type OrderItemStatus,
  type OrderShippingKind,
} from "@/lib/shipping";
import { formatOrderDate } from "@/lib/orders";
import { cn } from "@/lib/utils";

/** תג הסטטוס של שורה בהזמנה ("ממתין לשליח", "נמסר במייל"...) */
export function ItemStatusBadge({
  status,
  shippingKind,
  className,
}: {
  status: OrderItemStatus | null | undefined;
  shippingKind?: OrderShippingKind | null | undefined;
  className?: string;
}) {
  const label = itemStatusLabel(status, shippingKind);
  if (!status || !label) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        ITEM_STATUS_TONE[status],
        className,
      )}
    >
      {label}
    </span>
  );
}

/** תג "דיגיטלי" */
export function DigitalBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-200",
        className,
      )}
    >
      <KeyRound className="size-3" aria-hidden="true" />
      דיגיטלי
    </span>
  );
}

/** מפתח הרישיון ללקוח — עם העתקה בלחיצה */
export function LicenseKeyDisplay({ licenseKey }: { licenseKey: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(licenseKey);
      setCopied(true);
      toast.success("מפתח הרישיון הועתק");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("ההעתקה לא הצליחה — סמנו את המפתח והעתיקו ידנית");
    }
  };
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-lg border-2 border-dashed border-accent/50 bg-accent/5 p-2">
      <KeyRound className="size-4 shrink-0 text-accent" aria-hidden="true" />
      <code
        dir="ltr"
        className="min-w-0 flex-1 select-all break-all text-left font-mono text-sm font-bold text-foreground"
      >
        {licenseKey}
      </code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="shrink-0"
        onClick={() => void copy()}
        aria-label="העתקת מפתח הרישיון"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

/**
 * הזנת רישיון ושליחה ללקוח (מנהל): שדה טקסט ליד המוצר + "שלח רישיון".
 * השמירה, המייל והסטטוס "נמסר במייל" — בשרת (sendDigitalLicense).
 */
export function LicenseSender({
  itemId,
  initialKey,
  sentAt,
  sentTo,
  disabled,
  onSent,
}: {
  itemId: string;
  initialKey: string | null | undefined;
  sentAt: string | null | undefined;
  sentTo: string | null | undefined;
  /** הזמנה מבוטלת / בקשה להצעת מחיר */
  disabled?: boolean;
  onSent: () => void;
}) {
  const send = useServerFn(sendDigitalLicense);
  const [value, setValue] = useState(initialKey ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(initialKey ?? "");
  }, [initialKey]);

  const key = normalizeLicenseKey(value);
  const problem = licenseKeyProblem(key);
  const alreadySent = Boolean(sentAt);
  const unchangedAfterSend = alreadySent && key === (initialKey ?? "");

  const submit = async () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const result = await send({ data: { itemId, licenseKey: key } });
      if (result.sent) {
        toast.success(`הרישיון נשלח במייל ל-${result.to}`);
      } else {
        toast.warning(result.reason, { duration: 9000 });
      }
      onSent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת הרישיון נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex gap-1.5">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          dir="ltr"
          maxLength={LICENSE_KEY_MAX + 20}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          className="h-9 min-w-0 flex-1 text-left font-mono text-sm"
          disabled={disabled || busy}
          aria-label="מפתח רישיון"
        />
        <Button
          type="button"
          size="sm"
          className="h-9 shrink-0"
          disabled={disabled || busy || key === ""}
          variant={unchangedAfterSend ? "outline" : "default"}
          onClick={() => void submit()}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
          {alreadySent ? "שליחה חוזרת" : "שלח רישיון"}
        </Button>
      </div>
      {alreadySent ? (
        <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
          <MailCheck className="size-3.5" aria-hidden="true" />
          נשלח{sentTo ? ` ל-${sentTo}` : ""} · {formatOrderDate(sentAt ?? "")}
        </p>
      ) : key !== "" && problem ? (
        <p className="text-[11px] text-destructive">{problem}</p>
      ) : initialKey ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          המפתח נשמר אבל המייל עוד לא יצא — "שלח רישיון" לניסיון נוסף
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          עד {LICENSE_KEY_MAX} תווים. הלקוח יקבל מייל עם המפתח, והוא יופיע גם באזור האישי שלו.
        </p>
      )}
    </div>
  );
}
