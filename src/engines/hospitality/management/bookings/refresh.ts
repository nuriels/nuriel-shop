// רענון אחרי פעולה על הזמנה: הכרטיס, התשלומים (היתרה נפתחת באישור, ההחזר — בביטול), הרשימה, היומן,
// לוח הבקרה (F3) והקשר הניהול (ספירת הממתינות)
import { useQueryClient } from "@tanstack/react-query";
import { manageKeys } from "../lib/query-keys";
import { bookingKey, paymentsKey } from "./model";

export function useBookingRefresh(id: string | null) {
  const qc = useQueryClient();
  return () => {
    if (id) void qc.invalidateQueries({ queryKey: bookingKey(id) });
    if (id) void qc.invalidateQueries({ queryKey: paymentsKey(id) });
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "bookings"] });
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "calendar"] });
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "blocks-upcoming"] });
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "dashboard"] });
    void qc.invalidateQueries({ queryKey: manageKeys.context });
  };
}
