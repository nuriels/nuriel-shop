// המעטפת של אזור הניהול (/manage): בודקת מי מחובר ומה מותר לו (בשרת ובמסד), ומציגה
// (שלב F2b, "Deep Lagoon & Champagne"): סרגל צד כהה בקבוצות (מחשב) / שורה תחתונה + "עוד" (טלפון),
// סרגל עליון (חיפוש מהיר Ctrl+K, "+ חדש", "דורש טיפול", צפייה באתר), הודעת מנוי, והמסך עצמו —
// עם מסך שגיאה בעברית בתוך המעטפת (המסך נשבר — הניווט נשאר).
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { CatchBoundary, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, TriangleAlert } from "lucide-react";
import { onSessionChange, signOutHere } from "@/platform/auth/browser-session";
import { cn } from "@/platform/ui";
import { hospitalityManagementContext } from "../../api/management.functions";
import type { ManagementContext } from "../../types/management";
import { visibleNav } from "../lib/nav";
import { planNotice } from "../lib/plan-notice";
import { manageKeys } from "../lib/query-keys";
import { CommandMenu } from "./CommandMenu";
import { ManagementCtx } from "./management-context";
import { BottomNav, SideNav } from "./Navigation";
import { ErrorScreen, ForbiddenScreen, LoadingScreen, ManageRouteError } from "./StatusScreens";
import { navBadges, useDashboardTasks, useSupportUnread } from "./tasks";
import { TopBar } from "./TopBar";

// NURIEL AI – Hospitality: נטען רק אחרי שהמעטפת עלתה (הקטלוג והחלון לא בחבילה הראשית)
const HospitalityAssistant = lazy(() => import("../ai/HospitalityAssistant"));

export function ManageLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: manageKeys.context,
    queryFn: () => hospitalityManagementContext(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // A3: בכל כניסה לאזור בודקים מחדש — תשובה ישנה מהמטמון לא מחליטה לבד
    refetchOnMount: "always",
    retry: false,
  });

  // התנתקות / החלפת חשבון בלשונית אחרת → בודקים שוב
  useEffect(
    () =>
      onSessionChange(() => {
        void queryClient.invalidateQueries({ queryKey: manageKeys.all });
      }),
    [queryClient],
  );

  // A3: למסך הכניסה רק לפי תשובה טרייה מהשרת (אחרי הבדיקה של הכניסה הזו), לא לפי "לא מחובר" שנשאר
  // במטמון מלפני שהמשתמש נכנס — זה מה שהחזיר מנהלים שנכנסו בהצלחה למסך הכניסה
  const signedOut =
    access.data?.state === "signed_out" && access.isFetchedAfterMount && !access.isFetching;
  useEffect(() => {
    if (signedOut) void navigate({ to: "/manage/login", replace: true });
  }, [signedOut, navigate]);

  const signOut = async () => {
    await signOutHere();
    queryClient.removeQueries({ queryKey: manageKeys.all });
    await navigate({ to: "/manage/login", replace: true });
  };

  if (access.isError) {
    return (
      <ErrorScreen
        message={access.error instanceof Error ? access.error.message : "הטעינה נכשלה"}
        onRetry={() => void access.refetch()}
      />
    );
  }
  if (!access.data || access.data.state === "signed_out") return <LoadingScreen />;
  if (access.data.state === "forbidden") {
    return <ForbiddenScreen message={access.data.message} onSignOut={() => void signOut()} />;
  }
  return (
    <ManagementCtx.Provider value={access.data.context}>
      <Shell context={access.data.context} onSignOut={() => void signOut()}>
        <Outlet />
      </Shell>
    </ManagementCtx.Provider>
  );
}

function Shell({
  context,
  onSignOut,
  children,
}: {
  context: ManagementContext;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const items = visibleNav(context.permissions);
  const notice = planNotice(context);
  const roleText = context.role === "owner" ? "בעלים" : "מנהל/ת";
  const tasks = useDashboardTasks(context.permissions["bookings"] === true);
  const support = useSupportUnread(context.permissions["settings"] === true);
  const badges = { ...navBadges(tasks.data), ...(support.data ? { support: support.data } : {}) };
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [searchOpen, setSearchOpen] = useState(false);

  // Ctrl+K / ⌘K — חיפוש מהיר
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-dvh bg-background text-foreground md:grid md:grid-cols-[16.5rem_minmax(0,1fr)] print:block">
      {/* בהדפסה (דוחות) — רק התוכן, בלי הניווט */}
      <div className="contents print:hidden">
        <SideNav
          items={items}
          badges={badges}
          businessName={context.business.name}
          onSignOut={onSignOut}
        />
      </div>
      <div className="flex min-h-dvh min-w-0 flex-col">
        <div className="contents print:hidden">
          <TopBar
            items={items}
            roleText={roleText}
            supportUnread={support.data ?? 0}
            onSearch={() => setSearchOpen(true)}
          />
        </div>
        {notice && (
          <div
            role="status"
            className={cn(
              "flex items-start gap-2 border-b px-4 py-3 text-sm md:px-8 print:hidden",
              notice.tone === "warning"
                ? "bg-[var(--hm-danger-bg)] text-[var(--hm-danger)]"
                : "bg-[var(--hm-champagne-100)] text-[var(--hm-champagne-700)]",
            )}
          >
            {notice.tone === "warning" ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            <p>
              {notice.text}
              {notice.action && (
                <>
                  {" "}
                  {notice.action.kind === "plan" ? (
                    <Link
                      to="/manage"
                      hash="plan"
                      className="font-semibold underline underline-offset-2"
                    >
                      {notice.action.label}
                    </Link>
                  ) : (
                    <Link
                      to="/manage/support"
                      search={{ new: "1", topic: "account", subject: notice.action.subject }}
                      className="font-semibold underline underline-offset-2"
                    >
                      {notice.action.label}
                    </Link>
                  )}
                </>
              )}
            </p>
          </div>
        )}
        <main id="main-content" className="flex-1 px-4 pt-6 pb-28 md:px-8 md:pb-12 print:p-0">
          <CatchBoundary getResetKey={() => pathname} errorComponent={ManageRouteError}>
            {children}
          </CatchBoundary>
        </main>
      </div>
      <div className="contents print:hidden">
        <BottomNav
          items={items}
          badges={badges}
          siteOpen={context.flags.frontend}
          onSignOut={onSignOut}
        />
      </div>
      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} items={items} />
      <Suspense fallback={null}>
        <HospitalityAssistant />
      </Suspense>
    </div>
  );
}
