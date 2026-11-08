// NURIEL AI – Hospitality: חלון העוזר באזור הניהול של המתחם. רק הקטלוג של Hospitality ופונקציות השרת של
// Hospitality — הזמינות, ההרשאה והזכאות נבדקות בשרת בכל קריאה (ההסתרה כאן היא נוחות בלבד).
import { useNavigate } from "@tanstack/react-router";
import { AssistantWidget } from "@/platform/ai/ui/AssistantWidget";
import { HOSPITALITY_GUIDE_CATALOG } from "../../ai/guides";
import { hospitalityAiAsk, hospitalityAiStatus } from "../../api/assistant.functions";

// פונקציות יציבות (מחוץ לרכיב) — כדי שבדיקת הזמינות לא תרוץ שוב בכל ציור
const fetchStatus = () => hospitalityAiStatus();
const ask = (data: { question: string; previous: string[] }) => hospitalityAiAsk({ data });

/** פנייה לחידוש: פנייה חדשה במערכת התמיכה, עם הנושא מוכן */
const SUPPORT_PATH = `/manage/support?new=1&topic=account&subject=${encodeURIComponent("חידוש NURIEL AI")}`;

export default function HospitalityAssistant() {
  const navigate = useNavigate();
  return (
    <AssistantWidget
      catalog={HOSPITALITY_GUIDE_CATALOG}
      fetchStatus={fetchStatus}
      ask={ask}
      navigate={(href) => void navigate({ href })}
      supportPath={SUPPORT_PATH}
      // מעל השורה התחתונה בטלפון (BottomNav), בפינה בצד השני מהתוכן
      buttonClassName="bottom-24 left-4 md:bottom-6 md:left-6"
      panelClassName="bottom-24 left-4 md:bottom-6 md:left-6"
    />
  );
}
