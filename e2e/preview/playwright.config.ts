import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// תצוגה מקומית של Hospitality (P0): סיור מוקלט בממשק — צילומי מסך וסרטונים במחשב
// ובטלפון — מול Supabase המקומי ונתוני ההדגמה (scripts/preview/hospitality-demo.mjs).
// לא חלק מבדיקות ה-Regression (e2e/playwright.config.ts) ולא נוגע בשום שרת אמיתי.
const envFile = new URL("../.env.e2e", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!;
  }
}

export default defineConfig({
  testDir: ".",
  testMatch: /walkthrough\.spec\.ts/,
  outputDir: "./out/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    // קצב צפייה: פעולות קצת יותר איטיות, כדי שאפשר יהיה לעקוב בסרטון
    launchOptions: { slowMo: 140 },
  },
  projects: [
    {
      name: "desktop",
      use: {
        viewport: { width: 1280, height: 800 },
        video: { mode: "on", size: { width: 1280, height: 800 } },
      },
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], video: { mode: "on", size: { width: 412, height: 839 } } },
    },
  ],
  webServer: {
    command: "bash ../scripts/app-up.sh",
    url: "http://127.0.0.1:3100/robots.txt",
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: "ignore",
  },
});
