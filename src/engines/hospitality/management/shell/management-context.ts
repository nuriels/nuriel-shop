// ההקשר של אזור הניהול (תפקיד, הרשאות, מנוי, רשימת הקמה) לכל המסכים שבתוך המעטפת.
// הספק (Provider) מוצב ב-ManageLayout.
import { createContext, useContext } from "react";
import type { ManagementContext } from "../../types/management";

export const ManagementCtx = createContext<ManagementContext | null>(null);

export function useManagement(): ManagementContext {
  const value = useContext(ManagementCtx);
  if (!value) throw new Error("useManagement must be used inside the management layout");
  return value;
}
