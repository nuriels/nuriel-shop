import { createFileRoute } from "@tanstack/react-router";
import { GrowPaymentPage } from "@/components/checkout/GrowPaymentPage";

/**
 * חלק 43: עמוד התשלום המקוון (Grow): /checkout/grow/<order_id>.
 * ההזמנה כבר שמורה במסד ("ממתינה לתשלום"). ?start=1 — פותח מיד את דף התשלום
 * של Grow; ?cancelled=1 — הלקוח חזר מבלי לשלם. המזהה בכתובת מחזיר את ההזמנה
 * גם אם הדפדפן נסגר. "שולם" נקבע רק ע"י ההתראה של Grow לשרת, לא ע"י העמוד.
 */
type Search = { start?: 1 | undefined; cancelled?: 1 | undefined };

export const Route = createFileRoute("/checkout_/grow/$orderId")({
  ssr: false,
  head: () => ({ meta: [{ title: "תשלום מקוון" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (search: Record<string, unknown>): Search => {
    const result: Search = {};
    if (search["start"] === 1 || search["start"] === "1") result.start = 1;
    if (search["cancelled"] === 1 || search["cancelled"] === "1") result.cancelled = 1;
    return result;
  },
  component: GrowPaymentRoute,
});

function GrowPaymentRoute() {
  const { orderId } = Route.useParams();
  const { start, cancelled } = Route.useSearch();
  return <GrowPaymentPage orderId={orderId} autoStart={start === 1} cancelled={cancelled === 1} />;
}
