/**
 * זיהוי ברקוד בדפדפן.
 *
 * משתמש ב-BarcodeDetector המובנה (Chrome/Edge/Android). בדפדפנים שאין בהם
 * את ה-API (בעיקר Safari/iOS ופיירפוקס) הזיהוי האוטומטי אינו זמין, והמסך
 * נופל להקלדה ידנית של הברקוד — לכן חשוב לבדוק תמיכה לפני שמציעים מצלמה.
 */

type DetectedBarcode = { rawValue: string; format: string };

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource | Blob) => Promise<DetectedBarcode[]>;
};

type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

/** הפורמטים הרלוונטיים למשקאות: EAN/UPC על המוצר, Code128 על ארגזים */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

function getConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
  return typeof candidate === "function" ? candidate : null;
}

export function isBarcodeDetectionSupported(): boolean {
  return getConstructor() !== null;
}

let cached: BarcodeDetectorLike | null = null;

function getDetector(): BarcodeDetectorLike | null {
  if (cached) return cached;
  const Constructor = getConstructor();
  if (!Constructor) return null;
  cached = new Constructor({ formats: FORMATS });
  return cached;
}

/** מזהה ברקודים במקור תמונה אחד (פריים וידאו, תמונה שהועלתה, קנבס) */
export async function detectBarcodes(source: CanvasImageSource | Blob): Promise<string[]> {
  const detector = getDetector();
  if (!detector) return [];
  try {
    const results = await detector.detect(source);
    return results.map((result) => result.rawValue.trim()).filter((value) => value !== "");
  } catch {
    // פריים לא קריא (תנועה/טשטוש) — פשוט מדלגים עליו
    return [];
  }
}

/** זיהוי ברקודים בקובץ תמונה שהמשתמש צילם או בחר */
export async function detectBarcodesInFile(file: File): Promise<string[]> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const codes = await detectBarcodes(bitmap);
      bitmap.close();
      return codes;
    } catch {
      // ממשיכים לניסיון ישיר על ה-Blob
    }
  }
  return detectBarcodes(file);
}
