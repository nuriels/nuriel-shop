// שליחת חוזה לחתימה: סוג החוזה → ההזמנה / האירוע (תמיד תואמים: לינה ↔ חוזה אירוח, אירוע ↔ מתחם
// הבריכה — גם במסד) → הלקוח (של ההזמנה, לקוח קיים אחר, או פרטים ידניים) → פרטים לחוזה האירוח →
// תצוגה מקדימה של הנוסח המלא → שליחה במייל. כבר יש חוזה פתוח — שליחה חוזרת / ביטול / החלפה;
// כבר יש חוזה חתום — חוזה מתוקן (החתום נשאר בארכיון ובתוקף עד שהמתוקן נחתם).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarDays, CheckCircle2, Search, Send, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Input, Label, cn } from "@/platform/ui";
import { hospitalityBookings } from "../../api/bookings.functions";
import {
  hospitalityContractPreview,
  hospitalityContractSend,
  hospitalityContractsFor,
} from "../../api/contracts.functions";
import { hospitalityEvents } from "../../api/events.functions";
import { hospitalityGuests } from "../../api/guests.functions";
import { BLANK } from "../../contracts/blocks";
import { ContractBody } from "../../contracts/ContractBody";
import type { BookingState } from "../../types/bookings";
import {
  CONTRACT_KIND_LABEL,
  CONTRACT_STATUS_LABEL,
  DEPOSIT_METHOD_LABEL,
  type ContractKind,
  type ContractSendResult,
  type ContractTarget,
  type ContractsView,
  type DepositMethod,
} from "../../types/contracts";
import { EVENT_STATUS_LABEL } from "../../types/events";
import { STATE_LABELS } from "../bookings/model";
import { errorText } from "../catalog/refresh";
import { formatDateTime, formatMoney } from "../lib/format";
import { SectionCard } from "../ui/kit";
import { ContractActions } from "./ContractActions";
import { CONTRACTS_KEY, contractsForKey, serviceDateText } from "./model";

type CustomerMode = "link" | "existing" | "manual";
const SELECT = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
const CLOSED_BOOKING: BookingState[] = ["declined", "cancelled", "expired", "no_show"];
const OPEN = ["draft", "sent", "viewed"];
const dmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5">
      <legend className="flex items-center gap-2 px-1 text-sm font-bold">
        <span
          className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
          aria-hidden="true"
        >
          {n}
        </span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Choice({
  checked,
  onChange,
  name,
  title,
  text,
  testId,
}: {
  checked: boolean;
  onChange: () => void;
  name: string;
  title: string;
  text?: string;
  testId?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
        checked ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50",
      )}
      data-testid={testId}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-4"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {text && <span className="text-xs text-muted-foreground">{text}</span>}
      </span>
    </label>
  );
}

export function SendContract({
  view,
  bookingId: initialBooking,
  eventId: initialEvent,
}: {
  view: ContractsView;
  bookingId: string | null;
  eventId: string | null;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<ContractKind>(initialEvent ? "pool_event" : "hosting");
  const [bookingId, setBookingId] = useState<string | null>(initialBooking);
  const [eventId, setEventId] = useState<string | null>(initialEvent);
  const [linkLabel, setLinkLabel] = useState<string | null>(null);
  const [mode, setMode] = useState<CustomerMode>("link");
  const [guest, setGuest] = useState<{ id: string; name: string } | null>(null);
  const [manual, setManual] = useState({ full_name: "", email: "", phone: "" });
  const [deposit, setDeposit] = useState<DepositMethod | "">("");
  const [eventFee, setEventFee] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [result, setResult] = useState<ContractSendResult | null>(null);

  const linkId = kind === "hosting" ? bookingId : eventId;
  const chooseKind = (k: ContractKind) => {
    if (k === kind) return;
    setKind(k);
    setBookingId(null);
    setEventId(null);
    setLinkLabel(null);
    setReplaceOpen(false);
    setResult(null);
  };

  const target: ContractTarget | null = useMemo(() => {
    if (!linkId) return null;
    if (mode === "existing" && !guest) return null;
    if (mode === "manual" && (!manual.full_name.trim() || !manual.email.trim())) return null;
    const fee = eventFee.trim() === "" ? null : Number(eventFee);
    return {
      kind,
      bookingId: kind === "hosting" ? bookingId : null,
      eventId: kind === "pool_event" ? eventId : null,
      guestId: mode === "existing" ? (guest?.id ?? null) : null,
      signer:
        mode === "manual"
          ? {
              full_name: manual.full_name.trim(),
              email: manual.email.trim(),
              ...(manual.phone.trim() ? { phone: manual.phone.trim() } : {}),
            }
          : null,
      options:
        kind === "hosting"
          ? {
              deposit_method: deposit || null,
              event_fee: fee !== null && Number.isFinite(fee) ? fee : null,
            }
          : {},
    };
  }, [kind, bookingId, eventId, linkId, mode, guest, manual, deposit, eventFee]);
  const debounced = useDebounced(target, 400);
  const feeInvalid =
    eventFee.trim() !== "" && (!Number.isFinite(Number(eventFee)) || Number(eventFee) < 0);

  const preview = useQuery({
    queryKey: [...CONTRACTS_KEY, "preview", debounced],
    enabled: debounced !== null && !feeInvalid,
    queryFn: () => hospitalityContractPreview({ data: { ...debounced! } }),
    retry: false,
  });
  const existing = useQuery({
    queryKey: contractsForKey(
      kind === "hosting" ? bookingId : null,
      kind === "pool_event" ? eventId : null,
    ),
    enabled: linkId !== null,
    queryFn: () =>
      hospitalityContractsFor({
        data: {
          bookingId: kind === "hosting" ? bookingId : null,
          eventId: kind === "pool_event" ? eventId : null,
        },
      }),
  });
  const rows = existing.data ?? [];
  const open = rows.find((c) => OPEN.includes(c.stored_status)) ?? null;
  const signed = rows.find((c) => c.stored_status === "signed") ?? null;
  const supersedes = open ? (replaceOpen ? open.id : null) : (signed?.id ?? null);

  const send = useMutation({
    mutationFn: () => hospitalityContractSend({ data: { ...target!, supersedes } }),
    onSuccess: (r) => {
      setResult(r);
      setReplaceOpen(false);
      if (r.sent) toast.success(`החוזה נשלח ל-${r.contract.signer_email}`);
      else toast.error("השליחה נכשלה — החוזה נשמר כטיוטה ולא סומן כנשלח");
      void qc.invalidateQueries({ queryKey: CONTRACTS_KEY });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const p = preview.data && debounced === target ? preview.data : null;
  const stale = preview.data !== undefined && debounced !== target;
  const blanks = p ? p.body.split(BLANK).length - 1 : 0;
  const blocked =
    !p ||
    !p.can_send ||
    feeInvalid ||
    send.isPending ||
    existing.isLoading ||
    (open !== null && !replaceOpen);

  return (
    <div className="flex flex-col gap-4" data-testid="contract-send">
      <Step n={1} title="סוג החוזה">
        <div role="radiogroup" aria-label="סוג החוזה" className="grid gap-2 sm:grid-cols-2">
          <Choice
            name="contract-kind"
            checked={kind === "hosting"}
            onChange={() => chooseKind("hosting")}
            title={CONTRACT_KIND_LABEL.hosting}
            text="להזמנת לינה בצימרים (גם כל המתחם). נשלח רק עם הזמנה."
            testId="kind-hosting"
          />
          <Choice
            name="contract-kind"
            checked={kind === "pool_event"}
            onChange={() => chooseKind("pool_event")}
            title={CONTRACT_KIND_LABEL.pool_event}
            text="לאירוע בלי לינה — מסיבת כלה, בר מצווה, יום הולדת… נשלח רק עם אירוע."
            testId="kind-pool-event"
          />
        </div>
      </Step>

      <Step n={2} title={kind === "hosting" ? "ההזמנה" : "האירוע"}>
        {linkId ? (
          <LinkSummary
            kind={kind}
            label={linkLabel}
            data={p?.data ?? null}
            onClear={() => {
              setBookingId(null);
              setEventId(null);
              setLinkLabel(null);
              setResult(null);
              setReplaceOpen(false);
            }}
            linkId={linkId}
          />
        ) : kind === "hosting" ? (
          <BookingPicker
            onPick={(id, label) => {
              setBookingId(id);
              setLinkLabel(label);
            }}
          />
        ) : (
          <EventPicker
            onPick={(id, label) => {
              setEventId(id);
              setLinkLabel(label);
            }}
          />
        )}
      </Step>

      {linkId && (
        <Step n={3} title="הלקוח שחותם">
          <div role="radiogroup" aria-label="הלקוח" className="grid gap-2 sm:grid-cols-3">
            <Choice
              name="contract-customer"
              checked={mode === "link"}
              onChange={() => setMode("link")}
              title={kind === "hosting" ? "הלקוח של ההזמנה" : "הלקוח של האירוע"}
              testId="customer-link"
            />
            <Choice
              name="contract-customer"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              title="לקוח קיים אחר"
              testId="customer-existing"
            />
            <Choice
              name="contract-customer"
              checked={mode === "manual"}
              onChange={() => {
                // פרטים ידניים — מתחילים מהפרטים של הלקוח שנבחר (לתיקון), או ריקים (לקוח חדש)
                if (p && !manual.full_name && !manual.email)
                  setManual({
                    full_name: p.signer.full_name,
                    email: p.signer.email,
                    phone: p.signer.phone ?? "",
                  });
                setMode("manual");
              }}
              title="פרטים ידניים / לקוח חדש"
              testId="customer-manual"
            />
          </div>
          {mode === "existing" && <GuestPicker guest={guest} onPick={setGuest} />}
          {mode === "manual" && (
            <div className="grid gap-3 sm:grid-cols-3" data-testid="customer-manual-fields">
              <div className="flex flex-col gap-1">
                <Label htmlFor="cs-name">שם מלא</Label>
                <Input
                  id="cs-name"
                  value={manual.full_name}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => setManual({ ...manual, full_name: e.target.value })}
                  className="min-h-11"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="cs-email">אימייל (לשם נשלח הקישור)</Label>
                <Input
                  id="cs-email"
                  type="email"
                  dir="ltr"
                  value={manual.email}
                  maxLength={254}
                  autoComplete="off"
                  onChange={(e) => setManual({ ...manual, email: e.target.value })}
                  className="min-h-11"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="cs-phone">טלפון</Label>
                <Input
                  id="cs-phone"
                  type="tel"
                  dir="ltr"
                  value={manual.phone}
                  maxLength={30}
                  autoComplete="off"
                  onChange={(e) => setManual({ ...manual, phone: e.target.value })}
                  className="min-h-11"
                />
              </div>
            </div>
          )}
          {p && (
            <p className="text-sm" data-testid="contract-signer">
              יישלח אל: <strong>{p.signer.full_name}</strong> ·{" "}
              <span dir="ltr">{p.signer.email}</span>
              {p.signer.phone && (
                <>
                  {" "}
                  · <span dir="ltr">{p.signer.phone}</span>
                </>
              )}
            </p>
          )}
        </Step>
      )}

      {linkId && kind === "hosting" && (
        <Step n={4} title="פרטים לחוזה האירוח">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="cs-deposit">אמצעי הפיקדון (סעיף 5)</Label>
              <select
                id="cs-deposit"
                className={SELECT}
                value={deposit}
                onChange={(e) => setDeposit(e.target.value as DepositMethod | "")}
              >
                <option value="">הלקוח יבחר בזמן החתימה</option>
                {(Object.keys(DEPOSIT_METHOD_LABEL) as DepositMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {DEPOSIT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cs-fee">תשלום נוסף לאירוע / מסיבה, ₪ (סעיף 4)</Label>
              <Input
                id="cs-fee"
                inputMode="decimal"
                dir="ltr"
                value={eventFee}
                onChange={(e) => setEventFee(e.target.value)}
                aria-invalid={feeInvalid}
                aria-describedby="cs-fee-hint"
                className="min-h-11"
              />
              <p
                id="cs-fee-hint"
                className={cn("text-xs", feeInvalid ? "text-destructive" : "text-muted-foreground")}
              >
                {feeInvalid
                  ? "סכום לא תקין"
                  : "לא חובה. אם לא ממלאים — בסעיף נשאר קו ריק, כמו בחוזה המודפס."}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            הפיקדון לפי התנאים: {formatMoney(view.terms.deposit_amount)}. פרטי כרטיס אשראי לא נאספים
            ולא נשמרים במערכת החתימה.
          </p>
        </Step>
      )}

      {linkId && (
        <SectionCard
          title="תצוגה מקדימה — כפי שהלקוח יראה"
          description={
            p
              ? `${p.title} · נוסח גרסה ${p.template_version}`
              : "הנוסח המלא של החוזה, עם פרטי העסק וההזמנה"
          }
        >
          {target === null ? (
            <p className="text-sm text-muted-foreground">
              {mode === "existing" ? "בחרו לקוח מהרשימה." : "מלאו שם ואימייל של הלקוח."}
            </p>
          ) : preview.isError && !stale ? (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="contract-preview-error"
            >
              {errorText(preview.error)}
            </p>
          ) : !p ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              מכין את התצוגה המקדימה…
            </p>
          ) : (
            <div className="flex flex-col gap-3" data-testid="contract-preview">
              {blanks > 0 && (
                <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">
                  השדות המסומנים (<mark className="rounded bg-amber-100 px-1">{BLANK}</mark>) ימולאו
                  בחתימה: תעודת הזהות, כתובת המגורים ותאריך החתימה
                  {kind === "hosting" && !deposit ? ", ואמצעי הפיקדון שהלקוח יבחר" : ""}.
                  {kind === "hosting" && !eventFee.trim()
                    ? " התשלום לאירוע (סעיף 4) לא מולא — נשאר ריק."
                    : ""}
                </p>
              )}
              {/* אזור גלילה: מגיעים אליו גם במקלדת (Tab) ונגללים בחיצים */}
              <div
                className="max-h-[70vh] overflow-y-auto rounded-lg border bg-white p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:p-6"
                role="region"
                aria-label="נוסח החוזה — תצוגה מקדימה"
                tabIndex={0}
              >
                <ContractBody body={p.body} highlightBlanks />
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {linkId && (
        <Step n={kind === "hosting" ? 5 : 4} title="שליחה לחתימה">
          {open && (
            <div
              className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
              data-testid="contract-open-notice"
            >
              <p>
                כבר יש חוזה פתוח {kind === "hosting" ? "להזמנה הזו" : "לאירוע הזה"} — חוזה #
                {open.number} ({CONTRACT_STATUS_LABEL[open.status]}
                {open.last_sent_at ? `, נשלח ${formatDateTime(open.last_sent_at)}` : ""}). אפשר
                לשלוח אותו שוב, לבטל אותו, או להחליף אותו בחוזה מעודכן.
              </p>
              <ContractActions c={open} compact />
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={replaceOpen}
                  onChange={(e) => setReplaceOpen(e.target.checked)}
                  data-testid="contract-replace-open"
                />
                להחליף אותו בחוזה מעודכן (הקישור שנשלח קודם יבוטל)
              </label>
            </div>
          )}
          {!open && signed && (
            <p
              className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950"
              data-testid="contract-corrected-notice"
            >
              {kind === "hosting" ? "להזמנה הזו" : "לאירוע הזה"} כבר יש חוזה חתום — #{signed.number}
              {signed.signed_at ? ` (נחתם ${formatDateTime(signed.signed_at)})` : ""}. השליחה תפיק{" "}
              <strong>חוזה מתוקן</strong>: הלקוח יחתום מחדש, והחוזה החתום לא משתנה — הוא נשאר
              בארכיון ובתוקף עד שהמתוקן ייחתם.
            </p>
          )}
          {p && !p.can_send && (
            <p className="text-sm text-muted-foreground" data-testid="contract-send-blocked">
              {p.legal_pending
                ? "השליחה ללקוחות תיפתח אחרי הבדיקה והאישור המשפטי של החוזים. בינתיים — תצוגה מקדימה בלבד."
                : 'בעל העסק צריך לאשר את "תנאים ופרטי החוזה" לפני שליחת החוזה הראשון.'}
            </p>
          )}
          {result && (
            <div
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-3 text-sm",
                result.sent
                  ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                  : "border-red-300 bg-red-50 text-red-950",
              )}
              role="status"
              data-testid="contract-send-result"
            >
              {result.sent ? (
                <p className="flex items-center gap-2">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  חוזה #{result.contract.number} נשלח ל-
                  <span dir="ltr">{result.contract.signer_email}</span>
                  {result.contract.link_expires_at
                    ? ` · הקישור תקף עד ${formatDateTime(result.contract.link_expires_at)}`
                    : ""}
                </p>
              ) : (
                <p>
                  השליחה נכשלה — חוזה #{result.contract.number} נשמר כטיוטה ולא סומן כנשלח.
                  {result.error ? ` (${result.error})` : ""} אפשר לנסות שוב מכאן או מהארכיון.
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="min-h-11 gap-2"
              disabled={blocked}
              onClick={() => send.mutate()}
              data-testid="contract-send-button"
            >
              <Send className="size-4" aria-hidden="true" />
              {send.isPending
                ? "שולח…"
                : p
                  ? `${supersedes ? "שליחת חוזה מתוקן" : "שליחה לחתימה"} ל-${p.signer.email}`
                  : "שליחה לחתימה"}
            </Button>
            {bookingId && kind === "hosting" && (
              <Link
                to="/manage/bookings/$bookingId"
                params={{ bookingId }}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-muted"
              >
                לעמוד ההזמנה
              </Link>
            )}
            {eventId && kind === "pool_event" && (
              <Link
                to="/manage/events/$eventId"
                params={{ eventId }}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-muted"
              >
                לעמוד האירוע
              </Link>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            הלקוח מקבל במייל קישור אישי לחתימה, תקף לזמן מוגבל ולחתימה אחת. אחרי החתימה — העותק
            החתום (PDF) נשלח אליו ונשמר בארכיון. אם המייל לא יוצא, החוזה לא מסומן כנשלח.
          </p>
        </Step>
      )}
    </div>
  );
}

function LinkSummary({
  kind,
  label,
  data,
  linkId,
  onClear,
}: {
  kind: ContractKind;
  label: string | null;
  data: { [key: string]: unknown } | null;
  linkId: string;
  onClear: () => void;
}) {
  const s = (k: string) => (data && typeof data[k] === "string" ? (data[k] as string) : null);
  const text = data
    ? kind === "hosting"
      ? `הזמנה #${s("booking_number") ?? ""} · ${s("check_in_date") ?? ""}–${s("check_out_date") ?? ""} · ${s("nights") ?? ""} לילות · ${s("price") ?? ""} ₪`
      : `אירוע #${s("event_number") ?? ""} · ${s("event_purpose") ?? ""} · ${s("event_date") ?? ""}, ${s("start_time") ?? ""}–${s("end_time") ?? ""} · ${s("participants") ?? ""} משתתפים`
    : (label ?? (kind === "hosting" ? "ההזמנה שנבחרה" : "האירוע שנבחר"));
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
      data-testid="contract-link"
      data-link={linkId}
    >
      <span className="flex items-center gap-2">
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
        {text}
      </span>
      <Button type="button" variant="ghost" size="sm" className="min-h-10 gap-1" onClick={onClear}>
        <X className="size-4" aria-hidden="true" />
        החלפה
      </Button>
    </div>
  );
}

function SearchBox({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 ps-9"
          autoComplete="off"
        />
      </div>
    </div>
  );
}

function PickList({
  children,
  empty,
  loading,
  error,
}: {
  children: ReactNode[];
  empty: string;
  loading: boolean;
  error: unknown;
}) {
  if (error) return <p className="text-sm text-destructive">{errorText(error)}</p>;
  if (loading) return <p className="text-sm text-muted-foreground">מחפש…</p>;
  if (children.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <ul className="flex flex-col gap-1.5">{children}</ul>;
}

function BookingPicker({ onPick }: { onPick: (id: string, label: string) => void }) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const list = useQuery({
    queryKey: [...CONTRACTS_KEY, "pick-booking", q],
    queryFn: () =>
      hospitalityBookings({
        data: { tab: q ? "all" : "upcoming", q: q || null, limit: 8, offset: 0 },
      }),
  });
  return (
    <div className="flex flex-col gap-2" data-testid="booking-picker">
      <SearchBox
        id="cs-booking-q"
        label="חיפוש הזמנה — שם, טלפון, אימייל או מספר"
        value={text}
        onChange={setText}
      />
      <PickList
        loading={list.isLoading}
        error={list.error}
        empty={q ? "לא נמצאו הזמנות." : "אין הזמנות קרובות — חפשו לפי שם או מספר."}
      >
        {(list.data?.items ?? []).map((b) => {
          const closed = CLOSED_BOOKING.includes(b.state);
          const label = `הזמנה #${b.number} · ${b.guest_name} · ${b.unit_name} · ${serviceDateText(b.check_in, b.check_out)}`;
          return (
            <li key={b.id}>
              <button
                type="button"
                disabled={closed}
                onClick={() => onPick(b.id, label)}
                className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-start text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">
                  {STATE_LABELS[b.state]}
                  {closed ? " — אין לה חוזה" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </PickList>
    </div>
  );
}

function EventPicker({ onPick }: { onPick: (id: string, label: string) => void }) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const list = useQuery({
    queryKey: [...CONTRACTS_KEY, "pick-event", q],
    queryFn: () =>
      hospitalityEvents({
        data: {
          tab: q ? "all" : "upcoming",
          q: q || null,
          type: null,
          from: null,
          to: null,
          limit: 8,
          offset: 0,
        },
      }),
  });
  return (
    <div className="flex flex-col gap-2" data-testid="event-picker">
      <SearchBox
        id="cs-event-q"
        label="חיפוש אירוע — שם, טלפון, אימייל או מספר"
        value={text}
        onChange={setText}
      />
      <PickList
        loading={list.isLoading}
        error={list.error}
        empty={q ? "לא נמצאו אירועים." : 'אין אירועים קרובים — חפשו, או צרו אירוע במסך "אירועים".'}
      >
        {(list.data?.rows ?? []).map((e) => {
          const closed = e.stored_status === "cancelled";
          const label = `אירוע #${e.number} · ${e.event_type_label} · ${dmy(e.event_date)} ${e.start_time}–${e.end_time}${e.customer ? ` · ${e.customer.full_name}` : ""}`;
          return (
            <li key={e.id}>
              <button
                type="button"
                disabled={closed}
                onClick={() => onPick(e.id, label)}
                className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-start text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">
                  {EVENT_STATUS_LABEL[e.status]}
                  {closed ? " — אין לו חוזה" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </PickList>
    </div>
  );
}

function GuestPicker({
  guest,
  onPick,
}: {
  guest: { id: string; name: string } | null;
  onPick: (g: { id: string; name: string } | null) => void;
}) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const list = useQuery({
    queryKey: [...CONTRACTS_KEY, "pick-guest", q],
    enabled: q.length >= 2,
    queryFn: () => hospitalityGuests({ data: { q, limit: 8, offset: 0 } }),
  });
  if (guest)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <span className="flex items-center gap-2">
          <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
          {guest.name}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-10 gap-1"
          onClick={() => onPick(null)}
        >
          <X className="size-4" aria-hidden="true" />
          החלפה
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-2" data-testid="guest-picker">
      <SearchBox
        id="cs-guest-q"
        label="חיפוש לקוח — שם, טלפון או אימייל"
        value={text}
        onChange={setText}
      />
      {q.length >= 2 && (
        <PickList loading={list.isLoading} error={list.error} empty="לא נמצאו לקוחות.">
          {(list.data?.items ?? [])
            .filter((g) => !g.anonymized)
            .map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => onPick({ id: g.id, name: g.name })}
                  className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-start text-sm hover:bg-muted"
                >
                  <span>{g.name}</span>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {[g.email, g.phone].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
        </PickList>
      )}
    </div>
  );
}
