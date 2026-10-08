import { useLocation } from "@tanstack/react-router";
import { Clock, MoonStar } from "lucide-react";
import { useRestState } from "@/hooks/useRestState";
import { REST_CHECKOUT_MESSAGE, reopenText, restGreeting } from "@/lib/rest-window";

/** בעמודי הצוות — בלי פס (הצוות ממשיך לעבוד, והקופה המהירה לא נחסמת) */
const STAFF_PATHS = /^\/(admin|admin-handoff|agent|warehouse|courier|platform)(\/|$)/;

/**
 * חלק 35: פס עליון בחזית החנות — בזמן שבת / חג ("שבת שלום — האתר שומר שבת…"),
 * או עד 3 שעות לפני הסגירה ("האתר ייסגר להזמנות היום ב-16:00").
 */
export function RestBanner() {
  const { state, closed, closingSoon } = useRestState();
  const { pathname } = useLocation();
  if (STAFF_PATHS.test(pathname)) return null;
  if (closed && state.closed) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-indigo-950 px-4 py-2.5 text-center text-sm text-indigo-50"
        data-testid="rest-banner"
      >
        <MoonStar className="size-4 shrink-0 text-amber-300" aria-hidden="true" />
        <strong>{restGreeting(state)}</strong>
        <span>
          — {REST_CHECKOUT_MESSAGE}. נחזור {reopenText(state)}. בינתיים אפשר לגלוש בקטלוג ולצפות
          בהזמנות שלכם.
        </span>
      </div>
    );
  }
  if (closingSoon) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950"
        data-testid="rest-closing-soon"
      >
        <Clock className="size-4 shrink-0" aria-hidden="true" />
        {closingSoon}
      </div>
    );
  }
  return null;
}
