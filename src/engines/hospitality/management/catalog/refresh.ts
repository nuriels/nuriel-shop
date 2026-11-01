// עזרים משותפים למסכי הקטלוג (לא רכיבים): רענון הנתונים אחרי שינוי, וטקסט שגיאה למשתמש.
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { manageKeys } from "../lib/query-keys";

/** רענון הרשימה, הקשר הניהול (מגבלות, צ'קליסט) ויומן הפעולות */
export function useRefresh() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: manageKeys.catalog });
    void queryClient.invalidateQueries({ queryKey: manageKeys.context });
    void queryClient.invalidateQueries({ queryKey: manageKeys.activity });
  }, [queryClient]);
}

export const errorText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "הפעולה נכשלה — נסו שוב";
