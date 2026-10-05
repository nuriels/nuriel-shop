import { createServerFn } from "@tanstack/react-start";
import type { Json } from "@/integrations/supabase/types";
import {
  cleanSlugInput,
  otherMembershipReason,
  PORTAL_STORE_SLUG,
  slugFormatProblem,
  storeNameProblem,
  storeReadiness,
  type PortalAccount,
  type PortalStore,
  type StoreReadiness,
} from "@/lib/portal";

/**
 * שער הפלטפורמה (חלק 12) — פונקציות השרת. פועלות רק באתר של החנות
 * nuriel-app2 (PORTAL_STORE_SLUG), ולא בפאנל הפלטפורמה.
 *
 * 0. portalFromGoogle — כניסה עם Google (בלי לשלוח מייל): הדפדפן חוזר
 *    מ-Google עם חיבור של Supabase באתר השער; השרת לוקח ממנו את המייל
 *    המאומת ומחזיר אסימון שער — ואז הדפדפן מתנתק מהחיבור הזה (לא נשאר
 *    "מחובר" כלקוח של nuriel-app2).
 * 1. requestPortalCode / verifyPortalCode — קוד בן 6 ספרות למייל, אותו
 *    מנגנון של חלק 8 (issue_login_code / consume_login_code: HMAC בלבד במסד,
 *    10 דקות, 5 ניסיונות). ה-HMAC כאן שונה מזה של מסך ההתחברות הרגיל, כך
 *    שקוד מהשער לא פותח חשבון לקוח ב-nuriel-app2 ולהפך.
 *    קוד נכון → אסימון שער חתום (portal-token.server.ts) + החנויות של המייל.
 * 2. checkPortalSlug — כתובת באנגלית: פורמט / שמורה / תפוסה, והצעה פנויה.
 * 3. createPortalStore — חשבון התחברות (אם אין) + חנות + המשתמש כמנהל שלה.
 *    חלק 18ב: בעלים של חנות יכולים לפתוח עוד חנויות עם אותו חשבון (עד 10).
 * 4. getPortalStoreStatus — חנות חדשה: האם תעודת ה-SSL של הכתובת כבר הונפקה.
 * 5. enterPortalStore — קוד כניסה חד-פעמי (2 דקות) לאתר החנות:
 *    https://<slug>.nuri1.fit/admin-handoff#code=... → מחובר → /admin.
 */

const EMAIL_FORMAT = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_TTL_MINUTES = 10;
const RESEND_SECONDS = 30;
/** קוד הכניסה לאתר החנות — רק כדי לעבור מהשער לחנות */
const HANDOFF_TTL_MS = 2 * 60 * 1000;

function normalizeEmail(value: unknown): string {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !EMAIL_FORMAT.test(email)) throw new Error("כתובת אימייל לא תקינה");
  return email;
}

function tokenOf(value: unknown): string {
  const token = String(value ?? "").trim();
  if (token === "" || token.length > 2048) throw new Error("פג תוקף הכניסה לשער");
  return token;
}

function tenantIdOf(value: unknown): string {
  const id = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!UUID.test(id)) throw new Error("חנות לא תקינה");
  return id;
}

function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  if (name.length <= 2) return `${name[0] ?? ""}***@${domain}`;
  return `${name.slice(0, 2)}${"*".repeat(Math.min(5, name.length - 2))}@${domain}`;
}

function logPortal(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown>) {
  const line = `[portal] ${msg} ${JSON.stringify(extra)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** הבקשה הגיעה מאתר השער (nuriel-app2)? אחרת — זריקה */
async function requirePortal() {
  const { maybeCurrentTenant, isPlatformRequest } =
    await import("@/integrations/supabase/tenant.server");
  const tenant = maybeCurrentTenant();
  if (!tenant || isPlatformRequest() || tenant.slug !== PORTAL_STORE_SLUG) {
    throw new Error("הפעולה זמינה רק בשער הפלטפורמה");
  }
  return tenant;
}

/** HMAC של קוד השער — צמוד לשער ולכתובת, ושונה מקודי ההתחברות הרגילים */
async function portalCodeHash(tenantId: string, email: string, code: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  const secret =
    process.env["LOGIN_CODE_SECRET"]?.trim() || process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
  if (!secret) throw new Error("תקלת הגדרות בשרת");
  return createHmac("sha256", secret).update(`portal:${tenantId}:${email}:${code}`).digest("hex");
}

/** המייל המאומת מהאסימון (בשער הנוכחי בלבד) */
async function verifiedEmail(token: string): Promise<string> {
  const tenant = await requirePortal();
  const { readPortalToken } = await import("@/lib/portal-token.server");
  return readPortalToken(token, tenant.id);
}

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** portal_account (jsonb) → PortalAccount, עם הכתובת של כל חנות */
async function loadAccount(email: string): Promise<PortalAccount> {
  const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
  const { originForTenant } = await import("@/integrations/supabase/tenant.server");
  const { data, error } = await supabaseAdminUnscoped.rpc("portal_account", { _email: email });
  if (error) {
    logPortal("error", "portal_account failed", { message: error.message });
    throw new Error("טעינת החנויות נכשלה. נסו שוב בעוד רגע.");
  }
  const root = obj(data);
  const rawStores = Array.isArray(root["stores"]) ? root["stores"] : [];
  const stores: PortalStore[] = rawStores.map((entry) => {
    const row = obj(entry);
    const slug = str(row["slug"]);
    let url = "";
    try {
      url = originForTenant({
        slug,
        domain: strOrNull(row["domain"]),
        is_default: row["is_default"] === true,
        custom_domain: strOrNull(row["custom_domain"]),
        custom_domain_status: strOrNull(row["custom_domain_status"]),
      });
    } catch {
      url = "";
    }
    return {
      id: str(row["id"]),
      slug,
      name: str(row["name"]) || slug,
      status: row["status"] === "suspended" ? "suspended" : "active",
      isBlocked: row["is_blocked"] === true,
      url,
      createdAt: str(row["created_at"]),
    };
  });
  const other = obj(root["other"]);
  const canCreate = root["can_create"] === true;
  const maxStores = Number(root["max_stores"] ?? 0);
  return {
    hasAccount: typeof root["user_id"] === "string",
    stores,
    canCreate,
    maxStores: Number.isFinite(maxStores) && maxStores > 0 ? maxStores : null,
    blockedReason:
      !canCreate && stores.length === 0 && str(other["role"])
        ? otherMembershipReason(str(other["role"]), str(other["tenant_name"]))
        : null,
  };
}

// ============================================================
// 1. קוד למייל
// ============================================================

export const requestPortalCode = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string }) => ({ email: normalizeEmail(input?.email) }))
  .handler(async ({ data }) => {
    const tenant = await requirePortal();
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`portal-code:${ip}`, 10, 15 * 60 * 1000)) {
      throw new Error("יותר מדי בקשות לקוד מהמכשיר הזה. נסו שוב בעוד כמה דקות.");
    }

    const { randomInt } = await import("node:crypto");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendEmail, renderEmailHtml, storeSender, escapeHtml } =
      await import("@/lib/email.server");

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const { error } = await supabaseAdmin.rpc("issue_login_code", {
      _email: data.email,
      _code_hash: await portalCodeHash(tenant.id, data.email, code),
      _ip: ip,
    });
    // הודעות המסד ("קוד נשלח זה עתה", "נשלחו כבר כמה קודים") כתובות למשתמש
    if (error) throw new Error(error.message);

    const sender = await storeSender();
    // בלי רווח באמצע: מי שמעתיק את הקוד מהמייל ומדביק — מקבל 6 ספרות נקיות
    // (ההפרדה הוויזואלית — letter-spacing בלבד)
    const result = await sendEmail({
      to: [data.email],
      subject: `קוד הכניסה שלך: ${code}`,
      html: await renderEmailHtml(
        "קוד כניסה",
        `
        <p>שלום,</p>
        <p>זה הקוד שלך לכניסה ל<strong>${escapeHtml(sender.name)}</strong> — לניהול החנויות שלך או לפתיחת חנות חדשה:</p>
        <p style="margin:18px 0;text-align:center;">
          <span dir="ltr" style="display:inline-block;font-size:30px;font-weight:bold;letter-spacing:8px;background:#f3f5f3;border:1px solid #e2e8e2;border-radius:10px;padding:12px 22px;color:#12211F;">${code}</span>
        </p>
        <p>הקוד תקף ל-${CODE_TTL_MINUTES} דקות ולשימוש חד-פעמי.</p>
        <p style="color:#6b7280;font-size:13px;">לא ביקשתם קוד? אפשר להתעלם מההודעה. לעולם אל תמסרו את הקוד לאחרים.</p>
      `,
      ),
    });
    if (!result.sent) {
      logPortal("error", "send failed", {
        ip,
        email: maskEmail(data.email),
        reason: result.reason,
      });
      throw new Error("לא הצלחנו לשלוח את הקוד למייל. נסו שוב בעוד רגע.");
    }
    logPortal("info", "code sent", { ip, email: maskEmail(data.email) });
    return {
      sent: true,
      maskedEmail: maskEmail(data.email),
      expiresInMinutes: CODE_TTL_MINUTES,
      resendAfterSeconds: RESEND_SECONDS,
    };
  });

type ConsumeResult =
  | { result: "none" | "expired" | "locked" }
  | { result: "invalid"; left: number }
  | { result: "ok" };

export const verifyPortalCode = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; code: string }) => {
    const email = normalizeEmail(input?.email);
    const code = String(input?.code ?? "").replace(/\D/g, "");
    if (code.length !== 6) throw new Error("הקוד מכיל 6 ספרות");
    return { email, code };
  })
  .handler(async ({ data }) => {
    const tenant = await requirePortal();
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`portal-verify:${ip}`, 30, 15 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: raw, error } = await supabaseAdmin.rpc("consume_login_code", {
      _email: data.email,
      _code_hash: await portalCodeHash(tenant.id, data.email, data.code),
    });
    if (error) {
      logPortal("error", "consume failed", { ip, message: error.message });
      throw new Error("תקלה זמנית באימות הקוד. נסו שוב בעוד רגע.");
    }
    const outcome = raw as unknown as ConsumeResult;
    switch (outcome.result) {
      case "none":
        throw new Error("אין קוד פעיל לכתובת הזו. בקשו קוד חדש.");
      case "expired":
        throw new Error(`תוקף הקוד פג (${CODE_TTL_MINUTES} דקות). בקשו קוד חדש.`);
      case "locked":
        throw new Error("יותר מדי ניסיונות שגויים — הקוד בוטל. בקשו קוד חדש.");
      case "invalid":
        logPortal("warn", "wrong code", { ip, email: maskEmail(data.email), left: outcome.left });
        throw new Error(
          outcome.left === 1
            ? "הקוד שגוי. נותר ניסיון אחד."
            : `הקוד שגוי. נותרו ${outcome.left} ניסיונות.`,
        );
      case "ok":
        break;
    }

    const { signPortalToken } = await import("@/lib/portal-token.server");
    const account = await loadAccount(data.email);
    logPortal("info", "verified", {
      ip,
      email: maskEmail(data.email),
      stores: account.stores.length,
    });
    return { token: signPortalToken(data.email, tenant.id), email: data.email, account };
  });

/**
 * כניסה לשער עם Google: החיבור שנפתח מול Google (באתר השער) מוכיח שהמייל
 * שלך — מחזירים אסימון שער + החנויות, בלי שום מייל. חשבון חדש מ-Google
 * (שעוד אין לו חנות) יכול מיד לפתוח חנות.
 * לא דרך requireSupabaseAuth: היא דוחה משתמש של חנות אחרת — ובשער זה בדיוק
 * המקרה (בעל חנות שנכנס כדי להגיע לחנות שלו). את האסימון מאמת שרת
 * ההתחברות (GoTrue) עצמו.
 */
export const portalFromGoogle = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    const accessToken = String(input?.accessToken ?? "").trim();
    if (accessToken.split(".").length !== 3 || accessToken.length > 8192) {
      throw new Error("ההתחברות עם Google לא הושלמה. נסו שוב.");
    }
    return { accessToken };
  })
  .handler(async ({ data }) => {
    const tenant = await requirePortal();
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`portal-google:${ip}`, 30, 15 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");
    }

    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { data: verified, error } = await supabaseAdminUnscoped.auth.getUser(data.accessToken);
    const user = verified?.user;
    if (error || !user?.email) {
      logPortal("warn", "google session rejected", { ip, message: error?.message });
      throw new Error("ההתחברות עם Google לא אומתה. נסו שוב.");
    }
    // מייל שלא אומת לא מוכיח בעלות (בחשבון Google הוא תמיד מאומת)
    if (!user.email_confirmed_at) {
      throw new Error("כתובת המייל בחשבון לא אומתה — התחברו עם קוד למייל");
    }
    const email = normalizeEmail(user.email);

    const { signPortalToken } = await import("@/lib/portal-token.server");
    const account = await loadAccount(email);
    logPortal("info", "verified with google", {
      ip,
      email: maskEmail(email),
      stores: account.stores.length,
    });
    return { token: signPortalToken(email, tenant.id), email, account };
  });

/** החנויות של המייל המאומת (חזרה לשער / רענון העמוד) */
export const getPortalAccount = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => ({ token: tokenOf(input?.token) }))
  .handler(async ({ data }) => {
    const email = await verifiedEmail(data.token);
    return { email, account: await loadAccount(email) };
  });

// ============================================================
// 2. כתובת החנות
// ============================================================

/** הכתובת פנויה? אם לא — הצעה פנויה קרובה (dana-shop-2 ...) */
export const checkPortalSlug = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; slug: string }) => ({
    token: tokenOf(input?.token),
    slug: cleanSlugInput(String(input?.slug ?? "")),
  }))
  .handler(async ({ data }) => {
    await verifiedEmail(data.token);
    const formatProblem = slugFormatProblem(data.slug);
    if (formatProblem) {
      return { slug: data.slug, available: false, message: formatProblem, suggestion: null };
    }

    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const problemOf = async (slug: string) => {
      const { data: problem, error } = await supabaseAdminUnscoped.rpc("tenant_slug_problem", {
        _slug: slug,
      });
      if (error) throw new Error("בדיקת הכתובת נכשלה. נסו שוב.");
      return problem;
    };

    const problem = await problemOf(data.slug);
    if (problem === null) {
      return { slug: data.slug, available: true, message: null, suggestion: null };
    }

    // הצעה: אותה כתובת עם מספר בסוף
    const base = data.slug.replace(/-\d+$/, "").slice(0, 56);
    let suggestion: string | null = null;
    for (let n = 2; n <= 9 && suggestion === null; n += 1) {
      const candidate = `${base}-${n}`;
      if ((await problemOf(candidate)) === null) suggestion = candidate;
    }
    return { slug: data.slug, available: false, message: problem, suggestion };
  });

// ============================================================
// 3. הקמת חנות
// ============================================================

export const createPortalStore = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; name: string; slug: string }) => {
    const name = String(input?.name ?? "")
      .trim()
      .replace(/\s+/g, " ");
    const slug = cleanSlugInput(String(input?.slug ?? ""));
    const nameProblem = storeNameProblem(name);
    if (nameProblem) throw new Error(nameProblem);
    const slugProblem = slugFormatProblem(slug);
    if (slugProblem) throw new Error(slugProblem);
    return { token: tokenOf(input?.token), name, slug };
  })
  .handler(async ({ data }) => {
    const email = await verifiedEmail(data.token);
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`portal-create:${ip}`, 5, 60 * 60 * 1000)) {
      throw new Error("נפתחו כבר כמה חנויות מהמכשיר הזה בשעה האחרונה. נסו שוב מאוחר יותר.");
    }

    const account = await loadAccount(email);
    if (!account.canCreate) {
      throw new Error(
        account.maxStores !== null && account.stores.length >= account.maxStores
          ? `הגעתם למספר החנויות המרבי לחשבון אחד (${account.maxStores}). לחנויות נוספות פנו לתמיכה.`
          : (account.blockedReason ?? "אי אפשר לפתוח חנות עם כתובת המייל הזו"),
      );
    }

    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { originForTenant } = await import("@/integrations/supabase/tenant.server");

    // חשבון ההתחברות (אם אין עדיין) — בלי סיסמה: נכנסים בקוד למייל
    let createdUserId: string | null = null;
    if (!account.hasAccount) {
      const { data: created, error: createError } =
        await supabaseAdminUnscoped.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { signup_method: "platform_portal" },
        });
      // מרוץ (שתי לשוניות) — החשבון כבר נוצר; ממשיכים איתו
      if (createError && !/already|exists|registered/i.test(createError.message)) {
        logPortal("error", "create user failed", { ip, message: createError.message });
        throw new Error("פתיחת החשבון נכשלה. נסו שוב בעוד רגע.");
      }
      createdUserId = created?.user?.id ?? null;
    }

    const { data: tenant, error } = await supabaseAdminUnscoped.rpc("portal_create_store", {
      _email: email,
      _name: data.name,
      _slug: data.slug,
    });
    if (error || !tenant) {
      // לא משאירים חשבון חדש בלי חנות
      if (createdUserId) await supabaseAdminUnscoped.auth.admin.deleteUser(createdUserId);
      logPortal("warn", "create store refused", {
        ip,
        email: maskEmail(email),
        slug: data.slug,
        message: error?.message,
      });
      throw new Error(error?.message ?? "פתיחת החנות נכשלה. נסו שוב.");
    }

    logPortal("info", "store created", { ip, email: maskEmail(email), slug: tenant.slug });
    const store: PortalStore = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status === "suspended" ? "suspended" : "active",
      isBlocked: false,
      url: originForTenant(tenant),
      createdAt: tenant.created_at,
    };
    return { store };
  });

// ============================================================
// 4-5. מצב החנות וכניסה לניהול
// ============================================================

async function loadStoreState(email: string, tenantId: string) {
  const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
  const { originForTenant } = await import("@/integrations/supabase/tenant.server");
  const { data, error } = await supabaseAdminUnscoped.rpc("portal_store_state", {
    _email: email,
    _tenant: tenantId,
  });
  if (error) {
    throw new Error(
      error.code === "42501" ? "החנות לא נמצאה בחשבון שלכם" : "טעינת החנות נכשלה. נסו שוב.",
    );
  }
  const row = obj(data as Json);
  const domain = strOrNull(row["domain"]);
  const customDomain = strOrNull(row["custom_domain"]);
  const customStatus = strOrNull(row["custom_domain_status"]);
  const target = {
    slug: str(row["slug"]),
    domain,
    is_default: row["is_default"] === true,
    custom_domain: customDomain,
    custom_domain_status: customStatus,
  };
  const readiness: StoreReadiness = storeReadiness({
    sslStatus: strOrNull(row["ssl_status"]),
    agentSeenAt: strOrNull(row["agent_seen_at"]),
    hasOwnDomain: domain !== null || (customDomain !== null && customStatus === "active"),
  });
  return {
    id: str(row["id"]),
    slug: target.slug,
    name: str(row["name"]),
    /** חשבון המנהל של החנות (המייל המאומת) */
    userId: str(row["user_id"]),
    isBlocked: row["is_blocked"] === true,
    origin: originForTenant(target),
    readiness,
    sslError: strOrNull(row["ssl_error"]),
  };
}

/** חנות חדשה: האם הכתובת כבר מאובטחת (SSL) ואפשר להיכנס */
export const getPortalStoreStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; tenantId: string }) => ({
    token: tokenOf(input?.token),
    tenantId: tenantIdOf(input?.tenantId),
  }))
  .handler(async ({ data }) => {
    const email = await verifiedEmail(data.token);
    const state = await loadStoreState(email, data.tenantId);
    return {
      readiness: state.readiness,
      url: state.origin,
      sslError: state.sslError,
    };
  });

/** קוד כניסה חד-פעמי לאתר החנות → /admin-handoff → מחובר → /admin */
export const enterPortalStore = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; tenantId: string }) => ({
    token: tokenOf(input?.token),
    tenantId: tenantIdOf(input?.tenantId),
  }))
  .handler(async ({ data }) => {
    const email = await verifiedEmail(data.token);
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`portal-enter:${email}`, 30, 10 * 60 * 1000)) {
      throw new Error("יותר מדי כניסות בזמן קצר. נסו שוב בעוד כמה דקות.");
    }

    const state = await loadStoreState(email, data.tenantId);
    if (state.isBlocked) {
      throw new Error("החשבון שלכם בחנות הזו חסום. לבירור פנו לתמיכה.");
    }

    const { randomBytes, createHash } = await import("node:crypto");
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");

    // ניקוי קודים ישנים (נוצלו / פג תוקפם לפני יותר משעה)
    await supabaseAdminUnscoped
      .from("platform_admin_handoffs")
      .delete()
      .lt("expires_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    const code = randomBytes(32).toString("base64url");
    const { error } = await supabaseAdminUnscoped.from("platform_admin_handoffs").insert({
      token_hash: createHash("sha256").update(code).digest("hex"),
      user_id: state.userId,
      tenant_id: state.id,
      expires_at: new Date(Date.now() + HANDOFF_TTL_MS).toISOString(),
      kind: "store_owner",
    });
    if (error) {
      logPortal("error", "handoff insert failed", { message: error.message });
      throw new Error("הכניסה לחנות נכשלה. נסו שוב.");
    }
    logPortal("info", "enter store", { email: maskEmail(email), slug: state.slug });
    return { url: `${state.origin}/admin-handoff#code=${code}&from=portal`, name: state.name };
  });
