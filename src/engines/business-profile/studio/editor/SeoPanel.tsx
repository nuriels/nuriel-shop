// "SEO וגוגל" בעורך (מיגרציה 197): לכל עמוד — הכותרת והתיאור לגוגל ותמונת השיתוף, עם תצוגה משוערת של
// תוצאת החיפוש (מחשב / נייד). ריק — ברירת המחדל (שם העסק, המשפט המוביל, תמונת הפתיח / הלוגו).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { studioAddress } from "../../api/address.functions";
import { tx } from "../../document/normalize";
import { seoSummary } from "../../site/page-head";
import { GooglePreview } from "../GooglePreview";
import { useStudio } from "../StudioLayout";
import { Section, TextField } from "./fields";
import { ImageField, previewMediaMap, useMediaLibrary } from "./media";
import type { PanelProps } from "./panels";

export function SeoPanel({ doc, setDoc }: PanelProps) {
  const { context } = useStudio();
  const [pageId, setPageId] = useState(doc.pages[0]?.id ?? "");
  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0];
  const lib = useMediaLibrary();
  const loadAddress = useServerFn(studioAddress);
  // הכתובת הקנונית — רק לבעל העסק (הגדרות האתר); למנהל תוכן התצוגה בלי הכתובת
  const address = useQuery({
    queryKey: ["bp", "address"],
    queryFn: () => loadAddress(),
    enabled: context.permissions.includes("settings.owner"),
  });
  if (!page) return null;
  const setSeo = (patch: Partial<typeof page.seo>) =>
    setDoc((d) => ({
      ...d,
      pages: d.pages.map((p) => (p.id === page.id ? { ...p, seo: { ...p.seo, ...patch } } : p)),
    }));
  const seo = seoSummary(
    doc,
    page,
    previewMediaMap(lib.data),
    address.data?.publicOrigin ?? null,
    tx(doc.business.name),
  );
  return (
    <Section
      title="SEO וגוגל"
      description="מה גוגל ורשתות חברתיות מקבלים מכל עמוד. ריק = ברירת המחדל (שם העסק והמשפט המוביל). השינויים נכנסים לאתר אחרי שמירה ופרסום."
    >
      {doc.pages.length > 1 && (
        <div className="space-y-1.5">
          <label htmlFor="seo-page" className="text-sm font-medium">
            העמוד
          </label>
          <select
            id="seo-page"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={page.id}
            onChange={(e) => setPageId(e.target.value)}
          >
            {doc.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {tx(p.title) || (p.slug ? `/${p.slug}` : "דף הבית")}
              </option>
            ))}
          </select>
        </div>
      )}
      <TextField
        label="כותרת לגוגל (Title)"
        value={page.seo.title}
        max={70}
        hint="עד כ-60 תווים מוצגים בתוצאות. מומלץ: שם העסק ומה הוא עושה."
        onChange={(title) => setSeo({ title })}
      />
      <TextField
        label="תיאור לגוגל (Meta description)"
        value={page.seo.description}
        max={170}
        multiline
        hint="עד כ-155 תווים מוצגים במחשב ופחות בנייד."
        onChange={(description) => setSeo({ description })}
      />
      <ImageField
        label="תמונת שיתוף (וואטסאפ, פייסבוק, תוצאות עשירות)"
        value={page.seo.image}
        onChange={(image) => setSeo({ image })}
      />
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">תצוגה משוערת בגוגל</p>
        <GooglePreview seo={seo} />
      </div>
    </Section>
  );
}
