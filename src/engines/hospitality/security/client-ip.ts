// כתובת ה-IP של הגולש — רק ממקור שהשרת שלנו קובע (ממצא AUTH-03 בתוכנית האבטחה):
//   1. X-Real-IP — ה-Nginx של השרת כותב אותו מחדש בכל בקשה ($remote_addr; deploy/nginx). ערך
//      שהגיע מהדפדפן נדרס;
//   2. אחרת — ההופ האחרון ב-X-Forwarded-For: מה שהפרוקסי שלנו הוסיף. הערכים לפניו נשלחו
//      מהדפדפן, ואפשר לזייף אותם — ולכן לא לוקחים את הראשון (כמו המנגנון הישן בזיכרון).
// טהור (בלי Node / דפדפן) — נבדק ביחידה.

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** "1.2.3.4" / "2001:db8::1" — רק כתובת תקינה (לא שם, לא פורט, לא רשימה) */
export function normalizeIp(raw: string | null | undefined): string | null {
  let v = String(raw ?? "").trim();
  if (!v || v.length > 64) return null;
  // [2001:db8::1]:443 / 1.2.3.4:5678 → הכתובת בלבד
  const bracket = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/.exec(v);
  if (bracket) v = bracket[1]!;
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  // IPv4 בתוך IPv6 (::ffff:1.2.3.4) — כתובת IPv4 רגילה
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (mapped) v = mapped[1]!;
  if (IPV4.test(v)) return v;
  const groups = expandIpv6(v);
  return groups ? groups.join(":") : null;
}

/** IPv6 מלא: 8 קבוצות של 4 ספרות הקסה (lowercase); null — לא כתובת IPv6 */
export function expandIpv6(v: string): string[] | null {
  if (!/^[0-9a-fA-F:]+$/.test(v) || !v.includes(":")) return null;
  const parts = v.toLowerCase().split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 ? head.length !== 8 : missing < 1) return null;
  const all = [...head, ...Array<string>(parts.length === 2 ? missing : 0).fill("0"), ...tail];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => g.padStart(4, "0"));
}

/** ה-IP של הבקשה (לפי הכללים שלמעלה); "unknown" — כשאין (קריאה פנימית / בדיקות) */
export function clientIp(headers: Pick<Headers, "get">): string {
  const real = normalizeIp(headers.get("x-real-ip"));
  if (real) return real;
  const hops = (headers.get("x-forwarded-for") ?? "").split(",");
  const last = normalizeIp(hops[hops.length - 1]);
  return last ?? "unknown";
}

/**
 * הרשת של הכתובת — להגבלה רחבה יותר מכתובת אחת: /24 ב-IPv4, /64 ב-IPv6 (ספק נותן ללקוח
 * אחד /64 שלם, ולכן החלפת כתובת בתוך הרשת לא עוקפת את ההגבלה).
 */
export function ipNetwork(ip: string): string {
  if (IPV4.test(ip)) return `${ip.split(".").slice(0, 3).join(".")}.0/24`;
  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : ip;
}

/** ההגבלה לפי כתובת ב-IPv6 היא תמיד לפי /64 (כתובת בודדת חסרת משמעות שם) */
export function ipSubject(ip: string): string {
  return IPV4.test(ip) || ip === "unknown" ? ip : ipNetwork(ip);
}
