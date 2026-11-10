// NURIEL AI – Ecommerce: הצעות למוצרים כפולים במסך "מוצרים כפולים". עטיפה דקה בלבד — ההרשאה, הזכאות (חבילה
// בתוקף), המכסות, התקציב והבדיקה של התשובה בליבה (src/lib/ai/product-duplicates-ai.server.ts), על הצינור
// המשותף של NURIEL AI. (קובץ של Ecommerce.)
//  - safeErrors (ראשון): כל שגיאה חוזרת כהודעה קבועה, בלי stack trace.
//  - מצב התוסף (מוצג / זמין / למה לא) — ecommerceAiStatus הקיים (src/lib/ai-assistant.functions.ts).
import { createServerFn } from "@tanstack/react-start";
import { safeErrors } from "@/platform/ai/ai-middleware";
import type { DuplicateAiResult } from "@/lib/product-duplicates";

type SuggestInput = { category?: string | null };

/** בדיקה עם AI: הצעות בלבד (מזהים + קוד סיבה); שום דבר לא משתנה בחנות */
export const productDuplicatesAiSuggest = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator((input: SuggestInput) => input)
  .handler(async ({ data }): Promise<DuplicateAiResult> => {
    const { handleDuplicateSuggestions } = await import("@/lib/ai/product-duplicates-ai.server");
    return handleDuplicateSuggestions(data);
  });
