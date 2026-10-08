import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BadgeCheck, CheckCircle2, Loader2, MessageSquareQuote, PenLine, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StarInput, StarRating } from "@/components/reviews/StarRating";
import { submitProductReview } from "@/lib/reviews.functions";
import { loadProductReviews, loadReviewSummary } from "@/lib/reviews-data";
import {
  EMPTY_REVIEW_SUMMARY,
  REVIEW_LIMITS,
  REVIEWS_PAGE_SIZE,
  distributionPercent,
  formatAverage,
  formatReviewDate,
  reviewCountLabel,
  reviewDraftProblems,
  type PublicReview,
  type ReviewSummary,
} from "@/lib/reviews";

/**
 * חלק 34: "חוות דעת לקוחות" בעמוד המוצר — הוכחה חברתית.
 *  • סיכום: ממוצע הכוכבים, מספר הביקורות והתפלגות (5 → 1).
 *  • הביקורות המאושרות (החדשות קודם), עם "רכישה מאומתת" ללקוח שקנה.
 *  • "כתיבת ביקורת": דירוג + שם + טקסט → נשלח לאישור החנות (לא מתפרסם מיד).
 * כשהחנות כיבתה את הביקורות — לא מוצג כלום.
 */
export function ProductReviews({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [writing, setWriting] = useState(false);
  const [sent, setSent] = useState<{ verified: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextSummary, firstPage] = await Promise.all([
        loadReviewSummary(productId),
        loadProductReviews(productId, 0),
      ]);
      setSummary(nextSummary);
      setReviews(firstPage);
    } catch {
      // בלי ביקורות (מסד ישן / תקלה) — עמוד המוצר ממשיך לעבוד
      setSummary(EMPTY_REVIEW_SUMMARY);
      setReviews([]);
    }
  }, [productId]);

  useEffect(() => {
    setSummary(null);
    setReviews([]);
    setWriting(false);
    setSent(null);
    void load();
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await loadProductReviews(productId, reviews.length);
      setReviews((current) => [
        ...current,
        ...next.filter((r) => !current.some((c) => c.id === r.id)),
      ]);
    } finally {
      setLoadingMore(false);
    }
  };

  if (summary === null || !summary.enabled) return null;
  const hasMore = reviews.length < summary.count;

  return (
    <section
      id="reviews"
      aria-labelledby="reviews-title"
      className="scroll-mt-24 space-y-4"
      data-testid="product-reviews"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="reviews-title"
          className="flex items-center gap-2 font-display text-xl text-foreground"
        >
          <MessageSquareQuote className="size-5 text-accent" aria-hidden="true" />
          חוות דעת לקוחות
          {summary.count > 0 && (
            <span className="numeric rounded-full bg-secondary px-2 text-sm font-bold">
              {summary.count}
            </span>
          )}
        </h2>
        {!writing && !sent && (
          <Button variant="outline" onClick={() => setWriting(true)} data-testid="review-write">
            <PenLine className="size-4" aria-hidden="true" />
            כתיבת ביקורת
          </Button>
        )}
      </div>

      {summary.count > 0 && summary.average !== null ? (
        <Card className="shadow-card">
          <CardContent className="grid gap-5 p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:p-5">
            <div className="flex flex-col items-center gap-1 text-center sm:border-l sm:border-border sm:pl-6">
              <p
                className="numeric text-4xl font-black text-foreground"
                data-testid="reviews-average"
              >
                {formatAverage(summary.average)}
              </p>
              <StarRating value={summary.average} size="md" />
              <p className="text-xs text-muted-foreground">{reviewCountLabel(summary.count)}</p>
            </div>
            <ul className="space-y-1.5" aria-label="התפלגות הדירוגים">
              {([5, 4, 3, 2, 1] as const).map((stars) => {
                const percent = distributionPercent(summary, stars);
                return (
                  <li key={stars} className="flex items-center gap-2 text-xs">
                    <span className="w-12 shrink-0 text-muted-foreground">{stars} כוכבים</span>
                    <span
                      className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
                      role="img"
                      aria-label={`${stars} כוכבים: ${summary.distribution[stars]} ביקורות`}
                    >
                      <span
                        className="block h-full rounded-full bg-amber-400"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                    <span className="numeric w-9 shrink-0 text-end text-muted-foreground">
                      {percent}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : (
        !writing &&
        !sent && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <StarRating value={0} size="lg" label="אין עדיין דירוג" />
              <p>עדיין אין ביקורות על המוצר הזה — היו הראשונים לספר מה חשבתם!</p>
            </CardContent>
          </Card>
        )
      )}

      {sent ? (
        <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CardContent className="flex items-start gap-3 p-4 text-sm" data-testid="review-sent">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold text-emerald-900 dark:text-emerald-100">
                תודה! הביקורת התקבלה
              </p>
              <p className="text-emerald-800 dark:text-emerald-200">
                היא תפורסם באתר אחרי אישור החנות
                {sent.verified ? ' — עם התג "רכישה מאומתת".' : "."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        writing && (
          <ReviewForm
            productId={productId}
            productName={productName}
            onCancel={() => setWriting(false)}
            onSent={(verified) => {
              setWriting(false);
              setSent({ verified });
            }}
          />
        )
      )}

      {reviews.length > 0 && (
        <ul className="space-y-3" data-testid="reviews-list">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-card"
              data-testid="review-item"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{review.customer_name}</span>
                  {review.verified_purchase && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <BadgeCheck className="size-3.5" aria-hidden="true" />
                      רכישה מאומתת
                    </span>
                  )}
                </div>
                <time dateTime={review.created_at} className="text-xs text-muted-foreground">
                  {formatReviewDate(review.created_at)}
                </time>
              </div>
              <StarRating value={review.rating} size="sm" />
              <p className="whitespace-pre-line break-words text-sm leading-6 text-foreground">
                {review.content}
              </p>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            הצגת ביקורות נוספות ({(summary.count - reviews.length).toLocaleString("he-IL")})
          </Button>
        </div>
      )}
    </section>
  );
}

/** טופס "כתוב ביקורת": דירוג, שם, טקסט; שדה מלכודת נסתר לבוטים */
function ReviewForm({
  productId,
  productName,
  onCancel,
  onSent,
}: {
  productId: string;
  productName: string;
  onCancel: () => void;
  onSent: (verified: boolean) => void;
}) {
  const submit = useServerFn(submitProductReview);
  const [rating, setRating] = useState(0);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const problems = reviewDraftProblems({ name, rating, content });
  const showProblems = tried && problems.length > 0;

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    setServerError(null);
    if (problems.length > 0) return;
    setBusy(true);
    try {
      const result = await submit({ data: { productId, name, rating, content, website } });
      onSent(result.verifiedPurchase);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "שליחת הביקורת נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-card">
      <CardContent className="p-4 sm:p-5">
        <form onSubmit={send} className="space-y-4" noValidate data-testid="review-form">
          <p className="text-sm text-muted-foreground">
            מה חשבתם על <span className="font-semibold text-foreground">{productName}</span>?
            הביקורת תפורסם אחרי אישור החנות.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="review-rating">הדירוג שלכם *</Label>
            <StarInput
              id="review-rating"
              value={rating}
              onChange={setRating}
              invalid={tried && rating === 0}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-name">שם (יוצג באתר) *</Label>
            <Input
              id="review-name"
              value={name}
              maxLength={REVIEW_LIMITS.nameMax}
              autoComplete="given-name"
              placeholder="למשל: דנה כ."
              onChange={(event) => setName(event.target.value)}
              className="sm:max-w-xs"
              data-testid="review-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-content">הביקורת *</Label>
            <Textarea
              id="review-content"
              value={content}
              rows={4}
              maxLength={REVIEW_LIMITS.contentMax}
              placeholder="איך המוצר? איכות, התאמה, שירות…"
              onChange={(event) => setContent(event.target.value)}
              data-testid="review-content"
            />
            <p className="text-end text-xs text-muted-foreground">
              <span className="numeric">{content.length.toLocaleString("he-IL")}</span> /{" "}
              {REVIEW_LIMITS.contentMax.toLocaleString("he-IL")}
            </p>
          </div>
          {/* מלכודת לבוטים — מוסתרת מאנשים ומקוראי מסך */}
          <div className="sr-only" aria-hidden="true">
            <label>
              אתר אינטרנט
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
          </div>

          {(showProblems || serverError) && (
            <ul
              className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="review-problems"
            >
              {serverError ? <li>{serverError}</li> : problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy} data-testid="review-submit">
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              שליחת הביקורת
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              ביטול
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
