import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Crown, Headset, Inbox, Loader2, RefreshCw } from "lucide-react";
import {
  platformListTickets,
  platformSupportCounts,
  type PlatformTicketFilter,
} from "@/lib/support.functions";
import {
  PLATFORM_TICKET_STATUS_LABELS,
  SUPPORT_HOURS_TEXT,
  chatTime,
  isVip,
  type SupportTicket,
} from "@/lib/support";
import { PLAN_LABELS } from "@/lib/subscription";
import { PLATFORM_SITE_NAME } from "@/lib/platform.functions";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { MiniChat } from "@/components/support/MiniChat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Search = { ticket?: string | undefined; filter?: PlatformTicketFilter | undefined };

const FILTERS: { value: PlatformTicketFilter; label: string }[] = [
  { value: "open", label: "ממתינות לנו" },
  { value: "answered", label: "ממתינות ללקוח" },
  { value: "closed", label: "סגורות" },
  { value: "all", label: "הכל" },
];

/**
 * /platform/support — תיבת התמיכה של מנהל הפלטפורמה (חלק 13): כל הפניות
 * מכל החנויות (VIP — פרימיום / ניסיון — קודם), ולחיצה פותחת את המיני-צ'אט
 * שבו עונים לבעל החנות. תשובה שולחת לו התראה במייל.
 * זמין רק בדומיין של פאנל הפלטפורמה (כמו /platform).
 */
export const Route = createFileRoute("/platform_/support")({
  ssr: false,
  head: () => ({
    meta: [{ title: `תמיכה · ${PLATFORM_SITE_NAME}` }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (search: Record<string, unknown>): Search => {
    const result: Search = {};
    const ticket = search["ticket"];
    const filter = search["filter"];
    if (typeof ticket === "string" && /^[0-9a-f-]{36}$/i.test(ticket)) result.ticket = ticket;
    if (filter === "open" || filter === "answered" || filter === "closed" || filter === "all") {
      result.filter = filter;
    }
    return result;
  },
  component: PlatformSupportPage,
});

function PlatformSupportPage() {
  return <PlatformShell active="support">{() => <SupportInbox />}</PlatformShell>;
}

function SupportInbox() {
  const { ticket: ticketId, filter = "open" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const loadTickets = useServerFn(platformListTickets);
  const loadCounts = useServerFn(platformSupportCounts);
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, totals] = await Promise.all([loadTickets({ data: { filter } }), loadCounts()]);
      setTickets(list);
      setCounts({
        open: totals.open,
        answered: totals.answered,
        closed: totals.closed,
        all: totals.open + totals.answered + totals.closed,
      });
      setError(null);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "טעינת הפניות נכשלה");
    } finally {
      setLoading(false);
    }
  }, [filter, loadTickets, loadCounts]);

  useEffect(() => {
    setTickets(null);
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const select = (next: string | null) =>
    void navigate({
      search: (prev) => ({ ...prev, ticket: next ?? undefined }),
      resetScroll: false,
    });

  const updateTicket = useCallback((ticket: SupportTicket) => {
    setTickets((list) =>
      list ? list.map((t) => (t.id === ticket.id ? { ...ticket, unread: 0 } : t)) : list,
    );
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <Headset className="size-6 text-primary" aria-hidden="true" />
            תמיכה בחנויות
          </h2>
          <p className="text-sm text-muted-foreground">{SUPPORT_HOURS_TEXT}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          רענון
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="סינון פניות">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => void navigate({ search: (prev) => ({ ...prev, filter: option.value }) })}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
              filter === option.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-secondary",
            )}
          >
            {option.label}
            {counts[option.value] !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs font-bold",
                  filter === option.value
                    ? "bg-primary-foreground/20"
                    : option.value === "open" && (counts["open"] ?? 0) > 0
                      ? "bg-amber-500 text-white"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {counts[option.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[20rem_minmax(0,1fr)] md:items-start">
        <aside className={cn("min-w-0 space-y-1.5", ticketId && "hidden md:block")}>
          {tickets === null ? (
            [0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
            ))
          ) : tickets.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              <Inbox className="mx-auto mb-2 size-8 text-muted-foreground/60" aria-hidden="true" />
              {filter === "open" ? "אין פניות שממתינות לנו 🎉" : "אין פניות להצגה"}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {tickets.map((ticket) => {
                const active = ticket.id === ticketId;
                return (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      onClick={() => select(ticket.id)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2.5 text-right transition",
                        active
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-card hover:border-primary/40",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
                          {ticket.storeName}
                        </span>
                        {isVip(ticket.plan) && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800"
                            title={PLAN_LABELS[ticket.plan]}
                          >
                            <Crown className="size-3" aria-hidden="true" />
                            VIP
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {chatTime(ticket.lastMessageAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {ticket.subject}
                        </span>
                        {ticket.unread > 0 && (
                          <span className="rounded-full bg-emerald-600 px-1.5 text-xs font-bold text-white">
                            {ticket.unread}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {ticket.lastSenderType === "admin" ? "את/ה: " : ""}
                        {ticket.preview}
                      </span>
                      <span
                        className={cn(
                          "mt-1 inline-block text-[11px] font-medium",
                          ticket.status === "open"
                            ? "text-amber-700"
                            : ticket.status === "answered"
                              ? "text-emerald-700"
                              : "text-muted-foreground",
                        )}
                      >
                        {PLATFORM_TICKET_STATUS_LABELS[ticket.status]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className={cn("min-w-0", !ticketId && "hidden md:block")}>
          {ticketId ? (
            <div className="h-[min(75vh,44rem)]">
              <MiniChat
                ticketId={ticketId}
                perspective="admin"
                onTicketChange={updateTicket}
                onBack={() => select(null)}
              />
            </div>
          ) : (
            <div className="flex h-[min(75vh,44rem)] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-card p-8 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-secondary">
                <Headset className="size-8 text-primary" aria-hidden="true" />
              </span>
              <p className="text-lg font-semibold">בחרו פנייה כדי לענות</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                פניות VIP (פרימיום / ניסיון) מופיעות ראשונות. תשובה כאן נשלחת לבעל החנות גם במייל.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
