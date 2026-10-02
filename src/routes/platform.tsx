import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthState } from "@/hooks/useAuthState";
import { PLATFORM_SITE_NAME } from "@/lib/platform.functions";
import { CreateStoreForm, type CreatedStore } from "@/components/platform/CreateStoreForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Store = {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  is_default: boolean;
  created_at: string;
  admins: number;
  customers: number;
  products: number;
  orders: number;
};

export const Route = createFileRoute("/platform")({
  ssr: false,
  head: () => ({ meta: [{ title: PLATFORM_SITE_NAME }] }),
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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
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

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {loading || (session && isPlatformAdmin === null) ? null : !session ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">יש להתחבר כמנהל הפלטפורמה.</p>
              <Button asChild>
                <Link to="/login">התחברות</Link>
              </Button>
            </CardContent>
          </Card>
        ) : !isPlatformAdmin ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              העמוד הזה מיועד למנהלי הפלטפורמה בלבד.
            </CardContent>
          </Card>
        ) : (
          <PlatformConsole storeUrl={storeUrl} baseDomain={hostMode.baseDomain} />
        )}
      </main>
    </div>
  );
}

function PlatformConsole({
  storeUrl,
  baseDomain,
}: {
  storeUrl: (store: Pick<Store, "slug" | "domain">) => string | null;
  baseDomain: string | null;
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
          </CardHeader>
          <CardContent className="text-sm">
            כתובת:{" "}
            <a href={created.url} target="_blank" rel="noreferrer" dir="ltr" className="underline">
              {created.url}
            </a>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>חנויות ({stores.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>חנות</TableHead>
                <TableHead>כתובת</TableHead>
                <TableHead>מנהלים</TableHead>
                <TableHead>לקוחות</TableHead>
                <TableHead>מוצרים</TableHead>
                <TableHead>הזמנות</TableHead>
                <TableHead>נוצרה</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((store) => {
                const url = storeUrl(store);
                return (
                  <TableRow key={store.id}>
                    <TableCell className="font-medium">
                      {store.name} {store.is_default && <Badge variant="secondary">ראשית</Badge>}
                    </TableCell>
                    <TableCell dir="ltr" className="text-left">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="underline">
                          {url.replace(/^https:\/\//, "")}
                        </a>
                      ) : (
                        store.slug
                      )}
                    </TableCell>
                    <TableCell>{store.admins}</TableCell>
                    <TableCell>{store.customers}</TableCell>
                    <TableCell>{store.products}</TableCell>
                    <TableCell>{store.orders}</TableCell>
                    <TableCell>{new Date(store.created_at).toLocaleDateString("he-IL")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
