import { useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  CheckCircle2,
  Clock,
  Headphones,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Paperclip,
  Phone,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InfoPage } from "@/components/legal/InfoPage";
import { RichContent } from "@/components/legal/RichContent";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { taxIdCaption, useLegalIdentity } from "@/hooks/useLegalIdentity";
import { submitContactMessage } from "@/lib/site-forms.functions";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_HINT,
  attachmentProblem,
  CONTACT_LIMITS,
  contactProblems,
  formatBytes,
  type ContactField,
  type ContactInput,
} from "@/lib/site-forms";

export const Route = createFileRoute("/contact")({
  ssr: false,
  head: () => ({ meta: [{ title: "צור קשר" }] }),
  component: ContactPage,
});

const EMPTY: ContactInput = { fullName: "", phone: "", email: "", message: "", orderNumber: "" };

/**
 * צור קשר (חלק 16א): מימין — פרטי העסק (כתובת, טלפון, שעות פעילות) והשם
 * המשפטי עם ח.פ / מספר עוסק; משמאל — טופס פנייה עם קובץ מצורף אופציונלי.
 */
function ContactPage() {
  return (
    <InfoPage
      title="צור קשר"
      icon={<MessageSquare aria-hidden="true" />}
      intro="יש לכם שאלה, בקשה או הערה? השאירו פרטים ונחזור אליכם בהקדם."
      wide
    >
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <BusinessDetails />
        <ContactForm />
      </div>
    </InfoPage>
  );
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className="text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

function BusinessDetails() {
  const { settings } = useSiteSettings();
  const identity = useLegalIdentity();
  const phone = settings?.business_phone?.trim() ?? "";
  const support = settings?.support_phone?.trim() ?? "";
  const email = settings?.business_email?.trim() ?? "";
  const address = settings?.business_address?.trim() ?? "";
  const hours = settings?.business_hours?.trim() ?? "";
  const telHref = (value: string) => `tel:${value.replace(/[^\d+]/g, "")}`;
  const nothing = settings !== null && !phone && !support && !email && !address && !hours;

  return (
    <Card className="shadow-card md:sticky md:top-[calc(var(--site-header-h,0px)+1rem)]">
      <CardHeader>
        <CardTitle className="text-base">פרטי העסק</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings === null && <p className="text-sm text-muted-foreground">טוען...</p>}
        {address && (
          <DetailRow icon={<MapPin />} label="כתובת">
            <p>{address}</p>
            <a
              href={`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              ניווט ב-Waze
            </a>
          </DetailRow>
        )}
        {phone && (
          <DetailRow icon={<Phone />} label="טלפון">
            <a
              href={telHref(phone)}
              dir="ltr"
              className="font-semibold text-primary hover:underline"
            >
              {phone}
            </a>
          </DetailRow>
        )}
        {support && support !== phone && (
          <DetailRow icon={<Headphones />} label="שירות לקוחות">
            <a
              href={telHref(support)}
              dir="ltr"
              className="font-semibold text-primary hover:underline"
            >
              {support}
            </a>
          </DetailRow>
        )}
        {email && (
          <DetailRow icon={<Mail />} label="אימייל">
            <a
              href={`mailto:${email}`}
              dir="ltr"
              className="font-semibold text-primary hover:underline"
            >
              {email}
            </a>
          </DetailRow>
        )}
        {hours && (
          <DetailRow icon={<Clock />} label="שעות פעילות">
            <p className="whitespace-pre-line leading-6">{hours}</p>
          </DetailRow>
        )}
        {settings?.contact_content?.trim() && (
          <RichContent content={settings.contact_content} className="text-sm sm:text-sm" />
        )}
        {nothing && <p className="text-sm text-muted-foreground">אפשר לפנות אלינו בטופס שבעמוד.</p>}

        {identity && (identity.businessName || identity.taxId) && (
          <div className="flex gap-3 border-t border-border pt-4">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
              <Building2 />
            </span>
            <div className="min-w-0 space-y-0.5 text-sm">
              {identity.businessName && <p className="font-semibold">{identity.businessName}</p>}
              {identity.taxId && (
                <p className="text-muted-foreground">
                  {taxIdCaption(identity.businessType)}:{" "}
                  <span dir="ltr" className="numeric">
                    {identity.taxId}
                  </span>
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

function ContactForm() {
  const submit = useServerFn(submitContactMessage);
  const [form, setForm] = useState<ContactInput>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ContactField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const patch = (next: Partial<ContactInput>) => {
    setForm((current) => ({ ...current, ...next }));
    setErrors((current) => {
      const copy = { ...current };
      for (const key of Object.keys(next) as ContactField[]) delete copy[key];
      return copy;
    });
  };

  const pickFile = (picked: File | undefined) => {
    if (!picked) return;
    const problem = attachmentProblem(picked);
    if (problem) {
      setErrors((current) => ({ ...current, attachment: problem }));
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setErrors(({ attachment: _drop, ...rest }) => rest);
    setFile(picked);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const problems = contactProblems(form);
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      const first = Object.keys(problems)[0];
      document.getElementById(`c-${first}`)?.focus();
      return;
    }
    const data = new FormData();
    data.set("fullName", form.fullName.trim());
    data.set("phone", form.phone.trim());
    data.set("email", form.email.trim());
    data.set("message", form.message.trim());
    data.set("orderNumber", form.orderNumber.trim());
    data.set("website", honeypot.current?.value ?? "");
    if (file) data.set("attachment", file, file.name);
    setBusy(true);
    try {
      const result = await submit({ data });
      setSent(result.reference);
      setForm(EMPTY);
      clearFile();
    } catch (thrown) {
      setFormError(thrown instanceof Error ? thrown.message : "שליחת הפנייה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Card className="shadow-card">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center" role="status">
          <CheckCircle2 className="size-12 text-emerald-600" aria-hidden="true" />
          <p className="text-lg font-bold">הפנייה נשלחה — תודה!</p>
          <p className="text-sm text-muted-foreground">
            נחזור אליכם בהקדם. מספר הפנייה:{" "}
            <span dir="ltr" className="font-semibold text-foreground">
              {sent}
            </span>
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button variant="outline" onClick={() => setSent(null)}>
              שליחת פנייה נוספת
            </Button>
            <Button asChild variant="ghost">
              <Link to="/">חזרה לחנות</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const describedBy = (field: ContactField) => (errors[field] ? `c-${field}-error` : undefined);

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base">שליחת פנייה</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" noValidate onSubmit={(event) => void onSubmit(event)}>
          <div className="space-y-1.5">
            <Label htmlFor="c-fullName">
              שם מלא <span className="text-destructive">*</span>
            </Label>
            <Input
              id="c-fullName"
              autoComplete="name"
              maxLength={CONTACT_LIMITS.name.max}
              value={form.fullName}
              onChange={(event) => patch({ fullName: event.target.value })}
              aria-invalid={errors.fullName ? true : undefined}
              aria-describedby={describedBy("fullName")}
            />
            <FieldError id="c-fullName-error" message={errors.fullName} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">
                טלפון <span className="text-destructive">*</span>
              </Label>
              <Input
                id="c-phone"
                type="tel"
                dir="ltr"
                autoComplete="tel"
                inputMode="tel"
                maxLength={20}
                value={form.phone}
                onChange={(event) => patch({ phone: event.target.value })}
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={describedBy("phone")}
              />
              <FieldError id="c-phone-error" message={errors.phone} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">
                אימייל <span className="text-destructive">*</span>
              </Label>
              <Input
                id="c-email"
                type="email"
                dir="ltr"
                autoComplete="email"
                maxLength={254}
                value={form.email}
                onChange={(event) => patch({ email: event.target.value })}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={describedBy("email")}
              />
              <FieldError id="c-email-error" message={errors.email} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="c-orderNumber">
              מספר הזמנה{" "}
              <span className="text-xs font-normal text-muted-foreground">(לא חובה)</span>
            </Label>
            <Input
              id="c-orderNumber"
              dir="ltr"
              maxLength={CONTACT_LIMITS.orderNumber}
              value={form.orderNumber}
              onChange={(event) => patch({ orderNumber: event.target.value })}
              placeholder="למשל SH260000123"
              aria-invalid={errors.orderNumber ? true : undefined}
              aria-describedby={describedBy("orderNumber")}
            />
            <FieldError id="c-orderNumber-error" message={errors.orderNumber} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="c-message">
              תוכן הפנייה <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="c-message"
              rows={6}
              maxLength={CONTACT_LIMITS.message.max}
              value={form.message}
              onChange={(event) => patch({ message: event.target.value })}
              aria-invalid={errors.message ? true : undefined}
              aria-describedby={describedBy("message")}
            />
            <div className="flex justify-between gap-2">
              <FieldError id="c-message-error" message={errors.message} />
              <span className="numeric ms-auto text-xs text-muted-foreground">
                {form.message.length.toLocaleString("he-IL")}/
                {CONTACT_LIMITS.message.max.toLocaleString("he-IL")}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="c-attachment">
              קובץ מצורף{" "}
              <span className="text-xs font-normal text-muted-foreground">(לא חובה)</span>
            </Label>
            {file ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={clearFile}
                  aria-label="הסרת הקובץ"
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <Input
                id="c-attachment"
                ref={fileInput}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                onChange={(event) => pickFile(event.target.files?.[0])}
                aria-describedby="c-attachment-hint"
              />
            )}
            <p id="c-attachment-hint" className="text-xs text-muted-foreground">
              {ATTACHMENT_HINT}
            </p>
            <FieldError id="c-attachment-error" message={errors.attachment} />
          </div>

          {/* מלכודת לבוטים — מוסתר מבני אדם ומקוראי מסך */}
          <div aria-hidden="true" className="absolute -start-[10000px] h-px w-px overflow-hidden">
            <label htmlFor="c-website">אתר אינטרנט</label>
            <input id="c-website" ref={honeypot} name="website" tabIndex={-1} autoComplete="off" />
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <Button type="submit" className="w-full sm:w-auto" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy ? "שולח..." : "שליחת הפנייה"}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            הפרטים משמשים רק למענה לפנייה — ראו{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              מדיניות הפרטיות
            </Link>
            .
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
