/**
 * דף הנחיתה של שער הפלטפורמה — טעינת הנתונים בשרת (פונקציה רגילה, בלי createServerFn), כדי
 * שגם עמוד הבית (getPortalLanding) וגם /llms.txt של השער ישתמשו באותו מקור בדיוק.
 *
 *  • חנות אינטרנטית: platform_plans + platform_pricing_settings (קריאה ציבורית — אותם נתונים
 *    כמו בעמוד "המנוי שלי"), וימי הניסיון — TRIAL_DAYS (זהה לטריגר במסד, 14 ימים).
 *  • Nuriel Hospitality: hospitality.public_plans() + hospitality.portal_trial_days()
 *    (service_role בלבד — כמו בשער; מחזירות רק חבילות מפורסמות ומספר ימים, בלי מידע פרטי).
 *
 * רק באתר השער (nuriel-app2); בכל אתר אחר — null.
 */
import { catalogFromRows, PAID_PLANS } from "@/lib/plan-catalog";
import { PORTAL_STORE_SLUG } from "@/lib/portal";
import {
  storePlanFit,
  zimmerPlanFit,
  type LandingData,
  type LandingStorePlan,
  type LandingZimmerPlan,
} from "@/lib/portal-landing";
import { PLAN_FEATURES, TRIAL_DAYS } from "@/lib/subscription";

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** קריאה לפונקציה בסכמת hospitality (PostgREST, service_role — רק בשרת) */
async function hospitalityRpc(fn: string): Promise<unknown> {
  const base = (process.env["SUPABASE_URL"] ?? "").trim().replace(/\/$/, "");
  const key = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!base || !key) throw new Error("missing server settings");
  const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Content-Profile": "hospitality",
      "Accept-Profile": "hospitality",
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status}`);
  return res.json();
}

async function loadZimmerOffer(): Promise<{
  plans: LandingZimmerPlan[];
  trialDays: number | null;
}> {
  const [plansRaw, daysRaw] = await Promise.all([
    hospitalityRpc("public_plans").catch((error: unknown) => {
      console.warn("[landing] hospitality plans unavailable", String(error));
      return [];
    }),
    hospitalityRpc("portal_trial_days").catch(() => null),
  ]);
  const plans = (Array.isArray(plansRaw) ? plansRaw : []).map((value): LandingZimmerPlan => {
    const p = obj(value);
    const maxUnits = num(p["max_units"]);
    return {
      code: str(p["code"]),
      name: str(p["name"]),
      tagline: str(p["tagline"]),
      monthlyPrice: num(p["price_monthly"]),
      setupFee: num(p["setup_fee"]),
      maxUnits,
      highlights: Array.isArray(p["highlights"])
        ? (p["highlights"] as unknown[]).filter((h): h is string => typeof h === "string")
        : [],
      fit: zimmerPlanFit(maxUnits),
    };
  });
  const days = num(daysRaw);
  return { plans, trialDays: days !== null && days > 0 ? days : null };
}

export async function loadPortalLanding(): Promise<LandingData | null> {
  const { maybeCurrentTenant, isPlatformRequest, tenantSiteOrigin } =
    await import("@/integrations/supabase/tenant.server");
  const tenant = maybeCurrentTenant();
  if (!tenant || isPlatformRequest() || tenant.slug !== PORTAL_STORE_SLUG) return null;
  const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");

  let origin = "";
  try {
    origin = tenantSiteOrigin().replace(/\/+$/, "");
  } catch {
    origin = "";
  }

  const [plansResult, notesResult, zimmer] = await Promise.all([
    supabaseAdminUnscoped
      .from("platform_plans")
      .select("plan_type, title, tagline, monthly_price, features, badge"),
    supabaseAdminUnscoped
      .from("platform_pricing_settings")
      .select("payment_note, vat_note")
      .maybeSingle(),
    loadZimmerOffer(),
  ]);
  if (plansResult.error) {
    console.warn("[landing] platform_plans unavailable", plansResult.error.message);
  }
  // שגיאה בטעינה → ברירת המחדל של הקטלוג (אותה ברירת מחדל כמו בעמוד "המנוי שלי")
  const catalog = catalogFromRows(
    plansResult.error ? null : plansResult.data,
    notesResult.error ? null : notesResult.data,
  );
  const storePlans: LandingStorePlan[] = PAID_PLANS.map((code) => {
    const card = catalog.plans[code];
    const limits = PLAN_FEATURES[code];
    return {
      code,
      title: card.title,
      tagline: card.tagline,
      monthlyPrice: card.monthlyPrice,
      features: card.features,
      badge: card.badge,
      fit: storePlanFit(code, limits.maxProducts, limits.customDomain),
    };
  });

  return {
    origin,
    store: {
      trialDays: TRIAL_DAYS,
      plans: storePlans,
      paymentNote: catalog.paymentNote,
      vatNote: catalog.vatNote,
    },
    hospitality: zimmer,
  };
}
