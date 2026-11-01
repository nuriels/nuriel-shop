// רענון אחרי פעולה על הזמנה: הכרטיס, הרשימה, היומן והקשר הניהול (ספירת הממתינות)
import { useQueryClient } from "@tanstack/react-query";
import { manageKeys } from "../lib/query-keys";
import { bookingKey } from "./model";

export function useBookingRefresh(id: string | null) {
  const qc = useQueryClient();
  return () => {
    if (id) void qc.invalidateQueries({ queryKey: bookingKey(id) });
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "bookings"] });
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "calendar"] });
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "blocks-upcoming"] });
    void qc.invalidateQueries({ queryKey: manageKeys.context });
  };
}
