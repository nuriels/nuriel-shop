import { getTenantId, supabase } from "@/integrations/supabase/client";
import { compressLogoImage, compressProductImage } from "@/lib/image";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { normalizeBrandColor } from "@/lib/brand-theme";

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
  /** מצב שבת: הקטלוג מוסתר ואי אפשר להזמין (נאכף גם במסד) */
  is_sabbath_mode: boolean;
  /** צבע המותג (#rrggbb); null = עיצוב ברירת המחדל — ראו brand-theme.ts */
  brand_color: string | null;
  /** סכום המוצרים בסל שממנו המשלוח חינם (מד בסל); null = כבוי */
  free_shipping_threshold: number | null;
  /** רוחב מדבקת המשלוח במ"מ (מדפסת תרמית, למשל Zebra) — 30 עד 200 */
  label_width_mm: number;
  /** גובה מדבקת המשלוח במ"מ — 20 עד 300 */
  label_height_mm: number;
};

/** מידות ברירת המחדל של מדבקת משלוח (כמו במסד) */
export const DEFAULT_LABEL_SIZE = { width: 70, height: 50 } as const;
export const LABEL_SIZE_LIMITS = {
  width: { min: 30, max: 200 },
  height: { min: 20, max: 300 },
} as const;

const inRange = (value: number, limits: { min: number; max: number }) =>
  Number.isFinite(value) && value >= limits.min && value <= limits.max;

/** בדיקת מידות המדבקה לפני שמירה (כמו ה-CHECK במסד); null = תקין */
export function labelSizeProblem(width: number, height: number): string | null {
  if (!inRange(width, LABEL_SIZE_LIMITS.width)) {
    return `רוחב המדבקה: ${LABEL_SIZE_LIMITS.width.min} עד ${LABEL_SIZE_LIMITS.width.max} מ"מ`;
  }
  if (!inRange(height, LABEL_SIZE_LIMITS.height)) {
    return `גובה המדבקה: ${LABEL_SIZE_LIMITS.height.min} עד ${LABEL_SIZE_LIMITS.height.max} מ"מ`;
  }
  return null;
}

export type EmailSettings = {
  /**
   * הכתובת למענה (Reply-To) של מיילי החנות. המיילים עצמם יוצאים מכתובת
   * המערכת עם שם החנות ("שם החנות <orders@nuri1.fit>") — ראו email.server.ts.
   */
  sender_email: string;
  notify_admin_user_ids: string[];
};

const SITE_SETTINGS_COLUMNS =
  "site_title, logo_path, about_content, contact_content, terms_content, privacy_content, business_name, business_tax_id, business_address, business_phone, business_email, support_phone, sells_alcohol, prices_include_vat, vat_rate, maintenance_mode, maintenance_message, email_signature, price_tiers_enabled, is_sabbath_mode, brand_color, free_shipping_threshold, label_width_mm, label_height_mm" as const;

export async function loadSiteSettings(): Promise<SiteSettings> {
  const { data } = await supabase
    .from("site_settings")
    .select(SITE_SETTINGS_COLUMNS)
    .eq("id", true)
    .maybeSingle();
  if (data) {
    const row = data as SiteSettings;
    // NUMERIC מגיע לפעמים כמחרוזת — מנרמלים למספר
    return {
      ...row,
      label_width_mm: Number(row.label_width_mm) || DEFAULT_LABEL_SIZE.width,
      label_height_mm: Number(row.label_height_mm) || DEFAULT_LABEL_SIZE.height,
    };
  }
  return {
    site_title: DEFAULT_STORE_NAME,
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
    is_sabbath_mode: false,
    brand_color: null,
    free_shipping_threshold: null,
    label_width_mm: DEFAULT_LABEL_SIZE.width,
    label_height_mm: DEFAULT_LABEL_SIZE.height,
  };
}

/** מידות המדבקה של החנות — למסך ההזמנות (בלי לטעון את כל ההגדרות) */
export async function loadLabelSize(): Promise<{ width: number; height: number }> {
  const { data } = await supabase
    .from("site_settings")
    .select("label_width_mm, label_height_mm")
    .eq("id", true)
    .maybeSingle();
  return {
    width: Number(data?.label_width_mm) || DEFAULT_LABEL_SIZE.width,
    height: Number(data?.label_height_mm) || DEFAULT_LABEL_SIZE.height,
  };
}

export async function saveSiteSettings(settings: SiteSettings): Promise<void> {
  // מתג הדרגים לא נשמר מטופס ההגדרות — משנים אותו רק במסד, בכוונה
  const { price_tiers_enabled, ...editable } = settings;
  const { error } = await supabase
    .from("site_settings")
    .update({ ...editable, brand_color: normalizeBrandColor(editable.brand_color) })
    .eq("id", true);
  if (error) throw error;
}

/** מתג מצב שבת — נשמר מיד (בלי שאר הטופס), כדי שלא יישכח לפני כניסת שבת */
export async function saveSabbathMode(on: boolean): Promise<void> {
  const { error } = await supabase
    .from("site_settings")
    .update({ is_sabbath_mode: on })
    .eq("id", true);
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
      sender_email: "",
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
