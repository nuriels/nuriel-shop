import { createFileRoute, redirect } from "@tanstack/react-router";

// "ההזמנות שלי" עבר לאזור האישי (/account). הכתובת הישנה (קישורים במיילים,
// סימניות) ממשיכה לעבוד ומפנה ללשונית ההזמנות.
export const Route = createFileRoute("/orders")({
  beforeLoad: () => {
    throw redirect({ to: "/account", search: { tab: "orders" } });
  },
});
