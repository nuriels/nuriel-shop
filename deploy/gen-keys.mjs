// מחולל סודות לסטאק Supabase המקומי — רץ פעם אחת ע"י setup-selfhost.sh
// פלט: שורות KEY=VALUE לטעינה ב-shell. ללא תלויות — Node מובנה בלבד.
import crypto from "node:crypto";

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

const now = Math.floor(Date.now() / 1000);
const exp = now + 10 * 365 * 24 * 3600; // עשר שנים

const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const values = {
  POSTGRES_PASSWORD: crypto.randomBytes(24).toString("hex"),
  JWT_SECRET,
  ANON_KEY: signJwt({ role: "anon", iss: "supabase", iat: now, exp }, JWT_SECRET),
  SERVICE_ROLE_KEY: signJwt({ role: "service_role", iss: "supabase", iat: now, exp }, JWT_SECRET),
  DASHBOARD_PASSWORD: crypto.randomBytes(12).toString("hex"),
  SECRET_KEY_BASE: crypto.randomBytes(48).toString("hex"),
  VAULT_ENC_KEY: crypto.randomBytes(16).toString("hex"), // בדיוק 32 תווים
};

for (const [key, value] of Object.entries(values)) {
  console.log(`${key}=${value}`);
}
