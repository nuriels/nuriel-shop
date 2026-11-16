// מתאם נתיב (Nuriel Websites): "פניות מלקוחות" — ?id=<פנייה> פותח פנייה (גם מהקישור במייל ההתראה)
import { createFileRoute } from "@tanstack/react-router";
import { StudioInbox } from "@/engines/business-profile/studio/StudioInbox";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/studio/inbox")({
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search["id"] === "string" && UUID.test(search["id"]) ? { id: search["id"] } : {},
  component: StudioInbox,
});
