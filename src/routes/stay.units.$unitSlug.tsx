// מתאם נתיב (Hospitality): עמוד יחידה באתר הציבורי
import { createFileRoute } from "@tanstack/react-router";
import { siteUnitRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/units/$unitSlug")(siteUnitRoute);
