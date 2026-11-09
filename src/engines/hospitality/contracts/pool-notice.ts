// הודעת שעות הבריכה ללקוח, מתוך מה שהעסק שלח (הצילום של החוזה — מיגרציה 64): שעות הבריכה, ובאירוע —
// השימוש בבריכה בו (נפרד משעות האירוע). אותו נוסח בדף החתימה, במייל לחתימה ובדף "תיעוד החתימה" ב-PDF.
// היא מחוץ לנוסח ההסכם — הנוסח עצמו לא משתנה (סעיפי שעות הבריכה כבר בחוזים). טהור — גם לבדיקות היחידה.
import type { ContractKind, ContractPool } from "../types/contracts";

export function poolNotice(kind: ContractKind, p: ContractPool | null | undefined): string | null {
  if (!p || !p.open || !p.close) return null;
  const hours = `${p.open}–${p.close}`;
  if (kind === "pool_event" && p.window_known) {
    if (!p.start || !p.end)
      return `באירוע הזה אין שימוש בבריכה — אסור להיכנס למים. שעות הבריכה: ${hours} בלבד.`;
    // האירוע ממשיך אחרי סוף השימוש בבריכה (או נגמר אחרי חצות)
    const goesOn =
      !!p.event_start && !!p.event_end && (p.event_end <= p.event_start || p.event_end > p.end);
    return `השימוש בבריכה באירוע: ${p.start}–${p.end} בלבד. הבריכה פתוחה ${hours}, ואסור להיכנס למים מחוץ לשעות אלו${
      goesOn ? " — גם כשהאירוע ממשיך אחריהן" : ""
    }.`;
  }
  return `הבריכה פתוחה ${hours} בלבד, ואסור להיכנס למים מחוץ לשעות אלו.`;
}
