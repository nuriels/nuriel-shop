// הקטנת תמונה בדפדפן לפני העלאה ("תמונות" והתמונה הראשית בעיצוב האתר)
const MAX_SIDE = 2400;

/** תמונה גדולה מוקטנת בדפדפן (עד 2400px, JPEG 0.9) — פחות זמן העלאה בטלפון. השרת בודק ומקודד שוב */
export async function shrink(file: File): Promise<Blob> {
  if (
    !file.type.startsWith("image/") ||
    file.size < 1.5 * 1024 * 1024 ||
    typeof createImageBitmap !== "function"
  )
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
