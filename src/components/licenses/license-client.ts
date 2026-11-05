// ============================================================
// מודול הרישיונות — עזרים לדפדפן: בדיקת קובץ לפני העלאה, והעלאה ישירה לאחסון הפרטי.
// הבדיקות כאן רק לתגובה מיידית; השרת בודק הכול שוב (סוג אמיתי, גודל, הרשאה, חנות).
// ============================================================
import { supabase } from "@/integrations/supabase/client";
import {
  createLicenseUpload,
  registerLicenseFile,
  type LicenseFileSummary,
} from "@/lib/licenses.functions";
import {
  LICENSE_BUCKET,
  fileExtensionProblem,
  fileSignatureProblem,
  fileSizeProblem,
  type LicenseFileKind,
  type LicenseProduct,
} from "@/lib/licenses";

/** תחילת הקובץ — מספיק לכותרת PDF ולכותרת PE של EXE */
const HEAD_BYTES = 64 * 1024;

export const ACCEPT_FOR_KIND: Record<LicenseFileKind, string> = {
  guide: ".pdf,application/pdf",
  receipt: ".pdf,application/pdf",
  installer: ".exe,application/vnd.microsoft.portable-executable,application/x-msdownload",
};

export async function readFileHead(file: Blob, bytes = HEAD_BYTES): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
}

/** אותן בדיקות כמו בשרת: סיומת, גודל, והחתימה האמיתית של הקובץ */
export async function localFileProblem(file: File, kind: LicenseFileKind): Promise<string | null> {
  return (
    fileExtensionProblem(file.name, kind) ??
    fileSizeProblem(file.size, kind) ??
    fileSignatureProblem(kind, await readFileHead(file))
  );
}

/**
 * העלאה: קישור העלאה חתום מהשרת (נתיב שהשרת בחר, בתיקיית החנות) → העלאה ישירה לאחסון
 * הפרטי → רישום בשרת, שבודק את הקובץ שהגיע בפועל ומוחק אותו אם אינו תקין.
 */
export async function uploadLicenseFile(input: {
  file: File;
  product: LicenseProduct;
  kind: LicenseFileKind;
  makeDefault: boolean;
}): Promise<LicenseFileSummary> {
  const problem = await localFileProblem(input.file, input.kind);
  if (problem) throw new Error(problem);
  const upload = await createLicenseUpload({
    data: {
      product: input.product,
      kind: input.kind,
      fileName: input.file.name,
      size: input.file.size,
    },
  });
  // שירות האחסון בודק את סוג הקובץ המוצהר מול רשימת הסוגים של התיקייה, והדפדפן מסמן קובצי
  // EXE אחרת בכל מערכת הפעלה — לכן מצהירים על הסוג האמיתי (הקובץ עצמו לא משתנה)
  const body = new File([input.file], input.file.name, { type: upload.contentType });
  const { error } = await supabase.storage
    .from(LICENSE_BUCKET)
    .uploadToSignedUrl(upload.path, upload.token, body, { contentType: upload.contentType });
  if (error) throw new Error(`ההעלאה נכשלה: ${error.message}`);
  return registerLicenseFile({
    data: {
      path: upload.path,
      product: input.product,
      kind: input.kind,
      fileName: input.file.name,
      makeDefault: input.makeDefault,
    },
  });
}

export function errorText(error: unknown, fallback = "הפעולה נכשלה"): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  // דפדפנים ישנים: UUID v4 מ-getRandomValues
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** העתקה ללוח — true אם הצליח */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
