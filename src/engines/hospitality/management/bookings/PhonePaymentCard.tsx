// תשלום טלפוני (D4) — בעמוד ההזמנה: שלושת השלבים בנפרד (בקשה → הזמנה מאושרת → תשלום שנרשם),
// הטלפון של האורח בלחיצה, ומה עושים: מתקשרים, גובים במסוף של העסק, רושמים כאן את התשלום ומאשרים.
// "שולם" מופיע רק אחרי שהתשלום נרשם ביומן התשלומים (לא בגלל אישור ההזמנה).
import { Check, Circle, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, cn } from "@/platform/ui";
import { phoneFlow } from "../../payments/phone";
import type { BookingDetail } from "../../types/bookings";

export function PhonePaymentCard({ b }: { b: BookingDetail }) {
  const flow = phoneFlow({ status: b.status, payment_status: b.payment_status });
  if (!flow.active || (flow.approved && flow.paid)) return null;
  const phone = b.guest.anonymized ? null : b.guest.phone;
  const steps: [string, boolean][] = [
    ["בקשת הזמנה", flow.requested],
    ["הזמנה מאושרת", flow.approved],
    ["תשלום נרשם", flow.paid],
  ];
  return (
    <Card data-section="phone-payment" className="border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">תשלום טלפוני</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ol className="flex flex-wrap items-center gap-2" aria-label="שלבי ההזמנה">
          {steps.map(([label, done], i) => (
            <li
              key={label}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1",
                done
                  ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                  : "text-muted-foreground",
              )}
            >
              {done ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Circle className="size-4" aria-hidden="true" />
              )}
              <span>
                {i + 1}. {label}
                <span className="sr-only">{done ? " — בוצע" : " — עוד לא"}</span>
              </span>
            </li>
          ))}
        </ol>
        {phone && (
          <a
            href={`tel:${phone}`}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-md bg-primary px-4 font-medium text-primary-foreground"
          >
            <Phone className="size-4" aria-hidden="true" />
            התקשרות לאורח · <span dir="ltr">{phone}</span>
          </a>
        )}
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          <li>מתקשרים לאורח וגובים את התשלום במסוף האשראי של העסק.</li>
          <li>
            רושמים את התשלום כאן למטה ב"תשלומים" — סכום, אמצעי, תאריך והערה (אסמכתא). בלי מספר
            כרטיס.
          </li>
          {!flow.approved && <li>מאשרים את ההזמנה — האורח יקבל מייל אישור.</li>}
        </ul>
        <p className="text-xs text-muted-foreground">
          אישור ההזמנה ורישום התשלום נפרדים: ההזמנה מסומנת כשולמה רק אחרי שתרשמו את התשלום.
        </p>
      </CardContent>
    </Card>
  );
}
