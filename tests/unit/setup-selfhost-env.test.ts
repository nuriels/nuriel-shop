// deploy/setup-selfhost.sh — write_app_env (גם ב---env-only): הרצה חוזרת לא דורסת את כתובת השולח
// שהוגדרה (EMAIL_FROM_ADDRESS) ולא מוחקת משתנים שהסקריפט לא מכיר. לפני התיקון כל הרצה החזירה את
// השולח ל-orders@<הדומיין> — ואם הדומיין הזה לא מאומת ב-Resend, כל מייל נדחה.
// מריצים את הפונקציה עצמה (מחולצת מהסקריפט) ב-bash, בתיקייה זמנית — בלי Docker ובלי שרת.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = readFileSync(join(process.cwd(), "deploy/setup-selfhost.sh"), "utf8");
const FN = SCRIPT.slice(SCRIPT.indexOf("write_app_env() {"));
const BODY = FN.slice(0, FN.indexOf("\n}\n") + 3);
const KEY = "a".repeat(120);

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function run(env: Record<string, string> = {}): string {
  const script = [
    "set -euo pipefail",
    'log() { echo "$*"; }',
    'fail() { echo "FAIL: $*" >&2; exit 1; }',
    BODY,
    `write_app_env "${KEY}" "${KEY}"`,
  ].join("\n");
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      APP_DIR: dir,
      SB_DIR: dir,
      PROJECT: "shop",
      APP_PORT: "3000",
      API_URL: "https://api.example.test",
      SITE_URL: "https://shop.example.test",
      TENANT_BASE_DOMAIN: "example.test",
      PLATFORM_ADMIN_HOST: "admin.example.test",
      ...env,
    },
  });
}

const envFile = () => readFileSync(join(dir, ".env"), "utf8");
const value = (key: string) =>
  envFile()
    .split("\n")
    .filter((l) => l.startsWith(`${key}=`))
    .map((l) => l.slice(key.length + 1));

describe("setup-selfhost.sh write_app_env", () => {
  it("first run: the sender defaults to orders@<domain>", () => {
    dir = mkdtempSync(join(tmpdir(), "selfhost-env-"));
    run({ RESEND_API_KEY: "re_test" });
    expect(value("EMAIL_FROM_ADDRESS")).toEqual(["orders@example.test"]);
    expect(value("RESEND_API_KEY")).toEqual(["re_test"]);
  });

  it("a rerun keeps the sender address and the variables it does not write itself", () => {
    dir = mkdtempSync(join(tmpdir(), "selfhost-env-"));
    writeFileSync(
      join(dir, ".env"),
      [
        "RESEND_API_KEY=re_kept",
        "EMAIL_FROM_ADDRESS=noreply@verified.example",
        "AI_ASSISTANT_SECRET=keep-me-0123456789",
        "SERVER_PUBLIC_IPS=203.0.113.5",
        "LOGIN_CODE_SECRET=login-kept",
        "",
      ].join("\n"),
    );
    const out = run();
    expect(value("EMAIL_FROM_ADDRESS")).toEqual(["noreply@verified.example"]);
    expect(value("RESEND_API_KEY")).toEqual(["re_kept"]);
    expect(value("LOGIN_CODE_SECRET")).toEqual(["login-kept"]);
    expect(value("AI_ASSISTANT_SECRET")).toEqual(["keep-me-0123456789"]);
    expect(value("SERVER_PUBLIC_IPS")).toEqual(["203.0.113.5"]);
    // the summary never prints values
    expect(out).not.toContain("keep-me-0123456789");
    expect(out).toContain("נשמרו 2 משתנים");
    // no temporary copy left behind
    expect(readdirSync(dir).filter((f) => f.startsWith(".env.prev"))).toEqual([]);
  });

  it("a value passed to this run wins over the old file, and nothing is duplicated", () => {
    dir = mkdtempSync(join(tmpdir(), "selfhost-env-"));
    writeFileSync(join(dir, ".env"), "EMAIL_FROM_ADDRESS=old@verified.example\nEXTRA_FLAG=1\n");
    run({ EMAIL_FROM_ADDRESS: "new@verified.example" });
    run();
    expect(value("EMAIL_FROM_ADDRESS")).toEqual(["new@verified.example"]);
    expect(value("EXTRA_FLAG")).toEqual(["1"]);
    expect(envFile().match(/^COMPOSE_PROJECT_NAME=/gm)).toHaveLength(1);
  });
});
