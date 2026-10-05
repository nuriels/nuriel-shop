import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת חלופית לעמוד ביטול העסקה (/cancel-order → /cancellations), כולל
// מספר ההזמנה אם צורף (?order=)
export const Route = createFileRoute("/cancel-order")({
  beforeLoad: ({ search }) => {
    const order = (search as Record<string, unknown>)["order"];
    throw redirect({
      to: "/cancellations",
      search: typeof order === "string" && order !== "" ? { order } : {},
      replace: true,
    });
  },
});
