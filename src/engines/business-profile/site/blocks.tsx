// רכיבי התצוגה של המקטעים — משותפים לכל התבניות; כל תבנית משנה את העיצוב דרך המחלקה שלה (site.css).
// הכול טקסט (React מציג אותו כטקסט, בלי HTML חופשי). כותרת H1 אחת — בפתיח; כל מקטע — H2.
import { useMemo, useRef, useState } from "react";
import type { BlockProps } from "../document/blocks";
import type { Block, PortfolioItem } from "../document/schema";
import { telHref, useSiteView, useT, whatsappHref } from "./context";
import { hasImage, LinkButton, SectionHead, SiteImage } from "./parts";

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
}

// ---------- Hero ----------
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
  return (
    <section
      id={block.id}
      className={`bps-hero bps-hero-${withImage ? mode : "centered"}`}
      aria-labelledby={`${block.id}-title`}
    >
      <div className="bps-hero-inner">
        <div className="bps-hero-text">
          {t(p.eyebrow) && <p className="bps-eyebrow">{t(p.eyebrow)}</p>}
          <h1 id={`${block.id}-title`} className="bps-h1">
            {title}
          </h1>
          {t(p.subtitle) && <p className="bps-hero-sub">{t(p.subtitle)}</p>}
          <div className="bps-actions">
            <LinkButton href={p.primary.href} label={p.primary.label} />
            <LinkButton href={p.secondary.href} label={p.secondary.label} variant="ghost" />
          </div>
        </div>
        {withImage && (
          <div className="bps-hero-media">
            <SiteImage image={p.image} eager sizes="(min-width: 960px) 45vw, 100vw" />
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- About ----------
export function AboutBlock({ block, index }: Props<"about">) {
  const { media } = useSiteView();
  const t = useT();
  const p = block.props;
  const withImage = hasImage(p.image, media);
  return (
    <section id={block.id} className="bps-section bps-about" aria-labelledby={`${block.id}-title`}>
      <div className={`bps-wrap bps-about-grid${withImage ? "" : " bps-about-solo"}`}>
        <div className="bps-about-text">
          <SectionHead id={block.id} eyebrow={p.eyebrow} title={p.title} index={index} />
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
        {withImage && (
          <figure className="bps-about-media">
            <SiteImage image={p.image} sizes="(min-width: 960px) 38vw, 100vw" />
          </figure>
        )}
      </div>
    </section>
  );
}

// ---------- Services ----------
export function ServicesBlock({ block, index }: Props<"services">) {
  const { doc } = useSiteView();
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
          intro={block.props.intro}
          index={index}
        />
        <ol className="bps-service-list">
          {items.map((s, i) => (
            <li key={s.id} className="bps-service">
              <span className="bps-service-num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
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
function CoverPlaceholder({ item }: { item: PortfolioItem }) {
  const t = useT();
  return (
    <span className="bps-cover-placeholder" aria-hidden="true">
      <span>{t(item.title)}</span>
    </span>
  );
}

export function PortfolioBlock({ block, index }: Props<"portfolio">) {
  const { doc, media, mode } = useSiteView();
  const t = useT();
  const p = block.props;
  const { categories, items: all } = doc.collections.portfolio;
  const items = all.filter((i) => !i.hidden && (hasImage(i.image, media) || mode === "preview"));
  const used = categories.filter((c) => items.some((i) => i.categories.includes(c.id)));
  const [active, setActive] = useState<string>("all");
  const [open, setOpen] = useState<PortfolioItem | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = useMemo(
    () => (active === "all" ? items : items.filter((i) => i.categories.includes(active))),
    [items, active],
  );
  if (!items.length) return null;
  const show = (item: PortfolioItem) => {
    setOpen(item);
    dialog.current?.showModal();
  };
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
          intro={p.intro}
          index={index}
        />
        {p.filter && used.length > 1 && (
          <div className="bps-filter" role="group" aria-label="סינון לפי קטגוריה">
            <button type="button" aria-pressed={active === "all"} onClick={() => setActive("all")}>
              הכול <span className="bps-count">{items.length}</span>
            </button>
            {used.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={active === c.id}
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
        <ul className="bps-grid" aria-live="polite">
          {shown.map((item) => (
            <li key={item.id} className="bps-work">
              <button type="button" className="bps-work-btn" onClick={() => show(item)}>
                <span className="bps-work-media">
                  <SiteImage
                    image={item.image}
                    sizes="(min-width: 960px) 22vw, 45vw"
                    fallback={<CoverPlaceholder item={item} />}
                  />
                </span>
                {p.showTitles && t(item.title) && (
                  <span className="bps-work-title">{t(item.title)}</span>
                )}
                <span className="bps-sr">פתיחה בגודל מלא</span>
              </button>
            </li>
          ))}
        </ul>
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
            <SiteImage image={open.image} eager fallback={<CoverPlaceholder item={open} />} />
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
  const items = doc.collections.testimonials.filter(
    (x) => !x.hidden && (t(x.quote) || hasImage(x.image, media) || mode === "preview"),
  );
  if (!items.length) return null;
  return (
    <section
      id={block.id}
      className="bps-section bps-testimonials"
      aria-labelledby={`${block.id}-title`}
    >
      <div className="bps-wrap">
        <SectionHead
          id={block.id}
          eyebrow={block.props.eyebrow}
          title={block.props.title}
          intro={block.props.intro}
          index={index}
        />
        <ul className="bps-quotes">
          {items.map((x) => (
            <li key={x.id}>
              <figure className="bps-quote">
                {t(x.quote) ? (
                  <blockquote>
                    <p>{t(x.quote)}</p>
                  </blockquote>
                ) : (
                  <SiteImage
                    image={x.image}
                    fallback={
                      <span className="bps-quote-pending">ההמלצה תופיע כאן אחרי שתתקבל כטקסט</span>
                    }
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
          ))}
        </ul>
      </div>
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
  const { doc } = useSiteView();
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
