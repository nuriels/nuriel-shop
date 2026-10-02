import { createFileRoute } from "@tanstack/react-router";
import { BlockedPageView } from "@/components/BlockedPageView";
import { FORBIDDEN_PAGE } from "@/lib/blocked-pages";

// ניסיון לגשת לפאנל הפלטפורמה מדומיין של חנות
export const Route = createFileRoute("/forbidden")({
  head: () => ({ meta: [{ title: FORBIDDEN_PAGE.title }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <BlockedPageView page={FORBIDDEN_PAGE} action={{ to: "/", label: "לדף הבית" }} />
  ),
});
