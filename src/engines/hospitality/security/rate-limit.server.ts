// הגבלת קצב משותפת לכל שרתי האפליקציה (מיגרציה 25 — rate_check). המפתח במסד הוא HMAC של
// הפעולה + הנושא (כתובת / רשת / עסק / טוקן / משתמש) — במסד אין כתובות IP או טוקנים גלויים.
// אם המסד לא זמין — נופלים להגבלה בזיכרון של השרת (הישנה), כדי שהגנה כלשהי תמיד תפעל.
// בלי קוד מתיקיות server/ (נטען גם מהשער של המנוע — יומן הייצוא).
import { serviceHeaders, supabaseUrl } from "@/platform/supabase/env.server";
import { HOSPITALITY_SCHEMA } from "../config";
import { LIMITS, type LimitAction, type LimitSubject } from "./limits";
import { hmac } from "./secret.server";

export interface RateRule {
  key: string;
  limit: number;
  window: number;
}

export interface RateResult {
  ok: boolean;
  /** שניות עד שאפשר לנסות שוב (0 כשמותר) */
  retryAfter: number;
  /** מספר הפניות בחלון לכל כלל — באותו סדר */
  hits: number[];
}

let lastWarning = 0;

/** בדיקה + ספירה של כללים גולמיים (מפתח HMAC מוכן) — קריאה אחת למסד */
export async function checkRules(rules: RateRule[]): Promise<RateResult> {
  if (!rules.length) return { ok: true, retryAfter: 0, hits: [] };
  try {
    const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/rate_check`, {
      method: "POST",
      headers: {
        ...serviceHeaders(),
        "Content-Profile": HOSPITALITY_SCHEMA,
        "Accept-Profile": HOSPITALITY_SCHEMA,
      },
      body: JSON.stringify({ _rules: rules }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`rate_check ${res.status}`);
    const r = (await res.json()) as { allowed: boolean; retry_after: number; hits: number[] };
    return {
      ok: r.allowed === true,
      retryAfter: Number(r.retry_after) || 0,
      hits: Array.isArray(r.hits) ? r.hits.map(Number) : [],
    };
  } catch (e) {
    // המסד לא זמין: הגבלה בזיכרון של השרת הזה בלבד (עדיף על כלום)
    if (Date.now() - lastWarning > 60_000) {
      lastWarning = Date.now();
      console.error("[hospitality] shared rate limit unavailable — local fallback", String(e));
    }
    const { allowAction } = await import("@/platform/security/rate-limit.server");
    const hits = rules.map((r) =>
      allowAction(`hosp-shared:${r.key}`, r.limit, r.window * 1000) ? 1 : r.limit + 1,
    );
    const ok = hits.every((h, i) => h <= rules[i]!.limit);
    return { ok, retryAfter: ok ? 0 : 60, hits };
  }
}

/** הכללים של פעולה (limits.ts) לפי הנושאים שיש לבקשה (נושא חסר — הכלל שלו לא נבדק) */
export async function rulesFor(
  action: LimitAction,
  subjects: Partial<Record<LimitSubject, string | null | undefined>>,
): Promise<RateRule[]> {
  const out: RateRule[] = [];
  for (const rule of LIMITS[action]) {
    const value = subjects[rule.per];
    if (!value || value === "unknown") continue;
    out.push({
      key: await hmac("rate", `${action}|${rule.per}|${rule.window}|${value}`),
      limit: rule.limit,
      window: rule.window,
    });
  }
  return out;
}

export async function checkRate(
  action: LimitAction,
  subjects: Partial<Record<LimitSubject, string | null | undefined>>,
): Promise<RateResult> {
  return checkRules(await rulesFor(action, subjects));
}
