import { MoonStar } from "lucide-react";
import { useRestState } from "@/hooks/useRestState";
import { REST_CHECKOUT_MESSAGE, reopenText, restGreeting } from "@/lib/rest-window";
import { cn } from "@/lib/utils";

/**
 * חלק 35ב: כרטיס הברכה ללקוחות בזמן שבת / חג — התמונה שהחנות העלתה (לשבת
 * תמונה אחת, ולכל חג תמונה משלו) והברכה ("שבת שלום" / "חג סוכות שמח"),
 * ומתחת: שהאתר שומר שבת/חג ומתי חוזרים לפעילות. בלי תמונה — רקע כהה עם נרות.
 * מוצג בעמוד הבית ובקופה; בשאר העמודים — הפס העליון (RestBanner).
 */
export function RestGreetingCard({
  className,
  testId = "rest-greeting",
  showCheckoutNote = true,
}: {
  className?: string;
  testId?: string;
  /** "האתר שומר שבת/חג ויחזור לפעילות…" — בקופה תמיד */
  showCheckoutNote?: boolean;
}) {
  const { state, closed } = useRestState();
  if (!closed || !state.closed) return null;
  const greeting = restGreeting(state);
  return (
    <section
      role="status"
      aria-label={greeting}
      className={cn(
        "relative overflow-hidden rounded-2xl bg-indigo-950 text-center text-indigo-50 shadow-card",
        className,
      )}
      data-testid={testId}
      data-kind={state.kind}
    >
      {state.imageUrl ? (
        <img
          src={state.imageUrl}
          alt={greeting}
          className="block max-h-[22rem] w-full object-cover"
          data-testid={`${testId}-image`}
        />
      ) : (
        <div className="flex justify-center pt-6" aria-hidden="true">
          <MoonStar className="size-10 text-amber-300" />
        </div>
      )}
      <div className="space-y-1.5 px-5 py-5">
        <p className="font-display text-2xl font-bold sm:text-3xl" data-testid={`${testId}-title`}>
          {greeting}
        </p>
        {showCheckoutNote && <p className="text-base sm:text-lg">{REST_CHECKOUT_MESSAGE}</p>}
        <p className="text-sm opacity-80">
          נחזור לפעילות {reopenText(state)}. בינתיים אפשר לגלוש בקטלוג ולצפות בהזמנות שלכם.
        </p>
      </div>
    </section>
  );
}
