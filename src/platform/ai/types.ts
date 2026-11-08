/**
 * NURIEL AI ASSISTANT — טיפוסים משותפים לשרת ולדפדפן של מסך מנהל העל (בלי קוד שרת). כל מה שעובר לדפדפן
 * הוא JSON פשוט — ובלי מפתח ה-API (רק "יש מפתח", "אפשר לפענח" ו-4 תווים אחרונים).
 */
import type { AiMode, AiModelId, TokenUsage } from "./logic";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type AdminBusiness = {
  tenantId: string;
  slug: string;
  name: string;
  siteType: "ecommerce" | "hospitality";
  tenantStatus: string | null;
  /** המצב היום (ai_state_on): status, entitled, starts_on, ends_on, days_left, price_agorot… */
  state: JsonObject;
};

export type AiAnomaly = {
  kind: "spike" | "blocked" | "failures" | "budget";
  tenant: string | null;
  message: string;
};

export type ModelPrice = { input: number; cacheWrite: number; cacheRead: number; output: number };

export type AiAdminSettingsView = {
  mode: AiMode;
  model: AiModelId;
  hasKey: boolean;
  keyReadable: boolean;
  keyLast4: string | null;
  keyUpdatedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  maxQuestionChars: number;
  tenantHourlyLimit: number;
  userMinuteLimit: number;
  monthlyBudgetUsd: number;
};

export type AiAdminOverview = {
  settings: AiAdminSettingsView | null;
  models: { id: string; label: string; hint: string; prices: ModelPrice }[];
  pricesCheckedOn: string;
  packages: { product: string; name: string; priceAgorot: number }[];
  usage: JsonObject | null;
  anomalies: AiAnomaly[];
};

export type ConnectionTestResult =
  | { ok: true; model: AiModelId; routedCorrectly: boolean; usage: TokenUsage; costUsd: number }
  | { ok: false; message: string };

export type RenewalRun = {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
  claimedElsewhere: number;
  /** שירות המיילים לא מוגדר בשרת — לא נתפסה ולא נרשמה אף התראה (יישלחו כשיוגדר, באותו חלון) */
  emailNotConfigured: boolean;
};
