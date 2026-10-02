import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Lock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthState } from "@/hooks/useAuthState";
import { FORBIDDEN_PAGE } from "@/lib/blocked-pages";
import { SSL_AGENT_STALE_MS } from "@/lib/ssl-status";
import { PLATFORM_SITE_NAME } from "@/lib/platform.functions";
import { CreateStoreForm, type CreatedStore } from "@/components/platform/CreateStoreForm";
import { PlatformAdminsCard } from "@/components/platform/PlatformAdminsCard";
import { StoreCredentials } from "@/components/platform/StoreCredentials";
import { StoresTable, type Store } from "@/components/platform/StoresTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// /platform זמין רק בדומיין של פאנל הפלטפורמה. בדומיין של חנות השרת
// (src/server.ts) מחזיר 403, וה-root route מפנה ל-/forbidden בניווט פנימי.
export const Route = createFileRoute("/platform")({
  ssr: false,
  head: () => ({ meta: [{ title: PLATFORM_SITE_NAME }, { name: "robots", content: "noindex" }] }),
  component: PlatformPage,
});

function PlatformPage() {
  const { session, loading } = useAuthState();
  const { hostMode } = Route.useRouteContext();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean | null>(null);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      setIsPlatformAdmin(null);
      return;
    }
    supabase.rpc("is_platform_admin", {}).then(({ data }) => setIsPlatformAdmin(data === true));
  }, [userId]);

  const storeUrl = (store: Pick<Store, "slug" | "domain">) =>
    store.domain
      ? `https://${store.domain}`
      : hostMode.baseDomain
        ? `https://${store.slug}.${hostMode.baseDomain}`
        : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-lg font-bold">ניהול הפלטפורמה</h1>
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
          <PlatformConsole
            storeUrl={storeUrl}
            baseDomain={hostMode.baseDomain}
            currentUserId={userId}
          />
        )}
      </main>
    </div>
  );
}

function PlatformConsole({
  storeUrl,
  baseDomain,
  currentUserId,
}: {
  storeUrl: (store: Pick<Store, "slug" | "domain">) => string | null;
  baseDomain: string | null;
  currentUserId: string;
}) {
  const [stores, setStores] = useState<Store[]>([]);
  const [created, setCreated] = useState<CreatedStore | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("platform_list_tenants", {});
    if (error) toast.error(error.message);
    else setStores(data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // מחכים לשרת (חידוש שהתבקש, או חנות חדשה שעוד אין לה תעודה) — מרעננים כל 15 שניות
  const waitingForServer = stores.some(
    (s) => s.ssl_renew_requested_at !== null || (!s.is_default && s.ssl_status === null),
  );
  useEffect(() => {
    if (!waitingForServer) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15_000);
    return () => clearInterval(timer);
  }, [waitingForServer, load]);

  const active = stores.filter((s) => s.status === "active").length;
  const suspended = stores.length - active;
  const lastReport = stores.reduce<string | null>(
    (latest, s) =>
      s.ssl_checked_at && (!latest || s.ssl_checked_at > latest) ? s.ssl_checked_at : latest,
    null,
  );
  const agentStale =
    stores.length > 0 &&
    (!lastReport || Date.now() - new Date(lastReport).getTime() > SSL_AGENT_STALE_MS);

  return (
    <>
      <CreateStoreForm
        baseDomain={baseDomain}
        onCreated={(store) => {
          setCreated(store);
          void load();
        }}
      />

      {created && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>החנות "{created.name}" הוקמה</CardTitle>
            <CardDescription>
              כתובת:{" "}
              <a
                href={created.url}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="underline"
              >
                {created.url}
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {created.admin ? (
              <StoreCredentials credentials={created.admin} />
            ) : (
              <p className="text-sm text-destructive">
                מנהל החנות לא נוצר: {created.adminError}. אפשר ליצור מנהל מהטבלה למטה.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {agentStale && (
        <Card className="border-amber-500 bg-amber-50">
          <CardContent className="flex items-start gap-3 py-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div>
              {lastReport
                ? `השרת לא דיווח על תעודות ה-SSL מאז ${new Date(lastReport).toLocaleString("he-IL")}.`
                : "השרת עוד לא דיווח על תעודות ה-SSL."}{" "}
              חנויות חדשות לא יקבלו תעודה וחידוש מהפאנל לא יבוצע עד שהטיימר בשרת ירוץ. בדיקה בשרת:{" "}
              <code dir="ltr" className="rounded bg-amber-100 px-1">
                journalctl -u nuriel-store-certs -n 20
              </code>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>חנויות ({stores.length})</CardTitle>
            <CardDescription>
              {active} פעילות · {suspended} מוקפאות
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="size-4" /> רענון
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <StoresTable
            stores={stores}
            storeUrl={storeUrl}
            onChanged={(change) =>
              setStores((list) => list.map((s) => (s.id === change.id ? { ...s, ...change } : s)))
            }
            onRemoved={(id) => {
              setStores((list) => list.filter((s) => s.id !== id));
              setCreated((c) => (c?.id === id ? null : c));
            }}
          />
        </CardContent>
      </Card>

      <PlatformAdminsCard currentUserId={currentUserId} />
    </>
  );
}
