// רשימת ההקמה בלוח הבקרה: חמש אבני הדרך שהמסד מחשב (management_context.checklist) — פרטים /
// יחידה / תמונות / מחירים / האתר מוכן לפרסום. כל הצעדים בפירוט — במדריך ההקמה (/manage/setup).
import type { ChecklistKey } from "../../types/management";

export interface ChecklistStep {
  key: ChecklistKey;
  title: string;
  hint: string;
  /** המסך שבו משלימים את הצעד (כשכבר קיים) */
  to?:
    "/manage/settings" | "/manage/units" | "/manage/photos" | "/manage/pricing" | "/manage/setup";
}

export const CHECKLIST_STEPS: readonly ChecklistStep[] = [
  {
    key: "business",
    title: "פרטי העסק",
    hint: "שם העסק וטלפון או מייל ליצירת קשר",
    to: "/manage/settings",
  },
  {
    key: "units",
    title: "יחידת אירוח ראשונה",
    hint: "צימר, סוויטה או חדר — עם מספר אורחים",
    to: "/manage/units",
  },
  {
    key: "photos",
    title: "תמונות",
    hint: "תמונה אחת לפחות של המקום (לא תמונת הדגמה)",
    to: "/manage/photos",
  },
  { key: "prices", title: "מחירים", hint: "מחיר ללילה ליחידה פעילה", to: "/manage/pricing" },
  {
    key: "site",
    title: "האתר מוכן לפרסום",
    hint: "תבנית, ויחידה פעילה עם מחיר ותמונה משלה",
    to: "/manage/setup",
  },
];

export function checklistProgress(state: Partial<Record<ChecklistKey, boolean>>): {
  done: number;
  total: number;
  percent: number;
  complete: boolean;
} {
  const total = CHECKLIST_STEPS.length;
  const done = CHECKLIST_STEPS.filter((s) => state[s.key] === true).length;
  return { done, total, percent: Math.round((done / total) * 100), complete: done === total };
}
