import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * חלק 34: "כתוב ביקורת" בעמוד המוצר — פעולת שרת (לא ישירות מהדפדפן למסד):
 *  • הגבלת קצב לפי IP (5 ביקורות ב-15 דקות לחיבור), ולכל מוצר בנפרד.
 *  • שדה "מלכודת" נסתר (website): בוט שממלא אותו מקבל "נשלח" ושום דבר לא נשמר.
 *  • לקוח מחובר: החיבור שלו מאומת כאן (לא סומכים על מזהה מהדפדפן) — כך
 *    במסד נשמר מי כתב, ביקורת אחת למוצר, ו"רכישה מאומתת" אם הוא קנה.
 * השמירה עצמה — product_review_submit במסד (service_role), עם אותן בדיקות,
 * והביקורת נשמרת כ"ממתינה לאישור".
 */

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOO_MANY = "נשלחו יותר מדי ביקורות מהחיבור הזה. נסו שוב בעוד כמה דקות.";

export type SubmitReviewResult = {
  /** הביקורת התקבלה וממתינה לאישור */
  ok: true;
  verifiedPurchase: boolean;
};

/** הלקוח המחובר (אם יש) — לפי האסימון שהדפדפן שולח, מאומת מול שרת ההתחברות */
async function signedInUserId(): Promise<string | null> {
  const header = getRequest()?.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.split(".").length !== 3) return null;
  try {
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdminUnscoped.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export const submitProductReview = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      productId: string;
      name: string;
      rating: number;
      content: string;
      /** שדה מלכודת לבוטים — אמור להישאר ריק */
      website?: string;
    }) => {
      const productId = String(input?.productId ?? "").trim();
      if (!UUID_FORMAT.test(productId)) throw new Error("המוצר לא נמצא");
      return {
        productId,
        name: String(input?.name ?? "").slice(0, 200),
        rating: Math.trunc(Number(input?.rating)),
        content: String(input?.content ?? "").slice(0, 4000),
        website: String(input?.website ?? "").slice(0, 200),
      };
    },
  )
  .handler(async ({ data }): Promise<SubmitReviewResult> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`review:${ip}`, 5, 15 * 60 * 1000)) throw new Error(TOO_MANY);
    if (!allowAction(`review:${ip}:${data.productId}`, 2, 60 * 60 * 1000)) {
      throw new Error("כבר שלחתם ביקורת על המוצר הזה — היא ממתינה לאישור");
    }

    // בוט: נראה כאילו נשלח, בלי לשמור
    if (data.website.trim() !== "") return { ok: true, verifiedPurchase: false };

    const { normalizeReviewContent, normalizeReviewName, reviewDraftProblems } =
      await import("@/lib/reviews");
    const draft = {
      name: normalizeReviewName(data.name),
      rating: data.rating,
      content: normalizeReviewContent(data.content),
    };
    const problem = reviewDraftProblems(draft)[0];
    if (problem) throw new Error(problem);

    const userId = await signedInUserId();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: saved, error } = await supabaseAdmin.rpc("product_review_submit", {
      _product_id: data.productId,
      _customer_name: draft.name,
      _rating: draft.rating,
      _content: draft.content,
      _user_id: userId,
    });
    if (error) {
      // הודעות המסד בעברית (כבר כתבת / אינה פעילה / המוצר לא נמצא ...)
      if (/[֐-׿]/.test(error.message)) throw new Error(error.message);
      console.error("[reviews] submit failed", error.message);
      throw new Error("שליחת הביקורת נכשלה. נסו שוב בעוד רגע.");
    }
    const result = (saved ?? {}) as { verified_purchase?: boolean };
    return { ok: true, verifiedPurchase: result.verified_purchase === true };
  });
