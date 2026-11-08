// מתאם נתיב (Hospitality): מסמך מהאתר — תקנון, תנאי הזמנה, ביטולים, תשלומים, אירועים, כללי המקום
// (מיגרציה 60; פרטיות ונגישות — בכתובות הקיימות /stay/privacy, /stay/accessibility)
import { createFileRoute } from "@tanstack/react-router";
import { siteDocumentRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/docs/$docSlug")(siteDocumentRoute);
