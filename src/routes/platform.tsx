import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthState } from "@/hooks/useAuthState";
import { createStoreAdmin, PLATFORM_SITE_NAME } from "@/lib/platform.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type Created = {
  name: string;
  url: string;
  admin: { email: string; tempPassword: string; loginUrl: string } | null;
  adminError: string | null;
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
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", domain: "", adminEmail: "" });

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("platform_list_tenants", {});
    if (error) toast.error(error.message);
    else setStores(data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setCreated(null);
    try {
      // 1. החנות עצמה — פונקציה במסד (בודקת הרשאה, slug, דומיין; יוצרת הגדרות)
      const { data: tenant, error } = await supabase.rpc("platform_create_tenant", {
        _slug: form.slug,
        _name: form.name,
        _domain: form.domain.trim() || null,
      });
      if (error || !tenant) throw new Error(error?.message ?? "הקמת החנות נכשלה");

      // 2. מנהל ראשון לחנות (אופציונלי) — בשרת, דרך ה-Auth API
      let admin: Created["admin"] = null;
      let adminError: string | null = null;
      if (form.adminEmail.trim()) {
        try {
          admin = await createStoreAdmin({
            data: { tenantId: tenant.id, email: form.adminEmail },
          });
        } catch (adminFailure) {
          adminError = adminFailure instanceof Error ? adminFailure.message : String(adminFailure);
        }
      }

      setCreated({ name: tenant.name, url: storeUrl(tenant) ?? "", admin, adminError });
      setForm({ name: "", slug: "", domain: "", adminEmail: "" });
      toast.success(`החנות "${tenant.name}" הוקמה`);
      await load();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>הקמת חנות חדשה</CardTitle>
          <CardDescription>
            החנות זמינה מיד בכתובת
            <span dir="ltr" className="mx-1 font-mono">
              {"<כתובת>"}.{baseDomain ?? "…"}
            </span>
            (או בדומיין משלה, אם מוגדר).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="store-name">שם החנות</Label>
              <Input
                id="store-name"
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-slug">כתובת (תת-דומיין)</Label>
              <div className="flex items-center gap-2" dir="ltr">
                <Input
                  id="store-slug"
                  required
                  minLength={3}
                  maxLength={63}
                  pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]"
                  placeholder="shop1"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().trim() })}
                />
                <span className="shrink-0 text-sm text-muted-foreground">.{baseDomain ?? "…"}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-domain">דומיין משלה (לא חובה)</Label>
              <Input
                id="store-domain"
                dir="ltr"
                placeholder="shop.example.com"
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value.toLowerCase().trim() })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-admin">אימייל מנהל החנות (לא חובה)</Label>
              <Input
                id="store-admin"
                type="email"
                dir="ltr"
                placeholder="owner@example.com"
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? "מקים…" : "הקמת החנות"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {created && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>החנות "{created.name}" הוקמה</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {created.url && (
              <p>
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
              </p>
            )}
            {created.admin && (
              <div className="space-y-1 rounded-md bg-muted p-3">
                <p>
                  מנהל החנות: <span dir="ltr">{created.admin.email}</span>
                </p>
                <p>
                  סיסמה זמנית:{" "}
                  <span dir="ltr" className="font-mono font-bold">
                    {created.admin.tempPassword}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  הסיסמה מוצגת פעם אחת בלבד. בכניסה הראשונה ב-
                  <span dir="ltr">{created.admin.loginUrl}</span> המנהל יתבקש לקבוע סיסמה חדשה.
                </p>
              </div>
            )}
            {created.adminError && (
              <p className="text-destructive">
                החנות הוקמה, אבל יצירת המנהל נכשלה: {created.adminError}
              </p>
            )}
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
