// תצוגה מקדימה משוערת של תוצאת חיפוש בגוגל (מחשב / נייד) — מאותם נתונים שהאתר מציג לגוגל (seoSummary):
// שם העסק, אייקון, כתובת, כותרת ותיאור, ותמונת השיתוף. גוגל מחליט בעצמו מה להציג — זו הערכה, לא הבטחה.
import { useState } from "react";
import { Button } from "@/platform/ui";
import type { SeoSummary } from "../site/page-head";

/** חיתוך כמו בגוגל (בערך): כותרת ~60 תווים, תיאור ~155 במחשב / ~120 בנייד */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

/** הכתובת כמו שגוגל מציג אותה: דומיין › נתיב */
export function breadcrumb(url: string | null): { host: string; path: string } {
  if (!url) return { host: "הכתובת תיקבע בפרסום", path: "" };
  try {
    const u = new URL(url);
    const parts = decodeURI(u.pathname).split("/").filter(Boolean);
    return { host: u.host, path: parts.length ? ` › ${parts.join(" › ")}` : "" };
  } catch {
    return { host: url, path: "" };
  }
}

export function GooglePreview({ seo }: { seo: SeoSummary }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const crumb = breadcrumb(seo.canonical);
  const mobile = device === "mobile";
  return (
    <div className="space-y-3">
      <div role="group" aria-label="גודל התצוגה" className="flex gap-1">
        {(["desktop", "mobile"] as const).map((d) => (
          <Button
            key={d}
            type="button"
            size="sm"
            variant={device === d ? "default" : "outline"}
            aria-pressed={device === d}
            onClick={() => setDevice(d)}
          >
            {d === "desktop" ? "מחשב" : "נייד"}
          </Button>
        ))}
      </div>
      <figure
        data-testid={`google-preview-${device}`}
        className="rounded-lg border bg-white p-4 text-start shadow-sm"
        style={{ maxWidth: mobile ? 380 : 640, fontFamily: "Arial, sans-serif" }}
        dir="rtl"
        lang="he"
      >
        <figcaption className="sr-only">
          תצוגה משוערת של תוצאת החיפוש בגוגל ({mobile ? "נייד" : "מחשב"})
        </figcaption>
        <div className="flex items-center gap-3">
          <span
            className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-[#f1f3f4]"
            aria-hidden="true"
          >
            {seo.icon ? (
              <img src={seo.icon} alt="" className="size-full object-cover" />
            ) : (
              <span className="text-xs text-[#5f6368]">{seo.siteName.slice(0, 1)}</span>
            )}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm text-[#202124]">{seo.siteName}</span>
            <span
              className="block truncate text-xs text-[#4d5156]"
              dir="ltr"
              style={{ textAlign: "right" }}
            >
              {crumb.host}
              {crumb.path}
            </span>
          </span>
        </div>
        <div className={mobile ? "mt-2 flex gap-3" : "mt-1"}>
          <div className="min-w-0 flex-1">
            <p
              className="text-[#1a0dab]"
              style={{ fontSize: mobile ? 18 : 20, lineHeight: 1.3, margin: 0 }}
            >
              {clip(seo.title, mobile ? 70 : 60)}
            </p>
            <p className="mt-1 text-sm text-[#4d5156]" style={{ lineHeight: 1.58, margin: 0 }}>
              {clip(seo.description, mobile ? 120 : 155)}
            </p>
          </div>
          {mobile && seo.image && (
            <img
              src={seo.image.url}
              alt=""
              className="size-[92px] shrink-0 rounded-lg object-cover"
              aria-hidden="true"
            />
          )}
        </div>
      </figure>
      <p className="text-xs text-muted-foreground">
        הערכה בלבד: גוגל בוחר בעצמו מה להציג ומתי, ולא ניתן להבטיח דירוג או הופעה מיידית. לפני
        הפרסום האתר חסום לגוגל (noindex) — הוא לא יופיע בחיפוש עד שיפורסם.
      </p>
    </div>
  );
}
