import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  bitProofProblem,
  cleanBitReference,
  cleanReceiptName,
  isOrderId,
  receiptBytesMatch,
  receiptExtension,
  receiptProblem,
  type BitPaymentInfo,
  type PaymentStatus,
} from "@/lib/bit-payments";

/**
 * תשלום בביט (חלק 17ב) — פונקציות השרת.
 *
 *  getBitPayment    — עמוד /checkout/bit/<order_id>: מספר ההזמנה, הסכום, מספר
 *                     הביט של החנות ומצב התשלום (בלי פרטים אישיים). נטען מחדש
 *                     מהמסד בכל כניסה — גם אחרי שהדפדפן נסגר במעבר לאפליקציה.
 *  submitBitPayment — הלקוח שולח מספר אסמכתא ו/או צילום מסך (FormData). הקובץ
 *                     נבדק (סיומת + חתימת הקובץ) ונשמר בדלי פרטי, ההזמנה עוברת
 *                     ל"ממתינה לאישור תשלום", ונשלחים מיילי ההזמנה (sendOrderEmail
 *                     ללקוח + התראה לצוות).
 *  getBitReceipt    — מנהל החנות: קישור זמני לצילום המסך שבהזמנה.
 *
 * האישור / הדחייה של בעל החנות — RPC bit_payment_review (בדפדפן, בהרשאות שלו).
 * מזהה ההזמנה (UUID אקראי) הוא ה"מפתח" לעמוד; העמוד לא חושף שם, טלפון או
 * כתובת, ואפשר לשלוח פרטי תשלום פעם אחת בלבד.
 */

const TOO_MANY = "יותר מדי ניסיונות מהחיבור הזה. נסו שוב בעוד כמה דקות.";

type Raw = Record<string, unknown>;

function toInfo(raw: Raw): BitPaymentInfo {
  const str = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : null);
  return {
    orderId: String(raw["order_id"] ?? ""),
    orderNumber: String(raw["order_number"] ?? ""),
    amount: Number(raw["amount"] ?? 0),
    status: String(raw["status"] ?? ""),
    paymentStatus: String(raw["payment_status"] ?? "awaiting") as PaymentStatus,
    dueAt: str("payment_due_at"),
    reportedAt: str("reported_at"),
    paidAt: str("paid_at"),
    hasReference: raw["has_reference"] === true,
    hasReceipt: raw["has_receipt"] === true,
    bitPhone: str("bit_phone"),
    storeName: str("store_name"),
    storePhone: str("store_phone"),
    registered: raw["registered"] === true,
  };
}

async function loadInfo(orderId: string): Promise<BitPaymentInfo | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("bit_payment_info", { _order: orderId });
  if (error) throw new Error(error.message);
  return data && typeof data === "object" ? toInfo(data as Raw) : null;
}

export const getBitPayment = createServerFn({ method: "POST" })
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!isOrderId(orderId)) throw new Error("ההזמנה לא נמצאה");
    return { orderId };
  })
  .handler(async ({ data }): Promise<BitPaymentInfo | null> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`bit-info:${ip}`, 120, 15 * 60 * 1000)) throw new Error(TOO_MANY);
    return loadInfo(data.orderId);
  });

export type BitSubmitResult = {
  info: BitPaymentInfo | null;
  /** הפרטים כבר נשלחו קודם (לחיצה כפולה / רענון) — לא שונה דבר */
  already: boolean;
};

export const submitBitPayment = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => {
    if (!(data instanceof FormData)) throw new Error("בקשה לא תקינה");
    return data;
  })
  .handler(async ({ data }): Promise<BitSubmitResult> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`bit-submit:${ip}`, 10, 15 * 60 * 1000)) throw new Error(TOO_MANY);

    const orderId = String(data.get("orderId") ?? "").trim();
    if (!isOrderId(orderId)) throw new Error("ההזמנה לא נמצאה");
    const rawReference = data.get("reference");
    const reference = cleanBitReference(typeof rawReference === "string" ? rawReference : "");

    // צילום המסך (אופציונלי, אם יש אסמכתא)
    const rawFile = data.get("receipt");
    let receipt: {
      ext: NonNullable<ReturnType<typeof receiptExtension>>;
      bytes: Uint8Array;
      name: string;
    } | null = null;
    if (rawFile instanceof File && rawFile.size > 0) {
      const fileProblem = receiptProblem(rawFile);
      if (fileProblem) throw new Error(fileProblem);
      const ext = receiptExtension(rawFile.name)!;
      const bytes = new Uint8Array(await rawFile.arrayBuffer());
      if (!receiptBytesMatch(ext, bytes)) {
        throw new Error("תוכן הקובץ לא תואם לסוג שלו — צלמו מסך מחדש וצרפו שוב");
      }
      receipt = { ext, bytes, name: cleanReceiptName(rawFile.name) };
    }
    const proofProblem = bitProofProblem(reference, receipt !== null);
    if (proofProblem) throw new Error(proofProblem);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const receipts = await import("@/lib/bit-receipts.server");

    // ההזמנה קיימת ובאמת ממתינה לביט — לפני שמעלים קובץ
    const before = await loadInfo(orderId);
    if (!before) throw new Error("ההזמנה לא נמצאה");
    if (before.paymentStatus === "awaiting_verification" || before.paymentStatus === "paid") {
      return { info: before, already: true };
    }

    const path = receipt ? receipts.receiptPath(currentTenantId(), orderId, receipt.ext) : null;
    if (receipt && path) {
      try {
        await receipts.uploadReceipt(path, receipt.ext, receipt.bytes);
      } catch (error) {
        console.error("[bit] receipt upload failed", error);
        throw new Error(
          reference
            ? "העלאת צילום המסך נכשלה. נסו שוב, או שלחו רק את מספר האסמכתא."
            : "העלאת צילום המסך נכשלה. נסו שוב בעוד רגע.",
        );
      }
    }

    const { data: saved, error } = await supabaseAdmin.rpc("bit_payment_submit", {
      _order: orderId,
      _reference: reference || null,
      _receipt_path: path,
    });
    if (error) {
      if (path) await receipts.removeReceipt(path);
      throw new Error(error.message);
    }
    const result = (saved ?? {}) as Raw;
    const already = result["already"] === true;
    if (already && path) await receipts.removeReceipt(path);

    if (!already) {
      console.log(
        `[bit] payment reported for ${String(result["order_number"] ?? orderId)} (${reference ? "reference" : ""}${reference && path ? " + " : ""}${path ? "receipt" : ""})`,
      );
      // מיילי ההזמנה: אישור הזמנה ללקוח (sendOrderEmail, חלק 17א) והתראה
      // לצוות — עכשיו, כשההזמנה כבר לא "ממתינה לתשלום". ברקע: הלקוח מקבל את
      // מסך האישור מיד, בלי לחכות להפקת ה-PDF.
      const { sendOrderEmailsInternal } = await import("@/lib/order-emails.server");
      void sendOrderEmailsInternal(orderId, null).catch((emailError: unknown) => {
        console.error("[bit] order emails failed", orderId, emailError);
      });
    }

    return { info: await loadInfo(orderId), already };
  });

export type BitReceiptLinks = {
  viewUrl: string;
  downloadUrl: string;
  isImage: boolean;
  isPdf: boolean;
};

/** מנהל החנות: קישור זמני לצילום המסך של ההעברה בביט */
export const getBitReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!isOrderId(orderId)) throw new Error("ההזמנה לא נמצאה");
    return { orderId };
  })
  .handler(async ({ data, context }): Promise<BitReceiptLinks> => {
    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller.role !== "admin") throw new Error("רק מנהל החנות יכול לצפות בצילום ההעברה");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("order_number, bit_receipt_url")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order?.bit_receipt_url) throw new Error("אין צילום מסך בהזמנה הזו");

    const receipts = await import("@/lib/bit-receipts.server");
    const kind = receipts.receiptKind(order.bit_receipt_url);
    const links = await receipts.receiptUrls(
      order.bit_receipt_url,
      `bit-${order.order_number}.${kind.ext || "file"}`,
    );
    return { ...links, isImage: kind.isImage, isPdf: kind.isPdf };
  });
