// הגדרות החיבור ל-Supabase לשכבת הפלטפורמה (צד שרת בלבד)

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing Supabase environment variable: ${name}`);
  return value;
}

export function supabaseUrl(): string {
  return required("SUPABASE_URL").replace(/\/$/, "");
}

export function publishableKey(): string {
  return required("SUPABASE_PUBLISHABLE_KEY");
}

/** כותרות לקריאת שירות (service role) ל-REST של Supabase */
export function serviceHeaders(): Record<string, string> {
  const key = required("SUPABASE_SERVICE_ROLE_KEY");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  // מפתחות sb_secret_ החדשים אינם JWT ולא נשלחים כ-Bearer
  if (!key.startsWith("sb_secret_")) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}
