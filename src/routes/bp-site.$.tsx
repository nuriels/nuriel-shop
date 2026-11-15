// מתאם נתיב (Nuriel Websites): עמוד באתר עסק ("/<עמוד>"); עמוד שלא קיים בגרסה המפורסמת — "לא נמצא"
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import {
  BusinessPage,
  businessPageHead,
  requirePage,
} from "@/engines/business-profile/site/BusinessPage";

const layout = getRouteApi("/bp-site");

export const Route = createFileRoute("/bp-site/$")({
  loader: async ({ parentMatchPromise, params }) =>
    requirePage((await parentMatchPromise).loaderData, params._splat ?? ""),
  head: ({ matches, params }) => businessPageHead(matches, params._splat ?? ""),
  component: function SitePage() {
    const site = layout.useLoaderData();
    const { _splat } = Route.useParams();
    return <BusinessPage site={site} slug={_splat ?? ""} />;
  },
});
