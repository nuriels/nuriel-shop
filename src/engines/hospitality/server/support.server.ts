// מערכת התמיכה (שלב E4) — בשרת בלבד (המייל עצמו — outbox/support-alert.ts):
//   • הקבצים: סוג לפי התוכן (JPEG / PNG / WebP / PDF), עד 5MB, PDF בלי תוכן פעיל;
//   • העלאה לדלי הפרטי hosp-support במפתח השירות — לדלי אין שום מדיניות למשתמשים, כך שקובץ
//     נגיש רק דרך השרת, ורק אחרי שהמסד אישר שהוא שייך לעסק (או למנהל הפלטפורמה);
//   • הורדה: קישור חתום ל-2 דקות; PDF — תמיד כהורדה (לא נפתח בדפדפן);
//   • התראה במייל לצוות הפלטפורמה על פנייה חדשה / תגובה של עסק. הכתובות — ממשתנה הסביבה
//     SUPPORT_NOTIFY_EMAIL (כמו בקשות לאתרי צימר, שלב E2) או ממנהלי הפלטפורמה במסד (פונקציה
//     שרק מפתח השירות רשאי להריץ). כשל במייל לא מפיל את הפנייה — היא כבר שמורה ומופיעה בפאנל.
import { escapeHtml, sendBusinessEmail } from "@/platform/email/send.server";
import { serviceHeaders, supabaseUrl } from "@/platform/supabase/env.server";
import { HOSPITALITY_SCHEMA } from "../config";
import { supportAlertEmail, type SupportAlert } from "../outbox/support-alert";
import { InputError } from "../validation/input";
import {
  SUPPORT_MAX_BYTES,
  pdfHasActiveContent,
  sniffSupportFile,
  type SupportMime,
} from "../validation/support";
import { HospitalityError } from "./rpc.server";

export const SUPPORT_BUCKET = "hosp-support";
const SIGNED_SECONDS = 120;
const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PreparedFile {
  name: string;
  mime: SupportMime;
  size: number;
  bytes: Uint8Array;
}

/** בדיקת הקבצים לפני שנרשם משהו במסד — קובץ אחד לא תקין עוצר את כל השליחה */
export async function prepareSupportFiles(files: File[]): Promise<PreparedFile[]> {
  const out: PreparedFile[] = [];
  for (const f of files) {
    if (f.size > SUPPORT_MAX_BYTES) throw new InputError(`הקובץ "${f.name}" גדול מדי (עד 5MB)`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const mime = sniffSupportFile(bytes);
    if (!mime) throw new InputError(`הקובץ "${f.name}" לא נתמך — תמונה (JPG / PNG / WebP) או PDF`);
    if (mime === "application/pdf" && pdfHasActiveContent(bytes))
      throw new InputError(`הקובץ "${f.name}" מכיל תוכן פעיל ולא ניתן לצרף אותו`);
    out.push({ name: f.name.slice(0, 160), mime, size: bytes.byteLength, bytes });
  }
  return out;
}

/** מה שנשלח למסד (בלי התוכן) */
export const fileMeta = (files: PreparedFile[]) =>
  files.map((f) => ({ name: f.name, mime: f.mime, size: f.size }));

export type UploadSlot = { id: string; path: string; name: string; mime: string };

/** העלאה לפי הרשומות שהמסד יצר (באותו סדר). מחזיר את מה שעלה ואת שמות הקבצים שנכשלו */
export async function uploadSupportFiles(
  slots: UploadSlot[],
  files: PreparedFile[],
): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    slots.map(async (slot, i) => {
      const f = files[i];
      if (!f || !PATH.test(slot.path)) {
        failed.push(slot.name);
        return;
      }
      try {
        const res = await fetch(
          `${supabaseUrl()}/storage/v1/object/${SUPPORT_BUCKET}/${slot.path}`,
          {
            method: "POST",
            headers: {
              ...serviceHeaders(),
              "Content-Type": f.mime,
              "x-upsert": "false",
              "cache-control": "private, max-age=0, no-store",
            },
            body: new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.mime }),
          },
        );
        if (res.ok) ok.push(slot.id);
        else {
          console.error("[hospitality/support] upload failed", res.status);
          failed.push(slot.name);
        }
      } catch (error) {
        console.error("[hospitality/support] upload crashed", error);
        failed.push(slot.name);
      }
    }),
  );
  return { ok, failed };
}

/** קישור הורדה חתום וקצר — רק אחרי שהמסד אישר את הקובץ (support_file / admin_support_file) */
export async function signedSupportUrl(file: {
  path: string;
  name: string;
  mime: string;
}): Promise<string> {
  if (!PATH.test(file.path)) throw new HospitalityError("הקובץ לא נמצא", "P0002");
  const res = await fetch(
    `${supabaseUrl()}/storage/v1/object/sign/${SUPPORT_BUCKET}/${file.path}`,
    {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ expiresIn: SIGNED_SECONDS }),
    },
  );
  const data = res.ok ? ((await res.json()) as { signedURL?: string }) : {};
  if (!data.signedURL) {
    console.error("[hospitality/support] sign failed", res.status);
    throw new HospitalityError("הקובץ לא זמין כרגע — נסו שוב", null);
  }
  const url = new URL(`${supabaseUrl()}/storage/v1${data.signedURL}`);
  if (file.mime === "application/pdf") url.searchParams.set("download", file.name);
  return url.toString();
}

async function platformRecipients(): Promise<string[]> {
  const override = (process.env["SUPPORT_NOTIFY_EMAIL"] ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => EMAIL.test(v));
  if (override.length) return override;
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/support_platform_recipients`, {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      "Content-Profile": HOSPITALITY_SCHEMA,
      "Accept-Profile": HOSPITALITY_SCHEMA,
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`support_platform_recipients: ${res.status}`);
  return ((await res.json()) as string[] | null)?.filter((v) => EMAIL.test(v)) ?? [];
}

/** מייל לצוות הפלטפורמה — לא מפיל את הפעולה (כבר נשמרה); לקרוא בלי await */
export async function notifyPlatformOfSupport(alert: SupportAlert): Promise<void> {
  try {
    const to = await platformRecipients();
    if (to.length === 0) {
      console.warn("[hospitality/support] no platform admin email to notify");
      return;
    }
    const host = process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase();
    const url = host
      ? `https://${host}/platform/hospitality?ticket=${encodeURIComponent(alert.ticketId)}#support`
      : null;
    const { subject, html } = supportAlertEmail(alert, url, escapeHtml);
    await Promise.all(
      to.map(async (email) => {
        const r = await sendBusinessEmail({
          to: email,
          subject,
          html,
          senderName: "תמיכה — Nuriel Hospitality",
          replyTo: null,
          idempotencyKey: `hosp-support-${alert.messageId}-${email}`,
        });
        if (!r.sent && !r.skipped) console.error("[hospitality/support] notify failed", r.reason);
      }),
    );
  } catch (error) {
    console.error("[hospitality/support] notify crashed", error);
  }
}
