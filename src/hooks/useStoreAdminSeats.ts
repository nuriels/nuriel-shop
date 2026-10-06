import { useCallback, useEffect, useState } from "react";
import { loadStoreAdminSeats, type StoreAdminSeats } from "@/lib/admin-seats";

/** מצב המנהלים של החנות (רק למנהל החנות; אחרים — null) */
export function useStoreAdminSeats(enabled: boolean) {
  const [seats, setSeats] = useState<StoreAdminSeats | null>(null);
  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      setSeats(await loadStoreAdminSeats());
    } catch {
      setSeats(null);
    }
  }, [enabled]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { seats, reload };
}
