// מתאם נתיב (Hospitality): האתר הציבורי — חתימה על הסכם (קישור אישי מהמייל)
import { createFileRoute } from "@tanstack/react-router";
import { siteContractRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/contract")(siteContractRoute);
