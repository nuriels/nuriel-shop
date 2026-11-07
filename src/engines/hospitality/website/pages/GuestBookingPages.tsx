// אחרי שליחת הבקשה (/stay/booking-received) ו"ההזמנה שלי" (/stay/my-booking) — לפי הקישור
// המאובטח בלבד: הטוקן אחרי # (לא נשלח לשרת בבקשת העמוד, לא נרשם ביומנים ולא עובר ב-Referer);
// השרת מחזיר רק את ההזמנה שהטוקן שלה (hash) תואם, באתר הזה, עד 30 יום אחרי העזיבה.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Landmark,
  Mail,
  MessageCircle,
  Phone,
  Smartphone,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/platform/ui";
import {
  hospitalitySiteBooking,
  hospitalitySiteCancellationQuote,
  hospitalitySiteRequestCancellation,
  hospitalitySiteUploadProof,
} from "../../api/website.functions";
import type { ArrivalValues } from "../../types/catalog";
import type { GuestBookingView } from "../../types/domain";
import type { GuestPaymentInfo } from "../../types/payment-instructions";
import type { GuestArrival } from "../../types/website";
import { useCopy } from "../copy";
import { dateTimeText, money, scheduleLines, stayText, telHref, whatsappHref } from "../lib/format";
import { hasInstructions, methodsText } from "../lib/payment";
import { useSite } from "../lib/site-context";
import { paymentRowText } from "../lib/transfer";
import { TransferCard } from "./TransferProof";

/** מצבים שבהם מוצג מצב התשלום (בקשה פעילה / הזמנה) */
const PAYABLE = new Set([
  "pending_approval",
  "pending_payment",
  "confirmed",
  "cancel_requested",
  "checked_in",
  "checked_out",
]);

/** הטוקן / מספר הבקשה מה-# של הכתובת (רק בדפדפן) */
function useHashParams(): {
  token: string | null;
  number: number | null;
  /** מיגרציה 44: בקשה לכמה חדרים — מספר החדרים */
  rooms: number | null;
  ready: boolean;
} {
  const [state, setState] = useState<{
    token: string | null;
    number: number | null;
    rooms: number | null;
    ready: boolean;
  }>({
    token: null,
    number: null,
    rooms: null,
    ready: false,
  });
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = params.get("t");
      const n = Number(params.get("n"));
      const rooms = Number(params.get("rooms"));
      setState({
        token: token && /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : null,
        number: Number.isInteger(n) && n > 0 ? n : null,
        rooms: Number.isInteger(rooms) && rooms > 1 && rooms <= 8 ? rooms : null,
        ready: true,
      });
    };
    read();
    // מה שאחרי ה-# כאן הוא טוקן, לא עוגן בעמוד: הנתב מחפש אלמנט בשם הזה, לא מוצא, ומשאיר את הגלילה
    // של העמוד הקודם (בטופס ההזמנה — למטה, ליד כפתור השליחה) — והכותרת נשארת מתחת לכותרת הקבועה של
    // האתר. העמודים האלה מתחילים תמיד מלמעלה.
    window.scrollTo(0, 0);
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return state;
}

const bookingKey = (token: string | null) => ["hospitality", "site", "my-booking", token] as const;

function useGuestBooking(token: string | null) {
  return useQuery({
    queryKey: bookingKey(token),
    queryFn: () => hospitalitySiteBooking({ data: { token: token! } }),
    enabled: !!token,
    retry: false,
    staleTime: 30_000,
  });
}

export function Frame({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className="bg-background pt-24 sm:pt-28">
      <div className={cn("mx-auto px-4 pb-20 sm:px-8", narrow ? "max-w-2xl" : "max-w-4xl")}>
        {children}
      </div>
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--radius)] border border-border bg-card p-6 text-muted-foreground">
      {children}
    </p>
  );
}

// ---------- הבקשה התקבלה ----------

/** מיגרציה 44: החדרים של הבקשה ששלחתם עכשיו (נשמרו בדפדפן הזה בשליחה) */
function groupRoomsFromSession(): { number: number; unit_name: string; total: number }[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem("hosp-group-request") ?? "[]") as unknown;
    return Array.isArray(raw)
      ? (raw as Record<string, unknown>[])
          .filter((r) => typeof r?.["unit_name"] === "string")
          .map((r) => ({
            number: Number(r["number"]),
            unit_name: String(r["unit_name"]),
            total: Number(r["total"]),
          }))
      : [];
  } catch {
    return [];
  }
}

export function BookingReceivedPage() {
  const t = useCopy();
  const { site } = useSite();
  const { token, number, rooms, ready } = useHashParams();
  const [groupRooms, setGroupRooms] = useState<
    { number: number; unit_name: string; total: number }[]
  >([]);
  useEffect(() => {
    if (rooms) setGroupRooms(groupRoomsFromSession());
  }, [rooms]);
  const query = useGuestBooking(token);
  const b = query.data?.booking;
  const confirmed = b?.status === "confirmed";
  const shownNumber = b?.number ?? number;
  // מיגרציה 37: העסק הגדיר הוראות תשלום — הנוסח מפנה לעמוד ההזמנה; אחרת — התשלום הטלפוני של D4
  const instructions = hasInstructions(query.data?.payment?.methods);
  return (
    <Frame narrow>
      <div className="rounded-[var(--radius)] border border-border bg-card p-8 text-center shadow-[var(--site-shadow)] sm:p-12">
        <CheckCircle2 className="mx-auto size-14 text-[var(--site-gold-ink)]" aria-hidden="true" />
        <h1 className="font-display mt-5 text-3xl font-medium sm:text-4xl">
          {confirmed ? t.received.titleConfirmed : t.received.title}
        </h1>
        {rooms ? (
          <p className="mt-3 text-lg" data-testid="group-lead">
            {t.received.groupLead(rooms)}
          </p>
        ) : (
          shownNumber && <p className="mt-3 text-lg">{t.received.lead(shownNumber)}</p>
        )}
        {!ready || (token && query.isPending) ? (
          <p className="mt-6 text-muted-foreground">{t.my.loading}</p>
        ) : !shownNumber ? (
          <p className="mt-6 text-muted-foreground">{t.received.missing}</p>
        ) : (
          <>
            {/* D4: תשלום טלפוני — ההודעה אחרי שליחת הבקשה */}
            <p
              className="mx-auto mt-6 max-w-md text-lg leading-relaxed"
              data-testid="phone-payment-message"
            >
              {instructions
                ? confirmed
                  ? t.received.instructionsInstant
                  : t.received.instructions
                : confirmed
                  ? t.received.phoneInstant
                  : t.received.phone}
            </p>
            <p className="mx-auto mt-3 max-w-md leading-relaxed text-muted-foreground">
              {confirmed ? t.received.confirmed : t.received.pending(site.business.approval_hours)}
            </p>
            <p className="mx-auto mt-4 flex max-w-md items-start justify-center gap-2 rounded-sm bg-[var(--site-sand)] px-3 py-2 text-sm">
              <Phone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {instructions ? t.received.noOnlineAny : t.received.noOnline}
            </p>
            {rooms && groupRooms.length > 0 && b && (
              <dl
                className="mx-auto mt-8 grid max-w-md gap-3 rounded-sm bg-[var(--site-sand)] p-5 text-start text-sm"
                data-testid="group-rooms"
              >
                {groupRooms.map((r) => (
                  <Row
                    key={r.number}
                    label={`#${r.number}`}
                    value={`${r.unit_name} · ${money(r.total, b.currency)}`}
                  />
                ))}
                <Row label={t.my.dates} value={stayText(b.check_in, b.check_out, t.locale)} />
                <Row
                  label={t.my.total}
                  value={money(
                    groupRooms.reduce((s, r) => s + r.total, 0),
                    b.currency,
                  )}
                />
              </dl>
            )}
            {b && !(rooms && groupRooms.length > 0) && (
              <dl className="mx-auto mt-8 grid max-w-md gap-3 rounded-sm bg-[var(--site-sand)] p-5 text-start text-sm">
                <Row label={t.my.unit} value={b.unit_name} />
                <Row label={t.my.dates} value={stayText(b.check_in, b.check_out, t.locale)} />
                <Row label={t.my.guests} value={t.my.guestsText(b.adults, b.children)} />
                <Row label={t.my.total} value={money(Number(b.total), b.currency)} />
              </dl>
            )}
            <p className="mx-auto mt-6 flex max-w-md items-start justify-center gap-2 text-sm text-muted-foreground">
              <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {rooms ? t.received.groupEmail : t.received.email}
            </p>
          </>
        )}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {token && b && (
            <Link
              to="/stay/my-booking"
              hash={`t=${token}`}
              className="inline-flex h-12 items-center justify-center rounded-sm bg-primary px-8 font-medium text-primary-foreground"
            >
              {t.received.manage}
            </Link>
          )}
          <Link
            to="/stay"
            className="inline-flex h-12 items-center justify-center rounded-sm border border-foreground/25 px-8 hover:bg-foreground/5"
          >
            {t.received.home}
          </Link>
        </div>
        {token && b && <p className="mt-4 text-xs text-muted-foreground">{t.received.keep}</p>}
      </div>
    </Frame>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

// ---------- ההזמנה שלי ----------

/** הזמנה שעוד רלוונטית להגעה (בלי מידע הגעה בהזמנה שבוטלה / נדחתה / הסתיימה) */
const LIVE: string[] = [
  "pending_approval",
  "pending_payment",
  "confirmed",
  "cancel_requested",
  "checked_in",
];

const STATUS_TONE: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-900",
  pending_payment: "bg-amber-100 text-amber-900",
  confirmed: "bg-emerald-100 text-emerald-900",
  cancel_requested: "bg-amber-100 text-amber-900",
  checked_in: "bg-emerald-100 text-emerald-900",
  checked_out: "bg-muted text-foreground",
};

/** מצב ההזמנה (תג צבעוני) — "ההזמנה שלי" ו"ההזמנות שלי" */
export function StatusChip({ status, className }: { status: string; className?: string }) {
  const t = useCopy();
  return (
    <span
      className={cn(
        "rounded-full px-4 py-1.5 text-sm font-medium",
        STATUS_TONE[status] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {t.statuses[status] ?? status}
    </span>
  );
}

export function MyBookingPage() {
  const t = useCopy();
  const { site } = useSite();
  const queryClient = useQueryClient();
  const { token, ready } = useHashParams();
  const query = useGuestBooking(token);
  if (!ready || (token && query.isPending))
    return (
      <Frame>
        <Notice>{t.my.loading}</Notice>
      </Frame>
    );
  if (!token || query.isError || !query.data)
    return (
      <Frame>
        <h1 className="font-display mb-6 text-3xl font-medium">{t.my.title}</h1>
        <Notice>{t.my.notFound}</Notice>
      </Frame>
    );
  const { booking: b, arrival, payment } = query.data;
  const tz = b.policy?.timezone || site.business.timezone;
  const pending = b.status === "pending_approval" || b.status === "pending_payment";
  return (
    <Frame>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="text-sm text-muted-foreground">{t.my.title}</p>
          <h1 className="font-display mt-1 text-3xl font-medium sm:text-4xl">
            {t.my.number(b.number)}
          </h1>
        </div>
        <StatusChip status={b.status} />
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-[var(--radius)] border border-border bg-card p-6">
          <dl className="space-y-3 text-sm">
            <Row label={t.my.unit} value={b.unit_name} />
            <Row label={t.my.dates} value={stayText(b.check_in, b.check_out, t.locale)} />
            <Row label={t.my.guests} value={t.my.guestsText(b.adults, b.children)} />
            <Row label={t.my.total} value={money(Number(b.total), b.currency)} />
            {Number(b.amount_paid) > 0 && (
              <Row label={t.my.paid} value={money(Number(b.amount_paid), b.currency)} />
            )}
            {/* D4: מצב התשלום — רק לפי מה שהעסק רשם (תשלום טלפוני) */}
            {PAYABLE.has(b.status) && (
              <Row label={t.my.payment} value={paymentRowText(b, payment, t)} />
            )}
          </dl>
          {pending && b.hold_expires_at && (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-4" aria-hidden="true" />
              {t.my.expires(dateTimeText(b.hold_expires_at, tz, t.locale))}
            </p>
          )}
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-6">
          <h2 className="mb-3 font-medium">{t.my.cancellation}</h2>
          {b.policy ? (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {scheduleLines(b.policy, t).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          {b.can_request_cancellation && <CancelBooking token={token} booking={b} />}
        </section>

        {payment && <PaymentCard payment={payment} />}

        {payment && (
          <TransferCard
            payment={payment}
            timeZone={tz}
            send={(file) => {
              const form = new FormData();
              form.set("token", token);
              form.set("file", file);
              return hospitalitySiteUploadProof({ data: form });
            }}
            onSent={(info) =>
              queryClient.setQueryData(bookingKey(token), (old: unknown) =>
                old && typeof old === "object" ? { ...(old as object), payment: info } : old,
              )
            }
          />
        )}

        {LIVE.includes(b.status) && <ArrivalCard arrival={arrival} timeZone={tz} />}

        <section className="rounded-[var(--radius)] border border-border bg-card p-6">
          <h2 className="mb-3 font-medium">{t.my.contact}</h2>
          <ContactLinks />
        </section>
      </div>
      <p className="mt-8 text-center text-xs text-muted-foreground">{t.my.linkNote}</p>
    </Frame>
  );
}

/**
 * "איך משלמים" (מיגרציה 37): רק אחרי שההזמנה אושרה ונשאר סכום לתשלום (המסד מחליט). לפני האישור —
 * הודעה שהפרטים יופיעו כאן. ההוראות אינן אישור תשלום: "שולם" רק לפי מה שהעסק רשם.
 */
export function PaymentCard({ payment }: { payment: GuestPaymentInfo }) {
  const t = useCopy();
  if (!payment.available) {
    if (payment.reason !== "not_confirmed" || !hasInstructions(payment.methods)) return null;
    return (
      <section
        className="rounded-[var(--radius)] border border-border bg-card p-6"
        data-testid="guest-payment"
      >
        <h2 className="mb-2 font-medium">{t.my.pay.title}</h2>
        <p className="text-sm text-muted-foreground">{t.my.pay.notYet}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {methodsText(payment.methods, t.my.methodNames)}
        </p>
      </section>
    );
  }
  const currency = payment.currency ?? "ILS";
  return (
    <section
      className="rounded-[var(--radius)] border border-border bg-card p-6 md:col-span-2"
      data-testid="guest-payment"
      aria-labelledby="guest-payment-title"
    >
      <h2 id="guest-payment-title" className="font-medium">
        {t.my.pay.title}
      </h2>
      <dl className="mt-3 grid gap-2 rounded-sm bg-[var(--site-sand)] p-4 text-sm sm:grid-cols-2">
        <Row label={t.my.pay.due} value={money(Number(payment.amount_due ?? 0), currency)} />
        {Number(payment.deposit_due ?? 0) > 0 && (
          <Row label={t.my.pay.depositNow} value={money(Number(payment.deposit_due), currency)} />
        )}
      </dl>
      {payment.reference && (
        <p className="mt-3 text-sm font-medium">{t.my.pay.reference(payment.reference)}</p>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {payment.bank && (
          <div className="rounded-sm border border-border p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Landmark className="size-4" aria-hidden="true" />
              {t.my.pay.bankTitle}
            </h3>
            <dl className="space-y-2 text-sm">
              <Row label={t.my.pay.bankName} value={payment.bank.name} />
              <Row
                label={t.my.pay.branch}
                value={<CopyValue value={payment.bank.branch} label={t.my.pay.branch} />}
              />
              <Row
                label={t.my.pay.account}
                value={<CopyValue value={payment.bank.account} label={t.my.pay.account} />}
              />
              <Row label={t.my.pay.holder} value={payment.bank.holder} />
            </dl>
          </div>
        )}
        {payment.bit && (
          <div className="rounded-sm border border-border p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Smartphone className="size-4" aria-hidden="true" />
              {t.my.pay.bitTitle}
            </h3>
            <dl className="text-sm">
              <Row
                label={t.my.pay.bitTo}
                value={<CopyValue value={payment.bit.phone} label={t.my.pay.bitTitle} />}
              />
            </dl>
          </div>
        )}
        {payment.phone && (
          <div className="rounded-sm border border-border p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Phone className="size-4" aria-hidden="true" />
              {t.my.pay.phoneTitle}
            </h3>
            <p className="text-sm text-muted-foreground">{t.my.pay.phoneText}</p>
            {payment.phone.number && (
              <p className="mt-2 text-sm">
                {t.my.pay.phoneCall}:{" "}
                <a href={telHref(payment.phone.number)} className="font-medium underline" dir="ltr">
                  {payment.phone.number}
                </a>
              </p>
            )}
          </div>
        )}
        {payment.note && (
          <div className="rounded-sm border border-border p-4 md:col-span-2">
            <h3 className="mb-2 text-sm font-semibold">{t.my.pay.noteTitle}</h3>
            <p className="text-sm whitespace-pre-line">{payment.note}</p>
          </div>
        )}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t.my.pay.notReceipt}</p>
    </section>
  );
}

/** ערך עם כפתור העתקה (מספר חשבון, טלפון ל-Bit). השם הנגיש מתחיל בטקסט שעל הכפתור (WCAG 2.5.3) */
function CopyValue({ value, label }: { value: string; label: string }) {
  const t = useCopy();
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span dir="ltr" className="font-medium tabular-nums">
        {value}
      </span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            },
            () => setCopied(false),
          );
        }}
        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-foreground/5"
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        <span aria-live="polite">{copied ? t.my.pay.copied : t.my.pay.copyShort}</span>
        <span className="sr-only"> — {label}</span>
      </button>
    </span>
  );
}

function ArrivalCard({ arrival, timeZone }: { arrival: GuestArrival | null; timeZone: string }) {
  const t = useCopy();
  if (!arrival) return null;
  const records = [
    { name: null as string | null, info: arrival.property ?? null },
    ...(arrival.units ?? []).map((u) => ({ name: u.name as string | null, info: u.info })),
  ].filter((r): r is { name: string | null; info: ArrivalValues } => !!r.info);
  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-6 md:col-span-2">
      <h2 className="mb-3 flex items-center gap-2 font-medium">
        <KeyRound className="size-4 text-[var(--site-gold-ink)]" aria-hidden="true" />
        {t.my.arrival}
      </h2>
      {!arrival.available ? (
        <p className="text-sm text-muted-foreground">
          {arrival.reason === "too_early" && arrival.available_from
            ? t.my.arrivalSoon(dateTimeText(arrival.available_from, timeZone, t.locale))
            : arrival.reason === "not_confirmed"
              ? t.my.arrivalNotYet
              : null}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {records.map(({ name, info: r }, i) => (
            <dl key={i} className="space-y-2 text-sm">
              {name && records.length > 1 && <p className="font-medium">{name}</p>}
              {r.entry_code && (
                <Row label={t.my.entry} value={<span dir="ltr">{r.entry_code}</span>} />
              )}
              {r.gate_code && (
                <Row label={t.my.gate} value={<span dir="ltr">{r.gate_code}</span>} />
              )}
              {r.wifi_name && (
                <Row label={t.my.wifi} value={<span dir="ltr">{r.wifi_name}</span>} />
              )}
              {r.wifi_password && (
                <Row label={t.my.wifiPassword} value={<span dir="ltr">{r.wifi_password}</span>} />
              )}
              {r.instructions && (
                <p className="pt-1 whitespace-pre-line text-muted-foreground">{r.instructions}</p>
              )}
            </dl>
          ))}
        </div>
      )}
    </section>
  );
}

export function ContactLinks() {
  const t = useCopy();
  const { site } = useSite();
  const b = site.business;
  const wa = b.whatsapp || b.phone;
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {b.phone && (
        <a
          href={telHref(b.phone)}
          className="inline-flex h-10 items-center gap-2 rounded-sm border border-border px-4 hover:bg-muted"
        >
          <Phone className="size-4" aria-hidden="true" />
          <span dir="ltr">{b.phone}</span>
        </a>
      )}
      {wa && (
        <a
          href={whatsappHref(wa)}
          target="_blank"
          rel="noopener"
          className="inline-flex h-10 items-center gap-2 rounded-sm border border-border px-4 hover:bg-muted"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          {t.contact.whatsapp}
        </a>
      )}
      {b.email && (
        <a
          href={`mailto:${b.email}`}
          className="inline-flex h-10 items-center gap-2 rounded-sm border border-border px-4 hover:bg-muted"
        >
          <Mail className="size-4" aria-hidden="true" />
          <span dir="ltr">{b.email}</span>
        </a>
      )}
    </div>
  );
}

function CancelBooking({ token, booking }: { token: string; booking: GuestBookingView }) {
  const t = useCopy();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const pending = booking.status === "pending_approval" || booking.status === "pending_payment";
  const quote = useQuery({
    queryKey: ["hospitality", "site", "cancel-quote", token],
    queryFn: () => hospitalitySiteCancellationQuote({ data: { token } }),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const cancel = useMutation({
    mutationFn: () => hospitalitySiteRequestCancellation({ data: { token, reason } }),
    onSuccess: async () => {
      setOpen(false);
      await qc.invalidateQueries({ queryKey: bookingKey(token) });
    },
  });
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 inline-flex h-10 items-center rounded-sm border border-destructive/40 px-4 text-sm text-destructive hover:bg-destructive/5"
      >
        {pending ? t.my.withdraw : t.my.cancel}
      </button>
    );
  const q = quote.data;
  return (
    <div
      className="mt-5 space-y-3 rounded-sm border border-destructive/30 bg-destructive/5 p-4 text-sm"
      role="group"
    >
      <p className="font-medium">{pending ? t.my.withdrawTitle : t.my.cancelTitle}</p>
      {quote.isPending ? (
        <p className="text-muted-foreground">{t.my.loading}</p>
      ) : q ? (
        <p>
          {Number(q.fee) > 0
            ? t.my.cancelQuote(
                money(Number(q.fee), booking.currency),
                money(Number(q.refund_due), booking.currency),
              )
            : t.my.noFee}{" "}
          {q.result === "cancel_requested" ? t.my.willRequest : t.my.willCancel}
        </p>
      ) : quote.isError ? (
        <p className="text-destructive">
          {quote.error instanceof Error ? quote.error.message : ""}
        </p>
      ) : null}
      <label className="block">
        <span className="text-xs text-muted-foreground">{t.my.reason}</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          className="mt-1 block h-20 w-full rounded-sm border border-input bg-card px-3 py-2"
        />
      </label>
      {cancel.isError && (
        <p role="alert" className="text-destructive">
          {cancel.error instanceof Error ? cancel.error.message : ""}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending || !q}
          className="inline-flex h-10 items-center rounded-sm bg-destructive px-4 text-destructive-foreground disabled:opacity-50"
        >
          {t.my.confirmCancel}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-10 items-center rounded-sm border border-border px-4 hover:bg-muted"
        >
          {t.my.keepIt}
        </button>
      </div>
    </div>
  );
}
