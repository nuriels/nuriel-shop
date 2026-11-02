// ההודעה שמוצגת מעל כל מסך הניהול לפי מצב המנוי (פעיל / ניסיון שמסתיים / מגבלת יחידות), ומה עושים
// עכשיו: לבעלי העסק — קישור (מה קורה אחרי הניסיון / פנייה לחידוש או להגדלת החבילה). מנהלים לא רואים
// את פרטי החבילה, ולכן בלי קישור.
import type { ManagementContext } from "../../types/management";
import { daysLeft, daysText, formatDate } from "./format";

export interface PlanNoticeAction {
  /** plan — כרטיס "החבילה שלי" בלוח הבקרה; support — פנייה חדשה בנושא "החשבון והחבילה" */
  kind: "plan" | "support";
  label: string;
  /** נושא הפנייה (מולא מראש בטופס) */
  subject?: string;
}

export interface PlanNotice {
  tone: "info" | "warning";
  text: string;
  action?: PlanNoticeAction;
}

const TRIAL_NOTICE_DAYS = 14;

/** מה קורה כשהמנוי לא פעיל — כפי שהמערכת מתנהגת (האתר נשאר, בקשות חדשות מהאתר נעצרות) */
export const INACTIVE_EFFECTS =
  "האתר נשאר באוויר וההזמנות הקיימות ממשיכות כרגיל, אבל אורחים לא יכולים לשלוח מהאתר בקשות הזמנה חדשות, ואי אפשר להוסיף יחידות או מנהלים.";

/** תקופת הניסיון הסתיימה (ולא — למשל — עסק שהושעה בזמן הניסיון) */
export function trialEnded(
  e: ManagementContext["entitlements"],
  now: number = Date.now(),
): boolean {
  if (e.status !== "trialing" || !e.trial_ends_at) return false;
  const ends = Date.parse(e.trial_ends_at);
  return Number.isFinite(ends) && ends <= now;
}

export function planNotice(ctx: ManagementContext, now: number = Date.now()): PlanNotice | null {
  const e = ctx.entitlements;
  const owner = ctx.permissions["billing.manage"] === true;
  if (!e.active) {
    // ניסיון שהסתיים — "הניסיון הסתיים" (לא "חידוש"): עוברים לחבילה בתשלום
    const ended = trialEnded(e, now);
    return {
      tone: "warning",
      text: `${ended ? "תקופת הניסיון הסתיימה" : "המנוי של העסק אינו פעיל"}: ${INACTIVE_EFFECTS}${
        owner ? "" : ` ${ended ? "למעבר לחבילה בתשלום" : "לחידוש המנוי"}, בעלי העסק פונים לנוריאל.`
      }`,
      ...(owner
        ? {
            action: ended
              ? ({
                  kind: "plan",
                  label: "החבילות ואיך עוברים",
                } as const)
              : ({
                  kind: "support",
                  label: "לחידוש המנוי — פנייה לנוריאל",
                  subject: "חידוש המנוי",
                } as const),
          }
        : {}),
    };
  }
  if (e.status === "trialing") {
    const left = daysLeft(e.trial_ends_at, now);
    if (left !== null && left <= TRIAL_NOTICE_DAYS) {
      return {
        tone: "info",
        text:
          left === 0
            ? "תקופת הניסיון מסתיימת היום."
            : `תקופת הניסיון מסתיימת בעוד ${daysText(left)} (${formatDate(e.trial_ends_at, ctx.business.timezone)}).`,
        ...(owner ? { action: { kind: "plan", label: "מה קורה אחר כך?" } as const } : {}),
      };
    }
  }
  if (e.max_units !== null && e.units_used >= e.max_units) {
    return {
      tone: "info",
      text: `הגעתם למגבלת היחידות בחבילה (${e.max_units}).`,
      ...(owner
        ? {
            action: {
              kind: "support",
              label: "להגדלת החבילה — פנייה לנוריאל",
              subject: "הגדלת החבילה",
            } as const,
          }
        : {}),
    };
  }
  return null;
}
