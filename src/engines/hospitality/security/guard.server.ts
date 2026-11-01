// שכבת ההגנה של פונקציות השרת (בשרת בלבד — נטען רק מתוך handlers):
//   • guardPublic — פעולה של גולש: הגבלת קצב משותפת לפי כתובת / רשת / העסק;
//   • guardBookingRequest — בקשת הזמנה: שדה מלכודת → אתגר ה-CAPTCHA (חתימה, hash, תוקף, העסק,
//     זמן מינימלי) → הגבלת קצב + "האתגר כבר נוצל" בקריאה אחת למסד. רק אחרי כל אלה — המסד;
//   • guardStaff — פעולה יקרה / רגישה של הצוות: לפי המשתמש המחובר (והעסק).
import { InputError } from "../validation/input";
import { ipNetwork, ipSubject } from "./client-ip";
import { powRemainingSeconds, verifyPow } from "./captcha.server";
import { tooManyMessage, type LimitAction } from "./limits";
import { BOT_REJECTED, CAPTCHA_RETRY } from "./messages";
import type { PowSolution } from "./pow";
import { checkRules, rulesFor } from "./rate-limit.server";
import { requestInfo, type RequestInfo } from "./request.server";
import { hmac } from "./secret.server";

const subjectsOf = (info: RequestInfo, siteId: string) => ({
  ip: ipSubject(info.ip),
  net: ipNetwork(info.ip),
  tenant: siteId,
});

export async function guardPublic(action: LimitAction, siteId: string): Promise<RequestInfo> {
  const info = await requestInfo();
  const result = await checkRules(await rulesFor(action, subjectsOf(info, siteId)));
  if (!result.ok) throw new InputError(tooManyMessage(result.retryAfter));
  return info;
}

/** הנפקת אתגר: מוגבלת לפי כתובת, וכתובת שמבקשת הרבה מקבלת אתגר כבד יותר */
export async function guardChallenge(siteId: string): Promise<{ difficulty: number }> {
  const info = await requestInfo();
  const result = await checkRules(await rulesFor("challenge", subjectsOf(info, siteId)));
  if (!result.ok) throw new InputError(tooManyMessage(result.retryAfter));
  const hits = result.hits[0] ?? 1;
  return { difficulty: hits > 30 ? 20 : hits > 10 ? 4 : 1 };
}

export async function guardBookingRequest(
  siteId: string,
  input: { captcha: PowSolution | null; trap: string },
): Promise<RequestInfo> {
  const info = await requestInfo();
  if (input.trap) {
    console.warn("[hospitality] booking request refused: trap field filled");
    throw new InputError(BOT_REJECTED);
  }
  const check = await verifyPow(input.captcha, siteId, "request");
  if (check !== "ok" || !input.captcha) throw new InputError(CAPTCHA_RETRY);
  const rules = await rulesFor("request", subjectsOf(info, siteId));
  // האתגר חד-פעמי — מונה משותף לכל השרתים (מגבלה 1 עד שהוא פג)
  rules.push({
    key: await hmac("pow-used", input.captcha.challenge),
    limit: 1,
    window: powRemainingSeconds(input.captcha),
  });
  const result = await checkRules(rules);
  if ((result.hits[rules.length - 1] ?? 1) > 1) throw new InputError(CAPTCHA_RETRY);
  if (!result.ok) throw new InputError(tooManyMessage(result.retryAfter));
  return info;
}

export async function guardStaff(
  action: LimitAction,
  subjects: { userId?: string | null; siteId?: string | null },
): Promise<void> {
  const info = await requestInfo();
  const result = await checkRules(
    await rulesFor(action, {
      user: subjects.userId ?? null,
      tenant: subjects.siteId ?? null,
      ip: ipSubject(info.ip),
    }),
  );
  if (!result.ok) throw new InputError(tooManyMessage(result.retryAfter));
}
