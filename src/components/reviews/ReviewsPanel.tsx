import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  Check,
  EyeOff,
  Loader2,
  MessageSquareQuote,
  Package,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { StarRating } from "@/components/reviews/StarRating";
import {
  loadAdminReviews,
  loadReviewsEnabled,
  moderateReviews,
  saveReviewsEnabled,
} from "@/lib/reviews-data";
import {
  REVIEWS_CHANGED,
  formatReviewDate,
  type AdminReview,
  type AdminReviewStatus,
  type ReviewAction,
} from "@/lib/reviews";
import { cn } from "@/lib/utils";

const FILTERS: { value: AdminReviewStatus; label: string }[] = [
  { value: "pending", label: "ממתינות לאישור" },
  { value: "approved", label: "מאושרות (מוצגות באתר)" },
  { value: "all", label: "הכל" },
];

const ACTION_DONE: Record<ReviewAction, (n: number) => string> = {
  approve: (n) => (n === 1 ? "הביקורת אושרה ומוצגת באתר" : `${n} ביקורות אושרו ומוצגות באתר`),
  hide: (n) => (n === 1 ? "הביקורת הוסתרה מהאתר" : `${n} ביקורות הוסתרו מהאתר`),
  delete: (n) => (n === 1 ? "הביקורת נמחקה" : `${n} ביקורות נמחקו`),
};

/**
 * חלק 34: "ביקורות לקוחות" (/admin/marketing/reviews) — אישור חוות הדעת
 * לפני שהן מוצגות באתר. בעלים ומנהל חנות בלבד (נאכף גם במסד).
 * את הטקסט של הלקוח לא עורכים — מאשרים, מסתירים או מוחקים.
 */
export function ReviewsPanel() {
  const [status, setStatus] = useState<AdminReviewStatus>("pending");
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReviews(await loadAdminReviews(status));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "טעינת הביקורות נכשלה");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    setSelected(new Set());
    void load();
  }, [load]);

  useEffect(() => {
    void loadReviewsEnabled().then(setEnabled);
  }, []);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return reviews;
    return reviews.filter(
      (review) =>
        review.product_name.toLowerCase().includes(q) ||
        review.customer_name.toLowerCase().includes(q) ||
        review.content.toLowerCase().includes(q) ||
        (review.customer_email ?? "").toLowerCase().includes(q),
    );
  }, [reviews, term]);

  const run = async (ids: string[], action: ReviewAction) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const count = await moderateReviews(ids, action);
      toast.success(ACTION_DONE[action](count));
      setSelected(new Set());
      window.dispatchEvent(new Event(REVIEWS_CHANGED));
      await load();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (next: boolean) => {
    setEnabled(next);
    try {
      await saveReviewsEnabled(next);
      toast.success(next ? "הביקורות מוצגות באתר" : "הביקורות והטופס הוסתרו מהאתר");
    } catch (reason) {
      setEnabled(!next);
      toast.error(reason instanceof Error ? reason.message : "השמירה נכשלה");
    }
  };

  const selectedIds = filtered.filter((review) => selected.has(review.id)).map((r) => r.id);
  const allSelected = filtered.length > 0 && selectedIds.length === filtered.length;
  const pendingSelected = filtered
    .filter((r) => selected.has(r.id) && !r.is_approved)
    .map((r) => r.id);
  const approvedSelected = filtered
    .filter((r) => selected.has(r.id) && r.is_approved)
    .map((r) => r.id);

  return (
    <section className="space-y-5" dir="rtl" data-testid="reviews-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl text-foreground">
            <MessageSquareQuote className="size-5 text-accent" aria-hidden="true" />
            ביקורות לקוחות
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            ביקורת חדשה מוצגת בעמוד המוצר רק אחרי שאישרתם אותה. את הטקסט של הלקוח לא עורכים — אפשר
            לאשר, להסתיר או למחוק.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
          רענון
        </Button>
      </div>

      {enabled !== null && (
        <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card">
          <span className="space-y-0.5">
            <span className="block font-semibold">ביקורות וטופס "כתיבת ביקורת" בעמודי המוצר</span>
            <span className="block text-xs text-muted-foreground">
              כבוי — הכוכבים, הביקורות והטופס לא מוצגים באתר (הביקורות נשמרות).
            </span>
          </span>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => void toggleEnabled(next)}
            data-testid="reviews-enabled"
          />
        </label>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-1 rounded-lg bg-secondary p-1" role="tablist">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              role="tab"
              aria-selected={status === filter.value}
              onClick={() => setStatus(filter.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                status === filter.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`reviews-filter-${filter.value}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="חיפוש לפי מוצר, שם, אימייל או טקסט"
            className="pr-9"
            aria-label="חיפוש ביקורת"
          />
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={allSelected ? true : selectedIds.length > 0 ? "indeterminate" : false}
              onCheckedChange={(on) =>
                setSelected(on === true ? new Set(filtered.map((r) => r.id)) : new Set())
              }
              aria-label="סימון הכל"
            />
            {selectedIds.length > 0 ? `נבחרו ${selectedIds.length}` : "סימון הכל"}
          </label>
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={busy || pendingSelected.length === 0}
            onClick={() => void run(pendingSelected, "approve")}
            data-testid="reviews-approve-selected"
          >
            <Check className="size-4" aria-hidden="true" />
            אישור המסומנות
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || approvedSelected.length === 0}
            onClick={() => void run(approvedSelected, "hide")}
          >
            <EyeOff className="size-4" aria-hidden="true" />
            הסתרה
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy || selectedIds.length === 0}
            onClick={() => setDeleting(selectedIds)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            מחיקה
          </Button>
        </div>
      )}

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : loading && reviews.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          טוען ביקורות…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <MessageSquareQuote className="size-8 text-muted-foreground/60" aria-hidden="true" />
            {term.trim()
              ? "לא נמצאה ביקורת מתאימה"
              : status === "pending"
                ? "אין ביקורות שממתינות לאישור"
                : "אין עדיין ביקורות"}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="reviews-admin-list">
          {filtered.map((review) => (
            <li
              key={review.id}
              className={cn(
                "flex gap-3 rounded-xl border bg-card p-4 shadow-card",
                review.is_approved ? "border-border" : "border-amber-300 dark:border-amber-700",
              )}
              data-testid="review-admin-item"
            >
              <Checkbox
                checked={selected.has(review.id)}
                onCheckedChange={(on) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (on === true) next.add(review.id);
                    else next.delete(review.id);
                    return next;
                  })
                }
                aria-label={`סימון הביקורת של ${review.customer_name}`}
                className="mt-1"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/product/$productId"
                    params={{ productId: review.product_id }}
                    target="_blank"
                    className="flex min-w-0 items-center gap-2 font-semibold hover:underline"
                  >
                    <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border bg-secondary">
                      {review.product_image_url ? (
                        <img
                          src={review.product_image_url}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <Package className="size-4 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <span className="truncate">{review.product_name}</span>
                  </Link>
                  {review.product_hidden && <Badge variant="outline">מוצר מוסתר</Badge>}
                  <Badge
                    variant={review.is_approved ? "secondary" : "outline"}
                    className={cn(
                      !review.is_approved && "border-amber-400 text-amber-800 dark:text-amber-200",
                    )}
                  >
                    {review.is_approved ? "מוצגת באתר" : "ממתינה לאישור"}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <StarRating value={review.rating} size="sm" />
                  <span className="font-medium">{review.customer_name}</span>
                  {review.verified_purchase && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <BadgeCheck className="size-3.5" aria-hidden="true" />
                      רכישה מאומתת
                    </span>
                  )}
                  {review.customer_email && (
                    <span dir="ltr" className="text-xs text-muted-foreground">
                      {review.customer_email}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatReviewDate(review.created_at)}
                  </span>
                </div>
                <p className="whitespace-pre-line break-words text-sm leading-6">
                  {review.content}
                </p>
                {review.is_approved && review.approved_by_name && (
                  <p className="text-xs text-muted-foreground">
                    אושרה ע"י {review.approved_by_name}
                    {review.approved_at ? ` · ${formatReviewDate(review.approved_at)}` : ""}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {review.is_approved ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run([review.id], "hide")}
                      data-testid="review-hide"
                    >
                      <EyeOff className="size-4" aria-hidden="true" />
                      הסתרה מהאתר
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void run([review.id], "approve")}
                      data-testid="review-approve"
                    >
                      <Check className="size-4" aria-hidden="true" />
                      אישור והצגה באתר
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => setDeleting([review.id])}
                    data-testid="review-delete"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    מחיקה
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>
              {deleting && deleting.length > 1
                ? `מחיקת ${deleting.length} ביקורות`
                : "מחיקת הביקורת"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              המחיקה סופית. רוצים רק להוריד מהאתר? אפשר "הסתרה" — והביקורת נשמרת.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                const ids = deleting ?? [];
                setDeleting(null);
                void run(ids, "delete");
              }}
              data-testid="review-delete-confirm"
            >
              מחיקה
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
