// עמוד אירוע (/manage/events/$eventId): פרטים (שעות האירוע והשימוש בבריכה — בנפרד), לקוח, תשלום
// ופיקדון, אורחים בצימרים באותו זמן, פעולות (אישור — עם בדיקת זמינות ואישור מפורש כשיש אורחים
// בצימרים, ביטול עם סיבה ותנאי הביטול שבחוזה, פתיחה מחדש, "הסתיים"), עריכה, ואחרי ביטול / סיום —
// עדכון התשלום, ההחזר ללקוח ומצב הפיקדון; החוזה של האירוע והיסטוריה. הכל נבדק ונרשם במסד (מיגרציה 63).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Mail,
  Phone,
  RotateCcw,
  Users,
  Wallet,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
  Input,
  Label,
  Textarea,
  cn,
} from "@/platform/ui";
import {
  hospitalityEventDetail,
  hospitalityEventSetStatus,
  hospitalityEventUpdate,
} from "../../api/events.functions";
import type { DepositStatus, EventDetail, EventInput, StoredEventStatus } from "../../types/events";
import { LoadError, PageSkeleton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { formatDateTime, formatMoney } from "../lib/format";
import { useManagement } from "../shell/management-context";
import { PageHeader, SectionCard } from "../ui/kit";
import { CustomerDetailsEditor } from "../guests/CustomerDetailsEditor";
import { EventContractsCard } from "./EventContractsCard";
import { EventForm } from "./EventForm";
import {
  DEPOSIT_STATUS_LABEL,
  EVENTS_KEY,
  EVENT_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  STATUS_TONE,
  conflictText,
  dayText,
  eventKey,
  hoursText,
  lodgingText,
  logText,
} from "./model";

type Action = { status: StoredEventStatus; title: string; text: string; reason: boolean } | null;

export function EventPage() {
  const { eventId } = useParams({ strict: false }) as { eventId: string };
  const ctx = useManagement();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: eventKey(eventId),
    queryFn: () => hospitalityEventDetail({ data: { id: eventId } }),
  });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: EVENTS_KEY });
  };
  const update = useMutation({
    mutationFn: (v: { revision: number; data: EventInput }) =>
      hospitalityEventUpdate({ data: { id: eventId, revision: v.revision, data: v.data } }),
    onSuccess: () => {
      toast.success("האירוע עודכן");
      setEditing(false);
      setPaying(false);
      refresh();
    },
    onError: (e) => setEditError(errorText(e)),
  });
  const setStatus = useMutation({
    mutationFn: (v: {
      revision: number;
      status: StoredEventStatus;
      reason: string | null;
      ack: boolean;
    }) =>
      hospitalityEventSetStatus({
        data: {
          id: eventId,
          revision: v.revision,
          status: v.status,
          reason: v.reason,
          lodgingAck: v.ack,
        },
      }),
    onSuccess: (e) => {
      toast.success(`האירוע: ${EVENT_STATUS_LABEL[e.status]}`);
      setAction(null);
      refresh();
    },
    onError: (e) => setActionError(errorText(e)),
  });

  if (!ctx.permissions["bookings"]) return <p className="p-4">אין לכם הרשאה לראות אירועים.</p>;
  if (detail.isError) return <LoadError error={detail.error} />;
  if (!detail.data) return <PageSkeleton label="טוען את האירוע…" />;
  const e = detail.data;
  const open = (a: NonNullable<Action>) => {
    setReason("");
    setAck(false);
    setActionError(null);
    setAction(a);
  };
  const needsAck = action?.status === "confirmed" && e.lodging.length > 0;
  const closed = e.stored_status === "cancelled" || e.stored_status === "completed";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5" data-testid="event-page">
      <PageHeader
        back={{ to: "/manage/events", label: "חזרה לאירועים" }}
        eyebrow={e.customer?.full_name ?? undefined}
        title={
          <span className="flex flex-wrap items-center gap-2">
            אירוע #{e.number} · {e.event_type_label}
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-sm font-semibold",
                STATUS_TONE[e.status],
              )}
              data-testid="event-status"
            >
              {EVENT_STATUS_LABEL[e.status]}
            </span>
          </span>
        }
        actions={
          !editing && (
            <Actions
              e={e}
              onEdit={() => {
                setEditError(null);
                setEditing(true);
              }}
              onAction={open}
            />
          )
        }
      />

      {e.conflicts.length > 0 && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {e.conflicts.map(conflictText).join(" · ")}
        </p>
      )}

      {editing ? (
        <SectionCard title="עריכת האירוע">
          <EventForm
            properties={[{ id: e.property_id, name: e.property_name ?? "המתחם" }]}
            terms={e.terms}
            event={e}
            busy={update.isPending}
            error={editError}
            onCancel={() => setEditing(false)}
            onSubmit={(data) => {
              setEditError(null);
              update.mutate({ revision: e.revision, data });
            }}
          />
        </SectionCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard title="האירוע">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Row k="תאריך">{dayText(e.event_date)}</Row>
              <Row k="שעות האירוע">{hoursText(e)}</Row>
              <Row k="השימוש בבריכה">
                <span data-testid="event-pool-use">
                  {e.pool_start_time && e.pool_end_time
                    ? `${e.pool_start_time}–${e.pool_end_time} בלבד`
                    : "בלי שימוש בבריכה"}
                </span>
              </Row>
              <Row k="מתחם">{e.property_name ?? "—"}</Row>
              <Row k="משתתפים">
                {e.participants} (עד {e.terms.max_event_guests} לפי החוזה)
              </Row>
              <Row k="סוג">{e.event_type_label}</Row>
            </dl>
            {e.outside_pool_hours && (
              <p
                className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950"
                data-testid="event-pool-note"
              >
                האירוע חורג משעות הבריכה ({e.terms.pool_open_time}–{e.terms.pool_close_time}): מחוץ
                לשעות אלו — בלי שימוש בבריכה, וחל איסור על שהייה במים. הלקוח מקבל על כך הודעה לפני
                החתימה ובמייל.
              </p>
            )}
          </SectionCard>

          <SectionCard title="הלקוח">
            {e.customer ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="font-medium">{e.customer.full_name}</p>
                {e.customer.phone && (
                  <a
                    href={`tel:${e.customer.phone}`}
                    className="inline-flex min-h-11 items-center gap-2 underline"
                    dir="ltr"
                  >
                    <Phone className="size-4" aria-hidden="true" />
                    {e.customer.phone}
                  </a>
                )}
                {e.customer.email && (
                  <a
                    href={`mailto:${e.customer.email}`}
                    className="inline-flex min-h-11 items-center gap-2 underline"
                    dir="ltr"
                  >
                    <Mail className="size-4" aria-hidden="true" />
                    {e.customer.email}
                  </a>
                )}
                {/* מיגרציה 65: תיקון פרטי הלקוח — בכרטיס או רק באירוע הזה */}
                {ctx.permissions["guests"] && !e.customer.anonymized && (
                  <div className="mt-2 border-t pt-3">
                    <CustomerDetailsEditor
                      target={{ kind: "event", id: e.id, number: e.number, revision: e.revision }}
                      current={{
                        full_name: e.customer.full_name,
                        phone: e.customer.phone,
                        email: e.customer.email,
                      }}
                      onSaved={() => {
                        void qc.invalidateQueries({ queryKey: eventKey(e.id) });
                        void qc.invalidateQueries({ queryKey: EVENTS_KEY });
                      }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </SectionCard>

          <SectionCard title="תשלום">
            <dl
              className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
              data-testid="event-payment"
            >
              <Row k="מחיר">{formatMoney(e.price)}</Row>
              <Row k="מקדמה">{e.advance_amount ? formatMoney(e.advance_amount) : "—"}</Row>
              <Row k="שולם">{formatMoney(e.amount_paid)}</Row>
              {(e.refund_amount > 0 || e.stored_status === "cancelled") && (
                <Row k="הוחזר ללקוח">{formatMoney(e.refund_amount)}</Row>
              )}
              {e.stored_status === "cancelled" ? (
                <Row k="נשאר אצל העסק">{formatMoney(e.kept_amount)}</Row>
              ) : (
                <Row k="יתרה">{formatMoney(e.balance_due)}</Row>
              )}
              <Row k="מצב">{PAYMENT_STATUS_LABEL[e.payment_status]}</Row>
            </dl>
            {closed && !paying && (
              <Button
                variant="outline"
                className="mt-3 min-h-11 gap-2"
                onClick={() => {
                  setEditError(null);
                  setPaying(true);
                }}
              >
                <Wallet className="size-4" aria-hidden="true" />
                עדכון תשלום, החזר ופיקדון
              </Button>
            )}
            {closed && paying && (
              <ClosedPayments
                e={e}
                busy={update.isPending}
                error={editError}
                onCancel={() => setPaying(false)}
                onSave={(data) => {
                  setEditError(null);
                  update.mutate({ revision: e.revision, data });
                }}
              />
            )}
          </SectionCard>

          <SectionCard title="פיקדון / ערבות לנזקים">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Row k="סכום">{formatMoney(e.deposit_amount)}</Row>
              <Row k="מצב">{DEPOSIT_STATUS_LABEL[e.deposit_status]}</Row>
              <Row k="איחור בפינוי">{formatMoney(e.late_fee_per_hour)} לכל שעה</Row>
            </dl>
          </SectionCard>

          {e.lodging.length > 0 && (
            <SectionCard
              title="אורחים בצימרים בזמן האירוע"
              description="הם חולקים את הבריכה והחצר — ההזמנות שלהם לא משתנות"
              className="md:col-span-2"
            >
              <ul
                className="flex list-disc flex-col gap-1 ps-5 text-sm"
                data-testid="event-lodging-list"
              >
                {e.lodging.map((l) => (
                  <li key={l.booking_id}>{lodgingText(l)}</li>
                ))}
              </ul>
              {e.lodging_ack && (
                <p className="mt-2 text-xs text-muted-foreground">
                  האירוע אושר בידיעה שיש אורחים בצימרים.
                </p>
              )}
            </SectionCard>
          )}

          {e.internal_notes && (
            <SectionCard title="הערות פנימיות" className="md:col-span-2">
              <p className="whitespace-pre-wrap text-sm">{e.internal_notes}</p>
            </SectionCard>
          )}

          <EventContractsCard event={e} />

          <SectionCard title="היסטוריה" className="md:col-span-2">
            <ol className="flex flex-col gap-2 text-sm" data-testid="event-log">
              {e.log.map((l) => (
                <li key={l.id} className="flex flex-wrap gap-x-3">
                  <span className="text-muted-foreground tabular-nums">{formatDateTime(l.at)}</span>
                  <span>{logText(l)}</span>
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      )}

      <AlertDialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{action?.title}</AlertDialogTitle>
            <AlertDialogDescription>{action?.text}</AlertDialogDescription>
          </AlertDialogHeader>
          {needsAck && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-medium">באותו זמן יש אורחים בצימרים במתחם:</p>
              <ul className="mt-1 list-disc ps-5">
                {e.lodging.map((l) => (
                  <li key={l.booking_id}>{lodgingText(l)}</li>
                ))}
              </ul>
              <label className="mt-2 flex min-h-11 items-center gap-2 font-medium">
                <Checkbox
                  checked={ack}
                  onCheckedChange={(v) => setAck(v === true)}
                  aria-label="ידוע לי שיש אורחים בצימרים — לאשר בכל זאת"
                />
                ידוע לי שיש אורחים בצימרים — לאשר בכל זאת
              </label>
            </div>
          )}
          {action?.status === "cancelled" && <CancelTerms e={e} />}
          {action?.reason && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="ev-reason">סיבה (לא חובה)</Label>
              <Textarea
                id="ev-reason"
                value={reason}
                onChange={(x) => setReason(x.target.value)}
                maxLength={300}
                rows={2}
              />
            </div>
          )}
          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">חזרה</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={setStatus.isPending || (needsAck && !ack)}
              onClick={(x) => {
                x.preventDefault();
                if (!action) return;
                setActionError(null);
                setStatus.mutate({
                  revision: e.revision,
                  status: action.status,
                  reason: action.reason ? reason.trim() || null : null,
                  ack,
                });
              }}
            >
              {setStatus.isPending ? "רגע…" : "אישור"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Actions({
  e,
  onEdit,
  onAction,
}: {
  e: EventDetail;
  onEdit: () => void;
  onAction: (a: NonNullable<Action>) => void;
}) {
  const btn = "min-h-11 gap-2";
  return (
    <>
      {e.stored_status === "pending" && (
        <Button
          className={btn}
          onClick={() =>
            onAction({
              status: "confirmed",
              title: `לאשר את אירוע #${e.number}?`,
              text: "המסד בודק שוב שאין אירוע אחר באותו זמן במתחם.",
              reason: false,
            })
          }
        >
          <CheckCircle2 className="size-4" aria-hidden="true" />
          אישור האירוע
        </Button>
      )}
      {e.status === "past" && (
        <Button
          className={btn}
          onClick={() =>
            onAction({
              status: "completed",
              title: "לסמן שהאירוע הסתיים?",
              text: 'האירוע יעבור ל"הסתיים".',
              reason: false,
            })
          }
        >
          <CalendarClock className="size-4" aria-hidden="true" />
          סימון "הסתיים"
        </Button>
      )}
      {(e.stored_status === "pending" || e.stored_status === "confirmed") && (
        <>
          <Button variant="outline" className={btn} onClick={onEdit}>
            עריכה
          </Button>
          <Button
            variant="outline"
            className={btn}
            onClick={() =>
              onAction({
                status: "cancelled",
                title: `לבטל את אירוע #${e.number}?`,
                text: "הזמן במתחם מתפנה. אפשר לפתוח מחדש אחר כך, אם הזמן עדיין פנוי.",
                reason: true,
              })
            }
          >
            <Ban className="size-4" aria-hidden="true" />
            ביטול
          </Button>
        </>
      )}
      {e.stored_status === "confirmed" && e.status !== "past" && (
        <Button
          variant="ghost"
          className={btn}
          onClick={() =>
            onAction({
              status: "pending",
              title: "להחזיר לממתין לאישור?",
              text: "האירוע יחזור לממתין.",
              reason: false,
            })
          }
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          החזרה לממתין
        </Button>
      )}
      {e.stored_status === "cancelled" && (
        <Button
          variant="outline"
          className={btn}
          onClick={() =>
            onAction({
              status: "pending",
              title: "לפתוח מחדש את האירוע?",
              text: "רק אם הזמן במתחם עדיין פנוי. האירוע יחזור לממתין לאישור.",
              reason: false,
            })
          }
        >
          <Users className="size-4" aria-hidden="true" />
          פתיחה מחדש
        </Button>
      )}
    </>
  );
}

/** כמה ימים לפני האירוע (היום — בשעון ישראל) */
const daysBefore = (date: string) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
};

/** בביטול: תנאי הביטול שבחוזה, כמה ימים לפני האירוע ומה כבר שולם — כדי לרשום את ההחזר אחר כך */
function CancelTerms({ e }: { e: EventDetail }) {
  const days = daysBefore(e.event_date);
  const free = e.terms.free_cancellation_days;
  return (
    <div
      className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950"
      data-testid="event-cancel-terms"
    >
      <p className="font-medium">תנאי הביטול בחוזה (סעיף 3)</p>
      <p>
        ביטול עד {free} ימים לפני האירוע — החזר כספי מלא; ביטול מאוחר יותר — דמי ביטול לפי החוזה.
      </p>
      <p className="mt-1">
        היום: {days >= 0 ? `${days} ימים לפני האירוע` : "אחרי מועד האירוע"} ·{" "}
        {days >= free ? "בתוך תקופת הביטול בלי חיוב" : "אחרי תקופת הביטול בלי חיוב"}. שולם עד עכשיו:{" "}
        {formatMoney(e.amount_paid)}.
      </p>
      <p className="mt-1 text-xs">
        ההחזר עצמו נעשה מחוץ למערכת. אחרי הביטול רושמים כאן כמה הוחזר ללקוח ("עדכון תשלום, החזר
        ופיקדון").
      </p>
    </div>
  );
}

/** אחרי ביטול / סיום: רק הכסף — כמה שולם, כמה הוחזר ללקוח, ומצב הפיקדון (המסד מסרב לכל שינוי אחר) */
function ClosedPayments({
  e,
  busy,
  error,
  onSave,
  onCancel,
}: {
  e: EventDetail;
  busy: boolean;
  error: string | null;
  onSave: (data: EventInput) => void;
  onCancel: () => void;
}) {
  const [paid, setPaid] = useState(e.amount_paid ? String(e.amount_paid) : "");
  const [refund, setRefund] = useState(e.refund_amount ? String(e.refund_amount) : "");
  const [deposit, setDeposit] = useState<DepositStatus>(e.deposit_status);
  const n = (s: string) => (s.trim() === "" ? 0 : Number(s));
  const tooMuch = n(refund) > n(paid);
  return (
    <form
      className="mt-3 flex flex-col gap-3 border-t pt-3"
      data-testid="event-closed-payments"
      onSubmit={(x) => {
        x.preventDefault();
        if (tooMuch) return;
        onSave({ amount_paid: n(paid), refund_amount: n(refund), deposit_status: deposit });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="cp-paid">שולם (₪)</Label>
          <Input
            id="cp-paid"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={paid}
            onChange={(x) => setPaid(x.target.value)}
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cp-refund">הוחזר ללקוח (₪)</Label>
          <Input
            id="cp-refund"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={refund}
            onChange={(x) => setRefund(x.target.value)}
            className="min-h-11"
            aria-invalid={tooMuch}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cp-deposit">מצב הפיקדון</Label>
          <select
            id="cp-deposit"
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={deposit}
            onChange={(x) => setDeposit(x.target.value as DepositStatus)}
          >
            {(Object.keys(DEPOSIT_STATUS_LABEL) as DepositStatus[]).map((k) => (
              <option key={k} value={k}>
                {DEPOSIT_STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {tooMuch && (
        <p role="alert" className="text-sm text-destructive">
          הסכום שהוחזר לא יכול להיות גדול מהסכום ששולם
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={busy || tooMuch}>
          {busy ? "שומרים…" : "שמירת התשלום"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0 font-medium">{children}</dd>
    </>
  );
}
