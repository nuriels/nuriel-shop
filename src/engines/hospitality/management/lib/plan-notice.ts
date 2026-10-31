// ההודעה שמוצגת מעל כל מסך הניהול לפי מצב המנוי (פעיל / ניסיון שמסתיים / מגבלת יחידות)
import type { ManagementContext } from "../../types/management";
import { daysLeft, daysText, formatDate } from "./format";

export interface PlanNotice {
  tone: "info" | "warning";
  text: string;
}

const TRIAL_NOTICE_DAYS = 14;

export function planNotice(ctx: ManagementContext, now: number = Date.now()): PlanNotice | null {
  const e = ctx.entitlements;
  if (!e.active) {
    return {
      tone: "warning",
      text: "המנוי של העסק אינו פעיל. ההזמנות הקיימות ממשיכות כרגיל, אבל אי אפשר להוסיף יחידות או מנהלים. לחידוש המנוי פנו לנוריאל.",
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
      };
    }
  }
  if (e.max_units !== null && e.units_used >= e.max_units) {
    return { tone: "info", text: `הגעתם למגבלת היחידות בחבילה (${e.max_units}).` };
  }
  return null;
}
