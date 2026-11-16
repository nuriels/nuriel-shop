// "קידום, Analytics ומעקב" בהגדרות העסק: מזהה Google Analytics 4 ומזהה Google Tag Manager — שני הכרטיסים
// הקיימים של שכבת המדידה, זה ליד זה. אין כאן מנגנון מדידה משלו: השמירה והטעינה הן של src/platform/analytics.
import { useCallback, useState } from "react";
import { Ga4Card } from "./Ga4Card";
import { TagManagerCard } from "./TagManagerCard";

export function TrackingSection(props: {
  /** בעל העסק או מנהל הפלטפורמה */
  canManage: boolean;
  /** צימר: ההסכמה באתר היא למדידה בלבד (פרסום חסום) */
  measurementOnly?: boolean;
  /** עוגן לקישור (‎#tracking) */
  id?: string;
}) {
  const [ga4, setGa4] = useState<string | null>(null);
  const onSaved = useCallback((v: string | null) => setGa4(v), []);
  return (
    <section
      id={props.id}
      aria-labelledby="tracking-title"
      className="scroll-mt-20 space-y-4"
      data-testid="tracking-section"
    >
      <div className="space-y-1">
        <h2 id="tracking-title" className="text-xl font-semibold">
          קידום, Analytics ומעקב
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          המזהים נשמרים לעסק הזה בלבד. אפשר להשתמש ב-Google Analytics 4, ב-Google Tag Manager או
          בשניהם — וכל מה שהם טוענים נכנס לאתר רק אחרי שהגולש מאשר עוגיות מדידה.
        </p>
      </div>
      <Ga4Card canManage={props.canManage} onSaved={onSaved} />
      <TagManagerCard
        canManage={props.canManage}
        measurementOnly={props.measurementOnly === true}
        directGa4={Boolean(ga4)}
      />
    </section>
  );
}
