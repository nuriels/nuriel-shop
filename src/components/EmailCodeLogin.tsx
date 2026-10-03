import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Loader2, Mail, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { requestLoginCode, verifyLoginCode } from "@/lib/login-code.functions";

export type CodeLoginTokens = { accessToken: string; refreshToken: string; isNew: boolean };

/**
 * התחברות / הרשמה בקוד למייל: מזינים אימייל → מקבלים קוד בן 6 ספרות →
 * מזינים אותו ונכנסים. אין חשבון? הקוד פותח חשבון חדש, והלקוח משלים את
 * פרטי העסק במסך הבא (כמו בהרשמה עם Google).
 */
export function EmailCodeLogin({
  initialEmail = "",
  disabled = false,
  onSuccess,
}: {
  initialEmail?: string;
  disabled?: boolean;
  onSuccess: (tokens: CodeLoginTokens) => Promise<void>;
}) {
  const requestCode = useServerFn(requestLoginCode);
  const verifyCode = useServerFn(verifyLoginCode);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [expiresIn, setExpiresIn] = useState(10);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // מניעת אימות כפול (השלמת 6 ספרות + לחיצה על "כניסה" באותו רגע)
  const verifying = useRef(false);

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  // ספירה לאחור עד שאפשר לבקש קוד חדש
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = async () => {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("נא להזין כתובת אימייל תקינה");
      return;
    }
    setBusy("send");
    setError(null);
    try {
      const result = await requestCode({ data: { email: address } });
      setMaskedEmail(result.maskedEmail);
      setExpiresIn(result.expiresInMinutes);
      setCooldown(result.resendAfterSeconds);
      setCode("");
      setStep("code");
      toast.success("הקוד נשלח למייל");
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "שליחת הקוד נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value: string) => {
    if (value.length !== 6 || verifying.current) return;
    verifying.current = true;
    setBusy("verify");
    setError(null);
    try {
      const tokens = await verifyCode({ data: { email: email.trim().toLowerCase(), code: value } });
      await onSuccess(tokens);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "אימות הקוד נכשל");
      setCode("");
    } finally {
      verifying.current = false;
      setBusy(null);
    }
  };

  if (step === "email") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="code-email">אימייל</Label>
          <Input
            id="code-email"
            type="email"
            dir="ltr"
            required
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
          />
          <p className="text-xs text-muted-foreground">
            נשלח אליך קוד חד-פעמי בן 6 ספרות. אין לך חשבון? הקוד יפתח לך חשבון חדש.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" size="lg" disabled={disabled || busy !== null}>
          {busy === "send" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Mail className="size-4" />
          )}
          {busy === "send" ? "שולח קוד..." : "שליחת קוד למייל"}
        </Button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
      className="space-y-4"
    >
      <div className="space-y-1 rounded-lg border border-border bg-secondary/60 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <ShieldCheck className="size-4 shrink-0 text-accent" aria-hidden="true" />
          שלחנו קוד בן 6 ספרות אל:
        </p>
        <p dir="ltr" className="text-right font-semibold text-foreground">
          {maskedEmail}
        </p>
        <p className="text-xs text-muted-foreground">
          הקוד תקף ל-{expiresIn} דקות. לא הגיע? כדאי לבדוק גם בתיקיית הספאם.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="login-code" className="block text-center">
          הקוד מהמייל
        </Label>
        <div dir="ltr" className="flex justify-center">
          <InputOTP
            id="login-code"
            maxLength={6}
            inputMode="numeric"
            pattern="^[0-9]*$"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            disabled={busy === "verify"}
            onChange={(value) => {
              setCode(value);
              setError(null);
            }}
            onComplete={(value: string) => void verify(value)}
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot key={index} index={index} className="size-12 text-xl font-bold" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-center text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={disabled || code.length !== 6 || busy !== null}
      >
        {busy === "verify" ? <Loader2 className="size-4 animate-spin" /> : null}
        {busy === "verify" ? "מאמת..." : "כניסה"}
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
          disabled={cooldown > 0 || busy !== null}
          onClick={() => void send()}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {cooldown > 0 ? `שליחה חוזרת בעוד ${cooldown} שניות` : "שליחת קוד חדש"}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          disabled={busy !== null}
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
          }}
        >
          <ArrowRight className="size-3.5" aria-hidden="true" />
          שינוי כתובת
        </button>
      </div>
    </form>
  );
}
