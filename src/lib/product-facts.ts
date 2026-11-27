// עובדות על מוצר לנתונים המובנים של גוגל (Product / Offer) — טהור, בלי מסד (נבדק ביחידה).
//
//   • מצב המוצר (itemCondition): מה שבעל החנות קבע במוצר; אם לא קבע — לפי המילים שבעל החנות עצמו כתב בשם המוצר
//     או בקטגוריה ("מחודש" → Refurbished, "משומש" / "יד שנייה" → Used), אחרת חדש. קודם: NewCondition לכל מוצר,
//     גם למחשב מחודש.
//   • ברקוד → GTIN רק כשהוא GTIN אמיתי: אורך 8 / 12 / 13 / 14, ספרת ביקורת תקינה (GS1), ולא קוד פנימי של חנות
//     (קידומות "הפצה מוגבלת" 020–029, 040–049, 200–299, קופונים 050–059, 980–984, 99x). קודם: כל 13 ספרות
//     נשלחו כ-gtin13 — גם קודים פנימיים.
//   • מותג — הצעה בלבד (לאישור בעל החנות), רק כשמותג מוכר כתוב בשם המוצר שבעל החנות כתב. לא ממציאים מותג:
//     שם החנות הוא לא המותג של המוצר (Google: brand — "if known").

export type ItemCondition = "new" | "refurbished" | "used";

export const ITEM_CONDITIONS: readonly ItemCondition[] = ["new", "refurbished", "used"];

export const CONDITION_SCHEMA: Record<ItemCondition, string> = {
  new: "https://schema.org/NewCondition",
  refurbished: "https://schema.org/RefurbishedCondition",
  used: "https://schema.org/UsedCondition",
};

export const CONDITION_LABEL: Record<ItemCondition, string> = {
  new: "חדש",
  refurbished: "מחודש",
  used: "משומש",
};

export const isItemCondition = (value: unknown): value is ItemCondition =>
  value === "new" || value === "refurbished" || value === "used";

// גבול מילה שמבין עברית (\b של JS לא מכיר אותיות עבריות): לפני ואחרי — לא אות ולא ספרה
const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";
// אות שימוש אחת לפני מילה עברית: "המחודש", "ומשומש", "במצב"
const PREFIX = "[הובשכל]?";

const REFURBISHED = new RegExp(
  `${B}(?:${PREFIX}מחודש(?:ת|ים|ות)?|refurbished|refurb|renewed|reconditioned)${E}`,
  "iu",
);
const USED = new RegExp(
  `${B}(?:${PREFIX}משומש(?:ת|ים|ות)?|${PREFIX}יד\\s*(?:שנ(?:י)?יה|2)|used|pre-owned|second[\\s-]?hand)${E}`,
  "iu",
);

/** המצב לפי המילים שבעל החנות כתב (שם המוצר, הקטגוריה). מחודש קודם (המילה הספציפית); null = אין מילה כזו */
export function conditionFromWords(...texts: (string | null | undefined)[]): ItemCondition | null {
  const text = texts.filter(Boolean).join(" \n ");
  if (!text) return null;
  if (REFURBISHED.test(text)) return "refurbished";
  if (USED.test(text)) return "used";
  return null;
}

/** המצב לנתונים המובנים: מה שנקבע במוצר, אחרת לפי המילים, אחרת חדש */
export function resolveCondition(
  explicit: string | null | undefined,
  name: string | null | undefined,
  category: string | null | undefined,
): ItemCondition {
  if (isItemCondition(explicit)) return explicit;
  return conditionFromWords(name, category) ?? "new";
}

export type Gtin = { key: "gtin8" | "gtin12" | "gtin13" | "gtin14"; value: string };

/** ספרת ביקורת GS1 (mod 10, משקלות 3/1 מימין) */
function gs1CheckOk(code: string): boolean {
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(code[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

/** קידומת GS1 של מספר שאינו מוצר מסחרי (קוד פנימי / אזורי, קופון, קבלת החזר, דוגמה) */
function restrictedPrefix(prefix3: number): boolean {
  return (
    (prefix3 >= 20 && prefix3 <= 29) ||
    (prefix3 >= 40 && prefix3 <= 59) ||
    (prefix3 >= 200 && prefix3 <= 299) ||
    prefix3 === 952 ||
    (prefix3 >= 980 && prefix3 <= 984) ||
    prefix3 >= 990
  );
}

/** הברקוד כ-GTIN לנתונים המובנים — רק כשהוא GTIN אמיתי; אחרת null (הברקוד עדיין מוצג בעמוד) */
export function gtinOf(barcode: string | null | undefined): Gtin | null {
  const code = String(barcode ?? "").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(code)) return null;
  if (/^(\d)\1+$/.test(code)) return null; // 0000000000000 וכו'
  if (!gs1CheckOk(code)) return null;
  switch (code.length) {
    case 8:
      // GTIN-8 שמתחיל ב-0 או ב-2: מספר להפצה מוגבלת (RCN-8)
      return code[0] === "0" || code[0] === "2" ? null : { key: "gtin8", value: code };
    case 12:
      return restrictedPrefix(Number(`0${code.slice(0, 2)}`))
        ? null
        : { key: "gtin12", value: code };
    case 13:
      return restrictedPrefix(Number(code.slice(0, 3))) ? null : { key: "gtin13", value: code };
    case 14:
      return restrictedPrefix(Number(code.slice(1, 4))) ? null : { key: "gtin14", value: code };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- מותג (הצעה בלבד, לאישור)

type KnownBrand = {
  name: string;
  /** מילים (באותיות קטנות) שמזהות את המותג בשם מוצר; כמה מילים — ברצף */
  tokens: string[];
  /** יצרן של מכשירים: אביזר "ל-iPhone" / "לנובו" הוא לרוב של יצרן אחר — לא מציעים */
  device?: boolean;
};

// מותגים נפוצים בחנויות בפלטפורמה (מחשבים ואלקטרוניקה, מזון ומשקאות). רק מילים חד-משמעיות: "אפל" (גם "חשוך"),
// "דל", "XL", "Corona" — לא ברשימה. הרשימה רק מציעה; בעל החנות מאשר / עורך / דוחה.
const KNOWN_BRANDS: KnownBrand[] = [
  {
    name: "Apple",
    tokens: ["apple", "iphone", "ipad", "macbook", "imac", "airpods", "אייפון", "אייפד", "מקבוק"],
    device: true,
  },
  { name: "Samsung", tokens: ["samsung", "galaxy", "סמסונג", "גלקסי"], device: true },
  {
    name: "Lenovo",
    tokens: ["lenovo", "thinkpad", "ideapad", "thinkcentre", "legion", "לנובו"],
    device: true,
  },
  {
    name: "HP",
    tokens: ["hp", "hewlett packard", "elitebook", "probook", "elitedesk", "prodesk", "omen"],
    device: true,
  },
  {
    name: "Dell",
    tokens: ["dell", "latitude", "optiplex", "inspiron", "vostro", "alienware"],
    device: true,
  },
  { name: "Asus", tokens: ["asus", "zenbook", "vivobook", "rog", "אסוס"], device: true },
  { name: "Acer", tokens: ["acer", "aspire", "nitro", "predator", "אייסר"], device: true },
  { name: "MSI", tokens: ["msi"], device: true },
  {
    name: "Microsoft",
    tokens: ["microsoft", "surface pro", "surface laptop", "surface go", "xbox", "מיקרוסופט"],
    device: true,
  },
  { name: "Xiaomi", tokens: ["xiaomi", "redmi", "poco", "שיאומי"], device: true },
  { name: "Huawei", tokens: ["huawei", "הואווי"], device: true },
  { name: "Google", tokens: ["google pixel", "pixel", "chromecast"], device: true },
  { name: "Sony", tokens: ["sony", "playstation", "סוני"], device: true },
  { name: "LG", tokens: ["lg"], device: true },
  { name: "Toshiba", tokens: ["toshiba", "dynabook"], device: true },
  { name: "Nintendo", tokens: ["nintendo"], device: true },
  { name: "Logitech", tokens: ["logitech", "לוג'יטק", "לוגיטק"] },
  { name: "Razer", tokens: ["razer"] },
  { name: "Corsair", tokens: ["corsair"] },
  { name: "HyperX", tokens: ["hyperx"] },
  { name: "Kingston", tokens: ["kingston"] },
  { name: "SanDisk", tokens: ["sandisk"] },
  { name: "Western Digital", tokens: ["western digital", "wd"] },
  { name: "Seagate", tokens: ["seagate"] },
  { name: "Crucial", tokens: ["crucial"] },
  { name: "ADATA", tokens: ["adata"] },
  { name: "Transcend", tokens: ["transcend"] },
  { name: "Lexar", tokens: ["lexar"] },
  { name: "Intel", tokens: ["intel", "אינטל"] },
  { name: "AMD", tokens: ["amd", "ryzen", "radeon"] },
  { name: "NVIDIA", tokens: ["nvidia", "geforce"] },
  { name: "Gigabyte", tokens: ["gigabyte", "aorus"] },
  { name: "ASRock", tokens: ["asrock"] },
  { name: "TP-Link", tokens: ["tp-link", "tplink", "tp link"] },
  { name: "D-Link", tokens: ["d-link", "dlink"] },
  { name: "Netgear", tokens: ["netgear"] },
  { name: "Ubiquiti", tokens: ["ubiquiti", "unifi"] },
  { name: "MikroTik", tokens: ["mikrotik"] },
  { name: "Cisco", tokens: ["cisco"] },
  { name: "Synology", tokens: ["synology"] },
  { name: "QNAP", tokens: ["qnap"] },
  { name: "Epson", tokens: ["epson"] },
  { name: "Canon", tokens: ["canon"] },
  { name: "Brother", tokens: ["brother"] },
  { name: "BenQ", tokens: ["benq"] },
  { name: "ViewSonic", tokens: ["viewsonic"] },
  { name: "AOC", tokens: ["aoc"] },
  { name: "Philips", tokens: ["philips", "פיליפס"] },
  { name: "JBL", tokens: ["jbl"] },
  { name: "Bose", tokens: ["bose"] },
  { name: "Sennheiser", tokens: ["sennheiser"] },
  { name: "Jabra", tokens: ["jabra"] },
  { name: "Anker", tokens: ["anker"] },
  { name: "Belkin", tokens: ["belkin"] },
  { name: "Ugreen", tokens: ["ugreen"] },
  { name: "Baseus", tokens: ["baseus"] },
  { name: "APC", tokens: ["apc"] },
  { name: "Eaton", tokens: ["eaton"] },
  { name: "Targus", tokens: ["targus"] },
  { name: "Cooler Master", tokens: ["cooler master", "coolermaster"] },
  { name: "Thermaltake", tokens: ["thermaltake"] },
  { name: "NZXT", tokens: ["nzxt"] },
  { name: "Noctua", tokens: ["noctua"] },
  { name: "Coca-Cola", tokens: ["coca-cola", "coca cola", "קוקה קולה", "קוקה-קולה"] },
  { name: "Pepsi", tokens: ["pepsi", "פפסי"] },
  { name: "Schweppes", tokens: ["schweppes", "שוופס"] },
  { name: "Prigat", tokens: ["prigat", "פריגת"] },
  { name: "Neviot", tokens: ["neviot", "נביעות"] },
  { name: "Mey Eden", tokens: ["mey eden", "מי עדן"] },
  { name: "Tnuva", tokens: ["tnuva", "תנובה"] },
  { name: "Strauss", tokens: ["strauss", "שטראוס"] },
  { name: "Osem", tokens: ["osem", "אסם"] },
  { name: "Heineken", tokens: ["heineken", "הייניקן"] },
  { name: "Carlsberg", tokens: ["carlsberg", "קרלסברג"] },
  { name: "Tuborg", tokens: ["tuborg", "טובורג"] },
  { name: "Goldstar", tokens: ["goldstar", "גולדסטאר"] },
  { name: "Red Bull", tokens: ["red bull", "redbull", "רד בול"] },
  { name: "Nestlé", tokens: ["nestle", "nestlé", "נסטלה"] },
  { name: "Nescafé", tokens: ["nescafe", "nescafé", "נסקפה"] },
  { name: "Lipton", tokens: ["lipton", "ליפטון"] },
  { name: "Wissotzky", tokens: ["wissotzky", "ויסוצקי"] },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenRe = (token: string) =>
  new RegExp(`${B}${token.split(/\s+/).map(escape).join("[\\s-]+")}${E}`, "iu");
const BRAND_RES = KNOWN_BRANDS.map((b) => ({ brand: b, res: b.tokens.map(tokenRe) }));

// "תואם ל..." / "עבור" / "compatible" — המותג שבשם הוא של המכשיר שהמוצר מתאים לו, לא של המוצר
const COMPATIBLE = new RegExp(
  `${B}(?:[הו]?תוא(?:ם|מת|מים|מות)|עבור|מתאים|מתאימה|compatible|for)${E}`,
  "iu",
);
// אביזר למכשיר ("כיסוי לאייפון", "מטען ל-Lenovo") — אלא אם כתוב שהוא מקורי
const ACCESSORY = new RegExp(
  `${B}(?:[הו]?(?:מטען|סוללה|סוללת|כבל|מגן|כיסוי|נרתיק|תיק|מעמד|מתאם|ספק|רצועה|זכוכית|פילם|case|cover|charger|battery|cable|adapter|sleeve|strap))${E}`,
  "iu",
);
const ORIGINAL = new RegExp(`${B}(?:מקורי|מקורית|מקוריים|original|genuine|oem)${E}`, "iu");
// מותג שכתוב מיד אחרי "ל" ("לנובו" בפני עצמו — כן; "ל-Lenovo", "לLenovo", "ל iPhone" — לכבוד מכשיר אחר)
const FOR_PREFIX = /ל[\s-]?$/u;

/** מותג מוכר שכתוב בשם המוצר — רק כשהוא חד-משמעי; null = לא מציעים (אין מותג, כמה מותגים, אביזר תואם) */
export function brandFromName(
  name: string | null | undefined,
): { brand: string; matched: string } | null {
  const text = String(name ?? "").trim();
  if (!text) return null;
  if (COMPATIBLE.test(text)) return null;
  const hits: { brand: KnownBrand; matched: string; index: number }[] = [];
  for (const { brand, res } of BRAND_RES) {
    for (const re of res) {
      const m = re.exec(text);
      if (m) {
        hits.push({ brand, matched: m[0], index: m.index });
        break;
      }
    }
  }
  const distinct = [...new Map(hits.map((h) => [h.brand.name, h])).values()];
  if (distinct.length !== 1) return null;
  const hit = distinct[0]!;
  if (FOR_PREFIX.test(text.slice(0, hit.index))) return null;
  if (hit.brand.device && ACCESSORY.test(text) && !ORIGINAL.test(text)) return null;
  return { brand: hit.brand.name, matched: hit.matched };
}
