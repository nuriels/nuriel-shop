import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// המפתחות של Supabase המקומי (scripts/supabase-up.sh) — לבדיקות ה-API בלבד
const envFile = new URL("./.env.e2e", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!;
  }
}

// בדיקות Regression ל-Ecommerce (שלב 0). רצות מול Supabase מקומי וחד-פעמי
// (scripts/supabase-up.sh) ומול שירותים מדומים — אף פעם לא מול שרת אמיתי.
const PORT = 3100;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    // צילומי מסך: סף סביר כדי שהבדלי רינדור זניחים (anti-aliasing, גופנים) לא יכשילו
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, threshold: 0.25, animations: "disabled" },
  },
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  use: {
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // צילומי הבסיס נשמרים לפי מערכת הפעלה — ה-CI (Linux) הוא המקור
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  projects: [
    // התחברות פעם אחת לכל משתמש (מסך ההתחברות מגביל ל-15 ניסיונות לכתובת IP)
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
      dependencies: ["setup"],
    },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/, dependencies: ["setup"] },
  ],
  webServer: {
    command: "bash scripts/app-up.sh",
    url: `http://127.0.0.1:${PORT}/robots.txt`,
    reuseExistingServer: !process.env["CI"],
    timeout: 240_000,
    stdout: "ignore",
  },
});
