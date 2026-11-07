// לוח הבקרה של בעל העסק (שלב F3) — מה שהמסד מחזיר (מיגרציה 20261105090000_hosp_dashboard.sql).
// סכומים — במטבע העסק; null — אין הרשאה כספית (נאכף במסד) / אין נתון.

export interface DashboardNumbers {
  /** הזמנות שנוצרו בתקופה (בלי שנדחו / פגו / בוטלו) */
  bookings: number;
  /** הזמנות שבוטלו / לא הגיעו בתקופה */
  cancellations: number;
  /** לילות שנמכרו (לילות הזמנה בתוך התקופה) */
  nights_sold: number;
  occupied_nights: number;
  /** מתוך התפוסים: מ-Airbnb / Booking / ערוצים */
  channel_nights: number;
  /** חסימות פנימיות — מורידות זמינות, לא תפוסה */
  blocked_nights: number;
  available_nights: number;
  /** אחוז (עשרוני אחד); null — אין לילות זמינים */
  occupancy: number | null;
  /** לילות בתקופה אחרי הנחות */
  revenue: number | null;
  /** תשלומים שנרשמו בתקופה, בניכוי החזרים */
  collected: number | null;
  /** מחיר ממוצע ללילה */
  adr: number | null;
}

export interface DashboardSeriesPoint {
  /** תחילת היום / השבוע (ראשון) / החודש */
  start: string;
  days: number;
  bookings: number;
  revenue: number | null;
  occupancy: number | null;
}

export interface DashboardOverview {
  me: { first_name: string | null };
  period: {
    from: string;
    to: string;
    days: number;
    bucket: "day" | "week" | "month";
    previous_from: string;
    previous_to: string;
    today: string;
  };
  currency: string;
  /** יש הרשאה לנתונים כספיים (בעלים, או מנהל שקיבל) */
  finance: boolean;
  units: number;
  current: DashboardNumbers;
  /** null — אין השוואה (האתר לא היה קיים בתקופה הקודמת) */
  previous: DashboardNumbers | null;
  pending: { count: number; next_expiry: string | null };
  series: DashboardSeriesPoint[];
  /** אותה חלוקה לתקופה הקודמת (הקו המקווקו); null — אין השוואה */
  previous_series: DashboardSeriesPoint[] | null;
}

export interface DashboardStay {
  id: string;
  number: number;
  status: string;
  state: string;
  /** "נועה ל." */
  guest: string;
  unit_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  payment_status: "unpaid" | "deposit_paid" | "paid";
  source: string;
  channel: string | null;
  /** לפעולות "הגיעו" / "עזבו" — שלא נפעל על מצב ישן */
  revision: number;
}

export interface DashboardToday {
  today: string;
  check_in_time: string | null;
  check_out_time: string | null;
  arrivals: DashboardStay[];
  departures: DashboardStay[];
  staying: number;
  upcoming: DashboardStay[];
}

export type DashboardTaskKind =
  | "pending"
  | "cancel_requests"
  | "deposits"
  | "channels"
  | "emails"
  | "prices"
  | "site"
  | "plan"
  | "open_dates"
  /** שלב א' 5: אישורי העברה שהאורחים העלו וממתינים לבדיקה (נוסף בממשק, מ-payment_proofs_waiting) */
  | "proofs";

export interface DashboardTask {
  kind: DashboardTaskKind;
  severity: "high" | "medium" | "low";
  count: number;
  due?: string | null;
  booking_id?: string | null;
  booking_number?: number | null;
  conflicts?: number;
  failing?: number;
  inactive?: boolean;
  /** מיגרציה 43 (open_dates): יחידות שאין בהן תאריכים פתוחים / שנשארו להן פחות מ-14 לילות פתוחים */
  closed?: number;
  ending?: number;
  /** הלילה האחרון הפתוח הקרוב ביותר */
  until?: string | null;
}

export interface DashboardTasks {
  items: DashboardTask[];
  count: number;
}
