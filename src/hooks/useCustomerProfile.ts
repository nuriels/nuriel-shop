import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CustomerProfile = {
  user_id: string;
  business_name: string;
  business_address: string | null;
  tax_id: string | null;
  contact_name: string | null;
  phone: string | null;
  /** null = ללא קבוצת מחיר משויכת ("אורח") — עד שמנהל/סוכן יקצו דרג במפורש */
  price_tier: 1 | 2 | 3 | null;
  agent_id: string | null;
  age_confirmed: boolean;
  /** false = הלקוח עדיין לא השלים את פרטי העסק בכניסה הראשונה */
  profile_completed: boolean;
};

/** פרופיל הלקוח המחובר (שדות עסקיים, קבוצת מחיר וסוכן משויך) */
export function useCustomerProfile(userId: string | null) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // עבור איזה משתמש הפרופיל שבזיכרון נטען — מונע "הבזק" של מסך ההשלמה
  // ברינדור שבין החלפת המשתמש לתחילת הטעינה
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (userId === null) {
      setProfile(null);
      setLoadedFor(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("customer_profiles")
      .select(
        "user_id, business_name, business_address, tax_id, contact_name, phone, price_tier, agent_id, age_confirmed, profile_completed",
      )
      .eq("user_id", userId)
      .maybeSingle();
    setProfile((data as CustomerProfile | null) ?? null);
    setLoadedFor(userId);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profile, loading: loading || loadedFor !== userId, refresh };
}
