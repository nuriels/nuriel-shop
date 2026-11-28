import { createFileRoute } from "@tanstack/react-router";
import { OnlinePaymentPage } from "@/components/checkout/OnlinePaymentPage";

/**
 * MAX/Hyp DEMO — the store's online card payment page: /checkout/pay/<order id>.
 * The order already awaits payment. ?start=1 opens Hyp's page at once (the flag is dropped from the address first,
 * so "back" never opens a second page); ?r=1 = back from Hyp (the server already verified the return): the page
 * polls the status. "Paid" comes only from the server's VERIFY, never from this page.
 */
type Search = { start?: 1 | undefined; r?: 1 | undefined };

export const Route = createFileRoute("/checkout_/pay/$orderId")({
  ssr: false,
  head: () => ({ meta: [{ title: "תשלום מקוון" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (search: Record<string, unknown>): Search => {
    const result: Search = {};
    if (search["start"] === 1 || search["start"] === "1") result.start = 1;
    if (search["r"] === 1 || search["r"] === "1") result.r = 1;
    return result;
  },
  component: OnlinePaymentRoute,
});

function OnlinePaymentRoute() {
  const { orderId } = Route.useParams();
  const { start, r } = Route.useSearch();
  return <OnlinePaymentPage orderId={orderId} autoStart={start === 1} returned={r === 1} />;
}
