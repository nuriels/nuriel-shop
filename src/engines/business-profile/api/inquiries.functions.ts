// פניות מלקוחות (מיגרציה 196): שליחת טופס באתר העסק, ו"פניות מלקוחות" בממשק הניהול.
// השליחה: מלכודת בוטים (שדה נסתר + זמן מילוי), הגבלת קצב בזיכרון ובמסד, בדיקת קלט עם הודעה לכל שדה,
// מפתח חד-פעמי נגד שליחה כפולה. הגנת CSRF — ה-middleware הגלובלי של פונקציות השרת (src/start.ts).
// בתצוגה המקדימה (לפני הפרסום): רק משתמש מחובר עם הרשאה באתר, והפנייה מסומנת "בדיקה".
// ממשק הניהול: כל ההרשאות במסד (inquiries.manage — בעל העסק בלבד, באתר של הבקשה).
import { createServerFn } from "@tanstack/react-start";
import {
  INQUIRY_KINDS,
  INQUIRY_STATUSES,
  validateInquiry,
  type FieldErrors,
  type InquiryKind,
  type InquiryStatus,
} from "../inquiries/logic";
import type { InquiryDetail, InquiryList, InquirySettings, SubmitResult } from "../inquiries/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (v: unknown, what = "מזהה") => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new Error(`${what} לא תקין`);
  return s.toLowerCase();
};
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export type SubmitInquiryResult =
  | { ok: true; reference: string; test: boolean }
  | { ok: false; errors?: FieldErrors; error?: string };

const GENERIC_ERROR = "השליחה לא הצליחה. נסו שוב בעוד רגע, או פנו אלינו בוואטסאפ או בטלפון.";
const RATE_ERROR = "נשלחו כמה פניות ברצף. נסו שוב בעוד כמה דקות.";
/** פחות מזה מפתיחת הטופס ועד השליחה — כנראה לא אדם (מלכודת זמן; לא חוסם, רק לא שומר) */
const MIN_FILL_MS = 1500;

/** קוד אקראי במבנה של מספר פנייה — לבוט שנלכד במלכודת (שלא יידע שנחסם) */
function decoyReference(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

export const submitInquiry = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    clientKey: uuidOf(input?.["clientKey"], "הטופס"),
    kind: (INQUIRY_KINDS as readonly string[]).includes(String(input?.["kind"]))
      ? (String(input?.["kind"]) as InquiryKind)
      : ("contact" as InquiryKind),
    formTitle: text(input?.["formTitle"], 160),
    pagePath: text(input?.["pagePath"], 200),
    name: text(input?.["name"], 400),
    phone: text(input?.["phone"], 60),
    email: text(input?.["email"], 320),
    message: text(input?.["message"], 4100),
    website: text(input?.["website"], 200),
    startedAt: Number.isFinite(Number(input?.["startedAt"])) ? Number(input?.["startedAt"]) : 0,
    preview: input?.["preview"] === true,
  }))
  .handler(async ({ data }): Promise<SubmitInquiryResult> => {
    // מלכודת: שדה שגולש לא רואה מולא, או שהטופס נשלח מהר מדי — "התקבל", בלי לשמור
    if (data.website.trim() || (data.startedAt > 0 && Date.now() - data.startedAt < MIN_FILL_MS)) {
      return { ok: true, reference: decoyReference(), test: false };
    }
    const checked = validateInquiry(data);
    if (!checked.ok) return { ok: false, errors: checked.errors };

    const [{ allowAction, requestIp }, { businessSiteId, siteRpc, BusinessProfileError }, svc] =
      await Promise.all([
        import("@/platform/security/rate-limit.server"),
        import("../data/rpc.server"),
        import("../inquiries/service.server"),
      ]);
    const ip = await requestIp();
    if (!allowAction(`bp-inquiry:${ip}`, 8, 10 * 60_000)) return { ok: false, error: RATE_ERROR };

    let siteId: string;
    try {
      siteId = await businessSiteId();
    } catch {
      return { ok: false, error: GENERIC_ERROR };
    }
    // תצוגה מקדימה: רק מי שמחובר ומורשה לערוך את האתר הזה (המסד בודק את ההרשאה)
    if (data.preview) {
      const { sessionFromRequest } = await import("@/platform/auth/session.server");
      const session = await sessionFromRequest().catch(() => null);
      if (!session) return { ok: false, error: "שליחה מהתצוגה המקדימה — רק למחוברים לניהול האתר." };
      try {
        await siteRpc("bp_studio_context", {}, { accessToken: session.accessToken, siteId });
      } catch {
        return { ok: false, error: "אין הרשאה לשלוח פניית בדיקה באתר הזה." };
      }
    }

    let saved: SubmitResult;
    try {
      saved = await svc.serviceRpc<SubmitResult>(
        "bp_inquiry_submit",
        {
          _client_key: data.clientKey,
          _kind: data.kind,
          _form_title: data.formTitle.trim() || null,
          _page_path: /^\/[^\s]{0,199}$/.test(data.pagePath) ? data.pagePath : null,
          _full_name: checked.value.name,
          _phone: checked.value.phone || null,
          _email: checked.value.email || null,
          _message: checked.value.message || null,
          _ip_hash: svc.ipHash(ip, siteId),
          _test: data.preview,
        },
        siteId,
      );
    } catch (error) {
      if (error instanceof BusinessProfileError) {
        if (error.code === "P0429") return { ok: false, error: RATE_ERROR };
        if (error.code === "23514" || error.code === "42501")
          return { ok: false, error: error.message || GENERIC_ERROR };
      }
      console.error(
        "[business-profile/inquiries] submit",
        error instanceof Error ? error.message : error,
      );
      return { ok: false, error: GENERIC_ERROR };
    }
    // ההתראה במייל — אחרי השמירה, ולא מעכבת את התשובה לגולש. אם נכשלה — נרשם בפנייה, ויש ניסיון חוזר
    // אוטומטי (תהליך הרקע) וידני (ממשק הניהול)
    if (saved.notify) {
      void svc
        .notifyInquiry(saved.id)
        .catch((error) =>
          console.error(
            "[business-profile/inquiries] notify",
            error instanceof Error ? error.message : error,
          ),
        );
    }
    return { ok: true, reference: saved.reference, test: saved.test };
  });

// ---------- ממשק הניהול: "פניות מלקוחות" ----------
const statusOf = (v: unknown): InquiryStatus => {
  const s = String(v ?? "");
  if (!(INQUIRY_STATUSES as readonly string[]).includes(s)) throw new Error("מצב לא תקין");
  return s as InquiryStatus;
};

export const studioInquiries = createServerFn({ method: "GET" })
  .inputValidator((input: { status?: unknown; includeTest?: unknown } | undefined) => ({
    status: input?.status ? statusOf(input.status) : null,
    includeTest: input?.includeTest !== false,
  }))
  .handler(async ({ data }): Promise<InquiryList> => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc<InquiryList>("bp_inquiries_list", {
      _status: data.status,
      _include_test: data.includeTest,
      _limit: 300,
    });
  });

export const studioInquiry = createServerFn({ method: "GET" })
  .inputValidator((input: { id: unknown }) => ({ id: uuidOf(input?.id, "מזהה הפנייה") }))
  .handler(async ({ data }): Promise<InquiryDetail> => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc<InquiryDetail>("bp_inquiry_get", { _id: data.id });
  });

export const studioInquirySetStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { id: unknown; status: unknown }) => ({
    id: uuidOf(input?.id, "מזהה הפנייה"),
    status: statusOf(input?.status),
  }))
  .handler(async ({ data }) => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc<{ id: string; status: InquiryStatus }>("bp_inquiry_set_status", {
      _id: data.id,
      _status: data.status,
    });
  });

export const studioInquiryAddNote = createServerFn({ method: "POST" })
  .inputValidator((input: { id: unknown; body: unknown }) => {
    const body = String(input?.body ?? "").trim();
    if (!body || body.length > 2000) throw new Error("ההערה צריכה להכיל 1–2000 תווים");
    return { id: uuidOf(input?.id, "מזהה הפנייה"), body };
  })
  .handler(async ({ data }) => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc<{ id: string }>("bp_inquiry_add_note", { _id: data.id, _body: data.body });
  });

export const studioInquiryDeleteNote = createServerFn({ method: "POST" })
  .inputValidator((input: { noteId: unknown }) => ({ noteId: uuidOf(input?.noteId, "מזהה ההערה") }))
  .handler(async ({ data }) => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc<{ id: string }>("bp_inquiry_delete_note", { _note: data.noteId });
  });

export const studioInquiryDelete = createServerFn({ method: "POST" })
  .inputValidator((input: { id: unknown }) => ({ id: uuidOf(input?.id, "מזהה הפנייה") }))
  .handler(async ({ data }) => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc<{ id: string }>("bp_inquiry_delete", { _id: data.id });
  });

export const studioInquiriesDeleteTest = createServerFn({ method: "POST" }).handler(async () => {
  const { studioRpc } = await import("../data/rpc.server");
  return studioRpc<{ deleted: number }>("bp_inquiries_delete_test");
});

/** ניסיון חוזר לשליחת ההתראה במייל — המסד בודק הרשאה ומצב, ואז שולחים מיד ומחזירים את התוצאה */
export const studioInquiryRetryNotify = createServerFn({ method: "POST" })
  .inputValidator((input: { id: unknown }) => ({ id: uuidOf(input?.id, "מזהה הפנייה") }))
  .handler(async ({ data }): Promise<{ outcome: "sent" | "failed" | "skipped" }> => {
    const [{ studioRpc }, { allowAction, requestIp }, { notifyInquiry }] = await Promise.all([
      import("../data/rpc.server"),
      import("@/platform/security/rate-limit.server"),
      import("../inquiries/service.server"),
    ]);
    if (!allowAction(`bp-inquiry-retry:${await requestIp()}`, 12, 10 * 60_000)) {
      throw new Error("יותר מדי ניסיונות שליחה. נסו שוב בעוד כמה דקות.");
    }
    await studioRpc("bp_inquiry_retry_notify", { _id: data.id });
    return { outcome: await notifyInquiry(data.id) };
  });

export const studioInquirySettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<InquirySettings> => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc<InquirySettings>("bp_inquiry_settings");
  },
);

export const studioInquirySettingsSave = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { notifyEmail: unknown; notifyEnabled: unknown; retentionDays: unknown }) => {
      const days = Number(input?.retentionDays);
      if (!Number.isInteger(days) || days < 30 || days > 1095)
        throw new Error("תקופת השמירה צריכה להיות בין 30 ל-1095 ימים");
      return {
        notifyEmail: String(input?.notifyEmail ?? "")
          .trim()
          .slice(0, 254),
        notifyEnabled: input?.notifyEnabled !== false,
        retentionDays: days,
      };
    },
  )
  .handler(async ({ data }): Promise<InquirySettings> => {
    const { studioRpc } = await import("../data/rpc.server");
    return studioRpc<InquirySettings>("bp_inquiry_settings_save", {
      _notify_email: data.notifyEmail || null,
      _notify_enabled: data.notifyEnabled,
      _retention_days: data.retentionDays,
    });
  });

/** התג בתפריט — מספר הפניות החדשות (0 למי שאין לו הרשאה) */
export const studioInquiriesNewCount = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ count: number }> => {
    const { studioRpc } = await import("../data/rpc.server");
    const n = await studioRpc<number>("bp_inquiries_new_count");
    return { count: Number(n) || 0 };
  },
);
