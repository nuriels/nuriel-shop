import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "agent" | "customer" | "warehouse";

export type UserRole = {
  user_id: string;
  email: string;
  username: string;
  role: Role;
  is_approved: boolean;
  is_blocked: boolean;
  /** true = נכנס עם סיסמה זמנית וחייב לקבוע סיסמה קבועה */
  must_change_password: boolean;
  /** מנהל-על של הפלטפורמה (platform_admins) */
  is_platform_admin?: boolean;
  /** false = מנהל-על שמנהל את החנות בלי להיות רשום בצוות שלה (God Mode) */
  is_member?: boolean;
};

const ROLE_COLUMNS =
  "user_id, email, username, role, is_approved, is_blocked, must_change_password";

/**
 * התפקיד בחנות הנוכחית. my_store_role מחזיר גם מנהל-על שאינו רשום בחנות
 * (God Mode) — כמנהל מלא, בלי ליצור לו שורה בצוות של החנות.
 */
async function loadStoreRole(userId: string): Promise<UserRole | null | "missing"> {
  const { data, error } = await supabase.rpc("my_store_role").maybeSingle();
  if (!error) return data ? (data as UserRole) : "missing";
  // גיבוי (מסד בלי הפונקציה): קריאה ישירה של השורה
  const { data: row } = await supabase
    .from("user_roles")
    .select(ROLE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  return row ? { ...(row as UserRole), is_member: true } : "missing";
}

export function useAuthState() {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshRole = async () => {
    const user = session?.user;
    if (!user) {
      setRole(null);
      return;
    }
    const current = await loadStoreRole(user.id);
    if (current !== "missing") {
      setRole(current);
      return;
    }
    // כניסה ראשונה: רישום שורת תפקיד ממתינה לאישור (לקוח בלבד)
    await supabase
      .from("user_roles")
      .insert({ user_id: user.id, email: user.email ?? "", role: "customer", is_approved: false });
    const created = await loadStoreRole(user.id);
    setRole(created === "missing" ? null : created);
  };

  useEffect(() => {
    if (!session) {
      setRole(null);
      return;
    }
    setLoading(true);
    refreshRole().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  return { session, role, loading, refreshRole };
}
