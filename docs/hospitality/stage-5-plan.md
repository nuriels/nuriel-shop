# Stage 5 — site editor and theme system (5a + 5b, built 02/11/2026)

Approved 02/11/2026 with this order of priority:

1. A full site editor.
2. Four themes, switchable without losing content.
3. Room types.
4. Bookings, payments and channel infrastructure.

Technical order: the site document and themes (5a) come first, because the editor (5b)
edits them.

## 5a — site document and themes

### Document (`website/design/schema.ts`)

`{ v: 1, theme, colors: { [theme]: { primary?, accent? } }, sections: [{ id, type, hidden, content }] }`

- **Core sections:** hero, about, units, gallery, amenities, terms, location.
  - They appear once and can be hidden but not deleted.
  - A document missing one gets it back, hidden.
- **Custom sections** (up to 12): text and image, highlights (up to 6), FAQ (up to 15), call
  to action.
- **Content overrides only:**
  - eyebrow, title, subtitle, text, button label, image (by media id), gallery selection,
    hero darkening, image side, show facts;
  - empty means the default from the business data;
  - business data (units, prices, availability, policies, amenities) is never copied
    into the document — the sections read it live.
- **`normalizeDesign` never throws:**
  - it drops unknown types and fields, strips control characters, caps lengths, accepts
    only hex colours and UUID media ids;
  - it runs on the server before saving and again at render time, so a broken or
    hand-crafted document (for example sent straight to the API) cannot break the site or
    inject CSS / HTML. All text is rendered as React text.

### Storage (migration 21)

- `site_versions` holds one draft (autosaved, with a revision) and immutable published
  versions.
- The public site reads the latest published version.
- The editor and its preview read the draft.

### Themes (`website/theme/themes.ts`)

| Theme | Palette | Hero | Unit cards | Headings | Display font |
|---|---|---|---|---|---|
| Luxury | ivory, dark ink, champagne | full image, text at the bottom | portrait | centred | serif 500 |
| Nature | forest green, earth, clay; rounded | text beside the image | landscape | centred | serif 600 |
| Modern | white, black, terracotta; square | big type above a wide image | minimal | start | sans 800, tight |
| Romantic | blush, wine; very rounded | centred text on the image | soft, centred | centred | serif 500 |

- All four are `tier: free`; the premium switch is decided in Stage 11.
- A theme is tokens plus layout choices; the components are shared.
- **Owner colours:**
  - per theme, so switching back restores the earlier choice;
  - a contrast guard keeps text readable:
    - text on buttons is white or dark, whichever reads better;
    - the accent used for small text is darkened to 4.5:1 against the background;
  - unit tests check every theme against these ratios.
- **Fonts:** the two already-loaded fonts (Frank Ruhl Libre, Heebo) with different
  weights and tracking. No new font downloads.

## 5b — the editor ("עיצוב האתר", `/manage/website`)

- **Who:**
  - staff with the `settings` permission (owner and managers), management area on;
  - no new permission key.
- **Sections tab:**
  - order by drag or arrows;
  - show / hide;
  - edit each section's fields (placeholders show the defaults);
  - images picked from the site's own photos (site gallery, properties, units) — uploads
    stay in "תמונות";
  - add / delete custom sections.
- **Design tab:**
  - four theme cards with swatches and descriptions;
  - primary and accent colours per theme, with a reset and a readability note.
- **Publish tab:**
  - published version and date, "unpublished changes", whether the site is open;
  - note and "פרסום האתר";
  - previous versions with "restore to draft" (confirmed).
- **Autosave:**
  - the draft is saved 1.2 s after the last change, with the revision check;
  - a change made elsewhere shows "העיצוב השתנה ממקום אחר" and a reload button,
    with no silent overwrite.
- **Live preview:**
  - an iframe of `/manage/preview` renders the same components as the site, with the site
    data and the draft — also while the site is closed to guests;
  - every change is posted to it (`postMessage`, same origin only) and shown at once,
    before the autosave;
  - desktop is rendered at a real 1280 px, scaled to fit; mobile at 390 px;
  - home page or any unit page;
  - links do not navigate (anchors scroll).
- **Guests see only published versions.**

### Verified locally (browser)

1. Owner login → "עיצוב האתר".
2. Hero title edited; the preview updates at once.
3. Theme changed to Nature; the autosave shows "נשמר כטיוטה".
4. FAQ section added; it appears in the preview; switched to the mobile preview.
5. Published (version 1, note "ערכת טבע").
6. The public site shows Nature, the new title and the FAQ.

No console errors.

## Decisions taken (technical, documented)

- **Preview route:** `/manage/preview` sits inside the management area (gate, session,
  noindex), so owners can preview before the site opens.
- **Logo, custom fonts, inline click-to-edit in the preview, per-section style options and
  a buttons / links editor:** not in this round. The document format leaves room for them
  (new optional fields).
- **Theme choice when a business is opened (D23):** the default is Luxury; the owner
  switches in the editor. A gallery at opening time and the demo site per theme come
  later.

## What remains (Stage 5 follow-ups)

- Logo upload and approved font pairs.
- Clicking a text in the preview to edit it.
- Buttons and links editor.
- E2E for the editor (edit → autosave → publish → site; concurrent edit; restore).
