import { supabase } from "@/integrations/supabase/client";
import type { OrderStatus } from "@/lib/orders";

/** חלק 24: הצעות לחברת השילוח (אפשר גם להקליד אחרת) */
export const SHIPPING_PROVIDERS = [
  "דואר ישראל",
  "צ'יטה",
  "HFD",
  "UPS",
  "DHL",
  "FedEx",
  "שליח החנות",
];

export const TRACKING_URL_FORMAT = /^https?:\/\/\S+$/i;

/** שמירת פרטי השילוח (והסטטוס, אם השתנה) — המסד מנרמל ומחתים tracking_updated_at */
export async function saveOrderTracking(
  orderId: string,
  input: { status?: OrderStatus; provider: string; number: string; url: string },
): Promise<void> {
  const patch: {
    shipping_provider: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    status?: OrderStatus;
  } = {
    shipping_provider: input.provider.trim() || null,
    tracking_number: input.number.trim() || null,
    tracking_url: input.url.trim() || null,
  };
  if (input.status) patch.status = input.status;
  const { error } = await supabase.from("orders").update(patch).eq("id", orderId);
  if (error) throw error;
}
