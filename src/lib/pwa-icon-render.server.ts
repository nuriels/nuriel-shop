import sharp from "sharp";

/** אייקוני "הוספה למסך הבית": שם הקובץ → גודל, והאם maskable (אנדרואיד חותך לצורה) */
export const PWA_ICONS = {
  "apple-touch-icon.png": { size: 180, maskable: false },
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "icon-maskable-512.png": { size: 512, maskable: true },
} as const;

export type PwaIconName = keyof typeof PWA_ICONS;

export function isPwaIconName(name: string): name is PwaIconName {
  return Object.prototype.hasOwnProperty.call(PWA_ICONS, name);
}

/**
 * הלוגו → אייקון ריבועי אטום (אייפון ממלא שקיפות בשחור).
 * רקע: צבע הפינה של הלוגו (לוגו על רקע צבעוני ממשיך בלי "מסגרת"); פינה שקופה → לבן.
 * רגיל: הלוגו בתוך 84% מהריבוע. maskable: אלכסון הלוגו ≤ 78% — בתוך העיגול הבטוח (80%).
 */
export async function renderPwaIcon(logo: Buffer, name: PwaIconName): Promise<Buffer> {
  const { size, maskable } = PWA_ICONS[name];
  const oriented = await sharp(logo, { failOn: "none" })
    .rotate()
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = oriented.info;
  const corner = await sharp(oriented.data)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer();
  const background =
    (corner[3] ?? 255) < 250
      ? { r: 255, g: 255, b: 255 }
      : { r: corner[0] ?? 255, g: corner[1] ?? 255, b: corner[2] ?? 255 };
  const scale = maskable
    ? (size * 0.78) / Math.hypot(w, h)
    : Math.min((size * 0.84) / w, (size * 0.84) / h);
  const resized = await sharp(oriented.data)
    .resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), {
      fit: "fill",
    })
    .png()
    .toBuffer();
  const composed = await sharp({ create: { width: size, height: size, channels: 3, background } })
    .composite([{ input: resized, gravity: "centre" }])
    .png()
    .toBuffer();
  // composite מחזיר ערוץ שקיפות — הרקע אטום, אז מסירים אותו (אייקון אטום לגמרי)
  return sharp(composed).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}
