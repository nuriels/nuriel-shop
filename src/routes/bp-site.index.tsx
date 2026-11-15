// מתאם נתיב (Nuriel Websites): דף הבית של אתר עסק ("/")
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { BusinessPage, businessPageHead } from "@/engines/business-profile/site/BusinessPage";

const layout = getRouteApi("/bp-site");

export const Route = createFileRoute("/bp-site/")({
  head: ({ matches }) => businessPageHead(matches, ""),
  component: function HomePage() {
    return <BusinessPage site={layout.useLoaderData()} slug="" />;
  },
});
