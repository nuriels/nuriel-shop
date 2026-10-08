import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Ban, Crown, Loader2, RefreshCw, ShieldCheck, Trash2, UserCog, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateStaffAccountDialog } from "@/components/CreateStaffAccountDialog";
import { useStoreAdminSeats } from "@/hooks/useStoreAdminSeats";
import { deleteUserAccount } from "@/lib/admin.functions";
import { seatsFull } from "@/lib/admin-seats";
import {
  ASSIGNABLE_STAFF_ROLES,
  STAFF_ROLE_DESCRIPTION,
  STAFF_ROLE_LABEL,
  staffCan,
  staffRoleChangeProblem,
  staffRoleOf,
  type AssignableStaffRole,
  type StaffRole,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

type StaffRow = {
  user_id: string;
  email: string;
  username: string;
  display_name: string | null;
  role: string;
  is_protected: boolean;
  is_blocked: boolean;
  created_at: string;
};

/** מה כל תפקיד יכול — מוצג בראש המסך, כדי שבעל החנות יבחר בביטחון */
const ROLE_ABILITIES: Record<StaffRole, string[]> = {
  owner: ["הכל", "החבילה, התוספים ופרטי החיוב", "מינוי והסרה של מנהלים"],
  manager: [
    "לוח בקרה, הזמנות ולקוחות",
    "מוצרים, מלאי והגדרות האתר",
    "ניהול קופאים, מחסנאים וסוכנים",
  ],
  cashier: [
    "קופה מהירה: הזמנה טלפונית / מכירה בחנות",
    "צפייה במוצרים ובמלאי",
    "בלי הכנסות, הזמנות קודמות והגדרות",
  ],
  warehouse: [
    "ליקוט הזמנות וסטטוס משלוחים",
    "בדיקת מלאי, העברות ומדבקות ברקוד",
    "בלי מחירים, הכנסות והגדרות",
  ],
  agent: ["הלקוחות וההזמנות שלו", "באזור הסוכן (/agent)"],
};

const ROLE_ICON: Record<StaffRole, typeof Crown> = {
  owner: Crown,
  manager: ShieldCheck,
  cashier: UserCog,
  warehouse: UserCog,
  agent: Users,
};

const ROLE_ORDER: Record<StaffRole, number> = {
  owner: 0,
  manager: 1,
  cashier: 2,
  warehouse: 3,
  agent: 4,
};

function displayName(row: StaffRow): string {
  return row.display_name?.trim() || row.username || row.email;
}

/**
 * חלק 33: "צוות והרשאות" (/admin/settings/staff) — כל אנשי הצוות של החנות
 * והתפקיד של כל אחד. בעל החנות / מנהל מוסיפים עובד ובוחרים לו תפקיד, ומשנים
 * תפקיד בכל רגע. מנהלים — רק בעל החנות. הכללים נאכפים גם בשרת ובמסד
 * (store_set_staff_role).
 */
export function StaffPanel({ meId, myRole }: { meId: string; myRole: StaffRole | null }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<StaffRow | null>(null);
  const removeUser = useServerFn(deleteUserAccount);
  const canManagers = staffCan(myRole, "staff.managers");
  const { seats, reload: reloadSeats } = useStoreAdminSeats(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, email, username, display_name, role, is_protected, is_blocked, created_at")
      .neq("role", "customer")
      .order("created_at");
    if (error) toast.error(error.message);
    setRows((data as StaffRow[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const staff = useMemo(
    () =>
      rows
        .map((row) => ({ row, staffRole: staffRoleOf(row.role, row.is_protected) }))
        .filter((item): item is { row: StaffRow; staffRole: StaffRole } => item.staffRole !== null)
        .sort(
          (a, b) =>
            ROLE_ORDER[a.staffRole] - ROLE_ORDER[b.staffRole] ||
            displayName(a.row).localeCompare(displayName(b.row), "he"),
        ),
    [rows],
  );

  const changeRole = async (row: StaffRow, from: StaffRole, to: AssignableStaffRole) => {
    const problem = staffRoleChangeProblem({
      actor: myRole,
      actorId: meId,
      targetId: row.user_id,
      from,
      to,
    });
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusyId(row.user_id);
    const { error } = await supabase.rpc("store_set_staff_role", {
      _user_id: row.user_id,
      _staff_role: to,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${displayName(row)} — ${STAFF_ROLE_LABEL[to]}`);
    await load();
    if (from === "manager" || to === "manager") void reloadSeats();
  };

  const remove = async () => {
    if (!removing) return;
    setBusyId(removing.user_id);
    try {
      const result = await removeUser({ data: { userId: removing.user_id } });
      if (result.requiresConfirmation) {
        toast.error('לעובד יש הזמנות כלקוח — הסרה דרך מסך "משתמשים"');
      } else {
        toast.success(
          result.keptAccount
            ? `${displayName(removing)} הוסר/ה מהחנות (החשבון ממשיך לעבוד בחנויות האחרות)`
            : `${displayName(removing)} הוסר/ה מהצוות`,
        );
        setRemoving(null);
        await load();
        void reloadSeats();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ההסרה נכשלה");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-6" dir="rtl" data-testid="staff-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-xl text-foreground">צוות והרשאות</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            כל עובד רואה רק את מה שהתפקיד שלו מאפשר — קופאי לא רואה הכנסות והגדרות, ומחסנאי לא רואה
            מחירים. אפשר לשנות תפקיד בכל רגע.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
            רענון
          </Button>
          <CreateStaffAccountDialog
            onCreated={() => {
              void load();
              void reloadSeats();
            }}
            adminSeatsFull={seatsFull(seats)}
            canAddManagers={canManagers}
            defaultRole="cashier"
            triggerLabel="הוספת עובד"
          />
        </div>
      </div>

      {/* מה כל תפקיד יכול */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(["manager", "cashier", "warehouse", "agent"] as const).map((role) => {
          const Icon = ROLE_ICON[role];
          return (
            <Card key={role} className="shadow-card">
              <CardHeader className="space-y-1 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4 text-primary" aria-hidden="true" />
                  {STAFF_ROLE_LABEL[role]}
                </CardTitle>
                <CardDescription className="text-xs">
                  {STAFF_ROLE_DESCRIPTION[role]}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-0.5 ps-4 text-xs text-muted-foreground">
                  {ROLE_ABILITIES[role].map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!canManagers && (
        <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          מינוי מנהלים, שינוי תפקיד של מנהל והסרת מנהל — רק בעל החנות.
        </p>
      )}

      <Card className="shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="size-5" aria-hidden="true" />
            אנשי הצוות
            <span className="numeric rounded-full bg-secondary px-2 text-xs font-bold">
              {staff.length}
            </span>
          </CardTitle>
          {seats && (
            <CardDescription>
              מנהלים בחבילה: <span className="numeric">{seats.used}</span> מתוך{" "}
              <span className="numeric">{seats.limit}</span> (בעל החנות כלול). קופאים, מחסנאים
              וסוכנים — ללא הגבלה.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              טוען…
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {staff.map(({ row, staffRole }) => {
                const Icon = ROLE_ICON[staffRole];
                const isMe = row.user_id === meId;
                const locked = staffRole === "owner" || isMe;
                const canRemove = !locked && (staffRole !== "manager" || canManagers);
                return (
                  <li
                    key={row.user_id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                    data-testid="staff-row"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full",
                          staffRole === "owner"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                            : "bg-secondary text-foreground",
                        )}
                        aria-hidden="true"
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <span className="truncate">{displayName(row)}</span>
                          {isMe && <Badge variant="secondary">זה את/ה</Badge>}
                          {row.is_blocked && (
                            <Badge variant="destructive" className="gap-1">
                              <Ban className="size-3" aria-hidden="true" />
                              חסום
                            </Badge>
                          )}
                        </p>
                        <p dir="ltr" className="truncate text-right text-xs text-muted-foreground">
                          {row.email}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:w-auto">
                      {locked ? (
                        <Badge
                          variant="outline"
                          className="h-9 min-w-40 justify-center gap-1 px-3 text-sm"
                          data-testid="staff-role-fixed"
                        >
                          {staffRole === "owner" && (
                            <Crown className="size-3.5" aria-hidden="true" />
                          )}
                          {STAFF_ROLE_LABEL[staffRole]}
                        </Badge>
                      ) : (
                        <Select
                          value={staffRole}
                          onValueChange={(next) =>
                            void changeRole(row, staffRole, next as AssignableStaffRole)
                          }
                          disabled={busyId === row.user_id}
                        >
                          <SelectTrigger
                            dir="rtl"
                            className="w-full min-w-40 sm:w-44"
                            aria-label={`התפקיד של ${displayName(row)}`}
                            data-testid="staff-role-select"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent dir="rtl">
                            {ASSIGNABLE_STAFF_ROLES.map((role) => {
                              const problem = staffRoleChangeProblem({
                                actor: myRole,
                                actorId: meId,
                                targetId: row.user_id,
                                from: staffRole,
                                to: role,
                              });
                              return (
                                <SelectItem key={role} value={role} disabled={problem !== null}>
                                  {STAFF_ROLE_LABEL[role]}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      )}
                      {canRemove ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRemoving(row)}
                          disabled={busyId === row.user_id}
                          aria-label={`הסרת ${displayName(row)} מהצוות`}
                        >
                          {busyId === row.user_id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="size-4" aria-hidden="true" />
                          )}
                        </Button>
                      ) : (
                        <span className="w-9" aria-hidden="true" />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>
              הסרה מהצוות: {removing ? displayName(removing) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              העובד לא יוכל להיכנס לניהול של החנות. ההזמנות שהקליד נשארות (בלי השם שלו). חשבון
              שמשויך גם לחנויות אחרות — ממשיך לעבוד שם.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              הסרה
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
