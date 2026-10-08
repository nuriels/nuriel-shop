import { useEffect, useState } from "react";
import { loadRatingSummaries } from "@/lib/reviews-data";
import type { RatingSummary } from "@/lib/reviews";

const EMPTY = new Map<string, RatingSummary>();

/**
 * חלק 34: הדירוג של כל המוצרים בחנות (ממוצע + מספר ביקורות מאושרות) — לכוכבים
 * בכרטיסי הקטלוג ובעמוד המוצר. נטען פעם אחת לכל טעינת עמוד ומשותף לכולם.
 */
export function useRatingSummaries(): Map<string, RatingSummary> {
  const [ratings, setRatings] = useState<Map<string, RatingSummary>>(EMPTY);
  useEffect(() => {
    let alive = true;
    void loadRatingSummaries().then((next) => {
      if (alive) setRatings(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ratings;
}
