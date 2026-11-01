// מתאם נתיב (Hospitality): ערוצי הזמנה (סנכרון iCal)
import { createFileRoute } from "@tanstack/react-router";
import { ChannelsPage } from "@/engines/hospitality/management/channels/ChannelsPage";

export const Route = createFileRoute("/manage/channels")({
  head: () => ({ meta: [{ title: "ערוצי הזמנה" }] }),
  component: ChannelsPage,
});
