import { StarRating } from "@/components/reviews/StarRating";
import { formatAverage, reviewCountLabel, type RatingSummary } from "@/lib/reviews";
import { cn } from "@/lib/utils";

/**
 * חלק 34: "★★★★½ 4.5 (12)" — הוכחה חברתית בכרטיס המוצר ובראש עמוד המוצר.
 * href — קישור לרשימת הביקורות (בעמוד המוצר: #reviews).
 */
export function RatingInline({
  rating,
  size = "sm",
  href,
  long = false,
  className,
}: {
  rating: RatingSummary | null | undefined;
  size?: "sm" | "md";
  href?: string;
  /** "12 ביקורות" במקום "(12)" */
  long?: boolean;
  className?: string;
}) {
  if (!rating || rating.count === 0) return null;
  const label = `דירוג ${formatAverage(rating.average)} מתוך 5, ${reviewCountLabel(rating.count)}`;
  const content = (
    <>
      <StarRating value={rating.average} size={size} label={label} />
      <span className="numeric font-semibold text-foreground" aria-hidden="true">
        {formatAverage(rating.average)}
      </span>
      <span aria-hidden="true">
        {long ? `· ${reviewCountLabel(rating.count)}` : `(${rating.count})`}
      </span>
    </>
  );
  const classes = cn(
    "inline-flex items-center gap-1 text-xs text-muted-foreground",
    size === "md" && "text-sm",
    className,
  );
  return href ? (
    <a href={href} className={cn(classes, "hover:underline")} data-testid="rating-inline">
      {content}
    </a>
  ) : (
    <span className={classes} data-testid="rating-inline">
      {content}
    </span>
  );
}
