// "תשלום מאורחים" (מיגרציה 37): איך האורחים משלמים לעסק — העברה בנקאית, Bit, תשלום בטלפון והוראות
// משלכם. האורח רואה את ההוראות בעמוד ההזמנה שלו רק אחרי שההזמנה אושרה. בעלי העסק בלבד משנים (המסד
// אוכף — מנהל לא יכול להפנות תשלומים לחשבון אחר); מנהלים רואים לקריאה. ההוראות אינן אישור תשלום:
// ההזמנה מסומנת כשולמה רק אחרי שרושמים תשלום שהתקבל.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Loader2, Lock, MessageSquareText, Phone, Smartphone } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Switch, cn } from "@/platform/ui";
import {
  hospitalityPaymentSettings,
  hospitalitySavePaymentSettings,
} from "../../api/payment-instructions.functions";
import type { PaymentSettingsView } from "../../types/payment-instructions";
import { PAYMENT_LIMITS, paymentFormErrors } from "../../validation/payment-instructions";
import { errorText } from "../catalog/refresh";
import { TextAreaField, TextField } from "../lib/fields";
import { manageKeys } from "../lib/query-keys";
import { ErrorState, SectionCard, SkeletonBlock } from "../ui/kit";
import {
  changesFrom,
  formFromView,
  guestPreview,
  paymentSettingsKey,
  valuesOf,
  type PaymentForm,
} from "./payment-model";

export function PaymentInstructionsCard() {
  const query = useQuery({
    queryKey: paymentSettingsKey,
    queryFn: () => hospitalityPaymentSettings(),
    refetchOnWindowFocus: false,
  });
  // מדריך ההקמה מוביל לכאן (#payments) — גלילה אחרי שהכרטיס נטען
  const loaded = !!query.data;
  useEffect(() => {
    if (loaded && window.location.hash === "#payments")
      document.getElementById("settings-payments")?.scrollIntoView({ block: "start" });
  }, [loaded]);

  return (
    <SectionCard
      id="settings-payments"
      title="תשלום מאורחים"
      description="איך האורחים משלמים לכם. אין סליקה באתר: האורח רואה את ההוראות בעמוד ההזמנה שלו אחרי שאישרתם, וההזמנה מסומנת כשולמה רק אחרי שרושמים תשלום שהתקבל."
      className="scroll-mt-20"
    >
      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <SkeletonBlock className="h-48 w-full" />
      ) : (
        <PaymentFormView key={query.data.revision} view={query.data} />
      )}
    </SectionCard>
  );
}

function PaymentFormView({ view }: { view: PaymentSettingsView }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PaymentForm>(() => formFromView(view));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(() => (view.note ?? "").trim().length > 0);
  const editable = view.editable;
  const changes = changesFrom(view, form);
  const dirty = Object.keys(changes).length > 0;
  const errors = paymentFormErrors(valuesOf(form));
  const hasErrors = Object.keys(errors).length > 0;
  const set = <K extends keyof PaymentForm>(k: K, v: PaymentForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const preview = guestPreview(form, view.business_phone);

  const save = async () => {
    if (!dirty || hasErrors) return;
    setBusy(true);
    setError(null);
    try {
      const next = await hospitalitySavePaymentSettings({
        data: { changes, revision: view.revision },
      });
      qc.setQueryData(paymentSettingsKey, next);
      void qc.invalidateQueries({ queryKey: [...manageKeys.all, "setup"] });
      toast.success("פרטי התשלום נשמרו");
    } catch (e) {
      const msg = errorText(e);
      setError(msg);
      if (/השתנו בינתיים/.test(msg)) void qc.invalidateQueries({ queryKey: paymentSettingsKey });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) void save();
      }}
    >
      {!editable && (
        <p className="flex items-center gap-2 rounded-lg bg-[var(--hm-surface-2)] px-3 py-2 text-sm">
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          רק בעלי העסק יכולים לשנות את פרטי התשלום. כאן רואים מה האורחים יקבלו.
        </p>
      )}
      <fieldset disabled={!editable || busy} className="flex flex-col gap-3">
        <legend className="sr-only">אמצעי התשלום</legend>

        <Method
          id="method-bank"
          icon={<Landmark className="size-5" aria-hidden="true" />}
          title="העברה בנקאית"
          hint="האורח רואה את פרטי החשבון ואת מספר ההזמנה כאסמכתא"
          on={form.bank_enabled}
          onToggle={(v) => set("bank_enabled", v)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              idPrefix="pay"
              name="bank_name"
              label="בנק"
              value={form.bank_name}
              onChange={(v) => set("bank_name", v.slice(0, PAYMENT_LIMITS.bankName))}
              error={errors.bank_name}
              placeholder="למשל: בנק הפועלים"
            />
            <TextField
              idPrefix="pay"
              name="bank_branch"
              label="סניף"
              value={form.bank_branch}
              onChange={(v) => set("bank_branch", v.replace(/[^\d]/g, "").slice(0, 4))}
              error={errors.bank_branch}
              dir="ltr"
            />
            <TextField
              idPrefix="pay"
              name="bank_account"
              label="מספר חשבון"
              value={form.bank_account}
              onChange={(v) => set("bank_account", v.replace(/[^\d-]/g, "").slice(0, 20))}
              error={errors.bank_account}
              dir="ltr"
            />
            <TextField
              idPrefix="pay"
              name="bank_holder"
              label="על שם"
              value={form.bank_holder}
              onChange={(v) => set("bank_holder", v.slice(0, PAYMENT_LIMITS.holder))}
              error={errors.bank_holder}
            />
          </div>
        </Method>

        <Method
          id="method-bit"
          icon={<Smartphone className="size-5" aria-hidden="true" />}
          title="Bit"
          hint="האורח רואה את מספר הטלפון להעברה ב-Bit"
          on={form.bit_enabled}
          onToggle={(v) => set("bit_enabled", v)}
        >
          <TextField
            idPrefix="pay"
            name="bit_phone"
            label="טלפון נייד ל-Bit"
            type="tel"
            dir="ltr"
            value={form.bit_phone}
            onChange={(v) => set("bit_phone", v.slice(0, 14))}
            error={errors.bit_phone}
            placeholder="05X-XXXXXXX"
          />
        </Method>

        <Method
          id="method-phone"
          icon={<Phone className="size-5" aria-hidden="true" />}
          title="תשלום בטלפון"
          hint="נציג העסק מתקשר וגובה בכרטיס אשראי במסוף שלכם (כמו היום)"
          on={form.phone_enabled}
          onToggle={(v) => set("phone_enabled", v)}
        >
          <TextField
            idPrefix="pay"
            name="phone_number"
            label="טלפון שהאורח יכול להתקשר אליו (לא חובה)"
            type="tel"
            dir="ltr"
            value={form.phone_number}
            onChange={(v) => set("phone_number", v.slice(0, 20))}
            error={errors.phone_number}
            hint={
              view.business_phone
                ? `בלי מספר — מוצג טלפון העסק (${view.business_phone})`
                : "בלי מספר — הנציג מתקשר לאורח"
            }
          />
        </Method>

        <Method
          id="method-note"
          icon={<MessageSquareText className="size-5" aria-hidden="true" />}
          title="הוראות משלכם"
          hint="לא חובה — למשל: מזומן בהגעה, העברה מחו״ל, מתי צריך לשלם"
          on={noteOpen}
          onToggle={(v) => {
            setNoteOpen(v);
            if (!v) set("note", "");
          }}
        >
          <TextAreaField
            idPrefix="pay"
            name="note"
            label="ההוראות"
            value={form.note}
            onChange={(v) => set("note", v.slice(0, PAYMENT_LIMITS.note))}
            error={errors.note}
            hint={`${form.note.trim().length} / ${PAYMENT_LIMITS.note} תווים`}
            rows={3}
          />
        </Method>
      </fieldset>

      <div className="rounded-xl border bg-[var(--hm-surface-2)] p-4 text-sm" aria-live="polite">
        <p className="font-semibold">כך האורח יראה, אחרי שתאשרו את ההזמנה</p>
        {preview.length ? (
          <ul className="mt-2 list-disc space-y-1 ps-5 text-muted-foreground">
            {preview.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted-foreground">
            אין אמצעי תשלום פעיל — האורח יראה רק את הסכום לתשלום. מומלץ להשאיר לפחות אמצעי אחד.
          </p>
        )}
        <p className="mt-2 text-muted-foreground">
          ההוראות אינן אישור תשלום: ההזמנה תסומן כשולמה רק אחרי שתרשמו בעמוד ההזמנה תשלום שהתקבל.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" className="min-h-11 gap-2" disabled={!dirty || hasErrors || busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            שמירת פרטי התשלום
          </Button>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={busy}
              onClick={() => setForm(formFromView(view))}
            >
              ביטול השינויים
            </Button>
          )}
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {hasErrors ? "יש שדות לתיקון" : dirty ? "יש שינויים שלא נשמרו" : ""}
          </span>
        </div>
      )}
    </form>
  );
}

function Method({
  id,
  icon,
  title,
  hint,
  on,
  onToggle,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  hint: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        on ? "border-[var(--hm-lagoon-500)]/40 bg-card" : "bg-[var(--hm-surface-2)]",
      )}
      data-method={id}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-[var(--hm-lagoon-700)]">{icon}</span>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-sm font-semibold">
            {title}
          </label>
          <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
            {hint}
          </p>
        </div>
        <Switch id={id} checked={on} onCheckedChange={onToggle} aria-describedby={`${id}-hint`} />
      </div>
      {on && <div className="mt-3">{children}</div>}
    </div>
  );
}
