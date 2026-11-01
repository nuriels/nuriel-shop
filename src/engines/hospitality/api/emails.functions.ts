// מיילים ולוח בקרה (Stage 2k): המיילים של העסק ושליחה חוזרת של מייל שנכשל; המספרים של
// לוח הבקרה. השליחה עצמה — תהליך הרקע (outbox/worker.server.ts).
import { createServerFn } from "@tanstack/react-start";
import type { DashboardNumbers, EmailFilter, EmailList } from "../types/emails";
import { InputError, uuid } from "../validation/input";

const FILTERS: EmailFilter[] = ["all", "failed", "waiting", "sent"];

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

export const hospitalityDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardNumbers> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<DashboardNumbers>("dashboard", {});
  },
);
