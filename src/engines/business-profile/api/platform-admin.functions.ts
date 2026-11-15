// "אתרי אינטרנט" בפאנל הפלטפורמה (Nuriel Websites): רשימת אתרי העסקים, פתיחת אתר, שיוך בעלים, בדיקת בקשת
// הפרסום הראשון (תצוגה של הצילום שנשלח), אישור / דחייה, והסתרת האתר הציבורי. הקובץ היחיד של המנוע שרץ
// בכתובת הפאנל (engine.platformAdminServerFn); ההרשאה (מנהל הפלטפורמה) נבדקת במסד בכל פונקציה.
// בלי חיובים, בלי דומיינים ובלי DNS.
import { createServerFn } from "@tanstack/react-start";
import { initialDocument } from "../document/defaults";
import { normalizeDocument } from "../document/normalize";
import type { TemplateKey } from "../document/schema";
import type { PlatformSiteRow, SiteState } from "../types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AVAILABLE: TemplateKey[] = ["elegant", "portfolio"];

const uuidOf = (v: unknown, what = "מזהה") => {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!UUID.test(s)) throw new Error(`${what} לא תקין`);
  return s;
};

type OwnerResult =
  | { status: "added" | "already_owner"; account_created: boolean }
  | { status: "failed"; message: string };

async function setOwner(tenantId: string, email: string): Promise<OwnerResult> {
  const [
    { platformRpc },
    { ensureAccount, UNVERIFIED_ACCOUNT_MESSAGE },
    { allowAction },
    { requireSession },
  ] = await Promise.all([
    import("../data/rpc.server"),
    import("@/platform/auth/accounts.server"),
    import("@/platform/security/rate-limit.server"),
    import("@/platform/auth/session.server"),
  ]);
  const args = { _tenant: tenantId, _email: email };
  let result = await platformRpc<{ status: "added" | "already_owner" | "needs_account" }>(
    "platform_bp_set_owner",
    args,
  );
  let created = false;
  let existed = false;
  if (result.status === "needs_account") {
    const session = await requireSession();
    if (!allowAction(`bp-owner-account:${session.userId}`, 20, 60 * 60 * 1000)) {
      throw new Error("יותר מדי פתיחות חשבון בזמן קצר. נסו שוב מאוחר יותר.");
    }
    ({ created, existed } = await ensureAccount(email, {
      signup_method: "business_profile_owner",
    }));
    result = await platformRpc("platform_bp_set_owner", args);
  }
  if (result.status === "needs_account") {
    throw new Error(existed ? UNVERIFIED_ACCOUNT_MESSAGE : "פתיחת החשבון נכשלה. נסו שוב.");
  }
  return { status: result.status, account_created: created };
}

export const websitesPlatformSites = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ sites: PlatformSiteRow[]; baseDomain: string | null }> => {
    const [{ platformRpc }, { sitesBaseDomain }] = await Promise.all([
      import("../data/rpc.server"),
      import("@/platform/tenancy/current-site.server"),
    ]);
    const [rows, baseDomain] = await Promise.all([
      platformRpc<Omit<PlatformSiteRow, "url">[]>("platform_bp_sites"),
      sitesBaseDomain(),
    ]);
    return {
      baseDomain,
      sites: rows.map((r) => ({
        ...r,
        url: baseDomain ? `https://${r.slug}.${baseDomain}` : null,
      })),
    };
  },
);

export const websitesPlatformOpenSite = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { slug?: unknown; name?: unknown; ownerEmail?: unknown; template?: unknown }) => {
      const slug = String(input?.slug ?? "")
        .trim()
        .toLowerCase();
      const name = String(input?.name ?? "")
        .trim()
        .replace(/\s+/g, " ");
      const ownerEmail = String(input?.ownerEmail ?? "")
        .trim()
        .toLowerCase();
      const template = String(input?.template ?? "elegant") as TemplateKey;
      if (!SLUG.test(slug))
        throw new Error("כתובת לא תקינה: אותיות באנגלית, ספרות ומקפים (3–63 תווים)");
      if (name.length < 2 || name.length > 120)
        throw new Error("שם העסק חייב להכיל 2 עד 120 תווים");
      if (ownerEmail && (!EMAIL.test(ownerEmail) || ownerEmail.length > 254))
        throw new Error("אימייל בעל העסק לא תקין");
      if (!AVAILABLE.includes(template)) throw new Error("התבנית לא זמינה");
      return { slug, name, ownerEmail: ownerEmail || null, template };
    },
  )
  .handler(async ({ data }) => {
    const { platformRpc } = await import("../data/rpc.server");
    const site = await platformRpc<{ id: string; slug: string; name: string }>(
      "platform_bp_open_site",
      {
        _slug: data.slug,
        _name: data.name,
        _owner_email: null,
        _document: initialDocument(data.template, data.name),
      },
    );
    // האתר נפתח; אם השיוך נכשל — מחזירים את הסיבה (האתר לא נמחק), והמסך מציע לנסות שוב
    let owner: OwnerResult | null = null;
    if (data.ownerEmail) {
      try {
        owner = await setOwner(site.id, data.ownerEmail);
      } catch (error) {
        owner = {
          status: "failed",
          message: error instanceof Error ? error.message : "שיוך הבעלים נכשל",
        };
      }
    }
    return { ...site, owner };
  });

export const websitesPlatformSetOwner = createServerFn({ method: "POST" })
  .inputValidator((input: { tenantId?: unknown; email?: unknown }) => {
    const email = String(input?.email ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw new Error("אימייל בעל העסק לא תקין");
    return { tenantId: uuidOf(input?.tenantId, "מזהה אתר"), email };
  })
  .handler(async ({ data }) => setOwner(data.tenantId, data.email));

export const websitesPlatformReview = createServerFn({ method: "GET" })
  .inputValidator((input: { tenantId?: unknown }) => ({
    tenantId: uuidOf(input?.tenantId, "מזהה אתר"),
  }))
  .handler(async ({ data }) => {
    const { platformRpc } = await import("../data/rpc.server");
    const raw = await platformRpc<{
      id: string;
      document: unknown;
      revision: number;
      note: string | null;
      requested_at: string;
    } | null>("platform_bp_review", { _tenant: data.tenantId });
    if (!raw) return null;
    return {
      id: raw.id,
      revision: raw.revision,
      note: raw.note,
      requestedAt: raw.requested_at,
      document: normalizeDocument(raw.document),
    };
  });

export const websitesPlatformApprove = createServerFn({ method: "POST" })
  .inputValidator((input: { tenantId?: unknown; versionId?: unknown }) => ({
    tenantId: uuidOf(input?.tenantId, "מזהה אתר"),
    versionId: uuidOf(input?.versionId, "מזהה בקשה"),
  }))
  .handler(async ({ data }): Promise<{ id: string; version: number }> => {
    const [{ platformRpc }, { invalidateSiteEnabled }] = await Promise.all([
      import("../data/rpc.server"),
      import("../access.server"),
    ]);
    const result = await platformRpc<{ id: string; version: number }>(
      "platform_bp_approve_publish",
      {
        _tenant: data.tenantId,
        _version: data.versionId,
      },
    );
    invalidateSiteEnabled(data.tenantId);
    return result;
  });

export const websitesPlatformReject = createServerFn({ method: "POST" })
  .inputValidator((input: { tenantId?: unknown; versionId?: unknown; note?: unknown }) => {
    const note = String(input?.note ?? "").trim();
    if (!note || note.length > 500) throw new Error("כתבו לבעל העסק מה צריך לתקן (עד 500 תווים)");
    return {
      tenantId: uuidOf(input?.tenantId, "מזהה אתר"),
      versionId: uuidOf(input?.versionId, "מזהה בקשה"),
      note,
    };
  })
  .handler(async ({ data }) => {
    const { platformRpc } = await import("../data/rpc.server");
    return platformRpc<{ status: "rejected" }>("platform_bp_reject_publish", {
      _tenant: data.tenantId,
      _version: data.versionId,
      _note: data.note,
    });
  });

export const websitesPlatformSetPublic = createServerFn({ method: "POST" })
  .inputValidator((input: { tenantId?: unknown; enabled?: unknown }) => ({
    tenantId: uuidOf(input?.tenantId, "מזהה אתר"),
    enabled: input?.enabled === true,
  }))
  .handler(async ({ data }): Promise<SiteState> => {
    const [{ platformRpc }, { invalidateSiteEnabled }] = await Promise.all([
      import("../data/rpc.server"),
      import("../access.server"),
    ]);
    const state = await platformRpc<SiteState>("platform_bp_set_public", {
      _tenant: data.tenantId,
      _enabled: data.enabled,
    });
    invalidateSiteEnabled(data.tenantId);
    return state;
  });
