// רשימת ההקמה בלוח הבקרה: חמישה צעדים שהמסד מחשב (management_context.checklist)
import type { ChecklistKey } from "../../types/management";

export interface ChecklistStep {
  key: ChecklistKey;
  title: string;
  hint: string;
}

export const CHECKLIST_STEPS: readonly ChecklistStep[] = [
  { key: "business", title: "פרטי העסק", hint: "שם העסק וטלפון או מייל ליצירת קשר" },
  { key: "units", title: "יחידת אירוח ראשונה", hint: "צימר, סוויטה או חדר — עם מספר אורחים" },
  { key: "photos", title: "תמונות", hint: "תמונה אחת לפחות של המקום (לא תמונת הדגמה)" },
  { key: "prices", title: "מחירים", hint: "מחיר ללילה ליחידה פעילה" },
  { key: "policy", title: "מדיניות ביטול", hint: "לבדוק את תנאי הביטול ולהתאים אותם לעסק" },
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
