// טופס אירוע (חדש / עריכה): מתחם, סוג, לקוח (קיים או חדש), תאריך ושעות, משתתפים (עד 50 — לפי
// החוזה), מחיר, מקדמה ותשלום, פיקדון, הערות פנימיות. בזמן ההקלדה המסד בודק: אירוע חופף באותו מתחם
// (חוסם), אורחים בצימרים באותו זמן (צריך אישור מפורש כדי לאשר), שעות הבריכה (סימון). הכל נבדק שוב
// בשמירה (מיגרציה 63).
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, Clock, Search, UserPlus, Users } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Button, Checkbox, Input, Label, Textarea, cn } from "@/platform/ui";
import { hospitalityEventCheck } from "../../api/events.functions";
import { hospitalityGuests } from "../../api/guests.functions";
import {
  DEPOSIT_STATUS_LABEL,
  EVENT_TYPES,
  EVENT_TYPE_LABEL,
  type BusinessTerms,
  type DepositStatus,
  type EventInput,
  type EventType,
  type StaffEvent,
} from "../../types/events";
import { EVENT_MAX_PARTICIPANTS } from "../../validation/events";
import { errorText } from "../catalog/refresh";
import { conflictText, lodgingText } from "./model";

const SELECT = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

interface Draft {
  property_id: string;
  event_type: EventType;
  event_type_other: string;
  event_date: string;
  start_time: string;
  end_time: string;
  participants: string;
  price: string;
  advance_amount: string;
  amount_paid: string;
  deposit_amount: string;
  deposit_status: DepositStatus;
  internal_notes: string;
  status: "pending" | "confirmed";
  lodging_ack: boolean;
  customer_mode: "existing" | "new";
  guest_id: string;
  guest_label: string;
  full_name: string;
  phone: string;
  email: string;
}

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

export function EventForm({
  properties,
  terms,
  event,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  properties: { id: string; name: string }[];
  terms: BusinessTerms;
  /** עריכה — האירוע הקיים; חדש — null */
  event: StaffEvent | null;
  busy: boolean;
  error: string | null;
  onSubmit: (data: EventInput) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [d, setD] = useState<Draft>(() => ({
    property_id: event?.property_id ?? (properties.length === 1 ? properties[0]!.id : ""),
    event_type: event?.event_type ?? "birthday",
    event_type_other: event?.event_type_other ?? "",
    event_date: event?.event_date ?? "",
    start_time: event?.start_time ?? "10:00",
    end_time: event?.end_time ?? "17:00",
    participants: event ? String(event.participants) : "",
    price: event ? String(event.price) : "",
    advance_amount: event && event.advance_amount ? String(event.advance_amount) : "",
    amount_paid: event && event.amount_paid ? String(event.amount_paid) : "",
    deposit_amount: String(event?.deposit_amount ?? terms.deposit_amount),
    deposit_status: event?.deposit_status ?? "pending",
    internal_notes: event?.internal_notes ?? "",
    status: "pending",
    lodging_ack: false,
    customer_mode: "existing",
    guest_id: "",
    guest_label: "",
    full_name: "",
    phone: "",
    email: "",
  }));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  // ---- בדיקת זמינות תוך כדי (מחכים רגע אחרי ההקלדה) ----
  const checkInput = useMemo(
    () =>
      d.property_id && d.event_date && d.start_time && d.end_time && d.start_time !== d.end_time
        ? {
            property_id: d.property_id,
            event_date: d.event_date,
            start_time: d.start_time,
            end_time: d.end_time,
          }
        : null,
    [d.property_id, d.event_date, d.start_time, d.end_time],
  );
  const [debounced, setDebounced] = useState(checkInput);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(checkInput), 350);
    return () => clearTimeout(t);
  }, [checkInput]);
  const check = useQuery({
    queryKey: ["hosp-event-check", debounced, event?.id ?? null],
    enabled: debounced !== null,
    queryFn: () =>
      hospitalityEventCheck({ data: { data: debounced!, exclude: event?.id ?? null } }),
    retry: false,
  });
  const conflicts = check.data?.conflicts ?? [];
  const lodging = check.data?.lodging ?? [];
  const confirming = !event && d.status === "confirmed";

  // ---- חיפוש לקוח קיים ----
  const [guestQ, setGuestQ] = useState("");
  const [guestSearch, setGuestSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setGuestSearch(guestQ.trim()), 300);
    return () => clearTimeout(t);
  }, [guestQ]);
  const guests = useQuery({
    queryKey: ["hosp-event-guests", guestSearch],
    enabled: !event && d.customer_mode === "existing" && guestSearch.length >= 2,
    queryFn: () => hospitalityGuests({ data: { q: guestSearch, limit: 8, offset: 0 } }),
  });

  const participants = num(d.participants);
  const tooMany = participants !== null && participants > terms.max_event_guests;
  const blocked =
    conflicts.length > 0 || tooMany || (confirming && lodging.length > 0 && !d.lodging_ack);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: EventInput = {
      property_id: d.property_id,
      event_type: d.event_type,
      event_type_other: d.event_type === "other" ? d.event_type_other.trim() || null : null,
      event_date: d.event_date,
      start_time: d.start_time,
      end_time: d.end_time,
      participants: participants ?? 0,
      price: num(d.price) ?? 0,
      advance_amount: num(d.advance_amount),
      amount_paid: num(d.amount_paid),
      deposit_amount: num(d.deposit_amount) ?? 0,
      internal_notes: d.internal_notes.trim() || null,
    };
    if (event) {
      data.deposit_status = d.deposit_status;
    } else {
      data.status = d.status;
      data.lodging_ack = d.lodging_ack;
      if (d.customer_mode === "existing" && d.guest_id) data.guest_id = d.guest_id;
      else
        data.customer = {
          full_name: d.full_name.trim(),
          phone: d.phone.trim(),
          email: d.email.trim() || null,
        };
    }
    onSubmit(data);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" data-testid="event-form" noValidate>
      {/* ---- לקוח (רק באירוע חדש; שינוי פרטי לקוח — פעולה נפרדת) ---- */}
      {!event && (
        <fieldset className="flex flex-col gap-3 rounded-xl border p-4">
          <legend className="px-1 text-sm font-semibold">הלקוח</legend>
          <div role="radiogroup" aria-label="לקוח קיים או חדש" className="flex flex-wrap gap-2">
            {(
              [
                ["existing", "לקוח קיים", Search],
                ["new", "לקוח חדש", UserPlus],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={d.customer_mode === mode}
                onClick={() => set("customer_mode", mode)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm",
                  d.customer_mode === mode
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          {d.customer_mode === "existing" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-gq`}>חיפוש לפי שם, טלפון או אימייל</Label>
              <Input
                id={`${id}-gq`}
                type="search"
                value={guestQ}
                onChange={(e) => setGuestQ(e.target.value)}
                className="min-h-11"
                autoComplete="off"
              />
              {d.guest_id && (
                <p className="text-sm" aria-live="polite" data-testid="event-guest-chosen">
                  נבחר: <strong>{d.guest_label}</strong>
                </p>
              )}
              {guests.data && guests.data.items.length > 0 && (
                <ul className="flex flex-col gap-1" aria-label="לקוחות שנמצאו">
                  {guests.data.items
                    .filter((g) => !g.anonymized)
                    .map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => {
                            set("guest_id", g.id);
                            set("guest_label", g.name);
                          }}
                          aria-pressed={d.guest_id === g.id}
                          className={cn(
                            "flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-start text-sm",
                            d.guest_id === g.id && "border-primary bg-primary/5",
                          )}
                        >
                          <span className="font-medium">{g.name}</span>
                          <span className="text-xs text-muted-foreground" dir="ltr">
                            {g.phone ?? g.email ?? ""}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {guests.data && guests.data.items.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  לא נמצא לקוח — אפשר לבחור "לקוח חדש".
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="שם מלא" htmlFor={`${id}-fn`}>
                <Input
                  id={`${id}-fn`}
                  value={d.full_name}
                  onChange={(e) => set("full_name", e.target.value)}
                  className="min-h-11"
                  autoComplete="name"
                  required
                />
              </Field>
              <Field label="טלפון" htmlFor={`${id}-ph`}>
                <Input
                  id={`${id}-ph`}
                  type="tel"
                  dir="ltr"
                  value={d.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  className="min-h-11"
                  autoComplete="tel"
                  required
                />
              </Field>
              <Field label="אימייל (לשליחת החוזה)" htmlFor={`${id}-em`}>
                <Input
                  id={`${id}-em`}
                  type="email"
                  dir="ltr"
                  value={d.email}
                  onChange={(e) => set("email", e.target.value)}
                  className="min-h-11"
                  autoComplete="email"
                />
              </Field>
            </div>
          )}
        </fieldset>
      )}

      {/* ---- האירוע ---- */}
      <fieldset className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">האירוע</legend>
        <Field label="המתחם" htmlFor={`${id}-pr`}>
          <select
            id={`${id}-pr`}
            className={SELECT}
            value={d.property_id}
            onChange={(e) => set("property_id", e.target.value)}
            required
          >
            <option value="">בחירת מתחם…</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="סוג האירוע" htmlFor={`${id}-tp`}>
          <select
            id={`${id}-tp`}
            className={SELECT}
            value={d.event_type}
            onChange={(e) => set("event_type", e.target.value as EventType)}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        {d.event_type === "other" && (
          <Field label="סוג האירוע (במילים)" htmlFor={`${id}-to`} className="sm:col-span-2">
            <Input
              id={`${id}-to`}
              value={d.event_type_other}
              onChange={(e) => set("event_type_other", e.target.value)}
              className="min-h-11"
              maxLength={80}
            />
          </Field>
        )}
        <Field label="תאריך" htmlFor={`${id}-dt`}>
          <Input
            id={`${id}-dt`}
            type="date"
            value={d.event_date}
            onChange={(e) => set("event_date", e.target.value)}
            className="min-h-11"
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="משעה" htmlFor={`${id}-st`}>
            <Input
              id={`${id}-st`}
              type="time"
              step={900}
              value={d.start_time}
              onChange={(e) => set("start_time", e.target.value)}
              className="min-h-11"
              required
            />
          </Field>
          <Field label="עד שעה" htmlFor={`${id}-et`}>
            <Input
              id={`${id}-et`}
              type="time"
              step={900}
              value={d.end_time}
              onChange={(e) => set("end_time", e.target.value)}
              className="min-h-11"
              required
            />
          </Field>
        </div>
        <Field
          label="מספר משתתפים"
          htmlFor={`${id}-pa`}
          hint={`עד ${terms.max_event_guests} משתתפים (לפי החוזה)`}
          error={tooMany ? `עד ${terms.max_event_guests} משתתפים באירוע — אי אפשר יותר` : null}
        >
          <Input
            id={`${id}-pa`}
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.min(terms.max_event_guests, EVENT_MAX_PARTICIPANTS)}
            value={d.participants}
            onChange={(e) => set("participants", e.target.value)}
            className="min-h-11"
            required
            aria-invalid={tooMany}
          />
        </Field>
      </fieldset>

      {/* ---- מה המסד מצא בזמן הזה ---- */}
      <div aria-live="polite" className="flex flex-col gap-2" data-testid="event-check">
        {conflicts.length > 0 && (
          <Notice tone="error" icon={Ban} testId="event-conflicts">
            <p className="font-medium">יש כבר אירוע במתחם בזמן הזה — אי אפשר לשמור:</p>
            <ul className="mt-1 list-disc ps-5">
              {conflicts.map((c) => (
                <li key={c.event_id}>{conflictText(c)}</li>
              ))}
            </ul>
          </Notice>
        )}
        {lodging.length > 0 && (
          <Notice tone="warn" icon={Users} testId="event-lodging">
            <p className="font-medium">
              באותו זמן יש אורחים בצימרים במתחם ({lodging.length}) — הם חולקים את הבריכה והחצר:
            </p>
            <ul className="mt-1 list-disc ps-5">
              {lodging.map((l) => (
                <li key={l.booking_id}>{lodgingText(l)}</li>
              ))}
            </ul>
            {confirming && (
              <label className="mt-2 flex min-h-11 items-center gap-2 font-medium">
                <Checkbox
                  checked={d.lodging_ack}
                  onCheckedChange={(v) => set("lodging_ack", v === true)}
                  aria-label="ידוע לי שיש אורחים בצימרים — לאשר את האירוע בכל זאת"
                />
                ידוע לי שיש אורחים בצימרים — לאשר את האירוע בכל זאת
              </label>
            )}
          </Notice>
        )}
        {check.data?.outside_pool_hours && (
          <Notice tone="info" icon={Clock} testId="event-pool-hours">
            שעות הבריכה {check.data.pool_open_time}–{check.data.pool_close_time} בלבד: חל איסור על
            שהייה במים מחוץ לשעות אלו (סעיף 2 בחוזה). האירוע עצמו יכול להימשך.
          </Notice>
        )}
        {check.data?.ends_next_day && (
          <p className="text-sm text-muted-foreground">האירוע מסתיים אחרי חצות — למחרת.</p>
        )}
        {check.isError && <p className="text-sm text-destructive">{errorText(check.error)}</p>}
      </div>

      {/* ---- כסף ---- */}
      <fieldset className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">תשלום ופיקדון</legend>
        <Field label="המחיר (₪)" htmlFor={`${id}-pc`}>
          <Input
            id={`${id}-pc`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={d.price}
            onChange={(e) => set("price", e.target.value)}
            className="min-h-11"
            required
          />
        </Field>
        <Field label="מקדמה (₪, אם יש)" htmlFor={`${id}-ad`}>
          <Input
            id={`${id}-ad`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={d.advance_amount}
            onChange={(e) => set("advance_amount", e.target.value)}
            className="min-h-11"
          />
        </Field>
        <Field label="שולם עד עכשיו (₪)" htmlFor={`${id}-pd`}>
          <Input
            id={`${id}-pd`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={d.amount_paid}
            onChange={(e) => set("amount_paid", e.target.value)}
            className="min-h-11"
          />
        </Field>
        <Field
          label="פיקדון / ערבות לנזקים (₪)"
          htmlFor={`${id}-dp`}
          hint={`לפי החוזה: ${terms.deposit_amount.toLocaleString("he-IL")} ₪`}
        >
          <Input
            id={`${id}-dp`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={d.deposit_amount}
            onChange={(e) => set("deposit_amount", e.target.value)}
            className="min-h-11"
          />
        </Field>
        {event && (
          <Field label="מצב הפיקדון" htmlFor={`${id}-ds`}>
            <select
              id={`${id}-ds`}
              className={SELECT}
              value={d.deposit_status}
              onChange={(e) => set("deposit_status", e.target.value as DepositStatus)}
            >
              {(Object.keys(DEPOSIT_STATUS_LABEL) as DepositStatus[]).map((k) => (
                <option key={k} value={k}>
                  {DEPOSIT_STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="text-xs text-muted-foreground sm:col-span-3">
          איחור בפינוי המתחם: {terms.event_late_fee_per_hour.toLocaleString("he-IL")} ₪ לכל שעה (לפי
          החוזה).
        </p>
      </fieldset>

      <Field label="הערות פנימיות (לא נשלחות ללקוח)" htmlFor={`${id}-nt`}>
        <Textarea
          id={`${id}-nt`}
          value={d.internal_notes}
          onChange={(e) => set("internal_notes", e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </Field>

      {!event && (
        <div role="radiogroup" aria-label="מצב האירוע" className="flex flex-wrap gap-2">
          {(
            [
              ["pending", "ממתין לאישור"],
              ["confirmed", "מאושר — לאשר עכשיו"],
            ] as const
          ).map(([s, label]) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={d.status === s}
              onClick={() => set("status", s)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md border px-3 text-sm",
                d.status === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={busy || blocked}>
          {busy ? "שומרים…" : event ? "שמירת השינויים" : "שמירת האירוע"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
            ביטול
          </Button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  testId,
  children,
}: {
  tone: "error" | "warn" | "info";
  icon: typeof AlertTriangle;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex gap-2 rounded-lg border p-3 text-sm",
        tone === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
        tone === "warn" && "border-amber-300 bg-amber-50 text-amber-950",
        tone === "info" && "border-sky-200 bg-sky-50 text-sky-950",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
