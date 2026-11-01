// עסק הדגמה מלא — "צימרי הגליל" (פיקטיבי בלבד) — שלבים 2d → 3a, דרך הפונקציות האמיתיות של
// אזור הניהול ובטוקן של הבעלים, כמו מהאפליקציה:
//   2d — מיטות לכל חדר, מבוגרים / ילדים, שירותים נפרדים, מתקנים ביחידה ובמתחם (מהרשימה + משלכם),
//        חניה, מיקום, מידע לאורחים, כללי המקום, מידע פרטי להגעה (unit_update, property_update,
//        amenity_add_preset, amenity_create, arrival_info_set);
//   2e — תמונות: נוצרות כאן (נוף מצויר — בלי צילומים של אף אחד), מקודדות ב-sharp בדיוק כמו בשרת
//        (WebP: 1600 / 960 / 480 / 320×240) ונשמרות בדלי hosp-media בטוקן של הבעלים — מדיניות
//        ה-Storage של האתר חלה — ואז media_add / media_update (ALT) כמו מסך התמונות;
//   2f — מחירים, סוף שבוע, עונת קיץ, מדיניות ביטול כברירת מחדל (unit_prices_set, rate_rule_save,
//        policy_save, policy_set_default);
//   3a — הזמנות (create_manual_booking — מאושרות, ממתינה לאישור, שוהים עכשיו) וחסימה (block_create).
// לא נוגעים ב"סוויטת הנוף" ובחברות ב"כל המתחם" — הסיור המוקלט (פרקים 08–09) משנה אותם.
import { randomUUID } from "node:crypto";

const DAY = 86400000;
const date = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
/** יום בשבוע (0 = ראשון) — הקרוב שהוא לפחות בעוד n ימים */
const nextDow = (n, dow) => {
  const d = new Date(Date.now() + n * DAY);
  d.setUTCDate(d.getUTCDate() + ((dow - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
};

/** פרטי היחידות — לפי השם */
const UNITS = {
  "צימר הגפן": {
    changes: {
      max_adults: 2,
      max_children: 0,
      separate_toilets: 0,
      beds: [{ bed_type: "king", quantity: 1, room_label: "חדר השינה" }],
    },
    amenities: [
      ["jacuzzi", "ג׳קוזי זוגי מחומם"],
      ["wifi"],
      ["ac"],
      ["coffee_machine"],
      ["view", "נוף להרי הגליל"],
    ],
    prices: { base_price: 750, extra_adult_price: 0, extra_child_price: 0, min_nights: 1 },
  },
  "צימר האלון": {
    changes: {
      max_adults: 4,
      max_children: 2,
      separate_toilets: 1,
      beds: [
        { bed_type: "queen", quantity: 1, room_label: "חדר הורים" },
        { bed_type: "single", quantity: 2, room_label: "חדר ילדים" },
        { bed_type: "crib", quantity: 1, room_label: "חדר הורים" },
      ],
    },
    amenities: [
      ["wifi"],
      ["ac"],
      ["kitchenette"],
      ["fridge"],
      ["microwave"],
      ["yard", "חצר פרטית מגודרת"],
      ["bbq"],
    ],
    prices: { base_price: 850, extra_adult_price: 150, extra_child_price: 80, min_nights: 2 },
  },
  "צימר התאנה": {
    changes: {
      max_adults: 2,
      max_children: 1,
      separate_toilets: 0,
      beds: [
        { bed_type: "double", quantity: 1, room_label: "חדר השינה" },
        { bed_type: "sofa_bed", quantity: 1, room_label: "סלון" },
      ],
    },
    amenities: [["wifi"], ["ac"], ["tv"], ["balcony"], ["accessibility", "כניסה ללא מדרגות"]],
    prices: { base_price: 650, extra_adult_price: 0, extra_child_price: 70, min_nights: 1 },
  },
};

const PROPERTY = {
  location: { lat: 33.0189, lng: 35.4925 },
  parking: "free",
  parking_type: "private",
  parking_spaces: 6,
  parking_instructions: "חניה פרטית מול השער הירוק — מקום אחד לכל צימר.",
  guest_info: "מכולת בכניסה למושב (5 דקות הליכה). מסלול הליכה לנחל דלתון יוצא מהשער האחורי.",
  rules_smoking: "outside",
  rules_pets: "on_request",
  rules_pets_note: "כלבים קטנים בתיאום מראש",
  rules_events: "no",
  quiet_from: "22:00",
  quiet_to: "08:00",
  rules_custom: ["נא לכבות מזגנים ביציאה מהצימר", "הג׳קוזי פתוח עד חצות"],
};
const SHARED_AMENITIES = [
  ["pool", "בריכה משותפת, פתוחה מאי–ספטמבר"],
  ["breakfast", "ארוחת בוקר בתוספת תשלום"],
];

/** "תמונות" — נוף מצויר (SVG → sharp → WebP), כל אחת בצבעים אחרים */
const SCENES = [
  { alt: "הצימר בין הכרמים בשקיעה", sky: ["#f97316", "#fde68a"], hills: ["#3f6212", "#65a30d"] },
  { alt: "מרפסת עם נוף להרי הגליל", sky: ["#38bdf8", "#e0f2fe"], hills: ["#166534", "#4ade80"] },
  { alt: "הבריכה המשותפת בבוקר", sky: ["#0ea5e9", "#bae6fd"], hills: ["#0f766e", "#2dd4bf"] },
  { alt: "החצר הפרטית בערב", sky: ["#6d28d9", "#f0abfc"], hills: ["#1e3a8a", "#6366f1"] },
];
const sceneSvg = ({
  sky,
  hills,
}) => `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
  <rect width="1800" height="1200" fill="url(#s)"/>
  <circle cx="1350" cy="330" r="130" fill="#fff7ed" opacity="0.85"/>
  <path d="M0 760 Q 450 520 900 720 T 1800 640 V1200 H0Z" fill="${hills[0]}"/>
  <path d="M0 900 Q 500 720 1000 880 T 1800 820 V1200 H0Z" fill="${hills[1]}"/>
  <rect x="640" y="700" width="360" height="230" fill="#fef3c7"/><path d="M610 710 L820 560 L1030 710Z" fill="#9a3412"/>
  <rect x="790" y="800" width="70" height="130" fill="#78350f"/>
</svg>`;

async function webpSet(sharp, siteId, svg) {
  const id = randomUUID();
  const base = `${siteId}/${id}`;
  const source = () => sharp(Buffer.from(svg));
  const out = (w) =>
    source()
      .resize({ width: w, height: w, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
  const main = await out(1600);
  const w960 = await out(960);
  const w480 = await out(480);
  const thumb = await source()
    .resize({ width: 320, height: 240, fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer();
  const files = [
    [`${base}.webp`, main.data],
    [`${base}-960.webp`, w960.data],
    [`${base}-480.webp`, w480.data],
    [`${base}-thumb.webp`, thumb],
  ];
  return {
    files,
    item: {
      kind: "image",
      storage_path: `${base}.webp`,
      variants: { 960: `${base}-960.webp`, 480: `${base}-480.webp`, thumb: `${base}-thumb.webp` },
      width: main.info.width,
      height: main.info.height,
      size_bytes: files.reduce((n, [, b]) => n + b.length, 0),
    },
  };
}

/**
 * @param {object} ctx
 * @param {(fn: string, args: object, opts: object) => Promise<any>} ctx.rpc
 * @param {{ token: string, site: string }} ctx.as   — הבעלים, באתר
 * @param {string} ctx.api / ctx.anon                 — Supabase המקומי (לשמירת הקבצים)
 * @param {string} ctx.propertyId
 * @param {Record<string, string>} ctx.unitIdByName
 */
export async function enrichZimmer({
  rpc,
  as,
  api,
  anon,
  propertyId,
  unitIdByName,
  log = () => {},
}) {
  const catalog = await rpc("catalog_view", {}, as);
  const units = catalog.properties.flatMap((p) => p.units);
  const revisionOf = (id) => units.find((u) => u.id === id).revision;

  // ---- 2d: מתקנים (מהרשימה + אחד משלכם), יחידות, מתחם, מידע פרטי להגעה ----
  const amenityIds = {};
  const presets = new Set(
    [...Object.values(UNITS).flatMap((u) => u.amenities), ...SHARED_AMENITIES].map(
      ([code]) => code,
    ),
  );
  for (const code of presets)
    amenityIds[code] = (await rpc("amenity_add_preset", { _code: code }, as)).id;
  const hammock = await rpc(
    "amenity_create",
    { _data: { name: "ערסל בגינה", category: "outdoor", icon: "trees" } },
    as,
  );
  for (const [name, d] of Object.entries(UNITS)) {
    const id = unitIdByName[name];
    const amenities = d.amenities.map(([code, note]) => ({
      amenity_id: amenityIds[code],
      ...(note ? { note } : {}),
    }));
    if (name === "צימר האלון") amenities.push({ amenity_id: hammock.id });
    const saved = await rpc(
      "unit_update",
      { _id: id, _changes: { ...d.changes, amenities }, _expected_revision: revisionOf(id) },
      as,
    );
    await rpc(
      "unit_prices_set",
      { _id: id, _changes: d.prices, _expected_revision: saved.revision },
      as,
    );
  }
  const property = catalog.properties.find((p) => p.id === propertyId);
  await rpc(
    "property_update",
    {
      _id: propertyId,
      _changes: {
        ...PROPERTY,
        amenities: SHARED_AMENITIES.map(([code, note]) => ({ amenity_id: amenityIds[code], note })),
      },
      _expected_revision: property.revision,
    },
    as,
  );
  await rpc(
    "arrival_info_set",
    {
      _property_id: propertyId,
      _unit_id: null,
      _values: { gate_code: "2580#", wifi_name: "Galil-Guests", wifi_password: "demo-wifi-2026" },
      _expected_revision: null,
    },
    as,
  );
  await rpc(
    "arrival_info_set",
    {
      _property_id: propertyId,
      _unit_id: unitIdByName["צימר הגפן"],
      _values: { entry_code: "1357" },
      _expected_revision: null,
    },
    as,
  );
  log("    2d: מיטות, מבוגרים / ילדים, מתקנים, חניה, מיקום, כללים, מידע פרטי להגעה");

  // ---- 2e: תמונות לצימר הגפן ולמתחם ----
  const sharp = (await import("sharp")).default;
  const galleries = [
    ["unit", unitIdByName["צימר הגפן"], SCENES.slice(0, 2)],
    ["property", propertyId, SCENES.slice(2)],
  ];
  for (const [ownerKind, ownerId, scenes] of galleries) {
    for (const scene of scenes) {
      const { files, item } = await webpSet(sharp, as.site, sceneSvg(scene));
      for (const [path, bytes] of files) {
        const res = await fetch(`${api}/storage/v1/object/hosp-media/${path}`, {
          method: "POST",
          headers: {
            apikey: anon,
            authorization: `Bearer ${as.token}`,
            "x-tenant-id": as.site,
            "content-type": "image/webp",
            "cache-control": "31536000",
          },
          body: bytes,
        });
        if (!res.ok)
          throw new Error(`storage ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      const added = await rpc(
        "media_add",
        { _owner_kind: ownerKind, _owner_id: ownerId, _item: item },
        as,
      );
      await rpc("media_update", { _id: added.id, _alt: scene.alt }, as);
    }
  }
  log("    2e: 4 תמונות (2 לצימר הגפן, 2 למתחם) עם טקסט חלופי");

  // ---- 2f: סוף שבוע, עונת קיץ, מדיניות ביטול ברירת מחדל ----
  await rpc(
    "rate_rule_save",
    { _id: null, _data: { name: "סוף שבוע", kind: "weekend", price_mode: "percent", value: 20 } },
    as,
  );
  const summer = new Date().getUTCFullYear() + (new Date().getUTCMonth() > 7 ? 1 : 0);
  await rpc(
    "rate_rule_save",
    {
      _id: null,
      _data: {
        name: "קיץ",
        kind: "season",
        date_from: `${summer}-07-01`,
        date_to: `${summer}-09-01`,
        price_mode: "percent",
        value: 25,
        min_nights: 2,
      },
    },
    as,
  );
  const policy = await rpc(
    "policy_save",
    {
      _id: null,
      _data: {
        name: "רגילה",
        free_cancel_days: 7,
        fee_tiers: [
          { from_days: 7, fee: "percent_total", value: 50 },
          { from_days: 2, fee: "full" },
        ],
        no_show_fee: "full",
        guest_text: "ביטול עד 7 ימים לפני ההגעה — ללא עלות.",
      },
      _expected_version: null,
    },
    as,
  );
  await rpc("policy_set_default", { _id: policy.id }, as);
  log('    2f: מחירים לכל צימר, סוף שבוע +20%, קיץ +25% (מינימום 2 לילות), מדיניות "רגילה"');

  // ---- 3a: הזמנות וחסימה ----
  const book = (unit, from, to, name, phone, extra = {}) =>
    rpc(
      "create_manual_booking",
      {
        _unit_id: unitIdByName[unit],
        _check_in: from,
        _check_out: to,
        _full_name: name,
        _phone: phone,
        _terms_explained: true,
        ...extra,
      },
      as,
    );
  const staying = await book("צימר הגפן", date(0), date(2), "דנה ואבי לוי", "0500000911");
  await rpc("set_stay_status", { _booking_id: staying.booking_id, _status: "checked_in" }, as);
  const friday = nextDow(4, 5);
  await book(
    "צימר הגפן",
    friday,
    date(Math.round((Date.parse(friday) - Date.now()) / DAY) + 2),
    "משפחת כהן",
    "0500000912",
  );
  await book("צימר האלון", date(3), date(6), "רותם ישראלי", "0500000913", {
    _adults: 2,
    _children: 2,
  });
  await book("צימר האלון", date(12), date(14), "נועה בר", "0500000914", {
    _status: "pending_approval",
  });
  await rpc(
    "block_create",
    {
      _unit_id: unitIdByName["צימר התאנה"],
      _from: date(8),
      _to: date(11),
      _reason: "צביעה ותיקונים",
    },
    as,
  );
  log("    3a: 4 הזמנות (שוהים עכשיו, מאושרות, ממתינה לאישור) וחסימה לשיפוץ");
}
