import { useEffect, useState } from "react";
import { loadPublishedPageLinks } from "@/lib/pages-data";
import type { StorePageLink } from "@/lib/pages";

/**
 * עמודי התוכן שפורסמו (חלק 30) — ל"מידע שימושי" בתחתית האתר ולמפת האתר.
 * נטענים פעם אחת לכל טעינת עמוד ומשותפים בין הרכיבים; הניהול קורא ל-
 * refreshStorePages אחרי שינוי, כך שהתחתית מתעדכנת מיד.
 */
let cached: StorePageLink[] | null = null;
let inflight: Promise<StorePageLink[]> | null = null;
const listeners = new Set<(next: StorePageLink[]) => void>();

function publish(next: StorePageLink[]) {
  cached = next;
  for (const listener of listeners) listener(next);
}

export async function refreshStorePages(): Promise<StorePageLink[]> {
  inflight ??= loadPublishedPageLinks()
    .catch((error: unknown) => {
      // תחתית האתר לא נשברת בגלל העמודים — פשוט בלי "מידע שימושי"
      console.error("[pages] load failed", error);
      return [] as StorePageLink[];
    })
    .finally(() => {
      inflight = null;
    });
  const next = await inflight;
  publish(next);
  return next;
}

export function useStorePages(): StorePageLink[] | null {
  const [pages, setPages] = useState<StorePageLink[] | null>(cached);
  useEffect(() => {
    listeners.add(setPages);
    if (cached === null) void refreshStorePages();
    return () => {
      listeners.delete(setPages);
    };
  }, []);
  return pages;
}
