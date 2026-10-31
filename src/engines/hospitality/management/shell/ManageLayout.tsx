// המעטפת של אזור הניהול (/manage): בודקת מי מחובר ומה מותר לו (בשרת ובמסד),
// ומציגה כותרת, הודעת מנוי, ניווט (צד במחשב, שורה תחתונה בטלפון) והמסך עצמו.
import { useEffect } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, LogOut, TriangleAlert } from "lucide-react";
import { onSessionChange, signOutHere } from "@/platform/auth/browser-session";
import { Button, cn } from "@/platform/ui";
import { hospitalityManagementContext } from "../../api/management.functions";
import type { ManagementContext } from "../../types/management";
import { visibleNav } from "../lib/nav";
import { planNotice } from "../lib/plan-notice";
import { manageKeys } from "../lib/query-keys";
import { ManagementCtx } from "./management-context";
import { BottomNav, SideNav } from "./Navigation";
import { ErrorScreen, ForbiddenScreen, LoadingScreen } from "./StatusScreens";

export function ManageLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: manageKeys.context,
    queryFn: () => hospitalityManagementContext(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
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

  const signedOut = access.data?.state === "signed_out";
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
  children: React.ReactNode;
}) {
  const items = visibleNav(context.permissions);
  const notice = planNotice(context);
  return (
    <div className="min-h-dvh bg-background text-foreground md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
      <SideNav items={items} businessName={context.business.name} />
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold md:hidden">{context.business.name}</p>
            <p className="text-xs text-muted-foreground">
              {context.role === "owner" ? "בעלים" : "מנהל/ת"}
            </p>
          </div>
          <Button variant="ghost" onClick={onSignOut} className="min-h-11 gap-2">
            <LogOut className="size-4" aria-hidden="true" />
            <span>התנתקות</span>
          </Button>
        </header>
        {notice && (
          <div
            role="status"
            className={cn(
              "flex items-start gap-2 border-b px-4 py-3 text-sm md:px-8",
              notice.tone === "warning"
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/5 text-foreground",
            )}
          >
            {notice.tone === "warning" ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            <p>{notice.text}</p>
          </div>
        )}
        <main id="main-content" className="flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10">
          {children}
        </main>
      </div>
      <BottomNav items={items} />
    </div>
  );
}
