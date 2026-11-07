// מתאם נתיב (Hospitality): עמוד חבילה באתר הציבורי (שלב א' 7)
import { createFileRoute } from "@tanstack/react-router";
import { sitePackageRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/packages/$packageSlug")(sitePackageRoute);
