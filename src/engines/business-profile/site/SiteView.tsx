// האתר של העסק — אותו רכיב לאתר החי (הגרסה המפורסמת) ולתצוגה המקדימה בממשק הניהול (הטיוטה).
// מבנה: כותרת עליונה (שם העסק / לוגו + ניווט לעוגנים), המקטעים של העמוד, פוטר (פרטים, ©, קרדיט),
// וכפתור WhatsApp צף. RTL מלא; הכיוון והשפה לפי שפת התצוגה (מוכן לאנגלית).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isBlockType } from "../document/blocks";
import type { Block, Locale, Page, SiteDocument } from "../document/schema";
import { templateOf, templateTokens, type TemplateDefinition } from "../templates/registry";
import type { MediaMap } from "../types";
import {
  AboutBlock,
  ContactBlock,
  CtaBlock,
  FormBlock,
  HeroBlock,
  MediaBlock,
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
import { SiteImage, WhatsappIcon } from "./parts";
import { AccessibilityStatement } from "./AccessibilityStatement";
import { fontFaceCss } from "./fonts";

const RADIUS = { sharp: "2px", soft: "10px", round: "22px" } as const;

/** שם משפחה (נבדק בדפוס קשיח במסמך) → ערך font-family עם גיבוי */
const fontStack = (family: string, fallback: string) => `"${family}", ${fallback}`;

function cssVars(doc: SiteDocument, template: TemplateDefinition): CSSProperties {
  const p = doc.theme.palette;
  const vars: Record<string, string> = {
    "--bp-bg": p.background,
    "--bp-surface": p.surface,
    "--bp-text": p.text,
    "--bp-muted": p.muted,
    "--bp-accent": p.accent,
    "--bp-accent-text": p.accentText,
    "--bp-soft": p.soft,
    "--bp-radius": RADIUS[doc.theme.radius],
  };
  // צבעים נוספים של התבנית (--bp-t-<key>)
  for (const [k, v] of Object.entries(templateTokens(template, doc.theme.tokens)))
    vars[`--bp-t-${k}`] = v;
  // גופנים לפי תפקיד: מהמסמך, אחרת של התבנית; אחרת — ברירות המחדל של site.css
  const ty = doc.theme.typography;
  const role = (r: "display" | "heading" | "body" | "ui") => ty[r] || template.fonts?.[r] || "";
  const fallbacks = {
    display: "system-ui, sans-serif",
    heading: "system-ui, sans-serif",
    body: "system-ui, sans-serif",
    ui: "sans-serif",
  };
  for (const r of ["display", "heading", "body", "ui"] as const) {
    const f = role(r);
    if (f) vars[`--bp-font-${r}`] = fontStack(f, fallbacks[r]);
  }
  return vars as CSSProperties;
}

/** @font-face לגופני האתר שבמסמך (site/fonts.ts) — הכתובות מספריית המדיה */
function fontFaces(doc: SiteDocument, media: MediaMap): string {
  return fontFaceCss(doc.theme.fonts, (id) => media[id]?.url);
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
    case "form":
      return <FormBlock block={b} index={index} />;
    case "media":
      return <MediaBlock block={b} index={index} />;
  }
}

/** הקישור להצהרת הנגישות — באתר החי /accessibility; בתצוגה המקדימה — ההצהרה מהטיוטה */
function statementHref(mode: "live" | "preview"): string {
  return mode === "preview" ? "/studio/preview?page=accessibility" : "/accessibility";
}

function FooterStrip({ floating }: { floating: boolean }) {
  const { mode } = useSiteView();
  return (
    <footer className="bps-footer-strip">
      <p>
        <a href={statementHref(mode)}>הצהרת נגישות</a>
        <span aria-hidden="true"> · </span>
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
      {floating && <FloatingWhatsapp />}
    </footer>
  );
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
          <>
            <nav aria-label="ניווט ראשי" className="bps-nav">
              <ul>
                {nav.map((b) => (
                  <li key={b.id}>
                    <a href={`#${b.id}`}>{t((b.props as { title: { he: string } }).title)}</a>
                  </li>
                ))}
              </ul>
            </nav>
            {/* במסך צר: תפריט נפתח (details — עובד גם בלי JavaScript); בחירה בקישור סוגרת אותו.
                ה-nav עוטף את ה-details, כך שבכל רוחב יש ניווט ראשי גלוי אחד בלבד */}
            <nav aria-label="ניווט ראשי" className="bps-menu">
              <details>
                <summary>
                  <span aria-hidden="true" className="bps-menu-icon" />
                  תפריט
                </summary>
                <ul className="bps-menu-panel">
                  {nav.map((b) => (
                    <li key={b.id}>
                      <a
                        href={`#${b.id}`}
                        onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
                      >
                        {t((b.props as { title: { he: string } }).title)}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </nav>
          </>
        )}
      </div>
    </header>
  );
}

function SiteFooter({ floating }: { floating: boolean }) {
  const { doc, mode } = useSiteView();
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
          <span aria-hidden="true"> · </span>
          <a href={statementHref(mode)}>הצהרת נגישות</a>
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
      {/* הכפתור הצף (מיקום קבוע) — בתוך הפוטר, כך שכל התוכן בתוך אזורי הדף (נגישות) */}
      {floating && <FloatingWhatsapp />}
    </footer>
  );
}

/** מה שהכפתור הצף לא מסתיר: שדות הטופס וכפתורי השליחה, קישורי הפוטר וכפתורי העצירה */
const KEEP_CLEAR =
  ".bps-field input, .bps-field textarea, .bps-field select, .bps-form-submit, .bps-form-again, .bps-footer-strip a, .bps-footer a, .bps-motion-toggle, .bps-carousel-nav";
/** כותרות: נמדד הטקסט עצמו (שורה-שורה), לא כל רוחב הכותרת — כדי שהכפתור לא ייעלם בלי צורך */
const TEXT_CLEAR = "main h1, main h2";

function FloatingWhatsapp() {
  const { doc } = useSiteView();
  const t = useT();
  const href = whatsappHref(doc.business.whatsapp, t(doc.business.whatsappMessage));
  const ref = useRef<HTMLAnchorElement>(null);
  const [typing, setTyping] = useState(false);
  const [covering, setCovering] = useState(false);
  useEffect(() => {
    if (!href) return;
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && el.matches("input, textarea, select");
    // מקלדת פתוחה בנייד (מקלידים בטופס) — הכפתור יורד מהדרך
    const onIn = (e: FocusEvent) => setTyping(isField(e.target));
    const onOut = () => setTyping(false);
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const me = ref.current?.getBoundingClientRect();
        if (!me) return;
        const pad = 8;
        const near = (r: DOMRect) =>
          r.width > 0 &&
          r.left < me.right + pad &&
          r.right > me.left - pad &&
          r.top < me.bottom + pad &&
          r.bottom > me.top - pad;
        const range = document.createRange();
        const hit =
          [...document.querySelectorAll<HTMLElement>(KEEP_CLEAR)].some(
            (el) => el !== ref.current && near(el.getBoundingClientRect()),
          ) ||
          [...document.querySelectorAll<HTMLElement>(TEXT_CLEAR)].some((el) => {
            if (!near(el.getBoundingClientRect())) return false;
            range.selectNodeContents(el);
            return [...range.getClientRects()].some(near);
          });
        setCovering(hit);
      });
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [href]);
  if (!href) return null;
  return (
    <a
      ref={ref}
      className="bps-wa"
      data-hidden={typing || covering ? "true" : undefined}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="שליחת הודעה ב-WhatsApp (נפתח בחלון חדש)"
    >
      <WhatsappIcon />
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
  special,
}: {
  doc: SiteDocument;
  media: MediaMap;
  page: Page;
  mode?: "live" | "preview";
  locale?: Locale;
  /** בתוך מסך אחר (פאנל הפלטפורמה): בלי מיקום קבוע */
  embedded?: boolean;
  /** עמוד של המערכת במקום המקטעים של העמוד (הצהרת הנגישות) */
  special?: "accessibility";
}) {
  const lang = locale ?? doc.defaultLocale;
  const template = templateOf(doc.template);
  const chrome = doc.theme.chrome;
  const faces = fontFaces(doc, media);
  let sectionIndex = 0;
  return (
    <SiteViewProvider value={{ doc, media, locale: lang, mode }}>
      <div
        className={`bps ${template.className}${embedded ? " bps-embedded" : ""}`}
        style={cssVars(doc, template)}
        lang={lang}
        dir={lang === "he" ? "rtl" : "ltr"}
        data-template={template.key}
      >
        {/* גופני האתר (מספריית המדיה שלו) */}
        {faces && <style>{faces}</style>}
        {chrome.header === "bar" && <SiteHeader page={page} />}
        {/* "דלג לתוכן הראשי" — במעטפת של כל עמוד (src/routes/__root.tsx), מגיע לכאן */}
        <main id="main-content" className="bps-main" tabIndex={-1}>
          {special === "accessibility" ? (
            <AccessibilityStatement />
          ) : (
            page.blocks
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
              })
          )}
        </main>
        {chrome.footer === "strip" ? (
          <FooterStrip floating={chrome.floatingWhatsapp} />
        ) : (
          <SiteFooter floating={chrome.floatingWhatsapp} />
        )}
      </div>
    </SiteViewProvider>
  );
}
