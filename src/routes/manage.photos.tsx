// מתאם נתיב (Hospitality): תמונות וגלריות
import { createFileRoute } from "@tanstack/react-router";
import { PhotosPage } from "@/engines/hospitality/management/media/PhotosPage";

export const Route = createFileRoute("/manage/photos")({
  head: () => ({ meta: [{ title: "תמונות" }] }),
  component: PhotosPage,
});
