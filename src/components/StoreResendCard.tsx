import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  removeStoreEmailProvider,
  saveStoreEmailProvider,
  type StoreEmailProviderState,
} from "@/lib/notifications.functions";
import { cn } from "@/lib/utils";

const EMAIL_FORMAT = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const KEY_FORMAT = /^re_[A-Za-z0-9_-]{8,200}$/;

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "";

const DOMAIN_STATUS: Record<
  NonNullable<StoreEmailProviderState["domainStatus"]>,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  verified: {
    label: "הדומיין מאומת ב-Resend",
    className:
      "border-green-500 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200",
    icon: CheckCircle2,
  },
  unverified: {
    label: "ממתין לאימות הדומיין ב-Resend",
    className:
      "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
    icon: Clock,
  },
  unknown: {
    label: "מפתח שליחה בלבד — הדומיין לא נבדק",
    className: "border-sky-400 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
    icon: Clock,
  },
};

/**
 * "חשבון Resend משלכם" (חלק 17): מנהל החנות מזין מפתח API של Resend וכתובת
 * שולח על הדומיין שלו. המפתח נבדק מול Resend בשמירה, נשמר בשרת בלבד, והדפדפן
 * רואה רק את 4 התווים האחרונים. אישורי ההזמנה ללקוחות יוצאים אז מהכתובת של
 * החנות; אם השליחה דרך החשבון של החנות נכשלת — היא יוצאת דרך הפלטפורמה.
 */
export function StoreResendCard({
  state,
  onChange,
}: {
  state: StoreEmailProviderState | null;
  onChange: (next: StoreEmailProviderState) => void;
}) {
  const save = useServerFn(saveStoreEmailProvider);
  const remove = useServerFn(removeStoreEmailProvider);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [senderEmail, setSenderEmail] = useState(state?.senderEmail ?? "");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setSenderEmail(state?.senderEmail ?? "");
  }, [state?.senderEmail]);

  if (!state) {
    return (
      <Card className="shadow-card">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          טוען את חשבון השליחה של החנות...
        </CardContent>
      </Card>
    );
  }

  const trimmedKey = apiKey.trim();
  const sender = senderEmail.trim().toLowerCase();
  const senderDomain = sender.split("@")[1] ?? "";
  const keyProblem =
    trimmedKey === ""
      ? state.configured
        ? null
        : "הדביקו את מפתח ה-API מחשבון ה-Resend שלכם"
      : KEY_FORMAT.test(trimmedKey)
        ? null
        : "מפתח API של Resend מתחיל ב-re_ (העתיקו אותו מ-API Keys בחשבון ה-Resend)";
  const senderProblem =
    sender === ""
      ? "נא להזין כתובת שולח"
      : !EMAIL_FORMAT.test(sender)
        ? "כתובת השולח אינה תקינה (למשל orders@my-shop.co.il)"
        : senderDomain === state.platformDomain || senderDomain.endsWith(`.${state.platformDomain}`)
          ? `כתובת על ${state.platformDomain} שייכת לפלטפורמה — בחרו כתובת על הדומיין שלכם`
          : null;
  const dirty = trimmedKey !== "" || sender !== (state.senderEmail ?? "");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (keyProblem || senderProblem) {
      toast.error(keyProblem ?? senderProblem);
      return;
    }
    setBusy("save");
    setMessage(null);
    try {
      const result = await save({ data: { apiKey: trimmedKey, senderEmail: sender } });
      onChange(result.state);
      setApiKey("");
      setShowKey(false);
      setMessage({ ok: true, text: result.message });
      toast.success("חשבון ה-Resend של החנות נשמר");
    } catch (error) {
      const text = error instanceof Error ? error.message : "השמירה נכשלה";
      setMessage({ ok: false, text });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (
      !window.confirm(
        "להסיר את מפתח ה-Resend של החנות? המיילים ימשיכו לצאת דרך מערכת השליחה של הפלטפורמה.",
      )
    ) {
      return;
    }
    setBusy("remove");
    setMessage(null);
    try {
      onChange(await remove({ data: {} }));
      setApiKey("");
      toast.success("המפתח הוסר — המיילים יוצאים דרך הפלטפורמה");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ההסרה נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const domainStatus = state.domainStatus ? DOMAIN_STATUS[state.domainStatus] : null;
  const DomainIcon = domainStatus?.icon ?? Clock;

  return (
    <Card id="store-resend" className="shadow-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <KeyRound className="size-4" aria-hidden="true" />
          חשבון Resend משלכם
          <span className="text-xs font-normal text-muted-foreground">(לא חובה)</span>
          {state.configured && (
            <Badge
              variant="outline"
              className="border-green-500 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200"
            >
              מחובר
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="leading-6 text-muted-foreground">
          ברירת המחדל: המיילים יוצאים ממערכת השליחה של הפלטפורמה. אם יש לכם חשבון ב-
          <span dir="ltr">Resend</span> עם דומיין מאומת — הזינו כאן את מפתח ה-API, ואישורי ההזמנה
          ללקוחות (ומייל "ההזמנה יצאה למשלוח") יישלחו מהכתובת שלכם, למשל{" "}
          <span dir="ltr" className="font-medium text-foreground">
            orders@my-shop.co.il
          </span>
          . אם השליחה דרך החשבון שלכם תיכשל — המייל יישלח אוטומטית דרך הפלטפורמה, כדי שהלקוח יקבל
          אותו בכל מקרה.
        </p>

        {state.configured && (
          <ul className="space-y-1.5 rounded-lg border border-border bg-secondary p-3 text-xs">
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <CheckCircle2 className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <span>מפתח שמור:</span>
              <code dir="ltr" className="font-mono font-semibold text-foreground">
                {state.keyHint}
              </code>
              <span>· שולח:</span>
              <span dir="ltr" className="font-semibold text-foreground">
                {state.senderEmail}
              </span>
            </li>
            {domainStatus && (
              <li className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("gap-1", domainStatus.className)}>
                  <DomainIcon className="size-3.5" aria-hidden="true" />
                  {domainStatus.label}
                </Badge>
                {state.checkedAt && (
                  <span className="text-muted-foreground">נבדק: {formatDate(state.checkedAt)}</span>
                )}
              </li>
            )}
            {state.lastError && (
              <li
                role="alert"
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  השליחה האחרונה דרך החשבון שלכם נכשלה
                  {state.lastErrorAt ? ` (${formatDate(state.lastErrorAt)})` : ""} — המייל נשלח
                  בגיבוי דרך הפלטפורמה.
                  <span
                    dir="ltr"
                    className="mt-0.5 block break-words text-left font-mono text-[11px]"
                  >
                    {state.lastError}
                  </span>
                </span>
              </li>
            )}
            {!state.platformReady && (
              <li className="flex items-center gap-2 text-destructive">
                <XCircle className="size-4 shrink-0" aria-hidden="true" />
                אין גיבוי: מערכת השליחה של הפלטפורמה לא מוגדרת בשרת.
              </li>
            )}
          </ul>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="resend-key">מפתח API של Resend</Label>
            <div className="flex max-w-md gap-1.5">
              <Input
                id="resend-key"
                type={showKey ? "text" : "password"}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                maxLength={220}
                className="text-left font-mono"
                placeholder={state.configured ? (state.keyHint ?? "") : "re_xxxxxxxxxxxx"}
                aria-invalid={trimmedKey !== "" && keyProblem !== null}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={showKey ? "הסתרת המפתח" : "הצגת המפתח"}
                onClick={() => setShowKey((current) => !current)}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            {trimmedKey !== "" && keyProblem ? (
              <p className="text-xs font-medium text-destructive">{keyProblem}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {state.configured ? "השאירו ריק כדי לשמור את המפתח הקיים. " : ""}
                ב-Resend: <span dir="ltr">API Keys → Create API Key</span> (הרשאת{" "}
                <span dir="ltr">Sending access</span> מספיקה).{" "}
                <a
                  href="https://resend.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                >
                  לחשבון ה-Resend
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="resend-sender">כתובת השולח (על הדומיין שאימתתם ב-Resend)</Label>
            <Input
              id="resend-sender"
              type="email"
              dir="ltr"
              autoComplete="off"
              maxLength={254}
              className="max-w-md text-left"
              placeholder="orders@my-shop.co.il"
              aria-invalid={sender !== "" && senderProblem !== null}
              value={senderEmail}
              onChange={(event) => setSenderEmail(event.target.value)}
            />
            {sender !== "" && senderProblem ? (
              <p className="text-xs font-medium text-destructive">{senderProblem}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                הדומיין צריך להיות מאומת ב-<span dir="ltr">Resend → Domains</span>. שם השולח יהיה שם
                החנות. תשובות של לקוחות יגיעו לאימייל העסק מ"הגדרות אתר".
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              disabled={busy !== null || !dirty || keyProblem !== null || senderProblem !== null}
            >
              {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy === "save" ? "בודק מול Resend..." : "שמירה ובדיקה מול Resend"}
            </Button>
            {state.configured && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy !== null}
                onClick={() => void disconnect()}
              >
                {busy === "remove" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                הסרת המפתח (חזרה לפלטפורמה)
              </Button>
            )}
          </div>
        </form>

        {message && (
          <div
            role={message.ok ? "status" : "alert"}
            className={cn(
              "flex items-start gap-2 rounded-lg border p-3",
              message.ok
                ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200"
                : "border-destructive/40 bg-destructive/5 text-destructive",
            )}
          >
            {message.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            <span dir="auto">{message.text}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
