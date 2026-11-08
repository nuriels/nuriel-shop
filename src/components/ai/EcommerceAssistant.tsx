// NURIEL AI – Ecommerce: חלון העוזר בפאנל הניהול של החנות. רק הקטלוג של Ecommerce ופונקציות השרת של
// Ecommerce — הזמינות, ההרשאה והזכאות נבדקות בשרת בכל קריאה (ההסתרה כאן היא נוחות בלבד).
import { useNavigate } from "@tanstack/react-router";
import { ECOMMERCE_GUIDE_CATALOG } from "@/lib/ai/ecommerce-guides";
import { ecommerceAiAsk, ecommerceAiStatus } from "@/lib/ai-assistant.functions";
import { AssistantWidget } from "@/platform/ai/ui/AssistantWidget";

// פונקציות יציבות (מחוץ לרכיב) — כדי שבדיקת הזמינות לא תרוץ שוב בכל ציור
const fetchStatus = () => ecommerceAiStatus();
const ask = (data: { question: string; previous: string[] }) => ecommerceAiAsk({ data });

export default function EcommerceAssistant() {
  const navigate = useNavigate();
  return (
    <AssistantWidget
      catalog={ECOMMERCE_GUIDE_CATALOG}
      fetchStatus={fetchStatus}
      ask={ask}
      navigate={(href) => void navigate({ href })}
      supportPath="/admin?tab=support"
      buttonClassName="bottom-[calc(var(--a11y-bottom,1rem))] left-4"
      panelClassName="bottom-4 left-4"
    />
  );
}
