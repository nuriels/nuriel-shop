// מיגרציה 65: תיקון פרטי הלקוח בהזמנה / באירוע קיימים — שם, טלפון, אימייל. בכרטיס הלקוח (כל
// ההזמנות והאירועים שלו) או רק בהזמנה / באירוע הזה (כרטיס אחר: קיים לפי האימייל, או חדש). בלי הזמנה
// חדשה ובלי מחיקה. בהזמנה פעילה — אפשר לשלוח מיד את פרטי ההזמנה וקישור אישי חדש לכתובת המעודכנת.
// אחרי השמירה: מה בוטל (הקישור לכתובת הקודמת), מה נשלח, ומה עם החוזים (פתוח — לשלוח שוב; חתום —
// לא משתנה, אפשר להפיק חוזה מתוקן). הכל נבדק ונרשם במסד.
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, FileSignature, Send, UserPen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Input, Label, cn } from "@/platform/ui";
import {
  hospitalityBookingCustomerUpdate,
  hospitalityBookingResendDetails,
} from "../../api/bookings.functions";
import { hospitalityEventCustomerUpdate } from "../../api/events.functions";
import type {
  CustomerField,
  CustomerPatch,
  CustomerScope,
  CustomerUpdateResult,
} from "../../types/customer";
import { parseCustomerPatch } from "../../validation/customer";
import { FormSheet } from "../catalog/CatalogSheets";
import { errorText } from "../catalog/refresh";
import { CONTRACTS_KEY } from "../client-documents/model";
import { manageKeys } from "../lib/query-keys";

export type CustomerTarget =
  | {
      kind: "booking";
      id: string;
      number: number;
      revision: number;
      active: boolean;
      group: boolean;
    }
  | { kind: "event"; id: string; number: number; revision: number };

interface Current {
  full_name: string;
  phone: string | null;
  email: string | null;
}

const FIELD_TEXT: Record<CustomerField, string> = {
  full_name: "השם",
  phone: "הטלפון",
  email: "האימייל",
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** הכפתור + החלונית + הודעת התוצאה (שנשארת עד שסוגרים אותה) */
export function CustomerDetailsEditor({
  target,
  current,
  bookingsCount,
  onSaved,
}: {
  target: CustomerTarget;
  current: Current;
  /** כמה הזמנות יש לכרטיס (להסבר על "בכרטיס הלקוח") */
  bookingsCount?: number;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CustomerUpdateResult | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 gap-2"
          onClick={() => setOpen(true)}
          data-testid="customer-edit"
        >
          <UserPen className="size-4" aria-hidden="true" />
          תיקון פרטי הלקוח
        </Button>
        {target.kind === "booking" && target.active && current.email && (
          <ResendDetails bookingId={target.id} email={current.email} onSent={onSaved} />
        )}
      </div>
      {result && (
        <ResultNotice
          result={result}
          target={target}
          onClose={() => setResult(null)}
          onSent={onSaved}
        />
      )}
      {open && (
        <EditSheet
          target={target}
          current={current}
          bookingsCount={bookingsCount ?? 1}
          onClose={() => setOpen(false)}
          onSaved={(r) => {
            setOpen(false);
            setResult(r);
            onSaved();
          }}
        />
      )}
    </div>
  );
}

function ResendDetails({
  bookingId,
  email,
  onSent,
}: {
  bookingId: string;
  email: string;
  onSent: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11 gap-2"
      disabled={busy}
      data-testid="customer-resend-details"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await hospitalityBookingResendDetails({ data: { id: bookingId } });
          if (r.queued)
            toast.success(`פרטי ההזמנה וקישור אישי חדש נשלחים ל-${r.email_masked ?? email}`);
          else toast.error("לא נמצאה הזמנה פעילה לשליחה");
          onSent();
        } catch (e) {
          toast.error(errorText(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Send className="size-4" aria-hidden="true" />
      {busy ? "שולח…" : "שליחת פרטי ההזמנה שוב"}
    </Button>
  );
}

function EditSheet({
  target,
  current,
  bookingsCount,
  onClose,
  onSaved,
}: {
  target: CustomerTarget;
  current: Current;
  bookingsCount: number;
  onClose: () => void;
  onSaved: (r: CustomerUpdateResult) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(current.full_name);
  const [phone, setPhone] = useState(current.phone ?? "");
  const [email, setEmail] = useState(current.email ?? "");
  const [scope, setScope] = useState<CustomerScope>("guest");
  const [notifyChoice, setNotifyChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const patch: CustomerPatch = {};
  if (name.trim() !== current.full_name) patch.full_name = name.trim();
  if (phone.trim() !== (current.phone ?? "")) patch.phone = phone.trim();
  if (email.trim().toLowerCase() !== (current.email ?? "").toLowerCase())
    patch.email = email.trim() || null;
  const dirty = Object.keys(patch).length > 0;
  const emailChanged = "email" in patch;
  const canNotify = target.kind === "booking" && target.active && email.trim() !== "";
  // ברירת המחדל: כשהאימייל השתנה — לשלוח את הפרטים לכתובת החדשה
  const notify = canNotify && (notifyChoice ?? emailChanged);
  const nameError = name.trim().length < 2 ? "נא למלא את שם הלקוח" : null;
  const phoneError = phone.replace(/\D/g, "").length < 9 ? "מספר הטלפון לא תקין" : null;
  const emailError = email.trim() && !EMAIL.test(email.trim()) ? "כתובת האימייל לא תקינה" : null;
  const what = target.kind === "booking" ? "ההזמנה" : "האירוע";

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (nameError || phoneError || emailError) return;
    if (!dirty) {
      setError("לא שונה אף פרט");
      return;
    }
    let data: CustomerPatch;
    try {
      data = parseCustomerPatch(patch);
    } catch (e) {
      setError(errorText(e));
      return;
    }
    setBusy(true);
    try {
      const r =
        target.kind === "booking"
          ? await hospitalityBookingCustomerUpdate({
              data: { id: target.id, revision: target.revision, data: { ...data }, scope, notify },
            })
          : await hospitalityEventCustomerUpdate({
              data: { id: target.id, revision: target.revision, data: { ...data }, scope },
            });
      void qc.invalidateQueries({ queryKey: CONTRACTS_KEY });
      void qc.invalidateQueries({ queryKey: [...manageKeys.all, "guests"] });
      toast.success("פרטי הלקוח עודכנו");
      onSaved(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      open
      title={`תיקון פרטי הלקוח — ${target.kind === "booking" ? "הזמנה" : "אירוע"} #${target.number}`}
      description={`רק פרטי הלקוח משתנים — התאריכים, המחיר והמצב של ${what} לא משתנים, ושום דבר לא נמחק. כל שינוי נרשם בהיסטוריה.`}
      dirty={dirty}
      busy={busy}
      submitLabel="שמירת הפרטים"
      serverError={error}
      notice={null}
      hasErrors={Boolean(nameError || phoneError || emailError)}
      submitted={submitted}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="ce-name">שם מלא</Label>
        <Input
          id="ce-name"
          value={name}
          maxLength={120}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          aria-invalid={submitted && Boolean(nameError)}
          className="min-h-11"
        />
        {submitted && nameError && <p className="text-xs text-destructive">{nameError}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ce-phone">טלפון</Label>
        <Input
          id="ce-phone"
          type="tel"
          dir="ltr"
          value={phone}
          maxLength={30}
          autoComplete="off"
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={submitted && Boolean(phoneError)}
          className="min-h-11"
        />
        {submitted && phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ce-email">אימייל</Label>
        <Input
          id="ce-email"
          type="email"
          dir="ltr"
          value={email}
          maxLength={254}
          autoComplete="off"
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={submitted && Boolean(emailError)}
          aria-describedby="ce-email-hint"
          className="min-h-11"
        />
        <p
          id="ce-email-hint"
          className={cn(
            "text-xs",
            emailError && submitted ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {emailError && submitted
            ? emailError
            : "אימייל חדש: הקישור האישי שנשלח לכתובת הקודמת יבוטל, ומיילים שעוד לא יצאו אליה — לא יישלחו."}
        </p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">איפה לתקן</legend>
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
            scope === "guest" ? "border-primary bg-primary/5" : "",
          )}
        >
          <input
            type="radio"
            name="ce-scope"
            className="mt-1 size-4"
            checked={scope === "guest"}
            onChange={() => setScope("guest")}
          />
          <span>
            <span className="font-medium">בכרטיס הלקוח</span>
            <span className="block text-xs text-muted-foreground">
              אותו לקוח, פרטים שגויים — התיקון חל על כל ההזמנות והאירועים שלו
              {bookingsCount > 1 ? ` (${bookingsCount} הזמנות)` : ""}.
            </span>
          </span>
        </label>
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
            scope === "booking" ? "border-primary bg-primary/5" : "",
          )}
        >
          <input
            type="radio"
            name="ce-scope"
            className="mt-1 size-4"
            checked={scope === "booking"}
            onChange={() => setScope("booking")}
          />
          <span>
            <span className="font-medium">
              {target.kind === "booking" ? "רק בהזמנה הזו" : "רק באירוע הזה"}
            </span>
            <span className="block text-xs text-muted-foreground">
              {target.kind === "booking"
                ? "ההזמנה שייכת ללקוח אחר — היא עוברת לכרטיס שלו (כרטיס קיים עם האימייל הזה, או כרטיס חדש)."
                : "האירוע שייך ללקוח אחר — הוא עובר לכרטיס שלו (כרטיס קיים עם האימייל הזה, או כרטיס חדש)."}{" "}
              הכרטיס הנוכחי לא משתנה.
              {target.kind === "booking" && target.group ? " כל החדרים שבבקשה עוברים יחד." : ""}
            </span>
          </span>
        </label>
      </fieldset>
      {canNotify && (
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={notify}
            onChange={(e) => setNotifyChoice(e.target.checked)}
            data-testid="customer-notify"
          />
          <span>
            לשלוח ללקוח את פרטי ההזמנה וקישור אישי חדש ל-<span dir="ltr">{email.trim()}</span>
          </span>
        </label>
      )}
    </FormSheet>
  );
}

function ResultNotice({
  result: r,
  target,
  onClose,
  onSent,
}: {
  result: CustomerUpdateResult;
  target: CustomerTarget;
  onClose: () => void;
  onSent: () => void;
}) {
  const fields = r.fields.map((f) => FIELD_TEXT[f]).join(", ");
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950"
      role="status"
      data-testid="customer-update-result"
    >
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        עודכנו: {fields}
        {r.scope === "booking"
          ? r.existing_guest
            ? " — חובר לכרטיס לקוח קיים"
            : " — בכרטיס לקוח חדש"
          : ""}
        .
      </p>
      {r.email_changed && r.links_revoked > 0 && <p>הקישור האישי שנשלח לכתובת הקודמת בוטל.</p>}
      {r.emails_dropped > 0 && (
        <p>{r.emails_dropped} מיילים שעוד לא יצאו לכתובת הקודמת — לא יישלחו.</p>
      )}
      {(r.details_queued ?? 0) > 0 ? (
        <p>
          פרטי ההזמנה וקישור אישי חדש נשלחים ל-<span dir="ltr">{r.email_masked}</span>.
        </p>
      ) : (
        target.kind === "booking" &&
        target.active &&
        r.email_changed &&
        r.email_masked && (
          <div className="flex flex-wrap items-center gap-2">
            <span>הלקוח עוד לא קיבל קישור לכתובת החדשה.</span>
            <ResendDetails bookingId={target.id} email={r.email_masked} onSent={onSent} />
          </div>
        )
      )}
      {r.open_contracts_updated.length > 0 && (
        <p>
          {r.open_contracts_updated.map((n) => `חוזה #${n}`).join(", ")} — פרטי החותם עודכנו והקישור
          שנשלח בוטל. שלחו אותו שוב מכרטיס &quot;החוזה&quot;.
        </p>
      )}
      {r.signed_contracts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {r.signed_contracts.map((c) => `חוזה #${c.number}`).join(", ")} כבר נחתם — הוא לא משתנה.
            אפשר להפיק חוזה מתוקן לחתימה מחדש (החתום נשאר בארכיון).
          </span>
          <Link
            to="/manage/client-documents"
            search={
              target.kind === "booking"
                ? { tab: "send", booking: target.id }
                : { tab: "send", event: target.id }
            }
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-emerald-400 bg-white px-3 text-sm font-medium hover:bg-emerald-100"
          >
            <FileSignature className="size-4" aria-hidden="true" />
            חוזה מתוקן
          </Link>
        </div>
      )}
      <button type="button" className="self-start text-xs underline" onClick={onClose}>
        סגירה
      </button>
    </div>
  );
}
