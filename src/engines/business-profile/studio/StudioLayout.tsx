// ממשק הניהול של בעל העסק (/studio): ההקשר (האתר, ההרשאות, מצב הפרסום) נטען פעם אחת ומשותף לכל המסכים.
// לא מחובר → כניסה מרכזית; מחובר בלי הרשאה באתר הזה → "אין הרשאה". הכול noindex (בנתיב).
import { createContext, useContext, useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button, Card, CardContent, Input, Label } from "@/platform/ui";
import { applyServerSession, signOutHere } from "@/platform/auth/browser-session";
import { loginWithIdentifier } from "@/platform/auth/login";
import { studioCentralLogin, studioContext } from "../api/studio.functions";
import { OwnerEmailBanner } from "./OwnerEmailBanner";
import { studioInquiriesNewCount } from "../api/inquiries.functions";
import type { StudioContext } from "../types";
import { StatusBadge } from "./status";

const Ctx = createContext<{ context: StudioContext; refresh: () => Promise<unknown> } | null>(null);

export function useStudio() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStudio outside StudioLayout");
  return v;
}

export const STUDIO_QUERY = ["bp", "studio-context"] as const;

function Centered({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-muted/30 px-4"
      dir="rtl"
    >
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 py-10 text-center">{children}</CardContent>
      </Card>
    </main>
  );
}

function SignedOut({ onSignedIn }: { onSignedIn: () => void }) {
  const loginUrl = useServerFn(studioCentralLogin);
  const passwordLogin = useServerFn(loginWithIdentifier);
  const login = useQuery({ queryKey: ["bp", "central-login"], queryFn: () => loginUrl() });
  const id = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // כניסה עם הסיסמה של החשבון (מיגרציה 198 — בעלת אתר שנכנסה בהזמנה בחרה סיסמה). אותה פונקציה של כל
      // המוצרים: הגבלת קצב, ורק חשבון שמשויך לאתר הזה (או מנהל פלטפורמה)
      const tokens = await passwordLogin({ data: { identifier: email, password } });
      await applyServerSession(tokens.accessToken, tokens.refreshToken);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "הכניסה נכשלה — נסו שוב");
      setBusy(false);
    }
  }
  return (
    <Centered>
      <h1 className="text-xl font-bold">כניסה לניהול האתר</h1>
      <form className="space-y-3 text-start" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-email`}>אימייל</Label>
          <Input
            id={`${id}-email`}
            type="email"
            dir="ltr"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-password`}>סיסמה</Label>
          <Input
            id={`${id}-password`}
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !email || !password}>
          {busy ? "נכנסים…" : "כניסה"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        או דרך החשבון שלכם ב-Nuriel — אותה כניסה של החנויות ואתרי האירוח (גם עם קוד למייל).
      </p>
      {login.data?.url ? (
        <Button asChild variant="outline" className="w-full">
          <a href={login.data.url}>כניסה מרכזית ב-Nuriel</a>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">טוען…</p>
      )}
    </Centered>
  );
}

export function StudioLayout() {
  const load = useServerFn(studioContext);
  const q = useQuery({ queryKey: STUDIO_QUERY, queryFn: () => load(), retry: false });
  if (q.isPending) {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground" role="status">
          טוען את ממשק הניהול…
        </p>
      </Centered>
    );
  }
  if (q.isError) {
    return (
      <Centered>
        <h1 className="text-xl font-bold">ממשק הניהול לא נטען</h1>
        <p className="text-sm text-muted-foreground">
          {q.error instanceof Error ? q.error.message : "נסו שוב"}
        </p>
        <Button onClick={() => void q.refetch()}>ניסיון נוסף</Button>
      </Centered>
    );
  }
  if (q.data.state === "signed_out") return <SignedOut onSignedIn={() => void q.refetch()} />;
  if (q.data.state === "forbidden") {
    return (
      <Centered>
        <h1 className="text-xl font-bold">אין הרשאה לאתר הזה</h1>
        <p className="text-sm text-muted-foreground">החשבון שלכם לא משויך לניהול של האתר הזה.</p>
        <Button variant="outline" onClick={() => void signOutHere().then(() => q.refetch())}>
          התנתקות
        </Button>
      </Centered>
    );
  }
  const context = q.data.context;
  return (
    <Ctx.Provider value={{ context, refresh: () => q.refetch() }}>
      <div className="min-h-screen bg-muted/30" dir="rtl">
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold">{context.site.name}</span>
              <StatusBadge state={context.state} />
            </div>
            <nav aria-label="ניהול האתר" className="flex items-center gap-1 text-sm">
              <StudioLink to="/studio">סקירה ופרסום</StudioLink>
              <StudioLink to="/studio/editor">עריכת האתר</StudioLink>
              <StudioLink to="/studio/versions">גרסאות</StudioLink>
              {context.permissions.includes("inquiries.manage") && <InboxLink />}
              {context.permissions.includes("settings.owner") && (
                <StudioLink to="/studio/settings">הגדרות האתר</StudioLink>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void signOutHere().then(() => q.refetch())}
              >
                התנתקות
              </Button>
            </nav>
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-7xl px-4 py-8">
          <OwnerEmailBanner />
          <Outlet />
        </main>
      </div>
    </Ctx.Provider>
  );
}

function StudioLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground data-[status=active]:bg-muted data-[status=active]:font-semibold data-[status=active]:text-foreground"
    >
      {children}
    </Link>
  );
}

/** "פניות מלקוחות" + מספר הפניות החדשות (מתעדכן כל דקה) */
function InboxLink() {
  const load = useServerFn(studioInquiriesNewCount);
  const q = useQuery({
    queryKey: ["bp", "inquiries", "new-count"],
    queryFn: () => load(),
    refetchInterval: 60_000,
  });
  const n = q.data?.count ?? 0;
  return (
    <Link
      to="/studio/inbox"
      className="flex items-center gap-1.5 rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground data-[status=active]:bg-muted data-[status=active]:font-semibold data-[status=active]:text-foreground"
    >
      פניות מלקוחות
      {n > 0 && (
        <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold text-primary-foreground tabular-nums">
          {n}
          <span className="sr-only"> חדשות</span>
        </span>
      )}
    </Link>
  );
}
