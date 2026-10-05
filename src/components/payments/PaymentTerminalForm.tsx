import { useEffect, useState } from "react";
import {
  Check,
  CircleCheck,
  CircleX,
  Copy,
  CreditCard,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Save,
  ShieldQuestion,
  Unplug,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  hypReturnUrl,
  hypWebhookUrl,
  type PaymentSettings,
  type PaymentTestResult,
} from "@/lib/payments";
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
 *
 * Hyp דורש שלושה פרטים: מספר מסוף (Masof), סיסמת API (PassP) ומפתח API
 * (KEY) — המפתח מזהה את האתר והסיסמה מאשרת אותו, כמו שם משתמש וסיסמה.
 *
 * "בדיקת סליקה": חיוב אמיתי של ₪1 בכרטיס של המנהל דרך דף התשלום של Hyp, כדי
 * לוודא שהפרטים נכונים ושהכסף עובר. התוצאה האחרונה מוצגת כאן.
 */
export function PaymentTerminalForm({
  idPrefix,
  settings,
  withEnableSwitch,
  maxPaymentsOptions,
  onSave,
  onDisconnect,
  onTest,
  onCheckConnection,
  returnOrigin,
}: {
  idPrefix: string;
  settings: PaymentSettings | null;
  withEnableSwitch: boolean;
  maxPaymentsOptions: number[];
  onSave: (values: TerminalFormValues) => Promise<void>;
  onDisconnect: () => Promise<void>;
  /** מעבר לדף התשלום של Hyp לחיוב בדיקה של ₪1 */
  onTest: () => Promise<void>;
  /** בדיקת חיבור בלי חיוב: האם Hyp מקבל את הפרטים השמורים */
  onCheckConnection: () => Promise<{ ok: boolean; message: string }>;
  /** הדומיין להצגת כתובת החזרה שמגדירים במסוף */
  returnOrigin: string;
}) {
  const [terminal, setTerminal] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [maxPayments, setMaxPayments] = useState(maxPaymentsOptions[0] ?? 1);
  const [busy, setBusy] = useState<"save" | "disconnect" | "test" | "check" | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [testOpen, setTestOpen] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setTerminal(settings.terminal ?? "");
    // חלק 16ב: כל עוד הסליקה סגורה במערכת — אי אפשר להדליק (המסד גם חוסם)
    setEnabled(settings.live ? (settings.terminal ? settings.enabled : true) : false);
    setMaxPayments(settings.maxPayments);
    setPassword("");
    setApiKey("");
  }, [settings]);

  const connected = Boolean(settings?.terminal && settings.hasPassword && settings.hasKey);
  const returnUrl = hypReturnUrl(returnOrigin);
  const webhookUrl = hypWebhookUrl(returnOrigin);
  /** הסליקה פתוחה במערכת (המתג הראשי) — null בזמן הטעינה */
  const live = settings ? settings.live : null;

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

  const runCheck = async () => {
    setBusy("check");
    setCheck(null);
    try {
      setCheck(await onCheckConnection());
    } catch (thrown) {
      setCheck({
        ok: false,
        message: thrown instanceof Error ? thrown.message : "הבדיקה נכשלה",
      });
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy("test");
    try {
      await onTest();
      // בהצלחה הדפדפן עובר לדף התשלום של Hyp
    } catch {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* ---------- מה צריך לקבל מ-MAX ---------- */}
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <ShieldQuestion className="size-4 text-sky-700 dark:text-sky-300" aria-hidden="true" />
          אילו פרטים מבקשים מ-MAX? שלושה:
        </p>
        <ol className="space-y-1.5 text-xs leading-5 text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground">1. מספר מסוף (Hyp/MAX)</span> — המספר של
            המסוף שלכם (Masof), בדרך כלל 10 ספרות.
          </li>
          <li>
            <span className="font-semibold text-foreground">2. סיסמת מסוף</span> — סיסמת ה-API
            (PassP) שמוגדרת במסוף לעסקאות דרך האתר. זו לא הסיסמה שאיתה נכנסים לממשק של MAX.
          </li>
          <li>
            <span className="font-semibold text-foreground">3. מפתח API (KEY)</span> — מחרוזת ארוכה
            של אותיות ומספרים (בערך 40 תווים).
          </li>
        </ol>
        <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Hyp דורש גם את המפתח וגם את הסיסמה: המפתח מזהה את האתר, והסיסמה מאשרת אותו — כמו שם משתמש
          וסיסמה. בלי שניהם חברת הסליקה לא תיצור את דף התשלום.
        </p>
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          שם המשתמש והסיסמה שאיתם נכנסים לאפליקציה / לממשק של Hyp אינם פרטי ה-API — אל תזינו אותם
          כאן. בקשו מהתמיכה של Hyp / MAX את "מפתח API (KEY)" ואת "סיסמת API (PassP)" לחיבור דף תשלום
          לאתר.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-dashed bg-secondary/40 p-4">
        <p className="text-sm font-semibold">כתובות להגדרה במסוף ב-Hyp</p>
        <div className="space-y-1.5">
          <p className="text-xs leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">דף הצלחה וגם דף כישלון</span> — אליה
            הלקוח חוזר אחרי התשלום, והשרת מאמת מול Hyp שהתשלום אמיתי.
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
        <div className="space-y-1.5">
          <p className="text-xs leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">הודעת שרת אחרי תשלום (Webhook)</span> —
            אם במסוף יש אפשרות כזו: Hyp מודיע לשרת שלנו ישירות, כך שההזמנה מסומנת "שולמה" גם אם
            הלקוח סגר את הדפדפן לפני שחזר לאתר.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-lg border bg-background px-3 py-2 text-sm"
            >
              {webhookUrl}
            </code>
            <CopyValueButton value={webhookUrl} label="העתקת הכתובת" copiedText="הכתובת הועתקה" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-terminal`}>1. מספר מסוף (Hyp/MAX)</Label>
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
          <Label htmlFor={`${idPrefix}-password`}>2. סיסמת מסוף (סיסמת API — PassP)</Label>
          <Input
            id={`${idPrefix}-password`}
            type="password"
            dir="ltr"
            autoComplete="new-password"
            placeholder={settings?.hasPassword ? "שמורה — השאירו ריק כדי לא לשנות" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            הסיסמה לעסקאות דרך האתר — לא סיסמת הכניסה לממשק.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-key`}>3. מפתח API (KEY)</Label>
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
          <p className="text-[11px] text-muted-foreground">מחרוזת ארוכה (כ-40 תווים).</p>
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
            live === false && "opacity-70",
          )}
        >
          <span className="space-y-0.5">
            <span className="block font-semibold">סליקה פעילה בקופה</span>
            <span className="block text-xs text-muted-foreground">
              בקופה תופיע ללקוח האפשרות "תשלום באשראי (מאובטח)" לצד "תשלום מול נציג". הזמנה באשראי
              נכנסת לטיפול רק אחרי שהתשלום אושר. כבוי — הקופה עובדת כמו קודם. מומלץ להפעיל אחרי
              בדיקת סליקה מוצלחת.
            </span>
            {live === false && (
              <span className="block text-xs font-semibold text-amber-700 dark:text-amber-300">
                הסליקה באשראי עדיין לא נפתחה במערכת — ממתינה לאישור סופי של חברת האשראי. אפשר כבר
                עכשיו לשמור את פרטי המסוף ולבדוק את החיבור.
              </span>
            )}
          </span>
          <Switch
            id={`${idPrefix}-enabled`}
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={live === false}
          />
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

      {/* ---------- בדיקת סליקה ₪1 ---------- */}
      {connected && (
        <div className="space-y-3 rounded-xl border-2 border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900 dark:bg-sky-950/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="flex items-center gap-2 font-semibold">
                <CreditCard className="size-4 text-sky-700 dark:text-sky-300" aria-hidden="true" />
                בדיקת סליקה — חיוב של ₪1
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                מחייבים את הכרטיס שלכם ב-₪1 בדף התשלום האמיתי, ובודקים שהחיוב עבר ואומת. כך יודעים
                בוודאות שהמסוף מחובר ושהלקוחות יוכלו לשלם.
              </p>
            </div>
            <Button
              type="button"
              className="bg-sky-700 text-white hover:bg-sky-800"
              disabled={busy !== null}
              onClick={() => setTestOpen(true)}
            >
              {busy === "test" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CreditCard className="size-4" />
              )}
              חיוב בדיקה של ₪1
            </Button>
          </div>
          <LastTestLine test={settings?.lastTest ?? null} />

          <div className="flex flex-wrap items-center gap-2 border-t border-sky-200 pt-3 dark:border-sky-900">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void runCheck()}
            >
              {busy === "check" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wifi className="size-4" />
              )}
              בדיקת חיבור מול Hyp (בלי חיוב)
            </Button>
            <span className="text-xs text-muted-foreground">
              בודק שמספר המסוף, הסיסמה והמפתח נכונים — בלי לפתוח דף תשלום ובלי לחייב.
            </span>
          </div>
          {check && (
            <p
              role="status"
              className={cn(
                "flex items-start gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold",
                check.ok
                  ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {check.ok ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              {check.message}
            </p>
          )}
        </div>
      )}

      <Dialog
        open={testOpen}
        onOpenChange={(next) => !next && busy !== "test" && setTestOpen(false)}
      >
        <DialogContent dir="rtl" className="text-right sm:max-w-md">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="size-5 text-sky-700" aria-hidden="true" />
              בדיקת סליקה — ₪1
            </DialogTitle>
            <DialogDescription>מה עומד לקרות:</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm leading-6">
            <li className="flex gap-2">
              <Check className="mt-1 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              תועברו לדף התשלום המאובטח של Hyp עם המסוף ששמרתם.
            </li>
            <li className="flex gap-2">
              <Check className="mt-1 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              הזינו את כרטיס האשראי שלכם — יחויב ₪1 בלבד (עסקה אמיתית).
            </li>
            <li className="flex gap-2">
              <Check className="mt-1 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              בסיום תחזרו לכאן ותראו אם החיוב עבר ואומת מול חברת האשראי.
            </li>
            <li className="flex gap-2 text-muted-foreground">
              <Info className="mt-1 size-4 shrink-0" aria-hidden="true" />
              השקל נכנס לחשבון של אותו מסוף (בניכוי עמלה). אפשר לבטל את העסקה בממשק של MAX / Hyp.
            </li>
          </ul>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="sm:flex-1"
              disabled={busy === "test"}
              onClick={() => setTestOpen(false)}
            >
              ביטול
            </Button>
            <Button
              type="button"
              className="bg-sky-700 font-bold text-white hover:bg-sky-800 sm:flex-[2]"
              disabled={busy === "test"}
              onClick={() => void runTest()}
            >
              {busy === "test" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CreditCard className="size-4" />
              )}
              מעבר לתשלום של ₪1
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "בדיקה אחרונה: עברה בהצלחה · עסקה 123 · 5 באוקטובר 14:32" */
function LastTestLine({ test }: { test: PaymentTestResult | null }) {
  if (!test) {
    return <p className="text-xs text-muted-foreground">עוד לא בוצעה בדיקה.</p>;
  }
  const when = new Date(test.completedAt ?? test.createdAt).toLocaleString("he-IL", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  if (test.status === "paid") {
    return (
      <p
        role="status"
        className="flex flex-wrap items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
      >
        <CircleCheck className="size-4" aria-hidden="true" />
        בדיקה אחרונה: החיוב עבר ואומת — הסליקה עובדת תקין
        <span className="text-xs font-normal">
          · עסקה <span dir="ltr">{test.transactionId}</span>
          {test.cardLast4 && (
            <>
              {" "}
              · כרטיס <span dir="ltr">****{test.cardLast4}</span>
            </>
          )}{" "}
          · {when}
        </span>
      </p>
    );
  }
  if (test.status === "pending") {
    return (
      <p className="text-xs text-muted-foreground">
        בדיקה אחרונה ({when}) לא הושלמה — דף התשלום נפתח אבל לא חזרתם ממנו.
      </p>
    );
  }
  return (
    <p
      role="status"
      className="flex flex-wrap items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
    >
      <CircleX className="size-4" aria-hidden="true" />
      בדיקה אחרונה ({when}) נכשלה
      {test.error && <span className="text-xs font-normal">· {test.error}</span>}
    </p>
  );
}
