// שלב א' 6: "המתחם שומר שבת" — תג עם נרות שבת (בכותרת, בתחתית העמוד ובתהליך ההזמנה). מוצג רק כשבעל
// העסק סימן במסך ההגדרות.
import { cn } from "@/platform/ui";
import { useCopy } from "../copy";

/** שני נרות שבת — קו בלבד, בצבע הטקסט (currentColor) */
export function CandlesIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      {/* להבות */}
      <path d="M8 2.5c-1 1.3-1.4 2.2-1.4 3a1.4 1.4 0 0 0 2.8 0c0-.8-.4-1.7-1.4-3Z" />
      <path d="M16 2.5c-1 1.3-1.4 2.2-1.4 3a1.4 1.4 0 0 0 2.8 0c0-.8-.4-1.7-1.4-3Z" />
      {/* פתילים */}
      <path d="M8 6.9v1.3M16 6.9v1.3" />
      {/* נרות */}
      <rect x="6.5" y="8.2" width="3" height="10" rx="0.6" />
      <rect x="14.5" y="8.2" width="3" height="10" rx="0.6" />
      {/* פמוטים */}
      <path d="M4.5 21.5h15M8 18.2v3.3M16 18.2v3.3" />
    </svg>
  );
}

export function ShabbatBadge({
  className,
  testId = "shabbat-badge",
}: {
  className?: string;
  testId?: string;
}) {
  const t = useCopy();
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-sm", className)}
      data-testid={testId}
    >
      <CandlesIcon />
      {t.shabbat.badge}
    </span>
  );
}
