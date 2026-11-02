// מסך "תמיכה" (/manage/support) — שלב E4: הפניות של העסק לצוות Nuriel Hospitality.
// רשימה (פתוחות / נפתרו / הכול) עם סטטוס, תשובה חדשה וזמן; פנייה חדשה (?new=1 פותח את הטופס);
// זמן המענה לפי החבילה, ו-WhatsApp בפרימיום. ההרשאה והבידוד בין עסקים — במסד.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Clock3, LifeBuoy, MessageCircle, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, cn } from "@/platform/ui";
import { hospitalitySupportList, hospitalitySupportOpen } from "../../api/support.functions";
import type { SupportList, SupportTicketRow, SupportTopic } from "../../types/support";
import { errorText } from "../catalog/refresh";
import { useManagement } from "../shell/management-context";
import { EmptyState, ErrorState, NoAccess, PageHeader, SkeletonBlock, StatusPill } from "../ui/kit";
import { supportKeys } from "./keys";
import {
  PLAN_SUPPORT,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  SUPPORT_TABS,
  TOPIC_LABEL,
  agoText,
  inTab,
  parseSupportSearch,
  whatsappUrl,
  type SupportTab,
} from "./model";
import { NewTicketSheet } from "./NewTicketSheet";

export function SupportPage() {
  const ctx = useManagement();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = parseSupportSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const [tab, setTab] = useState<SupportTab>("open");
  const [creating, setCreating] = useState(false);
  // תחום ונושא שהגיעו בקישור (למשל "מעבר לחבילה בתשלום" מכרטיס החבילה) — ממולאים בטופס
  const [preset, setPreset] = useState<{
    topic?: SupportTopic | undefined;
    subject?: string | undefined;
  }>({});
  const allowed = ctx.permissions["settings"] === true;
  const query = useQuery({
    queryKey: supportKeys.list,
    queryFn: () => hospitalitySupportList(),
    enabled: allowed,
    refetchInterval: 60_000,
  });
  // ?new=1 (מהחיפוש המהיר / "+ חדש") — פותח את הטופס פעם אחת
  useEffect(() => {
    if (search.new) {
      setPreset({ topic: search.topic, subject: search.subject });
      setCreating(true);
      void navigate({ to: "/manage/support", search: {}, replace: true });
    }
  }, [search.new, search.topic, search.subject, navigate]);

  if (!allowed) return <NoAccess text="מסך התמיכה פתוח לבעלי העסק ולמנהלים." />;

  const data = query.data;
  const items = data ? data.items.filter((t) => inTab(t, tab)) : [];
  const counts = data
    ? {
        open: data.counts.open + data.counts.waiting_customer,
        done: data.counts.done,
        all: data.counts.all,
      }
    : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="תמיכה"
        description="שאלה, תקלה או בקשה? פותחים פנייה, וצוות Nuriel Hospitality עונה כאן — ומעדכן אתכם במייל."
        actions={
          <Button className="min-h-11 gap-2 rounded-xl" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            פנייה חדשה
          </Button>
        }
      />

      {data ? <PlanCard data={data} /> : <SkeletonBlock className="h-24" />}

      {data && data.counts.waiting_customer > 0 && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-2xl border border-[var(--hm-warning-bg)] bg-[var(--hm-warning-bg)] px-4 py-3 text-sm font-medium text-[var(--hm-warning)]"
        >
          <MessageCircle className="size-5 shrink-0" aria-hidden="true" />
          {data.counts.waiting_customer === 1
            ? "פנייה אחת ממתינה לתשובה שלכם"
            : `${data.counts.waiting_customer} פניות ממתינות לתשובה שלכם`}
        </p>
      )}

      <section aria-labelledby="support-list-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="support-list-title" className="text-lg font-bold">
            הפניות שלכם
          </h2>
          <div role="tablist" aria-label="סינון פניות" className="flex gap-1 overflow-x-auto">
            {SUPPORT_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium whitespace-nowrap",
                  tab === t.key
                    ? "bg-[var(--hm-lagoon-900)] text-white"
                    : "text-muted-foreground hover:bg-[var(--hm-lagoon-100)]",
                )}
              >
                {t.label}
                {counts && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs",
                      tab === t.key ? "bg-white/15" : "bg-[var(--hm-line-soft)]",
                    )}
                  >
                    {counts[t.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {query.isError && !data ? (
          <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
        ) : !data ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <span className="sr-only">טוען פניות…</span>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={LifeBuoy}
            title={
              data.counts.all === 0
                ? "עוד לא פתחתם פניות"
                : tab === "open"
                  ? "אין פניות פתוחות"
                  : "אין פניות כאן"
            }
            text={
              data.counts.all === 0
                ? "כל שאלה על ההזמנות, האתר, היומן או החשבון — אנחנו כאן. אפשר לצרף צילום מסך."
                : "כל הפניות טופלו. צריכים עוד משהו? פותחים פנייה חדשה."
            }
            action={
              <Button className="min-h-11 gap-2 rounded-xl" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden="true" />
                פנייה חדשה
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((t) => (
              <TicketRow key={t.id} t={t} />
            ))}
          </ul>
        )}
      </section>

      <NewTicketSheet
        open={creating}
        preset={preset}
        onClose={() => {
          setCreating(false);
          setPreset({});
        }}
        onSubmit={async (form) => {
          const r = await hospitalitySupportOpen({ data: form });
          void qc.invalidateQueries({ queryKey: supportKeys.all });
          if (r.failedFiles.length)
            toast.warning(`הפנייה נשלחה, אבל חלק מהקבצים לא עלו: ${r.failedFiles.join(", ")}`);
          else toast.success("הפנייה נשלחה — נחזור אליכם בהקדם");
          setCreating(false);
          void navigate({ to: "/manage/support/$ticketId", params: { ticketId: r.ticketId } });
        }}
        onError={(e) => toast.error(errorText(e))}
      />
    </div>
  );
}

function PlanCard({ data }: { data: SupportList }) {
  const plan = PLAN_SUPPORT[data.plan];
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-5 shadow-[var(--hm-shadow-card)]">
      <span
        aria-hidden="true"
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--hm-lagoon-900)] text-[var(--hm-champagne-500)]"
      >
        <Clock3 className="size-6" strokeWidth={1.7} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">{plan.title}</p>
        <p className="text-sm text-muted-foreground">
          {plan.text}. תקלה שמשביתה את האתר או את ההזמנות? סמנו &quot;דחופה&quot; בפנייה.
        </p>
      </div>
      {data.whatsapp ? (
        <a
          href={whatsappUrl(data.whatsapp, "שלום, אני צריך/ה עזרה עם האתר")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--hm-success-bg)] bg-[var(--hm-success-bg)] px-4 text-sm font-semibold text-[var(--hm-success)]"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          WhatsApp לתמיכה
          <span className="sr-only">(נפתח בחלון חדש)</span>
        </a>
      ) : data.plan !== "premium" ? (
        <Link
          to="/manage"
          hash="plan"
          className="text-sm font-semibold text-[var(--hm-lagoon-500)] hover:underline"
        >
          תמיכה מועדפת ב-WhatsApp — בחבילת פרימיום
        </Link>
      ) : null}
    </div>
  );
}

function TicketRow({ t }: { t: SupportTicketRow }) {
  const answered = t.unread > 0;
  return (
    <li>
      <Link
        to="/manage/support/$ticketId"
        params={{ ticketId: t.id }}
        className={cn(
          "flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-[var(--hm-shadow-card)] transition-colors hover:border-[var(--hm-lagoon-500)] sm:p-5",
          answered && "border-[var(--hm-champagne-500)]",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusPill>
          {(t.priority === "high" || t.priority === "urgent") && (
            <StatusPill tone={PRIORITY_TONE[t.priority]} dot={false}>
              דחיפות {PRIORITY_LABEL[t.priority]}
            </StatusPill>
          )}
          {answered && (
            <StatusPill tone="champagne" dot={false}>
              תשובה חדשה
            </StatusPill>
          )}
          <span className="ms-auto text-xs text-muted-foreground">
            {agoText(t.last_message_at)}
          </span>
        </div>
        <p className="font-semibold">
          <span className="text-muted-foreground" dir="ltr">
            #{t.number}
          </span>{" "}
          {t.subject}
        </p>
        <p className="text-xs text-muted-foreground">
          {TOPIC_LABEL[t.topic]}
          {t.opened_by_name ? ` · נפתחה ע״י ${t.opened_by_name}` : ""}
        </p>
        {t.preview && <p className="line-clamp-2 text-sm text-muted-foreground">{t.preview}</p>}
      </Link>
    </li>
  );
}
