// ============================================================
// מודול הרישיונות — עזרי שרת: הקשר החנות (Tenant מהשרת + דגל הפיילוט + הרשאה), יומן,
// אחסון פרטי, מיתוג המייל, סטטוס מ-Resend, קישורי הורדה ושליחת המייל.
// אף פונקציה כאן לא כותבת מפתח / Token ללוג.
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LICENSE_BUCKET,
  LICENSE_FLAG,
  LINK_MAX_DOWNLOADS,
  LINK_VALID_DAYS,
  downloadUrl,
  statusFromProviderEvent,
  type EmailStatus,
  type LicenseProduct,
} from "@/lib/licenses";
import type { LicenseEmailBranding } from "@/lib/license-email";

export const NOT_AVAILABLE = "הפעולה אינה זמינה בחנות זו";

/**
 * הלקוח של שרת האפליקציה (service role) — אותו לקוח מוגבל-חנות (x-tenant-id מהשרת),
 * בלי טיפוסים: טבלאות המודול עוד לא בקובץ הטיפוסים שנוצר (types.ts). טיפוסי השורות — כאן.
 */
export async function licenseDb(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

export type LicenseFileRow = {
  id: string;
  tenant_id: string;
  product: LicenseProduct;
  kind: "guide" | "installer" | "receipt";
  storage_path: string;
  file_name: string;
  size_bytes: number;
  is_default: boolean;
  archived_at: string | null;
  uploaded_by: string | null;
  created_at: string;
};

export type LicenseDeliveryRow = {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  product: LicenseProduct;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  business_id: string | null;
  order_number: string | null;
  key_ciphertext: string;
  key_tail: string;
  key_fingerprint: string;
  guide_file_id: string | null;
  installer_file_id: string | null;
  receipt_file_id: string | null;
  email_status: EmailStatus;
  provider_message_id: string | null;
  provider_last_event: string | null;
  email_error: string | null;
  status_checked_at: string | null;
  send_count: number;
  sent_by: string | null;
  sent_at: string | null;
  created_at: string;
};

export type LicenseLinkRow = {
  id: string;
  delivery_id: string;
  file_id: string;
  expires_at: string;
  max_downloads: number;
  download_count: number;
  revoked_at: string | null;
  revoked_reason: string | null;
  last_download_at: string | null;
  created_by: string | null;
  created_at: string;
};

// ------------------------------------------------------------
// הקשר: החנות נקבעת בשרת לפי ה-host (לא מהדפדפן), הפיילוט פעיל לה, ולקורא יש הרשאה
// ------------------------------------------------------------

/** החנות של הבקשה, רק אם הפיילוט פעיל לה (גם לנקודות הציבוריות — עמוד ההורדה) */
export async function licenseStore(): Promise<{ tenantId: string; tenantName: string }> {
  const { maybeCurrentTenant, isPlatformRequest } =
    await import("@/integrations/supabase/tenant.server");
  const tenant = maybeCurrentTenant();
  if (!tenant || isPlatformRequest()) throw new Error(NOT_AVAILABLE);
  const { featureEnabled } = await import("@/platform/feature-flags/flags.server");
  if (!(await featureEnabled(LICENSE_FLAG, tenant.id))) throw new Error(NOT_AVAILABLE);
  return { tenantId: tenant.id, tenantName: tenant.name };
}

/** פעולות ניהול: החנות + הרשאת ניהול מלאה (בעל החנות / מנהל חנות) */
export async function licenseAdmin(userId: string) {
  const store = await licenseStore();
  const { requireStaffPermission } = await import("@/lib/caller.server");
  const caller = await requireStaffPermission(userId, "admin");
  return { ...store, userId, caller };
}

// ------------------------------------------------------------
// יומן (append-only במסד). אף פעם לא מפתח / Token / נתיב פנימי בפרטים.
// ------------------------------------------------------------

export type LicenseAuditAction =
  | "send"
  | "send_failed"
  | "resend"
  | "reveal_key"
  | "link_created"
  | "link_revoked"
  | "file_uploaded"
  | "file_rejected"
  | "file_default"
  | "file_archived"
  | "status_refreshed";

export async function licenseAudit(entry: {
  tenantId: string;
  actorId: string | null;
  action: LicenseAuditAction;
  deliveryId?: string | null;
  linkId?: string | null;
  fileId?: string | null;
  details?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  const db = await licenseDb();
  const { error } = await db.from("license_audit").insert({
    tenant_id: entry.tenantId,
    actor_id: entry.actorId,
    action: entry.action,
    delivery_id: entry.deliveryId ?? null,
    link_id: entry.linkId ?? null,
    file_id: entry.fileId ?? null,
    details: entry.details ?? {},
  });
  if (error) throw new Error(`רישום ביומן נכשל: ${error.message}`);
}

// ------------------------------------------------------------
// אחסון פרטי (license-files). הנתיב לא יוצא לדפדפן אף פעם.
// ------------------------------------------------------------

async function storageEndpoint(
  path: string,
): Promise<{ url: string; headers: Record<string, string> }> {
  const { supabaseUrl, serviceHeaders } = await import("@/platform/supabase/env.server");
  const headers = serviceHeaders();
  delete headers["Content-Type"];
  const safe = path.split("/").map(encodeURIComponent).join("/");
  return { url: `${supabaseUrl()}/storage/v1/object/${LICENSE_BUCKET}/${safe}`, headers };
}

/** גודל הקובץ באחסון (null = לא קיים) */
export async function storedObjectSize(path: string): Promise<number | null> {
  const db = await licenseDb();
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await db.storage
    .from(LICENSE_BUCKET)
    .list(folder, { search: name, limit: 5 });
  if (error) throw new Error(`בדיקת הקובץ באחסון נכשלה: ${error.message}`);
  const found = (data ?? []).find((item) => item.name === name);
  if (!found) return null;
  const size = Number((found.metadata as { size?: unknown } | null)?.size);
  return Number.isFinite(size) ? size : null;
}

/** תחילת הקובץ (לבדיקת החתימה) — Range, ואם השרת מתעלם ממנו: קוראים רק את ההתחלה וסוגרים */
export async function storedObjectHead(path: string, bytes = 65536): Promise<Uint8Array> {
  const { url, headers } = await storageEndpoint(path);
  const response = await fetch(url, { headers: { ...headers, Range: `bytes=0-${bytes - 1}` } });
  if (!response.ok || !response.body) throw new Error(`קריאת הקובץ נכשלה (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < bytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(total, bytes));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, out.length - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.length) break;
  }
  return out;
}

/** הקובץ כולו (מדריך / קבלה למייל — עד 15MB) */
export async function storedObjectBuffer(path: string): Promise<Buffer> {
  const db = await licenseDb();
  const { data, error } = await db.storage.from(LICENSE_BUCKET).download(path);
  if (error || !data)
    throw new Error(`הורדת הקובץ מהאחסון נכשלה${error ? `: ${error.message}` : ""}`);
  return Buffer.from(await data.arrayBuffer());
}

/** זרם הקובץ (להורדה ללקוח — בלי לטעון לזיכרון) */
export async function storedObjectStream(path: string): Promise<Response> {
  const { url, headers } = await storageEndpoint(path);
  return fetch(url, { headers });
}

export async function removeStoredObject(path: string): Promise<void> {
  const db = await licenseDb();
  await db.storage.from(LICENSE_BUCKET).remove([path]);
}

// ------------------------------------------------------------
// מיתוג המייל — מהגדרות החנות הקיימות (לוגו, שם העסק, טלפון, אימייל, כתובת, צבע)
// ------------------------------------------------------------

export async function licenseBranding(): Promise<LicenseEmailBranding> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { publicLogoUrl } = await import("@/lib/email.server");
  const { tenantSiteOrigin, maybeCurrentTenant } =
    await import("@/integrations/supabase/tenant.server");
  const { data } = await supabaseAdmin
    .from("site_settings")
    .select(
      "site_title, business_name, logo_path, support_phone, business_phone, business_email, business_address, brand_color",
    )
    .eq("id", true)
    .maybeSingle();
  let website: string | null = null;
  try {
    website = tenantSiteOrigin();
  } catch {
    website = null;
  }
  const color = (data as { brand_color?: string | null } | null)?.brand_color ?? "";
  return {
    businessName:
      data?.business_name?.trim() || data?.site_title?.trim() || maybeCurrentTenant()?.name || "",
    logoUrl: publicLogoUrl(data?.logo_path ?? null),
    phone: (data?.support_phone || data?.business_phone || "").trim() || null,
    email: data?.business_email?.trim() || null,
    website,
    address: data?.business_address?.trim() || null,
    accent: /^#[0-9a-f]{6}$/i.test(color) ? color : "#1F5FD6",
  };
}

// ------------------------------------------------------------
// סטטוס מ-Resend (GET /emails/:id → last_event). null = אין תשובה ודאית
// ------------------------------------------------------------

export async function providerLastEvent(messageId: string): Promise<string | null> {
  const { resendApiUrl, resendApiKey } = await import("@/lib/email.server");
  const key = resendApiKey();
  if (!key || !/^[A-Za-z0-9_-]{1,200}$/.test(messageId)) return null;
  try {
    const response = await fetch(`${resendApiUrl()}/emails/${encodeURIComponent(messageId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as { last_event?: unknown } | null;
    return typeof payload?.last_event === "string" ? payload.last_event.slice(0, 40) : null;
  } catch {
    return null;
  }
}

/** סטטוס חדש — לא חוזר אחורה ממצב סופי (נמסר / נכשל) */
export function nextEmailStatus(current: EmailStatus, event: string | null): EmailStatus {
  const mapped = statusFromProviderEvent(event);
  if (!mapped) return current;
  if (current === "delivered" && mapped !== "failed") return current;
  if (current === "failed" && mapped !== "delivered") return current;
  return mapped;
}

// ------------------------------------------------------------
// קישור הורדה: מבטל את הקישורים הפעילים של השליחה ויוצר חדש. ה-Token חוזר רק לזיכרון.
// ------------------------------------------------------------

export async function createDownloadLink(input: {
  tenantId: string;
  deliveryId: string;
  fileId: string;
  actorId: string | null;
}): Promise<{ url: string; linkId: string; expiresAt: string }> {
  const db = await licenseDb();
  const { newDownloadToken } = await import("@/lib/license-crypto.server");
  const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
  const now = new Date();
  await db
    .from("license_download_links")
    .update({ revoked_at: now.toISOString(), revoked_reason: "replaced" })
    .eq("tenant_id", input.tenantId)
    .eq("delivery_id", input.deliveryId)
    .is("revoked_at", null);
  const { token, hash } = newDownloadToken();
  const expiresAt = new Date(now.getTime() + LINK_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("license_download_links")
    .insert({
      tenant_id: input.tenantId,
      delivery_id: input.deliveryId,
      file_id: input.fileId,
      token_hash: hash,
      expires_at: expiresAt,
      max_downloads: LINK_MAX_DOWNLOADS,
      created_by: input.actorId,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`יצירת קישור ההורדה נכשלה${error ? `: ${error.message}` : ""}`);
  await licenseAudit({
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: "link_created",
    deliveryId: input.deliveryId,
    linkId: (data as { id: string }).id,
    fileId: input.fileId,
    details: { days: LINK_VALID_DAYS, max: LINK_MAX_DOWNLOADS },
  });
  return {
    url: downloadUrl(tenantSiteOrigin(), token),
    linkId: (data as { id: string }).id,
    expiresAt,
  };
}

// ------------------------------------------------------------
// שליחת המייל + עדכון הסטטוס האמיתי בשורה
// ------------------------------------------------------------

export async function deliverLicenseEmail(input: {
  delivery: LicenseDeliveryRow;
  licenseKey: string;
  linkUrl: string | null;
  actorId: string;
}): Promise<{ status: EmailStatus; error: string | null }> {
  const db = await licenseDb();
  const { sendEmail } = await import("@/lib/email.server");
  const { buildLicenseEmailHtml, licenseEmailSubject } = await import("@/lib/license-email");
  const d = input.delivery;

  // הקבצים המצורפים: מדריך ההתקנה וקבלה (אם יש) — מהאחסון הפרטי
  const fileIds = [d.guide_file_id, d.receipt_file_id].filter((id): id is string => Boolean(id));
  const attachments: { filename: string; content: string }[] = [];
  if (fileIds.length > 0) {
    const { data: files, error } = await db
      .from("license_files")
      .select("id, storage_path, file_name")
      .eq("tenant_id", d.tenant_id)
      .in("id", fileIds);
    if (error) throw new Error(`טעינת הקבצים המצורפים נכשלה: ${error.message}`);
    for (const id of fileIds) {
      const file = (files ?? []).find((f) => (f as { id: string }).id === id) as
        { storage_path: string; file_name: string } | undefined;
      if (!file) throw new Error("קובץ מצורף לא נמצא");
      const buffer = await storedObjectBuffer(file.storage_path);
      attachments.push({ filename: file.file_name, content: buffer.toString("base64") });
    }
  }

  const html = buildLicenseEmailHtml(
    {
      customerName: d.customer_name,
      product: d.product,
      licenseKey: input.licenseKey,
      orderNumber: d.order_number,
      downloadUrl: input.linkUrl,
      attachments: attachments.map((a) => a.filename),
    },
    await licenseBranding(),
  );
  const result = await sendEmail({
    to: [d.customer_email],
    subject: licenseEmailSubject(d.product),
    html,
    attachments,
  });

  // הסטטוס האמיתי: "התקבל לשליחה" כשהספק אישר קבלה; "נמסר" רק אחרי אישור מסירה (רענון);
  // תקלת רשת → "לא ידוע" (ייתכן שהמייל כן יצא)
  const status: EmailStatus =
    result.outcome === "accepted"
      ? "accepted"
      : result.outcome === "transport_error"
        ? "unknown"
        : "failed";
  // הודעת השגיאה נשמרת — בלי המפתח, גם אם הספק החזיר אותו בתשובה
  const error =
    status === "accepted"
      ? null
      : (result.reason ?? "שגיאה לא ידועה").split(input.licenseKey).join("•••••").slice(0, 500);
  const { error: updateError } = await db
    .from("license_deliveries")
    .update({
      email_status: status,
      provider_message_id: result.id ?? null,
      provider_last_event: null,
      email_error: error,
      status_checked_at: null,
      sent_at: new Date().toISOString(),
      sent_by: input.actorId,
      send_count: d.send_count + 1,
    })
    .eq("tenant_id", d.tenant_id)
    .eq("id", d.id);
  if (updateError) throw new Error(`עדכון סטטוס השליחה נכשל: ${updateError.message}`);
  return { status, error };
}
