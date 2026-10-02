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
};

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
    const { data } = await supabase
      .from("user_roles")
      .select("user_id, email, username, role, is_approved, is_blocked, must_change_password")
      .eq("user_id", user.id)
      .maybeSingle();

    if (data) {
      setRole(data as UserRole);
      return;
    }
    // כניסה ראשונה: רישום שורת תפקיד ממתינה לאישור (לקוח בלבד)
    await supabase
      .from("user_roles")
      .insert({ user_id: user.id, email: user.email ?? "", role: "customer", is_approved: false });
    const { data: created } = await supabase
      .from("user_roles")
      .select("user_id, email, username, role, is_approved, is_blocked, must_change_password")
      .eq("user_id", user.id)
      .maybeSingle();
    setRole((created as UserRole | null) ?? null);
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
