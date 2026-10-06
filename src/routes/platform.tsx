import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SSL_AGENT_STALE_MS } from "@/lib/ssl-status";
import { PLATFORM_SITE_NAME } from "@/lib/platform.functions";
import { CreateStoreForm, type CreatedStore } from "@/components/platform/CreateStoreForm";
import { PlatformAdminsCard } from "@/components/platform/PlatformAdminsCard";
import { PlatformShell } from "@/components/platform/PlatformShell";
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
  const { hostMode } = Route.useRouteContext();

  const storeUrl = (store: Pick<Store, "slug" | "domain">) =>
    store.domain
      ? `https://${store.domain}`
      : hostMode.baseDomain
        ? `https://${store.slug}.${hostMode.baseDomain}`
        : null;

  // הכותרת, הניווט (חנויות / תמיכה) ובדיקת מנהל-על — ב-PlatformShell
  return (
    <PlatformShell active="stores">
      {({ userId }) => (
        <PlatformConsole
          storeUrl={storeUrl}
          baseDomain={hostMode.baseDomain}
          currentUserId={userId}
        />
      )}
    </PlatformShell>
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
  // מנויים (חלק 13): כמה בניסיון / בתשלום / פגי תוקף
  const trials = stores.filter((s) => s.sub_plan === "trial" && s.sub_active).length;
  const paying = stores.filter(
    (s) => s.sub_plan !== "trial" && s.sub_active && !s.is_default,
  ).length;
  const expired = stores.filter((s) => !s.sub_active).length;
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
              {active} פעילות · {suspended} מוקפאות · {trials} בניסיון · {paying} משלמות
              {expired > 0 && (
                <span className="font-semibold text-destructive"> · {expired} פג תוקף</span>
              )}
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
