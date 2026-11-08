// NURIEL AI – Ecommerce: חלון העוזר בפאנל הניהול של החנות. עטיפה דקה בלבד — כל ההרשאות, הזכאות (חבילה
// בתוקף, לפי היום בישראל), הגבלות הקצב וההגנות בליבה המשותפת (src/platform/ai/assistant.server).
// הקטלוג כאן הוא של Ecommerce בלבד, והליבה מוודאת מול המסד שהעסק והחבילה הם מסוג Ecommerce.
// (קובץ של Ecommerce: באתר אירוח המתג מחזיר 404 לפונקציות האלה.)
//  - safeErrors (ראשון): כל שגיאה חוזרת כהודעה קבועה, בלי stack trace.
//  - הקלט עובר כמו שהוא ונבדק בליבה, אחרי ההרשאה.
import { createServerFn } from "@tanstack/react-start";
import { safeErrors } from "@/platform/ai/ai-middleware";
import type { AskResult, AssistantStatusView } from "@/platform/ai/logic";

type AskInput = { question: string; previous?: string[] };

/** למנהלי החנות: האם להציג את העוזר, האם הוא זמין, ולמה לא (subscription_expired וכו') */
export const ecommerceAiStatus = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .handler(async (): Promise<AssistantStatusView> => {
    const [{ handleStatus }, { ECOMMERCE_GUIDE_CATALOG }] = await Promise.all([
      import("@/platform/ai/assistant.server"),
      import("@/lib/ai/ecommerce-guides"),
    ]);
    return handleStatus(ECOMMERCE_GUIDE_CATALOG);
  });

/** שאלה → מזהי מדריכים מהקטלוג של Ecommerce / הודעה קבועה. הכול נבדק מחדש בכל שאלה */
export const ecommerceAiAsk = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator((input: AskInput) => input)
  .handler(async ({ data }): Promise<AskResult> => {
    const [{ handleAsk }, { ECOMMERCE_GUIDE_CATALOG }] = await Promise.all([
      import("@/platform/ai/assistant.server"),
      import("@/lib/ai/ecommerce-guides"),
    ]);
    return handleAsk(ECOMMERCE_GUIDE_CATALOG, data);
  });
