import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarPlus,
  ChevronDown,
  LifeBuoy,
  Loader2,
  Lock,
  LockOpen,
  LogIn,
  Receipt,
  Trash2,
  UserPlus,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database, TenantStatus } from "@/integrations/supabase/types";
import { STATUS_LABELS, createStoreAdmin } from "@/lib/platform.functions";
import { createStoreAdminHandoff } from "@/lib/handoff.functions";
import type { SubscriptionState } from "@/lib/subscription";
import {
  BillingHistoryDialog,
  ExtendTrialDialog,
  RecordPaymentDialog,
  SubscriptionCell,
  storeSubscription,
} from "@/components/platform/SubscriptionDialogs";
import {
  StoreCredentials,
  type StoreAdminCredentials,
} from "@/components/platform/StoreCredentials";
import { DeleteStoreDialog } from "@/components/platform/DeleteStoreDialog";
import { SslCell } from "@/components/platform/SslCell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type Store = Database["public"]["Functions"]["platform_list_tenants"]["Returns"][number];

/**
 * לוח הבקרה של החנויות: מנוי (תג ניסיון / בסיסי / פרימיום, הארכת ניסיון,
 * תיעוד תשלום והיסטוריה — חלק 13), סטטוס עם הקפאה / שחרור, תעודת SSL
 * (תוקף + חידוש), פרטי הבעלים, נתוני שימוש ומחיקה. כל פעולה רצה בפונקציה
 * במסד שבודקת בעצמה שהקורא הוא מנהל-על.
 */
export function StoresTable({
  stores,
  storeUrl,
  onChanged,
  onRemoved,
}: {
  stores: Store[];
  storeUrl: (store: Pick<Store, "slug" | "domain">) => string | null;
  onChanged: (store: Partial<Store> & { id: string }) => void;
  onRemoved: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toSuspend, setToSuspend] = useState<Store | null>(null);
  const [adminFor, setAdminFor] = useState<Store | null>(null);
  const [toDelete, setToDelete] = useState<Store | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [extendFor, setExtendFor] = useState<Store | null>(null);
  const [payFor, setPayFor] = useState<Store | null>(null);
  const [historyFor, setHistoryFor] = useState<Store | null>(null);
  const createHandoff = useServerFn(createStoreAdminHandoff);

  /** המנוי השתנה (הארכה / תשלום) — מעדכנים את השורה בלי לטעון הכל מחדש */
  const onSubscriptionChanged = (store: Store, state: SubscriptionState) =>
    onChanged({
      id: store.id,
      plan: state.plan,
      sub_plan: state.plan,
      sub_status: state.status,
      sub_trial_ends_at: state.trialEndsAt,
      sub_period_end: state.currentPeriodEnd,
      sub_ends_at: state.endsAt,
      sub_active: state.active,
    });

  /**
   * "היכנס לניהול" (God Mode): קוד כניסה חד-פעמי לחנות, ופתיחת פאנל הניהול
   * שלה בלשונית חדשה — כמנהל מלא, בלי להירשם בצוות של החנות.
   */
  const enterStore = async (store: Store) => {
    // הלשונית נפתחת מיד, בתוך הלחיצה — אחרת חוסם החלונות הקופצים עוצר אותה
    const tab = window.open("about:blank", "_blank");
    setEnteringId(store.id);
    try {
      const { url } = await createHandoff({ data: { tenantId: store.id } });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (error) {
      tab?.close();
      toast.error(error instanceof Error ? error.message : "הכניסה לניהול החנות נכשלה");
    } finally {
      setEnteringId(null);
    }
  };

  const setStatus = async (store: Store, status: TenantStatus) => {
    setBusyId(store.id);
    const { data, error } = await supabase.rpc("platform_set_tenant_status", {
      _tenant: store.id,
      _status: status,
    });
    setBusyId(null);
    if (error || !data) {
      toast.error(error?.message ?? "עדכון הסטטוס נכשל");
      return;
    }
    onChanged({ id: store.id, status: data.status, status_changed_at: data.status_changed_at });
    toast.success(
      data.status === "suspended" ? `החנות "${store.name}" הוקפאה` : `החנות "${store.name}" שוחררה`,
    );
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>חנות</TableHead>
            <TableHead>בעלים</TableHead>
            <TableHead>מנוי</TableHead>
            <TableHead>סטטוס</TableHead>
            <TableHead>תעודת SSL</TableHead>
            <TableHead>נתונים</TableHead>
            <TableHead>נוצרה</TableHead>
            <TableHead className="text-left">פעולות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stores.map((store) => {
            const url = storeUrl(store);
            const busy = busyId === store.id;
            const suspended = store.status === "suspended";
            const subscription = storeSubscription(store);
            return (
              <TableRow
                key={store.id}
                className={suspended || !subscription.active ? "bg-destructive/5" : undefined}
              >
                <TableCell>
                  <div className="font-medium">
                    {store.name} {store.is_default && <Badge variant="secondary">ראשית</Badge>}
                    {store.open_tickets > 0 && (
                      <Link
                        to="/platform/support"
                        className="ms-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 hover:bg-amber-200"
                        title="פניות תמיכה שממתינות למענה"
                      >
                        <LifeBuoy className="size-3" aria-hidden="true" />
                        {store.open_tickets}
                      </Link>
                    )}
                  </div>
                  <div dir="ltr" className="text-left text-xs text-muted-foreground">
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="underline">
                        {url.replace(/^https:\/\//, "")}
                      </a>
                    ) : (
                      store.slug
                    )}
                  </div>
                </TableCell>

                <TableCell className="text-xs">
                  <div dir="ltr" className="text-left">
                    {store.owner_email ?? <span className="text-muted-foreground">—</span>}
                  </div>
                  <div className="text-muted-foreground">
                    ח.פ: <span dir="ltr">{store.tax_id ?? "—"}</span>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="flex flex-col items-start gap-1.5">
                    <SubscriptionCell store={store} />
                    <DropdownMenu dir="rtl">
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs">
                          ניהול מנוי
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          disabled={subscription.endsAt === null}
                          onSelect={() => setExtendFor(store)}
                        >
                          <CalendarPlus className="size-4" />
                          {subscription.plan === "trial" ? "הארך ניסיון" : "הארכת תקופה"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPayFor(store)}>
                          <Wallet className="size-4" />
                          תעד תשלום
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setHistoryFor(store)}>
                          <Receipt className="size-4" />
                          היסטוריית תשלומים
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>

                <TableCell>
                  <Badge
                    variant={suspended ? "destructive" : "outline"}
                    className={suspended ? undefined : "border-green-600 text-green-700"}
                  >
                    {STATUS_LABELS[store.status]}
                  </Badge>
                  {store.status_changed_at && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      מ-{new Date(store.status_changed_at).toLocaleDateString("he-IL")}
                    </div>
                  )}
                </TableCell>

                <TableCell>
                  <SslCell
                    store={store}
                    onRequested={(requestedAt) =>
                      onChanged({ id: store.id, ssl_renew_requested_at: requestedAt })
                    }
                  />
                </TableCell>

                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {store.admins} מנהלים · {store.customers} לקוחות
                  <br />
                  {store.products} מוצרים · {store.orders} הזמנות
                </TableCell>

                <TableCell className="text-xs">
                  {new Date(store.created_at).toLocaleDateString("he-IL")}
                </TableCell>

                <TableCell>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      disabled={enteringId === store.id}
                      title={`פתיחת פאנל הניהול של "${store.name}" כמנהל-על`}
                      onClick={() => void enterStore(store)}
                    >
                      {enteringId === store.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <LogIn className="size-4" />
                      )}
                      היכנס לניהול
                    </Button>
                    {store.admins === 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setAdminFor(store)}
                      >
                        <UserPlus className="size-4" /> יצירת מנהל
                      </Button>
                    )}
                    {suspended ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-green-600 text-green-700 hover:bg-green-50"
                        disabled={busy}
                        onClick={() => void setStatus(store, "active")}
                      >
                        <LockOpen className="size-4" /> שחרר חנות
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy || store.is_default}
                        title={
                          store.is_default ? "החנות הראשית של הפלטפורמה לא ניתנת להקפאה" : undefined
                        }
                        onClick={() => setToSuspend(store)}
                      >
                        <Lock className="size-4" /> הקפא חנות / חסום
                      </Button>
                    )}
                    {!store.is_default && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busy}
                        title="מחיקת החנות לצמיתות"
                        onClick={() => setToDelete(store)}
                      >
                        <Trash2 className="size-4" /> מחיקה
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <AlertDialog open={toSuspend !== null} onOpenChange={(open) => !open && setToSuspend(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>להקפיא את "{toSuspend?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              הלקוחות יראו "האתר נעול זמנית" במקום המוצרים, ולא יוכלו לבצע הזמנות. מנהלי החנות
              ימשיכו להיכנס לפאנל הניהול שלה בלבד. אפשר לשחרר בכל רגע.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (toSuspend) void setStatus(toSuspend, "suspended");
                setToSuspend(null);
              }}
            >
              הקפאת החנות
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ExtendTrialDialog
        store={extendFor}
        onClose={() => setExtendFor(null)}
        onDone={onSubscriptionChanged}
      />
      <RecordPaymentDialog
        store={payFor}
        onClose={() => setPayFor(null)}
        onDone={onSubscriptionChanged}
      />
      <BillingHistoryDialog store={historyFor} onClose={() => setHistoryFor(null)} />

      <DeleteStoreDialog
        // מפתח לפי חנות — כל פתיחה מתחילה בשדה ריק
        key={`delete-${toDelete?.id ?? "closed"}`}
        store={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={onRemoved}
      />

      <CreateAdminDialog
        // מפתח לפי חנות — כל פתיחה מתחילה בטופס נקי
        key={adminFor?.id ?? "closed"}
        store={adminFor}
        onClose={() => setAdminFor(null)}
        onCreated={(store, email) =>
          onChanged({
            id: store.id,
            admins: store.admins + 1,
            owner_email: store.owner_email ?? email,
          })
        }
      />
    </>
  );
}

/** מנהל לחנות שאין לה מנהל (למשל אם יצירת המנהל נכשלה בהקמה) */
function CreateAdminDialog({
  store,
  onClose,
  onCreated,
}: {
  store: Store | null;
  onClose: () => void;
  onCreated: (store: Store, email: string) => void;
}) {
  const [email, setEmail] = useState(store?.owner_email ?? "");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<StoreAdminCredentials | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!store) return;
    setBusy(true);
    try {
      const result = await createStoreAdmin({ data: { tenantId: store.id, email } });
      setCredentials(result);
      onCreated(store, result.email);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={store !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>מנהל לחנות "{store?.name}"</DialogTitle>
          <DialogDescription>
            נוצר חשבון עם סיסמה זמנית; בכניסה הראשונה המנהל יתבקש לקבוע סיסמה משלו.
          </DialogDescription>
        </DialogHeader>
        {credentials ? (
          <StoreCredentials credentials={credentials} />
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-store-admin">אימייל</Label>
              <Input
                id="new-store-admin"
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "יוצר…" : "יצירת מנהל"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
