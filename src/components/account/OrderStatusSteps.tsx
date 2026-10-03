import { Check, CircleX } from "lucide-react";
import type { OrderStatus } from "@/lib/orders";
import { cn } from "@/lib/utils";

const STEPS = [
  { label: "התקבלה", statuses: ["pending", "agent_review"] },
  { label: "בהכנה", statuses: ["picking", "picked"] },
  { label: "נשלחה", statuses: ["shipped"] },
] as const;

/** התקדמות ההזמנה ללקוח: התקבלה → בהכנה → נשלחה (או "בוטלה") */
export function OrderStatusSteps({ status }: { status: OrderStatus }) {
  if (status === "cancelled") {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
        <CircleX className="size-4 shrink-0" aria-hidden="true" />
        ההזמנה בוטלה
      </p>
    );
  }
  const current = STEPS.findIndex((step) =>
    (step.statuses as readonly OrderStatus[]).includes(status),
  );
  return (
    <ol className="flex items-center" aria-label="מצב ההזמנה">
      {STEPS.map((step, index) => {
        const done = index < current || (index === current && status === "shipped");
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
            {index < STEPS.length - 1 && (
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
  );
}
