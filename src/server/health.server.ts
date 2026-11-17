// בדיקות תקינות (R-4): "האפליקציה חיה" נפרד מ"המסד זמין".
//
//   /healthz — חיות (liveness): התהליך עונה. בלי שום I/O: לא מסד, לא זיהוי חנות, לא קבצים. זה מה
//              ש-Docker / Coolify בודקים כדי להחליט להפעיל מחדש את התהליך — מסד איטי לרגע לא יוריד את האפליקציה.
//   /readyz  — מוכנות (readiness): האפליקציה + המסד. 200 כשהמסד עונה, 503 כשלא. לניטור / לסקריפט הפריסה
//              (לא להפעלה מחדש אוטומטית: הפעלה מחדש של האפליקציה לא מתקנת מסד שנפל).
//
// שתי הנקודות עונות לפני זיהוי החנות לפי הדומיין (src/server.ts), בכל דומיין, ולא חושפות מידע: בלי גרסה, בלי
// שמות משתנים, בלי טקסט שגיאה. מוכנות עושה קריאת מסד אחת לכל חלון קצר (מטמון + קריאה אחת בכל רגע), כדי
// שבקשות חיצוניות מרובות לא יהפכו לעומס על המסד.

export const LIVENESS_PATH = "/healthz";
export const READINESS_PATH = "/readyz";

/** כמה זמן תוצאת המוכנות נשארת תקפה — קריאה אחת למסד בחלון הזה, לא משנה כמה בקשות */
export const READINESS_CACHE_MS = 5_000;
/** כמה זמן מחכים למסד לפני שמכריזים "לא מוכן" */
export const READINESS_TIMEOUT_MS = 2_000;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

export function isHealthPath(pathname: string): boolean {
  return pathname === LIVENESS_PATH || pathname === READINESS_PATH;
}

function json(status: number, body: Record<string, string>, request?: Request): Response {
  // HEAD: אותן כותרות וקוד, בלי גוף
  return new Response(request?.method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

/** חיות: בלי I/O. תמיד 200 כל עוד התהליך מקבל בקשות */
export function livenessResponse(request?: Request): Response {
  return json(200, { status: "ok" }, request);
}

type Check = () => Promise<void>;
let cached: { at: number; ready: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

/** מוכנות: בדיקת המסד (נכשל = לא מוכן). `check` ניתן להחלפה בבדיקות; ברירת המחדל — ping אמיתי למסד */
export async function readinessResponse(
  request?: Request,
  check?: Check,
  now: () => number = Date.now,
  timeoutMs: number = READINESS_TIMEOUT_MS + 500,
): Promise<Response> {
  const run: Check =
    check ??
    (async () => {
      const { pingDatabase } = await import("../integrations/supabase/tenant.server");
      await pingDatabase(READINESS_TIMEOUT_MS);
    });
  let ready: boolean;
  if (cached && now() - cached.at < READINESS_CACHE_MS) {
    ready = cached.ready;
  } else {
    // בדיקה שנתקעה (מסד שלא עונה בכלל) נחשבת "לא מוכן" — התשובה לא תלויה בה
    inflight ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          run(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("readiness check timed out")), timeoutMs);
          }),
        ]);
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    })();
    try {
      ready = await inflight;
    } finally {
      inflight = null;
    }
    cached = { at: now(), ready };
  }
  return ready
    ? json(200, { status: "ready", db: "up" }, request)
    : json(503, { status: "not_ready", db: "down" }, request);
}

/** מטפל אחד לשתי הנקודות; null = הבקשה לא שלנו. רק GET / HEAD */
export async function handleHealthRequest(request: Request): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!isHealthPath(pathname)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store" },
    });
  }
  return pathname === LIVENESS_PATH ? livenessResponse(request) : readinessResponse(request);
}

/** לבדיקות בלבד */
export function resetReadinessCacheForTests(): void {
  cached = null;
  inflight = null;
}
