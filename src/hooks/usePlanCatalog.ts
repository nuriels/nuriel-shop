import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PLAN_CATALOG, loadPlanCatalog, type PlanCatalog } from "@/lib/plan-catalog";

/**
 * החבילות והמחירים (חלק 14) — נטענים פעם אחת ומשותפים לכל המסכים. עד
 * שהטעינה מסתיימת (או אם נכשלה) — ברירת המחדל, כך שאין מסך ריק.
 */
let cached: PlanCatalog | null = null;
let inflight: Promise<PlanCatalog> | null = null;
const listeners = new Set<(next: PlanCatalog) => void>();

export async function refreshPlanCatalog(): Promise<PlanCatalog> {
  inflight ??= loadPlanCatalog().finally(() => {
    inflight = null;
  });
  const next = await inflight;
  cached = next;
  for (const listener of listeners) listener(next);
  return next;
}

export function usePlanCatalog(): {
  catalog: PlanCatalog;
  loaded: boolean;
  refresh: () => Promise<void>;
} {
  const [catalog, setCatalog] = useState<PlanCatalog | null>(cached);

  useEffect(() => {
    listeners.add(setCatalog);
    if (cached === null) {
      refreshPlanCatalog().catch((error: unknown) => {
        console.error("[plans] failed to load the plan catalog", error);
      });
    }
    return () => {
      listeners.delete(setCatalog);
    };
  }, []);

  const refresh = useCallback(async () => {
    await refreshPlanCatalog();
  }, []);

  return { catalog: catalog ?? DEFAULT_PLAN_CATALOG, loaded: catalog !== null, refresh };
}
