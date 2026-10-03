import { Check, CircleX, TriangleAlert } from "lucide-react";
import type { OrderStatus } from "@/lib/orders";
import { cn } from "@/lib/utils";

type Step = { label: string; statuses: readonly OrderStatus[] };

/** חנות שמסמנת "נשלחה" בלי שליח — שלושה שלבים, ו"נשלחה" הוא הסוף */
const SHIPPED_STEPS: Step[] = [
  { label: "התקבלה", statuses: ["pending", "agent_review"] },
  { label: "בהכנה", statuses: ["picking", "picked"] },
  { label: "נשלחה", statuses: ["shipped"] },
];

/** משלוח עם שליח — ארבעה שלבים, עד "נמסרה" */
const COURIER_STEPS: Step[] = [
  { label: "התקבלה", statuses: ["pending", "agent_review"] },
  { label: "בהכנה", statuses: ["picking", "picked"] },
  { label: "במשלוח", statuses: ["awaiting_courier", "shipped"] },
  { label: "נמסרה", statuses: ["delivered"] },
];

/** סטטוסים שבהם השלב הנוכחי כבר הושלם (סוף הזרימה) */
const FINAL: readonly OrderStatus[] = ["shipped", "delivered"];

/**
 * התקדמות ההזמנה ללקוח: התקבלה → בהכנה → במשלוח → נמסרה
 * (או התקבלה → בהכנה → נשלחה, כשהחנות לא עובדת עם שליח), או "בוטלה".
 * attempts — ניסיונות מסירה שנכשלו (השליח ינסה שוב).
 */
export function OrderStatusSteps({
  status,
  attempts = 0,
}: {
  status: OrderStatus;
  attempts?: number;
}) {
  if (status === "cancelled") {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
        <CircleX className="size-4 shrink-0" aria-hidden="true" />
        ההזמנה בוטלה
      </p>
    );
  }
  const steps = status === "shipped" ? SHIPPED_STEPS : COURIER_STEPS;
  const current = steps.findIndex((step) => step.statuses.includes(status));
  return (
    <div className="space-y-2">
      <ol className="flex items-center" aria-label="מצב ההזמנה">
        {steps.map((step, index) => {
          const done = index < current || (index === current && FINAL.includes(status));
          const active = index === current && !done;
          return (
            <li key={step.label} className="flex flex-1 items-center last:flex-none">
              <span className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold",
                    done && "border-green-600 bg-green-600 text-white",
                    active && "border-primary bg-primary/10 text-primary",
                    !done && !active && "border-border bg-background text-muted-foreground",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  {done ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap text-xs",
                    done || active ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
              </span>
              {index < steps.length - 1 && (
                <span
                  className={cn(
                    "mx-1.5 mb-5 h-0.5 flex-1 rounded-full",
                    index < current ? "bg-green-600" : "bg-border",
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
      {status === "awaiting_courier" && attempts > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          {attempts === 1
            ? "ניסיון המסירה לא הצליח — השליח ינסה שוב."
            : `${attempts} ניסיונות מסירה לא הצליחו — השליח ינסה שוב.`}{" "}
          אפשר ליצור איתנו קשר לתיאום.
        </p>
      )}
    </div>
  );
}
