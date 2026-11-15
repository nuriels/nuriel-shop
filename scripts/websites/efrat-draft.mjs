#!/usr/bin/env node
// טיוטת האתר של אפרת אדיר (פיילוט Nuriel Websites, Stage 2) — מתוך מפת התוכן שנסרקה מהאתר הציבורי שלה
// (docs/websites/content-map.json). טקסטים בלבד, כמו שהם — בלי תמונות (הורדה ייבוא רק בשלב הייבוא, באישור שלה),
// בלי תוכן שהומצא ובלי המלצות (הן צילומי מסך — ממתינות לטקסט ולאישור). 46 עבודות בלי שם — מוסתרות עד שיתקבלו
// השמות (docs/websites/efrat-missing-materials.md). **טיוטה בלבד: לא מתפרסמת** (החלטה 7).
// שימוש: node scripts/websites/efrat-draft.mjs > efrat-draft.json
import { readFileSync } from "node:fs";

const map = JSON.parse(
  readFileSync(new URL("../../docs/websites/content-map.json", import.meta.url), "utf8"),
);
const c = map.content;
const he = (text) => ({ he: String(text ?? "").trim() });

const categories = c.portfolio.categories_he.map((label, i) => ({
  id: `cat-${i + 1}`,
  label: he(label),
}));
const catId = new Map(categories.map((cat) => [cat.label.he, cat.id]));

const items = c.portfolio.items.map((item, i) => {
  const titled = item.title_is_meaningful === true;
  // שם הספר משם הקובץ: בלי מספר בתחילה או בסוף ("1 חקוק בגנים", "מוטת כנפיים 1")
  // וגם בלי שם הקטגוריה שנוסף לשם הקובץ ("… לספרי ילדים", "… להגהות", "… לפרוזה"). שמות זמניים — לאישור שלה
  const title = titled
    ? String(item.title_from_media_library)
        .replace(/^\d+\s+|\s+\d+$/g, "")
        .replace(/\s+(לספרי ילדים|להגהות|לפרוזה)$/, "")
        .trim()
    : "";
  return {
    id: `work-${i + 1}`,
    title: he(title),
    text: he(""),
    categories: (item.categories ?? [])
      .map((name) => catId.get(name))
      .filter(Boolean)
      .slice(0, 5),
    image: { media: null, alt: he(title ? `עטיפת הספר "${title}"` : "") },
    hidden: !titled,
  };
});

const paragraphs = c.about.paragraphs_he.map((p) => String(p).trim()).filter(Boolean);
const [greeting, ...aboutRest] = paragraphs;

const services = c.services.items.map((s, i) => ({
  id: `service-${i + 1}`,
  title: he(s.title_he),
  text: he(s.description_he),
  icon: null,
  hidden: false,
}));

const whatsapp = String(c.contact.whatsapp ?? "").replace(/\D/g, "");

const block = (id, type, props, hidden = false) => ({ id, type, v: 1, hidden, props });

const doc = {
  schema: 1,
  template: "elegant",
  locales: ["he"],
  defaultLocale: "he",
  // צבעי המותג שלה (מה-CSS של האתר): חום #684D4B, ורוד-בז' #E9D0C7 — מותאמים לניגודיות AA
  theme: {
    palette: {
      background: "#fbf7f4",
      surface: "#ffffff",
      text: "#3d2b28",
      muted: "#6a5450",
      accent: "#684d4b",
      accentText: "#ffffff",
      soft: "#f3e5df",
    },
    radius: "soft",
  },
  business: {
    name: he(c.business_identity.name_he),
    tagline: he(c.business_identity.wp_tagline),
    phone: "",
    whatsapp,
    whatsappMessage: he(c.contact.whatsapp_prefilled_text_he),
    email: "",
    address: he(""),
    hours: he(""),
    // דף הפייסבוק מופיע רק בנתוני ה-schema של האתר הישן — מחכה לאישור שלה (רשימת החומרים)
    social: { facebook: "", instagram: "", linkedin: "" },
    logo: { media: null, alt: he(`הלוגו של ${c.business_identity.name_he}`) },
  },
  collections: {
    services,
    testimonials: [],
    portfolio: { categories, items },
  },
  pages: [
    {
      id: "home",
      slug: "",
      title: he(c.business_identity.name_he),
      seo: {
        title: he(c.business_identity.site_title),
        description: he(c.business_identity.meta_description),
      },
      blocks: [
        block("hero", "hero", {
          eyebrow: he(c.business_identity.profession_line),
          title: he(c.business_identity.hero_headline),
          subtitle: he(c.business_identity.hero_subheadline),
          image: { media: null, alt: he("") },
          primary: { label: he("לשיחת היכרות"), href: "#contact" },
          secondary: { label: he("לתיק העבודות"), href: "#portfolio" },
          layout: "split",
        }),
        block("about", "about", {
          eyebrow: he(greeting),
          title: he("הסיפור שלי"),
          paragraphs: aboutRest.map(he),
          image: { media: null, alt: he("") },
          highlights: [],
        }),
        block("services", "services", {
          eyebrow: he(""),
          title: he(c.services.section_title_he),
          intro: he(""),
        }),
        block("portfolio", "portfolio", {
          eyebrow: he(""),
          title: he(c.portfolio.section_title_he),
          intro: he(""),
          filter: true,
          showTitles: true,
        }),
        // ההמלצות — צילומי מסך בלבד באתר הישן: מוסתרות עד שיתקבלו הטקסטים והאישור (החלטה 7)
        block(
          "testimonials",
          "testimonials",
          { eyebrow: he(""), title: he(c.testimonials.section_title_he), intro: he("") },
          true,
        ),
        block("cta", "cta", {
          title: he(c.other.cta_headings_he[0]),
          text: he(c.about.photo_carousel_ctas[0]),
          button: { label: he("לשיחת היכרות"), href: "#contact" },
          whatsapp: true,
        }),
        block("contact", "contact", {
          eyebrow: he(""),
          title: he("יצירת קשר"),
          intro: he(c.about.photo_carousel_ctas[1]),
          showWhatsapp: true,
          showPhone: true,
          showEmail: true,
          form: false,
        }),
      ],
    },
  ],
};

process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
