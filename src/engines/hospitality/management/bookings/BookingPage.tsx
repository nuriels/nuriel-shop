// עמוד הזמנה (/manage/bookings/$bookingId) — Stage 2h: פרטי השהייה, האורח (טלפון ואימייל
// מלאים רק למי שמורשה), המחיר לילה-לילה, המדיניות שנשמרה עם ההזמנה, ההיסטוריה והמיילים.
// פעולות לפי המצב: אישור / דחייה (עם סיבה), הגיעו / לא הגיעו / עזבו. כל פעולה שולחת את
// הגרסה שעל המסך — אם ההזמנה השתנתה בינתיים, המסד מסרב ומציגים את הגרסה העדכנית.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Check, ChevronRight, LogIn, LogOut, Mail, Phone, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, Input, Label, cn } from "@/platform/ui";
import {
  hospitalityApproveBooking,
  hospitalityBookingDetail,
  hospitalityDeclineBooking,
  hospitalitySetStayStatus,
} from "../../api/bookings.functions";
import type { BookingDetail, StayStatus } from "../../types/bookings";
import type { PolicyRules } from "../../types/pricing";
import { FormSheet } from "../catalog/CatalogSheets";
import { ConfirmButton, LoadError, PageNotice, PageSkeleton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { RULE_KIND_LABELS, money, policySummary } from "../pricing/model";
import { useManagement } from "../shell/management-context";
import { BookingChanges } from "./BookingChanges";
import { useBookingRefresh } from "./refresh";
import {
  ACTOR_TEXT,
  EMAIL_STATUS,
  PAYMENT_LABELS,
  STATE_LABELS,
  actionsFor,
  bookingKey,
  dateTimeText,
  dayText,
  eventText,
  guestsText,
  holdText,
  sourceText,
  stateTone,
  TONE_CLASS,
} from "./model";

export function BookingPage() {
  const { bookingId } = useParams({ strict: false }) as { bookingId: string };
  const ctx = useManagement();
  const query = useQuery({
    queryKey: bookingKey(bookingId),
    queryFn: () => hospitalityBookingDetail({ data: { id: bookingId } }),
    refetchOnWindowFocus: true,
  });
  if (!ctx.permissions["bookings"])
    return <p className="p-4">אין לכם הרשאה לראות הזמנות באתר הזה.</p>;
  if (query.isError && !query.data) return <LoadError error={query.error} />;
  if (!query.data) return <PageSkeleton label="טוען את ההזמנה…" />;
  return <Booking b={query.data} />;
}

function Booking({ b }: { b: BookingDetail }) {
  const ctx = useManagement();
  const refresh = useBookingRefresh(b.id);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const can = actionsFor(b);
  const hold =
    b.state === "pending_approval" || b.state === "pending_payment"
      ? holdText(b.hold_expires_at)
      : null;

  const run = async (what: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await what();
      toast.success(done);
    } catch (e) {
      setError(errorText(e));
    } finally {
      refresh();
    }
  };
  const stay = (status: StayStatus, done: string) =>
    run(() => hospitalitySetStayStatus({ data: { id: b.id, status, revision: b.revision } }), done);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        to="/manage/bookings"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
        חזרה להזמנות
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">הזמנה #{b.number}</h1>
          <span
            className={cn(
              "rounded px-2 py-0.5 text-sm font-medium",
              TONE_CLASS[stateTone(b.state)],
            )}
            data-testid="booking-state"
          >
            {STATE_LABELS[b.state]}
          </span>
        </div>
        <p className="text-muted-foreground">
          {b.guest.name} · {b.unit.name} · {dayText(b.check_in)} – {dayText(b.check_out)}
        </p>
        {hold && <p className="font-medium text-amber-800">{hold}</p>}
      </header>

      <PageNotice error={error}>{null}</PageNotice>

      {(can.approve || can.checkIn || can.checkOut) && (
        <Card data-section="actions">
          <CardContent className="flex flex-wrap gap-2 pt-6">
            {can.approve && (
              <ConfirmButton
                label="אישור ההזמנה"
                icon={<Check className="size-4" aria-hidden="true" />}
                title={`לאשר את הזמנה #${b.number}?`}
                description={<p>האורח יקבל מייל אישור, והתאריכים נשמרים לו.</p>}
                confirmLabel="אישור"
                onConfirm={() =>
                  run(
                    () =>
                      hospitalityApproveBooking({
                        data: { id: b.id, revision: b.revision, reason: null },
                      }),
                    "ההזמנה אושרה",
                  )
                }
              />
            )}
            {can.decline && (
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-destructive px-4 text-sm font-medium text-destructive hover:bg-destructive/10"
                onClick={() => setDeclining(true)}
              >
                <X className="size-4" aria-hidden="true" />
                דחיית הבקשה
              </button>
            )}
            {can.checkIn && (
              <ConfirmButton
                label="האורחים הגיעו"
                icon={<LogIn className="size-4" aria-hidden="true" />}
                title="לסמן שהאורחים הגיעו?"
                description={<p>ההזמנה תעבור ל"שוהים עכשיו".</p>}
                confirmLabel="הגיעו"
                onConfirm={() => stay("checked_in", "סומן: האורחים הגיעו")}
              />
            )}
            {can.noShow && (
              <ConfirmButton
                label="לא הגיעו"
                icon={<UserX className="size-4" aria-hidden="true" />}
                title="לסמן שהאורחים לא הגיעו?"
                description={<p>דמי אי-ההגעה נקבעים לפי מדיניות הביטול שנשמרה עם ההזמנה.</p>}
                confirmLabel="לא הגיעו"
                destructive
                onConfirm={() => stay("no_show", "סומן: האורחים לא הגיעו")}
              />
            )}
            {can.checkOut && (
              <ConfirmButton
                label="האורחים עזבו"
                icon={<LogOut className="size-4" aria-hidden="true" />}
                title="לסמן שהאורחים עזבו?"
                description={<p>ההזמנה תעבור ל"עבר".</p>}
                confirmLabel="עזבו"
                onConfirm={() => stay("checked_out", "סומן: האורחים עזבו")}
              />
            )}
          </CardContent>
        </Card>
      )}

      <BookingChanges b={b} onError={setError} />

      <Section title="השהייה">
        <Rows
          rows={[
            ["יחידה", `${b.unit.name} · ${b.unit.property_name}`],
            ["הגעה", dayText(b.check_in)],
            ["עזיבה", dayText(b.check_out)],
            ["לילות", String(b.nights)],
            ["אורחים", guestsText(b)],
            ["מקור", sourceText(b)],
            ["נוצרה", dateTimeText(b.created_at)],
          ]}
        />
        {b.special_requests && (
          <p className="mt-3 rounded-md bg-muted p-3 text-sm">
            <span className="font-medium">בקשות האורח: </span>
            {b.special_requests}
          </p>
        )}
      </Section>

      <Section title="האורח">
        {b.guest.anonymized ? (
          <p className="text-sm text-muted-foreground">פרטי האורח נמחקו לבקשתו.</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            {ctx.permissions["guests"] ? (
              <Link
                to="/manage/guests/$guestId"
                params={{ guestId: b.guest.id }}
                className="font-medium text-primary hover:underline"
              >
                {b.guest.name}
              </Link>
            ) : (
              <p className="font-medium">{b.guest.name}</p>
            )}
            {b.guest.phone && (
              <p className="flex items-center gap-2">
                <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
                {b.guest.contact_full ? (
                  <a
                    href={`tel:${b.guest.phone}`}
                    dir="ltr"
                    className="text-primary hover:underline"
                  >
                    {b.guest.phone}
                  </a>
                ) : (
                  <span dir="ltr">{b.guest.phone}</span>
                )}
              </p>
            )}
            {b.guest.email && (
              <p className="flex items-center gap-2">
                <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
                {b.guest.contact_full ? (
                  <a
                    href={`mailto:${b.guest.email}`}
                    dir="ltr"
                    className="text-primary hover:underline"
                  >
                    {b.guest.email}
                  </a>
                ) : (
                  <span dir="ltr">{b.guest.email}</span>
                )}
              </p>
            )}
            {!b.guest.contact_full && (
              <p className="text-muted-foreground">
                פרטי הקשר המלאים — רק למי שיש לו הרשאה לאורחים.
              </p>
            )}
            {b.guest.bookings_count > 1 && (
              <p className="text-muted-foreground">אורח חוזר — {b.guest.bookings_count} הזמנות.</p>
            )}
          </div>
        )}
      </Section>

      <Section title="מחיר">
        <table className="w-full text-sm">
          <caption className="sr-only">מחיר לכל לילה</caption>
          <thead>
            <tr className="text-muted-foreground [&>th]:pe-3">
              <th className="text-start font-normal">לילה</th>
              <th className="text-start font-normal">מחיר</th>
              <th className="text-start font-normal">תוספת אורחים</th>
              <th className="text-start font-normal">לפי</th>
            </tr>
          </thead>
          <tbody>
            {b.nights_detail.map((n) => (
              <tr key={n.night} className="border-t [&>td]:py-1 [&>td]:pe-3">
                <td className="whitespace-nowrap">{dayText(n.night)}</td>
                <td>{money(n.base_rate, b.currency)}</td>
                <td>{n.extras > 0 ? money(n.extras, b.currency) : "—"}</td>
                <td>
                  {n.rule === "base"
                    ? "מחיר בסיס"
                    : n.rule === "manual"
                      ? "מחיר ידני"
                      : (RULE_KIND_LABELS[n.rule as keyof typeof RULE_KIND_LABELS] ?? n.rule)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Rows
          className="mt-3"
          rows={[
            ...(b.discount > 0
              ? ([["הנחה", money(b.discount, b.currency)]] as [string, string][])
              : []),
            ["סה״כ", money(b.total, b.currency)],
            ...(b.deposit_amount > 0
              ? ([["מקדמה לפי המדיניות", money(b.deposit_amount, b.currency)]] as [
                  string,
                  string,
                ][])
              : []),
            [
              "תשלום",
              `${PAYMENT_LABELS[b.payment_status]}${b.amount_paid > 0 ? ` (${money(b.amount_paid, b.currency)})` : ""}`,
            ],
          ]}
        />
        {b.price_manual && <p className="mt-2 text-sm text-muted-foreground">המחיר נקבע ידנית.</p>}
      </Section>

      <Section title={`מדיניות ביטול${b.policy.name ? ` — ${b.policy.name}` : ""}`}>
        <p className="text-sm">
          {b.policy.rules ? policySummary(b.policy.rules as unknown as PolicyRules) : "—"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          זו המדיניות שהאורח אישר בעת ההזמנה — שינוי במדיניות של העסק לא משנה אותה.
        </p>
      </Section>

      <Section title="היסטוריה">
        <ol className="flex flex-col gap-2 text-sm" data-testid="booking-history">
          {b.events.map((e, i) => (
            <li key={i} className="flex flex-col border-s-2 border-muted ps-3">
              <span className="font-medium">{eventText(e)}</span>
              <span className="text-xs text-muted-foreground">
                {dateTimeText(e.at)} · {e.actor ?? ACTOR_TEXT[e.actor_kind]}
              </span>
              {e.note && <span className="text-muted-foreground">{e.note}</span>}
            </li>
          ))}
        </ol>
      </Section>

      {b.emails.length > 0 && (
        <Section title="מיילים">
          <ul className="flex flex-col gap-1 text-sm">
            {b.emails.map((m) => (
              <li key={m.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {m.recipient_kind === "guest" ? "לאורח" : "לעסק"}{" "}
                  <span dir="ltr" className="text-muted-foreground">
                    {m.recipient}
                  </span>
                </span>
                <span className={cn(m.has_error && "text-destructive")}>
                  {EMAIL_STATUS[m.status] ?? m.status}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {declining && <DeclineSheet b={b} onClose={() => setDeclining(false)} onDone={refresh} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Rows({ rows, className }: { rows: [string, string][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm", className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function DeclineSheet({
  b,
  onClose,
  onDone,
}: {
  b: BookingDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormSheet
      open
      title={`דחיית בקשה #${b.number}`}
      description="האורח יקבל מייל שהבקשה לא אושרה, והתאריכים יתפנו מיד."
      dirty={reason !== ""}
      busy={busy}
      submitLabel="דחיית הבקשה"
      serverError={error}
      notice={null}
      hasErrors={reason.length > 1000}
      submitted
      onClose={onClose}
      onSubmit={() => {
        setBusy(true);
        setError(null);
        void hospitalityDeclineBooking({ data: { id: b.id, revision: b.revision, reason } })
          .then(() => {
            toast.success("הבקשה נדחתה");
            onDone();
            onClose();
          })
          .catch((e: unknown) => {
            setError(errorText(e));
            onDone();
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="decline-reason">סיבה (לא חובה — תופיע במייל לאורח)</Label>
        <Input
          id="decline-reason"
          value={reason}
          maxLength={1000}
          placeholder="למשל: התאריכים כבר לא פנויים"
          onChange={(e) => setReason(e.target.value)}
          className="min-h-11"
        />
      </div>
    </FormSheet>
  );
}
