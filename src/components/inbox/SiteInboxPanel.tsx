import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Inbox,
  Loader2,
  Mail,
  MailCheck,
  MessageSquare,
  Paperclip,
  Phone,
  RefreshCw,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getContactAttachmentLink } from "@/lib/site-forms.functions";
import {
  CANCELLATION_STATUSES,
  CANCELLATION_STATUS_LABELS,
  CONTACT_STATUS_LABELS,
  formatBytes,
  referenceCode,
  refundDeadline,
  type CancellationRequest,
  type CancellationStatus,
  type ContactMessage,
} from "@/lib/site-forms";
import {
  loadCancellationRequests,
  loadContactMessages,
  loadInboxCounts,
  updateCancellationRequest,
  updateContactMessage,
  type InboxCounts,
  type InboxFilter,
} from "@/lib/site-inbox";
import { cn } from "@/lib/utils";

export type InboxView = "contact" | "cancellations";

/** אירוע לרענון המונה בתפריט הניהול אחרי טיפול בפנייה */
export const SITE_INBOX_CHANGED = "site-inbox-changed";
const announceChange = () => window.dispatchEvent(new Event(SITE_INBOX_CHANGED));

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
const dateOnly = (date: Date) => date.toLocaleDateString("he-IL", { dateStyle: "short" });

/**
 * "פניות מהאתר" בפאנל הניהול (חלק 16א): פניות מטופס "צור קשר" והודעות
 * ביטול עסקה. הודעות הביטול הן תיעוד רגולטורי — לא נמחקות; מעדכנים סטטוס
 * והערה פנימית. ליד כל ביטול — המועד האחרון להחזר לפי החוק (14 ימים).
 */
export function SiteInboxPanel({
  view,
  onViewChange,
  onOpenOrder,
}: {
  view: InboxView;
  onViewChange: (next: InboxView) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const [filter, setFilter] = useState<InboxFilter>("open");
  const [counts, setCounts] = useState<InboxCounts>({ contact: 0, cancellations: 0 });
  const [contacts, setContacts] = useState<ContactMessage[] | null>(null);
  const [cancellations, setCancellations] = useState<CancellationRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextCounts, list] = await Promise.all([
        loadInboxCounts(),
        view === "contact" ? loadContactMessages(filter) : loadCancellationRequests(filter),
      ]);
      setCounts(nextCounts);
      if (view === "contact") setContacts(list as ContactMessage[]);
      else setCancellations(list as CancellationRequest[]);
      setError(null);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "טעינת הפניות נכשלה");
    } finally {
      setLoading(false);
    }
  }, [view, filter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const afterUpdate = async () => {
    announceChange();
    await reload();
  };

  const list = view === "contact" ? contacts : cancellations;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Inbox className="size-5 text-primary" aria-hidden="true" />
            פניות מהאתר וביטולי עסקה
          </h2>
          <p className="text-sm text-muted-foreground">
            פניות מטופס "צור קשר" והודעות ביטול עסקה שהלקוחות שלחו מהאתר. על כל פנייה חדשה נשלח גם
            מייל למנהלים.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          רענון
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="סוג הפניות" className="flex gap-1 rounded-lg bg-muted p-1">
          <ViewTab
            active={view === "contact"}
            onClick={() => onViewChange("contact")}
            icon={<MessageSquare className="size-4" />}
            label="צור קשר"
            count={counts.contact}
          />
          <ViewTab
            active={view === "cancellations"}
            onClick={() => onViewChange("cancellations")}
            icon={<RotateCcw className="size-4" />}
            label="ביטולי עסקה"
            count={counts.cancellations}
          />
        </div>
        <div className="flex gap-1 text-sm" role="group" aria-label="סינון">
          <Button
            size="sm"
            variant={filter === "open" ? "default" : "ghost"}
            onClick={() => setFilter("open")}
          >
            {view === "contact" ? "חדשות" : "פתוחות"}
          </Button>
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "ghost"}
            onClick={() => setFilter("all")}
          >
            הכול
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {list === null ? (
        <p className="text-sm text-muted-foreground">טוען...</p>
      ) : list.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-8 text-emerald-600" aria-hidden="true" />
            {filter === "open"
              ? view === "contact"
                ? "אין פניות חדשות"
                : "אין הודעות ביטול פתוחות"
              : "עוד לא התקבלו פניות"}
          </CardContent>
        </Card>
      ) : view === "contact" ? (
        <ul className="space-y-3">
          {(list as ContactMessage[]).map((message) => (
            <li key={message.id}>
              <ContactCard message={message} onOpenOrder={onOpenOrder} onChanged={afterUpdate} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-3">
          {(list as CancellationRequest[]).map((request) => (
            <li key={request.id}>
              <CancellationCard
                request={request}
                onOpenOrder={onOpenOrder}
                onChanged={afterUpdate}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ViewTab({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
      {count > 0 && (
        <span className="numeric rounded-full bg-accent px-1.5 text-xs font-bold text-accent-foreground">
          {count}
        </span>
      )}
    </button>
  );
}

function StatusBadge({
  tone,
  children,
}: {
  tone: "new" | "work" | "done" | "bad";
  children: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-bold",
        tone === "new" && "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
        tone === "work" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
        tone === "done" &&
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
        tone === "bad" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function ContactLinks({
  phone,
  email,
  subject,
}: {
  phone: string;
  email: string;
  subject: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <a
        href={`tel:${phone}`}
        dir="ltr"
        className="flex items-center gap-1.5 text-primary hover:underline"
      >
        <Phone className="size-3.5" aria-hidden="true" />
        {phone}
      </a>
      <a
        href={`mailto:${email}?subject=${encodeURIComponent(subject)}`}
        dir="ltr"
        className="flex items-center gap-1.5 text-primary hover:underline"
      >
        <Mail className="size-3.5" aria-hidden="true" />
        {email}
      </a>
    </div>
  );
}

function OrderRef({
  orderNumber,
  orderId,
  onOpenOrder,
}: {
  orderNumber: string;
  orderId: string | null;
  onOpenOrder: (orderId: string) => void;
}) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">הזמנה:</span>
      {orderId ? (
        <button
          type="button"
          onClick={() => onOpenOrder(orderId)}
          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          dir="ltr"
        >
          {orderNumber}
          <ExternalLink className="size-3" aria-hidden="true" />
        </button>
      ) : (
        <>
          <span className="font-semibold" dir="ltr">
            {orderNumber}
          </span>
          <span className="text-xs text-amber-700 dark:text-amber-300">
            (לא נמצאה הזמנה עם המספר הזה)
          </span>
        </>
      )}
    </p>
  );
}

function NoteEditor({
  id,
  initial,
  onSave,
}: {
  id: string;
  initial: string | null;
  onSave: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const changed = note.trim() !== (initial ?? "").trim();
  return (
    <div className="space-y-1.5">
      <label htmlFor={`note-${id}`} className="text-xs font-medium text-muted-foreground">
        הערה פנימית (רק המנהלים רואים)
      </label>
      <Textarea
        id={`note-${id}`}
        rows={2}
        maxLength={2000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="למשל: חזרתי ללקוח בטלפון, זיכוי בוצע ב-…"
      />
      {changed && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(note.trim());
              toast.success("ההערה נשמרה");
            } catch (thrown) {
              toast.error(thrown instanceof Error ? thrown.message : "השמירה נכשלה");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          שמירת ההערה
        </Button>
      )}
    </div>
  );
}

function ContactCard({
  message,
  onOpenOrder,
  onChanged,
}: {
  message: ContactMessage;
  onOpenOrder: (orderId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const attachmentLink = useServerFn(getContactAttachmentLink);
  const [busy, setBusy] = useState(false);
  const isNew = message.status === "new";

  const setStatus = async (status: "new" | "handled") => {
    setBusy(true);
    try {
      await updateContactMessage(message.id, { status });
      toast.success(status === "handled" ? "הפנייה סומנה כטופלה" : "הפנייה הוחזרה לחדשות");
      await onChanged();
    } catch (thrown) {
      toast.error(thrown instanceof Error ? thrown.message : "העדכון נכשל");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    try {
      const { url } = await attachmentLink({ data: { id: message.id } });
      window.location.assign(url);
    } catch (thrown) {
      toast.error(thrown instanceof Error ? thrown.message : "ההורדה נכשלה");
    }
  };

  return (
    <Card className={cn("shadow-card", isNew && "border-sky-300 dark:border-sky-800")}>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              {message.full_name}
              <StatusBadge tone={isNew ? "new" : "done"}>
                {CONTACT_STATUS_LABELS[message.status]}
              </StatusBadge>
            </p>
            <p className="text-xs text-muted-foreground">
              {dateTime(message.created_at)} · אסמכתה{" "}
              <span dir="ltr">{referenceCode(message.id)}</span>
            </p>
          </div>
          <Button
            size="sm"
            variant={isNew ? "default" : "outline"}
            disabled={busy}
            onClick={() => void setStatus(isNew ? "handled" : "new")}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isNew ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Undo2 className="size-4" />
            )}
            {isNew ? "סימון כטופלה" : "החזרה לחדשות"}
          </Button>
        </div>

        <ContactLinks phone={message.phone} email={message.email} subject="תשובה לפנייתך" />
        {message.order_number && (
          <OrderRef
            orderNumber={message.order_number}
            orderId={message.order_id}
            onOpenOrder={onOpenOrder}
          />
        )}
        <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm leading-6">
          {message.message}
        </p>
        {message.attachment_path && (
          <Button size="sm" variant="outline" onClick={() => void download()}>
            <Paperclip className="size-4" />
            <span className="max-w-56 truncate">{message.attachment_name ?? "קובץ מצורף"}</span>
            {message.attachment_size !== null && (
              <span className="text-xs text-muted-foreground">
                ({formatBytes(message.attachment_size)})
              </span>
            )}
            <Download className="size-4" />
          </Button>
        )}
        <NoteEditor
          id={message.id}
          initial={message.admin_note}
          onSave={async (note) => {
            await updateContactMessage(message.id, { admin_note: note || null });
            await onChanged();
          }}
        />
      </CardContent>
    </Card>
  );
}

function CancellationCard({
  request,
  onOpenOrder,
  onChanged,
}: {
  request: CancellationRequest;
  onOpenOrder: (orderId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const open = request.status === "new" || request.status === "in_progress";
  const deadline = refundDeadline(request.created_at);
  const overdue = open && deadline.getTime() < Date.now();
  const tone =
    request.status === "new"
      ? "new"
      : request.status === "in_progress"
        ? "work"
        : request.status === "completed"
          ? "done"
          : "bad";

  const setStatus = async (status: CancellationStatus) => {
    setBusy(true);
    try {
      await updateCancellationRequest(request.id, { status });
      toast.success(`הסטטוס עודכן: ${CANCELLATION_STATUS_LABELS[status]}`);
      await onChanged();
    } catch (thrown) {
      toast.error(thrown instanceof Error ? thrown.message : "העדכון נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      className={cn(
        "shadow-card",
        request.status === "new" && "border-sky-300 dark:border-sky-800",
      )}
    >
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              {request.first_name} {request.last_name}
              <StatusBadge tone={tone}>{CANCELLATION_STATUS_LABELS[request.status]}</StatusBadge>
            </p>
            <p className="text-xs text-muted-foreground">
              התקבלה {dateTime(request.created_at)} · אסמכתה{" "}
              <span dir="ltr">{referenceCode(request.id)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            <Select
              value={request.status}
              onValueChange={(next) => void setStatus(next as CancellationStatus)}
              disabled={busy}
              dir="rtl"
            >
              <SelectTrigger className="h-9 w-48" aria-label="סטטוס הבקשה">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CANCELLATION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {CANCELLATION_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ContactLinks
          phone={request.phone}
          email={request.email}
          subject={`הודעת ביטול — הזמנה ${request.order_number}`}
        />
        <OrderRef
          orderNumber={request.order_number}
          orderId={request.order_id}
          onOpenOrder={onOpenOrder}
        />

        <div className="flex flex-wrap gap-2 text-xs">
          {request.order_id &&
            (request.order_contact_match ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                פרטי הלקוח תואמים להזמנה
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                האימייל והטלפון שונים מאלה שבהזמנה — כדאי לוודא מול הלקוח
              </span>
            ))}
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              overdue
                ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Clock className="size-3.5" aria-hidden="true" />
            {overdue ? "עבר המועד להחזר: " : "החזר כספי (אם מגיע) עד: "}
            {dateOnly(deadline)}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            <MailCheck className="size-3.5" aria-hidden="true" />
            {request.confirmation_sent_at ? "נשלח ללקוח אישור קבלה במייל" : "לא נשלח אישור במייל"}
          </span>
        </div>

        {request.message ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">סיבת הביטול</p>
            <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm leading-6">
              {request.message}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">הלקוח לא פירט סיבה (אין חובה לנמק).</p>
        )}
        <NoteEditor
          id={request.id}
          initial={request.admin_note}
          onSave={async (note) => {
            await updateCancellationRequest(request.id, { admin_note: note || null });
            await onChanged();
          }}
        />
      </CardContent>
    </Card>
  );
}
