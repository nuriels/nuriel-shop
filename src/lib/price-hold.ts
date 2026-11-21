// מחיר של אורח מה-HTML שנבנה בשרת — לא מוצג למי שמחובר עד שהמחירון שלו נטען בדפדפן.
//
// השרת בונה את עמודי החנות בלי משתמש (ההתחברות שמורה בדפדפן, לא בעוגייה) — אז ב-HTML יש רק את
// המחירון של אורח, ואף פעם לא מחיר אישי. לקוח מחובר עם מחירון משלו היה רואה לשנייה את המחיר של אורח
// עד שהקטלוג שלו נטען (ההוספה לסל כבר חסומה באותו זמן). עכשיו:
//   • סקריפט קטן ב-<head> (לפני הציור הראשון) מסמן <html data-signed-in> כשיש התחברות שמורה בדפדפן;
//   • כל מחיר בעמודים האלה מסומן data-price; כל עוד הקטלוג של מי שמחובר לא נטען — data-price="hold";
//   • styles.css: html[data-signed-in] [data-price="hold"] — מוסתר (בלי קפיצה בעמוד). אורח (וגוגל) —
//     רואה את המחירים מה-HTML מיד, כמו קודם.
// ההקשר עובר גם לחלונות (Dialog בפורטל) — React מעביר context דרך פורטלים.
import { createContext, useContext } from "react";

/** true — המחירים בעמוד עוד מה-HTML של השרת (של אורח), עד שהקטלוג של מי שמחובר נטען בדפדפן */
const PriceHoldContext = createContext(false);

export const PriceHoldProvider = PriceHoldContext.Provider;

/** הערך של data-price על מחיר: "hold" — עוד לא המחיר של מי שמחובר; "" — המחיר הנכון */
export function usePriceAttr(): "hold" | "" {
  return useContext(PriceHoldContext) ? "hold" : "";
}

/** הסימון על <html> (מה-<head>, לפני הציור הראשון): יש בדפדפן התחברות שמורה */
export const SIGNED_IN_ATTR = "data-signed-in";

/**
 * רץ ב-<head> לפני הציור הראשון: מפתח ההתחברות של Supabase בדפדפן הוא "sb-<project>-auth-token".
 * רק רמז לתצוגה — לא הרשאה: מי שאין לו מפתח רואה את המחירים מיד (כמו קודם), ומי שיש לו מפתח ישן —
 * רואה אותם רגע אחרי, כשהקטלוג נטען. לא נוגע בשום ערך, רק בשמות המפתחות.
 */
export const SIGNED_IN_HINT_SCRIPT = `try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf("sb-")===0&&k.slice(-11)==="-auth-token"){document.documentElement.setAttribute("${SIGNED_IN_ATTR}","");break}}}catch(e){}`;
