// מתאם נתיב (Hospitality): מסמכים ומדיניות האתר — תקנון, תנאי הזמנה, ביטולים, פרטיות, תשלומים,
// אירועים, כללי המקום והצהרת הנגישות (מיגרציה 60)
import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "@/engines/hospitality/management/documents/DocumentsPage";

export const Route = createFileRoute("/manage/documents")({
  head: () => ({ meta: [{ title: "מסמכים ומדיניות האתר" }] }),
  component: DocumentsPage,
});
