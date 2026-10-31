// שמות ותיאורים בעברית לסוגי המקומות והיחידות, וברירות המחדל של ההקמה הראשונה
// לכל סוג עסק. טקסט ונתונים בלבד (בלי React) — משמש גם את פונקציית ההקמה בשרת.
import type { PropertyType, UnitType } from "../../types/catalog";

export interface BusinessTypeInfo {
  /** הכותרת בבחירה "מה אתם משכירים?" */
  label: string;
  /** שורת הסבר קצרה מתחת לכותרת */
  hint: string;
  /** יחידה אחת בלבד (צימר בודד, וילה) — השם של המקום הוא גם שם היחידה */
  single: boolean;
  /** איך קוראים ליחידה אחת בסוג הזה ("צימר", "דירה", "חדר") */
  unitWord: string;
  /** כמה שורות יחידה מוצעות בהקמה (סוגים עם כמה יחידות) */
  startUnits: number;
  /** תווית לשם המקום בטופס */
  nameLabel: string;
  namePlaceholder: string;
}

export const BUSINESS_TYPES: Record<PropertyType, BusinessTypeInfo> = {
  zimmer: {
    label: "צימר בודד",
    hint: "יחידה אחת — צימר, בקתה או סוויטה",
    single: true,
    unitWord: "צימר",
    startUnits: 1,
    nameLabel: "שם הצימר",
    namePlaceholder: "למשל: צימר הגפן",
  },
  zimmer_complex: {
    label: "מתחם צימרים",
    hint: "כמה צימרים באותו מקום",
    single: false,
    unitWord: "צימר",
    startUnits: 2,
    nameLabel: "שם המתחם",
    namePlaceholder: "למשל: צימרי הגליל",
  },
  vacation_apartments: {
    label: "דירות נופש",
    hint: "דירה אחת או יותר להשכרה קצרה",
    single: false,
    unitWord: "דירה",
    startUnits: 1,
    nameLabel: "שם העסק או הבניין",
    namePlaceholder: "למשל: דירות הים",
  },
  villa: {
    label: "וילה / בית שלם",
    hint: "בית שמושכר כולו, כיחידה אחת",
    single: true,
    unitWord: "וילה",
    startUnits: 1,
    nameLabel: "שם הווילה",
    namePlaceholder: "למשל: וילה בכרם",
  },
  boutique_hotel: {
    label: "מלון בוטיק",
    hint: "חדרים במבנה אחד",
    single: false,
    unitWord: "חדר",
    startUnits: 3,
    nameLabel: "שם המלון",
    namePlaceholder: "למשל: מלון הכרמל",
  },
  guest_house: {
    label: "בית הארחה",
    hint: "חדרים לאורחים בבית או במשק",
    single: false,
    unitWord: "חדר",
    startUnits: 2,
    nameLabel: "שם בית ההארחה",
    namePlaceholder: "למשל: בית הארחה בעמק",
  },
  other: {
    label: "משהו אחר",
    hint: "סוג אחר — אפשר לשנות את הפרטים בהמשך",
    single: false,
    unitWord: "יחידה",
    startUnits: 1,
    nameLabel: "שם המקום",
    namePlaceholder: "למשל: חוות הסוסים",
  },
};

/** הבחירות במסך הראשון (בית הארחה — מתוך עריכת המתחם) */
export const FIRST_RUN_TYPES: readonly PropertyType[] = [
  "zimmer",
  "zimmer_complex",
  "vacation_apartments",
  "villa",
  "boutique_hotel",
  "other",
];

/** סוג היחידה שנוצר בהקמה לכל סוג עסק */
export function setupUnitType(type: PropertyType): UnitType {
  switch (type) {
    case "zimmer":
    case "zimmer_complex":
      return "zimmer";
    case "vacation_apartments":
      return "apartment";
    case "villa":
      return "villa";
    case "boutique_hotel":
    case "guest_house":
      return "room";
    default:
      return "other";
  }
}

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  zimmer: "צימר",
  zimmer_complex: "מתחם צימרים",
  vacation_apartments: "דירות נופש",
  villa: "וילה / בית שלם",
  boutique_hotel: "מלון בוטיק",
  guest_house: "בית הארחה",
  other: "אחר",
};

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  zimmer: "צימר",
  suite: "סוויטה",
  room: "חדר",
  apartment: "דירה",
  villa: "וילה / בית",
  cabin: "בקתה",
  studio: "סטודיו",
  other: "אחר",
};
