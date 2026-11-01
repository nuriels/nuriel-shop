# Hospitality Stage 2e — Photos and galleries (detailed plan and as implemented)

Status: **implemented under the overnight continuous approval of 01/11/2026 (local development on
`hospitality/stage-2` only) — awaiting review.** Scope: `stage-2-plan.md` §3 "2e" (must-include list
and the owner requirements of 31/10/2026). Choices the approved docs left open are in §6.

## 1. What the owner gets

- **Three kinds of gallery:** the site (`/manage/photos`), each property (property page) and each
  unit (unit page). "כל המתחם" units use the property's gallery.
- **Upload** from the computer or the phone (the phone offers camera / gallery); several files at
  once with progress; large photos are shrunk in the browser first (≤ 2,400 px) — the server checks
  and re-encodes anyway.
- **Link import:** paste an image link → the **server** downloads it with the platform's SSRF-safe
  downloader, checks and re-encodes it and stores **our own copy**; pages never show the outside
  address ("יובאה מ-<host>" is shown for information only).
- **Video:** MP4 / WebM / MOV up to 50 MB (checked by signature, stored as is), or a YouTube /
  Vimeo link (only the id is stored — the page never fetches the link).
- **Cover** (one per gallery; the first image becomes the cover automatically; deleting the cover
  promotes the next image), **order** (arrows; a stale order is refused and the latest shown),
  **ALT text** per item, **replace** (same place, cover and ALT; old files deleted), **delete**
  (record and every stored file).
- **Storage usage** of the business (bytes incl. all sizes, number of files) on every gallery and
  on the photos screen. The setup checklist step "תמונות" links to `/manage/photos`.

## 2. Files and sizes

| Upload | Stored (bucket `hosp-media`, public read) |
|---|---|
| JPG / PNG / WebP / AVIF / GIF (first frame) / TIFF ≤ 15 MB, ≤ 50 MP | `<tenant>/<uuid>.webp` (≤ 1600 px), `-960.webp`, `-480.webp`, `-thumb.webp` (320×240 cover crop) — WebP q80, EXIF / GPS / metadata removed, orientation applied |
| MP4 / MOV / WebM ≤ 50 MB | `<tenant>/<uuid>.<ext>` as uploaded |
| SVG, HEIC, HTML, scripts, executables, anything whose content is not one of the above | refused with a Hebrew message |

The original upload is **not** kept (the 1600 px WebP is our master) — default taken, §6.

## 3. Database — migration 12 `20261101200000_hosp_media.sql` (additive)

| Area | Change |
|---|---|
| Columns | `media.variants jsonb` (paths of the extra sizes), `media.source_url` (link imports) |
| Writes | staff lose direct INSERT / UPDATE / DELETE on `media` (SELECT + RLS kept) |
| Functions | `media_list`, `media_galleries`, `media_add`, `media_add_embed`, `media_update` (ALT), `media_set_cover`, `media_reorder` (expected order → `HS409`), `media_replace`, `media_delete` — DEFINER, `media` permission, management flag, gallery lock, action log (`media.*`, never the ALT text) |
| Path rules | only `"<tenant>/<uuid>.(webp|mp4|webm|mov)"` of the caller's site; variants must be `-960 / -480 / -thumb.webp` of the same file; ≤ 60 items per gallery; unknown fields refused |
| Files to delete | `media_replace` / `media_delete` return the stored paths; the server deletes exactly those (with the user's token) |
| Rollback | `supabase/rollbacks/20261101200000_hosp_media.down.sql` — refuses while 2e media exist; restores the exact migration-11 schema (schema comparison in `rollback-check.sh`) |

**G12 verified (01/11/2026)** on the real Storage API (`supabase/storage-api v1.84.19`, local
stack): the `x-tenant-id` header reaches Postgres, so the existing storage policies apply to
uploads made with the **user's own token** — a member of two sites is refused without the header
and accepted with it; another site's folder and anonymous uploads are refused. No service-role
key is used for media.

## 4. Server

- `src/platform/media/remote-image.server.ts` — platform adapter re-exporting the existing
  Ecommerce downloader (`src/server/services/image-fetch.ts`): http / https only, own DNS lookup
  and connection to the checked address (no DNS rebinding), private / loopback / link-local
  (cloud metadata) / multicast / reserved IPv4 and IPv6 and internal names blocked, ≤ 4 redirects
  each re-checked, ≤ 10 MB, ≤ 12 s, type by content. Added to the closed adapter lists
  (`tests/architecture/boundaries.test.ts`, `eslint.config.js`). Ecommerce behaviour unchanged.
- `src/engines/hospitality/server/media.server.ts` — content checks, sharp re-encode and sizes,
  storage writes / deletes with the user's token, public URLs.
- `src/engines/hospitality/api/media.functions.ts` — gallery, overview, upload / replace
  (FormData), link import (rate-limited 30 / 10 min per IP), video link, cover, ALT, order,
  delete. A failed database step deletes the files just stored.

## 5. Tests

| Level | What |
|---|---|
| SQL | `scripts/db-tests/hospitality-media.test.sql` — 39 assertions: privileges; add (owner / manager, first = cover, order); every path rule (other site, traversal, non-WebP image, foreign variant, duplicate, unknown field); whole-property refusal; site / property galleries; cover (one per gallery, never a video); order (stale → "updated in the meantime", invalid list); ALT (logged as "changed" only); embeds (YouTube / Vimeo ids, other providers refused); replace (place / cover / ALT kept, old files returned, kind mismatch refused); delete (files returned, cover moves); list with usage; overview; 60-item limit; outsiders (other site through A and through B, guest, anonymous, store owner); direct writes refused; isolation; Ecommerce unchanged |
| Rollback | `rollback-check.sh` — M12 first: refusal while 2e media exist, exact migration-11 schema, direct writes back, re-apply; whole-schema comparison 12 → 1 → 12 |
| Vitest | `tests/unit/hospitality-media.test.ts` — 32 tests: re-encode (4 WebP files, ≤ 1600 px, EXIF removed, thumb 320×240, no enlargement), SVG / HTML / renamed text / broken JPEG refused, polyglot bytes removed by re-encoding, video signatures, size limits, SSRF guard of the adapter (12 internal targets incl. metadata, IPv6, decimal / hex IPs, `.internal` / `.local` names; schemes; credentials; ports) without network, YouTube / Vimeo parsing, gallery input |
| E2E | `e2e/tests/manage-media.spec.ts` — unit gallery as the manager (two uploads, 8 files in the real bucket, fake JPG and SVG refused by content, ALT, cover, order, replace → old files gone, delete → files gone, usage, YouTube, axe); link import from a local image server (127.0.0.1, 169.254.169.254, 10.x, a redirect to 127.0.0.1, SVG and HTML refused; a good image stored as our copy); photos screen (checklist link, counts, site gallery, checklist step done, axe); direct calls (anonymous / other site refused on every media function, no existence leak); phone upload, no sideways scroll, axe; Ecommerce unchanged |

E2E only: the app server runs with `IMPORT_IMAGE_ALLOW_HOSTS=localhost` (`e2e/scripts/app-up.sh`)
so the test image server can be reached by **name**; IP literals stay blocked. Not set anywhere
else.

## 6. Defaults taken (can be changed later)

| Question | Default implemented |
|---|---|
| Keep the original upload? | no — the 1600 px WebP is the master (smaller storage, no metadata kept) |
| Sizes / format | WebP q80: 1600, 960, 480, thumb 320×240 |
| Items per gallery | 60 |
| ALT edits | last write wins (no revision) — low risk, small field |
| Storage limit per plan (OD-04) | measured and shown only; limit and enforcement in Stage 11 |
| Malware scanning | none beyond decode + re-encode for images; videos are stored as uploaded (signature checked) — listed in the security plan |

## 7. Not in 2e / open

- Showing galleries on the public site — Stage 4 (`srcset` is already produced).
- Drag-and-drop ordering in the gallery (arrows only for now).
- Deleting a whole site does not yet delete its files in the bucket (database cascade only) —
  open item, `security-privacy-compliance-plan.md`.
- Demo images with a licence (`is_demo` + `licence_ref`) are shown with a badge; adding them is
  a platform-admin / preview-kit task (Stage 1 rule unchanged).
