// עזרים משותפים לבדיקות ה-E2E של אזור הניהול של Hospitality
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { toJSONAsync } from "seroval";
import { PORT, supabaseEnv, USERS } from "./helpers";

export function sql(query: string): string {
  const url = process.env["DB_URL"];
  if (!url) throw new Error("e2e/.env.e2e is not loaded (DB_URL)");
  return execFileSync("psql", [url, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  }).trim();
}

export const asPlatform = (query: string) =>
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub',
      (SELECT id FROM auth.users WHERE email = '${USERS.platform.email}'), 'role', 'authenticated')::text, false);
    ${query}`);

export type Account = { email: string; password: string };

/**
 * חשבון עם סיסמה (GoTrue admin API של Supabase המקומי) — כמו כל חשבון שהמערכת יוצרת, מסומן
 * app_metadata.platform (SEC-H1: רק לחשבון כזה אפשר לקשר תפקיד/בעלות לפי אימייל)
 */
export async function ensureUser(request: APIRequestContext, user: Account): Promise<string> {
  const existing = sql(`SELECT id FROM auth.users WHERE email = '${user.email}'`);
  if (existing) return existing;
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const res = await request.post(`${supabaseEnv().url}/auth/v1/admin/users`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    data: {
      email: user.email,
      password: user.password,
      email_confirm: true,
      app_metadata: { platform: true },
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

export async function accessToken(request: APIRequestContext, user: Account): Promise<string> {
  const { url, anonKey } = supabaseEnv();
  const res = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: { email: user.email, password: user.password },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** קריאה לפונקציית שרת כמו מהדפדפן (same-origin), לפי ה-id שלה בבנייה */
export async function callServerFn(
  request: APIRequestContext,
  opts: {
    host: string;
    file: string;
    name: string;
    data?: unknown;
    method?: "GET" | "POST" | undefined;
    token?: string | undefined;
    /** כותרות נוספות (למשל X-Forwarded-For מזויף בבדיקת IP) */
    headers?: Record<string, string> | undefined;
  },
) {
  const id = createHash("sha256")
    .update(`${opts.file}--${opts.name}_createServerFn_handler`)
    .digest("hex");
  const payload = JSON.stringify(await toJSONAsync({ data: opts.data }));
  const headers: Record<string, string> = {
    host: opts.host,
    "x-forwarded-host": opts.host,
    "sec-fetch-site": "same-origin",
    "x-tsr-serverFn": "true",
    accept: "application/json",
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    ...opts.headers,
  };
  const url = `http://127.0.0.1:${PORT}/_serverFn/${id}`;
  return (opts.method ?? "POST") === "GET"
    ? request.get(`${url}?payload=${encodeURIComponent(payload)}`, { headers })
    : request.post(url, {
        headers: { ...headers, "content-type": "application/json" },
        data: payload,
      });
}

/** כניסה לאזור הניהול דרך ה-handoff הקיים (קוד חד-פעמי, כמו "כניסה לעסק" מהשער) */
export async function enterViaHandoff(page: Page, siteUrl: string, siteId: string, email: string) {
  const code = randomBytes(32).toString("base64url");
  const userId = sql(`SELECT id FROM auth.users WHERE email = '${email}'`);
  sql(`INSERT INTO public.platform_admin_handoffs (token_hash, user_id, tenant_id, expires_at, kind)
       VALUES ('${createHash("sha256").update(code).digest("hex")}', '${userId}', '${siteId}',
               now() + interval '2 minutes', 'store_owner')`);
  await page.goto(`${siteUrl}/admin-handoff#code=${code}&from=portal`);
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
}

/** בדיקת נגישות axe (WCAG 2.1 AA) — אין הפרות */
export async function expectAccessible(page: Page, label: string) {
  // הודעה קופצת (Sonner) נכנסת ויוצאת בשקיפות חלקית — axe היה מודד ניגודיות של טקסט
  // באמצע האנימציה. מחכים שההודעות ייעלמו (עד 10 שניות), ורק אז בודקים.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
  // כניסה רכה של כרטיסים (data-rise: שקיפות 0→1 בהשהיה מדורגת) — אותה בעיה: axe שרץ ברגע
  // שהכרטיסים עולים מודד טקסט שקוף-למחצה. מחכים שכל האנימציות הסופיות יסתיימו (ספינרים
  // ושלדי טעינה הם אינסופיים — לא מחכים להם). קודם נותנים לשלדי הטעינה להתחלף בתוכן (עד 5
  // שניות, בלי להיכשל), כדי שהכרטיסים לא יעלו באמצע הבדיקה.
  await page
    .locator(".animate-pulse")
    .first()
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => undefined);
  await page.waitForFunction(
    () =>
      document.getAnimations().every((a) => {
        const t = a.effect?.getComputedTiming();
        return a.playState !== "running" || !t || t.endTime === Infinity;
      }),
    undefined,
    { timeout: 10_000 },
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(summary, label).toEqual([]);
}

/** חיבור שמור לאתר (localStorage של supabase-js) — כדי לא לבזבז כניסות (מגבלת handoff לכתובת IP) */
export type SavedSession = { origin: string; items: { name: string; value: string }[] };

/** כניסה אחת דרך ה-handoff בהקשר נפרד, ושמירת החיבור לשימוש חוזר */
export async function saveSession(
  browser: Browser,
  siteUrl: string,
  siteId: string,
  email: string,
): Promise<SavedSession> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterViaHandoff(page, siteUrl, siteId, email);
  const state = await ctx.storageState();
  await ctx.close();
  const origin = new URL(siteUrl).origin;
  return { origin, items: state.origins.find((o) => o.origin === origin)?.localStorage ?? [] };
}

/** החיבור השמור נטען לדף (שומר על הגדרות המכשיר של הפרויקט — מחשב / טלפון) */
export async function loadSession(page: Page, session: SavedSession, path: string) {
  await page.goto(`${session.origin}/robots.txt`);
  await page.evaluate((items) => {
    for (const { name, value } of items) localStorage.setItem(name, value);
  }, session.items);
  await page.goto(`${session.origin}${path}`);
}

/** הקוד מהמייל האחרון שנשלח לכתובת אחרי `since` (שירות המייל המדומה) */
export async function readLoginCode(
  request: APIRequestContext,
  email: string,
  since: number,
): Promise<string> {
  let code = "";
  await expect
    .poll(
      async () => {
        const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
          url: string;
          body: string;
          at: number;
        }[];
        const mail = calls
          .filter((c) => c.url.startsWith("/emails") && c.at >= since && c.body.includes(email))
          .pop();
        code = mail?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
        return code;
      },
      { timeout: 15_000 },
    )
    .toMatch(/^\d{6}$/);
  return code;
}

/** כמה מיילים נשלחו לכתובת אחרי `since` */
export async function emailsTo(
  request: APIRequestContext,
  email: string,
  since: number,
): Promise<number> {
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
    url: string;
    body: string;
    at: number;
  }[];
  return calls.filter((c) => c.url.startsWith("/emails") && c.at >= since && c.body.includes(email))
    .length;
}

/** כניסה אמיתית בקוד למייל דרך מסך הכניסה של אזור הניהול */
export async function signInWithEmailCode(
  page: Page,
  request: APIRequestContext,
  siteUrl: string,
  email: string,
) {
  await page.goto(`${siteUrl}/manage/login`);
  await page.getByLabel("אימייל").fill(email);
  const since = Date.now();
  await page.getByRole("button", { name: "שליחת קוד" }).click();
  await expect(page.getByRole("status")).toContainText("שלחנו קוד");
  await page.getByLabel("הקוד מהמייל").fill(await readLoginCode(request, email, since));
  await page.getByRole("button", { name: "כניסה" }).click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
}

/**
 * חיבור שמור מכניסה ישירה ל-GoTrue בסיסמה (כמו ש-supabase-js שומר אותו בדפדפן) — לבדיקות
 * שצריכות הרבה חיבורים בלי לנצל את מגבלות הכניסה של האפליקציה (handoff / סיסמה לכתובת IP).
 * מסלולי הכניסה עצמם נבדקים ב-manage.spec.ts וב-manage-team.spec.ts.
 */
export async function passwordSession(
  request: APIRequestContext,
  siteUrl: string,
  user: Account,
): Promise<SavedSession> {
  const { url, anonKey } = supabaseEnv();
  const res = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: { email: user.email, password: user.password },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const session = (await res.json()) as Record<string, unknown>;
  const key = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  return {
    origin: new URL(siteUrl).origin,
    items: [{ name: key, value: JSON.stringify(session) }],
  };
}
