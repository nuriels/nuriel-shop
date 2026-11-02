// "תמיכה לעסקי האירוח" בפאנל הפלטפורמה (שלב E4, #support): כל הפניות מכל העסקים — סינון לפי
// סטטוס / דחיפות / תאריכים / חיפוש, "ממתינות למענה" (הוותיקות קודם), ופנייה בחלונית צד: פרטי
// העסק, השרשור כולל הערות פנימיות, מענה לעסק (מייל לעסק) או הערה פנימית, סטטוס, סגירה ופתיחה
// מחדש. ההרשאה (מנהל הפלטפורמה) נבדקת במסד בכל קריאה. ?ticket=<id> (מהמייל) — פותח את הפנייה.
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Inbox, Loader2, LockKeyhole, MessageCircle, RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  cn,
  useIsMobile,
} from "@/platform/ui";
import {
  hospitalityAdminSupportFileUrl,
  hospitalityAdminSupportReply,
  hospitalityAdminSupportSaveSettings,
  hospitalityAdminSupportSetStatus,
  hospitalityAdminSupportSettings,
  hospitalityAdminSupportTicket,
  hospitalityAdminSupportTickets,
} from "../api/platform-admin.functions";
import { dateTimeText } from "../management/bookings/model";
import { errorText } from "../management/catalog/refresh";
import { adminSupportKeys } from "../management/support/keys";
import {
  PLAN_SUPPORT,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  TOPIC_LABEL,
  agoText,
  isOverdue,
  waitingText,
} from "../management/support/model";
import { Composer, Thread } from "../management/support/parts";
import { StatusPill } from "../management/ui/kit";
import type {
  AdminSupportCounts,
  AdminSupportRow,
  AdminSupportTicket,
  SupportPriority,
  SupportStatus,
} from "../types/support";
import { ADMIN_SUPPORT_PAGE, SUPPORT_PRIORITIES, SUPPORT_STATUSES } from "../validation/support";
import { SUPPORT_TOKENS } from "./support-tokens";

type StatusFilter = SupportStatus | "open" | "";
interface Filter {
  status: StatusFilter;
  priority: SupportPriority | "";
  from: string;
  to: string;
  q: string;
  needsReply: boolean;
  page: number;
}
const START: Filter = {
  status: "open",
  priority: "",
  from: "",
  to: "",
  q: "",
  needsReply: false,
  page: 0,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function SupportInbox() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const linked =
    typeof search["ticket"] === "string" && UUID.test(search["ticket"]) ? search["ticket"] : null;
  const [filter, setFilter] = useState<Filter>(START);
  const [text, setText] = useState("");
  const [openId, setOpenId] = useState<string | null>(linked);
  useEffect(() => {
    if (linked) {
      setOpenId(linked);
      window.setTimeout(() => document.getElementById("support")?.scrollIntoView(), 100);
    }
  }, [linked]);
  const input = {
    status: filter.status || null,
    priority: filter.priority || null,
    from: filter.from || null,
    to: filter.to || null,
    q: filter.q || null,
    needsReply: filter.needsReply,
    page: filter.page,
  };
  const query = useQuery({
    queryKey: adminSupportKeys.list(input),
    queryFn: () => hospitalityAdminSupportTickets({ data: input }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    retry: false,
  });
  const set = (patch: Partial<Filter>) => setFilter((f) => ({ ...f, page: 0, ...patch }));
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / ADMIN_SUPPORT_PAGE)) : 1;

  return (
    <section
      id="support"
      aria-labelledby="support-title"
      style={SUPPORT_TOKENS}
      className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-[var(--hm-shadow-card)] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="support-title" className="text-xl font-semibold">
            תמיכה לעסקי האירוח
          </h2>
          <p className="text-sm text-muted-foreground">
            הפניות מכל העסקים. &quot;ממתינות למענה&quot; — מהוותיקה לחדשה; פרימיום — מענה באותו יום.
          </p>
        </div>
        <WhatsappSetting />
      </div>

      {data && <Counters counts={data.counts} filter={filter} onPick={set} />}

      <form
        role="search"
        aria-label="סינון פניות"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: text.trim() });
        }}
      >
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="sp-q">חיפוש</Label>
          <div className="flex gap-2">
            <Input
              id="sp-q"
              value={text}
              maxLength={80}
              onChange={(e) => setText(e.target.value)}
              placeholder="מספר פנייה, נושא, עסק או אימייל"
              className="min-h-10"
            />
            <Button type="submit" variant="outline" className="min-h-10 shrink-0 gap-1.5">
              <Search className="size-4" aria-hidden="true" />
              חיפוש
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sp-status">סטטוס</Label>
          <select
            id="sp-status"
            value={filter.status}
            onChange={(e) => set({ status: e.target.value as StatusFilter })}
            className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="open">פתוחות (חדשה / בטיפול / ממתינה ללקוח)</option>
            <option value="">הכול</option>
            {SUPPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sp-priority">דחיפות</Label>
          <select
            id="sp-priority"
            value={filter.priority}
            onChange={(e) => set({ priority: e.target.value as SupportPriority | "" })}
            className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">הכול</option>
            {SUPPORT_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sp-from">נפתחה מ-</Label>
            <Input
              id="sp-from"
              type="date"
              value={filter.from}
              max={filter.to || undefined}
              onChange={(e) => set({ from: e.target.value })}
              className="min-h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sp-to">עד</Label>
            <Input
              id="sp-to"
              type="date"
              value={filter.to}
              min={filter.from || undefined}
              onChange={(e) => set({ to: e.target.value })}
              className="min-h-10"
            />
          </div>
        </div>
      </form>

      {query.isError && !data ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 p-3 text-sm text-destructive"
        >
          {errorText(query.error)}
        </p>
      ) : !data ? (
        <p role="status" className="text-sm text-muted-foreground">
          טוען פניות…
        </p>
      ) : data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-[var(--hm-surface-2)] px-6 py-10 text-center">
          <Inbox className="size-8 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
          <p className="font-semibold">
            {filter.needsReply ? "אין פניות שממתינות למענה" : "אין פניות לפי הסינון הזה"}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" aria-busy={query.isFetching}>
          {data.items.map((t) => (
            <Row key={t.id} t={t} onOpen={() => setOpenId(t.id)} />
          ))}
        </ul>
      )}

      {data && data.total > ADMIN_SUPPORT_PAGE && (
        <nav aria-label="עמודים" className="flex items-center justify-between gap-2 text-sm">
          <Button
            variant="outline"
            className="min-h-10"
            disabled={filter.page === 0}
            onClick={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
          >
            הקודם
          </Button>
          <span>
            עמוד {filter.page + 1} מתוך {pages} · {data.total} פניות
          </span>
          <Button
            variant="outline"
            className="min-h-10"
            disabled={filter.page + 1 >= pages}
            onClick={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
          >
            הבא
          </Button>
        </nav>
      )}

      {openId && <TicketSheet id={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function Counters({
  counts,
  filter,
  onPick,
}: {
  counts: AdminSupportCounts;
  filter: Filter;
  onPick: (patch: Partial<Filter>) => void;
}) {
  const chips: {
    key: string;
    label: string;
    n: number;
    active: boolean;
    patch: Partial<Filter>;
    strong?: boolean;
  }[] = [
    {
      key: "needs",
      label: "ממתינות למענה",
      n: counts.needs_reply,
      active: filter.needsReply,
      patch: { needsReply: !filter.needsReply, status: filter.needsReply ? "open" : "" },
      strong: counts.needs_reply > 0,
    },
    {
      key: "new",
      label: "חדשות",
      n: counts.new,
      active: filter.status === "new" && !filter.needsReply,
      patch: { status: "new", needsReply: false },
    },
    {
      key: "progress",
      label: "בטיפול",
      n: counts.in_progress,
      active: filter.status === "in_progress" && !filter.needsReply,
      patch: { status: "in_progress", needsReply: false },
    },
    {
      key: "waiting",
      label: "ממתינות ללקוח",
      n: counts.waiting_customer,
      active: filter.status === "waiting_customer",
      patch: { status: "waiting_customer", needsReply: false },
    },
    {
      key: "resolved",
      label: "נפתרו",
      n: counts.resolved,
      active: filter.status === "resolved",
      patch: { status: "resolved", needsReply: false },
    },
    {
      key: "closed",
      label: "נסגרו",
      n: counts.closed,
      active: filter.status === "closed",
      patch: { status: "closed", needsReply: false },
    },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-pressed={c.active}
          onClick={() => onPick(c.patch)}
          className={cn(
            "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium",
            c.active
              ? "border-[var(--hm-lagoon-900)] bg-[var(--hm-lagoon-900)] text-white"
              : c.strong
                ? "border-[var(--hm-warning-dot)] bg-[var(--hm-warning-bg)] text-[var(--hm-warning)]"
                : "bg-background hover:border-[var(--hm-lagoon-500)]",
          )}
        >
          {c.label}
          <span
            className={cn(
              "rounded-full px-1.5 text-xs",
              c.active ? "bg-white/15" : "bg-[var(--hm-line-soft)]",
            )}
          >
            {c.n}
          </span>
        </button>
      ))}
      {counts.urgent_open > 0 && (
        <span className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-[var(--hm-danger)]">
          {counts.urgent_open} פתוחות בדחיפות גבוהה / דחופה
        </span>
      )}
    </div>
  );
}

function Row({ t, onOpen }: { t: AdminSupportRow; onOpen: () => void }) {
  const waiting = waitingText(t);
  const late = isOverdue(t, t.business.plan);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-xl border bg-background p-3 text-start hover:border-[var(--hm-lagoon-500)] sm:p-4",
          late && "border-[var(--hm-danger-dot)]",
        )}
      >
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusPill>
          <StatusPill tone={PRIORITY_TONE[t.priority]} dot={false}>
            {PRIORITY_LABEL[t.priority]}
          </StatusPill>
          {t.business.plan === "premium" && (
            <StatusPill tone="champagne" dot={false}>
              פרימיום
            </StatusPill>
          )}
          {t.unread > 0 && (
            <StatusPill tone="brand" dot={false}>
              {t.unread} חדשות
            </StatusPill>
          )}
          {waiting && (
            <span
              className={cn(
                "text-xs font-semibold",
                late ? "text-[var(--hm-danger)]" : "text-[var(--hm-warning)]",
              )}
            >
              ממתינה למענה {waiting}
            </span>
          )}
          <span className="ms-auto text-xs text-muted-foreground">
            {agoText(t.last_message_at)}
          </span>
        </span>
        <span className="font-semibold">
          <span className="text-muted-foreground" dir="ltr">
            #{t.number}
          </span>{" "}
          {t.subject}
        </span>
        <span className="text-xs text-muted-foreground">
          {t.business.name} · {TOPIC_LABEL[t.topic]}
          {t.opened_by_email ? ` · ${t.opened_by_email}` : ""}
        </span>
        {t.preview && (
          <span className="line-clamp-1 text-sm text-muted-foreground">{t.preview}</span>
        )}
      </button>
    </li>
  );
}

function TicketSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: adminSupportKeys.ticket(id),
    queryFn: () => hospitalityAdminSupportTicket({ data: { id } }),
    refetchInterval: 30_000,
    retry: false,
  });
  const loadedAt = query.dataUpdatedAt;
  useEffect(() => {
    // הצפייה סימנה כנקראה — הרשימה מתעדכנת
    if (loadedAt) void qc.invalidateQueries({ queryKey: [...adminSupportKeys.all, "list"] });
  }, [loadedAt, qc]);
  const t = query.data;
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "left"}
        className="max-h-[94dvh] w-full overflow-y-auto sm:max-w-2xl"
        style={SUPPORT_TOKENS}
        dir="rtl"
      >
        <SheetHeader className="ps-10 text-start sm:text-start">
          <SheetTitle>
            {t ? (
              <>
                <span dir="ltr" className="text-muted-foreground">
                  #{t.number}
                </span>{" "}
                {t.subject}
              </>
            ) : (
              "פנייה"
            )}
          </SheetTitle>
          <SheetDescription>
            {t
              ? `${t.business.name} · ${TOPIC_LABEL[t.topic]} · נפתחה ${dateTimeText(t.created_at)}`
              : "טוען…"}
          </SheetDescription>
        </SheetHeader>
        {query.isError ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {errorText(query.error)}
          </p>
        ) : !t ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            טוען את הפנייה…
          </p>
        ) : (
          <TicketBody t={t} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TicketBody({ t }: { t: AdminSupportTicket }) {
  const qc = useQueryClient();
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState<SupportStatus>("waiting_customer");
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: adminSupportKeys.all });
  const setStatus = async (status: SupportStatus) => {
    setBusy(true);
    try {
      await hospitalityAdminSupportSetStatus({ data: { id: t.id, status } });
      toast.success(`הסטטוס עודכן: ${STATUS_LABEL[status]}`);
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const b = t.business;
  const closed = t.status === "closed" || t.status === "resolved";
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusPill>
        <StatusPill tone={PRIORITY_TONE[t.priority]} dot={false}>
          דחיפות {PRIORITY_LABEL[t.priority]}
        </StatusPill>
        {t.first_response_at && (
          <span className="text-xs text-muted-foreground">
            מענה ראשון: {dateTimeText(t.first_response_at)}
          </span>
        )}
      </div>

      <section aria-label="פרטי העסק" className="rounded-xl border bg-[var(--hm-surface-2)] p-4">
        <p className="font-semibold">{b.name}</p>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <Detail label="כתובת">
            <span dir="ltr">{b.domain ?? b.slug}</span>
          </Detail>
          <Detail label="חבילה">
            {PLAN_SUPPORT[b.plan].title}
            {b.plan_code
              ? ` (${b.plan_code}${b.subscription_status ? ` · ${b.subscription_status}` : ""})`
              : ""}
          </Detail>
          <Detail label="פתח/ה את הפנייה">
            {t.opened_by_name ?? "—"}
            {t.opened_by_email && (
              <>
                {" · "}
                <a
                  href={`mailto:${t.opened_by_email}`}
                  dir="ltr"
                  className="text-[var(--hm-lagoon-500)] underline underline-offset-2"
                >
                  {t.opened_by_email}
                </a>
              </>
            )}
          </Detail>
          <Detail label="בעלים">
            {b.owner_email ? (
              <a
                href={`mailto:${b.owner_email}`}
                dir="ltr"
                className="text-[var(--hm-lagoon-500)] underline underline-offset-2"
              >
                {b.owner_email}
              </a>
            ) : (
              "—"
            )}
          </Detail>
          <Detail label="טלפון העסק">
            {b.contact_phone ? (
              <a
                href={`tel:${b.contact_phone}`}
                dir="ltr"
                className="text-[var(--hm-lagoon-500)] underline underline-offset-2"
              >
                {b.contact_phone}
              </a>
            ) : (
              "—"
            )}
          </Detail>
          <Detail label="יחידות · פניות">
            {b.units} יחידות · {b.tickets} פניות
          </Detail>
        </dl>
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sp-set-status">שינוי סטטוס</Label>
          <select
            id="sp-set-status"
            value={t.status}
            disabled={busy}
            onChange={(e) => void setStatus(e.target.value as SupportStatus)}
            className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {SUPPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {closed ? (
          <Button
            variant="outline"
            className="min-h-10 gap-1.5"
            disabled={busy}
            onClick={() => void setStatus("in_progress")}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            פתיחה מחדש
          </Button>
        ) : (
          <Button
            variant="outline"
            className="min-h-10"
            disabled={busy}
            onClick={() => void setStatus("closed")}
          >
            סגירת הפנייה
          </Button>
        )}
        {busy && <Loader2 className="size-4 animate-spin" aria-label="מעדכן" />}
      </div>

      <Thread
        messages={t.messages}
        side="platform"
        onOpenFile={(f) => hospitalityAdminSupportFileUrl({ data: { id: f.id } })}
      />

      <Composer
        label={internal ? "הערה פנימית (רק לצוות הפלטפורמה)" : "מענה לעסק"}
        placeholder={
          internal ? "מה בדקנו, למי להעביר, מה הלאה…" : "התשובה תוצג לעסק, והוא יקבל מייל"
        }
        submitLabel={internal ? "שמירת הערה" : "שליחת מענה"}
        tone={internal ? "internal" : "default"}
        onSend={async (body, files) => {
          const form = new FormData();
          form.set("ticketId", t.id);
          form.set("body", body);
          form.set("internal", internal ? "true" : "false");
          if (!internal) form.set("status", after);
          for (const f of files) form.append("files", f, f.name);
          const r = await hospitalityAdminSupportReply({ data: form });
          refresh();
          if (r.failedFiles.length)
            toast.warning(`נשמר, אבל חלק מהקבצים לא עלו: ${r.failedFiles.join(", ")}`);
          else toast.success(internal ? "ההערה נשמרה" : "המענה נשלח לעסק");
          return true;
        }}
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Switch id="sp-internal" checked={internal} onCheckedChange={setInternal} />
            <Label htmlFor="sp-internal" className="inline-flex items-center gap-1.5">
              <LockKeyhole className="size-4 text-[var(--hm-champagne-700)]" aria-hidden="true" />
              הערה פנימית — העסק לא יראה
            </Label>
          </div>
          {!internal && (
            <div className="flex items-center gap-2">
              <Label htmlFor="sp-after" className="text-sm whitespace-nowrap">
                אחרי השליחה:
              </Label>
              <select
                id="sp-after"
                value={after}
                onChange={(e) => setAfter(e.target.value as SupportStatus)}
                className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {(["waiting_customer", "in_progress", "resolved", "closed"] as const).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Composer>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

/** WhatsApp לתמיכה בחבילת פרימיום (מוצג לעסקים בפרימיום בלבד) */
function WhatsappSetting() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: adminSupportKeys.settings,
    queryFn: () => hospitalityAdminSupportSettings(),
    retry: false,
  });
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = value ?? query.data?.whatsapp ?? "";
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await hospitalityAdminSupportSaveSettings({ data: { whatsapp: current } });
          toast.success("מספר ה-WhatsApp לתמיכה נשמר");
          setValue(null);
          void qc.invalidateQueries({ queryKey: adminSupportKeys.settings });
        } catch (err) {
          toast.error(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sp-wa" className="inline-flex items-center gap-1.5">
          <MessageCircle className="size-4 text-[var(--hm-success)]" aria-hidden="true" />
          WhatsApp לתמיכה (פרימיום)
        </Label>
        <Input
          id="sp-wa"
          dir="ltr"
          inputMode="tel"
          value={current}
          onChange={(e) => setValue(e.target.value)}
          placeholder="+972501234567"
          className="min-h-10 w-48 text-start"
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        className="min-h-10"
        disabled={busy || value === null}
      >
        שמירה
      </Button>
    </form>
  );
}
