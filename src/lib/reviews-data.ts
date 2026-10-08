/**
 * חלק 34: ביקורות לקוחות — גישה לנתונים מהדפדפן.
 *  • האתר: הביקורות המאושרות והסיכומים — פונקציות במסד, פתוחות לכולם
 *    (בלי מזהה הכותב).
 *  • הניהול: רשימה ואישור / הסתרה / מחיקה — בעלים ומנהל בלבד (נבדק במסד).
 *  • כתיבת ביקורת — דרך פעולת השרת submitProductReview (reviews.functions.ts).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  parseReviewSummary,
  REVIEWS_PAGE_SIZE,
  type AdminReview,
  type AdminReviewStatus,
  type PublicReview,
  type RatingSummary,
  type ReviewAction,
  type ReviewSummary,
} from "@/lib/reviews";

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function loadReviewSummary(productId: string): Promise<ReviewSummary> {
  const { data, error } = await supabase.rpc("product_review_summary", { _product_id: productId });
  if (error) throw new Error(error.message);
  return parseReviewSummary(data);
}

/** עמוד של ביקורות מאושרות (החדשות קודם) */
export async function loadProductReviews(
  productId: string,
  offset = 0,
  limit = REVIEWS_PAGE_SIZE,
): Promise<PublicReview[]> {
  const { data, error } = await supabase.rpc("product_reviews_public", {
    _product_id: productId,
    _limit: limit,
    _offset: offset,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    customer_name: row.customer_name,
    rating: num(row.rating),
    content: row.content,
    created_at: row.created_at,
    verified_purchase: row.verified_purchase === true,
  }));
}

// ------------------------------------------------------------
// הדירוג בכרטיסי הקטלוג: נטען פעם אחת לכל טעינת עמוד ומשותף לכל הכרטיסים
// ------------------------------------------------------------
let ratingsPromise: Promise<Map<string, RatingSummary>> | null = null;

export function loadRatingSummaries(force = false): Promise<Map<string, RatingSummary>> {
  if (ratingsPromise && !force) return ratingsPromise;
  ratingsPromise = (async () => {
    const { data, error } = await supabase.rpc("product_rating_summaries");
    // בלי דירוגים (מסד ישן / תקלה) — הקטלוג ממשיך לעבוד כרגיל
    if (error) return new Map<string, RatingSummary>();
    return new Map(
      (data ?? []).map((row) => [
        row.product_id,
        { count: num(row.review_count), average: num(row.average_rating) },
      ]),
    );
  })();
  return ratingsPromise;
}

// ------------------------------------------------------------
// ניהול
// ------------------------------------------------------------
export async function loadAdminReviews(status: AdminReviewStatus): Promise<AdminReview[]> {
  const { data, error } = await supabase.rpc("admin_product_reviews", { _status: status });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    product_id: row.product_id,
    product_name: row.product_name,
    product_image_url: row.product_image_url ?? null,
    product_hidden: row.product_hidden === true,
    customer_name: row.customer_name,
    customer_email: row.customer_email ?? null,
    rating: num(row.rating),
    content: row.content,
    is_approved: row.is_approved === true,
    verified_purchase: row.verified_purchase === true,
    created_at: row.created_at,
    approved_at: row.approved_at ?? null,
    approved_by_name: row.approved_by_name ?? null,
  }));
}

/** אישור / הסתרה / מחיקה — מחזיר כמה ביקורות עודכנו */
export async function moderateReviews(ids: string[], action: ReviewAction): Promise<number> {
  const { data, error } = await supabase.rpc("admin_review_moderate", {
    _ids: ids,
    _action: action,
  });
  if (error) throw new Error(error.message);
  return num(data);
}

/** כמה ביקורות ממתינות לאישור (לתג בתפריט הניהול) */
export async function countPendingReviews(): Promise<number> {
  const { count, error } = await supabase
    .from("product_reviews")
    .select("id", { count: "exact", head: true })
    .eq("is_approved", false);
  if (error) return 0;
  return count ?? 0;
}

export async function loadReviewsEnabled(): Promise<boolean> {
  const { data } = await supabase
    .from("site_settings")
    .select("reviews_enabled")
    .eq("id", true)
    .maybeSingle();
  return data?.reviews_enabled !== false;
}

export async function saveReviewsEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from("site_settings")
    .update({ reviews_enabled: enabled })
    .eq("id", true);
  if (error) throw new Error(error.message);
}
