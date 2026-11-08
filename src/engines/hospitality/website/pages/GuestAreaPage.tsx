// שלב א' 2: "ההזמנות שלי" (/stay/account) — האזור האישי של האורח: כניסה בקוד חד-פעמי למייל, רשימת
// ההזמנות שלו באתר הזה (קרובות קודם — גם חודשים קדימה), ופרטי הזמנה עם התשלום ואישורי ההעברה.
// החיבור — עוגייה HttpOnly של האתר; ההרשאות כולן בשרת ובמסד (מיגרציה 56).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  Download,
  FileSignature,
  LogOut,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useId, useState } from "react";
import {
  hospitalityGuestAreaBooking,
  hospitalityGuestAreaBookings,
  hospitalityGuestAreaRequestCode,
  hospitalityGuestAreaSignOut,
  hospitalityGuestAreaUploadProof,
  hospitalityGuestAreaVerifyCode,
  hospitalityGuestDocumentFile,
  hospitalityGuestDocuments,
} from "../../api/guest-area.functions";
import type { GuestDocument } from "../../types/contracts";
import type { GuestAreaBooking } from "../../types/guest-area";
import type { GuestPaymentInfo } from "../../types/payment-instructions";
import { useCopy } from "../copy";
import { money, scheduleLines, stayText } from "../lib/format";
import { useSite } from "../lib/site-context";
import { areaPaymentText, paymentRowText } from "../lib/transfer";
import { ContactLinks, Frame, Notice, PaymentCard, Row, StatusChip } from "./GuestBookingPages";
import { TransferCard } from "./TransferProof";

const AREA_KEY = ["hospitality", "site", "guest-area"] as const;
const detailKey = (id: string) => [...AREA_KEY, "booking", id] as const;

const errText = (e: unknown, fallback: string) =>
  e instanceof Error && /[֐-׿]/.test(e.message) ? e.message : fallback;

const input =
  "mt-1.5 block min-h-11 w-full rounded-sm border border-border bg-background px-3 text-base";
const primary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-[var(--primary)] px-5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-60";
const quiet =
  "inline-flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm underline-offset-4 hover:underline disabled:opacity-60";

export function GuestAreaPage() {
  const t = useCopy();
  const search = useSearch({ strict: false }) as { booking?: string };
  const list = useQuery({
    queryKey: AREA_KEY,
    queryFn: () => hospitalityGuestAreaBookings(),
    retry: false,
    staleTime: 30_000,
  });
  // נגישות (IS 5568 2.4.10): גם בזמן הטעינה — ובשרת, שמגיש את מצב הטעינה — העמוד נפתח בכותרת שלו
  if (list.isPending)
    return (
      <Frame>
        <h1 className="font-display mb-6 text-3xl font-medium">{t.account.title}</h1>
        <Notice>{t.account.loading}</Notice>
      </Frame>
    );
  if (list.isError)
    return (
      <Frame>
        <h1 className="font-display mb-6 text-3xl font-medium">{t.account.title}</h1>
        <p role="alert" className="text-destructive">
          {errText(list.error, t.account.retry)}
        </p>
      </Frame>
    );
  if (list.data.state === "signed_out") return <SignIn />;
  return search.booking ? (
    <AreaBooking id={search.booking} />
  ) : (
    <AreaList email={list.data.email} bookings={list.data.bookings} />
  );
}

// ---------- כניסה: אימייל → קוד ----------

function SignIn() {
  const t = useCopy();
  const qc = useQueryClient();
  const emailId = useId();
  const codeId = useId();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ maskedEmail: string; minutes: number } | null>(null);
  const request = useMutation({
    mutationFn: () => hospitalityGuestAreaRequestCode({ data: { email } }),
    onSuccess: (r) => {
      setSent({ maskedEmail: r.maskedEmail, minutes: r.minutes });
      setCode("");
    },
  });
  const verify = useMutation({
    mutationFn: () => hospitalityGuestAreaVerifyCode({ data: { email, code } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: AREA_KEY }),
  });
  return (
    <Frame narrow>
      <h1 className="font-display mb-2 text-3xl font-medium sm:text-4xl">{t.account.title}</h1>
      <p className="mb-8 text-muted-foreground">{t.account.intro}</p>
      <section className="rounded-[var(--radius)] border border-border bg-card p-6">
        {!sent ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              request.mutate();
            }}
          >
            <label htmlFor={emailId} className="block text-sm font-medium">
              {t.account.email}
            </label>
            <input
              id={emailId}
              type="email"
              dir="ltr"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
            />
            <button type="submit" className={primary} disabled={request.isPending || !email.trim()}>
              <Mail className="size-4" aria-hidden="true" />
              {request.isPending ? t.account.sending : t.account.sendCode}
            </button>
            {request.isError && (
              <p role="alert" className="text-sm text-destructive">
                {errText(request.error, t.account.retry)}
              </p>
            )}
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              verify.mutate();
            }}
          >
            <p role="status" className="text-sm">
              {t.account.codeSent(sent.maskedEmail, sent.minutes)}
            </p>
            <p className="text-xs text-muted-foreground">{t.account.notArrived}</p>
            <label htmlFor={codeId} className="block text-sm font-medium">
              {t.account.code}
            </label>
            <input
              id={codeId}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className={`${input} tracking-[0.4em]`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className={primary}
                disabled={verify.isPending || code.length !== 6}
              >
                {verify.isPending ? t.account.verifying : t.account.verify}
              </button>
              <button
                type="button"
                className={quiet}
                disabled={request.isPending}
                onClick={() => {
                  verify.reset();
                  request.mutate();
                }}
              >
                {t.account.resend}
              </button>
              <button
                type="button"
                className={quiet}
                onClick={() => {
                  setSent(null);
                  verify.reset();
                  request.reset();
                }}
              >
                {t.account.otherEmail}
              </button>
            </div>
            {(verify.isError || request.isError) && (
              <p role="alert" className="text-sm text-destructive">
                {errText(verify.error ?? request.error, t.account.retry)}
              </p>
            )}
          </form>
        )}
      </section>
      <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t.account.privacy}
      </p>
    </Frame>
  );
}

function SignOutButton() {
  const t = useCopy();
  const qc = useQueryClient();
  const out = useMutation({
    mutationFn: () => hospitalityGuestAreaSignOut(),
    // העוגייה נמחקה בשרת — הרשימה נטענת מחדש ומחזירה "לא מחובר" (מסך הכניסה)
    onSettled: () => void qc.resetQueries({ queryKey: AREA_KEY }),
  });
  return (
    <button type="button" className={quiet} disabled={out.isPending} onClick={() => out.mutate()}>
      <LogOut className="size-4" aria-hidden="true" />
      {t.account.signOut}
    </button>
  );
}

// ---------- הרשימה ----------

function AreaList({ email, bookings }: { email: string; bookings: GuestAreaBooking[] }) {
  const t = useCopy();
  const { site } = useSite();
  const upcoming = bookings.filter((b) => b.check_out >= site.today);
  const past = bookings.filter((b) => b.check_out < site.today);
  return (
    <Frame>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="font-display text-3xl font-medium sm:text-4xl">{t.account.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground" dir="auto">
            {t.account.signedInAs(email)}
          </p>
        </div>
        <SignOutButton />
      </header>
      {bookings.length === 0 ? (
        <div className="space-y-3" data-testid="guest-area-empty">
          <Notice>{t.account.empty}</Notice>
          <p className="text-sm text-muted-foreground">{t.account.emptyHint}</p>
          <ContactLinks />
        </div>
      ) : (
        <div className="space-y-10">
          {upcoming.length > 0 && <BookingList title={t.account.upcoming} items={upcoming} />}
          {past.length > 0 && <BookingList title={t.account.past} items={past} />}
        </div>
      )}
      <MyDocuments />
      <p className="mt-10 flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t.account.privacy}
      </p>
    </Frame>
  );
}

// ---------- המסמכים שלי (מיגרציה 64): רק ההסכמים החתומים של הכתובת המחוברת ----------

const docDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("he-IL", { dateStyle: "long", timeZone }).format(new Date(iso));

function MyDocuments() {
  const t = useCopy();
  const { site } = useSite();
  const docs = useQuery({
    queryKey: [...AREA_KEY, "documents"],
    queryFn: () => hospitalityGuestDocuments(),
    retry: false,
    staleTime: 30_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list: GuestDocument[] = docs.data?.state === "signed_in" ? docs.data.documents : [];
  if (list.length === 0) return null;
  const download = async (d: GuestDocument) => {
    setBusy(d.id);
    setError(null);
    try {
      const r = await hospitalityGuestDocumentFile({ data: { id: d.id } });
      if (r.state === "ok") window.location.assign(r.url);
      else setError(t.account.signedOut);
    } catch (e) {
      setError(errText(e, t.account.retry));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="mt-10" data-testid="guest-area-documents">
      <h2 className="mb-1 text-lg font-medium">{t.account.documents.title}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t.account.documents.intro}</p>
      <ul className="grid gap-3 md:grid-cols-2">
        {list.map((d) => (
          <li
            key={d.id}
            className="flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-card p-5"
            data-document={d.number}
          >
            <div className="flex items-start gap-3">
              <FileSignature className="mt-0.5 size-5 shrink-0 opacity-70" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium">{d.title}</p>
                <p className="text-sm text-muted-foreground">
                  {t.account.documents.number(d.number)} ·{" "}
                  {t.account.documents.signedAt(docDate(d.signed_at, site.business.timezone))}
                  {d.event_purpose ? ` · ${d.event_purpose}` : ""}
                </p>
                {d.status === "superseded" && (
                  <p className="text-sm text-muted-foreground">{t.account.documents.superseded}</p>
                )}
              </div>
            </div>
            {d.has_pdf ? (
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-sm border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-60"
                disabled={busy !== null}
                onClick={() => void download(d)}
              >
                <Download className="size-4" aria-hidden="true" />
                {busy === d.id ? t.account.documents.downloading : t.account.documents.download}
              </button>
            ) : (
              <p className="text-sm text-muted-foreground">{t.account.documents.notReady}</p>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function BookingList({ title, items }: { title: string; items: GuestAreaBooking[] }) {
  const t = useCopy();
  return (
    <section>
      <h2 className="mb-4 text-lg font-medium">{title}</h2>
      <ul className="grid gap-4 md:grid-cols-2" data-testid="guest-area-bookings">
        {items.map((b) => (
          <li
            key={b.id}
            className="flex flex-col gap-4 rounded-[var(--radius)] border border-border bg-card p-5"
            data-booking={b.number}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{t.my.number(b.number)}</span>
              <StatusChip status={b.status} className="px-3 py-1 text-xs" />
            </div>
            <dl className="space-y-2 text-sm">
              {b.package_name && <Row label={t.packages.row} value={b.package_name} />}
              <Row label={t.my.unit} value={b.unit_name} />
              <Row
                label={t.my.dates}
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-4 opacity-60" aria-hidden="true" />
                    {stayText(b.check_in, b.check_out, t.locale)}
                  </span>
                }
              />
              <Row label={t.my.guests} value={t.my.guestsText(b.adults, b.children)} />
              <Row label={t.my.total} value={money(Number(b.total), b.currency)} />
              <Row label={t.my.payment} value={areaPaymentText(b, t)} />
            </dl>
            <Link
              to="/stay/account"
              search={{ booking: b.id }}
              className="mt-auto inline-flex min-h-11 items-center justify-center rounded-sm border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              {t.account.details}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- הזמנה אחת ----------

function AreaBooking({ id }: { id: string }) {
  const t = useCopy();
  const { site } = useSite();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: detailKey(id),
    queryFn: () => hospitalityGuestAreaBooking({ data: { bookingId: id } }),
    retry: false,
  });
  const back = (
    <Link to="/stay/account" className={`${quiet} mb-4 -ms-3`}>
      <ArrowRight className="size-4" aria-hidden="true" />
      {t.account.back}
    </Link>
  );
  if (detail.isPending)
    return (
      <Frame>
        {back}
        <h1 className="font-display mb-6 text-3xl font-medium">{t.account.title}</h1>
        <Notice>{t.my.loading}</Notice>
      </Frame>
    );
  if (detail.isError || !detail.data)
    return (
      <Frame>
        {back}
        <h1 className="font-display mb-6 text-3xl font-medium">{t.account.title}</h1>
        <Notice>{errText(detail.error, t.my.notFound)}</Notice>
      </Frame>
    );
  if (detail.data.state === "signed_out") {
    void qc.invalidateQueries({ queryKey: AREA_KEY });
    return (
      <Frame>
        <Notice>{t.account.signedOut}</Notice>
      </Frame>
    );
  }
  const { booking: b, payment } = detail.data;
  const tz = b.policy?.timezone || site.business.timezone;
  const onPayment = (info: GuestPaymentInfo) => {
    qc.setQueryData(detailKey(id), (old: unknown) =>
      old && typeof old === "object" ? { ...(old as object), payment: info } : old,
    );
    // מצב ההעברה מופיע גם ברשימה
    void qc.invalidateQueries({ queryKey: AREA_KEY, exact: true });
  };
  return (
    <Frame>
      {back}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="text-sm text-muted-foreground">{t.account.title}</p>
          <h1 className="font-display mt-1 text-3xl font-medium sm:text-4xl">
            {t.my.number(b.number)}
          </h1>
        </div>
        <StatusChip status={b.status} />
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-[var(--radius)] border border-border bg-card p-6">
          <dl className="space-y-3 text-sm">
            {b.package_name && <Row label={t.packages.row} value={b.package_name} />}
            <Row label={t.my.unit} value={b.unit_name} />
            <Row label={t.my.dates} value={stayText(b.check_in, b.check_out, t.locale)} />
            <Row label={t.my.guests} value={t.my.guestsText(b.adults, b.children)} />
            <Row label={t.my.total} value={money(Number(b.total), b.currency)} />
            {Number(b.amount_paid) > 0 && (
              <Row label={t.my.paid} value={money(Number(b.amount_paid), b.currency)} />
            )}
            <Row label={t.my.payment} value={paymentRowText(b, payment, t)} />
          </dl>
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
          <p className="mt-4 text-xs text-muted-foreground">{t.account.arrivalHint}</p>
        </section>
        <PaymentCard payment={payment} />
        <TransferCard
          payment={payment}
          timeZone={tz}
          send={async (file) => {
            const form = new FormData();
            form.set("bookingId", b.id);
            form.set("file", file);
            const r = await hospitalityGuestAreaUploadProof({ data: form });
            if ("state" in r) {
              void qc.invalidateQueries({ queryKey: AREA_KEY });
              throw new Error(t.account.signedOut);
            }
            return r;
          }}
          onSent={onPayment}
        />
        <section className="rounded-[var(--radius)] border border-border bg-card p-6">
          <h2 className="mb-3 font-medium">{t.my.contact}</h2>
          <ContactLinks />
        </section>
      </div>
    </Frame>
  );
}
