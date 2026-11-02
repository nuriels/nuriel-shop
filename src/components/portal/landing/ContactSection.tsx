import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, Mail, MapPin, Phone } from "lucide-react";
import {
  CONTACT_LIMITS,
  contactProblems,
  type ContactField,
  type ContactInput,
} from "@/lib/site-forms";
import { submitContactMessage } from "@/lib/site-forms.functions";
import {
  CONTACT_TOPICS,
  MAPS_URL,
  NURIEL_BUSINESS,
  contactMessage,
  fullAddress,
  mailHref,
  telHref,
  whatsappHref,
} from "@/lib/portal-landing";
import { NewTabNote, SectionHeading, WhatsAppIcon } from "./parts";
import { EXTERNAL, ctaGold, ctaOutline } from "./styles";

const inputClass =
  "block min-h-12 w-full rounded-xl border border-(--l-line) bg-white px-4 text-base text-(--l-ink) placeholder:text-(--l-muted)/70 focus-visible:border-(--l-blue) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--l-blue)/30 aria-[invalid=true]:border-[#b42318]";

/**
 * צור קשר — טופס "צור קשר" הקיים של האתר (submitContactMessage, בלי שינוי): הפנייה נשמרת
 * בתיבת הפניות של אתר השער, והמנהלים שלו מקבלים מייל. מלכודת לבוטים (website) והגבלת קצב —
 * בשרת. בצד — ערוצים ישירים: WhatsApp, טלפון, מייל וכתובת.
 */
export function ContactSection() {
  const submit = useServerFn(submitContactMessage);
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    topic: CONTACT_TOPICS[0] as string,
    message: "",
    website: "",
  });
  const [errors, setErrors] = useState<Partial<Record<ContactField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const set = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    const input: ContactInput = {
      fullName: form.fullName,
      phone: form.phone,
      email: form.email,
      message: form.message,
      orderNumber: "",
    };
    const problems = contactProblems(input);
    if (Object.values(problems).some(Boolean)) {
      setErrors(problems);
      const first = (["fullName", "phone", "email", "message"] as const).find((k) => problems[k]);
      if (first) document.getElementById(`landing-contact-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const data = new FormData();
      data.set("fullName", form.fullName.trim());
      data.set("phone", form.phone.trim());
      data.set("email", form.email.trim());
      data.set("message", contactMessage(form.topic, form.message));
      data.set("orderNumber", "");
      data.set("website", form.website);
      const result = await submit({ data });
      setSent(result.reference);
    } catch (thrown) {
      setFailure(
        thrown instanceof Error && thrown.message
          ? thrown.message
          : "שליחת הפנייה נכשלה. נסו שוב בעוד רגע, או כתבו לנו ב-WhatsApp.",
      );
    } finally {
      setBusy(false);
    }
  };

  const field = (key: "fullName" | "phone" | "email" | "message") => ({
    id: `landing-contact-${key}`,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `landing-contact-${key}-error` : undefined,
  });
  const errorFor = (key: "fullName" | "phone" | "email" | "message") =>
    errors[key] ? (
      <p id={`landing-contact-${key}-error`} className="mt-1.5 text-sm font-medium text-[#b42318]">
        {errors[key]}
      </p>
    ) : null;

  return (
    <section id="contact" aria-labelledby="contact-title" className="scroll-mt-20 bg-(--l-paper)">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <SectionHeading
          id="contact-title"
          title="דברו איתנו"
          lead="שאלה על מחשב, תיקון, חנות אינטרנטית או אתר לצימר? השאירו פרטים ונחזור אליכם — או כתבו לנו ב-WhatsApp."
        />

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-2xl border border-(--l-line) bg-white p-6 sm:p-8">
            {sent ? (
              <div
                role="status"
                className="flex flex-col items-start gap-3"
                data-testid="contact-sent"
              >
                <CheckCircle2 className="size-9 text-[#0f7d6f]" aria-hidden="true" />
                <p className="text-xl font-bold text-(--l-ink)">הפנייה נשלחה — תודה!</p>
                <p className="text-base leading-7 text-(--l-muted)">
                  נחזור אליכם בהקדם. מספר הפנייה:{" "}
                  <bdi className="font-semibold text-(--l-ink)">{sent}</bdi>
                </p>
              </div>
            ) : (
              <form
                noValidate
                onSubmit={onSubmit}
                aria-labelledby="contact-title"
                className="grid gap-5"
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="landing-contact-fullName"
                      className="mb-1.5 block font-semibold text-(--l-ink)"
                    >
                      שם מלא
                    </label>
                    <input
                      {...field("fullName")}
                      autoComplete="name"
                      maxLength={CONTACT_LIMITS.name.max}
                      value={form.fullName}
                      onChange={(e) => set("fullName", e.target.value)}
                      className={inputClass}
                      required
                    />
                    {errorFor("fullName")}
                  </div>
                  <div>
                    <label
                      htmlFor="landing-contact-phone"
                      className="mb-1.5 block font-semibold text-(--l-ink)"
                    >
                      טלפון
                    </label>
                    <input
                      {...field("phone")}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      dir="ltr"
                      maxLength={20}
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      className={`${inputClass} text-end`}
                      required
                    />
                    {errorFor("phone")}
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="landing-contact-email"
                    className="mb-1.5 block font-semibold text-(--l-ink)"
                  >
                    אימייל
                  </label>
                  <input
                    {...field("email")}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    dir="ltr"
                    maxLength={254}
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    className={`${inputClass} text-end`}
                    required
                  />
                  {errorFor("email")}
                </div>
                <div>
                  <label
                    htmlFor="landing-contact-topic"
                    className="mb-1.5 block font-semibold text-(--l-ink)"
                  >
                    במה נוכל לעזור?
                  </label>
                  <select
                    id="landing-contact-topic"
                    value={form.topic}
                    onChange={(e) => set("topic", e.target.value)}
                    className={inputClass}
                  >
                    {CONTACT_TOPICS.map((topic) => (
                      <option key={topic} value={topic}>
                        {topic}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="landing-contact-message"
                    className="mb-1.5 block font-semibold text-(--l-ink)"
                  >
                    ההודעה
                  </label>
                  <textarea
                    {...field("message")}
                    rows={5}
                    maxLength={CONTACT_LIMITS.message.max}
                    value={form.message}
                    onChange={(e) => set("message", e.target.value)}
                    className={`${inputClass} py-3 leading-7`}
                    required
                  />
                  {errorFor("message")}
                </div>
                {/* מלכודת לבוטים — מוסתרת מגולשים ומקוראי מסך */}
                <div
                  aria-hidden="true"
                  className="absolute -start-[9999px] h-px w-px overflow-hidden"
                >
                  <label htmlFor="landing-contact-website">אתר</label>
                  <input
                    id="landing-contact-website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={form.website}
                    onChange={(e) => set("website", e.target.value)}
                  />
                </div>

                {failure && (
                  <p
                    role="alert"
                    className="rounded-xl bg-[#fef3f2] px-4 py-3 text-[0.95rem] font-medium text-[#b42318]"
                  >
                    {failure}
                  </p>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="submit"
                    disabled={busy}
                    className={`${ctaGold} disabled:opacity-70`}
                  >
                    {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    {busy ? "שולחים…" : "שליחת הפנייה"}
                  </button>
                  <p className="text-sm leading-6 text-(--l-muted)">
                    הפרטים משמשים רק כדי לחזור אליכם.{" "}
                    <a
                      href="/privacy"
                      className="font-medium text-(--l-blue) underline underline-offset-4"
                    >
                      מדיניות הפרטיות
                    </a>
                  </p>
                </div>
              </form>
            )}
          </div>

          <div>
            <h3 className="text-xl font-bold text-(--l-ink)">או ישירות</h3>
            <ul className="mt-5 space-y-3">
              <li>
                <a
                  href={whatsappHref()}
                  {...EXTERNAL}
                  className={`${ctaOutline} w-full justify-start`}
                  data-testid="contact-whatsapp"
                >
                  <WhatsAppIcon className="size-5 text-[#0f7d6f]" />
                  WhatsApp
                  <span dir="ltr" className="ms-auto text-(--l-muted)">
                    {NURIEL_BUSINESS.phone}
                  </span>
                  <NewTabNote />
                </a>
              </li>
              <li>
                <a href={telHref()} className={`${ctaOutline} w-full justify-start`}>
                  <Phone className="size-4" aria-hidden="true" />
                  טלפון
                  <span dir="ltr" className="ms-auto text-(--l-muted)">
                    {NURIEL_BUSINESS.phone}
                  </span>
                </a>
              </li>
              <li>
                <a href={mailHref()} className={`${ctaOutline} w-full justify-start`}>
                  <Mail className="size-4" aria-hidden="true" />
                  מייל
                  <span dir="ltr" className="ms-auto truncate text-(--l-muted)">
                    {NURIEL_BUSINESS.email}
                  </span>
                </a>
              </li>
            </ul>
            <p className="mt-6 flex items-start gap-2 text-[0.95rem] leading-7 text-(--l-muted)">
              <MapPin className="mt-1 size-4 shrink-0 text-(--l-blue)" aria-hidden="true" />
              <span>
                {NURIEL_BUSINESS.name}, {fullAddress()} ·{" "}
                <a
                  href={MAPS_URL}
                  {...EXTERNAL}
                  className="font-medium text-(--l-blue) underline underline-offset-4"
                >
                  ניווט בגוגל מפות
                  <NewTabNote />
                </a>
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
