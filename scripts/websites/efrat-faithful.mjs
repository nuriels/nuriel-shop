#!/usr/bin/env node
// השחזור הנאמן של האתר הישן של אפרת אדיר (efratadir.com) בתבנית "קלאסית" — מסמך אתר (טיוטה בלבד, לא מתפרסם).
// המקור: docs/websites/faithful/efrat-source.json (הטקסטים, הסדר, הצבעים והגופנים מהסריקה של האתר הישן).
// התמונות והגופנים הם קבצים בספריית המדיה של האתר: הפונקציה מקבלת מיפוי "שם קובץ ← מזהה מדיה" (אחרי ההעלאה).
// בלי מיפוי — אותו מסמך בלי תמונות (מבנה בלבד).
// לא מומצא דבר: עבודה בלי שם נשארת בלי שם (titleStatus בקובץ המקור), ההמלצות הן צילומי המסך המקוריים.
// שימוש: node scripts/websites/efrat-faithful.mjs [ids.json] > efrat-faithful.json
import { readFileSync } from "node:fs";

export const SOURCE_URL = new URL(
  "../../docs/websites/faithful/efrat-source.json",
  import.meta.url,
);
export const loadSource = () => JSON.parse(readFileSync(SOURCE_URL, "utf8"));

const he = (text) => ({ he: String(text ?? "").trim() });

/**
 * כפתור WhatsApp הצף (תוספת שאושרה — לא היה באתר הישן): המספר מפרטי העסק, וההודעה המוכנה שנוריאל ביקש.
 * הכפתורים של האתר הישן (פתיח, קרוסלה, המלצות) שומרים את הקישור המקורי שלהם, עם ההודעה המקורית.
 */
export const FLOATING_WHATSAPP_MESSAGE = "שלום, הגעתי דרך האתר ואשמח לקבל פרטים נוספים";

/** @param {any} src @param {Record<string, string>} ids שם קובץ → מזהה מדיה */
export function buildFaithfulDocument(src, ids = {}) {
  const media = (file) => (file && ids[file]) || null;
  const img = (file, alt = "") => ({ media: media(file), alt: he(alt) });
  const wa = src.waLink;
  const button = (label) => ({ label: he(label), href: wa });
  const block = (id, type, props) => ({ id, type, v: 1, hidden: false, props });

  const categories = src.portfolio.categories.map((label, i) => ({
    id: `cat-${i + 1}`,
    label: he(label),
  }));
  const catId = new Map(categories.map((c) => [c.label.he, c.id]));
  const works = src.portfolio.items.map((w, i) => ({
    id: `work-${i + 1}`,
    title: he(w.title),
    text: he(""),
    categories: w.categories
      .map((name) => catId.get(name))
      .filter(Boolean)
      .slice(0, 5),
    // הטקסט החלופי: שם הספר כשידוע; אחרת תיאור כללי (העבודה עצמה בלי שם — להשלמה)
    image: img(w.file, w.title ? `עטיפת הספר "${w.title}"` : "עטיפת ספר"),
    devices: w.devices,
    hidden: false,
  }));

  const services = src.services.items.map((s, i) => ({
    id: `service-${i + 1}`,
    title: he(s.title),
    text: he(s.text),
    icon: null,
    iconImage: img(s.icon, ""),
    iconBg: s.iconBg,
    hidden: false,
  }));

  const testimonials = src.testimonials.items.map((t, i) => ({
    id: `testimonial-${i + 1}`,
    quote: he(""),
    author: he(""),
    role: he(""),
    // צילום המסך המקורי של ההמלצה (הטקסט שבתוכו — להשלמה כטקסט, ברשימת החומרים)
    image: img(
      t.file,
      `המלצה ${i + 1} מתוך ${src.testimonials.items.length} (צילום מסך של המלצה מלקוח)`,
    ),
    hidden: false,
  }));

  const fonts = src.fonts
    .filter((f) => media(f.file))
    .map((f) => ({
      family: f.family,
      weight: f.weight,
      style: f.style,
      unicodeRange: f.unicodeRange,
      file: { media: media(f.file) },
    }));

  const fields = {
    name: he(src.fields.name),
    email: he(src.fields.email),
    phone: he(src.fields.phone),
    message: he(src.fields.message),
  };

  return {
    schema: 1,
    template: "classic",
    locales: ["he"],
    defaultLocale: "he",
    theme: {
      palette: src.palette,
      radius: "soft",
      tokens: src.tokens,
      fonts,
      typography: src.typography,
      chrome: { header: "none", footer: "strip", floatingWhatsapp: true },
    },
    business: {
      name: he(src.business.name),
      tagline: he(""),
      phone: "",
      whatsapp: src.business.whatsapp,
      whatsappMessage: he(FLOATING_WHATSAPP_MESSAGE),
      email: "",
      address: he(""),
      hours: he(""),
      social: { facebook: "", instagram: "", linkedin: "" },
      logo: img(src.hero.logo, `הלוגו של ${src.business.name}`),
    },
    collections: { services, testimonials, portfolio: { categories, items: works } },
    pages: [
      {
        id: "home",
        slug: "",
        title: he(src.business.name),
        seo: {
          title: he(src.seo?.title ?? src.business.name),
          description: he(src.seo?.description ?? ""),
        },
        blocks: [
          block("hero", "hero", {
            eyebrow: he(""),
            titleLead: he(src.hero.titleLead),
            title: he(src.hero.title),
            subtitle: he(src.hero.subtitle),
            tagline: he(src.hero.tagline),
            image: img(src.hero.image, ""),
            showLogo: true,
            primary: button(src.hero.button),
            primaryIcon: "whatsapp",
            secondary: { label: he(""), href: "" },
            layout: "cover",
            overlay: 75,
          }),
          block("form", "form", {
            title: he(src.leadForm.title),
            layout: "beside",
            tone: "light",
            background: img(src.leadForm.background, ""),
            fields,
            submit: he(src.leadForm.submit),
            kind: "consultation",
          }),
          block("about", "about", {
            eyebrow: he(""),
            title: he(src.about.title),
            paragraphs: src.about.paragraphs.map(he),
            image: { media: null, alt: he("") },
            titleImage: img(src.about.titleImage, src.about.titleImageAlt),
            slides: src.about.slides.map((s, i) => ({
              image: img(
                s.image,
                i === 0 ? src.business.name : `${src.business.name} — תמונה נוספת`,
              ),
              button: button(s.button),
            })),
            highlights: [],
          }),
          block("pen", "media", {
            image: img(src.pen.file, ""),
            align: "end",
            width: 213,
            alignNarrow: "start",
            widthNarrow: 107,
          }),
          block("testimonials", "testimonials", {
            eyebrow: he(""),
            title: he(src.testimonials.title),
            titleAccent: he(""),
            intro: he(""),
            layout: "marquee",
            button: button(src.testimonials.button),
            background: img(src.testimonials.background, ""),
          }),
          block("services", "services", {
            eyebrow: he(""),
            title: he(src.services.title),
            titleAccent: he(src.services.titleAccent),
            intro: he(""),
          }),
          block("portfolio", "portfolio", {
            eyebrow: he(""),
            title: he(src.portfolio.title),
            titleAccent: he(""),
            intro: he(""),
            filter: true,
            showAll: false,
            layout: "masonry",
            showTitles: false,
          }),
          block("contact", "form", {
            title: he(src.ctaForm.title),
            layout: "stacked",
            tone: "dark",
            background: { media: null, alt: he("") },
            fields,
            submit: he(src.ctaForm.submit),
            kind: "contact",
          }),
        ],
      },
    ],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : {};
  process.stdout.write(`${JSON.stringify(buildFaithfulDocument(loadSource(), ids), null, 2)}\n`);
}
