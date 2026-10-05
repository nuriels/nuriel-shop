import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, RefreshCw, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InfoPage, LoadingLine } from "@/components/legal/InfoPage";
import { RichContent } from "@/components/legal/RichContent";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { legalContentOrDefault } from "@/lib/legal-content";
import {
  getCancellationCaptcha,
  submitCancellationRequest,
  type CancellationResult,
} from "@/lib/site-forms.functions";
import {
  CANCELLATION_LIMITS,
  cancellationProblems,
  type CancellationField,
  type CancellationInput,
  type Captcha,
} from "@/lib/site-forms";

type Search = {
  /** מספר הזמנה למילוי מראש (קישור "ביטול עסקה" מההזמנה) */
  order?: string | undefined;
};

export const Route = createFileRoute("/cancellations")({
  ssr: false,
  head: () => ({ meta: [{ title: "ביטול עסקה" }] }),
  validateSearch: (search: Record<string, unknown>): Search => {
    const order = search["order"];
    return typeof order === "string" && /^[A-Za-z0-9_/#\s-]{1,40}$/.test(order) ? { order } : {};
  },
  component: CancellationsPage,
});

/**
 * ביטול עסקה (חלק 16א): בראש העמוד — מדיניות הביטולים מהפאנל; מתחת — טופס
 * הודעת ביטול עם שאלת אימות. ההודעה נשמרת כתיעוד אצל בעל החנות, והלקוח
 * מקבל אישור קבלה במייל.
 */
function CancellationsPage() {
  const { settings } = useSiteSettings();
  const { order } = Route.useSearch();
  return (
    <InfoPage
      title="ביטול עסקה"
      icon={<RotateCcw aria-hidden="true" />}
      intro="מדיניות הביטולים של האתר, וטופס למסירת הודעת ביטול עסקה."
    >
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">מדיניות ביטולים</CardTitle>
        </CardHeader>
        <CardContent>
          {settings ? (
            <RichContent
              content={legalContentOrDefault("cancellation", settings.cancellation_policy_content)}
            />
          ) : (
            <LoadingLine />
          )}
        </CardContent>
      </Card>
      <CancellationForm initialOrder={order ?? ""} />
    </InfoPage>
  );
}

const fieldId = (field: CancellationField) => `x-${field}`;

function FieldError({ field, message }: { field: CancellationField; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={`${fieldId(field)}-error`} className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

function CancellationForm({ initialOrder }: { initialOrder: string }) {
  const loadCaptcha = useServerFn(getCancellationCaptcha);
  const submit = useServerFn(submitCancellationRequest);
  const [form, setForm] = useState<CancellationInput>({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    message: "",
    orderNumber: initialOrder,
  });
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [errors, setErrors] = useState<Partial<Record<CancellationField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<(CancellationResult & { email: string }) | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);

  const newCaptcha = useCallback(async () => {
    setAnswer("");
    try {
      setCaptcha(await loadCaptcha());
      setCaptchaError(null);
    } catch (thrown) {
      setCaptcha(null);
      setCaptchaError(thrown instanceof Error ? thrown.message : "טעינת שאלת האימות נכשלה");
    }
  }, [loadCaptcha]);

  useEffect(() => {
    void newCaptcha();
  }, [newCaptcha]);

  const patch = (next: Partial<CancellationInput>) => {
    setForm((current) => ({ ...current, ...next }));
    setErrors((current) => {
      const copy = { ...current };
      for (const key of Object.keys(next) as CancellationField[]) delete copy[key];
      return copy;
    });
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const problems = cancellationProblems(form);
    if (!/^\s*-?\d{1,3}\s*$/.test(answer.normalize("NFKC"))) {
      problems.captcha = "נא לענות על שאלת האימות (מספר)";
    }
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      const first = Object.keys(problems)[0] as CancellationField;
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    if (!captcha) {
      await newCaptcha();
      return;
    }
    setBusy(true);
    try {
      const result = await submit({
        data: {
          ...form,
          captchaToken: captcha.token,
          captchaAnswer: answer,
          website: honeypot.current?.value ?? "",
        },
      });
      setDone({ ...result, email: form.email.trim() });
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : "שליחת הודעת הביטול נכשלה";
      if (/אימות/.test(message)) setErrors((current) => ({ ...current, captcha: message }));
      else setFormError(message);
      // כל ניסיון "שורף" את התרגיל — מביאים חדש
      await newCaptcha();
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card className="border-emerald-300 shadow-card dark:border-emerald-800">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center" role="status">
          <CheckCircle2 className="size-12 text-emerald-600" aria-hidden="true" />
          <p className="text-lg font-bold">הודעת הביטול התקבלה</p>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">מספר הזמנה</dt>
            <dd dir="ltr" className="font-semibold">
              {done.orderNumber}
            </dd>
            <dt className="text-muted-foreground">מועד קבלת ההודעה</dt>
            <dd className="font-semibold">
              {new Date(done.receivedAt).toLocaleString("he-IL", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </dd>
            <dt className="text-muted-foreground">אסמכתה</dt>
            <dd dir="ltr" className="font-semibold">
              {done.reference}
            </dd>
          </dl>
          <p className="max-w-md text-sm text-muted-foreground">
            {done.confirmationSent
              ? `אישור על קבלת ההודעה נשלח ל-${done.email}. `
              : "שמרו את מספר האסמכתה. "}
            נבדוק את הבקשה ונחזור אליכם בהקדם.
          </p>
          <Button asChild variant="outline" className="mt-2">
            <Link to="/">חזרה לחנות</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const describedBy = (field: CancellationField) =>
    errors[field] ? `${fieldId(field)}-error` : undefined;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base">טופס ביטול עסקה</CardTitle>
        <CardDescription>מלאו את הפרטים ואת מספר ההזמנה. אין חובה לנמק את הביטול.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" noValidate onSubmit={(event) => void onSubmit(event)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("firstName")}>
                שם פרטי <span className="text-destructive">*</span>
              </Label>
              <Input
                id={fieldId("firstName")}
                autoComplete="given-name"
                maxLength={CANCELLATION_LIMITS.name.max}
                value={form.firstName}
                onChange={(event) => patch({ firstName: event.target.value })}
                aria-invalid={errors.firstName ? true : undefined}
                aria-describedby={describedBy("firstName")}
              />
              <FieldError field="firstName" message={errors.firstName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("lastName")}>
                שם משפחה <span className="text-destructive">*</span>
              </Label>
              <Input
                id={fieldId("lastName")}
                autoComplete="family-name"
                maxLength={CANCELLATION_LIMITS.name.max}
                value={form.lastName}
                onChange={(event) => patch({ lastName: event.target.value })}
                aria-invalid={errors.lastName ? true : undefined}
                aria-describedby={describedBy("lastName")}
              />
              <FieldError field="lastName" message={errors.lastName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("phone")}>
                טלפון <span className="text-destructive">*</span>
              </Label>
              <Input
                id={fieldId("phone")}
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                value={form.phone}
                onChange={(event) => patch({ phone: event.target.value })}
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={describedBy("phone")}
              />
              <FieldError field="phone" message={errors.phone} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("email")}>
                אימייל <span className="text-destructive">*</span>
              </Label>
              <Input
                id={fieldId("email")}
                type="email"
                dir="ltr"
                autoComplete="email"
                maxLength={254}
                value={form.email}
                onChange={(event) => patch({ email: event.target.value })}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={describedBy("email")}
              />
              <FieldError field="email" message={errors.email} />
            </div>
          </div>

          <div className="space-y-1.5 sm:max-w-xs">
            <Label htmlFor={fieldId("orderNumber")}>
              מספר הזמנה <span className="text-destructive">*</span>
            </Label>
            <Input
              id={fieldId("orderNumber")}
              dir="ltr"
              maxLength={CANCELLATION_LIMITS.orderNumber}
              value={form.orderNumber}
              onChange={(event) => patch({ orderNumber: event.target.value })}
              placeholder="למשל SH260000123"
              aria-invalid={errors.orderNumber ? true : undefined}
              aria-describedby={describedBy("orderNumber")}
            />
            <FieldError field="orderNumber" message={errors.orderNumber} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={fieldId("message")}>
              תוכן ההודעה / סיבת הביטול{" "}
              <span className="text-xs font-normal text-muted-foreground">(לא חובה)</span>
            </Label>
            <Textarea
              id={fieldId("message")}
              rows={4}
              maxLength={CANCELLATION_LIMITS.message}
              value={form.message}
              onChange={(event) => patch({ message: event.target.value })}
              aria-invalid={errors.message ? true : undefined}
              aria-describedby={describedBy("message")}
            />
            <FieldError field="message" message={errors.message} />
          </div>

          {/* שאלת אימות (Captcha) */}
          <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
            <Label htmlFor={fieldId("captcha")} className="flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              שאלת אימות <span className="text-destructive">*</span>
            </Label>
            {captchaError ? (
              <p className="text-sm text-destructive">{captchaError}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">כמה זה</span>
                <span
                  dir="ltr"
                  className="numeric rounded-md bg-background px-2.5 py-1 font-bold tracking-wide shadow-sm"
                  aria-live="polite"
                >
                  {captcha ? `${captcha.question} = ?` : "…"}
                </span>
                <Input
                  id={fieldId("captcha")}
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  className="h-9 w-20 text-center"
                  value={answer}
                  onChange={(event) => {
                    setAnswer(event.target.value);
                    setErrors(({ captcha: _drop, ...rest }) => rest);
                  }}
                  aria-invalid={errors.captcha ? true : undefined}
                  aria-describedby={describedBy("captcha")}
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => void newCaptcha()}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <RefreshCw className="size-3" aria-hidden="true" />
              תרגיל אחר
            </button>
            <FieldError field="captcha" message={errors.captcha} />
          </div>

          {/* מלכודת לבוטים — מוסתר מבני אדם ומקוראי מסך */}
          <div aria-hidden="true" className="absolute -start-[10000px] h-px w-px overflow-hidden">
            <label htmlFor="x-website">אתר אינטרנט</label>
            <input id="x-website" ref={honeypot} name="website" tabIndex={-1} autoComplete="off" />
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy ? "שולח..." : "שליחת הודעת ביטול"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
