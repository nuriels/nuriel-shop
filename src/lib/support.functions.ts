import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MESSAGE_MAX,
  SUBJECT_MAX,
  SUBJECT_MIN,
  parseMessage,
  parseThread,
  parseTicket,
  parseTickets,
  type SupportMessage,
  type SupportThread,
  type SupportTicket,
} from "@/lib/support";

/**
 * מערכת התמיכה (חלק 13) — פונקציות השרת לקריאה ולכתיבה של הצ'אט.
 *
 * כל קריאה רצה עם החיבור של המשתמש (requireSupabaseAuth); ההרשאה נבדקת
 * במסד (support_side): מנהל החנות של הפנייה, או מנהל-על. אחרי הודעה —
 * התראת מייל לצד השני כשהמסד מסמן notify (תחילת סבב / 10 דקות).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ticketIdOf(value: unknown): string {
  const id = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!UUID.test(id)) throw new Error("פנייה לא תקינה");
  return id;
}

function messageOf(value: unknown): string {
  const message = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (message.length < 1) throw new Error("כתבו הודעה");
  if (message.length > MESSAGE_MAX) {
    throw new Error(`ההודעה ארוכה מדי (עד ${MESSAGE_MAX.toLocaleString("he-IL")} תווים)`);
  }
  return message;
}

async function rateLimit(key: string, limit: number, windowMs: number, message: string) {
  const { allowAction } = await import("@/lib/rate-limit.server");
  if (!allowAction(key, limit, windowMs)) throw new Error(message);
}

// ============================================================
// מנהל החנות
// ============================================================

/** הפניות של החנות (פתוחות קודם) */
export const listMyTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SupportTicket[]> => {
    const { data, error } = await context.supabase.rpc("support_my_tickets");
    if (error) throw new Error(error.message);
    return parseTickets(data);
  });

/** כמה פניות עם תשובה שלא נקראה — התג ליד "תמיכה ועזרה" */
export const getSupportUnreadCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("support_unread_count");
    if (error) return 0;
    return Number(data ?? 0) || 0;
  });

/** פנייה חדשה: נושא + הודעה ראשונה; מייל למנהל הפלטפורמה */
export const openSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { subject: string; message: string }) => {
    const subject = String(input?.subject ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (subject.length < SUBJECT_MIN || subject.length > SUBJECT_MAX) {
      throw new Error(`נושא הפנייה: ${SUBJECT_MIN} עד ${SUBJECT_MAX} תווים`);
    }
    return { subject, message: messageOf(input?.message) };
  })
  .handler(async ({ data, context }) => {
    await rateLimit(
      `support-open:${context.userId}`,
      10,
      60 * 60 * 1000,
      "נפתחו כבר כמה פניות בשעה האחרונה — המשיכו באחת מהן",
    );
    const { data: raw, error } = await context.supabase.rpc("support_open_ticket", {
      _subject: data.subject,
      _message: data.message,
    });
    if (error) throw new Error(error.message);
    const root = (raw ?? {}) as Record<string, unknown>;
    const ticket = parseTicket(root["ticket"]);
    const { notifyPlatformOfTenantMessage } = await import("@/lib/support.server");
    await notifyPlatformOfTenantMessage({
      ticketId: ticket.id,
      message: data.message,
      isNewTicket: true,
    });
    return { ticket, message: parseMessage(root["message"]) };
  });

// ============================================================
// שני הצדדים (מנהל החנות / מנהל-על) — לפי ההרשאה במסד
// ============================================================

/** הפנייה וכל ההודעות (מסמן "נקרא" לצד של הקורא) */
export const getSupportThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ticketId: string }) => ({ ticketId: ticketIdOf(input?.ticketId) }))
  .handler(async ({ data, context }): Promise<SupportThread> => {
    const { data: raw, error } = await context.supabase.rpc("support_thread", {
      _ticket: data.ticketId,
    });
    if (error) throw new Error(error.message);
    return parseThread(raw);
  });

/** הודעה בצ'אט; התראת מייל לצד השני כשצריך */
export const sendSupportMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ticketId: string; message: string }) => ({
    ticketId: ticketIdOf(input?.ticketId),
    message: messageOf(input?.message),
  }))
  .handler(
    async ({ data, context }): Promise<{ ticket: SupportTicket; message: SupportMessage }> => {
      await rateLimit(
        `support-message:${context.userId}`,
        40,
        10 * 60 * 1000,
        "יותר מדי הודעות בזמן קצר. נסו שוב בעוד כמה דקות.",
      );
      const { data: raw, error } = await context.supabase.rpc("support_post_message", {
        _ticket: data.ticketId,
        _message: data.message,
      });
      if (error) throw new Error(error.message);
      const root = (raw ?? {}) as Record<string, unknown>;
      const ticket = parseTicket(root["ticket"]);
      if (root["notify"] === true) {
        const { notifyPlatformOfTenantMessage, notifyTenantOfAdminReply } =
          await import("@/lib/support.server");
        if (root["side"] === "admin") {
          await notifyTenantOfAdminReply({ ticketId: ticket.id, message: data.message });
        } else {
          await notifyPlatformOfTenantMessage({
            ticketId: ticket.id,
            message: data.message,
            isNewTicket: false,
          });
        }
      }
      return { ticket, message: parseMessage(root["message"]) };
    },
  );

/** סגירה / פתיחה מחדש */
export const setSupportTicketStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ticketId: string; status: "open" | "closed" }) => {
    if (input?.status !== "open" && input?.status !== "closed") throw new Error("סטטוס לא מוכר");
    return { ticketId: ticketIdOf(input?.ticketId), status: input.status };
  })
  .handler(async ({ data, context }) => {
    const { data: raw, error } = await context.supabase.rpc("support_set_status", {
      _ticket: data.ticketId,
      _status: data.status,
    });
    if (error) throw new Error(error.message);
    return parseTicket(raw);
  });

// ============================================================
// מנהל הפלטפורמה
// ============================================================

export type PlatformTicketFilter = "open" | "answered" | "closed" | "active" | "all";
const FILTERS: PlatformTicketFilter[] = ["open", "answered", "closed", "active", "all"];

/** כל הפניות מכל החנויות (ברירת מחדל: ממתינות לנו), VIP קודם */
export const platformListTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { filter?: PlatformTicketFilter }) => {
    const filter = input?.filter ?? "open";
    if (!FILTERS.includes(filter)) throw new Error("מסנן לא מוכר");
    return { filter };
  })
  .handler(async ({ data, context }): Promise<SupportTicket[]> => {
    const { data: raw, error } = await context.supabase.rpc("platform_support_tickets", {
      _filter: data.filter,
    });
    if (error) throw new Error(error.message);
    return parseTickets(raw);
  });

/** מונים ללשוניות הסינון ולתג בתפריט */
export const platformSupportCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("platform_support_counts");
    if (error) throw new Error(error.message);
    const root = (data ?? {}) as Record<string, unknown>;
    const n = (key: string) => Number(root[key] ?? 0) || 0;
    return { open: n("open"), answered: n("answered"), closed: n("closed"), unread: n("unread") };
  });
