// "ניהול Hospitality" בפאנל הפלטפורמה (P1): רשימת אתרי האירוח, פתיחת עסק, שיוך בעלים,
// חבילה ודגלים. הקובץ היחיד של המנוע שרץ בכתובת הפאנל (בלי אתר) — engine.platformAdminServerFn;
// בכל אתר הוא נחסם במתג. ההרשאה (מנהל הפלטפורמה) נבדקת במסד בכל פונקציה, ופתיחת חשבון
// לבעלים קורית רק אחרי שהמסד אישר שצריך (needs_account) — כמו הוספת מנהל (2b.3).
import { createServerFn } from "@tanstack/react-start";
import type {
  HospitalitySiteRow,
  OpenSiteResult,
  OwnerResult,
  PlanOption,
  PlatformFlags,
  PlatformHospitalityView,
  SiteRequest,
} from "../types/platform-admin";
import type {
  AdminSupportList,
  AdminSupportTicket,
  SupportSendResult,
  SupportSettings,
  SupportStatus,
  SupportTicketRow,
} from "../types/support";
import {
  parseOpenSite,
  parseSavePlan,
  parseSetFlag,
  parseSetOwner,
  parseSetPlan,
  parseSiteRequestSet,
} from "../validation/platform-admin";
import {
  ADMIN_SUPPORT_PAGE,
  parseAdminSupportFilter,
  parseAdminSupportReplyForm,
  parseAdminSupportStatus,
  parseSupportFileId,
  parseSupportSettingsInput,
  parseSupportTicketId,
} from "../validation/support";

type RpcOwner = { status: "added" | "already_owner" | "needs_account"; user_id?: string };

const FLAG_KEYS = {
  backend: "hospitality_backend_enabled",
  management: "hospitality_management_enabled",
  frontend: "hospitality_frontend_enabled",
  booking: "hospitality_booking_enabled",
} as const;

type RawSiteRow = Omit<
  HospitalitySiteRow,
  "url" | "site_url" | "manage_url" | "frontend_enabled" | "site_flags"
> & { site_flags: Omit<HospitalitySiteRow["site_flags"], "frontend"> };
type SiteSwitches = {
  platform: { frontend: boolean; booking: boolean };
  sites: Record<string, { frontend: boolean; frontend_enabled: boolean }>;
};

async function withUrls(row: RawSiteRow, switches: SiteSwitches): Promise<HospitalitySiteRow> {
  const { siteOrigin } = await import("@/platform/tenancy/current-site.server");
  const url = await siteOrigin(row);
  const web = switches.sites[row.id] ?? { frontend: false, frontend_enabled: false };
  return {
    ...row,
    frontend_enabled: web.frontend_enabled,
    site_flags: { ...row.site_flags, frontend: web.frontend },
    url,
    site_url: url ? `${url}/stay` : null,
    manage_url: url ? `${url}/manage` : null,
  };
}

/** שיוך הבעלים; חשבון חדש (אימייל מאומת, בלי סיסמה) רק כשהמסד מחזיר needs_account */
async function setOwner(siteId: string, email: string, name: string | null): Promise<OwnerResult> {
  const [{ platformRpc, platformSession }, { guardStaff }, { ensureAccount }] = await Promise.all([
    import("../server/platform-admin.server"),
    import("../security/guard.server"),
    import("@/platform/auth/accounts.server"),
  ]);
  const args = { _tenant_id: siteId, _email: email, _display_name: name };
  let result = await platformRpc<RpcOwner>("admin_set_owner", args);
  let created = false;
  if (result.status === "needs_account") {
    const session = await platformSession();
    await guardStaff("platformAccount", { userId: session.userId });
    created = (await ensureAccount(email, { signup_method: "hospitality_owner" })).created;
    result = await platformRpc<RpcOwner>("admin_set_owner", args);
  }
  if (result.status === "needs_account") throw new Error("פתיחת החשבון נכשלה. נסו שוב.");
  return { status: result.status, account_created: created };
}

export const hospitalityPlatformView = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlatformHospitalityView> => {
    const [{ platformRpc }, { sitesBaseDomain }] = await Promise.all([
      import("../server/platform-admin.server"),
      import("@/platform/tenancy/current-site.server"),
    ]);
    const [flags, rows, switches] = await Promise.all([
      platformRpc<Omit<PlatformFlags, "frontend">>("admin_platform_flags", {}),
      platformRpc<RawSiteRow[]>("admin_sites", {}),
      platformRpc<SiteSwitches>("admin_site_switches", {}),
    ]);
    return {
      flags: { ...flags, frontend: switches.platform.frontend },
      sites: await Promise.all(rows.map((r) => withUrls(r, switches))),
      base_domain: await sitesBaseDomain(),
    };
  },
);

export const hospitalityPlatformOpenSite = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseOpenSite(input))
  .handler(async ({ data }): Promise<OpenSiteResult> => {
    const [{ platformRpc }, { siteOrigin }] = await Promise.all([
      import("../server/platform-admin.server"),
      import("@/platform/tenancy/current-site.server"),
    ]);
    const site = await platformRpc<{ id: string; slug: string; name: string }>("admin_open_site", {
      _slug: data.slug,
      _name: data.name,
      _owner_email: data.ownerEmail,
      _plan: data.plan,
      _period_end: data.periodEnd,
    });
    // D2: ערכת העיצוב הראשונה (טיוטת האתר). כישלון לא מבטל את הפתיחה — העסק בוחר בעורך
    try {
      await platformRpc("admin_site_theme", { _tenant_id: site.id, _theme: data.theme });
    } catch (error) {
      console.error(
        "[hospitality] admin_site_theme failed",
        error instanceof Error ? error.message : error,
      );
    }
    // האתר נפתח; אם השיוך נכשל — מחזירים את הסיבה, והמסך מציע לנסות שוב (האתר לא נמחק)
    let owner: OwnerResult;
    try {
      owner = await setOwner(site.id, data.ownerEmail, data.ownerName);
    } catch (error) {
      owner = {
        status: "failed",
        message: error instanceof Error ? error.message : "שיוך הבעלים נכשל",
      };
    }
    const url = await siteOrigin({ slug: site.slug, domain: null });
    return { ...site, manage_url: url ? `${url}/manage` : null, owner };
  });

export const hospitalityPlatformSetOwner = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSetOwner(input))
  .handler(async ({ data }): Promise<OwnerResult> => setOwner(data.siteId, data.email, data.name));

export const hospitalityPlatformSetPlan = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSetPlan(input))
  .handler(async ({ data }): Promise<{ saved: true }> => {
    const { platformRpc } = await import("../server/platform-admin.server");
    // בתוקף עד סוף היום שנבחר (כולל)
    const end = data.until ? `${data.until}T23:59:59Z` : null;
    // שלב א' 4: המסך מציג את התאריך הנוכחי — מה שנשלח הוא מה שנבחר (גם ריק = בלי תאריך סיום)
    await platformRpc("admin_set_subscription", {
      _tenant_id: data.siteId,
      _plan: data.plan,
      _status: data.status,
      _trial_ends_at: data.plan === "trial" ? end : null,
      _current_period_end: data.plan === "trial" ? null : end,
      _extra_units: data.extraUnits,
      _note: "עודכן מ'אתרי אירוח' בפאנל הפלטפורמה",
    });
    // מקומות מנהלים נוספים — פונקציה נפרדת (מיגרציה 7), רק כשנשלח מספר
    if (data.extraManagers !== null) {
      await platformRpc("admin_set_extra_managers", {
        _tenant_id: data.siteId,
        _extra: data.extraManagers,
      });
    }
    return { saved: true };
  });

export const hospitalityPlatformSetFlag = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSetFlag(input))
  .handler(async ({ data }): Promise<{ saved: true }> => {
    const { platformRpc } = await import("../server/platform-admin.server");
    await platformRpc(
      "platform_set_flag",
      { _key: FLAG_KEYS[data.key], _enabled: data.enabled, _tenant_id: data.siteId },
      { schema: "public" },
    );
    return { saved: true };
  });

/** שלב E3: עריכת חבילה (מחיר, דמי הקמה, פירוט, הגבלות, מה פתוח, פרסום) — מנהל הפלטפורמה במסד */
export const hospitalityPlatformSavePlan = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSavePlan(input))
  .handler(async ({ data }): Promise<PlanOption> => {
    const { platformRpc } = await import("../server/platform-admin.server");
    const { code, ...plan } = data;
    return platformRpc<PlanOption>("admin_save_plan", { _code: code, _plan: plan });
  });

/** שלב E2: הבקשות לאתר צימר מהשער (חדשות קודם) */
export const hospitalityPlatformSiteRequests = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteRequest[]> => {
    const { platformRpc } = await import("../server/platform-admin.server");
    return platformRpc<SiteRequest[]>("admin_site_requests", {});
  },
);

export const hospitalityPlatformSiteRequestSet = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSiteRequestSet(input))
  .handler(async ({ data }): Promise<SiteRequest> => {
    const { platformRpc } = await import("../server/platform-admin.server");
    return platformRpc<SiteRequest>("admin_site_request_set", {
      _id: data.id,
      _status: data.status,
      _note: data.note,
    });
  });

// ---------- שלב E4: התמיכה של עסקי האירוח (מנהל הפלטפורמה; ההרשאה נבדקת במסד) ----------

/** כל הפניות: סינון לפי סטטוס / דחיפות / תאריכים / חיפוש, "ממתינות למענה" */
export const hospitalityAdminSupportTickets = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseAdminSupportFilter(input))
  .handler(async ({ data }): Promise<AdminSupportList> => {
    const { platformRpc } = await import("../server/platform-admin.server");
    return platformRpc<AdminSupportList>("admin_support_tickets", {
      _status: data.status,
      _priority: data.priority,
      _from: data.from,
      _to: data.to,
      _q: data.q,
      _needs_reply: data.needsReply,
      _limit: ADMIN_SUPPORT_PAGE,
      _offset: data.page * ADMIN_SUPPORT_PAGE,
    });
  });

/** פנייה עם ההערות הפנימיות ופרטי העסק (מסמנת כנקראה) */
export const hospitalityAdminSupportTicket = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSupportTicketId(input))
  .handler(async ({ data }): Promise<AdminSupportTicket> => {
    const { platformRpc } = await import("../server/platform-admin.server");
    return platformRpc<AdminSupportTicket>("admin_support_ticket", { _id: data.id });
  });

/** מענה לעסק (מייל לעסק) או הערה פנימית; קבצים — נבדקים לפי התוכן ועולים לדלי הפרטי */
export const hospitalityAdminSupportReply = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => parseAdminSupportReplyForm(data))
  .handler(async ({ data }): Promise<SupportSendResult> => {
    const [{ platformRpc, platformSession }, { guardStaff }, support] = await Promise.all([
      import("../server/platform-admin.server"),
      import("../security/guard.server"),
      import("../server/support.server"),
    ]);
    const session = await platformSession();
    // מנהל פלטפורמה בלבד (קריאה זולה עם _require_platform_admin) — לפני המונה ובדיקת הקבצים
    await platformRpc<unknown>("admin_support_settings", { _whatsapp: null, _save: false });
    await guardStaff("supportWrite", { userId: session.userId });
    const prepared = await support.prepareSupportFiles(data.files);
    const r = await platformRpc<{
      message_id: string;
      status: SupportStatus;
      uploads: { id: string; path: string; name: string; mime: string }[];
    }>("admin_support_reply", {
      _id: data.ticketId,
      _body: data.body,
      _internal: data.internal,
      _status: data.status,
      _files: support.fileMeta(prepared),
    });
    const up = await support.uploadSupportFiles(r.uploads ?? [], prepared);
    if (up.ok.length) await platformRpc<number>("admin_support_files_ready", { _ids: up.ok });
    // מענה לעסק — המייל לעסק כבר בתור; לשלוח עכשיו
    if (!data.internal) {
      const { kickOutbox } = await import("../outbox/worker.server");
      kickOutbox();
    }
    return { ticketId: data.ticketId, status: r.status, failedFiles: up.failed };
  });

/** שינוי סטטוס (כולל סגירה ופתיחה מחדש) */
export const hospitalityAdminSupportSetStatus = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseAdminSupportStatus(input))
  .handler(async ({ data }): Promise<SupportTicketRow> => {
    const { platformRpc } = await import("../server/platform-admin.server");
    return platformRpc<SupportTicketRow>("admin_support_set_status", {
      _id: data.id,
      _status: data.status,
    });
  });

/** קישור הורדה חתום (2 דקות) לקובץ מצורף */
export const hospitalityAdminSupportFileUrl = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSupportFileId(input))
  .handler(async ({ data }): Promise<{ url: string }> => {
    const [{ platformRpc, platformSession }, { signedSupportUrl }, { guardStaff }] =
      await Promise.all([
        import("../server/platform-admin.server"),
        import("../server/support.server"),
        import("../security/guard.server"),
      ]);
    await guardStaff("supportFile", { userId: (await platformSession()).userId });
    const file = await platformRpc<{ path: string; name: string; mime: string }>(
      "admin_support_file",
      { _id: data.id },
    );
    return { url: await signedSupportUrl(file) };
  });

export const hospitalityAdminSupportSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<SupportSettings> => {
    const { platformRpc } = await import("../server/platform-admin.server");
    return platformRpc<SupportSettings>("admin_support_settings", {});
  },
);

export const hospitalityAdminSupportSaveSettings = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSupportSettingsInput(input))
  .handler(async ({ data }): Promise<SupportSettings> => {
    const { platformRpc } = await import("../server/platform-admin.server");
    return platformRpc<SupportSettings>("admin_support_settings", {
      _whatsapp: data.whatsapp,
      _save: true,
    });
  });
