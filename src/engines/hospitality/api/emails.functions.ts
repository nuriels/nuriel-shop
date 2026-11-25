// מיילים ולוח בקרה (Stage 2k): המיילים של העסק ושליחה חוזרת של מייל שנכשל; המספרים של
// לוח הבקרה. השליחה עצמה — תהליך הרקע (outbox/worker.server.ts).
// מיגרציה 206: ההתראה על מייל שנכשל — "נקרא" / "טופל" / "להחזיר להתראות". רק מה שמוצג לבעל העסק
// משתנה; המייל עצמו (סטטוס, ניסיונות, שגיאה, היסטוריה) נשאר כמו שהוא, וכל סימון נרשם ביומן הפעולות.
import { createServerFn } from "@tanstack/react-start";
import type { DashboardNumbers, EmailFilter, EmailList } from "../types/emails";
import { InputError, parseEmailAlertMark, parseEmailAlertMarkAll, uuid } from "../validation/input";

const FILTERS: EmailFilter[] = ["all", "failed", "handled", "waiting", "sent"];

export const hospitalityEmails = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const filter = (input?.["filter"] ?? "all") as EmailFilter;
    if (!FILTERS.includes(filter)) throw new InputError("סינון לא מוכר");
    return { filter };
  })
  .handler(async ({ data }): Promise<EmailList> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<EmailList>("staff_emails", { _filter: data.filter, _limit: 100 });
  });

export const hospitalityRequeueEmail = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({ id: uuid(input?.["id"], "המייל") }))
  .handler(async ({ data }): Promise<{ id: string; status: string }> => {
    const [{ manageRpc }, { kickOutbox }] = await Promise.all([
      import("../server/manage.server"),
      import("../outbox/worker.server"),
    ]);
    const r = await manageRpc<{ id: string; status: string }>("requeue_notification", {
      _id: data.id,
    });
    kickOutbox();
    return r;
  });

/** סימון של מיילים מסוימים (עד 200): נקרא / טופל / להחזיר להתראות */
export const hospitalityEmailAlertsMark = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseEmailAlertMark(input))
  .handler(async ({ data }): Promise<{ updated: number }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ updated: number }>("email_alerts_mark", {
      _ids: data.ids,
      _action: data.action,
    });
  });

/** "סימון הכול כנקרא" / "סימון הכול כטופל" — כל ההתראות הפתוחות של העסק (גם מעבר ל-100 שברשימה) */
export const hospitalityEmailAlertsMarkAll = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseEmailAlertMarkAll(input))
  .handler(async ({ data }): Promise<{ updated: number }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ updated: number }>("email_alerts_mark_all", { _action: data.action });
  });

export const hospitalityDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardNumbers> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<DashboardNumbers>("dashboard", {});
  },
);
