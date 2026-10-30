import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { PRODUCTS, STORE_A, STORE_B, USERS } from "../fixtures/data.mjs";

export { PRODUCTS, STORE_A, STORE_B, USERS };

export const PORT = 3100;
export const hostOf = (slug: string) => `${slug}.shop.localhost`;
export const storeUrl = (slug: string, path = "/") => `http://${hostOf(slug)}:${PORT}${path}`;
export const platformUrl = (path = "/") => `http://platform.shop.localhost:${PORT}${path}`;
export const A = (path = "/") => storeUrl(STORE_A.slug, path);
export const B = (path = "/") => storeUrl(STORE_B.slug, path);

/** קבצי המצב של המשתמשים המחוברים (auth.setup.ts) — תמיד תחת e2e/.auth */
const authFile = (name: string) => fileURLToPath(new URL(`../.auth/${name}.json`, import.meta.url));
export const AUTH = {
  customerA: authFile("customer-a"),
  ownerA: authFile("owner-a"),
  platform: authFile("platform"),
  ownerAOnPlatform: authFile("owner-a-platform"),
} as const;

/** התחברות עם סיסמה דרך מסך ההתחברות הקיים */
export async function login(
  page: Page,
  baseUrl: string,
  user: { email: string; password: string },
) {
  await page.goto(`${baseUrl}login`);
  await page.getByLabel("אימייל או שם משתמש").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "התחבר", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

/**
 * בקשת HTTP לשרת לפי דומיין (Node לא מפנה *.localhost — הדפדפן כן). הזיהוי
 * של החנות בשרת נעשה לפי x-forwarded-host / Host, בדיוק כמו מאחורי nginx.
 */
export function hostGet(request: APIRequestContext, host: string, path: string) {
  return request.get(`http://127.0.0.1:${PORT}${path}`, {
    headers: { host, "x-forwarded-host": host },
    maxRedirects: 0,
  });
}

/** Supabase המקומי של הבדיקות (נכתב ע"י supabase-up.sh) */
export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env["SUPABASE_URL"];
  const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !anonKey) throw new Error("e2e/.env.e2e is not loaded");
  return { url, anonKey };
}

export const stableShot = { animations: "disabled" as const, caret: "hide" as const };
