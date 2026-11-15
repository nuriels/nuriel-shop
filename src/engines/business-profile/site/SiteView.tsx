// האתר של העסק — אותו רכיב לאתר החי (הגרסה המפורסמת) ולתצוגה המקדימה בממשק הניהול (הטיוטה).
// מבנה: כותרת עליונה (שם העסק / לוגו + ניווט לעוגנים), המקטעים של העמוד, פוטר (פרטים, ©, קרדיט),
// וכפתור WhatsApp צף. RTL מלא; הכיוון והשפה לפי שפת התצוגה (מוכן לאנגלית).
import type { CSSProperties } from "react";
import { isBlockType } from "../document/blocks";
import type { Block, Locale, Page, SiteDocument } from "../document/schema";
import { templateOf } from "../templates/registry";
import type { MediaMap } from "../types";
import {
  AboutBlock,
  ContactBlock,
  CtaBlock,
  HeroBlock,
  PortfolioBlock,
  ServicesBlock,
  TestimonialsBlock,
  TextBlock,
} from "./blocks";
import { SiteViewProvider, useSiteView, useT, whatsappHref } from "./context";
import {
  BP_CREDIT_AFTER,
  BP_CREDIT_BEFORE,
  BP_CREDIT_LABEL,
  BP_PRODUCT,
  NURIEL_CREDIT_REL,
  NURIEL_CREDIT_URL,
} from "./credit";
import { SiteImage } from "./parts";

const RADIUS = { sharp: "2px", soft: "10px", round: "22px" } as const;

function cssVars(doc: SiteDocument): CSSProperties {
  const p = doc.theme.palette;
  return {
    "--bp-bg": p.background,
    "--bp-surface": p.surface,
    "--bp-text": p.text,
    "--bp-muted": p.muted,
    "--bp-accent": p.accent,
    "--bp-accent-text": p.accentText,
    "--bp-soft": p.soft,
    "--bp-radius": RADIUS[doc.theme.radius],
  } as CSSProperties;
}

/** המקטעים שמופיעים בניווט (אלה שיש להם כותרת), לפי הסדר בעמוד */
const NAV_TYPES = new Set(["about", "services", "portfolio", "testimonials", "contact"]);

function BlockView({
  block,
  index,
  heroLayout,
}: {
  block: Block;
  index: number;
  heroLayout: "split" | "centered" | "cover";
}) {
  if (!isBlockType(block.type)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = block as Block<any>;
  switch (block.type) {
    case "hero":
      return <HeroBlock block={b} index={index} layout={heroLayout} />;
    case "about":
      return <AboutBlock block={b} index={index} />;
    case "services":
      return <ServicesBlock block={b} index={index} />;
    case "portfolio":
      return <PortfolioBlock block={b} index={index} />;
    case "testimonials":
      return <TestimonialsBlock block={b} index={index} />;
    case "cta":
      return <CtaBlock block={b} index={index} />;
    case "contact":
      return <ContactBlock block={b} index={index} />;
    case "text":
      return <TextBlock block={b} index={index} />;
  }
}

function SiteHeader({ page }: { page: Page }) {
  const { doc } = useSiteView();
  const t = useT();
  const name = t(doc.business.name) || t(page.title);
  const nav = page.blocks.filter(
    (b) => !b.hidden && NAV_TYPES.has(b.type) && t((b.props as { title?: { he: string } }).title),
  );
  return (
    <header className="bps-top">
      <div className="bps-wrap bps-top-inner">
        <a className="bps-brand" href="/" aria-label={name ? `${name} — דף הבית` : "דף הבית"}>
          <SiteImage image={doc.business.logo} className="bps-logo" eager />
          <span className="bps-brand-name">{name}</span>
        </a>
        {nav.length > 0 && (
          <nav aria-label="ניווט ראשי" className="bps-nav">
            <ul>
              {nav.map((b) => (
                <li key={b.id}>
                  <a href={`#${b.id}`}>{t((b.props as { title: { he: string } }).title)}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </header>
  );
}

function SiteFooter() {
  const { doc } = useSiteView();
  const t = useT();
  const name = t(doc.business.name);
  const year = new Date().getFullYear();
  const social = Object.entries(doc.business.social).filter(([, href]) =>
    href.startsWith("https://"),
  );
  const labels: Record<string, string> = {
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
  };
  return (
    <footer className="bps-footer">
      <div className="bps-wrap bps-footer-inner">
        <div>
          <p className="bps-footer-name">{name}</p>
          {t(doc.business.tagline) && <p className="bps-footer-tag">{t(doc.business.tagline)}</p>}
        </div>
        {social.length > 0 && (
          <ul className="bps-social" aria-label="רשתות חברתיות">
            {social.map(([key, href]) => (
              <li key={key}>
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {labels[key] ?? key}
                  <span className="bps-sr"> (נפתח בחלון חדש)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="bps-wrap bps-footer-legal">
        <p>
          © {year} {name}
        </p>
        <p>
          <a
            href={NURIEL_CREDIT_URL}
            target="_blank"
            rel={NURIEL_CREDIT_REL}
            aria-label={BP_CREDIT_LABEL}
          >
            {BP_CREDIT_BEFORE}
            <bdi>{BP_PRODUCT}</bdi>
            {BP_CREDIT_AFTER}
          </a>
        </p>
      </div>
    </footer>
  );
}

function FloatingWhatsapp() {
  const { doc } = useSiteView();
  const t = useT();
  const href = whatsappHref(doc.business.whatsapp, t(doc.business.whatsappMessage));
  if (!href) return null;
  return (
    <a
      className="bps-wa"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="שליחת הודעה ב-WhatsApp (נפתח בחלון חדש)"
    >
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.6 1.1 2.8c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"
        />
      </svg>
    </a>
  );
}

export function SiteView({
  doc,
  media,
  page,
  mode = "live",
  locale,
  embedded = false,
}: {
  doc: SiteDocument;
  media: MediaMap;
  page: Page;
  mode?: "live" | "preview";
  locale?: Locale;
  /** בתוך מסך אחר (פאנל הפלטפורמה): בלי מיקום קבוע */
  embedded?: boolean;
}) {
  const lang = locale ?? doc.defaultLocale;
  const template = templateOf(doc.template);
  let sectionIndex = 0;
  return (
    <SiteViewProvider value={{ doc, media, locale: lang, mode }}>
      <div
        className={`bps ${template.className}${embedded ? " bps-embedded" : ""}`}
        style={cssVars(doc)}
        lang={lang}
        dir={lang === "he" ? "rtl" : "ltr"}
        data-template={template.key}
      >
        <SiteHeader page={page} />
        <main id="main-content" className="bps-main">
          {page.blocks
            .filter((b) => !b.hidden)
            .map((b) => {
              const numbered = b.type !== "hero" && b.type !== "cta";
              if (numbered) sectionIndex += 1;
              return (
                <BlockView
                  key={b.id}
                  block={b}
                  index={sectionIndex}
                  heroLayout={template.heroLayout}
                />
              );
            })}
        </main>
        <SiteFooter />
        <FloatingWhatsapp />
      </div>
    </SiteViewProvider>
  );
}
