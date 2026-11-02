// מערכת התמיכה — צד העסק (שלב E4): רשימה, פנייה, פתיחה, תגובה, סגירה / פתיחה מחדש, קבצים.
// ההרשאה (בעלים ומנהלים — settings), הבידוד בין עסקים, הסטטוסים והמגבלות — במסד (מיגרציה 33).
// כאן: בדיקת הקלט והקבצים (לפי התוכן), העלאה לדלי הפרטי, קישור הורדה חתום, והתראה לפלטפורמה.
import { createServerFn } from "@tanstack/react-start";
import type {
  SupportList,
  SupportSendResult,
  SupportStatus,
  SupportTicket,
  SupportTicketRow,
} from "../types/support";
import {
  parseSupportFileId,
  parseSupportOpenForm,
  parseSupportReplyForm,
  parseSupportSetOpen,
  parseSupportTicketId,
} from "../validation/support";

type Sent = {
  ticket: SupportTicketRow;
  message_id: string;
  uploads: { id: string; path: string; name: string; mime: string }[];
  business: { name: string };
};

/** פנייה חדשה / תגובה: בדיקת הקבצים → המסד → העלאה → "מוכן" → התראה לפלטפורמה */
async function send(
  fn: "support_open" | "support_reply",
  args: Record<string, unknown>,
  files: File[],
  body: string,
): Promise<SupportSendResult> {
  const [{ guardStaff }, { manageRpc, manageSession }, support] = await Promise.all([
    import("../security/guard.server"),
    import("../server/manage.server"),
    import("../server/support.server"),
  ]);
  const session = await manageSession();
  await guardStaff("supportWrite", { userId: session.userId, siteId: session.siteId });
  const prepared = await support.prepareSupportFiles(files);
  const r = await manageRpc<Sent>(fn, { ...args, _files: support.fileMeta(prepared) });
  const up = await support.uploadSupportFiles(r.uploads ?? [], prepared);
  if (up.ok.length) await manageRpc<number>("support_files_ready", { _ids: up.ok });
  void support.notifyPlatformOfSupport({
    event: fn === "support_open" ? "opened" : "replied",
    ticketId: r.ticket.id,
    number: r.ticket.number,
    subject: r.ticket.subject,
    topic: r.ticket.topic,
    priority: r.ticket.priority,
    business: r.business?.name ?? "",
    messageId: r.message_id,
    body,
    files: prepared.length,
  });
  return {
    ticketId: r.ticket.id,
    status: r.ticket.status as SupportStatus,
    failedFiles: up.failed,
  };
}

export const hospitalitySupportList = createServerFn({ method: "GET" }).handler(
  async (): Promise<SupportList> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<SupportList>("support_list", {});
  },
);

/** כמה תשובות של התמיכה לא נקראו — לתג בתפריט */
export const hospitalitySupportUnread = createServerFn({ method: "GET" }).handler(
  async (): Promise<number> => {
    const { manageRpc } = await import("../server/manage.server");
    return (await manageRpc<number | null>("support_unread", {})) ?? 0;
  },
);

export const hospitalitySupportTicket = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSupportTicketId(input))
  .handler(async ({ data }): Promise<SupportTicket> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<SupportTicket>("support_ticket", { _id: data.id });
  });

export const hospitalitySupportOpen = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => parseSupportOpenForm(data))
  .handler(({ data }) =>
    send(
      "support_open",
      { _subject: data.subject, _topic: data.topic, _priority: data.priority, _body: data.body },
      data.files,
      data.body,
    ),
  );

export const hospitalitySupportReply = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => parseSupportReplyForm(data))
  .handler(({ data }) =>
    send("support_reply", { _ticket: data.ticketId, _body: data.body }, data.files, data.body),
  );

export const hospitalitySupportSetOpen = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSupportSetOpen(input))
  .handler(async ({ data }): Promise<SupportTicketRow> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<SupportTicketRow>("support_set_open", { _ticket: data.id, _open: data.open });
  });

/** קישור הורדה (2 דקות) — המסד בודק שהקובץ של העסק ושהוא לא של הערה פנימית */
export const hospitalitySupportFileUrl = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSupportFileId(input))
  .handler(async ({ data }): Promise<{ url: string }> => {
    const [{ manageRpc }, { signedSupportUrl }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/support.server"),
    ]);
    const file = await manageRpc<{ path: string; name: string; mime: string }>("support_file", {
      _id: data.id,
    });
    return { url: await signedSupportUrl(file) };
  });
