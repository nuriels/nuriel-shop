// שלב א' 5: אישורי העברה בנקאית — בשרת בלבד:
//   • הקובץ נבדק לפי התוכן, כמו קבצים בתמיכה: JPEG / PNG / WebP / PDF, עד 5MB, PDF בלי תוכן פעיל
//     (סקריפט, קבצים מוטמעים, הצפנה); השם נשמר בלי תווי בקרה, עם סיומת לפי התוכן;
//   • העלאה לדלי הפרטי hosp-payment-proofs במפתח השירות — לדלי אין מדיניות למשתמשים, כך שהקובץ נגיש
//     רק דרך השרת, ורק אחרי שהמסד אישר שהוא שייך לעסק (payment_proof_file);
//   • צפייה: קישור חתום ל-2 דקות; PDF — תמיד כהורדה (לא נפתח בדפדפן).
import { constants as zlibConstants, inflateSync } from "node:zlib";
import { serviceHeaders, supabaseUrl } from "@/platform/supabase/env.server";
import { InputError } from "../validation/input";
import {
  SUPPORT_MAX_BYTES,
  pdfHasActiveContent,
  sniffSupportFile,
  supportFileName,
  type SupportMime,
} from "../validation/support";
import { HospitalityError } from "./rpc.server";

export const PROOFS_BUCKET = "hosp-payment-proofs";
const SIGNED_SECONDS = 120;
const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export interface PreparedProof {
  name: string;
  mime: SupportMime;
  size: number;
  bytes: Uint8Array;
}

const inflateCapped = (data: Uint8Array, maxBytes: number) =>
  new Uint8Array(
    inflateSync(data, {
      maxOutputLength: Math.max(1, maxBytes),
      finishFlush: zlibConstants.Z_SYNC_FLUSH,
    }),
  );

/** בדיקת הקובץ לפני שנרשם משהו במסד */
export async function prepareProofFile(file: File): Promise<PreparedProof> {
  if (file.size > SUPPORT_MAX_BYTES) throw new InputError("הקובץ גדול מדי (עד 5MB)");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw new InputError("הקובץ ריק");
  if (bytes.byteLength > SUPPORT_MAX_BYTES) throw new InputError("הקובץ גדול מדי (עד 5MB)");
  const mime = sniffSupportFile(bytes);
  if (!mime) throw new InputError("הקובץ לא נתמך — צילום מסך / תמונה (JPG, PNG, WebP) או PDF");
  if (mime === "application/pdf" && pdfHasActiveContent(bytes, inflateCapped))
    throw new InputError(
      "ה-PDF מכיל תוכן פעיל, קבצים מוטמעים או הצפנה — שמרו אותו מחדש כ-PDF רגיל, או העלו צילום מסך",
    );
  return { name: supportFileName(file.name, mime), mime, size: bytes.byteLength, bytes };
}

/** העלאה לנתיב שהמסד יצר (guest_proof_slot) */
export async function uploadProof(path: string, f: PreparedProof): Promise<void> {
  if (!PATH.test(path)) throw new HospitalityError("ההעלאה נכשלה — נסו שוב", null);
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/${PROOFS_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      "Content-Type": f.mime,
      "x-upsert": "false",
      "cache-control": "private, max-age=0, no-store",
    },
    body: new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.mime }),
  });
  if (!res.ok) {
    console.error("[hospitality/proofs] upload failed", res.status);
    throw new HospitalityError("ההעלאה נכשלה — נסו שוב בעוד רגע", null);
  }
}

/** קישור צפייה חתום וקצר — רק אחרי שהמסד אישר את ההרשאה (payment_proof_file) */
export async function signedProofUrl(file: {
  path: string;
  name: string;
  mime: string;
}): Promise<string> {
  if (!PATH.test(file.path)) throw new HospitalityError("הקובץ לא נמצא", "P0002");
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/sign/${PROOFS_BUCKET}/${file.path}`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ expiresIn: SIGNED_SECONDS }),
  });
  const data = res.ok ? ((await res.json()) as { signedURL?: string }) : {};
  if (!data.signedURL) {
    console.error("[hospitality/proofs] sign failed", res.status);
    throw new HospitalityError("הקובץ לא זמין כרגע — נסו שוב", null);
  }
  const url = new URL(`${supabaseUrl()}/storage/v1${data.signedURL}`);
  if (file.mime === "application/pdf") url.searchParams.set("download", file.name);
  return url.toString();
}
