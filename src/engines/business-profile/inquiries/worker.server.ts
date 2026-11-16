// תהליך הרקע של הפניות (מיגרציה 196) — בשרת, רק כשמתג המנוע דולק (BUSINESS_PROFILE_ENGINE=on):
//   • כל דקה — התראות במייל שהגיע זמנן: ניסיון חוזר אחרי כישלון (5 / 30 / 120 דקות), פניות שנשמרו
//     ולא נשלחו (השרת נפל באמצע), ונעילות שפגו;
//   • פעם ביום — מחיקת פניות לפי תקופת השמירה של כל אתר (ופניות בדיקה אחרי 30 יום).
// תקלה בשלב אחד נרשמת בלוג ולא עוצרת את השני.
import { businessProfileSwitchOn } from "../config";
import { notifyDue, purgeInquiries } from "./service.server";

const TICK_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

let started = false;
let running = false;
let lastPurge = 0;

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(
      `[business-profile/worker] ${name}`,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function inquiryTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await step("notify", () => notifyDue(20));
    if (Date.now() - lastPurge > DAY_MS) {
      lastPurge = Date.now();
      await step("purge", purgeInquiries);
    }
  } finally {
    running = false;
  }
}

export function startInquiryWorker(): void {
  if (started || !businessProfileSwitchOn()) return;
  started = true;
  const timer = setInterval(() => void inquiryTick(), TICK_MS);
  timer.unref?.();
  const first = setTimeout(() => void inquiryTick(), 20_000);
  first.unref?.();
}
