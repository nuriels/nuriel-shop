// הצעות SEO שממתינות לאישור (לשונית "גוגל ושיתוף"). עטיפה דקה בלבד:
//  - הרשימה וההחלטה — בשם המשתמש (manageRpc): המסד בודק את העסק, ההרשאה (settings) והגרסה, ושומר דרך
//    הפונקציה הקיימת של כל שדה. שום דבר לא מתפרסם — שדות האתר נכנסים לטיוטה בלבד.
//  - ההפקה — בליבה (ai/seo-writer.server.ts) על הצינור המשותף של NURIEL AI: אותה זכאות, אותן מכסות, אותו
//    מפתח ואותו דגם. תבניות בלי AI — לכל עסק.
//  - safeErrors (ראשון) על ההפקה: כל שגיאה חוזרת כהודעה קבועה, בלי stack trace.
import { createServerFn } from "@tanstack/react-start";
import { safeErrors } from "@/platform/ai/ai-middleware";
import type { SeoGenerateResult, SeoProposalsView } from "../types/seo";
import { InputError } from "../validation/input";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function managementOpen(): Promise<boolean> {
  const [{ currentSite }, { managementEnabled }] = await Promise.all([
    import("@/platform/tenancy/current-site.server"),
    import("../access.server"),
  ]);
  const site = await currentSite();
  return site !== null && site.siteType === "hospitality" && (await managementEnabled(site.id));
}

async function requireOpen() {
  const { SafeError } = await import("@/platform/ai/safe-error");
  if (!(await managementOpen())) throw new SafeError("אין הרשאה");
}

/** ההצעות, מה כבר הופק, והאם NURIEL AI זמין לעסק (בלי מכסה ובלי קריאה לדגם) */
export const hospitalitySeoProposals = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .handler(async (): Promise<SeoProposalsView> => {
    await requireOpen();
    const { handleSeoView } = await import("../ai/seo-writer.server");
    return handleSeoView();
  });

/** הפעם הראשונה: הצעות בסיסיות (חינם) + הפקת AI ראשונית אחת לעסק עם NURIEL AI פעיל */
export const hospitalitySeoAutoStart = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .handler(async (): Promise<{ template: SeoGenerateResult; ai: SeoGenerateResult }> => {
    await requireOpen();
    const { handleSeoAutoStart } = await import("../ai/seo-writer.server");
    return handleSeoAutoStart();
  });

type GenerateInput = { kind?: unknown; what?: unknown; proposalId?: unknown };

/** לפי בקשה: הצעות בסיסיות / טקסטים או תיאורי תמונות עם AI / ניסוח אחר להצעה אחת */
export const hospitalitySeoGenerate = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator((input: GenerateInput) => input)
  .handler(async ({ data }): Promise<SeoGenerateResult> => {
    await requireOpen();
    const { handleSeoGenerate } = await import("../ai/seo-writer.server");
    return handleSeoGenerate(data);
  });

type DecideInput = { ids?: unknown; action?: unknown; text?: unknown };
export type SeoDecision = {
  id: string;
  status: "approved" | "rejected" | "stale" | "later" | "reverted" | "error";
  message?: string;
};

/** אישור / דחייה של הצעה אחת או כמה. עריכה — רק להצעה אחת (text). כל אחת בנפרד, בסדר שנשלח */
export const hospitalitySeoDecide = createServerFn({ method: "POST" })
  .inputValidator((input: DecideInput) => {
    const ids = Array.isArray(input?.ids) ? input.ids : [];
    if (!ids.length || ids.length > 100 || !ids.every((x) => typeof x === "string" && UUID.test(x)))
      throw new InputError("בחרו הצעות");
    const action = input?.action;
    // מיגרציה 204: later — "לשמור לאחר כך" (ההצעה נשארת פתוחה, לא מוחלת)
    if (action !== "approve" && action !== "reject" && action !== "later")
      throw new InputError("פעולה לא תקינה");
    const text = input?.text;
    if (
      text !== undefined &&
      text !== null &&
      (typeof text !== "string" || text.length > 5000 || ids.length !== 1)
    )
      throw new InputError("הטקסט לא תקין");
    return { ids: ids as string[], action, text: typeof text === "string" ? text : null };
  })
  .handler(async ({ data }): Promise<SeoDecision[]> => {
    const { manageRpc } = await import("../server/manage.server");
    const out: SeoDecision[] = [];
    for (const id of data.ids) {
      try {
        const r = await manageRpc<{ status: SeoDecision["status"] }>("seo_proposal_decide", {
          _id: id,
          _action: data.action,
          _text: data.text,
        });
        out.push({ id, status: r.status });
      } catch (error) {
        out.push({
          id,
          status: "error",
          message: error instanceof Error ? error.message : "הפעולה נכשלה",
        });
      }
    }
    return out;
  });

/**
 * מיגרציה 204: שחזור — חזרה לערך שהיה לפני האישור. רק כשהשדה עדיין מכיל את מה שאושר (שינוי מאוחר יותר לא
 * נדרס); דרך הפונקציה הקיימת של אותו שדה (הרשאה, גרסה, יומן). טקסט באתר — לטיוטה בלבד (צריך "פרסום")
 */
export const hospitalitySeoRevert = createServerFn({ method: "POST" })
  .inputValidator((input: { id?: unknown }) => {
    if (typeof input?.id !== "string" || !UUID.test(input.id))
      throw new InputError("בקשה לא תקינה");
    return { id: input.id };
  })
  .handler(async ({ data }): Promise<SeoDecision> => {
    const { manageRpc } = await import("../server/manage.server");
    try {
      const r = await manageRpc<{ status: SeoDecision["status"] }>("seo_proposal_revert", {
        _id: data.id,
      });
      return { id: data.id, status: r.status };
    } catch (error) {
      return {
        id: data.id,
        status: "error",
        message: error instanceof Error ? error.message : "השחזור נכשל",
      };
    }
  });
