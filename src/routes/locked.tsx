import { createFileRoute, redirect } from "@tanstack/react-router";
import { BlockedPageView } from "@/components/BlockedPageView";
import { SUSPENDED_PAGE } from "@/lib/blocked-pages";

// חנות מוקפאת ע"י מנהל הפלטפורמה — הלקוחות מגיעים לכאן מכל עמוד אחר
export const Route = createFileRoute("/locked")({
  beforeLoad: ({ context }) => {
    if (!context.hostMode.suspended) throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: SUSPENDED_PAGE.title }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <BlockedPageView page={SUSPENDED_PAGE} action={{ to: "/admin", label: "כניסה לפאנל הניהול" }} />
  ),
});
