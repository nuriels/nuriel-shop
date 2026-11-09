// "מסמכי לקוחות" (/manage/client-documents, מיגרציה 64) — חוזים לחתימה אלקטרונית מול הלקוחות:
// שליחת חוזה (אירוח ↔ הזמנת לינה · מתחם הבריכה ↔ אירוע), ארכיון החוזים, ותנאים ופרטי החוזה.
// הנוסח הוכן מתוך החוזים של העסק לבדיקה משפטית: עד שהפלטפורמה מפעילה את החוזים (אחרי האישור) —
// תצוגה מקדימה בלבד, בלי שליחה ללקוחות. ההרשאות נבדקות במסד; כאן רק מה שמוצג.
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Archive, FileSignature, Scale, Send, TriangleAlert } from "lucide-react";
import { cn } from "@/platform/ui";
import { hospitalityContractsView } from "../../api/contracts.functions";
import { LoadError, PageSkeleton } from "../catalog/parts";
import { useManagement } from "../shell/management-context";
import { NoAccess, PageHeader } from "../ui/kit";
import { ContractsArchive } from "./ContractsArchive";
import { contractsViewKey, parseClientDocsSearch, type ClientDocsTab } from "./model";
import { SendContract } from "./SendContract";
import { TermsEditor } from "./TermsEditor";

const TABS: { key: ClientDocsTab; label: string; icon: typeof Send }[] = [
  { key: "send", label: "שליחת חוזה", icon: Send },
  { key: "archive", label: "ארכיון החוזים", icon: Archive },
  { key: "terms", label: "תנאים ופרטי החוזה", icon: Scale },
];

export function ClientDocumentsPage() {
  const ctx = useManagement();
  const navigate = useNavigate();
  const search = parseClientDocsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const canContracts = Boolean(ctx.permissions["contracts"]);
  // בלי הרשאת חוזים — רק התנאים (מי שמנהל הזמנות ואירועים רואה אותם; עריכה — לפי ההרשאה במסד)
  const canTerms = Boolean(ctx.permissions["bookings"]);
  const linked = Boolean(search.booking || search.event);
  const tab: ClientDocsTab = !canContracts
    ? "terms"
    : (search.tab ?? (linked ? "send" : "archive"));
  const view = useQuery({
    queryKey: contractsViewKey,
    queryFn: () => hospitalityContractsView(),
    enabled: canContracts,
  });

  if (!canContracts && !canTerms)
    return <NoAccess text="מסמכי הלקוחות — לבעלים ולמנהלים שקיבלו הרשאה לחוזים." />;
  if (canContracts && view.isError && !view.data) return <LoadError error={view.error} />;
  if (canContracts && !view.data) return <PageSkeleton label="טוען את מסמכי הלקוחות…" />;
  const v = view.data ?? null;
  const go = (next: ClientDocsTab) =>
    void navigate({
      to: "/manage/client-documents",
      search: {
        tab: next,
        ...(next === "send" && search.booking ? { booking: search.booking } : {}),
        ...(next === "send" && search.event ? { event: search.event } : {}),
      },
    });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5" data-testid="client-documents">
      <PageHeader
        title="מסמכי לקוחות"
        description="חוזים לחתימה אלקטרונית: חוזה אירוח להזמנת לינה, וחוזה מתחם הבריכה לאירוע בלי לינה. הלקוח מקבל קישור אישי במייל, חותם בטלפון או במחשב, והעותק החתום (PDF) נשמר כאן ונשלח אליו. החתימה מתעדת את הסכמת הלקוח לנוסח שנשלח — היא אינה אישור משפטי של החוזה."
      />

      {v && !v.enabled && (
        <div
          className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          role="note"
          data-testid="contracts-legal-pending"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">החוזים ממתינים לבדיקה ולאישור משפטי</p>
            <p>
              הנוסח הוכן מתוך החוזים של העסק, לצורך בדיקה — הוא עוד לא אושר על ידי עורך דין, ואין
              להציג אותו ללקוחות כחוזה מאושר. עד האישור אפשר לבדוק כאן תצוגה מקדימה בלבד; השליחה
              ללקוחות תיפתח אחרי שהבדיקה תושלם.
            </p>
          </div>
        </div>
      )}
      {v && v.enabled && !v.terms.confirmed && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-300 bg-sky-50 p-4 text-sm text-sky-950"
          role="note"
          data-testid="contracts-terms-pending"
        >
          <p>
            לפני החוזה הראשון: בעל העסק צריך לבדוק ולאשר את התנאים והפרטים שנכנסים לחוזים (פרטי צד
            א', היחידות, הפיקדון והשעות).
          </p>
          {tab !== "terms" && (
            <button
              type="button"
              onClick={() => go("terms")}
              className="min-h-11 rounded-md border border-sky-400 bg-white px-3 font-medium hover:bg-sky-100"
            >
              לתנאים ופרטי החוזה
            </button>
          )}
        </div>
      )}

      {canContracts && (
        <div role="tablist" aria-label="מסמכי לקוחות" className="flex gap-1 overflow-x-auto pb-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const selected = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`cd-tab-${t.key}`}
                aria-selected={selected}
                aria-controls={`cd-panel-${t.key}`}
                onClick={() => go(t.key)}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-sm",
                  selected ? "border-primary bg-primary text-primary-foreground" : "bg-background",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {t.label}
                {t.key === "archive" && v && v.counts.all > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-2 text-xs",
                      selected ? "bg-primary-foreground/20" : "bg-muted",
                    )}
                  >
                    {v.counts.all}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div
        role={canContracts ? "tabpanel" : undefined}
        id={`cd-panel-${tab}`}
        aria-labelledby={canContracts ? `cd-tab-${tab}` : undefined}
      >
        {tab === "send" && v && (
          <SendContract
            key={`${search.booking ?? ""}:${search.event ?? ""}`}
            view={v}
            bookingId={search.booking ?? null}
            eventId={search.event ?? null}
          />
        )}
        {tab === "archive" && v && <ContractsArchive counts={v.counts} />}
        {tab === "terms" && (
          <>
            {!canContracts && (
              <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
                <FileSignature className="size-4" aria-hidden="true" />
                שליחת חוזים והארכיון — לבעלים ולמנהלים שקיבלו הרשאה לחוזים.
              </p>
            )}
            <TermsEditor />
          </>
        )}
      </div>
    </div>
  );
}
