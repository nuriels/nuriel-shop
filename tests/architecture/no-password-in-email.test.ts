// אף מסלול לא שולח סיסמה במייל (ההחלטה המאושרת, 13.11.2026): סורקים את כל קוד המקור.
//   • אין שילוב של משתנה סיסמה בתבנית טקסט (`${…password…}` / escapeHtml(…password…)), חוץ מסיסמת Wi-Fi
//     של היחידה (פרט אירוח, לא סיסמת כניסה) ומסך פרטי הכניסה של מנהל הפלטפורמה (מוצג על המסך בלבד,
//     הקובץ לא שולח מיילים);
//   • הפונקציה ששלחה סיסמה זמנית במייל והאפשרות בטופס — לא קיימות;
//   • סוג המייל temp_password לא נשלח יותר (נשאר רק בהסתרת יומן של מיילים ישנים).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith("routeTree.gen.ts") ? [path] : [];
  });
}

const ALL = files(SRC).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));
const SENDS_EMAIL =
  /sendEmail\(|renderEmailHtml\(|sendBusinessEmail\(|sendNotificationEmail\(|email\.server|platform\/email/;
// on-screen only: the platform admin copies the new store's temporary password from the screen
const ON_SCREEN_ONLY = new Set(["src/components/platform/StoreCredentials.tsx"]);

describe("no password ever goes out by email", () => {
  it("scans a real amount of code, including the email senders", () => {
    expect(ALL.length).toBeGreaterThan(300);
    expect(ALL.filter((f) => SENDS_EMAIL.test(f.text)).length).toBeGreaterThan(20);
  });

  it("no template interpolates a login password (Wi-Fi passwords of a unit are not login passwords)", () => {
    const hits = ALL.flatMap((f) =>
      [...f.text.matchAll(/(\$\{|escapeHtml\()([^}]*?password[^}]*?)(\}|\))/gi)]
        // not a password: a unit's Wi-Fi detail, or the length limits (PASSWORD_MIN / PASSWORD_MAX)
        .filter((m) => !/wifi|PASSWORD_(MIN|MAX)\b/i.test(m[2] ?? ""))
        .map((m) => `${f.path}: ${m[0]}`),
    );
    const outsideAllowed = hits.filter((h) => !ON_SCREEN_ONLY.has(h.split(":")[0] ?? ""));
    expect(outsideAllowed).toEqual([]);
  });

  it("the on-screen credentials file sends no email", () => {
    for (const path of ON_SCREEN_ONLY) {
      const f = ALL.find((x) => x.path === path);
      expect(f, path).toBeDefined();
      expect(SENDS_EMAIL.test(f!.text), path).toBe(false);
    }
  });

  it("the temporary-password email and its form option are gone", () => {
    const offenders = ALL.filter((f) => /sendTempPasswordEmail|emailTempPassword/.test(f.text)).map(
      (f) => f.path,
    );
    expect(offenders).toEqual([]);
  });

  it("the temp_password email kind is not a sendable kind any more", () => {
    const email = ALL.find((f) => f.path === "src/lib/email.server.ts")!.text;
    const kinds = email.slice(email.indexOf("kind:"), email.indexOf(";", email.indexOf("kind:")));
    expect(kinds).toContain('"password_changed"');
    expect(kinds).not.toContain('"temp_password"');
    expect(ALL.filter((f) => /kind:\s*"temp_password"/.test(f.text)).map((f) => f.path)).toEqual(
      [],
    );
  });

  it("the reset-confirmation email does not include the new password", () => {
    const pw = ALL.find((f) => f.path === "src/lib/password.functions.ts")!.text;
    const confirm = pw.slice(pw.indexOf('kind: "password_changed"'));
    expect(confirm.slice(0, 1500)).not.toMatch(/data\.password/);
  });
});
