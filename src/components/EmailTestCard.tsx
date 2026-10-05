import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendTestEmail } from "@/lib/email.functions";

type Outcome =
  | {
      ok: true;
      sentTo: string;
      fromName: string;
      fromAddress: string;
      replyTo: string | null;
      /** חלק 17: דרך איזה מפתח יצא המייל */
      provider: "tenant" | "platform" | null;
      fellBack: boolean;
      storeKeyError: string | null;
    }
  | { ok: false; reason: string };

/** הסבר קצר לשגיאות הנפוצות של Resend — מעל ההודעה הגולמית */
function explain(reason: string): string | null {
  if (/RESEND_API_KEY/.test(reason)) {
    return "מפתח ה-API של Resend לא הוגדר בשרת. מנהל הפלטפורמה צריך להגדיר אותו (פעם אחת לכל החנויות).";
  }
  if (/not verified|domain/i.test(reason)) {
    return "הדומיין של כתובת השולח לא מאומת בחשבון Resend. יש לאמת אותו (רשומות DNS) בלוח הבקרה של Resend.";
  }
  if (/401|403|api key is invalid|invalid_api_key/i.test(reason)) {
    return "Resend דחה את מפתח ה-API — ייתכן שהמפתח נמחק או הוזן לא נכון בשרת.";
  }
  if (/testing emails|own email address/i.test(reason)) {
    return "חשבון Resend במצב בדיקות: אפשר לשלוח רק לכתובת של בעל החשבון עד שמאמתים דומיין.";
  }
  return null;
}

/**
 * "בדיקת שליחת מייל": המנהל מזין כתובת (ברירת מחדל — הכתובת שלו), והמערכת
 * שולחת מייל טסט מהשולח של החנות ("שם החנות <orders@nuri1.fit>", או הכתובת
 * שעל הדומיין של החנות כשחשבון Resend שלה מחובר). התוצאה — הצלחה (ודרך איזה
 * מפתח), או השגיאה המדויקת של Resend עם הסבר מה לתקן.
 */
export function EmailTestCard({
  sender,
  onSent,
}: {
  sender: { name: string; address: string } | null;
  /** אחרי כל ניסיון (הצלחה או כישלון) — לרענון יומן ההתראות */
  onSent?: () => void;
}) {
  const runTest = useServerFn(sendTestEmail);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // ברירת מחדל: הכתובת של המנהל המחובר
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? "";
      setTo((current) => current || email);
    });
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setOutcome(null);
    try {
      const result = await runTest({ data: { to: to.trim() } });
      setOutcome({
        ok: true,
        sentTo: result.sentTo,
        fromName: result.fromName,
        fromAddress: result.fromAddress,
        replyTo: result.replyTo,
        provider: result.provider,
        fellBack: result.fellBack,
        storeKeyError: result.storeKeyError,
      });
    } catch (error) {
      setOutcome({
        ok: false,
        reason: error instanceof Error ? error.message : "שליחת מייל הבדיקה נכשלה",
      });
    } finally {
      setBusy(false);
      onSent?.();
    }
  };

  const hint = outcome && !outcome.ok ? explain(outcome.reason) : null;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="size-4" aria-hidden="true" />
          בדיקת שליחת מייל
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          שולחים מייל טסט לכל כתובת ורואים מיד אם המיילים של החנות יוצאים
          {sender ? (
            <>
              {" "}
              (מאת <span className="font-medium text-foreground">{sender.name}</span>{" "}
              <span dir="ltr" className="font-medium text-foreground">
                &lt;{sender.address}&gt;
              </span>
              )
            </>
          ) : null}
          .
        </p>
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="test-email-to" className="sr-only">
              כתובת לבדיקה
            </Label>
            <Input
              id="test-email-to"
              type="email"
              dir="ltr"
              required
              maxLength={254}
              placeholder="name@example.com"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || to.trim() === ""}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy ? "שולח..." : "שליחת מייל בדיקה"}
          </Button>
        </form>

        {outcome?.ok && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="space-y-0.5">
              <p className="font-medium">
                המייל נשלח אל{" "}
                <span dir="ltr" className="font-semibold">
                  {outcome.sentTo}
                </span>
              </p>
              <p className="text-xs">
                מאת: {outcome.fromName} <span dir="ltr">&lt;{outcome.fromAddress}&gt;</span>
                {outcome.replyTo ? (
                  <>
                    {" "}
                    · תשובות יגיעו אל: <span dir="ltr">{outcome.replyTo}</span>
                  </>
                ) : null}
              </p>
              {outcome.provider && (
                <p className="text-xs">
                  {outcome.provider === "tenant"
                    ? "נשלח דרך חשבון ה-Resend של החנות."
                    : "נשלח דרך מערכת השליחה של הפלטפורמה."}
                </p>
              )}
              {outcome.fellBack && (
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                  השליחה דרך חשבון ה-Resend שלכם נכשלה, ולכן המייל יצא בגיבוי דרך הפלטפורמה
                  {outcome.storeKeyError ? (
                    <span
                      dir="ltr"
                      className="mt-0.5 block break-words text-left font-mono text-[11px]"
                    >
                      {outcome.storeKeyError}
                    </span>
                  ) : (
                    "."
                  )}
                </p>
              )}
              <p className="text-xs">לא הגיע תוך דקה? כדאי לבדוק גם בתיקיית הספאם.</p>
            </div>
          </div>
        )}
        {outcome && !outcome.ok && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">{hint ?? "השליחה נכשלה"}</p>
              {/* השגיאה הגולמית של Resend (אנגלית / JSON) — משמאל לימין */}
              <p dir="ltr" className="break-words text-left font-mono text-[11px] opacity-90">
                {outcome.reason}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
