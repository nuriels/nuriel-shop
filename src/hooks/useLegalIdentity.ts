import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BUSINESS_TYPE_LABELS, type BusinessType } from "@/lib/payments";

/** השם המשפטי ומספר העוסק / ח.פ של החנות — לעמוד "צור קשר" (חובת גילוי) */
export type LegalIdentity = {
  businessName: string;
  businessType: BusinessType | null;
  taxId: string;
};

/** "ח.פ" לחברה, "עוסק מורשה" / "עוסק פטור" לעוסק; לא ידוע — "ח.פ / ע.מ" */
export function taxIdCaption(type: BusinessType | null): string {
  if (type === "company") return "ח.פ";
  if (type === "licensed" || type === "exempt") return BUSINESS_TYPE_LABELS[type];
  return "ח.פ / ע.מ";
}

export function useLegalIdentity(): LegalIdentity | null {
  const [identity, setIdentity] = useState<LegalIdentity | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.rpc("store_legal_identity").then(({ data }) => {
      if (!alive || !data || typeof data !== "object" || Array.isArray(data)) return;
      const row = data as Record<string, unknown>;
      const type = row["business_type"];
      setIdentity({
        businessName: String(row["business_name"] ?? "").trim(),
        businessType: type === "company" || type === "licensed" || type === "exempt" ? type : null,
        taxId: String(row["tax_id"] ?? "").trim(),
      });
    });
    return () => {
      alive = false;
    };
  }, []);
  return identity;
}
