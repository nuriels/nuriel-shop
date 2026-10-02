import { getTenantId, supabase } from "@/integrations/supabase/client";
import { compressLogoImage, compressProductImage } from "@/lib/image";

export const BRANDING_BUCKET = "branding";
export const PRODUCT_IMAGES_BUCKET = "product-images";

/**
 * תיקיית הקבצים של החנות הנוכחית ב-Storage: <tenant_id>/...
 * מדיניות ה-Storage מאפשרת למנהל לכתוב רק לתיקייה של החנות שלו.
 */
export async function tenantStoragePrefix(): Promise<string> {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("החנות לא זוהתה — נסו לרענן את הדף");
  return tenantId;
}

export type SiteSettings = {
  site_title: string;
  logo_path: string | null;
  about_content: string;
  contact_content: string;
  terms_content: string;
  privacy_content: string;
  business_name: string;
  business_tax_id: string;
  business_address: string;
  business_phone: string;
  business_email: string;
  /** טלפון שירות הלקוחות שמופיע במסמכים ובתחתית האתר */
  support_phone: string;
  sells_alcohol: boolean;
  /** true = המחירים בקטלוג כוללים מע"מ; false = מוסיפים מע"מ בעגלה ובמסמך */
  prices_include_vat: boolean;
  vat_rate: number;
  /** true = האתר חסום ללקוחות ולאורחים; מנהלים ממשיכים לעבוד כרגיל */
  maintenance_mode: boolean;
  maintenance_message: string;
  /** חתימת העסק שמופיעה בתחתית כל מייל שיוצא מהמערכת */
  email_signature: string;
  /**
   * דרגי מחיר 2/3 — רדומים כברירת מחדל: כולם בדרג 1 והממשק מציג מחיר אחד.
   * אין מתג בממשק; הפעלה עתידית = עדכון במסד (ראו מסמך ההמשך).
   */
  price_tiers_enabled: boolean;
};

export type EmailSettings = {
  sender_email: string;
  notify_admin_user_ids: string[];
};

const SITE_SETTINGS_COLUMNS =
  "site_title, logo_path, about_content, contact_content, terms_content, privacy_content, business_name, business_tax_id, business_address, business_phone, business_email, support_phone, sells_alcohol, prices_include_vat, vat_rate, maintenance_mode, maintenance_message, email_signature, price_tiers_enabled" as const;

export async function loadSiteSettings(): Promise<SiteSettings> {
  const { data } = await supabase
    .from("site_settings")
    .select(SITE_SETTINGS_COLUMNS)
    .eq("id", true)
    .maybeSingle();
  if (data) return data as SiteSettings;
  return {
    site_title: "סוכנות המשקאות",
    logo_path: null,
    about_content: "",
    contact_content: "",
    terms_content: "",
    privacy_content: "",
    business_name: "",
    business_tax_id: "",
    business_address: "",
    business_phone: "",
    business_email: "",
    support_phone: "",
    sells_alcohol: true,
    prices_include_vat: true,
    vat_rate: 18,
    maintenance_mode: false,
    maintenance_message: "",
    email_signature: "",
    price_tiers_enabled: false,
  };
}

export async function saveSiteSettings(settings: SiteSettings): Promise<void> {
  // מתג הדרגים לא נשמר מטופס ההגדרות — משנים אותו רק במסד, בכוונה
  const { price_tiers_enabled, ...editable } = settings;
  const { error } = await supabase.from("site_settings").update(editable).eq("id", true);
  if (error) throw error;
}

export async function loadEmailSettings(): Promise<EmailSettings> {
  const { data } = await supabase
    .from("email_settings")
    .select("sender_email, notify_admin_user_ids")
    .eq("id", true)
    .maybeSingle();
  return (
    (data as EmailSettings | null) ?? {
      sender_email: "orders@nuri1.fit",
      notify_admin_user_ids: [],
    }
  );
}

export async function saveEmailSettings(settings: EmailSettings): Promise<void> {
  const { error } = await supabase.from("email_settings").update(settings).eq("id", true);
  if (error) throw error;
}

/** לוגו האתר מאוחסן בנתיב ציבורי (<tenant_id>/site/...) — אין צורך בכתובת חתומה */
export function resolveSiteLogoUrl(path: string | null): string | null {
  if (path === null || path === "") return null;
  if (/^https?:\/\//i.test(path)) return path;
  const { data } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadSiteLogo(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("יש לבחור קובץ תמונה");
  if (file.size > 10 * 1024 * 1024) throw new Error("גודל התמונה המקסימלי הוא 10MB");
  // הלוגו נשמר כ-PNG דחוס: שומר שקיפות, ונתמך גם ביצירת מסמכי ה-PDF
  const { file: optimized, extension } = await compressLogoImage(file);
  const path = `${await tenantStoragePrefix()}/site/logo-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(BRANDING_BUCKET).upload(path, optimized, {
    upsert: true,
    contentType: optimized.type,
    cacheControl: "31536000",
  });
  if (error) throw error;
  return path;
}

export function resolveProductImageUrl(path: string | null): string | null {
  if (path === null || path === "") return null;
  if (/^https?:\/\//i.test(path)) return path;
  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export type ProductImageUpload = { url: string; originalBytes: number; compressedBytes: number };

/**
 * העלאת תמונת מוצר. התמונה נדחסת ומוקטנת בדפדפן לפני ההעלאה, ונשמרת עם
 * כותרת cache ארוכה — כך הקטלוג נטען מהר גם בחיבור סלולרי.
 */
export async function uploadProductImage(file: File): Promise<ProductImageUpload> {
  if (!file.type.startsWith("image/")) throw new Error("יש לבחור קובץ תמונה");
  if (file.size > 20 * 1024 * 1024) throw new Error("גודל התמונה המקסימלי הוא 20MB");
  const {
    file: optimized,
    extension,
    originalBytes,
    compressedBytes,
  } = await compressProductImage(file);
  const path = `${await tenantStoragePrefix()}/products/${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`;
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(path, optimized, {
    upsert: false,
    contentType: optimized.type,
    cacheControl: "31536000",
  });
  if (error) throw error;
  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, originalBytes, compressedBytes };
}
