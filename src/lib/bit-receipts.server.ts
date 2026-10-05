/**
 * צילומי מסך של העברות בביט (חלק 17ב) — צד שרת בלבד.
 *
 * דלי פרטי payment-receipts: <tenant_id>/<order_id>/receipt-<אקראי>.<סיומת>.
 * רק השרת (service role) כותב וקורא; מנהל החנות מקבל קישור זמני (5 דקות)
 * לצפייה / הורדה. המסד מוודא שהנתיב שנשמר בהזמנה נמצא בתיקייה של ההזמנה.
 */

import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import { RECEIPT_TYPES, type ReceiptExtension } from "@/lib/bit-payments";

export const PAYMENT_RECEIPTS_BUCKET = "payment-receipts";

/** <tenant_id>/<order_id>/receipt-<12 תווים אקראיים>.<ext> */
export function receiptPath(tenantId: string, orderId: string, ext: ReceiptExtension): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${tenantId}/${orderId}/receipt-${random}.${ext}`;
}

export async function uploadReceipt(
  path: string,
  ext: ReceiptExtension,
  bytes: Uint8Array,
): Promise<void> {
  const { error } = await supabaseAdminUnscoped.storage
    .from(PAYMENT_RECEIPTS_BUCKET)
    .upload(path, bytes, { contentType: RECEIPT_TYPES[ext], upsert: false });
  if (error) throw new Error(error.message);
}

export async function removeReceipt(path: string): Promise<void> {
  try {
    await supabaseAdminUnscoped.storage.from(PAYMENT_RECEIPTS_BUCKET).remove([path]);
  } catch (error) {
    console.error("[bit] failed to remove an orphan receipt", path, error);
  }
}

/** סוג הקובץ לפי הסיומת שבנתיב */
export function receiptKind(path: string): { ext: string; isImage: boolean; isPdf: boolean } {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  // HEIC לא מוצג ברוב הדפדפנים — רק הורדה
  return {
    ext,
    isImage: ["jpg", "jpeg", "png", "webp", "gif"].includes(ext),
    isPdf: ext === "pdf",
  };
}

/** קישורים זמניים (5 דקות): לצפייה בתוך הפאנל ולהורדה */
export async function receiptUrls(
  path: string,
  downloadName: string,
): Promise<{ viewUrl: string; downloadUrl: string }> {
  const bucket = supabaseAdminUnscoped.storage.from(PAYMENT_RECEIPTS_BUCKET);
  const [view, download] = await Promise.all([
    bucket.createSignedUrl(path, 300),
    bucket.createSignedUrl(path, 300, { download: downloadName }),
  ]);
  if (view.error || !view.data?.signedUrl || download.error || !download.data?.signedUrl) {
    throw new Error("יצירת הקישור לצילום המסך נכשלה");
  }
  return { viewUrl: view.data.signedUrl, downloadUrl: download.data.signedUrl };
}
