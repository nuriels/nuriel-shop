import { createFileRoute, redirect } from "@tanstack/react-router";
import { BlockedPageView } from "@/components/BlockedPageView";
import { EXPIRED_PAGE, SUSPENDED_PAGE } from "@/lib/blocked-pages";

// חנות נעולה — מוקפאת ע"י מנהל הפלטפורמה, או שהמנוי שלה הסתיים (חלק 13).
// הלקוחות מגיעים לכאן מכל עמוד אחר; בעל החנות נכנס לפאנל כדי להסדיר.
export const Route = createFileRoute("/locked")({
  beforeLoad: ({ context }) => {
    if (!context.hostMode.suspended) throw redirect({ to: "/" });
  },
  head: ({ match }) => {
    const page = match.context.hostMode.lock === "expired" ? EXPIRED_PAGE : SUSPENDED_PAGE;
    return { meta: [{ title: page.title }, { name: "robots", content: "noindex" }] };
  },
  component: LockedPage,
});

function LockedPage() {
  const { hostMode } = Route.useRouteContext();
  const expired = hostMode.lock === "expired";
  return (
    <BlockedPageView
      page={expired ? EXPIRED_PAGE : SUSPENDED_PAGE}
      action={
        expired
          ? { to: "/admin", label: "כניסה לפאנל הניהול", search: { tab: "billing" } }
          : { to: "/admin", label: "כניסה לפאנל הניהול" }
      }
    />
  );
}
