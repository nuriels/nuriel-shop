// A1: האייקונים ותמונת השיתוף של אתר אירוח — נוצרים מהלוגו שהעסק העלה ומוגשים מהדומיין של האתר
// עצמו (/stay/brand/…), כ-PNG בגודל הנכון. כך ווטסאפ, פייסבוק, אייפון ואנדרואיד מקבלים קובץ קטן
// ונגיש של העסק — לא את תמונת הפתיח הכבדה ולא את האייקון של נוריאל. טהור: ה-head (שרת ודפדפן)
// והנתיב בשרת (brand.server.ts) משתמשים באותם שמות.
import { SITE_PATH } from "../../config";

export const BRAND_PATH = `${SITE_PATH}/brand`;

/** מה שהנתיב מגיש: אייקוני מסך הבית, תמונת השיתוף והמניפסט (בלי סיומת — ראו edge/paths.ts) */
export const BRAND_ASSETS = [
  "apple-touch-icon",
  "icon-192",
  "icon-512",
  "icon-maskable-512",
  "og-image",
  "manifest",
] as const;
export type BrandAsset = (typeof BRAND_ASSETS)[number];

export function isBrandAsset(value: string): value is BrandAsset {
  return (BRAND_ASSETS as readonly string[]).includes(value);
}

/** תמונת השיתוף: הלוגו במרכז (בתוך הריבוע המרכזי — ווטסאפ חותך לריבוע) */
export const SHARE_IMAGE = { width: 1200, height: 630, type: "image/png" } as const;

/**
 * גרסת הלוגו בכתובת: ווטסאפ ואייפון שומרים במטמון לפי כתובת, ומזהה המדיה מתחלף כשמעלים לוגו חדש
 */
export const brandVersion = (logoId: string) => logoId.replace(/-/g, "").slice(0, 12);

/** כתובת יחסית (אייקונים ב-head) או מלאה (origin — תמונת שיתוף: סורקים צריכים כתובת מלאה) */
export function brandAssetUrl(asset: BrandAsset, logoId: string, origin?: string | null): string {
  const path = `${BRAND_PATH}/${asset}?v=${brandVersion(logoId)}`;
  return origin ? `${origin}${path}` : path;
}
