// קרדיט נוריאל הקבוע (D6) — בכל אתר של העסקים. רכיב פלטפורמה: האתר ממקם אותו מחוץ לתוכן
// שאפשר לערוך, כך שלא ניתן להסיר אותו. הערכה קובעת רק צבע / יישור דרך className.
export const NURIEL_CREDIT_TEXT = "כל הזכויות שמורות לנוריאל מחשבים";
export const NURIEL_CREDIT_URL = "https://nuriel-app2.nuri1.fit";

export function NurielCredit({ className }: { className?: string }) {
  return (
    <p className={className} data-nuriel-credit="">
      <a
        href={NURIEL_CREDIT_URL}
        target="_blank"
        rel="noopener"
        className="underline-offset-4 hover:underline"
      >
        {NURIEL_CREDIT_TEXT}
      </a>
    </p>
  );
}
