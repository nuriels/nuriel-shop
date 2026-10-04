import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { LifeBuoy, Lock, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthState } from "@/hooks/useAuthState";
import { FORBIDDEN_PAGE } from "@/lib/blocked-pages";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * המסגרת של פאנל הפלטפורמה: כותרת עם ניווט (חנויות / תמיכה), החשבון המחובר,
 * ובדיקה שהמשתמש מנהל-על. התוכן (children) מוצג רק למנהל-על.
 */
export function PlatformShell({
  active,
  children,
}: {
  active: "stores" | "support";
  children: (props: { userId: string }) => ReactNode;
}) {
  const { session, loading } = useAuthState();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean | null>(null);
  const supportOpen = useSupportOpenCount(isPlatformAdmin === true);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      setIsPlatformAdmin(null);
      return;
    }
    supabase.rpc("is_platform_admin", {}).then(({ data }) => setIsPlatformAdmin(data === true));
  }, [userId]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-lg font-bold">ניהול הפלטפורמה</h1>
            {isPlatformAdmin && (
              <nav
                aria-label="ניווט בפאנל"
                className="flex items-center gap-1 rounded-lg bg-secondary p-1"
              >
                <NavLink
                  to="/platform"
                  active={active === "stores"}
                  icon={<Store className="size-4" />}
                >
                  חנויות
                </NavLink>
                <NavLink
                  to="/platform/support"
                  active={active === "support"}
                  icon={<LifeBuoy className="size-4" />}
                  badge={supportOpen}
                >
                  תמיכה
                </NavLink>
              </nav>
            )}
          </div>
          {session && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span dir="ltr">{session.user.email}</span>
              <Button variant="outline" size="sm" onClick={() => supabase.auth.signOut()}>
                יציאה
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {loading || (session && isPlatformAdmin === null) ? null : !session || !userId ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">יש להתחבר כמנהל הפלטפורמה.</p>
              <Button asChild>
                <Link to="/login">התחברות</Link>
              </Button>
            </CardContent>
          </Card>
        ) : !isPlatformAdmin ? (
          <Card className="mx-auto max-w-md">
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="mb-2 grid size-14 place-items-center rounded-full bg-destructive/10">
                <Lock className="size-6 text-destructive" />
              </div>
              <div className="text-xs font-bold tracking-widest text-destructive">403</div>
              <h2 className="text-xl font-bold">{FORBIDDEN_PAGE.title}</h2>
              <p className="text-sm text-muted-foreground">
                החשבון <span dir="ltr">{session.user.email}</span> אינו מנהל פלטפורמה.
              </p>
              <Button variant="outline" className="mt-3" onClick={() => supabase.auth.signOut()}>
                התחברות עם חשבון אחר
              </Button>
            </CardContent>
          </Card>
        ) : (
          children({ userId })
        )}
      </main>
    </div>
  );
}

function NavLink({
  to,
  active,
  icon,
  badge = 0,
  children,
}: {
  to: "/platform" | "/platform/support";
  active: boolean;
  icon: ReactNode;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
      {badge > 0 && (
        <span className="rounded-full bg-amber-500 px-1.5 text-xs font-bold text-white">
          {badge}
        </span>
      )}
    </Link>
  );
}

/** כמה פניות ממתינות לנו — התג ליד "תמיכה" (מתרענן כל דקה) */
function useSupportOpenCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      const { data } = await supabase.rpc("platform_support_counts");
      const open = Number((data as Record<string, unknown> | null)?.["open"] ?? 0) || 0;
      if (alive) setCount(open);
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return count;
}
