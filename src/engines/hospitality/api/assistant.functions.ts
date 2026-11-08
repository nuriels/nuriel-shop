// NURIEL AI – Hospitality: חלון העוזר באזור הניהול של המתחם. עטיפה דקה בלבד — כל ההרשאות, הזכאות
// (חבילה בתוקף, לפי היום בישראל), הגבלות הקצב וההגנות בליבה המשותפת (src/platform/ai/assistant.server).
// הקטלוג כאן הוא של Hospitality בלבד, והליבה מוודאת מול המסד שהעסק והחבילה הם מסוג Hospitality.
//  - safeErrors (ראשון): כל שגיאה חוזרת כהודעה קבועה, בלי stack trace.
//  - אזור הניהול חייב להיות פעיל באתר (הדגלים של Hospitality) — אחרת העוזר לא קיים.
//  - הקלט עובר כמו שהוא ונבדק בליבה, אחרי ההרשאה.
import { createServerFn } from "@tanstack/react-start";
import { safeErrors } from "@/platform/ai/ai-middleware";
import type { AskResult, AssistantStatusView } from "@/platform/ai/logic";

type AskInput = { question: string; previous?: string[] };

async function managementOpen(): Promise<boolean> {
  const [{ currentSite }, { managementEnabled }] = await Promise.all([
    import("@/platform/tenancy/current-site.server"),
    import("../access.server"),
  ]);
  const site = await currentSite();
  return site !== null && site.siteType === "hospitality" && (await managementEnabled(site.id));
}

/** למנהלי המתחם: האם להציג את העוזר, האם הוא זמין, ולמה לא (subscription_expired וכו') */
export const hospitalityAiStatus = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .handler(async (): Promise<AssistantStatusView> => {
    if (!(await managementOpen())) return { visible: false };
    const [{ handleStatus }, { HOSPITALITY_GUIDE_CATALOG }] = await Promise.all([
      import("@/platform/ai/assistant.server"),
      import("../ai/guides"),
    ]);
    return handleStatus(HOSPITALITY_GUIDE_CATALOG);
  });

/** שאלה → מזהי מדריכים מהקטלוג של Hospitality / הודעה קבועה. הכול נבדק מחדש בכל שאלה */
export const hospitalityAiAsk = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator((input: AskInput) => input)
  .handler(async ({ data }): Promise<AskResult> => {
    const { SafeError } = await import("@/platform/ai/safe-error");
    if (!(await managementOpen())) throw new SafeError("אין הרשאה");
    const [{ handleAsk }, { HOSPITALITY_GUIDE_CATALOG }] = await Promise.all([
      import("@/platform/ai/assistant.server"),
      import("../ai/guides"),
    ]);
    return handleAsk(HOSPITALITY_GUIDE_CATALOG, data);
  });
