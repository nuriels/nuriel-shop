// עורך האתר — "גוגל ושיתוף" (E5): כותרת ותיאור לגוגל, תמונת שיתוף (וואטסאפ / פייסבוק / X),
// הכתובת הקנונית, ואימות Google Search Console — עם תצוגה מקדימה של התוצאה בגוגל ושל כרטיס השיתוף.
// הכול חלק מטיוטת האתר: נשמר אוטומטית ונכנס לאתר רק בפרסום. השרת מנקה כל ערך (normalizeDesign)
// ובונה את התגיות בעצמו — קוד שהודבק נשמר רק כקוד אימות תקין, לעולם לא כ-HTML.
import { CircleCheck, ExternalLink, Search } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/platform/ui";
import type { PublicSite } from "../../types/website";
import { siteCopy } from "../../website/copy";
import { SEO_LIMITS, type SiteDesign, type SiteSeo } from "../../website/design/schema";
import { heroImage, mediaById } from "../../website/lib/media";
import {
  canonicalOrigin,
  extractGoogleToken,
  seoDefaults,
  type SiteAddresses,
} from "../../website/seo";
import { ImagePicker } from "./SectionFields";

const RECOMMENDED = { title: 60, description: 155 } as const;

export function SeoPanel({
  design,
  site,
  addresses,
  onChange,
}: {
  design: SiteDesign;
  site: PublicSite;
  addresses: SiteAddresses;
  onChange: (d: SiteDesign) => void;
}) {
  const seo: SiteSeo = design.seo ?? {};
  const set = (patch: Partial<Record<keyof SiteSeo, string | undefined>>) => {
    const next: Record<string, string> = { ...(seo as Record<string, string>) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") delete next[k];
      else next[k] = v;
    }
    const out: SiteDesign = { ...design };
    if (Object.keys(next).length) out.seo = next as SiteSeo;
    else delete out.seo;
    onChange(out);
  };
  const p = site.properties[0];
  const kind = (p?.property_type ? siteCopy("he").propertyTypes[p.property_type] : "") ?? "";
  const defaults = seoDefaults(site, kind);
  const origin = canonicalOrigin(addresses, seo);
  const title = seo.title || defaults.title;
  const description = seo.description || defaults.description;
  const image = mediaById(site, seo.image)?.url ?? heroImage(site, design.logo)?.url ?? null;

  return (
    <div className="flex flex-col gap-6 pt-1">
      <p className="text-xs text-muted-foreground">
        איך האתר נראה בגוגל ובשיתוף בוואטסאפ / פייסבוק. נשמר בטיוטה ונכנס לאתר בפרסום.
      </p>

      <section aria-labelledby="seo-google-title" className="flex flex-col gap-3">
        <h3 id="seo-google-title" className="text-sm font-bold">
          תוצאת החיפוש בגוגל
        </h3>
        <GooglePreview
          title={title}
          description={description}
          origin={origin}
          name={site.business.name}
        />
        <CountedField
          label="כותרת (Meta Title)"
          value={seo.title ?? ""}
          placeholder={defaults.title}
          max={SEO_LIMITS.title}
          recommended={RECOMMENDED.title}
          hint="ריק — שם העסק וסוג המקום. מומלץ: שם העסק + מה מיוחד + איפה."
          onChange={(v) => set({ title: v })}
        />
        <CountedField
          textarea
          label="תיאור (Meta Description)"
          value={seo.description ?? ""}
          placeholder={defaults.description}
          max={SEO_LIMITS.description}
          recommended={RECOMMENDED.description}
          hint="משפט או שניים שמזמינים להיכנס: מה מקבלים, למי זה מתאים, איפה."
          onChange={(v) => set({ description: v })}
        />
      </section>

      <section aria-labelledby="seo-share-title" className="flex flex-col gap-3">
        <h3 id="seo-share-title" className="text-sm font-bold">
          שיתוף בוואטסאפ, פייסבוק ו-X
        </h3>
        <SharePreview image={image} title={title} description={description} origin={origin} />
        <ImagePicker
          site={site}
          value={seo.image}
          label="תמונת שיתוף (לא חובה — אחרת תמונת הפתיח)"
          onChange={(id: string | undefined) => set({ image: id })}
        />
      </section>

      <CanonicalField addresses={addresses} seo={seo} onChange={(v) => set({ canonical: v })} />

      <GoogleVerification value={seo.google} onChange={(v) => set({ google: v })} />
    </div>
  );
}

function CountedField(props: {
  label: string;
  value: string;
  placeholder: string;
  max: number;
  recommended: number;
  hint: string;
  textarea?: boolean;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const n = props.value.length;
  const long = n > props.recommended;
  const Input = props.textarea ? "textarea" : "input";
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <Input
        id={id}
        value={props.value}
        maxLength={props.max}
        placeholder={props.placeholder}
        onChange={(e) =>
          props.onChange(e.target.value.replace(/[\r\n]+/g, " ").replace(/[<>]/g, ""))
        }
        aria-describedby={`${id}-hint ${id}-count`}
        {...(props.textarea ? { rows: 3 } : { type: "text" })}
        className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
      />
      <div className="flex justify-between gap-2 text-xs">
        <span id={`${id}-hint`} className="text-muted-foreground">
          {props.hint}
        </span>
        <span
          id={`${id}-count`}
          dir="ltr"
          className={cn(
            "shrink-0",
            long ? "font-semibold text-[var(--hm-warning)]" : "text-muted-foreground",
          )}
          aria-live="polite"
        >
          {n}/{props.recommended}
          <span className="sr-only">{long ? " — ארוך מהמומלץ, גוגל עלול לקצר" : " תווים"}</span>
        </span>
      </div>
    </div>
  );
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const hostOf = (origin: string | null) => (origin ? origin.replace(/^https?:\/\//, "") : "");

function GooglePreview(props: {
  title: string;
  description: string;
  origin: string | null;
  name: string;
}) {
  return (
    <figure
      aria-label="תצוגה מקדימה של התוצאה בגוגל"
      className="rounded-xl border bg-white p-4 text-start shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--hm-lagoon-100)] text-[var(--hm-lagoon-700)]"
        >
          <Search className="size-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-[#202124]">{props.name}</span>
          <span className="block truncate text-xs text-[#4d5156]" dir="ltr">
            {props.origin ? `${hostOf(props.origin)} › stay` : "הכתובת תופיע כאן"}
          </span>
        </span>
      </div>
      <p className="mt-2 text-lg leading-snug text-[#1a0dab]">{cut(props.title, 60)}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[#4d5156]">
        {cut(props.description, 155)}
      </p>
    </figure>
  );
}

function SharePreview(props: {
  image: string | null;
  title: string;
  description: string;
  origin: string | null;
}) {
  return (
    <figure
      aria-label="תצוגה מקדימה של כרטיס השיתוף"
      className="overflow-hidden rounded-xl border bg-white shadow-sm"
    >
      <div className="aspect-[1.91/1] bg-[var(--hm-surface-2)]">
        {props.image ? (
          <img src={props.image} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            בלי תמונה — מומלץ להוסיף תמונת פתיח או תמונת שיתוף
          </div>
        )}
      </div>
      <div className="border-t bg-[#f0f2f5] px-3 py-2 text-start">
        <p className="truncate text-[11px] text-[#65676b] uppercase" dir="ltr">
          {hostOf(props.origin)}
        </p>
        <p className="truncate text-sm font-semibold text-[#050505]">{props.title}</p>
        <p className="truncate text-xs text-[#65676b]">{props.description}</p>
      </div>
    </figure>
  );
}

function CanonicalField({
  addresses,
  seo,
  onChange,
}: {
  addresses: SiteAddresses;
  seo: SiteSeo;
  onChange: (v: "subdomain" | undefined) => void;
}) {
  const both =
    addresses.primary && addresses.subdomain && addresses.primary !== addresses.subdomain;
  const current = canonicalOrigin(addresses, seo);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-bold">הכתובת הראשית (Canonical)</legend>
      <p className="text-xs text-muted-foreground">
        הכתובת שגוגל יציג ושאליה יפנו הקישורים. כל עמוד באתר מצהיר עליה, כך שאין תוכן כפול.
      </p>
      {both ? (
        <div className="flex flex-col gap-2">
          {(
            [
              [undefined, addresses.primary, "הדומיין של העסק (מומלץ)"],
              ["subdomain", addresses.subdomain, "הכתובת בפלטפורמה"],
            ] as const
          ).map(([value, url, label]) => (
            <label
              key={label}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                seo.canonical === value && "border-primary bg-primary/5",
              )}
            >
              <input
                type="radio"
                name="seo-canonical"
                className="mt-1 size-4 accent-primary"
                checked={seo.canonical === value}
                onChange={() => onChange(value)}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{label}</span>
                <span className="truncate text-xs text-muted-foreground" dir="ltr">
                  {url}
                </span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="rounded-md border bg-[var(--hm-surface-2)] px-3 py-2 text-sm" dir="ltr">
          {current ?? "—"}
        </p>
      )}
    </fieldset>
  );
}

function GoogleVerification({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? value ?? "";
  const token = extractGoogleToken(shown);
  const invalid = shown.trim() !== "" && !token;
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
      <h3 id={`${id}-title`} className="text-sm font-bold">
        Google Search Console
      </h3>
      <ol className="list-decimal space-y-1 ps-5 text-xs text-muted-foreground">
        <li>
          ב-
          <a
            href="https://search.google.com/search-console"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-[var(--hm-lagoon-500)] underline underline-offset-2"
          >
            Search Console
            <ExternalLink className="size-3" aria-hidden="true" />
            <span className="sr-only">(נפתח בחלון חדש)</span>
          </a>{" "}
          מוסיפים נכס מסוג &quot;קידומת של כתובת URL&quot; עם הכתובת הראשית.
        </li>
        <li>בוחרים אימות ב&quot;תג HTML&quot; ומעתיקים את התגית (או רק את הקוד).</li>
        <li>מדביקים כאן, מפרסמים את האתר, ולוחצים &quot;אימות&quot; בגוגל.</li>
      </ol>
      <label htmlFor={id} className="mt-1 text-sm font-medium">
        קוד האימות
      </label>
      <input
        id={id}
        dir="ltr"
        value={shown}
        maxLength={300}
        spellCheck={false}
        autoComplete="off"
        placeholder='<meta name="google-site-verification" content="…" />'
        onChange={(e) => {
          setText(e.target.value);
          const t = extractGoogleToken(e.target.value);
          if (t || e.target.value.trim() === "") onChange(t ?? undefined);
        }}
        onBlur={() => {
          if (token) setText(null);
        }}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={`${id}-state`}
        className={cn(
          "min-h-11 w-full rounded-md border border-input bg-background px-3 text-start font-mono text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
          invalid && "border-destructive",
        )}
      />
      <p
        id={`${id}-state`}
        className={cn(
          "flex items-center gap-1.5 text-xs",
          invalid ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {invalid ? (
          "הקוד לא תקין — מדביקים את התגית מגוגל כמו שהיא, או רק את מה שבין המירכאות של content"
        ) : token ? (
          <>
            <CircleCheck className="size-3.5 text-[var(--hm-success)]" aria-hidden="true" />
            נשמר הקוד בלבד; התגית נוספת לדף הבית של האתר אחרי הפרסום
          </>
        ) : (
          "לא חובה. בלי קוד — אין תגית אימות באתר"
        )}
      </p>
    </section>
  );
}
