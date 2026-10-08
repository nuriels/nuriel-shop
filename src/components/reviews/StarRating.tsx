import { useId, useState } from "react";
import { Star } from "lucide-react";
import { RATING_WORDS, starFills } from "@/lib/reviews";
import { cn } from "@/lib/utils";

/**
 * חלק 34: כוכבי דירוג — תצוגה (כולל חצי כוכב) ובחירה בטופס.
 * בעברית הכוכב הראשון מימין (RTL) — כמו בכל אתרי הקניות בעברית.
 */
export function StarRating({
  value,
  size = "md",
  className,
  label,
}: {
  value: number;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** טקסט לקוראי מסך (ברירת מחדל: "דירוג X מתוך 5") */
  label?: string;
}) {
  const fills = starFills(value);
  const px = size === "sm" ? "size-3.5" : size === "lg" ? "size-6" : "size-4";
  return (
    <span
      role="img"
      aria-label={label ?? `דירוג ${value.toLocaleString("he-IL")} מתוך 5`}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {fills.map((fill, index) => (
        <span key={index} className={cn("relative inline-block shrink-0", px)} aria-hidden="true">
          <Star className={cn(px, "text-amber-300/70 dark:text-amber-500/40")} strokeWidth={1.75} />
          {fill > 0 && (
            <span
              className="absolute inset-y-0 right-0 overflow-hidden"
              style={{ width: fill === 1 ? "100%" : "50%" }}
            >
              <Star
                className={cn(
                  px,
                  "absolute right-0 top-0 max-w-none fill-amber-400 text-amber-500",
                )}
                strokeWidth={1.75}
              />
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/** בחירת דירוג בטופס: קבוצת כפתורי רדיו (מקלדת: חיצים), עם מילה שמסבירה */
export function StarInput({
  value,
  onChange,
  invalid = false,
  id,
}: {
  value: number;
  onChange: (next: number) => void;
  invalid?: boolean;
  id?: string;
}) {
  const [hover, setHover] = useState(0);
  const autoId = useId();
  const groupId = id ?? autoId;
  const shown = hover || value;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        id={groupId}
        role="radiogroup"
        aria-label="דירוג"
        aria-invalid={invalid || undefined}
        className="inline-flex items-center gap-1"
        onMouseLeave={() => setHover(0)}
        data-testid="review-stars-input"
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const active = shown >= star;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={value === star}
              aria-label={`${star} כוכבים — ${RATING_WORDS[star as 1 | 2 | 3 | 4 | 5]}`}
              tabIndex={value === star || (value === 0 && star === 1) ? 0 : -1}
              onMouseEnter={() => setHover(star)}
              onFocus={() => setHover(0)}
              onClick={() => onChange(star)}
              onKeyDown={(event) => {
                // RTL: חץ שמאלה = כוכב נוסף
                if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  onChange(Math.min(5, (value || 0) + 1));
                } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  onChange(Math.max(1, (value || 2) - 1));
                }
              }}
              className="rounded-md p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`review-star-${star}`}
            >
              <Star
                className={cn(
                  "size-7",
                  active ? "fill-amber-400 text-amber-500" : "text-muted-foreground/50",
                  invalid && !active && "text-destructive/60",
                )}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      <span className="min-w-16 text-sm font-medium text-muted-foreground" aria-live="polite">
        {shown > 0 ? RATING_WORDS[shown as 1 | 2 | 3 | 4 | 5] : "בחרו דירוג"}
      </span>
    </div>
  );
}
