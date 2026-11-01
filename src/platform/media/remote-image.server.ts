// הורדת תמונה מקישור — מתאם פלטפורמה (Stage 2e) מעל המימוש הקיים של Ecommerce
// (src/server/services/image-fetch.ts), בלי העתקה ובלי שינוי התנהגות: http / https בלבד,
// תרגום DNS משלנו והחיבור לכתובת שנבדקה (בלי DNS rebinding), חסימת כתובות פנימיות /
// loopback / link-local (שרת המטא-דאטה של הענן) / multicast / שמורות, IPv4 ו-IPv6, שמות
// פנימיים, עד 4 הפניות שכל אחת נבדקת מחדש, עד 10MB ועד 12 שניות. זיהוי סוג לפי התוכן.
// ספרייה ברשימה הסגורה של tests/architecture/boundaries.test.ts ו-eslint.config.js.
export {
  IMAGE_MAX_BYTES,
  ImageImportError,
  assertFetchableUrl,
  describeImageError,
  fetchRemoteImage,
  isBlockedAddress,
  sniffImageType,
} from "@/server/services/image-fetch";
export type { SniffedType } from "@/server/services/image-fetch";
