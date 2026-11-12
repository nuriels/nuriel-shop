// חתימה בציור: קווים בלבד ("M x,y L x,y …", בתוך 600×200, מספרים שלמים) — אותו כלל כמו במסד
// (_signature_paths, מיגרציה 63). שום SVG חופשי לא נשמר: התצוגה בונה את ה-SVG מהקווים בעצמה.
export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;
export const SIGNATURE_MAX_PATHS = 60;
const PATH = /^M[0-9]{1,3},[0-9]{1,3}( L[0-9]{1,3},[0-9]{1,3})*$/;

export type ContractSignature =
  { kind: "drawn"; paths: string[] } | { kind: "typed"; name: string };

/** הקווים תקינים: 1–60 קווים, כל קו לפי התבנית, בתוך התחום, ולפחות 3 נקודות בסך הכל */
export function validSignaturePaths(paths: unknown): paths is string[] {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > SIGNATURE_MAX_PATHS) return false;
  let points = 0;
  for (const p of paths) {
    if (typeof p !== "string" || p.length < 3 || p.length > 8000 || !PATH.test(p)) return false;
    for (const [x, y] of pathPoints(p)) {
      if (x > SIGNATURE_WIDTH || y > SIGNATURE_HEIGHT) return false;
      points++;
    }
  }
  return points >= 3;
}

/** הנקודות של קו אחד */
export function pathPoints(path: string): [number, number][] {
  return [...path.matchAll(/([0-9]+),([0-9]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

/** נקודה מתוך הקואורדינטות של המסך → בתוך 600×200, מעוגל (כמו במסד) */
export function clampPoint(x: number, y: number): string {
  const cx = Math.max(0, Math.min(SIGNATURE_WIDTH, Math.round(x)));
  const cy = Math.max(0, Math.min(SIGNATURE_HEIGHT, Math.round(y)));
  return `${cx},${cy}`;
}

/**
 * נקודה על לוח החתימה (בפיקסלים, מהפינה של אזור הציור; w×h — גודל האזור) → בתוך 600×200: קנה מידה
 * אחיד אחד (כמו "slice" בתצוגה), ממורכז — כך שהחתימה נשמרת בפרופורציות שלה בכל צורת לוח. נקודה מחוץ
 * ללוח (האצבע / העכבר יצאו ממנו באמצע קו) נצמדת לקצה הלוח — אין "דיו" מחוץ למה שהחותם רואה.
 */
export function padPoint(x: number, y: number, w: number, h: number): string {
  const k = Math.min(SIGNATURE_WIDTH / w, SIGNATURE_HEIGHT / h);
  const px = Math.max(0, Math.min(w, x));
  const py = Math.max(0, Math.min(h, y));
  return clampPoint(
    (SIGNATURE_WIDTH - w * k) / 2 + px * k,
    (SIGNATURE_HEIGHT - h * k) / 2 + py * k,
  );
}
