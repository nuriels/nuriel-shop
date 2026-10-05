/**
 * דחיסה והמרה של תמונות בצד הדפדפן, לפני ההעלאה לאחסון.
 *
 * הצילומים שמגיעים מהטלפון/מהספק שוקלים לרוב 3–8MB וטוענים שניות ארוכות.
 * כאן מקטינים את הרזולוציה לגודל שבאמת מוצג באתר, וממירים ל-WebP (או
 * JPEG כגיבוי בדפדפן ישן) — בדרך כלל 40–120KB לתמונת מוצר, כלומר טעינה
 * מתחת לשנייה, בלי לפגוע בחדות.
 */

export type CompressResult = {
  file: File;
  /** סיומת הקובץ שנבחרה בפועל (webp/jpeg/png) */
  extension: string;
  originalBytes: number;
  compressedBytes: number;
  /** מידות התמונה שנשמרה בפועל (אחרי הקטנה) */
  width?: number;
  height?: number;
};

type CompressOptions = {
  /** הצלע הארוכה המקסימלית בפיקסלים */
  maxDimension: number;
  quality: number;
  /** לוגו: שומרים שקיפות ומייצרים PNG (נדרש גם למסמכי ה-PDF) */
  preserveTransparency?: boolean;
};

const PRODUCT_OPTIONS: CompressOptions = { maxDimension: 1000, quality: 0.82 };
const LOGO_OPTIONS: CompressOptions = {
  maxDimension: 600,
  quality: 0.92,
  preserveTransparency: true,
};

function supportsType(type: string): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL(type).startsWith(`data:${type}`);
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // ממשיכים לנתיב ה-<img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("לא הצלחנו לקרוא את קובץ התמונה"));
      image.src = url;
    });
  } finally {
    // משאירים את ה-URL לחיים עד לאחר הציור; הדפדפן ישחרר בסגירת הדף
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function targetSize(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const scale = maxDimension / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function compress(file: File, options: CompressOptions): Promise<CompressResult> {
  if (!file.type.startsWith("image/")) throw new Error("יש לבחור קובץ תמונה");

  // GIF מונפש ו-SVG לא עוברים דחיסה — המרה תשבור אותם
  if (file.type === "image/gif" || file.type === "image/svg+xml") {
    return {
      file,
      extension: file.type === "image/gif" ? "gif" : "svg",
      originalBytes: file.size,
      compressedBytes: file.size,
    };
  }

  const bitmap = await loadBitmap(file);
  const sourceWidth = "width" in bitmap ? bitmap.width : 0;
  const sourceHeight = "height" in bitmap ? bitmap.height : 0;
  const { width, height } = targetSize(sourceWidth, sourceHeight, options.maxDimension);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("הדפדפן לא תומך בדחיסת תמונות");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  if (!options.preserveTransparency) {
    // רקע לבן במקום שקיפות, כדי שהמרה ל-JPEG לא תיצור אזורים שחורים
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const mimeType = options.preserveTransparency
    ? "image/png"
    : supportsType("image/webp")
      ? "image/webp"
      : "image/jpeg";

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mimeType, options.preserveTransparency ? undefined : options.quality),
  );
  if (!blob) throw new Error("דחיסת התמונה נכשלה");

  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";

  // אם הדחיסה לא שיפרה כלום (למשל תמונה שכבר קטנה ומאופטמת) — משתמשים במקור
  if (
    blob.size >= file.size &&
    sourceWidth <= options.maxDimension &&
    sourceHeight <= options.maxDimension
  ) {
    const originalExtension =
      file.name
        .split(".")
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9]/g, "") || "jpg";
    return {
      file,
      extension: originalExtension,
      originalBytes: file.size,
      compressedBytes: file.size,
      width: sourceWidth,
      height: sourceHeight,
    };
  }

  const compressedFile = new File([blob], `image.${extension}`, { type: mimeType });
  return {
    file: compressedFile,
    extension,
    originalBytes: file.size,
    compressedBytes: compressedFile.size,
    width,
    height,
  };
}

/** תמונת מוצר: עד 1000px, WebP באיכות גבוהה */
export function compressProductImage(file: File): Promise<CompressResult> {
  return compress(file, PRODUCT_OPTIONS);
}

/** באנר למחשב: עד 1920px ברוחב (המידה המומלצת 1920×600), איכות גבוהה */
export function compressDesktopBannerImage(file: File): Promise<CompressResult> {
  return compress(file, { maxDimension: 1920, quality: 0.85 });
}

/** באנר לנייד: עד 1000px בצלע הארוכה (750×1000 / 800×800) — קל לטעינה בסלולר */
export function compressMobileBannerImage(file: File): Promise<CompressResult> {
  return compress(file, { maxDimension: 1000, quality: 0.84 });
}

/**
 * באנר צדדי למחשב (חלק 19): באנר צר וגבוה (למשל 300×600) — עד 1200px בצלע
 * הארוכה (חד גם במסכים צפופים), WebP באיכות גבוהה
 */
export function compressSideBannerImage(file: File): Promise<CompressResult> {
  return compress(file, { maxDimension: 1200, quality: 0.85 });
}

/** לוגו האתר: עד 600px, PNG עם שקיפות (נדרש גם למסמכי PDF) */
export function compressLogoImage(file: File): Promise<CompressResult> {
  return compress(file, LOGO_OPTIONS);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
