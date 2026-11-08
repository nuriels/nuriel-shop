// התמונה הראשית וסרטון הפתיח (H-1) — בלשונית "עיצוב" ובמקטע הפתיח (אותו ערך: התוכן של מקטע
// הפתיח). תמונה: העלאה חדשה (נשמרת בגלריית האתר ונבחרת), בחירה מהתמונות, או אוטומטית. סרטון:
// העלאה בלבד — עד 15 שניות ועד 20MB; נבדק כבר כאן (אורך מהדפדפן, גודל — רק לנוחות) ושוב בשרת על
// הקובץ עצמו, והמסד מקבל לפתיח רק סרטון שהשרת מדד (מיגרציה 62). באתר: הסרטון בלי קול, ואחריו
// התמונה הראשית 5 שניות — וחוזר חלילה, עם כפתור עצירה (HeroVideo).
import { Film, ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/platform/ui";
import { hospitalityUploadHeroVideo, hospitalityUploadMedia } from "../../api/media.functions";
import { HERO_VIDEO_MAX_BYTES, HERO_VIDEO_MAX_SECONDS } from "../../media/video-info";
import type { PublicSite } from "../../types/website";
import { heroImage, heroVideoStatus, mediaById, videoById } from "../../website/lib/media";
import { errorText } from "../catalog/refresh";
import { shrink } from "../media/shrink";
import { ImagePicker } from "./SectionFields";

const IMAGE_TYPES = /^image\/(png|jpeg|webp|avif)$/;
const VIDEO_TYPES = /^video\/(mp4|quicktime|webm)$/;
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;

/** אורך הסרטון לפי הדפדפן (לפני ההעלאה); null — הדפדפן לא קרא (למשל HEVC) — השרת יבדוק */
function readSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let settled = false;
    const done = (s: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(s);
    };
    const timer = window.setTimeout(() => done(null), 5000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      window.clearTimeout(timer);
      done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    };
    v.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    v.src = url;
  });
}

export function HeroMediaField({
  site,
  image,
  video,
  logo,
  onChange,
  onMediaAdded,
}: {
  site: PublicSite;
  image: string | undefined;
  video: string | undefined;
  /** הלוגו לא נבחר אוטומטית כתמונה ראשית */
  logo?: string | undefined;
  onChange: (patch: { image?: string | undefined; video?: string | undefined }) => void;
  onMediaAdded: () => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"image" | "video" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [hevc, setHevc] = useState(false);
  // מה שהועלה עכשיו — מוצג מיד, עוד לפני שנתוני האתר מתרעננים
  const [fresh, setFresh] = useState<Record<string, string>>({});

  const chosen = mediaById(site, image);
  const shownImage =
    chosen?.url ?? (image ? fresh[image] : undefined) ?? heroImage(site, logo)?.url;
  const clip = videoById(site, video);
  const clipUrl = clip?.url ?? (video ? fresh[video] : undefined);
  // סרטון שנבחר בעבר ולא יוצג באתר (ארוך מ-15 שניות / עוד לא נמדד) — מסבירים ומציעים להסיר
  const status = heroVideoStatus(site, video);
  const unusable = Boolean(video) && !clip && !(video && fresh[video]) && status.status !== "ok";

  const uploadImage = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.type && !IMAGE_TYPES.test(file.type)) {
      setError("התמונה צריכה להיות JPG, PNG, WebP או AVIF");
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setError("התמונה גדולה מדי — עד 15MB");
      return;
    }
    setBusy("image");
    try {
      const before = new Set(site.gallery.map((m) => m.id));
      const fd = new FormData();
      fd.set("ownerKind", "site");
      fd.set("alt", site.business.name.slice(0, 200));
      // כמו ב"תמונות": תמונה גדולה מוקטנת בדפדפן לפני ההעלאה (השרת בודק ומקודד שוב)
      fd.set("file", await shrink(file), file.name);
      const gallery = await hospitalityUploadMedia({ data: fd });
      const added = gallery.items
        .filter((m) => m.kind === "image" && !before.has(m.id))
        .sort((a, b) => b.sort_order - a.sort_order)[0];
      if (added) {
        if (added.url) setFresh((f) => ({ ...f, [added.id]: added.url! }));
        onChange({ image: added.id });
      }
      onMediaAdded();
      toast.success("התמונה הראשית הוחלפה — לא לשכוח לפרסם");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
      if (imageInput.current) imageInput.current.value = "";
    }
  };

  const uploadVideo = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setHevc(false);
    if (file.type && !VIDEO_TYPES.test(file.type)) {
      setError("הסרטון צריך להיות MP4, MOV (מהאייפון) או WebM");
      return;
    }
    if (file.size > HERO_VIDEO_MAX_BYTES) {
      setError("הסרטון גדול מ-20MB. צלמו ב-1080p (לא ב-4K) או קצרו אותו, ונסו שוב.");
      return;
    }
    const seconds = await readSeconds(file);
    if (seconds !== null && seconds > HERO_VIDEO_MAX_SECONDS + 0.5) {
      setError(
        `הסרטון ארוך מדי (${Math.round(seconds)} שניות). עד ${HERO_VIDEO_MAX_SECONDS} שניות — קצרו אותו ונסו שוב.`,
      );
      return;
    }
    setBusy("video");
    try {
      const fd = new FormData();
      fd.set("alt", `סרטון — ${site.business.name}`.slice(0, 200));
      fd.set("file", file, file.name);
      const r = await hospitalityUploadHeroVideo({ data: fd });
      if (r.url) setFresh((f) => ({ ...f, [r.id]: r.url! }));
      onChange({ video: r.id });
      setHevc(r.codec === "hevc");
      onMediaAdded();
      toast.success(`הסרטון הועלה (${r.seconds} שניות) — לא לשכוח לפרסם`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
      if (videoInput.current) videoInput.current.value = "";
    }
  };

  return (
    <fieldset className="flex flex-col gap-3" data-testid="hero-media">
      <legend className="mb-1 text-sm font-medium">תמונה ראשית וסרטון (ראש העמוד)</legend>
      <p className="text-xs text-muted-foreground">
        אם הוספתם סרטון: הסרטון מתנגן בלי קול, ובסופו התמונה הראשית 5 שניות — וחוזר חלילה, עם כפתור
        עצירה. עד שהסרטון נטען, ובכל תקלה, מוצגת התמונה. מי שביקש באתר "עצירת אנימציות" או גולש
        בחיסכון בנתונים יראה רק את התמונה.
      </p>

      <div className="flex flex-col gap-2">
        <div className="aspect-video w-full overflow-hidden rounded-md border bg-muted">
          {shownImage ? (
            <img src={shownImage} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-xs text-muted-foreground">
              עוד אין תמונות לאתר
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {image ? "נבחרה תמונה ראשית" : "אוטומטית — התמונה הראשונה מהגלריה"}
        </p>
        <input
          ref={imageInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          id="hero-image-upload"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void uploadImage(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 gap-1.5"
            disabled={busy !== null}
            onClick={() => imageInput.current?.click()}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {busy === "image" ? "מעלה…" : image ? "החלפת התמונה" : "העלאת תמונה ראשית"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-10"
            aria-expanded={picking}
            onClick={() => setPicking((v) => !v)}
          >
            בחירה מהתמונות
          </Button>
        </div>
        {picking && (
          <ImagePicker
            site={site}
            value={image}
            label="בחירת התמונה הראשית"
            onChange={(id: string | undefined) => onChange({ image: id })}
          />
        )}
      </div>

      <div className="flex flex-col gap-2 border-t pt-3">
        <p className="text-sm font-medium">סרטון (לא חובה)</p>
        {clipUrl ? (
          <>
            <video
              src={clipUrl}
              muted
              loop
              playsInline
              controls
              preload="metadata"
              aria-label="סרטון הפתיח"
              className="aspect-video w-full rounded-md border bg-black object-cover"
              data-testid="hero-video-preview"
            />
            <p className="text-xs text-muted-foreground">
              הסרטון נשמר גם ב"תמונות" (גלריית האתר) — אפשר למחוק אותו שם.
            </p>
          </>
        ) : unusable ? (
          <p
            role="status"
            className="rounded-md bg-amber-50 p-2 text-xs text-amber-900"
            data-testid="hero-video-unusable"
          >
            {status.status === "too_long" && status.seconds !== null
              ? `הסרטון שנבחר ארוך מדי (${Math.round(status.seconds)} שניות) ולכן לא מוצג באתר — באתר מוצגת התמונה הראשית. הסירו אותו או העלו סרטון של עד ${HERO_VIDEO_MAX_SECONDS} שניות.`
              : `הסרטון שנבחר לא מוצג באתר (לא נמצא, או שאורכו עוד לא נבדק) — באתר מוצגת התמונה הראשית. הסירו אותו או העלו סרטון של עד ${HERO_VIDEO_MAX_SECONDS} שניות.`}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            עד {HERO_VIDEO_MAX_SECONDS} שניות ועד 20MB — MP4 או MOV מהטלפון. בטלפון: צילום ב-1080p
            (לא 4K).
          </p>
        )}
        <input
          ref={videoInput}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="sr-only"
          id="hero-video-upload"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void uploadVideo(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 gap-1.5"
            disabled={busy !== null}
            onClick={() => videoInput.current?.click()}
          >
            <Film className="size-4" aria-hidden="true" />
            {busy === "video"
              ? "מעלה ובודק את הסרטון…"
              : video
                ? "החלפת הסרטון"
                : `העלאת סרטון (עד ${HERO_VIDEO_MAX_SECONDS} שניות)`}
          </Button>
          {video && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-10 gap-1.5"
              disabled={busy !== null}
              onClick={() => {
                setHevc(false);
                onChange({ video: undefined });
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              הסרת הסרטון מהפתיח
            </Button>
          )}
        </div>
        {hevc && (
          <p
            className="rounded-md bg-amber-50 p-2 text-xs text-amber-900"
            data-testid="hero-video-hevc"
          >
            הסרטון בפורמט HEVC ("יעילות גבוהה" באייפון). בחלק מהמכשירים, בעיקר באנדרואיד ובמחשבי
            Windows, תוצג רק התמונה. לתוצאה הכי טובה: באייפון הגדרות ← מצלמה ← פורמטים ← "הכי תואם",
            ולצלם שוב.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
