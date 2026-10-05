import { getTenantId, supabase } from "@/integrations/supabase/client";
import { compressLogoImage, compressProductImage, compressSideBannerImage } from "@/lib/image";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { normalizeBrandColor } from "@/lib/brand-theme";
import { DEFAULT_SENDER_LOCAL_PART } from "@/lib/email-sender";

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
  /**
   * סליקה באשראי פעילה (חלק 16): הזמנות של לקוחות משולמות ב-Hyp לפני שהן
   * נכנסות לטיפול. נשמר רק דרך "אמצעי תשלום וסליקה" (לא מטופס ההגדרות).
   */
  card_payments_enabled: boolean;
  /**
   * מדיניות ביטול עסקה (חלק 16א) — HTML מהעורך, מוצג בראש /cancellations.
   * התקנון, הפרטיות והביטולים נשמרים רק מלשונית "עמודים משפטיים".
   */
  cancellation_policy_content: string;
  /** שעות הפעילות (טקסט חופשי, שורה לכל טווח) — מוצגות בעמוד "צור קשר" */
  business_hours: string;
  /**
   * אמצעי תשלום חלופיים (חלק 17ב): "תשלום טלפוני מול נציג" ו"תשלום בביט",
   * ומספר הנייד לקבלת ביט. נשמרים רק מהכרטיס "אמצעי תשלום חלופיים"
   * (saveOfflinePaymentSettings), לא מטופס הגדרות האתר.
   */
  payment_phone_enabled: boolean;
  payment_bit_enabled: boolean;
  payment_bit_phone: string | null;
  /**
   * באנר צדדי במסכי מחשב (חלק 19) — בעמודה השמאלית של חזית החנות, רק ב-lg
   * ומעלה. נשמר רק מהכרטיס "באנרים ופרסומים" (saveSideBanner).
   */
  desktop_banner_active: boolean;
  desktop_banner_image_url: string | null;
  desktop_banner_link: string | null;
};

/** העמודים המשפטיים — נשמרים בנפרד (saveLegalTexts), לא מטופס הגדרות האתר */
export type LegalTexts = Pick<
  SiteSettings,
  "terms_content" | "privacy_content" | "cancellation_policy_content"
>;

/** השדות שלא נשמרים מטופס הגדרות האתר (ולכן גם לא נחשבים "שינוי שלא נשמר" שם) */
export const SITE_FORM_EXCLUDED_KEYS = [
  "price_tiers_enabled",
  "card_payments_enabled",
  "terms_content",
  "privacy_content",
  "cancellation_policy_content",
  "payment_phone_enabled",
  "payment_bit_enabled",
  "payment_bit_phone",
  "desktop_banner_active",
  "desktop_banner_image_url",
  "desktop_banner_link",
] as const satisfies readonly (keyof SiteSettings)[];

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
   * החלק שלפני ה-@ בכתובת השולח — "electro" → electro@nuri1.fit. הדומיין קבוע
   * (דומיין המערכת המאומת ב-Resend) ומצורף בשרת. ברירת מחדל: orders.
   */
  sender_local_part: string;
  /** כתובת למענה (Reply-To) — כל דומיין; ריק = אימייל העסק מהגדרות האתר */
  reply_to_email: string;
  notify_admin_user_ids: string[];
};

const SITE_SETTINGS_COLUMNS =
  "site_title, logo_path, about_content, contact_content, terms_content, privacy_content, business_name, business_tax_id, business_address, business_phone, business_email, support_phone, sells_alcohol, prices_include_vat, vat_rate, maintenance_mode, maintenance_message, email_signature, price_tiers_enabled, is_sabbath_mode, brand_color, free_shipping_threshold, label_width_mm, label_height_mm, card_payments_enabled, cancellation_policy_content, business_hours, payment_phone_enabled, payment_bit_enabled, payment_bit_phone, desktop_banner_active, desktop_banner_image_url, desktop_banner_link" as const;

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
    card_payments_enabled: false,
    cancellation_policy_content: "",
    business_hours: "",
    payment_phone_enabled: true,
    payment_bit_enabled: false,
    payment_bit_phone: null,
    desktop_banner_active: false,
    desktop_banner_image_url: null,
    desktop_banner_link: null,
  };
}

export type SideBannerSettings = Pick<
  SiteSettings,
  "desktop_banner_active" | "desktop_banner_image_url" | "desktop_banner_link"
>;

/** הקישור של הבאנר: כתובת מלאה (https://…) או עמוד באתר (/…) — כמו הבדיקה במסד */
export function sideBannerLinkProblem(link: string): string | null {
  const value = link.trim();
  if (value === "") return null;
  if (value.length > 2000) return "הקישור ארוך מדי";
  if (!/^(https?:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/i.test(value)) {
    return "כתובת מלאה (https://…) או עמוד באתר (למשל /?category=מבצעים)";
  }
  return null;
}

/**
 * שמירת הבאנר הצדדי (חלק 19). המסד בודק שוב: קישורים בטוחים בלבד, ובאנר
 * פעיל חייב תמונה.
 */
export async function saveSideBanner(settings: SideBannerSettings): Promise<SideBannerSettings> {
  const { data, error } = await supabase
    .from("site_settings")
    .update({
      desktop_banner_active: settings.desktop_banner_active,
      desktop_banner_image_url: settings.desktop_banner_image_url?.trim() || null,
      desktop_banner_link: settings.desktop_banner_link?.trim() || null,
    })
    .eq("id", true)
    .select("desktop_banner_active, desktop_banner_image_url, desktop_banner_link")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * תמונת הבאנר הצדדי: נדחסת בדפדפן (WebP, עד 1200px) ועולה לתיקיית האתר של
 * החנות בדלי branding (<tenant>/site/...) — כמו הלוגו. מחזיר קישור ציבורי.
 */
export async function uploadSideBannerImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("יש לבחור קובץ תמונה");
  if (file.size > 15 * 1024 * 1024) throw new Error("גודל התמונה המקסימלי הוא 15MB");
  const { file: optimized, extension } = await compressSideBannerImage(file);
  const path = `${await tenantStoragePrefix()}/site/side-banner-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(BRANDING_BUCKET).upload(path, optimized, {
    upsert: false,
    contentType: optimized.type,
    cacheControl: "31536000",
  });
  if (error) throw error;
  return supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * שמירת אמצעי התשלום החלופיים (חלק 17ב). המסד מנרמל את המספר ובודק: מספר
 * נייד תקין, ביט רק עם מספר, ולפחות אמצעי תשלום אחד פעיל.
 */
export async function saveOfflinePaymentSettings(settings: {
  phoneEnabled: boolean;
  bitEnabled: boolean;
  bitPhone: string;
}): Promise<
  Pick<SiteSettings, "payment_phone_enabled" | "payment_bit_enabled" | "payment_bit_phone">
> {
  const { normalizeBitPhone } = await import("@/lib/bit-payments");
  const { data, error } = await supabase
    .from("site_settings")
    .update({
      payment_phone_enabled: settings.phoneEnabled,
      payment_bit_enabled: settings.bitEnabled,
      payment_bit_phone: normalizeBitPhone(settings.bitPhone) || null,
    })
    .eq("id", true)
    .select("payment_phone_enabled, payment_bit_enabled, payment_bit_phone")
    .single();
  if (error) throw new Error(error.message);
  return data;
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
  // מתג הדרגים לא נשמר מטופס ההגדרות — משנים אותו רק במסד, בכוונה.
  // הסליקה — רק דרך store_save_payment_settings (חלק 16).
  // העמודים המשפטיים — רק מלשונית "עמודים משפטיים" (saveLegalTexts, חלק 16א),
  // כדי ששמירת הגדרות האתר לא תדרוס נוסח שנשמר שם בינתיים.
  const editable: Partial<SiteSettings> = { ...settings };
  for (const key of SITE_FORM_EXCLUDED_KEYS) delete editable[key];
  const { error } = await supabase
    .from("site_settings")
    .update({
      ...editable,
      brand_color: normalizeBrandColor(settings.brand_color),
      business_hours: settings.business_hours.trim(),
    })
    .eq("id", true);
  if (error) throw error;
}

/**
 * שמירת התקנון / הפרטיות / מדיניות הביטולים (HTML מהעורך). התוכן מנוקה
 * לפני השמירה (רשימת תגיות סגורה), ושוב בכל הצגה באתר.
 */
export async function saveLegalTexts(texts: Partial<LegalTexts>): Promise<void> {
  const { sanitizeRichHtml, richTextIsEmpty } = await import("@/lib/rich-text");
  const clean = (html: string | undefined) => {
    if (html === undefined) return undefined;
    const safe = sanitizeRichHtml(html).trim();
    return richTextIsEmpty(safe) ? "" : safe;
  };
  const update: Partial<LegalTexts> = {};
  const terms = clean(texts.terms_content);
  const privacy = clean(texts.privacy_content);
  const cancellation = clean(texts.cancellation_policy_content);
  if (terms !== undefined) update.terms_content = terms;
  if (privacy !== undefined) update.privacy_content = privacy;
  if (cancellation !== undefined) update.cancellation_policy_content = cancellation;
  const { error } = await supabase.from("site_settings").update(update).eq("id", true);
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
    .select("sender_local_part, reply_to_email, notify_admin_user_ids")
    .eq("id", true)
    .maybeSingle();
  return (
    (data as EmailSettings | null) ?? {
      sender_local_part: DEFAULT_SENDER_LOCAL_PART,
      reply_to_email: "",
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
