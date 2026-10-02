/**
 * בדיקות למנוע חתימת המים — כל 4 המיקומים, שקיפות, שימור פורמט ודחיית קצוות.
 * הרצה: npx esbuild scripts/watermark-check.ts --bundle --platform=node --format=cjs \
 *         --external:sharp --outfile=.wm-check.cjs --alias:@=./src && node .wm-check.cjs
 */
import sharp from "sharp";
import { applyWatermark, type WatermarkPosition } from "@/lib/watermark.server";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

/** ממוצע בהירות של אזור בתמונה */
async function regionMean(bytes: Uint8Array, left: number, top: number, size: number): Promise<number> {
  const { data } = await sharp(Buffer.from(bytes))
    .extract({ left, top, width: size, height: size })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (const value of data) sum += value;
  return sum / data.length;
}

async function main(): Promise<void> {
  // תמונת בסיס לבנה 400x300 + מדבקה שחורה אטומה 100x60
  const base = new Uint8Array(
    await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ffffff" } })
      .jpeg()
      .toBuffer(),
  );
  const stamp = new Uint8Array(
    await sharp({ create: { width: 100, height: 60, channels: 4, background: "#000000ff" } })
      .png()
      .toBuffer(),
  );

  const corners: Record<WatermarkPosition, [number, number]> = {
    "top-left": [14, 14],
    "top-right": [400 - 60, 14],
    "bottom-left": [14, 300 - 60],
    "bottom-right": [400 - 60, 300 - 60],
  };

  for (const position of Object.keys(corners) as WatermarkPosition[]) {
    const result = await applyWatermark(base, { watermarkBytes: stamp, position, opacity: 100 });
    const meta = await sharp(Buffer.from(result.bytes)).metadata();
    check(`${position}: מידות נשמרות`, meta.width === 400 && meta.height === 300);
    const [x, y] = corners[position];
    const stamped = await regionMean(result.bytes, x, y, 30);
    const center = await regionMean(result.bytes, 185, 135, 30);
    check(`${position}: המדבקה בפינה הנכונה`, stamped < 100, `בפינה=${stamped.toFixed(0)}`);
    check(`${position}: מרכז התמונה נקי`, center > 230, `במרכז=${center.toFixed(0)}`);
  }

  // שקיפות: 30% צריך להשאיר את הפינה בהירה משמעותית מ-100%
  const strong = await applyWatermark(base, { watermarkBytes: stamp, position: "bottom-right", opacity: 100 });
  const soft = await applyWatermark(base, { watermarkBytes: stamp, position: "bottom-right", opacity: 30 });
  const strongMean = await regionMean(strong.bytes, 340, 240, 30);
  const softMean = await regionMean(soft.bytes, 340, 240, 30);
  check("שקיפות 30% עדינה מ-100%", softMean > strongMean + 60, `100%=${strongMean.toFixed(0)} 30%=${softMean.toFixed(0)}`);

  // שימור פורמט webp (הפורמט הנפוץ ב-AliExpress)
  const webpBase = new Uint8Array(
    await sharp({ create: { width: 200, height: 200, channels: 3, background: "#eeeeee" } })
      .webp()
      .toBuffer(),
  );
  const webpOut = await applyWatermark(webpBase, { watermarkBytes: stamp, position: "bottom-right", opacity: 50 });
  check("webp נשאר webp", webpOut.contentType === "image/webp");

  // תמונה זעירה נדחית עם הודעה ברורה
  const tiny = new Uint8Array(
    await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } }).jpeg().toBuffer(),
  );
  let rejected = false;
  try {
    await applyWatermark(tiny, { watermarkBytes: stamp, position: "bottom-right", opacity: 50 });
  } catch {
    rejected = true;
  }
  check("תמונה זעירה נדחית", rejected);

  console.log(`\n${passed} בדיקות עברו, ${failed} נכשלו`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
