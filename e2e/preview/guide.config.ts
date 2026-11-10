import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// סרטון מדריך לבעלי עסקים (מסמכים לחתימה ואירועים) — מוקלט מול Supabase המקומי בלבד, עם נתוני
// דוגמה (לא נתונים של עסק אמיתי). לא חלק מבדיקות ה-Regression.
const envFile = new URL("../.env.e2e", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!;
  }
}

export default defineConfig({
  testDir: ".",
  testMatch: /guide\.spec\.ts/,
  outputDir: "./out/guide-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    launchOptions: { slowMo: 120 },
    viewport: { width: 1280, height: 800 },
    video: { mode: "on", size: { width: 1280, height: 800 } },
  },
  projects: [{ name: "desktop" }],
  webServer: {
    command: "bash ../scripts/app-up.sh",
    url: "http://127.0.0.1:3100/robots.txt",
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: "ignore",
  },
});
