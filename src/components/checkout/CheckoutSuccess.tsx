import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock,
  Gift,
  KeyRound,
  MailCheck,
  MapPin,
  Store,
  UserRoundPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ORDER_HOURS } from "@/lib/order-hours";

export type PlacedOrder = {
  orderNumber: string;
  isQuote: boolean;
  gifts: string[];
  /** לאן יישלח המשלוח (כפי שנקלט בקופה) */
  deliveryLine: string;
  /** "לכתובת אחרת" נבחר בקופה */
  alternateDelivery: boolean;
  /** לאן נשלח אישור במייל */
  email: string;
  /** אורח — בלי חשבון (מוצעת פתיחת חשבון לפעם הבאה) */
  guest: boolean;
  /** איך ההזמנה מגיעה: משלוח / איסוף עצמי / דיגיטלי בלבד (null = כמו קודם) */
  shippingKind?: "delivery" | "pickup" | "digital" | null;
  /** שם שיטת המשלוח שנבחרה */
  shippingName?: string | null;
  /** באיסוף עצמי — כתובת העסק */
  pickupAddress?: string | null;
  /** יש בהזמנה מוצרים דיגיטליים (הרישיון יגיע במייל) */
  hasDigital?: boolean;
};

/** מסך האישור אחרי שליחת ההזמנה מהקופה */
export function CheckoutSuccess({ order }: { order: PlacedOrder }) {
  return (
    <Card className="mx-auto max-w-2xl shadow-soft">
      <CardContent className="space-y-5 py-8 text-center sm:px-10">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-green-100 text-green-700">
          <CheckCircle2 className="size-8" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h1 className="font-display text-2xl text-foreground">
            {order.isQuote ? "בקשת הצעת המחיר נשלחה!" : ORDER_HOURS.sentTitle}
          </h1>
          <p className="text-sm text-muted-foreground">
            {order.isQuote ? "מספר בקשה" : "מספר הזמנה"}:{" "}
            <span dir="ltr" className="numeric text-base font-bold text-foreground">
              {order.orderNumber}
            </span>
          </p>
        </div>

        <div className="space-y-3 text-right text-sm leading-6">
          {order.gifts.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-green-600/30 bg-green-50 p-3 text-green-900">
              <Gift className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                צירפנו להזמנה במתנה: <strong>{order.gifts.join(", ")}</strong>
              </span>
            </p>
          )}
          {order.shippingKind === "pickup" ? (
            <p className="flex items-start gap-2 rounded-lg border border-violet-300 bg-violet-50 p-3 text-violet-950 dark:bg-violet-950/30 dark:text-violet-100">
              <Store className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {order.shippingName || "איסוף עצמי"}
                {order.pickupAddress ? (
                  <>
                    {" "}
                    מ: <strong>{order.pickupAddress}</strong>
                  </>
                ) : null}
                . נעדכן כשההזמנה מוכנה לאיסוף.
              </span>
            </p>
          ) : order.shippingKind === "digital" ? null : order.deliveryLine ? (
            <p
              className={
                order.alternateDelivery
                  ? "flex items-start gap-2 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-3 text-amber-950"
                  : "flex items-start gap-2 rounded-lg bg-secondary/70 p-3"
              }
            >
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {order.alternateDelivery ? "משלוח לכתובת אחרת: " : "כתובת למשלוח: "}
                <strong>{order.deliveryLine}</strong>
                {order.shippingName ? ` · ${order.shippingName}` : ""}
              </span>
            </p>
          ) : null}
          {order.hasDigital && (
            <p className="flex items-start gap-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sky-950 dark:bg-sky-950/30 dark:text-sky-100">
              <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                מפתחות הרישיון למוצרים הדיגיטליים יישלחו אליך במייל נפרד
                {order.guest ? "" : " ויופיעו גם באזור האישי, בפרטי ההזמנה"}.
              </span>
            </p>
          )}
          {order.email && (
            <p className="flex items-start gap-2 rounded-lg bg-secondary/70 p-3">
              <MailCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              <span>
                אישור {order.isQuote ? "הבקשה" : "ההזמנה"} עם כל הפרטים יישלח ל-
                <strong dir="ltr">{order.email}</strong>
              </span>
            </p>
          )}
          <p className="flex items-start gap-2 rounded-lg bg-secondary/70 p-3">
            <Clock className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
            <span>{ORDER_HOURS.sentHours}</span>
          </p>
          <p className="font-medium text-foreground">
            {order.isQuote ? "נציג יחזור אליך עם הצעת מחיר בהקדם." : ORDER_HOURS.sentContact}
          </p>
        </div>

        {order.guest && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 text-sm">
            <UserRoundPlus className="size-5 text-primary" aria-hidden="true" />
            <p className="text-foreground">
              רוצים לעקוב אחרי ההזמנות ולהזמין מהר יותר בפעם הבאה? פתחו חשבון — הפרטים ימולאו
              אוטומטית בקופה.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/register">פתיחת חשבון</Link>
            </Button>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild size="lg">
            <Link to="/">להמשך קניות</Link>
          </Button>
          {!order.guest && (
            <Button asChild size="lg" variant="outline">
              <Link to="/account" search={{ tab: "orders" }}>
                להזמנות שלי
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
