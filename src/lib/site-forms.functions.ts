import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ATTACHMENT_TYPES,
  attachmentBytesMatch,
  attachmentExtension,
  attachmentProblem,
  cancellationProblems,
  cleanAttachmentName,
  contactProblems,
  normalizeOrderNumber,
  normalizePhone,
  referenceCode,
  type Captcha,
  type CancellationInput,
  type ContactInput,
} from "@/lib/site-forms";

/**
 * טפסי האתר (חלק 16א) — פונקציות השרת.
 *
 *  • "צור קשר": FormData (כולל קובץ מצורף אופציונלי, עד 5MB). הקובץ נבדק
 *    (סיומת + חתימת הקובץ) ונשמר בדלי פרטי; רק המנהל מקבל קישור הורדה זמני.
 *  • "ביטול עסקה": שאלת חשבון חתומה (Captcha) + הגבלת קצב. נשמר כתיעוד,
 *    המנהל מקבל התראה והלקוח — אישור קבלה במייל.
 *  • שדה "מלכודת" נסתר (website): בוט שממלא אותו מקבל "נשלח" ושום דבר לא נשמר.
 *
 * השמירה עצמה — ב-RPC של המסד (service_role בלבד), שם גם בדיקות התקינות.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOO_MANY = "נשלחו יותר מדי פניות מהחיבור הזה. נסו שוב בעוד כמה דקות.";

const text = (value: unknown, max = 6000): string =>
  typeof value === "string" ? value.slice(0, max) : "";

function firstProblem(problems: Record<string, string | undefined>): string | null {
  for (const message of Object.values(problems)) if (message) return message;
  return null;
}

/** אסמכתה "מזויפת" לבוט שמילא את שדה המלכודת */
function decoyReference(): string {
  return referenceCode(crypto.randomUUID());
}

// ------------------------------------------------------------
// צור קשר
// ------------------------------------------------------------

export type ContactResult = { reference: string };

export const submitContactMessage = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => {
    if (!(data instanceof FormData)) throw new Error("בקשה לא תקינה");
    return data;
  })
  .handler(async ({ data }): Promise<ContactResult> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`contact:${ip}`, 5, 15 * 60 * 1000)) throw new Error(TOO_MANY);

    if (text(data.get("website")).trim() !== "") return { reference: decoyReference() };

    const input: ContactInput = {
      fullName: text(data.get("fullName"), 200),
      phone: text(data.get("phone"), 40),
      email: text(data.get("email"), 300),
      message: text(data.get("message"), 6000),
      orderNumber: text(data.get("orderNumber"), 60),
    };
    const problem = firstProblem(contactProblems(input));
    if (problem) throw new Error(problem);

    // הקובץ המצורף (אופציונלי)
    const rawFile = data.get("attachment");
    let attachment: {
      name: string;
      size: number;
      ext: NonNullable<ReturnType<typeof attachmentExtension>>;
      bytes: Uint8Array;
    } | null = null;
    if (rawFile instanceof File && rawFile.size > 0) {
      const fileProblem = attachmentProblem(rawFile);
      if (fileProblem) throw new Error(fileProblem);
      const ext = attachmentExtension(rawFile.name)!;
      const bytes = new Uint8Array(await rawFile.arrayBuffer());
      if (!attachmentBytesMatch(ext, bytes)) {
        throw new Error("תוכן הקובץ לא תואם לסוג שלו — נסו לשמור אותו מחדש ולצרף שוב");
      }
      attachment = { name: cleanAttachmentName(rawFile.name), size: bytes.length, ext, bytes };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const forms = await import("@/lib/site-forms.server");
    const tenantId = currentTenantId();
    const id = crypto.randomUUID();
    const path = attachment ? forms.attachmentPath(tenantId, id, attachment.ext) : null;

    if (attachment && path) {
      try {
        await forms.uploadContactAttachment(path, attachment.ext, attachment.bytes);
      } catch (error) {
        console.error("[contact] attachment upload failed", error);
        throw new Error("העלאת הקובץ נכשלה. נסו שוב, או שלחו את הפנייה בלי הקובץ.");
      }
    }

    const orderNumber = input.orderNumber.trim() ? normalizeOrderNumber(input.orderNumber) : null;
    const { data: saved, error } = await supabaseAdmin.rpc("contact_message_submit", {
      _id: id,
      _full_name: input.fullName.trim(),
      _phone: normalizePhone(input.phone),
      _email: input.email.trim(),
      _message: input.message.trim(),
      _order_number: orderNumber,
      _attachment_path: path,
      _attachment_name: attachment?.name ?? null,
      _attachment_type: attachment ? ATTACHMENT_TYPES[attachment.ext] : null,
      _attachment_size: attachment?.size ?? null,
    });
    if (error) {
      console.error("[contact] save failed", error.message);
      if (path) await forms.removeContactAttachment(path);
      throw new Error("שליחת הפנייה נכשלה. נסו שוב בעוד רגע.");
    }

    const result = (saved ?? {}) as { order_found?: boolean };
    try {
      await forms.notifyContactMessage({
        id,
        fullName: input.fullName.trim(),
        phone: normalizePhone(input.phone),
        email: input.email.trim().toLowerCase(),
        message: input.message.trim(),
        orderNumber,
        orderFound: result.order_found === true,
        attachment: attachment ? { name: attachment.name, size: attachment.size } : null,
      });
    } catch (mailError) {
      // הפנייה נשמרה — המנהל יראה אותה בפאנל גם אם המייל לא יצא
      console.error("[contact] admin notification failed", mailError);
    }
    return { reference: referenceCode(id) };
  });

// ------------------------------------------------------------
// ביטול עסקה
// ------------------------------------------------------------

export const getCancellationCaptcha = createServerFn({ method: "POST" }).handler(
  async (): Promise<Captcha> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`captcha:${ip}`, 60, 15 * 60 * 1000)) throw new Error(TOO_MANY);
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const { issueCaptcha } = await import("@/lib/captcha.server");
    return issueCaptcha(currentTenantId());
  },
);

type CancellationPayload = CancellationInput & {
  captchaToken: string;
  captchaAnswer: string;
  /** שדה המלכודת */
  website?: string;
};

export type CancellationResult = {
  reference: string;
  orderNumber: string;
  receivedAt: string;
  /** נשלח ללקוח אישור קבלה במייל */
  confirmationSent: boolean;
};

export const submitCancellationRequest = createServerFn({ method: "POST" })
  .inputValidator((input: CancellationPayload): CancellationPayload => ({
    firstName: text(input?.firstName, 120),
    lastName: text(input?.lastName, 120),
    phone: text(input?.phone, 40),
    email: text(input?.email, 300),
    message: text(input?.message, 6000),
    orderNumber: text(input?.orderNumber, 60),
    captchaToken: text(input?.captchaToken, 1000),
    captchaAnswer: text(input?.captchaAnswer, 20),
    website: text(input?.website, 200),
  }))
  .handler(async ({ data }): Promise<CancellationResult> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`cancel:${ip}`, 5, 15 * 60 * 1000)) throw new Error(TOO_MANY);

    if ((data.website ?? "").trim() !== "") {
      return {
        reference: decoyReference(),
        orderNumber: normalizeOrderNumber(data.orderNumber),
        receivedAt: new Date().toISOString(),
        confirmationSent: false,
      };
    }

    const problem = firstProblem(cancellationProblems(data));
    if (problem) throw new Error(problem);

    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const { verifyCaptcha, CAPTCHA_EXPIRED, CAPTCHA_WRONG } = await import("@/lib/captcha.server");
    const check = verifyCaptcha(data.captchaToken, data.captchaAnswer, currentTenantId());
    if (check === "wrong") throw new Error(CAPTCHA_WRONG);
    if (check !== "ok") throw new Error(CAPTCHA_EXPIRED);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: saved, error } = await supabaseAdmin.rpc("cancellation_request_submit", {
      _first_name: data.firstName.trim(),
      _last_name: data.lastName.trim(),
      _phone: normalizePhone(data.phone),
      _email: data.email.trim(),
      _message: data.message.trim(),
      _order_number: normalizeOrderNumber(data.orderNumber),
    });
    if (error) {
      console.error("[cancellation] save failed", error.message);
      throw new Error("שליחת הודעת הביטול נכשלה. נסו שוב בעוד רגע.");
    }
    // order_found / contact_match — להתראה למנהל בלבד; לא חוזרים לדפדפן
    // (לא חושפים אילו מספרי הזמנה קיימים)
    const row = (saved ?? {}) as {
      id?: string;
      created_at?: string;
      order_number?: string;
      order_found?: boolean;
      contact_match?: boolean;
    };
    const id = String(row.id ?? "");
    if (!UUID.test(id)) throw new Error("שליחת הודעת הביטול נכשלה. נסו שוב בעוד רגע.");
    const receivedAt = String(row.created_at ?? new Date().toISOString());
    const orderNumber = String(row.order_number ?? normalizeOrderNumber(data.orderNumber));

    const forms = await import("@/lib/site-forms.server");
    const notice = {
      id,
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      phone: normalizePhone(data.phone),
      email: data.email.trim().toLowerCase(),
      message: data.message.trim() || null,
      orderNumber,
      orderFound: row.order_found === true,
      contactMatch: row.contact_match === true,
      receivedAt,
    };
    let confirmationSent = false;
    try {
      confirmationSent = await forms.confirmCancellationToCustomer(notice);
      if (confirmationSent) {
        await supabaseAdmin.rpc("cancellation_request_confirmed", { _id: id });
      }
    } catch (mailError) {
      console.error("[cancellation] customer confirmation failed", mailError);
    }
    try {
      await forms.notifyCancellationRequest(notice);
    } catch (mailError) {
      console.error("[cancellation] admin notification failed", mailError);
    }
    return { reference: referenceCode(id), orderNumber, receivedAt, confirmationSent };
  });

// ------------------------------------------------------------
// פאנל הניהול: הורדת הקובץ המצורף
// ------------------------------------------------------------

export const getContactAttachmentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = String(input?.id ?? "");
    if (!UUID.test(id)) throw new Error("פנייה לא תקינה");
    return { id };
  })
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    // קריאה בהרשאות המשתמש: רק מנהל של החנות הזו רואה את השורה (RLS)
    const { data: message, error } = await context.supabase
      .from("contact_messages")
      .select("attachment_path, attachment_name")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !message?.attachment_path) throw new Error("הקובץ לא נמצא");
    const { contactAttachmentUrl } = await import("@/lib/site-forms.server");
    return {
      url: await contactAttachmentUrl(
        message.attachment_path,
        message.attachment_name ?? "attachment",
      ),
    };
  });
