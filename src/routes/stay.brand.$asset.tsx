// מתאם נתיב (Hospitality, A1): /stay/brand/<asset> — אייקוני מסך הבית, תמונת השיתוף והמניפסט מהלוגו
// של העסק. כל הקוד ב-src/engines/hospitality/website/brand-route.ts.
import { createFileRoute } from "@tanstack/react-router";
import { brandAssetResponse } from "@/engines/hospitality/website/brand-route";

export const Route = createFileRoute("/stay/brand/$asset")({
  server: {
    handlers: {
      GET: ({ params }) => brandAssetResponse(params.asset),
    },
  },
});
