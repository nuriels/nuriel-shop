// ============================================================
// מודול שליחת רישיונות דיגיטליים — פעולות שרת לפאנל הניהול (פיילוט: נוריאל מחשבים).
//
// כל פעולה בודקת בשרת, מחדש: החנות נקבעת לפי ה-host (לא מזהה מהדפדפן) → דגל הפיילוט פעיל
// לחנות → למשתמש הרשאת ניהול מלאה (בעל החנות / מנהל). מפתחות: מוצפנים לפני המסד, לא בלוג,
// לא ברשימות; מפתח מלא רק בפעולת "הצגה" מתועדת. שליחה כפולה: מפתח idempotency ייחודי במסד.
// ============================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  LICENSE_BUCKET,
  UUID_FORMAT,
  businessIdProblem,
  cleanCustomerName,
  cleanFileName,
  cleanOrderNumber,
  contentTypeFor,
  customerNameProblem,
  emailProblem,
  extensionFor,
  fileExtensionProblem,
  fileSignatureProblem,
  fileSizeProblem,
  formatDateTimeHe,
  isLicenseFileKind,
  isLicenseProduct,
  keyTail,
  linkState,
  maskedKey,
  normalizeBusinessId,
  normalizeEmail,
  normalizePhone,
  normalizeProductKey,
  orderNumberProblem,
  phoneProblem,
  productKeyProblem,
  type EmailStatus,
  type LicenseFileKind,
  type LicenseProduct,
  type LinkState,
} from "@/lib/licenses";
import type { LicenseEmailBranding } from "@/lib/license-email";
import { NO_PERMISSION_MESSAGE } from "@/lib/permissions";

const NOT_AVAILABLE = "הפעולה אינה זמינה בחנות זו";
const PAGE_SIZE = 20;

function uuidOf(value: unknown, label: string): string {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!UUID_FORMAT.test(v)) throw new Error(`${label} לא תקין`);
  return v;
}
function optionalUuid(value: unknown, label: string): string | null {
  return value === null || value === undefined || value === "" ? null : uuidOf(value, label);
}
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

// ------------------------------------------------------------
// מצב המודול (null = לא מוצג בכלל — הפיילוט כבוי לחנות / אין הרשאה)
// ------------------------------------------------------------

export type LicenseFileSummary = {
  id: string;
  product: LicenseProduct;
  kind: LicenseFileKind;
  fileName: string;
  sizeBytes: number;
  isDefault: boolean;
  createdAt: string;
};
export type LicenseModuleState =
  | { enabled: false }
  | {
      enabled: true;
      configured: boolean;
      files: LicenseFileSummary[];
      branding: LicenseEmailBranding;
    };

type FileRow = {
  id: string;
  product: LicenseProduct;
  kind: LicenseFileKind;
  file_name: string;
  size_bytes: number;
  is_default: boolean;
  created_at: string;
};
const toFileSummary = (f: FileRow): LicenseFileSummary => ({
  id: f.id,
  product: f.product,
  kind: f.kind,
  fileName: f.file_name,
  sizeBytes: Number(f.size_bytes),
  isDefault: f.is_default,
  createdAt: f.created_at,
});

export const getLicenseModule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LicenseModuleState> => {
    const S = await import("@/lib/licenses.server");
    let ctx: Awaited<ReturnType<typeof S.licenseAdmin>>;
    try {
      ctx = await S.licenseAdmin(context.userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === NOT_AVAILABLE || message === NO_PERMISSION_MESSAGE) return { enabled: false };
      throw error;
    }
    const { licenseCryptoConfigured } = await import("@/lib/license-crypto.server");
    const db = await S.licenseDb();
    const { data, error } = await db
      .from("license_files")
      .select("id, product, kind, file_name, size_bytes, is_default, created_at")
      .eq("tenant_id", ctx.tenantId)
      .is("archived_at", null)
      .neq("kind", "receipt")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return {
      enabled: true,
      configured: licenseCryptoConfigured(),
      files: ((data ?? []) as FileRow[]).map(toFileSummary),
      branding: await S.licenseBranding(),
    };
  });

// ------------------------------------------------------------
// קבצים: העלאה ישירה לאחסון הפרטי (קישור חתום), ואז רישום אחרי בדיקת חתימה אמיתית בשרת
// ------------------------------------------------------------

export const createLicenseUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { product: string; kind: string; fileName: string; size: number }) => {
    if (!isLicenseProduct(input?.product)) throw new Error("מוצר לא תקין");
    if (!isLicenseFileKind(input?.kind)) throw new Error("סוג קובץ לא תקין");
    const fileName = String(input?.fileName ?? "");
    const extProblem = fileExtensionProblem(fileName, input.kind);
    if (extProblem) throw new Error(extProblem);
    const size = Number(input?.size);
    const sizeProblem = fileSizeProblem(size, input.kind);
    if (sizeProblem) throw new Error(sizeProblem);
    return { product: input.product, kind: input.kind };
  })
  .handler(async ({ data, context }) => {
    const S = await import("@/lib/licenses.server");
    const ctx = await S.licenseAdmin(context.userId);
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`license-upload:${ctx.tenantId}`, 60, 60 * 60 * 1000)) {
      throw new Error("יותר מדי העלאות בשעה האחרונה. נסו שוב מאוחר יותר.");
    }
    const { randomUUID } = await import("node:crypto");
    const path = `${ctx.tenantId}/${randomUUID()}.${extensionFor(data.kind)}`;
    const db = await S.licenseDb();
    const { data: signed, error } = await db.storage
      .from(LICENSE_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(`יצירת העלאה נכשלה${error ? `: ${error.message}` : ""}`);
    return { path, token: signed.token, contentType: contentTypeFor(data.kind) };
  });

export const registerLicenseFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      path: string;
      product: string;
      kind: string;
      fileName: string;
      makeDefault?: boolean;
    }) => {
      if (!isLicenseProduct(input?.product)) throw new Error("מוצר לא תקין");
      if (!isLicenseFileKind(input?.kind)) throw new Error("סוג קובץ לא תקין");
      const path = String(input?.path ?? "");
      return {
        path,
        product: input.product,
        kind: input.kind,
        fileName: cleanFileName(String(input?.fileName ?? ""), input.kind),
        makeDefault: input.kind !== "receipt" && input?.makeDefault === true,
      };
    },
  )
  .handler(async ({ data, context }): Promise<LicenseFileSummary> => {
    const S = await import("@/lib/licenses.server");
    const ctx = await S.licenseAdmin(context.userId);
    const ext = extensionFor(data.kind);
    const pathFormat = new RegExp(
      `^${ctx.tenantId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${ext}$`,
    );
    if (!pathFormat.test(data.path)) throw new Error("נתיב קובץ לא תקין");

    const size = await S.storedObjectSize(data.path);
    if (size === null) throw new Error("הקובץ לא נמצא באחסון — יש להעלות שוב");
    const reject = async (reason: string): Promise<never> => {
      await S.removeStoredObject(data.path).catch(() => {});
      await S.licenseAudit({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: "file_rejected",
        details: { kind: data.kind, product: data.product, reason },
      });
      throw new Error(reason);
    };
    const sizeProblem = fileSizeProblem(size, data.kind);
    if (sizeProblem) await reject(sizeProblem);
    // הקובץ האמיתי — לא הסיומת ולא מה שהדפדפן הצהיר
    const signatureProblem = fileSignatureProblem(data.kind, await S.storedObjectHead(data.path));
    if (signatureProblem) await reject(signatureProblem);

    const db = await S.licenseDb();
    const columns = "id, product, kind, file_name, size_bytes, is_default, created_at";
    let row: FileRow | null = null;
    const inserted = await db
      .from("license_files")
      .insert({
        tenant_id: ctx.tenantId,
        product: data.product,
        kind: data.kind,
        storage_path: data.path,
        file_name: data.fileName,
        size_bytes: size,
        uploaded_by: ctx.userId,
      })
      .select(columns)
      .single();
    if (inserted.error) {
      // רישום כפול של אותו קובץ (לחיצה כפולה) — מחזירים את הקיים
      if (inserted.error.code !== "23505") throw new Error(inserted.error.message);
      const existing = await db
        .from("license_files")
        .select(columns)
        .eq("tenant_id", ctx.tenantId)
        .eq("storage_path", data.path)
        .single();
      if (existing.error) throw new Error(existing.error.message);
      row = existing.data as FileRow;
    } else {
      row = inserted.data as FileRow;
    }
    if (data.makeDefault) {
      const { data: ok, error } = await db.rpc("license_set_default_file", { _file_id: row.id });
      if (error || ok !== true) throw new Error("הקובץ הועלה, אבל לא הוגדר כברירת מחדל");
      row = { ...row, is_default: true };
    }
    await S.licenseAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "file_uploaded",
      fileId: row.id,
      details: { kind: data.kind, product: data.product, size, default: data.makeDefault },
    });
    return toFileSummary(row);
  });

export const setDefaultLicenseFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fileId: string }) => ({ fileId: uuidOf(input?.fileId, "קובץ") }))
  .handler(async ({ data, context }) => {
    const S = await import("@/lib/licenses.server");
    const ctx = await S.licenseAdmin(context.userId);
    const db = await S.licenseDb();
    const { data: ok, error } = await db.rpc("license_set_default_file", { _file_id: data.fileId });
    if (error) throw new Error(error.message);
    if (ok !== true) throw new Error("לא ניתן להגדיר קובץ זה כברירת מחדל");
    await S.licenseAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "file_default",
      fileId: data.fileId,
    });
    return { ok: true };
  });

/** הסרה מהרשימה (ארכיון): לא נבחר יותר לשליחות חדשות; קישורים שכבר נשלחו ממשיכים לעבוד */
export const archiveLicenseFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fileId: string }) => ({ fileId: uuidOf(input?.fileId, "קובץ") }))
  .handler(async ({ data, context }) => {
    const S = await import("@/lib/licenses.server");
    const ctx = await S.licenseAdmin(context.userId);
    const db = await S.licenseDb();
    const { data: rows, error } = await db
      .from("license_files")
      .update({ archived_at: new Date().toISOString(), is_default: false })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", data.fileId)
      .neq("kind", "receipt")
      .is("archived_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new Error("הקובץ לא נמצא");
    await S.licenseAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "file_archived",
      fileId: data.fileId,
    });
    return { ok: true };
  });

// ------------------------------------------------------------
// שליחה
// ------------------------------------------------------------

export type SendLicenseInput = {
  idempotencyKey: string;
  product: LicenseProduct;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  businessId?: string;
  orderNumber?: string;
  licenseKey: string;
  guideFileId?: string | null;
  installerFileId?: string | null;
  receiptFileId?: string | null;
  confirmDuplicate?: boolean;
};

export type SendLicenseResult =
  | {
      kind: "sent";
      deliveryId: string;
      status: EmailStatus;
      error: string | null;
      linkCreated: boolean;
    }
  /** המפתח כבר נשלח בעבר — צריך אישור מפורש */
  | { kind: "duplicate"; message: string }
  /** אותה שליחה כבר בוצעה (לחיצה כפולה / שליחה חוזרת של הבקשה) — לא נשלח מייל נוסף */
  | { kind: "replayed"; deliveryId: string; status: EmailStatus };

/** אותן בדיקות כמו בטופס — אבל כאן הן הקובעות */
export function validateSendLicenseInput(input: SendLicenseInput) {
  const idempotencyKey = uuidOf(input?.idempotencyKey, "מזהה שליחה");
  if (!isLicenseProduct(input?.product)) throw new Error("נא לבחור מוצר");
  const customerName = cleanCustomerName(String(input?.customerName ?? ""));
  const customerEmail = normalizeEmail(String(input?.customerEmail ?? ""));
  const customerPhone = normalizePhone(String(input?.customerPhone ?? ""));
  const businessId = normalizeBusinessId(String(input?.businessId ?? ""));
  const orderNumber = cleanOrderNumber(String(input?.orderNumber ?? ""));
  const licenseKey = normalizeProductKey(String(input?.licenseKey ?? ""));
  const problem =
    customerNameProblem(customerName) ??
    emailProblem(customerEmail) ??
    phoneProblem(customerPhone) ??
    businessIdProblem(businessId) ??
    orderNumberProblem(orderNumber) ??
    productKeyProblem(licenseKey);
  if (problem) throw new Error(problem);
  return {
    idempotencyKey,
    product: input.product,
    customerName,
    customerEmail,
    customerPhone,
    businessId: businessId || null,
    orderNumber: orderNumber || null,
    licenseKey,
    guideFileId: optionalUuid(input?.guideFileId, "קובץ הוראות"),
    installerFileId: optionalUuid(input?.installerFileId, "תוכנת התקנה"),
    receiptFileId: optionalUuid(input?.receiptFileId, "קבלה"),
    confirmDuplicate: input?.confirmDuplicate === true,
  };
}

export const sendLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateSendLicenseInput)
  .handler(async ({ data, context }): Promise<SendLicenseResult> => {
    const S = await import("@/lib/licenses.server");
    const C = await import("@/lib/license-crypto.server");
    const ctx = await S.licenseAdmin(context.userId);
    if (!C.licenseCryptoConfigured()) {
      throw new Error(
        "השרת עוד לא הוגדר לשמירת מפתחות רישיון (LICENSE_KEYS_SECRET) — לא ניתן לשלוח",
      );
    }
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`license-send:${ctx.tenantId}`, 120, 60 * 60 * 1000)) {
      throw new Error("נשלחו יותר מדי רישיונות בשעה האחרונה. נסו שוב מאוחר יותר.");
    }
    const db = await S.licenseDb();
    const replayOf = async (): Promise<SendLicenseResult | null> => {
      const { data: prev } = await db
        .from("license_deliveries")
        .select("id, email_status")
        .eq("tenant_id", ctx.tenantId)
        .eq("idempotency_key", data.idempotencyKey)
        .maybeSingle();
      return prev
        ? {
            kind: "replayed",
            deliveryId: (prev as { id: string }).id,
            status: (prev as { email_status: EmailStatus }).email_status,
          }
        : null;
    };

    // 1. אותה שליחה כבר בוצעה — לא שולחים שוב
    const replay = await replayOf();
    if (replay) return replay;

    // 2. הקבצים: של החנות הזו, מהסוג והמוצר הנכונים, לא בארכיון (המסד בודק שוב)
    const wanted: [string | null, LicenseFileKind, string][] = [
      [data.guideFileId, "guide", "קובץ ההוראות"],
      [data.installerFileId, "installer", "תוכנת ההתקנה"],
      [data.receiptFileId, "receipt", "הקבלה"],
    ];
    const ids = wanted.map(([id]) => id).filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      const { data: files, error } = await db
        .from("license_files")
        .select("id, kind, product, archived_at")
        .eq("tenant_id", ctx.tenantId)
        .in("id", ids);
      if (error) throw new Error(error.message);
      for (const [id, kind, label] of wanted) {
        if (!id) continue;
        const file = (files ?? []).find((f) => (f as { id: string }).id === id) as
          { kind: string; product: string; archived_at: string | null } | undefined;
        if (!file || file.kind !== kind || file.product !== data.product || file.archived_at) {
          throw new Error(`${label} לא נמצא או אינו מתאים למוצר — נא לבחור שוב`);
        }
      }
    }

    // 3. המפתח כבר נשלח בעבר? (טביעה — בלי לפענח שום דבר)
    const fingerprint = C.licenseKeyFingerprint(ctx.tenantId, data.licenseKey);
    if (!data.confirmDuplicate) {
      const { data: prev } = await db
        .from("license_deliveries")
        .select("customer_email, created_at")
        .eq("tenant_id", ctx.tenantId)
        .eq("key_fingerprint", fingerprint)
        .neq("email_status", "failed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prev) {
        const p = prev as { customer_email: string; created_at: string };
        return {
          kind: "duplicate",
          message: `מפתח הרישיון הזה כבר נשלח ל-${maskEmail(p.customer_email)} ב-${formatDateTimeHe(p.created_at)}. לשלוח אותו שוב?`,
        };
      }
    }

    // 4. השורה נשמרת (pending) לפני כל מייל — כך לחיצה כפולה לא שולחת פעמיים (ייחודיות במסד)
    const { randomUUID } = await import("node:crypto");
    const deliveryId = randomUUID();
    const inserted = await db
      .from("license_deliveries")
      .insert({
        id: deliveryId,
        tenant_id: ctx.tenantId,
        idempotency_key: data.idempotencyKey,
        product: data.product,
        customer_name: data.customerName,
        customer_email: data.customerEmail,
        customer_phone: data.customerPhone,
        business_id: data.businessId,
        order_number: data.orderNumber,
        key_ciphertext: C.encryptLicenseKey(
          data.licenseKey,
          C.licenseAad(ctx.tenantId, deliveryId),
        ),
        key_tail: keyTail(data.licenseKey),
        key_fingerprint: fingerprint,
        guide_file_id: data.guideFileId,
        installer_file_id: data.installerFileId,
        receipt_file_id: data.receiptFileId,
        email_status: "pending",
        sent_by: ctx.userId,
      })
      .select("*")
      .single();
    if (inserted.error) {
      if (inserted.error.code === "23505") {
        const again = await replayOf();
        if (again) return again;
      }
      throw new Error(`שמירת השליחה נכשלה: ${inserted.error.message}`);
    }
    const delivery = inserted.data as import("@/lib/licenses.server").LicenseDeliveryRow;

    // 5. קישור ההורדה + המייל
    let linkCreated = false;
    try {
      let linkUrl: string | null = null;
      if (data.installerFileId) {
        linkUrl = (
          await S.createDownloadLink({
            tenantId: ctx.tenantId,
            deliveryId,
            fileId: data.installerFileId,
            actorId: ctx.userId,
          })
        ).url;
        linkCreated = true;
      }
      const result = await S.deliverLicenseEmail({
        delivery,
        licenseKey: data.licenseKey,
        linkUrl,
        actorId: ctx.userId,
      });
      await S.licenseAudit({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: result.status === "failed" ? "send_failed" : "send",
        deliveryId,
        details: {
          product: data.product,
          status: result.status,
          link: linkCreated,
          guide: Boolean(data.guideFileId),
          receipt: Boolean(data.receiptFileId),
        },
      });
      return { kind: "sent", deliveryId, status: result.status, error: result.error, linkCreated };
    } catch (error) {
      const reason = (error instanceof Error ? error.message : "שגיאה לא ידועה")
        .split(data.licenseKey)
        .join("•••••")
        .slice(0, 500);
      await db
        .from("license_deliveries")
        .update({ email_status: "failed", email_error: reason })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", deliveryId);
      await S.licenseAudit({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: "send_failed",
        deliveryId,
        details: { product: data.product, status: "failed", link: linkCreated },
      }).catch(() => {});
      console.error(`[license] send ${deliveryId} failed`);
      throw new Error(`השליחה נכשלה: ${reason}`);
    }
  });

// ------------------------------------------------------------
// היסטוריה
// ------------------------------------------------------------

export type LicenseLinkSummary = {
  id: string;
  state: LinkState;
  downloads: number;
  maxDownloads: number;
  expiresAt: string;
  createdAt: string;
  lastDownloadAt: string | null;
  revokedReason: string | null;
};
export type LicenseDeliveryListItem = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  product: LicenseProduct;
  orderNumber: string | null;
  sentAt: string | null;
  createdAt: string;
  emailStatus: EmailStatus;
  providerEvent: string | null;
  keyMasked: string;
  sendCount: number;
  link: LicenseLinkSummary | null;
  sentByName: string | null;
};

type LinkRowLite = {
  id: string;
  delivery_id: string;
  expires_at: string;
  max_downloads: number;
  download_count: number;
  revoked_at: string | null;
  revoked_reason: string | null;
  last_download_at: string | null;
  created_at: string;
};
const toLinkSummary = (l: LinkRowLite): LicenseLinkSummary => ({
  id: l.id,
  state: linkState(l),
  downloads: l.download_count,
  maxDownloads: l.max_downloads,
  expiresAt: l.expires_at,
  createdAt: l.created_at,
  lastDownloadAt: l.last_download_at,
  revokedReason: l.revoked_reason,
});

async function staffNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return names;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, display_name, username, email")
    .eq("tenant_id", tenantId)
    .in("user_id", unique);
  for (const r of data ?? []) {
    names.set(r.user_id, r.display_name?.trim() || r.username?.trim() || r.email?.trim() || "צוות");
  }
  return names;
}

export const listLicenseDeliveries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { page?: number; query?: string; product?: string }) => {
    const page = Math.max(0, Math.min(500, Math.floor(Number(input?.page ?? 0)) || 0));
    // חיפוש: רק אותיות / ספרות / @ . + - ורווח (בלי תווים מיוחדים של מסנני ה-API)
    const query = String(input?.query ?? "")
      .replace(/[^\p{L}\p{N}@.+\- ]/gu, "")
      .trim()
      .slice(0, 60);
    const product = isLicenseProduct(input?.product) ? input.product : null;
    return { page, query, product };
  })
  .handler(async ({ data, context }) => {
    const S = await import("@/lib/licenses.server");
    const ctx = await S.licenseAdmin(context.userId);
    const db = await S.licenseDb();
    let q = db
      .from("license_deliveries")
      .select(
        "id, customer_name, customer_email, customer_phone, product, order_number, sent_at, created_at, email_status, provider_last_event, key_tail, sent_by, send_count",
        { count: "exact" },
      )
      .eq("tenant_id", ctx.tenantId);
    if (data.product) q = q.eq("product", data.product);
    if (data.query) {
      const v = `"*${data.query}*"`;
      q = q.or(
        `customer_name.ilike.${v},customer_email.ilike.${v},customer_phone.ilike.${v},order_number.ilike.${v}`,
      );
    }
    const {
      data: rows,
      error,
      count,
    } = await q
      .order("created_at", { ascending: false })
      .range(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    type Row = {
      id: string;
      customer_name: string;
      customer_email: string;
      customer_phone: string;
      product: LicenseProduct;
      order_number: string | null;
      sent_at: string | null;
      created_at: string;
      email_status: EmailStatus;
      provider_last_event: string | null;
      key_tail: string;
      sent_by: string | null;
      send_count: number;
    };
    const list = (rows ?? []) as Row[];
    const ids = list.map((r) => r.id);
    const latest = new Map<string, LinkRowLite>();
    if (ids.length > 0) {
      const { data: links, error: linkError } = await db
        .from("license_download_links")
        .select(
          "id, delivery_id, expires_at, max_downloads, download_count, revoked_at, revoked_reason, last_download_at, created_at",
        )
        .eq("tenant_id", ctx.tenantId)
        .in("delivery_id", ids)
        .order("created_at", { ascending: false });
      if (linkError) throw new Error(linkError.message);
      for (const l of (links ?? []) as LinkRowLite[])
        if (!latest.has(l.delivery_id)) latest.set(l.delivery_id, l);
    }
    const names = await staffNames(
      ctx.tenantId,
      list.map((r) => r.sent_by ?? ""),
    );
    const items: LicenseDeliveryListItem[] = list.map((r) => ({
      id: r.id,
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      customerPhone: r.customer_phone,
      product: r.product,
      orderNumber: r.order_number,
      sentAt: r.sent_at,
      createdAt: r.created_at,
      emailStatus: r.email_status,
      providerEvent: r.provider_last_event,
      keyMasked: maskedKey(r.key_tail),
      sendCount: r.send_count,
      link: latest.has(r.id) ? toLinkSummary(latest.get(r.id)!) : null,
      sentByName: r.sent_by ? (names.get(r.sent_by) ?? null) : null,
    }));
    return { items, total: count ?? items.length, page: data.page, pageSize: PAGE_SIZE };
  });

export type LicenseAuditDetails = Record<string, string | number | boolean | null>;
export type LicenseAuditItem = {
  action: string;
  at: string;
  actorName: string | null;
  details: LicenseAuditDetails;
};

/** פרטי היומן — רק ערכים פשוטים (מספרים / טקסט קצר / כן-לא) */
function plainDetails(value: unknown): LicenseAuditDetails {
  const out: LicenseAuditDetails = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v;
      else if (typeof v === "string") out[k] = v.slice(0, 200);
    }
  }
  return out;
}
export type LicenseDeliveryDetails = LicenseDeliveryListItem & {
  businessId: string | null;
  emailError: string | null;
  statusCheckedAt: string | null;
  files: { kind: LicenseFileKind; fileName: string }[];
  links: LicenseLinkSummary[];
  audit: LicenseAuditItem[];
};

export const getLicenseDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => ({ id: uuidOf(input?.id, "שליחה") }))
  .handler(async ({ data, context }): Promise<LicenseDeliveryDetails> => {
    const S = await import("@/lib/licenses.server");
    const ctx = await S.licenseAdmin(context.userId);
    const db = await S.licenseDb();
    const { data: row, error } = await db
      .from("license_deliveries")
      .select(
        "id, customer_name, customer_email, customer_phone, business_id, product, order_number, sent_at, created_at, email_status, provider_last_event, email_error, status_checked_at, key_tail, sent_by, send_count, guide_file_id, installer_file_id, receipt_file_id",
      )
      .eq("tenant_id", ctx.tenantId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("השליחה לא נמצאה");
    type DetailRow = {
      id: string;
      customer_name: string;
      customer_email: string;
      customer_phone: string;
      business_id: string | null;
      product: LicenseProduct;
      order_number: string | null;
      sent_at: string | null;
      created_at: string;
      email_status: EmailStatus;
      provider_last_event: string | null;
      email_error: string | null;
      status_checked_at: string | null;
      key_tail: string;
      sent_by: string | null;
      send_count: number;
      guide_file_id: string | null;
      installer_file_id: string | null;
      receipt_file_id: string | null;
    };
    const d = row as DetailRow;
    const fileIds = [d.guide_file_id, d.installer_file_id, d.receipt_file_id].filter(
      (x): x is string => Boolean(x),
    );
    const [files, links, audit] = await Promise.all([
      fileIds.length
        ? db
            .from("license_files")
            .select("id, kind, file_name")
            .eq("tenant_id", ctx.tenantId)
            .in("id", fileIds)
        : Promise.resolve({ data: [], error: null }),
      db
        .from("license_download_links")
        .select(
          "id, delivery_id, expires_at, max_downloads, download_count, revoked_at, revoked_reason, last_download_at, created_at",
        )
        .eq("tenant_id", ctx.tenantId)
        .eq("delivery_id", d.id)
        .order("created_at", { ascending: false }),
      db
        .from("license_audit")
        .select("action, created_at, actor_id, details")
        .eq("tenant_id", ctx.tenantId)
        .eq("delivery_id", d.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const auditRows = (audit.data ?? []) as {
      action: string;
      created_at: string;
      actor_id: string | null;
      details: unknown;
    }[];
    const names = await staffNames(ctx.tenantId, [
      d.sent_by ?? "",
      ...auditRows.map((a) => a.actor_id ?? ""),
    ]);
    const linkRows = (links.data ?? []) as LinkRowLite[];
    return {
      id: d.id,
      customerName: d.customer_name,
      customerEmail: d.customer_email,
      customerPhone: d.customer_phone,
      businessId: d.business_id,
      product: d.product,
      orderNumber: d.order_number,
      sentAt: d.sent_at,
      createdAt: d.created_at,
      emailStatus: d.email_status,
      providerEvent: d.provider_last_event,
      emailError: d.email_error,
      statusCheckedAt: d.status_checked_at,
      keyMasked: maskedKey(d.key_tail),
      sendCount: Number(d.send_count),
      sentByName: d.sent_by ? (names.get(d.sent_by) ?? null) : null,
      link: linkRows[0] ? toLinkSummary(linkRows[0]) : null,
      files: ((files.data ?? []) as { kind: LicenseFileKind; file_name: string }[]).map((f) => ({
        kind: f.kind,
        fileName: f.file_name,
      })),
      links: linkRows.map(toLinkSummary),
      audit: auditRows.map((a) => ({
        action: a.action,
        at: a.created_at,
        actorName: a.actor_id ? (names.get(a.actor_id) ?? null) : null,
        details: plainDetails(a.details),
      })),
    };
  });

// ------------------------------------------------------------
// הצגת המפתח המלא — מורשה בלבד, כל צפייה נרשמת ביומן (לפני שהמפתח חוזר)
// ------------------------------------------------------------

export const revealLicenseKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deliveryId: string }) => ({
    deliveryId: uuidOf(input?.deliveryId, "שליחה"),
  }))
  .handler(async ({ data, context }) => {
    const S = await import("@/lib/licenses.server");
    const C = await import("@/lib/license-crypto.server");
    const ctx = await S.licenseAdmin(context.userId);
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`license-reveal:${ctx.tenantId}:${ctx.userId}`, 30, 60 * 60 * 1000)) {
      throw new Error("יותר מדי צפיות במפתחות בשעה האחרונה. נסו שוב מאוחר יותר.");
    }
    const db = await S.licenseDb();
    const { data: row, error } = await db
      .from("license_deliveries")
      .select("id, key_ciphertext")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", data.deliveryId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("השליחה לא נמצאה");
    const key = C.decryptLicenseKey(
      (row as { key_ciphertext: string }).key_ciphertext,
      C.licenseAad(ctx.tenantId, data.deliveryId),
    );
    await S.licenseAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "reveal_key",
      deliveryId: data.deliveryId,
    });
    return { key };
  });

// ------------------------------------------------------------
// קישור חדש / שליחה חוזרת / ביטול קישור / רענון סטטוס
// ------------------------------------------------------------

async function loadDelivery(tenantId: string, id: string) {
  const S = await import("@/lib/licenses.server");
  const db = await S.licenseDb();
  const { data, error } = await db
    .from("license_deliveries")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("השליחה לא נמצאה");
  return data as import("@/lib/licenses.server").LicenseDeliveryRow;
}

/** תוכנת ההתקנה לקישור חדש: ברירת המחדל הנוכחית של המוצר, אחרת זו שנשלחה (אם לא בארכיון) */
async function installerForNewLink(
  tenantId: string,
  delivery: { product: LicenseProduct; installer_file_id: string | null },
) {
  const S = await import("@/lib/licenses.server");
  const db = await S.licenseDb();
  const { data: current } = await db
    .from("license_files")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("product", delivery.product)
    .eq("kind", "installer")
    .eq("is_default", true)
    .is("archived_at", null)
    .maybeSingle();
  if (current) return (current as { id: string }).id;
  if (delivery.installer_file_id) {
    const { data: original } = await db
      .from("license_files")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", delivery.installer_file_id)
      .is("archived_at", null)
      .maybeSingle();
    if (original) return (original as { id: string }).id;
  }
  return null;
}

export const regenerateLicenseLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deliveryId: string; emailCustomer?: boolean }) => ({
    deliveryId: uuidOf(input?.deliveryId, "שליחה"),
    emailCustomer: input?.emailCustomer === true,
  }))
  .handler(async ({ data, context }) => {
    const S = await import("@/lib/licenses.server");
    const C = await import("@/lib/license-crypto.server");
    const ctx = await S.licenseAdmin(context.userId);
    const delivery = await loadDelivery(ctx.tenantId, data.deliveryId);
    const fileId = await installerForNewLink(ctx.tenantId, delivery);
    if (!fileId) throw new Error("אין תוכנת התקנה פעילה למוצר — יש להעלות קובץ במסך הקבצים");
    const link = await S.createDownloadLink({
      tenantId: ctx.tenantId,
      deliveryId: delivery.id,
      fileId,
      actorId: ctx.userId,
    });
    let emailStatus: EmailStatus | null = null;
    if (data.emailCustomer) {
      if (!C.licenseCryptoConfigured())
        throw new Error("השרת לא הוגדר לשמירת מפתחות (LICENSE_KEYS_SECRET)");
      const key = C.decryptLicenseKey(
        delivery.key_ciphertext,
        C.licenseAad(ctx.tenantId, delivery.id),
      );
      const result = await S.deliverLicenseEmail({
        delivery,
        licenseKey: key,
        linkUrl: link.url,
        actorId: ctx.userId,
      });
      emailStatus = result.status;
      await S.licenseAudit({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: "resend",
        deliveryId: delivery.id,
        linkId: link.linkId,
        details: { status: result.status, link: true },
      });
    }
    // הקישור מוצג פעם אחת (להעתקה) — במסד נשמר רק ה-hash שלו
    return { url: link.url, expiresAt: link.expiresAt, emailStatus };
  });

export const resendLicenseEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deliveryId: string }) => ({
    deliveryId: uuidOf(input?.deliveryId, "שליחה"),
  }))
  .handler(async ({ data, context }) => {
    const S = await import("@/lib/licenses.server");
    const C = await import("@/lib/license-crypto.server");
    const ctx = await S.licenseAdmin(context.userId);
    if (!C.licenseCryptoConfigured())
      throw new Error("השרת לא הוגדר לשמירת מפתחות (LICENSE_KEYS_SECRET)");
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`license-send:${ctx.tenantId}`, 120, 60 * 60 * 1000)) {
      throw new Error("נשלחו יותר מדי רישיונות בשעה האחרונה. נסו שוב מאוחר יותר.");
    }
    const delivery = await loadDelivery(ctx.tenantId, data.deliveryId);
    // ה-Token של הקישור הקודם לא נשמר — לכן שליחה חוזרת יוצרת קישור חדש (הקודם מבוטל)
    const fileId = delivery.installer_file_id
      ? await installerForNewLink(ctx.tenantId, delivery)
      : null;
    const link = fileId
      ? await S.createDownloadLink({
          tenantId: ctx.tenantId,
          deliveryId: delivery.id,
          fileId,
          actorId: ctx.userId,
        })
      : null;
    const key = C.decryptLicenseKey(
      delivery.key_ciphertext,
      C.licenseAad(ctx.tenantId, delivery.id),
    );
    const result = await S.deliverLicenseEmail({
      delivery,
      licenseKey: key,
      linkUrl: link?.url ?? null,
      actorId: ctx.userId,
    });
    await S.licenseAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "resend",
      deliveryId: delivery.id,
      linkId: link?.linkId ?? null,
      details: { status: result.status, link: Boolean(link) },
    });
    return { status: result.status, error: result.error, linkCreated: Boolean(link) };
  });

export const revokeLicenseLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => ({ linkId: uuidOf(input?.linkId, "קישור") }))
  .handler(async ({ data, context }) => {
    const S = await import("@/lib/licenses.server");
    const ctx = await S.licenseAdmin(context.userId);
    const db = await S.licenseDb();
    const { data: rows, error } = await db
      .from("license_download_links")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: "manual" })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", data.linkId)
      .is("revoked_at", null)
      .select("id, delivery_id");
    if (error) throw new Error(error.message);
    const row = (rows ?? [])[0] as { id: string; delivery_id: string } | undefined;
    if (!row) throw new Error("הקישור לא נמצא או שכבר בוטל");
    await S.licenseAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "link_revoked",
      deliveryId: row.delivery_id,
      linkId: row.id,
    });
    return { ok: true };
  });

async function refreshOne(tenantId: string, actorId: string, id: string) {
  const S = await import("@/lib/licenses.server");
  const db = await S.licenseDb();
  const { data: row } = await db
    .from("license_deliveries")
    .select("id, email_status, provider_message_id, provider_last_event")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new Error("השליחה לא נמצאה");
  const r = row as {
    email_status: EmailStatus;
    provider_message_id: string | null;
    provider_last_event: string | null;
  };
  if (!r.provider_message_id) return { status: r.email_status, event: r.provider_last_event };
  const event = await S.providerLastEvent(r.provider_message_id);
  const status = S.nextEmailStatus(r.email_status, event);
  await db
    .from("license_deliveries")
    .update({
      email_status: status,
      provider_last_event: event ?? r.provider_last_event,
      status_checked_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (status !== r.email_status) {
    await S.licenseAudit({
      tenantId,
      actorId,
      action: "status_refreshed",
      deliveryId: id,
      details: { from: r.email_status, to: status, event: event ?? null },
    });
  }
  return { status, event: event ?? r.provider_last_event };
}

export const refreshLicenseStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deliveryId: string }) => ({
    deliveryId: uuidOf(input?.deliveryId, "שליחה"),
  }))
  .handler(async ({ data, context }) => {
    const S = await import("@/lib/licenses.server");
    const ctx = await S.licenseAdmin(context.userId);
    return refreshOne(ctx.tenantId, ctx.userId, data.deliveryId);
  });

/** רענון השליחות האחרונות שעדיין לא סופיות (עד 10, בקצב שהספק מאפשר) */
export const refreshRecentLicenseStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const S = await import("@/lib/licenses.server");
    const ctx = await S.licenseAdmin(context.userId);
    const db = await S.licenseDb();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await db
      .from("license_deliveries")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .in("email_status", ["accepted", "unknown"])
      .not("provider_message_id", "is", null)
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(10);
    let updated = 0;
    for (const row of (data ?? []) as { id: string }[]) {
      await refreshOne(ctx.tenantId, ctx.userId, row.id);
      updated += 1;
      await new Promise((r) => setTimeout(r, 550)); // Resend: עד 2 בקשות בשנייה
    }
    return { checked: updated };
  });
