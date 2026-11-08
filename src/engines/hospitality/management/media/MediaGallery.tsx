// גלריה (Stage 2e) — לאתר, למתחם או ליחידה: העלאה מהמחשב / מהטלפון (מצלמה או גלריה;
// התמונה מוקטנת בדפדפן לפני השליחה), ייבוא מקישור (השרת מוריד ושומר עותק משלנו),
// סרטון מ-YouTube / Vimeo, תמונה ראשית, סדר (חצים), טקסט חלופי (ALT), החלפה ומחיקה.
// כל פעולה נבדקת שוב בשרת ובמסד; הקבצים נבדקים לפי התוכן ומקודדים מחדש בשרת.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Film,
  ImagePlus,
  Link2,
  Loader2,
  RefreshCw,
  Star,
  Trash2,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  cn,
} from "@/platform/ui";
import {
  hospitalityAddVideoLink,
  hospitalityDeleteMedia,
  hospitalityGallery,
  hospitalityImportMedia,
  hospitalityReorderMedia,
  hospitalitySetMediaCover,
  hospitalityUpdateMediaAlt,
  hospitalityUploadMedia,
} from "../../api/media.functions";
import type { Gallery, GalleryRef, MediaItem } from "../../types/media";
import {
  ALT_MAX,
  GALLERY_MAX,
  altError,
  formatBytes,
  parseVideoLink,
} from "../../validation/media";
import { ConfirmButton } from "../catalog/parts";
import { moveItem } from "../catalog/model";
import { errorText } from "../catalog/refresh";
import { manageKeys } from "../lib/query-keys";
import { shrink } from "./shrink";

const galleryKey = (ref: GalleryRef) =>
  [...manageKeys.all, "gallery", ref.ownerKind, ref.ownerId] as const;
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime";

export function MediaGallery(props: {
  galleryRef: GalleryRef;
  title: string;
  description: string;
  canEdit: boolean;
}) {
  const ref = props.galleryRef;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: galleryKey(ref),
    queryFn: () => hospitalityGallery({ data: { ownerKind: ref.ownerKind, ownerId: ref.ownerId } }),
    refetchOnWindowFocus: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [video, setVideo] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);

  const setGallery = (g: Gallery) => {
    queryClient.setQueryData(galleryKey(ref), g);
    void queryClient.invalidateQueries({ queryKey: [...manageKeys.all, "galleries"] });
    void queryClient.invalidateQueries({ queryKey: manageKeys.catalog });
    void queryClient.invalidateQueries({ queryKey: manageKeys.context });
  };
  const run = async (label: string, action: () => Promise<Gallery>, done?: string) => {
    setBusy(label);
    setError(null);
    try {
      setGallery(await action());
      if (done) toast.success(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const formFor = (file: Blob, name: string, replaceId?: string) => {
    const fd = new FormData();
    fd.set("ownerKind", ref.ownerKind);
    if (ref.ownerId) fd.set("ownerId", ref.ownerId);
    if (replaceId) fd.set("replaceId", replaceId);
    fd.set("file", file, name);
    return fd;
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    let ok = 0;
    for (const [i, f] of list.entries()) {
      const label = list.length > 1 ? `מעלה ${i + 1} מתוך ${list.length}…` : "מעלה…";
      const blob = await shrink(f);
      if (await run(label, () => hospitalityUploadMedia({ data: formFor(blob, f.name) }))) ok++;
      else break;
    }
    if (ok > 0) toast.success(ok === 1 ? "הקובץ נוסף לגלריה" : `${ok} קבצים נוספו לגלריה`);
    if (fileInput.current) fileInput.current.value = "";
  };

  const replace = async (files: FileList | null) => {
    const f = files?.[0];
    const id = replacing;
    if (!f || !id) return;
    const blob = await shrink(f);
    await run(
      "מחליף…",
      () => hospitalityUploadMedia({ data: formFor(blob, f.name, id) }),
      "הקובץ הוחלף",
    );
    setReplacing(null);
    if (replaceInput.current) replaceInput.current.value = "";
  };

  const g = query.data;
  const items = g?.items ?? [];
  const full = items.length >= GALLERY_MAX;
  const videoOk = video.trim() === "" || parseVideoLink(video) !== null;

  return (
    <Card data-section="gallery" data-testid={`gallery-${ref.ownerKind}`}>
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>{props.title}</h2>
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isError && <p className="text-sm text-destructive">{errorText(query.error)}</p>}
        {!g && !query.isError && <p className="text-sm text-muted-foreground">טוען את הגלריה…</p>}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {busy}
          </p>
        )}

        {g && items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            עוד אין תמונות. תמונות טובות הן הדבר הראשון שאורחים בודקים — מומלץ 5–10 תמונות.
          </p>
        )}
        {items.length > 0 && (
          <ol
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            aria-label={`${props.title} — לפי הסדר`}
          >
            {items.map((m, i) => (
              <MediaCard
                key={m.id}
                item={m}
                index={i}
                count={items.length}
                canEdit={props.canEdit}
                disabled={busy !== null}
                onCover={() =>
                  run(
                    "שומר…",
                    () => hospitalitySetMediaCover({ data: { id: m.id, ...ref } }),
                    "התמונה הראשית עודכנה",
                  )
                }
                onMove={async (to) => {
                  const expected = items.map((x) => x.id);
                  const ids = moveItem(expected, i, to);
                  setBusy("שומר את הסדר…");
                  setError(null);
                  try {
                    const r = await hospitalityReorderMedia({ data: { ...ref, expected, ids } });
                    setGallery(r.gallery);
                    if (r.status === "conflict")
                      setError(
                        "הגלריה עודכנה בינתיים על ידי משתמש אחר — מוצג הסדר העדכני. נסו שוב.",
                      );
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(null);
                  }
                }}
                onAlt={(alt) =>
                  run(
                    "שומר…",
                    () => hospitalityUpdateMediaAlt({ data: { id: m.id, alt, ...ref } }),
                    "הטקסט החלופי נשמר",
                  )
                }
                onReplace={() => {
                  setReplacing(m.id);
                  replaceInput.current?.click();
                }}
                onDelete={async () => {
                  await run(
                    "מוחק…",
                    () => hospitalityDeleteMedia({ data: { id: m.id, ...ref } }),
                    "נמחק מהגלריה",
                  );
                }}
              />
            ))}
          </ol>
        )}

        {props.canEdit && (
          <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              multiple
              className="sr-only"
              aria-label="בחירת תמונות או סרטון"
              data-testid="media-file"
              onChange={(e) => void upload(e.target.files)}
            />
            <input
              ref={replaceInput}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="media-replace-file"
              onChange={(e) => void replace(e.target.files)}
            />
            <Button
              type="button"
              className="min-h-11 w-fit gap-2"
              disabled={busy !== null || full}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus className="size-4" aria-hidden="true" />
              העלאת תמונות או סרטון
            </Button>
            <p className="text-xs text-muted-foreground">
              מהמחשב או מהטלפון (מצלמה / גלריה). JPG, PNG, WEBP עד 15MB; סרטון MP4 / WebM / MOV עד
              50MB. SVG לא נתמך.
            </p>
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!link.trim() || busy) return;
                void run(
                  "מוריד את התמונה ושומר עותק…",
                  () => hospitalityImportMedia({ data: { ...ref, url: link.trim() } }),
                  "התמונה יובאה ונשמרה אצלנו",
                ).then((ok) => ok && setLink(""));
              }}
            >
              <Label htmlFor={`import-${ref.ownerKind}`}>ייבוא תמונה מקישור</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id={`import-${ref.ownerKind}`}
                  dir="ltr"
                  inputMode="url"
                  placeholder="https://…/photo.jpg"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  className="min-h-11 text-start"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="min-h-11 gap-2"
                  disabled={!link.trim() || busy !== null || full}
                >
                  <Link2 className="size-4" aria-hidden="true" />
                  ייבוא
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                אנחנו מורידים את התמונה, בודקים אותה ושומרים עותק משלנו — האתר לא יציג תמונה מאתר
                אחר.
              </p>
            </form>
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!video.trim() || !videoOk || busy) return;
                void run(
                  "מוסיף את הסרטון…",
                  () => hospitalityAddVideoLink({ data: { ...ref, url: video.trim() } }),
                  "הסרטון נוסף",
                ).then((ok) => ok && setVideo(""));
              }}
            >
              <Label htmlFor={`video-${ref.ownerKind}`}>סרטון מ-YouTube או Vimeo</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id={`video-${ref.ownerKind}`}
                  dir="ltr"
                  inputMode="url"
                  placeholder="https://youtu.be/…"
                  value={video}
                  onChange={(e) => setVideo(e.target.value)}
                  aria-invalid={!videoOk || undefined}
                  className="min-h-11 text-start"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="min-h-11 gap-2"
                  disabled={!video.trim() || !videoOk || busy !== null || full}
                >
                  <Youtube className="size-4" aria-hidden="true" />
                  הוספת סרטון
                </Button>
              </div>
              {!videoOk && (
                <p className="text-sm text-destructive">
                  קישור הסרטון לא תקין — רק YouTube או Vimeo
                </p>
              )}
            </form>
          </div>
        )}
        {g && (
          <p className="text-xs text-muted-foreground" data-testid="media-usage">
            {items.length} מתוך {GALLERY_MAX} בגלריה · נפח האחסון של העסק:{" "}
            {formatBytes(g.usage.bytes)} ({g.usage.files} קבצים)
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MediaCard(props: {
  item: MediaItem;
  index: number;
  count: number;
  canEdit: boolean;
  disabled: boolean;
  onCover: () => void;
  onMove: (to: number) => void;
  onAlt: (alt: string) => Promise<boolean>;
  onReplace: () => void;
  onDelete: () => Promise<void>;
}) {
  const m = props.item;
  const [alt, setAlt] = useState(m.alt ?? "");
  const altChanged = alt.trim() !== (m.alt ?? "");
  const altErr = altError(alt);
  const n = props.index + 1;
  const name = m.kind === "embed" ? `סרטון ${n}` : m.kind === "video" ? `סרטון ${n}` : `תמונה ${n}`;
  return (
    <li
      data-media={n}
      data-cover={m.is_cover || undefined}
      className={cn("flex flex-col gap-2 rounded-md border p-2", m.is_cover && "border-primary")}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded bg-muted">
        {m.kind === "image" && m.thumb_url ? (
          <img
            src={m.thumb_url}
            alt={m.alt ?? ""}
            loading="lazy"
            decoding="async"
            width={320}
            height={240}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
            {m.kind === "embed" ? (
              <Youtube className="size-8" aria-hidden="true" />
            ) : (
              <Film className="size-8" aria-hidden="true" />
            )}
            <span className="text-xs">
              {m.kind === "embed" ? (m.embed_provider === "vimeo" ? "Vimeo" : "YouTube") : "סרטון"}
            </span>
          </div>
        )}
        {m.is_cover && (
          <span className="absolute start-2 top-2 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            תמונה ראשית
          </span>
        )}
        {m.is_demo && (
          <span className="absolute end-2 top-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
            תמונת הדגמה
          </span>
        )}
      </div>
      {m.source_url && (
        <p className="truncate text-xs text-muted-foreground" dir="ltr">
          יובאה מ-{new URL(m.source_url).hostname}
        </p>
      )}
      {props.canEdit && (
        <>
          <form
            className="flex flex-col gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (altChanged && !altErr) void props.onAlt(alt);
            }}
          >
            <Label htmlFor={`alt-${m.id}`} className="text-xs">
              טקסט חלופי (ALT) — מה רואים ב{name.startsWith("סרטון") ? "סרטון" : "תמונה"}
            </Label>
            <div className="flex gap-2">
              <Input
                id={`alt-${m.id}`}
                value={alt}
                maxLength={ALT_MAX}
                placeholder="למשל: ג׳קוזי מול נוף הכנרת"
                onChange={(e) => setAlt(e.target.value)}
                className="min-h-11"
              />
              {altChanged && (
                <Button
                  type="submit"
                  variant="outline"
                  className="min-h-11"
                  disabled={props.disabled || Boolean(altErr)}
                >
                  שמירה
                </Button>
              )}
            </div>
            {altErr && <p className="text-xs text-destructive">{altErr}</p>}
          </form>
          <div className="flex flex-wrap items-center gap-1">
            {m.kind === "image" && !m.is_cover && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 gap-1"
                disabled={props.disabled}
                onClick={props.onCover}
              >
                <Star className="size-4" aria-hidden="true" />
                תמונה ראשית
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 min-w-11"
              aria-label={`הזזת ${name} קדימה`}
              disabled={props.disabled || props.index === 0}
              onClick={() => props.onMove(props.index - 1)}
            >
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 min-w-11"
              aria-label={`הזזת ${name} אחורה`}
              disabled={props.disabled || props.index === props.count - 1}
              onClick={() => props.onMove(props.index + 1)}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
            {m.kind !== "embed" && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 gap-1"
                aria-label={`החלפה — ${name}`}
                disabled={props.disabled}
                onClick={props.onReplace}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                החלפה
              </Button>
            )}
            <ConfirmButton
              label="מחיקה"
              destructive
              icon={<Trash2 className="size-4" aria-hidden="true" />}
              disabled={props.disabled}
              title={`למחוק את ${name}?`}
              description={<p>הקובץ יימחק מהגלריה ומהאחסון. אי אפשר לבטל את זה.</p>}
              confirmLabel="מחיקה"
              onConfirm={props.onDelete}
            />
          </div>
        </>
      )}
    </li>
  );
}
