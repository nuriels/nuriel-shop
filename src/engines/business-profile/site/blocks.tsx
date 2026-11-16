// רכיבי התצוגה של המקטעים — משותפים לכל התבניות; כל תבנית משנה את העיצוב דרך המחלקה שלה (site.css).
// הכול טקסט (React מציג אותו כטקסט, בלי HTML חופשי). כותרת H1 אחת — בפתיח; כל מקטע — H2.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { BlockProps } from "../document/blocks";
import type { Block, PortfolioItem } from "../document/schema";
import { telHref, useSiteView, useT, whatsappHref } from "./context";
import { InquiryForm } from "./InquiryForm";
import { justifyRows } from "./layout";
import { cssImage, hasImage, LinkButton, SectionHead, SiteImage, WhatsappIcon } from "./parts";

type Props<T extends keyof BlockMap> = { block: Block<BlockMap[T]>; index: number };
interface BlockMap {
  hero: BlockProps<"hero">;
  about: BlockProps<"about">;
  services: BlockProps<"services">;
  portfolio: BlockProps<"portfolio">;
  testimonials: BlockProps<"testimonials">;
  cta: BlockProps<"cta">;
  contact: BlockProps<"contact">;
  text: BlockProps<"text">;
  form: BlockProps<"form">;
  media: BlockProps<"media">;
}

// ---------- Hero ----------
/** גל בתחתית הפתיח (מוצג רק בתבניות שמפעילות אותו ב-CSS) — צורה שלנו */
function HeroWave() {
  return (
    <svg
      className="bps-hero-wave"
      viewBox="0 0 1000 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0 62 C 120 96, 260 98, 380 70 C 470 48, 520 22, 610 34 C 720 50, 800 92, 1000 58 L1000 100 L0 100 Z" />
    </svg>
  );
}

export function HeroBlock({
  block,
  layout,
}: Props<"hero"> & { layout: "split" | "centered" | "cover" }) {
  const { media, doc } = useSiteView();
  const t = useT();
  const p = block.props;
  const withImage = hasImage(p.image, media);
  const mode = p.layout ?? layout;
  const title = t(p.title) || t(doc.business.name);
  const lead = t(p.titleLead);
  const style =
    p.overlay !== null ? ({ "--bp-overlay": String(p.overlay / 100) } as CSSProperties) : undefined;
  return (
    <section
      id={block.id}
      className={`bps-hero bps-hero-${withImage ? mode : "centered"}`}
      aria-labelledby={`${block.id}-title`}
      style={style}
    >
      <div className="bps-hero-inner">
        <div className="bps-hero-text">
          {p.showLogo && hasImage(doc.business.logo, media) && (
            <SiteImage image={doc.business.logo} className="bps-hero-logo" eager />
          )}
          {t(p.eyebrow) && <p className="bps-eyebrow">{t(p.eyebrow)}</p>}
          <h1 id={`${block.id}-title`} className="bps-h1">
            {/* שורת פתיחה קטנה (אם יש) והכותרת — באותו H1; בלי שורת פתיחה: הכותרת לבדה, בלי עטיפה */}
            {lead ? (
              <>
                <span className="bps-h1-lead">{lead}</span>{" "}
                <span className="bps-h1-main">{title}</span>
              </>
            ) : (
              title
            )}
          </h1>
          {t(p.subtitle) && <p className="bps-hero-sub">{t(p.subtitle)}</p>}
          {t(p.tagline) && <p className="bps-hero-tagline">{t(p.tagline)}</p>}
          <div className="bps-actions">
            <LinkButton
              href={p.primary.href}
              label={p.primary.label}
              icon={p.primaryIcon}
              variant="primary"
            />
            <LinkButton href={p.secondary.href} label={p.secondary.label} variant="ghost" />
          </div>
        </div>
        {withImage && (
          <div className="bps-hero-media">
            <SiteImage image={p.image} eager sizes="(min-width: 960px) 45vw, 100vw" />
          </div>
        )}
      </div>
      {withImage && mode === "cover" && <HeroWave />}
    </section>
  );
}

// ---------- About ----------
/** קרוסלת תמונות: אחת בכל פעם, החלפה אוטומטית (לא למי שביקש בלי תנועה), חצים, עצירה בריחוף ובמיקוד */
function Carousel({ slides, label }: { slides: BlockProps<"about">["slides"]; label: string }) {
  const { media } = useSiteView();
  const t = useT();
  const usable = slides.filter((sl) => hasImage(sl.image, media));
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = usable.length;
  useEffect(() => {
    if (count < 2 || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), 5000);
    return () => window.clearInterval(timer);
  }, [count, paused]);
  if (!count) return null;
  const current = usable[index % count]!;
  return (
    <div
      className="bps-carousel"
      role="region"
      aria-roledescription="קרוסלה"
      aria-label={label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="bps-carousel-stage">
        {usable.map((sl, i) => (
          <figure
            key={i}
            className={`bps-carousel-slide${i === index % count ? " is-active" : ""}`}
            aria-roledescription="שקופית"
            aria-label={`${i + 1} מתוך ${count}`}
            aria-hidden={i !== index % count}
          >
            <SiteImage image={sl.image} eager={i === 0} sizes="(min-width: 960px) 40vw, 100vw" />
          </figure>
        ))}
        {count > 1 && (
          <>
            <button
              type="button"
              className="bps-carousel-nav bps-carousel-prev"
              aria-label="התמונה הקודמת"
              onClick={() => setIndex((i) => (i - 1 + count) % count)}
            >
              <span aria-hidden="true">›</span>
            </button>
            <button
              type="button"
              className="bps-carousel-nav bps-carousel-next"
              aria-label="התמונה הבאה"
              onClick={() => setIndex((i) => (i + 1) % count)}
            >
              <span aria-hidden="true">‹</span>
            </button>
          </>
        )}
      </div>
      {t(current.button.label) && (
        <div className="bps-carousel-action">
          <LinkButton href={current.button.href} label={current.button.label} variant="primary" />
        </div>
      )}
    </div>
  );
}

export function AboutBlock({ block, index }: Props<"about">) {
  const { media } = useSiteView();
  const t = useT();
  const p = block.props;
  const withSlides = p.slides.some((sl) => hasImage(sl.image, media));
  const withImage = withSlides || hasImage(p.image, media);
  return (
    <section id={block.id} className="bps-section bps-about" aria-labelledby={`${block.id}-title`}>
      <div className={`bps-wrap bps-about-grid${withImage ? "" : " bps-about-solo"}`}>
        <div className="bps-about-text">
          <SectionHead
            id={block.id}
            eyebrow={p.eyebrow}
            title={p.title}
            index={index}
            titleImage={p.titleImage}
          />
          <div className="bps-prose">
            {p.paragraphs.map((para, i) => (
              <p key={i}>{t(para)}</p>
            ))}
          </div>
          {p.highlights.length > 0 && (
            <dl className="bps-stats">
              {p.highlights.map((h, i) => (
                <div key={i}>
                  <dt>{t(h.label)}</dt>
                  <dd>{t(h.value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {withSlides ? (
          <div className="bps-about-media">
            <Carousel slides={p.slides} label={t(p.title) ? `תמונות — ${t(p.title)}` : "תמונות"} />
          </div>
        ) : (
          withImage && (
            <figure className="bps-about-media">
              <SiteImage image={p.image} sizes="(min-width: 960px) 38vw, 100vw" />
            </figure>
          )
        )}
      </div>
    </section>
  );
}

// ---------- Services ----------
export function ServicesBlock({ block, index }: Props<"services">) {
  const { doc, media } = useSiteView();
  const t = useT();
  const items = doc.collections.services.filter((s) => !s.hidden && t(s.title));
  if (!items.length) return null;
  return (
    <section
      id={block.id}
      className="bps-section bps-services"
      aria-labelledby={`${block.id}-title`}
    >
      <div className="bps-wrap">
        <SectionHead
          id={block.id}
          eyebrow={block.props.eyebrow}
          title={block.props.title}
          accent={block.props.titleAccent}
          intro={block.props.intro}
          index={index}
        />
        <ol className="bps-service-list">
          {items.map((s, i) => (
            <li key={s.id} className="bps-service">
              {hasImage(s.iconImage, media) ? (
                <span
                  className="bps-service-icon"
                  style={s.iconBg ? { backgroundColor: s.iconBg } : undefined}
                >
                  <SiteImage image={{ media: s.iconImage.media, alt: { he: "" } }} />
                </span>
              ) : (
                <span className="bps-service-num" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
              )}
              <div>
                <h3 className="bps-h3">{t(s.title)}</h3>
                {t(s.text) && <p>{t(s.text)}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---------- Portfolio ----------
/** בתצוגה המקדימה בלבד (באתר החי עבודה בלי תמונה לא מוצגת): מקום שמור לתמונה — השם כבר מופיע מתחת */
function CoverPlaceholder() {
  return (
    <span className="bps-cover-placeholder" aria-hidden="true">
      <span>ממתין לתמונה</span>
    </span>
  );
}

/** יחס גובה/רוחב של תמונה מהמדיה (לחלוקה לעמודות); לא ידוע — עטיפת ספר טיפוסית */
function ratioOf(
  item: PortfolioItem,
  media: Record<string, { width: number | null; height: number | null }>,
): number {
  const m = item.image.media ? media[item.image.media] : undefined;
  return m?.width && m?.height ? m.height / m.width : 1.5;
}

/** Masonry: כל עבודה נכנסת לעמודה הנמוכה ביותר (כמו בגלריות של בוני אתרים) — הסדר נשמר לאורך השורות */
function masonryColumns(
  items: PortfolioItem[],
  columns: number,
  media: Record<string, { width: number | null; height: number | null }>,
) {
  const cols: PortfolioItem[][] = Array.from({ length: columns }, () => []);
  const heights = new Array<number>(columns).fill(0);
  for (const item of items) {
    let k = 0;
    for (let c = 1; c < columns; c++) if (heights[c]! < heights[k]! - 0.001) k = c;
    cols[k]!.push(item);
    heights[k]! += ratioOf(item, media);
  }
  return cols;
}

/** הרוחב של אלמנט (מתעדכן בשינוי גודל); 0 עד שנמדד — ואז הפריסה נשענת על CSS בלבד */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const JUSTIFIED_ROW = 150;
const JUSTIFIED_GAP = 10;

export function PortfolioBlock({ block, index }: Props<"portfolio">) {
  const { doc, media, mode } = useSiteView();
  const t = useT();
  const p = block.props;
  const { categories, items: all } = doc.collections.portfolio;
  const items = all.filter((i) => !i.hidden && (hasImage(i.image, media) || mode === "preview"));
  const used = categories.filter((c) => items.some((i) => i.categories.includes(c.id)));
  const firstTab = p.showAll || !used.length ? "all" : used[0]!.id;
  const [active, setActive] = useState<string>(firstTab);
  const [open, setOpen] = useState<PortfolioItem | null>(null);
  const [justifiedRef, justifiedWidth] = useWidth<HTMLUListElement>();
  const dialog = useRef<HTMLDialogElement>(null);
  const current = !p.showAll && active === "all" && used.length ? used[0]!.id : active;
  const shown = useMemo(
    () => (current === "all" ? items : items.filter((i) => i.categories.includes(current))),
    [items, current],
  );
  if (!items.length) return null;
  const show = (item: PortfolioItem) => {
    setOpen(item);
    dialog.current?.showModal();
  };
  const device = (item: PortfolioItem) =>
    item.devices === "desktop"
      ? " bps-only-wide"
      : item.devices === "mobile"
        ? " bps-only-narrow"
        : "";
  const work = (item: PortfolioItem, extra = "", style?: CSSProperties) => (
    <li key={item.id} className={`bps-work${device(item)}${extra}`} style={style}>
      <button type="button" className="bps-work-btn" onClick={() => show(item)}>
        <span className="bps-work-media">
          <SiteImage
            image={item.image}
            sizes="(min-width: 960px) 22vw, 45vw"
            fallback={<CoverPlaceholder />}
          />
        </span>
        {p.showTitles && t(item.title) && <span className="bps-work-title">{t(item.title)}</span>}
        <span className="bps-sr">{t(item.title) ? `${t(item.title)} — ` : ""}פתיחה בגודל מלא</span>
      </button>
    </li>
  );
  return (
    <section
      id={block.id}
      className="bps-section bps-portfolio"
      aria-labelledby={`${block.id}-title`}
    >
      <div className="bps-wrap">
        <SectionHead
          id={block.id}
          eyebrow={p.eyebrow}
          title={p.title}
          accent={p.titleAccent}
          intro={p.intro}
          index={index}
        />
        {p.filter && used.length > 1 && (
          <div className="bps-filter" role="group" aria-label="סינון לפי קטגוריה">
            {p.showAll && (
              <button
                type="button"
                aria-pressed={current === "all"}
                onClick={() => setActive("all")}
              >
                הכול <span className="bps-count">{items.length}</span>
              </button>
            )}
            {used.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={current === c.id}
                onClick={() => setActive(c.id)}
              >
                {t(c.label)}{" "}
                <span className="bps-count">
                  {items.filter((i) => i.categories.includes(c.id)).length}
                </span>
              </button>
            ))}
          </div>
        )}
        {p.layout === "masonry" ? (
          <>
            {/* מסך רחב: 4 עמודות לפי גובה; מסך צר: שורות מוצדקות (כל עבודה לפי היחס שלה, גובה שורה אחיד) */}
            <div className="bps-masonry" aria-live="polite">
              {masonryColumns(
                shown.filter((i) => i.devices !== "mobile"),
                4,
                media,
              ).map((col, ci) => (
                <ul key={ci} className="bps-masonry-col">
                  {col.map((item) => work(item))}
                </ul>
              ))}
            </div>
            <ul className="bps-justified" aria-live="polite" ref={justifiedRef}>
              {(() => {
                const narrow = shown.filter((i) => i.devices !== "desktop");
                const ratios = narrow.map((item) => 1 / ratioOf(item, media));
                // נמדד: שורות מחושבות (כמו בגלריה המקורית); עדיין לא נמדד (בשרת): קירוב ב-CSS
                const boxes =
                  justifiedWidth > 0
                    ? justifyRows(ratios, justifiedWidth, JUSTIFIED_ROW, JUSTIFIED_GAP)
                    : null;
                return narrow.map((item, i) => {
                  const r = ratios[i]!;
                  const box = boxes?.[i];
                  return work(
                    item,
                    "",
                    box
                      ? ({
                          flex: "0 0 auto",
                          inlineSize: `${box.width}px`,
                          "--bp-ratio": r.toFixed(4),
                        } as CSSProperties)
                      : ({
                          // רוחב לפי היחס של כל עבודה: כל שורה מתמלאת בגובה אחיד, בלי לחתוך אף עטיפה
                          flexGrow: r,
                          flexBasis: `calc(var(--bp-row, ${JUSTIFIED_ROW}px) * ${r.toFixed(3)})`,
                          "--bp-ratio": r.toFixed(4),
                        } as CSSProperties),
                  );
                });
              })()}
              <li className="bps-justified-end" aria-hidden="true" />
            </ul>
          </>
        ) : (
          <ul className="bps-grid" aria-live="polite">
            {shown.map((item) => work(item))}
          </ul>
        )}
      </div>
      <dialog
        ref={dialog}
        className="bps-lightbox"
        aria-label={open ? t(open.title) || "תצוגה מוגדלת" : "תצוגה מוגדלת"}
        onClose={() => setOpen(null)}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        {open && (
          <div className="bps-lightbox-body">
            <SiteImage image={open.image} eager fallback={<CoverPlaceholder />} />
            {t(open.title) && <p className="bps-lightbox-title">{t(open.title)}</p>}
            {t(open.text) && <p>{t(open.text)}</p>}
            <button
              type="button"
              className="bps-btn bps-btn-ghost"
              onClick={() => dialog.current?.close()}
            >
              סגירה
            </button>
          </div>
        )}
      </dialog>
    </section>
  );
}

// ---------- Testimonials ----------
export function TestimonialsBlock({ block, index }: Props<"testimonials">) {
  const { doc, media, mode } = useSiteView();
  const t = useT();
  const p = block.props;
  const items = doc.collections.testimonials.filter(
    (x) => !x.hidden && (t(x.quote) || hasImage(x.image, media) || mode === "preview"),
  );
  if (!items.length) return null;
  const bg = p.background.media ? cssImage(media[p.background.media]?.url) : undefined;
  const card = (x: (typeof items)[number], key: string, hidden = false) => (
    <li key={key} aria-hidden={hidden || undefined}>
      <figure className="bps-quote">
        {t(x.quote) ? (
          <blockquote>
            <p>{t(x.quote)}</p>
          </blockquote>
        ) : (
          <SiteImage
            image={hidden ? { media: x.image.media, alt: { he: "" } } : x.image}
            fallback={<span className="bps-quote-pending">ההמלצה תופיע כאן אחרי שתתקבל כטקסט</span>}
          />
        )}
        {(t(x.author) || t(x.role)) && (
          <figcaption>
            {t(x.author) && <span className="bps-quote-author">{t(x.author)}</span>}
            {t(x.role) && <span className="bps-quote-role">{t(x.role)}</span>}
          </figcaption>
        )}
      </figure>
    </li>
  );
  return (
    <section
      id={block.id}
      className={`bps-section bps-testimonials${p.layout === "marquee" ? " bps-testimonials-marquee" : ""}`}
      aria-labelledby={`${block.id}-title`}
      style={bg ? ({ "--bp-section-image": bg } as CSSProperties) : undefined}
    >
      <div className="bps-wrap">
        <SectionHead
          id={block.id}
          eyebrow={p.eyebrow}
          title={p.title}
          accent={p.titleAccent}
          intro={p.intro}
          index={index}
        />
        {p.layout === "marquee" ? (
          // גלילה רציפה: הרשימה פעמיים (העותק השני מוסתר מקוראי מסך), עוצרת בריחוף ובמיקוד, בלי תנועה למי שביקש
          <div
            className="bps-marquee"
            tabIndex={0}
            role="region"
            // שם שונה משם המקטע (שני אזורים באותו שם מבלבלים את הניווט בקורא מסך)
            aria-label={t(p.title) ? `רצועת ההמלצות — ${t(p.title)}` : "רצועת ההמלצות"}
          >
            <ul className="bps-marquee-track">
              {items.map((x) => card(x, x.id))}
              {items.map((x) => card(x, `${x.id}-copy`, true))}
            </ul>
          </div>
        ) : (
          <ul className="bps-quotes">{items.map((x) => card(x, x.id))}</ul>
        )}
        {t(p.button.label) && (
          <div className="bps-section-action">
            <LinkButton href={p.button.href} label={p.button.label} variant="soft" />
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- Form ----------
/** טופס פנייה — נשמר ב"פניות מלקוחות" (מיגרציה 196), בעל העסק מקבל מייל. בתצוגה המקדימה: פניית בדיקה */
export function FormBlock({ block }: Props<"form">) {
  const { media, mode } = useSiteView();
  const t = useT();
  const p = block.props;
  const bg = p.background.media ? cssImage(media[p.background.media]?.url) : undefined;
  return (
    <section
      id={block.id}
      className={`bps-form-band bps-form-${p.tone} bps-form-${p.layout}`}
      aria-labelledby={t(p.title) ? `${block.id}-title` : undefined}
      aria-label={t(p.title) ? undefined : "טופס פנייה"}
      style={bg ? ({ "--bp-section-image": bg } as CSSProperties) : undefined}
    >
      <div className="bps-wrap bps-form-inner">
        {t(p.title) && (
          <h2 id={`${block.id}-title`} className="bps-h2 bps-form-title">
            {t(p.title)}
          </h2>
        )}
        <InquiryForm
          id={block.id}
          kind={p.kind}
          formTitle={t(p.title)}
          preview={mode === "preview"}
          labels={{
            name: t(p.fields.name),
            email: t(p.fields.email),
            phone: t(p.fields.phone),
            message: t(p.fields.message),
            submit: t(p.submit),
          }}
        />
      </div>
    </section>
  );
}

// ---------- Media ----------
export function MediaBlock({ block }: Props<"media">) {
  const { media } = useSiteView();
  const p = block.props;
  if (!hasImage(p.image, media)) return null;
  return (
    <section
      id={block.id}
      className={`bps-media-block bps-media-${p.align}${p.alignNarrow !== "same" ? ` bps-media-narrow-${p.alignNarrow}` : ""}`}
      style={
        {
          "--bp-media-w": `${p.width}px`,
          "--bp-media-w-narrow": `${p.widthNarrow || p.width}px`,
        } as CSSProperties
      }
    >
      <figure>
        <SiteImage image={p.image} sizes={`${p.width}px`} />
      </figure>
    </section>
  );
}

// ---------- CTA ----------
export function CtaBlock({ block }: Props<"cta">) {
  const { doc } = useSiteView();
  const t = useT();
  const p = block.props;
  const wa = p.whatsapp
    ? whatsappHref(doc.business.whatsapp, t(doc.business.whatsappMessage))
    : null;
  if (!t(p.title)) return null;
  return (
    <section id={block.id} className="bps-cta" aria-labelledby={`${block.id}-title`}>
      <div className="bps-wrap bps-cta-inner">
        <div>
          <h2 id={`${block.id}-title`} className="bps-h2">
            {t(p.title)}
          </h2>
          {t(p.text) && <p>{t(p.text)}</p>}
        </div>
        <div className="bps-actions">
          <LinkButton href={p.button.href} label={p.button.label} />
          {wa && (
            <a
              className="bps-btn bps-btn-ghost"
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp<span className="bps-sr"> (נפתח בחלון חדש)</span>
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- Contact ----------
export function ContactBlock({ block, index }: Props<"contact">) {
  const { doc, mode } = useSiteView();
  const t = useT();
  const p = block.props;
  const b = doc.business;
  const wa = p.showWhatsapp ? whatsappHref(b.whatsapp, t(b.whatsappMessage)) : null;
  const tel = p.showPhone ? telHref(b.phone) : null;
  const mail = p.showEmail && b.email ? `mailto:${b.email}` : null;
  const channels = [
    wa && {
      key: "wa",
      label: "WhatsApp",
      value: formatPhone(b.whatsapp),
      href: wa,
      external: true,
    },
    tel && { key: "tel", label: "טלפון", value: b.phone, href: tel, external: false },
    mail && { key: "mail", label: "אימייל", value: b.email, href: mail, external: false },
  ].filter(Boolean) as {
    key: string;
    label: string;
    value: string;
    href: string;
    external: boolean;
  }[];
  return (
    <section
      id={block.id}
      className="bps-section bps-contact"
      aria-labelledby={`${block.id}-title`}
    >
      <div className="bps-wrap bps-contact-grid">
        <SectionHead
          id={block.id}
          eyebrow={p.eyebrow}
          title={p.title}
          intro={p.intro}
          index={index}
        />
        <div>
          {channels.length > 0 && (
            <ul className="bps-channels">
              {channels.map((c) => (
                <li key={c.key}>
                  <a
                    href={c.href}
                    {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    <span className="bps-channel-label">{c.label}</span>
                    <span className="bps-channel-value" dir="ltr">
                      {c.value}
                    </span>
                    {c.external && <span className="bps-sr"> (נפתח בחלון חדש)</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {p.form && (
            <InquiryForm
              id={`${block.id}-form`}
              kind="contact"
              formTitle={t(p.title)}
              preview={mode === "preview"}
              labels={{
                name: "שם",
                email: "אימייל",
                phone: "טלפון",
                message: "הודעה",
                submit: "שליחה",
              }}
            />
          )}
          {(t(b.address) || t(b.hours)) && (
            <dl className="bps-details">
              {t(b.address) && (
                <div>
                  <dt>כתובת</dt>
                  <dd>{t(b.address)}</dd>
                </div>
              )}
              {t(b.hours) && (
                <div>
                  <dt>שעות</dt>
                  <dd>{t(b.hours)}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- Text ----------
export function TextBlock({ block, index }: Props<"text">) {
  const t = useT();
  const p = block.props;
  if (!t(p.title) && !p.paragraphs.some((x) => t(x))) return null;
  return (
    <section id={block.id} className="bps-section bps-text" aria-labelledby={`${block.id}-title`}>
      <div className="bps-wrap bps-narrow">
        <SectionHead id={block.id} title={p.title} index={index} />
        <div className="bps-prose">
          {p.paragraphs.map((para, i) => (
            <p key={i}>{t(para)}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 972524653108 → 052-465-3108 (תצוגה בלבד) */
export function formatPhone(international: string): string {
  const m = /^972(5\d)(\d{3})(\d{4})$/.exec(international);
  return m ? `0${m[1]}-${m[2]}-${m[3]}` : `+${international}`;
}
