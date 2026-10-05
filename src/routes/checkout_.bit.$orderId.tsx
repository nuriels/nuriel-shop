import { createFileRoute } from "@tanstack/react-router";
import { BitPaymentPage } from "@/components/checkout/BitPaymentPage";

/**
 * עמוד התשלום בביט (חלק 17ב): /checkout/bit/<order_id>.
 * ההזמנה כבר שמורה במסד ("ממתינה לתשלום") לפני שהלקוח הגיע לכאן, והמזהה
 * בכתובת מחזיר אותה גם אם הדפדפן נסגר / התרענן במעבר לאפליקציית ביט.
 */
export const Route = createFileRoute("/checkout_/bit/$orderId")({
  ssr: false,
  head: () => ({ meta: [{ title: "תשלום בביט" }, { name: "robots", content: "noindex" }] }),
  component: BitPaymentRoute,
});

function BitPaymentRoute() {
  const { orderId } = Route.useParams();
  return <BitPaymentPage orderId={orderId} />;
}
