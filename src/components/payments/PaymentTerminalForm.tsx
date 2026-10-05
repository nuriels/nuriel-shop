import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Lock, Save, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hypReturnUrl, type PaymentSettings } from "@/lib/payments";
import { cn } from "@/lib/utils";

/** העתקת ערך ללוח — עם גיבוי כשאין הרשאת לוח (http) */
export function CopyValueButton({
  value,
  label,
  copiedText = "הועתק",
}: {
  value: string;
  label: string;
  copiedText?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(copiedText);
          window.setTimeout(() => setCopied(false), 2500);
        } catch {
          toast.info(value);
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "הועתק!" : label}
    </Button>
  );
}

export type TerminalFormValues = {
  terminal: string;
  password: string;
  apiKey: string;
  enabled: boolean;
  maxPayments: number;
};

/**
 * הטופס של פרטי המסוף ב-Hyp — משותף לחנות ("אמצעי תשלום וסליקה") ולפאנל
 * הפלטפורמה. הסיסמה והמפתח לא חוזרים מהשרת אף פעם: שדה ריק = להשאיר את
 * הקיים. בחנות יש גם מתג "סליקה פעילה בקופה".
 */
export function PaymentTerminalForm({
  idPrefix,
  settings,
  withEnableSwitch,
  maxPaymentsOptions,
  onSave,
  onDisconnect,
  returnOrigin,
}: {
  idPrefix: string;
  settings: PaymentSettings | null;
  withEnableSwitch: boolean;
  maxPaymentsOptions: number[];
  onSave: (values: TerminalFormValues) => Promise<void>;
  onDisconnect: () => Promise<void>;
  /** הדומיין להצגת כתובת החזרה שמגדירים במסוף */
  returnOrigin: string;
}) {
  const [terminal, setTerminal] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [maxPayments, setMaxPayments] = useState(maxPaymentsOptions[0] ?? 1);
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null);

  useEffect(() => {
    if (!settings) return;
    setTerminal(settings.terminal ?? "");
    setEnabled(settings.terminal ? settings.enabled : true);
    setMaxPayments(settings.maxPayments);
    setPassword("");
    setApiKey("");
  }, [settings]);

  const connected = Boolean(settings?.terminal && settings.hasPassword && settings.hasKey);
  const returnUrl = hypReturnUrl(returnOrigin);

  const save = async () => {
    setBusy("save");
    try {
      await onSave({ terminal, password, apiKey, enabled, maxPayments });
      setPassword("");
      setApiKey("");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2 rounded-xl border border-dashed bg-secondary/40 p-4">
        <p className="text-sm font-semibold">כתובת החזרה — להגדרה במסוף ב-Hyp</p>
        <p className="text-xs leading-5 text-muted-foreground">
          בהגדרות המסוף ב-Hyp (או דרך נציג MAX) הגדירו את הכתובת הזו גם כ"דף הצלחה" וגם כ"דף
          כישלון". אליה הלקוח חוזר אחרי התשלום, והשרת מאמת מול Hyp שהתשלום אמיתי.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code
            dir="ltr"
            className="min-w-0 flex-1 truncate rounded-lg border bg-background px-3 py-2 text-sm"
          >
            {returnUrl}
          </code>
          <CopyValueButton value={returnUrl} label="העתקת הכתובת" copiedText="הכתובת הועתקה" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-terminal`}>מספר המסוף (Masof)</Label>
          <Input
            id={`${idPrefix}-terminal`}
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0010131918"
            value={terminal}
            onChange={(e) => setTerminal(e.target.value.replace(/[^0-9]/g, "").slice(0, 12))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-max`}>מקסימום תשלומים ללקוח</Label>
          <Select value={String(maxPayments)} onValueChange={(v) => setMaxPayments(Number(v))}>
            <SelectTrigger id={`${idPrefix}-max`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              {maxPaymentsOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 1 ? "תשלום אחד (בלי תשלומים)" : `עד ${n} תשלומים`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-password`}>סיסמת ה-API (PassP)</Label>
          <Input
            id={`${idPrefix}-password`}
            type="password"
            dir="ltr"
            autoComplete="new-password"
            placeholder={settings?.hasPassword ? "שמורה — השאירו ריק כדי לא לשנות" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-key`}>מפתח ה-API (KEY)</Label>
          <Input
            id={`${idPrefix}-key`}
            type="password"
            dir="ltr"
            autoComplete="new-password"
            placeholder={
              settings?.hasKey ? `שמור (${settings.keyHint ?? "…"}) — ריק = לא לשנות` : ""
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        הסיסמה והמפתח נשמרים בשרת בלבד, לא מוצגים שוב ולא נשלחים לדפדפן. כל התקשורת עם חברת האשראי
        מתבצעת מהשרת.
      </p>

      {withEnableSwitch && (
        <label
          htmlFor={`${idPrefix}-enabled`}
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl border p-4",
            enabled ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20" : "",
          )}
        >
          <span className="space-y-0.5">
            <span className="block font-semibold">סליקה פעילה בקופה</span>
            <span className="block text-xs text-muted-foreground">
              הזמנות של לקוחות ישולמו באשראי לפני שהן נכנסות לטיפול. כבוי — הקופה עובדת כמו קודם
              (תיאום תשלום מול הלקוח).
            </span>
          </span>
          <Switch id={`${idPrefix}-enabled`} checked={enabled} onCheckedChange={setEnabled} />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void save()} disabled={busy !== null || !terminal}>
          {busy === "save" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          שמירת פרטי המסוף
        </Button>
        {connected && (
          <Button
            type="button"
            variant="outline"
            className="text-destructive"
            disabled={busy !== null}
            onClick={async () => {
              if (!window.confirm("לנתק את המסוף? הסיסמה והמפתח יימחקו מהשרת.")) return;
              setBusy("disconnect");
              try {
                await onDisconnect();
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "disconnect" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Unplug className="size-4" />
            )}
            ניתוק המסוף
          </Button>
        )}
        {connected && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <KeyRound className="size-3.5" aria-hidden="true" />
            מפתח שמור: <span dir="ltr">{settings?.keyHint}</span>
          </span>
        )}
      </div>
    </div>
  );
}
