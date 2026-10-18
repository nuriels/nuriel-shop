/**
 * חלק 42: תיק לקוח מרכזי — פונקציות שרת למנהל-על בלבד.
 *
 * כל פונקציה בודקת בשרת (is_platform_admin במסד) לפני כל גישה; הקריאות עצמן
 * עם service_role בלי סינון חנות (הפלטפורמה רואה את כל החנויות). מסמכים נשמרים
 * בדלי פרטי, והצפייה רק בקישור חתום קצר-מועד. אין כאן מחיקה של חתימות או מסמכים.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PLATFORM_DOCS_BUCKET = "platform-documents";
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export const DOC_KINDS = ["invoice", "receipt", "agreement", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export type CustomerFileData = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    domain: string | null;
    ownerEmail: string | null;
    taxId: string | null;
    plan: string;
    status: string;
    createdAt: string;
  };
  owners: { userId: string; email: string }[];
  versions: { version: number; title: string; isCurrent: boolean; createdAt: string }[];
  acceptances: {
    id: string;
    version: number;
    status: string;
    ownerEmail: string;
    signerName: string | null;
    signedAt: string | null;
    hasSignature: boolean;
    contentSha256: string | null;
    signerIp: string | null;
    createdAt: string;
    tokenExpiresAt: string | null;
  }[];
  documents: {
    id: string;
    kind: string;
    title: string;
    fileName: string;
    sizeBytes: number;
    docDate: string | null;
    note: string | null;
    version: number;
    isArchived: boolean;
    uploadedByEmail: string | null;
    createdAt: string;
  }[];
  emails: {
    id: string;
    toEmail: string;
    subject: string;
    kind: string;
    status: string;
    providerMessageId: string | null;
    error: string | null;
    createdAt: string;
  }[];
  audit: {
    id: number;
    action: string;
    actorEmail: string | null;
    details: Record<string, string | number | boolean | null>;
    createdAt: string;
  }[];
};

function uuidOf(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} לא תקין`);
  }
  return text.toLowerCase();
}

/** פרטי יומן כמפה שטוחה של ערכים פשוטים (לתצוגה) */
function flatDetails(value: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      out[key] =
        typeof item === "string" || typeof item === "number" || typeof item === "boolean"
          ? item
          : item === null
            ? null
            : JSON.stringify(item).slice(0, 300);
    }
  }
  return out;
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

type AuthContext = {
  supabase: { rpc: (fn: "is_platform_admin", args: Record<string, never>) => PromiseLike<unknown> };
};

/** בדיקת מנהל-על בשרת (גם ה-RLS במסד חוסם — זו שכבה נוספת) */
async function assertPlatformAdmin(context: AuthContext): Promise<void> {
  const result = (await context.supabase.rpc("is_platform_admin", {})) as {
    data: unknown;
    error: { message: string } | null;
  };
  if (result.error) throw new Error(result.error.message);
  if (result.data !== true) throw new Error("אין הרשאה");
}

/** כל התיק במכה אחת (מוגבל בכמות כדי לא להכביד) */
export const loadCustomerFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => ({
    tenantId: uuidOf(input?.tenantId, "מזהה חנות"),
  }))
  .handler(async ({ data, context }): Promise<CustomerFileData> => {
    await assertPlatformAdmin(context as unknown as AuthContext);
    const { supabaseAdminUnscoped: db } = await import("@/integrations/supabase/client.server");
    const tenantId = data.tenantId;

    const [tenant, roles, versions, acceptances, documents, emails, audit] = await Promise.all([
      db
        .from("tenants")
        .select("id, slug, name, domain, owner_email, tax_id, plan, status, created_at")
        .eq("id", tenantId)
        .maybeSingle(),
      db.from("user_roles").select("user_id").eq("tenant_id", tenantId).eq("role", "admin"),
      db
        .from("platform_agreement_versions")
        .select("version, title, is_current, created_at")
        .order("version", { ascending: false })
        .limit(50),
      db
        .from("platform_agreement_acceptances")
        .select(
          "id, version, status, owner_email, signer_name, signed_at, signature_svg, content_sha256, signer_ip, created_at, token_expires_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("platform_documents")
        .select(
          "id, kind, title, file_name, size_bytes, doc_date, note, version, is_archived, uploaded_by_email, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("is_archived", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("platform_email_log")
        .select("id, to_email, subject, kind, status, provider_message_id, error, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("platform_audit_log")
        .select("id, action, actor_email, details, created_at")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: false })
        .limit(100),
    ]);

    if (!tenant.data) throw new Error("החנות לא נמצאה");

    // אימיילים של מנהלי החנות (משתמשי Auth) — לתצוגה בלבד
    const owners: { userId: string; email: string }[] = [];
    for (const row of roles.data ?? []) {
      const { data: user } = await db.auth.admin.getUserById(row.user_id);
      if (user?.user?.email) owners.push({ userId: row.user_id, email: user.user.email });
    }

    const t = tenant.data;
    return {
      tenant: {
        id: t.id,
        slug: t.slug,
        name: t.name,
        domain: t.domain,
        ownerEmail: t.owner_email,
        taxId: t.tax_id,
        plan: t.plan,
        status: t.status,
        createdAt: t.created_at,
      },
      owners,
      versions: (versions.data ?? []).map((v) => ({
        version: v.version,
        title: v.title,
        isCurrent: v.is_current,
        createdAt: v.created_at,
      })),
      acceptances: (acceptances.data ?? []).map((a) => ({
        id: a.id,
        version: a.version,
        status: a.status,
        ownerEmail: a.owner_email,
        signerName: a.signer_name,
        signedAt: a.signed_at,
        hasSignature: Boolean(a.signature_svg),
        contentSha256: a.content_sha256,
        signerIp: a.signer_ip,
        createdAt: a.created_at,
        tokenExpiresAt: a.token_expires_at,
      })),
      documents: (documents.data ?? []).map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.title,
        fileName: d.file_name,
        sizeBytes: d.size_bytes,
        docDate: d.doc_date,
        note: d.note,
        version: d.version,
        isArchived: d.is_archived,
        uploadedByEmail: d.uploaded_by_email,
        createdAt: d.created_at,
      })),
      emails: (emails.data ?? []).map((e) => ({
        id: e.id,
        toEmail: e.to_email,
        subject: e.subject,
        kind: e.kind,
        status: e.status,
        providerMessageId: e.provider_message_id,
        error: e.error,
        createdAt: e.created_at,
      })),
      audit: (audit.data ?? []).map((a) => ({
        id: a.id,
        action: a.action,
        actorEmail: a.actor_email,
        details: flatDetails(a.details),
        createdAt: a.created_at,
      })),
    };
  });

/** שליחת (או שליחה מחדש) של ההסכם לבעל החנות */
export const sendOwnerAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => ({
    tenantId: uuidOf(input?.tenantId, "מזהה חנות"),
  }))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as unknown as AuthContext);
    const { supabaseAdminUnscoped: db } = await import("@/integrations/supabase/client.server");
    const { issueOwnerAgreement, actorOf } = await import("@/lib/platform-files.server");

    const { data: tenant } = await db
      .from("tenants")
      .select("owner_email")
      .eq("id", data.tenantId)
      .maybeSingle();
    const ownerEmail = tenant?.owner_email?.trim();
    if (!ownerEmail) throw new Error("לחנות אין כתובת מייל של בעלים");

    const { data: role } = await db
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", data.tenantId)
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();

    const outcome = await issueOwnerAgreement({
      tenantId: data.tenantId,
      ownerEmail,
      ownerUserId: role?.user_id ?? null,
      actor: actorOf(context),
    });
    if (!outcome.issued) {
      if (outcome.reason === "already_signed") {
        throw new Error("הגרסה הנוכחית של ההסכם כבר נחתמה על ידי הבעלים");
      }
      throw new Error("פתיחת בקשת החתימה נכשלה");
    }
    return {
      emailSent: outcome.emailSent,
      reason: outcome.reason ?? null,
      version: outcome.version,
    };
  });

/** גרסה חדשה של נוסח ההסכם. הקודמות נשמרות; חתימות קיימות לא משתנות. */
export const publishAgreementVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { title: string; content: string }) => {
    const title = cleanText(input?.title, 200);
    const content = String(input?.content ?? "").trim();
    if (title.length < 2) throw new Error("נא להזין כותרת");
    if (content.length < 50) throw new Error("נוסח ההסכם קצר מדי");
    if (content.length > 100_000) throw new Error("נוסח ההסכם ארוך מדי");
    return { title, content };
  })
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as unknown as AuthContext);
    const { supabaseAdminUnscoped: db } = await import("@/integrations/supabase/client.server");
    const { recordPlatformAudit, actorOf } = await import("@/lib/platform-files.server");
    const actor = actorOf(context);
    const { data: version, error } = await db.rpc("platform_agreement_publish", {
      _title: data.title,
      _content: data.content,
      _by: actor.id as string,
    });
    if (error) throw new Error(error.message);
    await recordPlatformAudit({
      tenantId: null,
      actor,
      action: "agreement_version_published",
      details: { version: typeof version === "number" ? version : null },
    });
    return { version: typeof version === "number" ? version : null };
  });

/** שלב 1 בהעלאת PDF: קישור העלאה חתום (הקובץ עולה ישירות לדלי הפרטי) */
export const createDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string; fileName: string; size: number }) => {
    const fileName = cleanText(input?.fileName, 200);
    const size = Number(input?.size);
    if (!/\.pdf$/i.test(fileName)) throw new Error("ניתן להעלות קובצי PDF בלבד");
    if (!Number.isFinite(size) || size <= 0) throw new Error("הקובץ ריק");
    if (size > MAX_DOC_BYTES) throw new Error("הקובץ גדול מדי (עד 10MB)");
    return { tenantId: uuidOf(input?.tenantId, "מזהה חנות"), fileName, size };
  })
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as unknown as AuthContext);
    const { supabaseAdminUnscoped: db } = await import("@/integrations/supabase/client.server");
    const { randomUUID } = await import("node:crypto");
    // שם האובייקט אקראי — שם הקובץ המקורי נשמר רק בטבלה
    const path = `${data.tenantId}/${randomUUID()}.pdf`;
    const { data: signed, error } = await db.storage
      .from(PLATFORM_DOCS_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "יצירת קישור ההעלאה נכשלה");
    return { path, token: signed.token };
  });

/** שלב 2: רישום המסמך אחרי שהקובץ עלה. מוודא שהאובייקט באמת קיים ושייך לחנות. */
export const registerDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      tenantId: string;
      path: string;
      fileName: string;
      size: number;
      kind: DocKind;
      title: string;
      docDate?: string | null;
      note?: string | null;
    }) => {
      const tenantId = uuidOf(input?.tenantId, "מזהה חנות");
      const path = cleanText(input?.path, 300);
      if (!new RegExp(`^${tenantId}/[0-9a-f-]{36}\\.pdf$`).test(path)) {
        throw new Error("נתיב קובץ לא תקין");
      }
      const kind = input?.kind;
      if (!DOC_KINDS.includes(kind)) throw new Error("סוג מסמך לא תקין");
      const title = cleanText(input?.title, 200);
      if (title.length < 2) throw new Error("נא להזין כותרת למסמך");
      const docDate = cleanText(input?.docDate, 10);
      if (docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) throw new Error("תאריך לא תקין");
      const size = Number(input?.size);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_DOC_BYTES) {
        throw new Error("גודל קובץ לא תקין");
      }
      return {
        tenantId,
        path,
        fileName: cleanText(input?.fileName, 200) || "document.pdf",
        size: Math.round(size),
        kind,
        title,
        docDate: docDate || null,
        note: cleanText(input?.note, 1000) || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as unknown as AuthContext);
    const { supabaseAdminUnscoped: db } = await import("@/integrations/supabase/client.server");
    const { recordPlatformAudit, actorOf } = await import("@/lib/platform-files.server");
    const actor = actorOf(context);

    const [folder, name] = data.path.split("/") as [string, string];
    const { data: found } = await db.storage.from(PLATFORM_DOCS_BUCKET).list(folder, {
      search: name,
      limit: 1,
    });
    if (!found?.some((item) => item.name === name)) {
      throw new Error("הקובץ לא נמצא באחסון — יש להעלות שוב");
    }

    const { data: row, error } = await db
      .from("platform_documents")
      .insert({
        tenant_id: data.tenantId,
        kind: data.kind,
        title: data.title,
        file_name: data.fileName,
        mime_type: "application/pdf",
        size_bytes: data.size,
        storage_path: data.path,
        doc_date: data.docDate,
        note: data.note,
        uploaded_by: actor.id,
        uploaded_by_email: actor.email,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await recordPlatformAudit({
      tenantId: data.tenantId,
      actor,
      action: "document_uploaded",
      details: { documentId: row.id, kind: data.kind, title: data.title },
    });
    return { id: row.id };
  });

/** קישור צפייה חתום ל-60 שניות; הצפייה נרשמת ביומן */
export const getDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { documentId: string }) => ({
    documentId: uuidOf(input?.documentId, "מזהה מסמך"),
  }))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as unknown as AuthContext);
    const { supabaseAdminUnscoped: db } = await import("@/integrations/supabase/client.server");
    const { recordPlatformAudit, actorOf } = await import("@/lib/platform-files.server");
    const { data: doc } = await db
      .from("platform_documents")
      .select("tenant_id, storage_path, file_name, title")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("המסמך לא נמצא");
    const { data: signed, error } = await db.storage
      .from(PLATFORM_DOCS_BUCKET)
      .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
    if (error || !signed) throw new Error(error?.message ?? "יצירת קישור הצפייה נכשלה");
    await recordPlatformAudit({
      tenantId: doc.tenant_id,
      actor: actorOf(context),
      action: "document_viewed",
      details: { documentId: data.documentId, title: doc.title },
    });
    return { url: signed.signedUrl };
  });

/** העברה לארכיון — מסמכים לא נמחקים לעולם */
export const archiveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { documentId: string; archived: boolean }) => ({
    documentId: uuidOf(input?.documentId, "מזהה מסמך"),
    archived: input?.archived !== false,
  }))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as unknown as AuthContext);
    const { supabaseAdminUnscoped: db } = await import("@/integrations/supabase/client.server");
    const { recordPlatformAudit, actorOf } = await import("@/lib/platform-files.server");
    const { data: doc, error } = await db
      .from("platform_documents")
      .update({ is_archived: data.archived })
      .eq("id", data.documentId)
      .select("tenant_id, title")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) throw new Error("המסמך לא נמצא");
    await recordPlatformAudit({
      tenantId: doc.tenant_id,
      actor: actorOf(context),
      action: data.archived ? "document_archived" : "document_restored",
      details: { documentId: data.documentId, title: doc.title },
    });
    return { ok: true };
  });
