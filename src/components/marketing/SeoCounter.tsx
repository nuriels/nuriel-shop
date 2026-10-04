import { cn } from "@/lib/utils";

/**
 * מונה תווים לשדות SEO: ירוק עד האורך שגוגל מציג, כתום מעליו (גוגל יקצר
 * את מה שמעבר).
 */
export function SeoCounter({ value, recommended }: { value: string; recommended: number }) {
  const length = value.trim().length;
  const over = length > recommended;
  return (
    <p
      className={cn(
        "flex items-center justify-between text-[11px]",
        over ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
      )}
    >
      <span>{over ? `גוגל מציג בערך ${recommended} תווים — השאר יקוצר` : `מומלץ עד ${recommended} תווים`}</span>
      <span dir="ltr" className="numeric">
        {length}/{recommended}
      </span>
    </p>
  );
}
