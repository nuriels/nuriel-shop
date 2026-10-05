import { staffLabel, staffName } from "@/lib/staff";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Ban,
  Briefcase,
  Clock,
  KeyRound,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateCustomerDialog } from "@/components/CreateCustomerDialog";
import { InviteCustomerDialog } from "@/components/InviteCustomerDialog";
import { CreateStaffAccountDialog } from "@/components/CreateStaffAccountDialog";
import { CustomerFileDialog } from "@/components/CustomerFileDialog";
import { EditUserDialog } from "@/components/EditUserDialog";
import { ChangeRoleDialog } from "@/components/ChangeRoleDialog";
import { PasswordResetRequestsPanel } from "@/components/PasswordResetRequestsPanel";
import { deleteUserAccount, notifyCustomerAssigned } from "@/lib/admin.functions";
import { sendPasswordResetLink } from "@/lib/password.functions";
import { ROLE_LABEL } from "@/lib/admin";
import type { Role } from "@/hooks/useAuthState";
import { usePriceTiersEnabled } from "@/hooks/usePriceTiers";
import { PriceListTypeSelect } from "@/components/PriceListTypeSelect";
import type { PriceListType } from "@/lib/price-list";

type RoleRow = {
  user_id: string;
  email: string;
  username: string | null;
  role: Role;
  is_protected: boolean;
  is_approved: boolean;
  is_blocked: boolean;
  agent_number: string | null;
  display_name: string | null;
  created_at?: string;
};
type Profile = {
  user_id: string;
  business_name: string;
  business_address: string;
  contact_name: string;
  phone: string;
  price_tier: number | null;
  price_list_type: string | null;
  agent_id: string | null;
};
type TierChoice = "" | "none" | "1" | "2" | "3";
type PendingDelete = { user: RoleRow; orderCount: number };

function tierToChoice(tier: number | null | undefined): TierChoice {
  if (tier === null || tier === undefined) return "none";
  return String(tier) as TierChoice;
}

type UserGroup = "customers" | "pending" | "blocked" | "agents" | "admins";

const USER_GROUPS: {
  id: UserGroup;
  label: string;
  hint: string;
  empty: string;
  icon: typeof Store;
  /** קו מפריד לפני הפריט — בין קבוצות הלקוחות לקבוצות הצוות */
  divider?: boolean;
}[] = [
  {
    id: "customers",
    label: "לקוחות",
    hint: "לקוחות מאושרים. כאן קובעים מי מטפל בכל לקוח.",
    empty: "אין עדיין לקוחות מאושרים.",
    icon: Store,
  },
  {
    id: "pending",
    label: "ממתינים לאישור",
    hint: 'לקוחות שנרשמו בעצמם. אחרי "אישור" הלקוח רואה מחירים ויכול להזמין. עובד שנרשם בטעות כלקוח? "שינוי תפקיד" מעביר אותו לסוכנים.',
    empty: "אין לקוחות שממתינים לאישור.",
    icon: Clock,
  },
  {
    id: "blocked",
    label: "לקוחות חסומים",
    hint: 'לקוחות חסומים רואים הודעת חסימה במקום הקטלוג ולא יכולים להזמין. "שחרור" מחזיר אותם לפעילות.',
    empty: "אין לקוחות חסומים.",
    icon: Ban,
  },
  {
    id: "agents",
    label: "סוכנים",
    hint: "סוכנים מטפלים בלקוחות שמשויכים אליהם. מספר הסוכן מוקצה אוטומטית ואפשר לשנות אותו כאן.",
    empty: "אין עדיין סוכנים.",
    icon: Briefcase,
    divider: true,
  },
  {
    id: "admins",
    label: "מנהלים",
    hint: "למנהלים גישה מלאה לכל המערכת. המנהל הראשי מוגן, ואי אפשר לחסום אותו או לשנות לו הרשאות.",
    empty: "אין מנהלים נוספים.",
    icon: ShieldCheck,
  },
];

function groupOf(user: { role: Role; is_approved: boolean; is_blocked: boolean }): UserGroup {
  if (user.role === "admin") return "admins";
  if (user.role === "agent") return "agents";
  if (user.is_blocked) return "blocked";
  if (!user.is_approved) return "pending";
  return "customers";
}

/** סרגל הקבוצות מימין — אותו סגנון כמו עץ הקטגוריות */
function UserGroupNav({
  value,
  counts,
  onChange,
}: {
  value: UserGroup;
  counts: Record<UserGroup, number>;
  onChange: (next: UserGroup) => void;
}) {
  return (
    <nav aria-label="קבוצות משתמשים" className="space-y-0.5">
      {USER_GROUPS.map((item) => {
        const active = value === item.id;
        const Icon = item.icon;
        const attention = item.id === "pending" && counts.pending > 0;
        return (
          <div key={item.id}>
            {item.divider && <div className="mx-2 my-2 border-t border-border" aria-hidden />}
            <button
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={active ? "true" : undefined}
              className={`flex w-full items-center justify-between gap-2 rounded-md border-s-[3px] py-2 pe-2 ps-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "border-accent bg-secondary font-semibold text-foreground"
                  : "border-transparent text-foreground/85 hover:bg-secondary/60"
              }`}
            >
              <span className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                {item.label}
              </span>
              <span
                className={`numeric min-w-6 rounded-full px-1.5 text-center text-xs ${
                  attention
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {counts[item.id]}
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

/** ניהול משתמשים — אישור/חסימה/מחיקה, איפוס סיסמה, קבוצת מחיר ושיוך סוכן */
export function AdminUsersPanel({ isAdmin }: { isAdmin: boolean }) {
  const tiersEnabled = usePriceTiersEnabled();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [term, setTerm] = useState("");
  const [usernameTerm, setUsernameTerm] = useState("");
  // בחירת קבוצת מחיר עבור לקוחות שטרם אושרו — לא נשמרת עד לחיצה על "אישור"
  // (שדה חובה: אי אפשר לאשר בלי לבחור, כולל "ללא קבוצה" במפורש).
  const [pendingTier, setPendingTier] = useState<Record<string, TierChoice>>({});
  // סוג מחירון שנבחר לממתין — ברירת מחדל "מחירון רגיל"
  const [pendingPriceList, setPendingPriceList] = useState<Record<string, PriceListType>>({});
  const [agentNumberDraft, setAgentNumberDraft] = useState<Record<string, string>>({});
  const [group, setGroup] = useState<UserGroup | null>(null);

  const sendResetLink = useServerFn(sendPasswordResetLink);
  const notifyAssigned = useServerFn(notifyCustomerAssigned);
  const deleteUser = useServerFn(deleteUserAccount);

  const load = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [rolesResult, profilesResult] = await Promise.all([
      supabase
        .from("user_roles")
        .select(
          "user_id, email, username, role, is_approved, is_blocked, is_protected, agent_number, display_name, created_at",
        )
        .order("created_at"),
      supabase
        .from("customer_profiles")
        .select(
          "user_id, business_name, business_address, contact_name, phone, price_tier, price_list_type, agent_id",
        ),
    ]);
    if (rolesResult.error) toast.error(rolesResult.error.message);
    setRoles((rolesResult.data as RoleRow[] | null) ?? []);
    setProfiles(
      Object.fromEntries(
        ((profilesResult.data as Profile[] | null) ?? []).map((p) => [p.user_id, p]),
      ),
    );
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const agents = roles.filter((r) => r.role === "agent");
  const agentOptions = agents.map((agent) => ({
    user_id: agent.user_id,
    label: staffLabel(agent),
  }));
  // שיוך לקוח: גם לסוכן וגם ישירות למנהל (למשל לקוח שהמנהל מטפל בו בעצמו)
  const handlers = roles.filter((r) => r.role === "agent" || r.role === "admin");
  const handlerOptions = handlers.map((h) => ({
    user_id: h.user_id,
    label:
      h.role === "admin"
        ? `מנהל · ${h.email}`
        : h.agent_number
          ? `${h.agent_number} · ${h.email}`
          : h.email,
  }));

  /**
   * חיפוש כללי סורק אימייל, שם משתמש, שם עסק, איש קשר, טלפון וח.פ;
   * שדה החיפוש השני מצמצם לשם המשתמש בלבד.
   */
  const query = term.trim().toLowerCase();
  const usernameQuery = usernameTerm.trim().toLowerCase();
  const matches = (user: RoleRow): boolean => {
    const profile = profiles[user.user_id];
    if (usernameQuery !== "" && !(user.username ?? "").toLowerCase().includes(usernameQuery))
      return false;
    if (query === "") return true;
    return [
      user.email,
      user.username ?? "",
      user.agent_number ?? "",
      profile?.business_name ?? "",
      profile?.business_address ?? "",
      profile?.contact_name ?? "",
      profile?.phone ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  };

  // כל משתמש שייך לקבוצה אחת בדיוק בסרגל הצד
  const groupCounts = useMemo(() => {
    const counts: Record<UserGroup, number> = {
      customers: 0,
      pending: 0,
      blocked: 0,
      agents: 0,
      admins: 0,
    };
    for (const user of roles) counts[groupOf(user)] += 1;
    return counts;
  }, [roles]);
  // ברירת מחדל: אם יש ממתינים לאישור — מתחילים שם, כי זה מה שדורש טיפול
  const activeGroup: UserGroup = group ?? (groupCounts.pending > 0 ? "pending" : "customers");
  const activeInfo = USER_GROUPS.find((item) => item.id === activeGroup)!;
  const visibleUsers = roles.filter((r) => groupOf(r) === activeGroup && matches(r));

  const run = async (
    userId: string,
    // בונה השאילתה של supabase הוא "thenable" ולא Promise מלא
    action: () => PromiseLike<{ error: { message: string } | null }>,
    success: string,
  ) => {
    setBusy(userId);
    const { error } = await action();
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(success);
    void load();
  };

  /** אישור לקוח שנרשם עצמאית — תמיד יחד עם קביעת קבוצת המחיר שנבחרה */
  const approveWithTier = async (userId: string) => {
    // דרגים רדומים: כל לקוח מאושר נכנס לדרג 1 (המסד גם אוכף זאת)
    const choice = tiersEnabled ? pendingTier[userId] : "1";
    if (!choice) return; // הכפתור חסום לפני בחירה — הגנה כפולה
    setBusy(userId);
    const tierValue = choice === "none" ? null : Number(choice);
    const priceListType = pendingPriceList[userId] ?? "regular";
    const { error: profileError } = await supabase
      .from("customer_profiles")
      .update({ price_tier: tierValue, price_list_type: priceListType })
      .eq("user_id", userId);
    if (profileError) {
      setBusy(null);
      toast.error(profileError.message);
      return;
    }
    const { error: roleError } = await supabase
      .from("user_roles")
      .update({ is_approved: true })
      .eq("user_id", userId);
    setBusy(null);
    if (roleError) {
      toast.error(roleError.message);
      return;
    }
    toast.success(
      tiersEnabled ? "הלקוח אושר וקבוצת המחיר נקבעה" : "הלקוח אושר ויראה מחירים מעכשיו",
    );
    setPendingTier((current) => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
    void load();
  };

  /** שליחת קישור איפוס חד-פעמי (3 שעות) למייל של המשתמש */
  const resetPassword = async (user: RoleRow) => {
    setBusy(user.user_id);
    try {
      await sendResetLink({ data: { userId: user.user_id } });
      toast.success(`נשלח קישור לקביעת סיסמה חדשה אל ${user.email}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת הקישור נכשלה");
    } finally {
      setBusy(null);
    }
  };

  /** תזכורת התחברות — למקרה שהמשתמש שכח שיש לו חשבון או איך נכנסים */
  const sendLoginLink = async (user: RoleRow) => {
    setBusy(user.user_id);
    try {
      await sendResetLink({ data: { userId: user.user_id, purpose: "login_link" } });
      toast.success(`נשלח קישור כניסה אל ${user.email}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת הקישור נכשלה");
    } finally {
      setBusy(null);
    }
  };

  /**
   * מחיקה בשני שלבים: קריאה ראשונה בודקת הרשאות והיסטוריה. אם ללקוח יש
   * הזמנות — מוצג אישור מפורש, כי המחיקה תמחק גם אותן.
   */
  const requestDelete = async (user: RoleRow) => {
    setBusy(user.user_id);
    try {
      const result = await deleteUser({ data: { userId: user.user_id, force: false } });
      if (result.requiresConfirmation) {
        setPendingDelete({ user, orderCount: result.orderCount });
        return;
      }
      toast.success(
        result.keptAccount
          ? "המשתמש הוסר מהחנות הזו (החשבון שלו ממשיך לפעול בחנויות האחרות שלו)"
          : "המשתמש נמחק מהמערכת",
      );
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "מחיקת המשתמש נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { user } = pendingDelete;
    setBusy(user.user_id);
    setPendingDelete(null);
    try {
      await deleteUser({ data: { userId: user.user_id, force: true } });
      toast.success("המשתמש וההזמנות שלו נמחקו");
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "מחיקת המשתמש נכשלה");
    } finally {
      setBusy(null);
    }
  };

  /** שינוי גורם הטיפול בלקוח — שומר את השיוך ומודיע למי שקיבל את הלקוח */
  const updateHandler = async (customerId: string, agentId: string) => {
    setBusy(customerId);
    const { error } = await supabase
      .from("customer_profiles")
      .update({ agent_id: agentId === "none" ? null : agentId })
      .eq("user_id", customerId);
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("שיוך הטיפול עודכן");
    if (agentId !== "none") {
      try {
        await notifyAssigned({ data: { customerId } });
      } catch {
        // כשל בשליחת מייל ההתראה לא מבטל את השיוך — הוא כבר נשמר
      }
    }
    void load();
  };

  const saveAgentNumber = async (user: RoleRow) => {
    const next = (agentNumberDraft[user.user_id] ?? "").trim();
    if (next === (user.agent_number ?? "")) return;
    await run(
      user.user_id,
      () =>
        supabase
          .from("user_roles")
          .update({ agent_number: next || null })
          .eq("user_id", user.user_id),
      "מספר הסוכן עודכן",
    );
  };

  /** מעבר ללשונית החדשה אחרי שינוי תפקיד, כדי שיראו מיד לאן המשתמש עבר */
  const roleChanged = (next: Role) => {
    setGroup(next === "admin" ? "admins" : next === "agent" ? "agents" : "customers");
    void load();
  };

  const renderStaffRow = (user: RoleRow) => (
    <div
      key={user.user_id}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
    >
      <span className="min-w-56 flex-1 basis-56">
        <span className="block truncate text-sm font-semibold text-foreground">
          {user.display_name?.trim() || (
            <span className="font-normal text-destructive">חסר שם בעברית — להוסיף ב"עריכה"</span>
          )}
        </span>
        <span dir="ltr" className="block truncate text-right text-xs text-muted-foreground">
          {user.username ? `${user.username} · ` : ""}
          {user.email}
        </span>
      </span>
      <Badge variant={user.role === "admin" ? "default" : "secondary"}>
        {ROLE_LABEL[user.role]}
      </Badge>
      <Badge variant={user.is_blocked ? "destructive" : "outline"}>
        {user.is_blocked ? "חסום" : "פעיל"}
      </Badge>

      {user.role === "agent" && (
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`agent-number-${user.user_id}`} className="text-xs text-muted-foreground">
            מספר סוכן
          </Label>
          <Input
            id={`agent-number-${user.user_id}`}
            dir="ltr"
            className="numeric h-9 w-24 text-center"
            value={agentNumberDraft[user.user_id] ?? user.agent_number ?? ""}
            onChange={(e) =>
              setAgentNumberDraft((current) => ({
                ...current,
                [user.user_id]: e.target.value,
              }))
            }
            onBlur={() => void saveAgentNumber(user)}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <ChangeRoleDialog
          userId={user.user_id}
          name={staffName(user)}
          currentRole={user.role}
          isProtected={user.is_protected}
          onChanged={(next) => roleChanged(next)}
        />
        <EditUserDialog
          userId={user.user_id}
          label={user.email}
          currentRole={user.role}
          currentAgentNumber={user.agent_number}
          currentDisplayName={user.display_name}
          isProtected={user.is_protected}
          canManageRole={true}
          agents={agentOptions}
          onSaved={load}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy === user.user_id}
          onClick={() => void resetPassword(user)}
        >
          <KeyRound className="size-4" />
          איפוס סיסמה
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy === user.user_id}
          onClick={() => void sendLoginLink(user)}
        >
          <Mail className="size-4" />
          שליחת קישור כניסה
        </Button>
        <Button
          size="sm"
          variant={user.is_blocked ? "default" : "outline"}
          disabled={busy === user.user_id}
          onClick={() =>
            run(
              user.user_id,
              () =>
                supabase
                  .from("user_roles")
                  .update({ is_blocked: !user.is_blocked })
                  .eq("user_id", user.user_id),
              user.is_blocked ? "המשתמש שוחרר" : "המשתמש נחסם",
            )
          }
        >
          {user.is_blocked ? <UserCheck className="size-4" /> : <UserX className="size-4" />}
          {user.is_blocked ? "שחרור" : "חסימה"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={busy === user.user_id}
          onClick={() => void requestDelete(user)}
        >
          <Trash2 className="size-4" />
          מחיקה
        </Button>
      </div>
    </div>
  );

  const renderCustomerRow = (user: RoleRow) => {
    const profile = profiles[user.user_id];
    const isPending = !user.is_approved && !user.is_blocked;
    const currentChoice = pendingTier[user.user_id] ?? "";
    return (
      <div key={user.user_id} className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {profile?.business_name ?? user.email}
          </span>
          <Badge
            variant={user.is_blocked ? "destructive" : user.is_approved ? "secondary" : "outline"}
          >
            {user.is_blocked ? "חסום" : user.is_approved ? "מאושר" : "ממתין לאישור"}
          </Badge>
          {profile?.price_list_type === "custom" && (
            <Badge className="bg-amber-500 text-white hover:bg-amber-500">מחירון אישי</Badge>
          )}
        </div>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {profile?.business_address && <p>{profile.business_address}</p>}
          {(profile?.contact_name || profile?.phone) && (
            <p>
              {profile?.contact_name}
              {profile?.contact_name && profile?.phone ? " · " : ""}
              <span dir="ltr">{profile?.phone}</span>
            </p>
          )}
          <p dir="ltr" className="text-right">
            {user.email}
            {user.username ? ` · ${user.username}` : ""}
          </p>
        </div>

        {isPending && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary p-2">
            {tiersEnabled && (
              <>
                <Label className="text-xs font-medium">
                  קבוצת מחיר לפני אישור <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={currentChoice}
                  onValueChange={(v) =>
                    setPendingTier((cur) => ({ ...cur, [user.user_id]: v as TierChoice }))
                  }
                >
                  <SelectTrigger
                    dir="rtl"
                    className={`h-9 w-44 ${currentChoice === "" ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="חובה לבחור..." />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="none">ללא קבוצה (הצעת מחיר בלבד)</SelectItem>
                    <SelectItem value="1">דרג 1</SelectItem>
                    <SelectItem value="2">דרג 2</SelectItem>
                    <SelectItem value="3">דרג 3</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}
            <Label className="text-xs font-medium">סוג מחירון</Label>
            <PriceListTypeSelect
              compact
              showLabel={false}
              value={pendingPriceList[user.user_id] ?? "regular"}
              onChange={(v) => setPendingPriceList((cur) => ({ ...cur, [user.user_id]: v }))}
            />
            <Button
              size="sm"
              disabled={busy === user.user_id || (tiersEnabled && currentChoice === "")}
              onClick={() => approveWithTier(user.user_id)}
            >
              <UserCheck className="size-4" />
              אישור
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <CustomerFileDialog userId={user.user_id} label={profile?.business_name || user.email} />
          <ChangeRoleDialog
            userId={user.user_id}
            name={profile?.business_name || user.email}
            currentRole={user.role}
            isProtected={user.is_protected}
            onChanged={(next) => roleChanged(next)}
          />
          <EditUserDialog
            userId={user.user_id}
            label={profile?.business_name || user.email}
            currentRole={user.role}
            currentAgentNumber={user.agent_number}
            currentDisplayName={user.display_name}
            isProtected={user.is_protected}
            canManageRole={true}
            agents={agentOptions}
            onSaved={load}
          />
          <Button
            size="sm"
            variant={user.is_blocked ? "default" : "outline"}
            disabled={busy === user.user_id}
            onClick={() =>
              run(
                user.user_id,
                () =>
                  supabase
                    .from("user_roles")
                    .update({ is_blocked: !user.is_blocked })
                    .eq("user_id", user.user_id),
                user.is_blocked ? "הלקוח שוחרר" : "הלקוח נחסם",
              )
            }
          >
            {user.is_blocked ? <UserCheck className="size-4" /> : <UserX className="size-4" />}
            {user.is_blocked ? "שחרור" : "חסימה"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy === user.user_id}
            onClick={() => void resetPassword(user)}
          >
            <KeyRound className="size-4" />
            איפוס סיסמה
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy === user.user_id}
            onClick={() => void sendLoginLink(user)}
          >
            <Mail className="size-4" />
            שליחת קישור כניסה
          </Button>

          {!isPending && tiersEnabled && (
            <Select
              value={tierToChoice(profile?.price_tier)}
              onValueChange={(v) =>
                run(
                  user.user_id,
                  () =>
                    supabase
                      .from("customer_profiles")
                      .update({ price_tier: v === "none" ? null : Number(v) })
                      .eq("user_id", user.user_id),
                  "קבוצת המחיר עודכנה",
                )
              }
            >
              <SelectTrigger dir="rtl" className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="none">ללא קבוצה (הצעת מחיר בלבד)</SelectItem>
                <SelectItem value="1">דרג 1</SelectItem>
                <SelectItem value="2">דרג 2</SelectItem>
                <SelectItem value="3">דרג 3</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Select
            value={profile?.agent_id ?? "none"}
            onValueChange={(v) => void updateHandler(user.user_id, v)}
          >
            <SelectTrigger dir="rtl" className="h-9 w-44">
              <SelectValue placeholder="ללא טיפול משויך" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="none">ללא טיפול משויך</SelectItem>
              {handlerOptions.map((h) => (
                <SelectItem key={h.user_id} value={h.user_id}>
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy === user.user_id}
            onClick={() => void requestDelete(user)}
          >
            <Trash2 className="size-4" />
            מחיקה
          </Button>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-6">
      <PasswordResetRequestsPanel />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-foreground">ניהול משתמשים</h2>
          <p className="text-sm text-muted-foreground">
            {loading ? "טוען..." : `${roles.length} משתמשים במערכת`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            רענון נתונים
          </Button>
          <CreateStaffAccountDialog onCreated={load} />
          <InviteCustomerDialog handlers={handlerOptions} />
          <CreateCustomerDialog
            agents={handlers.map((h) => ({
              user_id: h.user_id,
              email: h.role === "admin" ? `מנהל · ${staffName(h)}` : staffLabel(h),
            }))}
            onCreated={load}
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_16rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="חיפוש לפי שם עסק, איש קשר, אימייל, טלפון או ח.פ"
            aria-label="חיפוש משתמשים"
            className="pr-9"
          />
        </div>
        <Input
          value={usernameTerm}
          onChange={(e) => setUsernameTerm(e.target.value)}
          dir="ltr"
          placeholder="חיפוש לפי שם משתמש"
          aria-label="חיפוש לפי שם משתמש"
        />
      </div>

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <aside className="hidden lg:sticky lg:top-24 lg:block">
          <div className="rounded-xl border border-border bg-card p-3 shadow-card">
            <h3 className="mb-2 px-2 font-display text-lg text-foreground">משתמשים</h3>
            <UserGroupNav value={activeGroup} counts={groupCounts} onChange={setGroup} />
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden">
            {USER_GROUPS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setGroup(item.id)}
                aria-pressed={activeGroup === item.id}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                  activeGroup === item.id
                    ? "border-accent bg-secondary font-semibold text-foreground"
                    : "border-border bg-card text-foreground/85"
                }`}
              >
                {item.label}
                <span className="numeric text-xs text-muted-foreground">
                  {groupCounts[item.id]}
                </span>
              </button>
            ))}
          </div>

          <div>
            <h3 className="font-display text-xl text-foreground">{activeInfo.label}</h3>
            <p className="text-sm text-muted-foreground">{activeInfo.hint}</p>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">טוען משתמשים...</p>
          ) : visibleUsers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {query !== "" || usernameQuery !== ""
                ? "לא נמצאו משתמשים תואמים בקבוצה הזו"
                : activeInfo.empty}
            </p>
          ) : (
            <div className="space-y-3">
              {visibleUsers.map((user) =>
                user.role === "customer" ? renderCustomerRow(user) : renderStaffRow(user),
              )}
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את המשתמש וההזמנות שלו?</AlertDialogTitle>
            <AlertDialogDescription>
              ל{pendingDelete?.user.email} יש {pendingDelete?.orderCount} הזמנות במערכת. מחיקת
              המשתמש תמחק גם את כל ההזמנות והמסמכים שלו, וזו פעולה בלתי הפיכה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start">
            <AlertDialogAction onClick={() => void confirmDelete()}>מחיקה סופית</AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
