# efratadir.com - content audit (for migration)

Audited 2026-11-15. Public GET requests only, about 1 per second. No forms were submitted and no images or media were downloaded, so image contents are not described here. The site is a **single Hebrew (RTL) landing page** built with WordPress, Elementor and Elementor Pro. Structured data is in `content-map.json`. Raw HTML is in `html/`.

## 1. Page inventory

| URL                             | Title                                                                                         | Type                                                      | Words                       | Images                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| https://efratadir.com/          | אפרת אדיר - עריכה ספרותית \| עריכה לשונית \| עריכת תוכן \| ניקוד והגהה                        | Home: the only content page (WP page 9, Elementor Canvas) | 489 visible (440 main copy) | 17 `<img>` + 64 unique portfolio images (123 gallery elements, desktop and mobile) + 3 CSS backgrounds |
| /category/uncategorized/        | ארכיון Uncategorized - אפרת אדיר - עריכה ספרותית \| עריכה לשונית \| עריכת תוכן \| ניקוד והגהה | Empty category archive, indexable, not in the sitemap     | 69                          | 0                                                                                                      |
| /אפרת-אדיר-עורכת-ספרים-מקצועית/ | n/a                                                                                           | Slug of the front page                                    | n/a                         | 301 to /                                                                                               |
| /feed/                          | n/a                                                                                           | RSS, 0 items                                              | n/a                         | n/a                                                                                                    |

The sitemap (`/sitemap.xml` 301-redirects to `/sitemap_index.xml`, which points to `/page-sitemap.xml`) lists **one URL**: `/`, lastmod 2026-04-17, with 4 images. The WP REST API agrees: 1 published page, 0 posts, 1 category (Uncategorized, 0 posts), no portfolio post type.

## 2. Navigation

The page has **no navigation menu**. The Elementor Canvas template removes the theme header and footer, so there is no header menu, no footer menu and no anchors. The empty category archive shows the Hello Elementor default header (site title and tagline, no menu) and the footer line "כל הזכויות שמורות" ("All rights reserved").

Page flow, top to bottom:

- Hero
- Lead form #1 (free consultation)
- About + photo carousel
- Lottie animation (decorative)
- Testimonials (image carousel)
- Services ("My expertise")
- Projects / portfolio (tabs + galleries)
- Lead form #2 (CTA)
- Footer credit line

## 3. Classified content

### Identity

- Name: **אפרת אדיר (Efrat Adir)**, book editor
- Profession line: עריכה ספרותית | עריכת תוכן | עריכה לשונית | ניקוד והגהה
- Hero headline (two H1s): "אפשר לקרוא סיפור, ואפשר להרגיש אותו". Sub-headline (H2): "זה קל יותר כשעובדים יחד"
- WP tagline: עורכת מקצועית בעלת ניסיון רב, שתסייע לך להפוך יצירה טובה ליצירה מעולה. יחד נביא את כתב היד שלך לגרסה המדויקת והטובה ביותר. כשזה מדויק, זה נוגע
- Meta description: עריכת ספרים מדויקת, רגישה ומקצועית, כדי שהטקסט שלך יהיה חד, אותנטי ומשכנע. כשזה מדויק, זה נוגע. זה הספר שלך אבל בגרסה הטובה ביותר
- Logo: `/wp-content/uploads/2025/07/Brown-Retro-Book-Store-Logo-1-e1751896139482.png` (1167x1167 PNG). It is shown as the hero image and used as og:image. The site icon is the cropped 512x512 version.
- Brand (from page CSS): browns #684D4B / #542510, blush #E9D0C7, sage #D4DBB2, mint #AAD3C1, terracotta/peach #C48566 / #EBAB8B. Fonts: Assistant (main), Heebo. The Elementor kit globals were never changed from the defaults (Roboto, #6EC1E4).

### About (9 paragraphs, Hebrew, in the server HTML)

The section starts with "נעים מאוד, אני אפרת, אמא לשניר ולענבר, ואני עורכת ספרים." ("Nice to meet you, I'm Efrat, mother of Snir and Inbar, and I'm a book editor."). The rest covers:

- about 20 years of experience, starting in journalism
- the types of text she edits: fiction, non-fiction, mentoring, biographies, poetry, digital content, learning materials
- children's books, linked to her years as an educator in regular and special education
- a quality-and-process pitch

The section also has a banner graphic ("הסיפור שלי", "my story") and a 2-photo carousel (WhatsApp photo files, not inspected). The full text is in the JSON under `content.about.paragraphs_he`.

### Services ("המומחיות שלי", "My expertise"): 5 items

- **עריכה ספרותית** (Literary editing): התייחסות למבנה היצירה, סגנון ומשלב, דיוק ואמינות, מאפייני הדמויות, לכידות ורצף העלילה, הזרימה והקוהרנטיות של הסיפור ועוד. עריכה ספרותית תידר...
- **עריכה לשונית** (Language (copy) editing): מתייחסת לתיקוני כתיב ותחביר, שגיאות במין ובמספר, תיקוני ניסוח, האחדת כתיב מלא, סימני פיסוק, סמיכויות, לכידות המשפטים והפסקאות ועוד. עריכת לש...
- **עריכת תוכן** (Content editing): התייחסות למבנה הספר, תוכן העניינים, דיוק ובהירות תוך התחשבות בקהל היעד, הרחבה או צמצום, איתור כפילויות, כותרות וכותרות משנה וכדומה. עריכת תו...
- **ניקוד** (Nikud (Hebrew vowel pointing)): ניקוד מלא המסייע לקוראים חדשים או תלמידי אולפן. ניקוד עזר (חלקי) שנועד למקרים שבהם עלולה להיות דו־משמעות, מילים לועזיות, מילים לא מוכרות, או...
- **הגהה** (Proofreading): הגהה מתבצעת לאחר סיום העריכה, לרוב בשני שלבים – לפני העימוד ולאחר העימוד. ההגהה מטפלת בטעויות לשוניות, טעויות פיסוק וכתיב, האחדת כתיב מלא, ת...

### Portfolio ('פרויקטים', 'Projects'): 64 unique images in 5 categories

- Desktop and tablet show nested tabs with masonry galleries. Mobile shows one filterable justified gallery instead.
- Items per category (desktop / mobile):
  - פרוזה (Prose): 13 / 13
  - ספרי ילדים (Children's books): 37 / 36
  - שירה (Poetry): 2 / 2
  - הגהה (Proofreading): 6 / 6
  - ספרים, קלפים, חוברות וחומרי למידה (Books, cards, booklets & learning materials): 4 / 4
- Items have no descriptions, authors or publishers. The only "title" is the media-library title, which comes from the filename.
- 18 of 64 titles look like real book names:
  - 1 חקוק בגנים (פרוזה)
  - מוטת כנפיים 1 (פרוזה)
  - מעברים (פרוזה)
  - סיפור פשוט 2 (פרוזה)
  - אולי עכשיו לפרוזה (פרוזה, ספרי ילדים)
  - אי המשאלות (ספרי ילדים)
  - הכלב (ספרי ילדים)
  - הרפתקאות בעולם המחזור (ספרי ילדים)
  - חברות עם משמעות טיול שנתי (ספרי ילדים)
  - חברות עם משמעות (ספרי ילדים)
  - טלי ומאיה יוצאות להרפתקה (ספרי ילדים)
  - לאפרים יש צליאק (ספרי ילדים)
  - למה השמש בודדה (ספרי ילדים)
  - שפת הים ואני לספרי ילדים (ספרי ילדים)
  - סיפורי יער לספרי ילדים (ספרי ילדים)
  - סבתא את זוכרת לספרי ילדים (ספרי ילדים)
  - מעשה בשישה שופטים לספרי ילדים (ספרי ילדים)
  - סבתא שבשמיים להגהות (הגהה)
- The other 46 titles are raw filenames (screenshots, Facebook-style numbers, "ללא שם" = untitled, WhatsApp). The owner has to supply the real titles.

### Testimonials ("לקוחות ממליצים", "Clients recommend"): 13 items, all images

- The 13 slides (`1.png` to `13.png`) are screenshot images in a carousel.
- **Authors and text: NOT ACCESSIBLE.** They exist only inside the images, which were not downloaded. Getting them needs the owner or OCR of the images.
- The media library also has 3 unused images whose filename is a testimonial snippet: "כשהתחלתי לכתוב את ספרי השני, ידעתי שלפחות דבר אחד בטוח, וזה מי תהיה העורכת שלו..." ("When I started writing my second book, I knew at least one thing for sure: who its editor would be...").

### Contact

- WhatsApp: https://wa.me/972524653108, i.e. **+972 52-465-3108**. The pre-filled message is "היי אפרת, הגעתי מדף הנחיתה שלך ואשמח לפרטים לגבי עבודת עריכה". 4 CTA buttons use it:
  - "בואו נצא לדרך" (Hero)
  - "השאירו פרטים ונקבע שיחה ראשונית" (About + photo carousel)
  - "זה הזמן לפנות אליי" (About + photo carousel)
  - "לקביעת שיחת היכרות" (Testimonials (image carousel))
- Two Elementor Pro lead forms (details in section 6).
- Email, street address, hours and map: **none on the site**. There are no tel: or mailto: links.
- Social: Facebook https://www.facebook.com/Efrat.Adir.Editing/about/ appears only in the Yoast schema `sameAs`. It is not linked on the page and was not fetched.

### Legal pages, blog and other

- Legal pages: **none**. There is no privacy policy, no accessibility statement and no terms page.
- Blog: none (0 posts).
- Other:
  - Footer credit as an H2: "האתר נוצר ב- ❤️ ע״י איזי דיגיטל - בנייה וקידום אתרים" (agency credit, not a link).
  - A decorative Lottie animation: `/wp-content/uploads/2025/07/Animation-1751485891149.json`.

## 4. SEO

| URL                      | Title                                                                                         | Meta description                                                                                                                  | Canonical                                     |
| ------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| /                        | אפרת אדיר - עריכה ספרותית \| עריכה לשונית \| עריכת תוכן \| ניקוד והגהה                        | עריכת ספרים מדויקת, רגישה ומקצועית, כדי שהטקסט שלך יהיה חד, אותנטי ומשכנע. כשזה מדויק, זה נוגע. זה הספר שלך אבל בגרסה הטובה ביותר | https://efratadir.com/                        |
| /category/uncategorized/ | ארכיון Uncategorized - אפרת אדיר - עריכה ספרותית \| עריכה לשונית \| עריכת תוכן \| ניקוד והגהה | (none)                                                                                                                            | https://efratadir.com/category/uncategorized/ |

- og:title is the same as the title. og:image is the logo (1167x1167). twitter:card is summary_large_image.
- Robots: index, follow. That includes the empty category archive.
- Schema (Yoast): WebPage, WebSite (with SearchAction), Organization (logo; sameAs Facebook), ImageObject, BreadcrumbList. There is no LocalBusiness or Service markup and no reviews.
- Headings:
  - H1 ×2, both in the hero.
  - H2 ×4. Two are CTA lines, one is the form headline, one is the footer credit.
  - H3 ×5, the service names.
  - The section titles (testimonials, expertise, projects) are `<p>`, not headings.

## 5. Images

- `<img>` tags: 17.
  - 4 content images (logo/hero, about banner, 2 about photos), all with **alt=""**.
  - 13 testimonial slides whose alt is just a filename ("1.png" to "13").
- Portfolio: 123 gallery elements covering 64 unique images, all with **aria-label=""** (no alt).
- Media library: 0 of 129 items have alt text. About 43 items are not used on the page, including 4 PDFs, one of them about 35 MB (35,140,339 bytes).
- Suspected logo: Brown-Retro-Book-Store-Logo-1-e1751896139482.png.
- Suspected hero: CSS background `compressed_u5162483547_female_freelancer_writing_in_an_open_blank_planner__...jpeg` (2464x1856, about 680 KB). The filename looks like an AI or stock image.
- Other CSS backgrounds: 2 pastel-leaf PNGs (1366x768).
- Icons: 5 inline SVG icons on the services. The media library has book, quote, contract, signature and checked .svg files.
- Heaviest files that load on the page (sizes declared by the WP media API):
  - 2025/07/9.png: 1095 KB, 1875x1094, testimonial slide, full-size file loaded in carousel
  - 2025/07/1.png: 1070 KB, 1875x1094, testimonial slide, full-size file loaded in carousel
  - 2025/07/2.png: 977 KB, 1875x1094, testimonial slide, full-size file loaded in carousel
  - 2025/07/7.png: 964 KB, 1875x1094, testimonial slide, full-size file loaded in carousel
  - 2025/07/4.png: 851 KB, 1875x1094, testimonial slide, full-size file loaded in carousel
  - 2025/07/5.png: 686 KB, 1875x1094, testimonial slide, full-size file loaded in carousel
  - 2025/07/compressed_u5162483547_female_freelancer_writing_in_an_open_blank_planner__ba87b418-ff81-4ccc-882c-b029bad7b502-1-1.jpeg: 680 KB, 2464x1856, hero CSS background
  - 2025/07/3.png: 671 KB, 1875x1094, testimonial slide, full-size file loaded in carousel
  - The 13 testimonial files total about 8.3 MB. They are served at full size (lazy-loaded as the autoplay carousel advances) into a carousel only 2 slides wide.
- Portfolio full-size lightbox files over 1 MB:
  - 2025/07/צילום-מסך-2025-07-03-024335.png: 1455 KB
  - 2026/03/שפת-הים-ואני-לספרי-ילדים.png: 1154 KB
  - 2025/07/צילום-מסך-2025-07-03-023432.png: 1141 KB
  - 2026/03/מעשה-בשישה-שופטים-לספרי-ילדים.png: 1036 KB
  - 2025/07/צילום-מסך-2025-07-08-ב-14.39.04.png: 1019 KB

## 6. Forms

There are two identical Elementor Pro forms, both named "טופס חדש" ("New form"). They submit by POST through admin-ajax and were **not submitted**.

- Lead form #1 (free consultation): submit button "לייעוץ ללא עלות"
- Lead form #2 (CTA): submit button "לשיחת היכרות"

Fields in both forms:

- `form_fields[name]`: text, "שם" (name), required
- `form_fields[email]`: email, "אימייל", required
- `form_fields[message]`: tel, "טלפון" (phone), optional, with a phone pattern. The phone field is internally named "message".
- `form_fields[field_xxx]`: text, "במה אוכל לעזור?" ("How can I help?"), optional

Problems: no `<label>`s (placeholder only), duplicate element ids across the two forms, no consent or privacy notice. Where submissions go (email recipient, webhook) is server-side configuration and could not be seen.

## 7. Platform and stack

- WordPress (generator says "WordPress 7.0.8").
- Theme: Hello Elementor 3.4.7. Page template: Elementor Canvas.
- Builder: Elementor 4.3.6 and Elementor Pro 4.3.2. Widgets: containers, nested tabs, nested carousel, gallery, image carousel, icon box, form, Lottie, motion effects.
- SEO: Yoast SEO 28.1.
- Hosting: Hostinger, LiteSpeed server with cache, PHP 8.2.
- Language: `lang="he-IL"`, `dir="rtl"`.
- **Analytics and pixels: none found.** There is no GA4, GTM, UA, Google Ads, Meta Pixel, Clarity, Hotjar or TikTok code. There is also no cookie banner and no accessibility widget.
- JS dependency:
  - All text is in the server HTML.
  - Testimonial images use `data-src` (swiper lazy loading) and portfolio thumbnails are `data-thumbnail` attributes on divs, so without JS no portfolio or testimonial images show.
  - The Lottie animation needs JS.

## 8. Issues found

- **alt text**: 0 of 17 <img> have meaningful alt: 4 content images have alt=""; 13 testimonial slides have filename alts ("1.png".. "13"). All 123 gallery items have aria-label="" (no alt). Media library: 0 of 129 items have alt_text.
- **testimonials as images**: 13 testimonials are screenshots (images) - text/author not machine-readable, not accessible to screen readers, not indexable.
- **heavy images**: Testimonial carousel loads full-size PNGs (slides 1-10 are 1875x1094, ~0.5-1.1 MB each; 13 slides total ~8.3 MB declared, lazy-loaded as the carousel autoplays). Hero CSS background JPEG ~680 KB (2464x1856). Several portfolio full images > 1 MB (lightbox only).
- **headings**: Two H1s (hero line split into "אפשר לקרוא סיפור," + "ואפשר להרגיש אותו"); section titles "לקוחות ממליצים", "המומחיות שלי", "פרויקטים" are <p> not headings; footer credit line is an H2.
- **titles/meta**: Only one indexable content page, so no duplicates among pages. Title = og:title = site name (no distinct page title). Meta description present (homepage). Empty category archive /category/uncategorized/ is indexable, has no meta description, and duplicates site title pattern.
- **portfolio data**: 64 unique portfolio images but many titles are raw filenames (screenshots, Facebook/WhatsApp names, "ללא שם"); no per-item description/author/publisher. Desktop tab galleries and the mobile gallery differ: 3 items desktop-only + 1 item in two desktop categories vs 3 different items mobile-only.
- **JS-only rendering**: Text is server-rendered, but testimonial images (data-src lazy) and portfolio thumbnails (data-thumbnail on div) appear only with JS; Lottie needs JS.
- **forms**: No <label>s (placeholder-only), duplicate element ids across the 2 forms, phone field named "message", no privacy notice/consent checkbox, generic form name "טופס חדש".
- **legal pages**: No accessibility statement, no privacy policy, no terms page; no accessibility widget. Only one published WP page exists (REST API).
- **contact info**: No visible phone number, email, address or hours on the page; contact is only via WhatsApp buttons and the forms. No tel:/mailto: links. Facebook profile only in schema.org sameAs, not linked on page.
- **schema**: Yoast graph only (WebPage, WebSite, Organization, ImageObject, BreadcrumbList). Organization name = full SEO title string; no LocalBusiness/ProfessionalService, no contact point, no reviews.
- **unused media / hygiene**: Media library: 129 items, ~43 not used on the page (incl. 4 PDFs; one is ~35 MB / 35,140,339 bytes: אליאור-כריכה.pdf). Elementor global kit colours/fonts left at defaults (#6EC1E4 / Roboto) - real styling is per-widget.
- **broken links**: None encountered. All fetched URLs returned 200/301; wa.me link returns 302 to api.whatsapp.com (normal).

## 9. URL preservation

| Old URL                                                                                                                                                                                                 | New path                                                    | Action                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| https://efratadir.com/                                                                                                                                                                                  | /                                                           | keep (home)                                                                                                                          |
| /אפרת-אדיר-עורכת-ספרים-מקצועית/ (encoded: /%D7%90%D7%A4%D7%A8%D7%AA-%D7%90%D7%93%D7%99%D7%A8-%D7%A2%D7%95%D7%A8%D7%9B%D7%AA-%D7%A1%D7%A4%D7%A8%D7%99%D7%9D-%D7%9E%D7%A7%D7%A6%D7%95%D7%A2%D7%99%D7%AA/) | /                                                           | 301 (already 301s today)                                                                                                             |
| /category/uncategorized/                                                                                                                                                                                | /                                                           | 301 (or 410) - empty archive                                                                                                         |
| /feed/ and /comments/feed/                                                                                                                                                                              | /                                                           | 301 or 410 (no posts)                                                                                                                |
| /sitemap.xml, /sitemap_index.xml, /page-sitemap.xml                                                                                                                                                     | /sitemap.xml                                                | serve new sitemap; 301 the Yoast index/child to it                                                                                   |
| /?s=... (Yoast SearchAction)                                                                                                                                                                            | -                                                           | drop; remove SearchAction from new schema unless site search exists                                                                  |
| /wp-content/uploads/2025/07/Brown-Retro-Book-Store-Logo-1-e1751896139482*.png (og:image, sitemap image)                                                                                                 | /images/logo.png (or keep path)                             | 301 the 4 sitemap-listed image URLs to new asset URLs, or keep the files at their old paths                                          |
| /wp-content/uploads/... other images                                                                                                                                                                    | new asset paths                                             | optional: 301 /wp-content/uploads/* to an asset folder if image search traffic matters; otherwise let 404                            |
| (no old URL) home sections                                                                                                                                                                              | /#about, /#services, /#portfolio, /#testimonials, /#contact | new anchors (current page has no section ids); or split into /about /services /portfolio /contact as new pages - nothing to redirect |
| (none)                                                                                                                                                                                                  | /accessibility-statement, /privacy-policy                   | new pages (missing today)                                                                                                            |
| /wp-admin/_, /wp-login.php, /xmlrpc.php, /wp-json/_                                                                                                                                                     | -                                                           | not preserved                                                                                                                        |

Only `/` carries content and SEO value, so the redirect footprint is small. Keep `/` and 301 the rest as listed. If the new site splits into several pages, the new paths have no old URLs to redirect from.
