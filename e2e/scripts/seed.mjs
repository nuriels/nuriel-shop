// נתוני בדיקה חד-פעמיים ל-E2E: משתמשים עם סיסמה (Auth API המקומי) + seed.sql.
// נתונים פיקטיביים בלבד (@e2e.test) — אין כאן שום מידע אמיתי.
// שימוש: node seed.mjs <api_url> <service_role_key> <db_url>
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { USERS } from "../fixtures/data.mjs";

const [apiUrl, serviceKey, dbUrl] = process.argv.slice(2);
if (!apiUrl || !serviceKey || !dbUrl) throw new Error("usage: seed.mjs <api_url> <key> <db_url>");

for (const user of Object.values(USERS)) {
  const res = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: user.id,
      email: user.email,
      password: user.password,
      email_confirm: true,
    }),
  });
  if (!res.ok && res.status !== 422)
    throw new Error(`create ${user.email}: ${res.status} ${await res.text()}`);
}

const here = dirname(fileURLToPath(import.meta.url));
execFileSync("psql", [dbUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", join(here, "seed.sql")], {
  stdio: "inherit",
});
console.log("seeded");
