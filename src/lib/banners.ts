import { supabase } from "@/integrations/supabase/client";
import { compressDesktopBannerImage, compressMobileBannerImage } from "@/lib/image";
import { BRANDING_BUCKET } from "@/lib/site";

export type BannerPlacement = "top" | "bottom";
export type BannerDevice = "desktop" | "mobile";

export type BannerSlide = {
  /** מזהה מקומי לעריכה (לא נשמר במסד — השמירה מחליפה את כל הבאנרים) */
  key: string;
  placement: BannerPlacement;
  desktop_image_url: string | null;
  desktop_width: number | null;
  desktop_height: number | null;
  mobile_image_url: string | null;
  mobile_width: number | null;
  mobile_height: number | null;
  show_desktop: boolean;
  show_mobile: boolean;
  link_url: string | null;
  alt_text: string;
};

export type BannerSet = Record<BannerPlacement, BannerSlide[]>;

/** סוג הקובץ של הבאנר — לפי סיומת הקישור (בלי שינוי במבנה המסד) */
export type BannerMediaKind = "image" | "gif" | "video";

export function bannerMediaKind(url: string | null | undefined): BannerMediaKind {
  const path = (url ?? "").split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (/\.(mp4|webm)$/.test(path)) return "video";
  if (path.endsWith(".gif")) return "gif";
  return "image";
}

/** מגבלות העלאה: הסרטון עד 5 שניות — בדיוק זמן ההחלפה בין הבאנרים */
export const BANNER_LIMITS = { imageMb: 20, gifMb: 8, videoMb: 15, videoSeconds: 5 } as const;
export const BANNER_ACCEPT = "image/*,video/mp4,video/webm";
/** סבילות קטנה: מקודדים מייצרים לרוב 5.03 שניות לסרטון של "5 שניות" */
const VIDEO_SECONDS_TOLERANCE = 0.25;

export const BANNER_PLACEMENT_LABEL: Record<BannerPlacement, string> = {
  top: "באנר עליון",
  bottom: "באנר תחתון",
};

/** מידות מומלצות — מוצגות בממשק ומשמשות לבדיקת התאמה */
export const BANNER_GUIDE: Record<BannerDevice, { label: string; hint: string; ratios: number[] }> =
  {
    desktop: {
      label: "מחשב",
      hint: "מומלץ \u20661920×600\u2069 פיקסלים (יחס רחב \u206616:5\u2069)",
      ratios: [1920 / 600],
    },
    mobile: {
      label: "נייד",
      hint: "מומלץ \u2066800×800\u2069 (ריבוע \u20661:1\u2069) או \u2066750×1000\u2069 (לאורך \u20663:4\u2069)",
      ratios: [1, 750 / 1000],
    },
  };

/** מרווח סבילות ביחס הרוחב/גובה לפני שמזהירים (8%) */
const RATIO_TOLERANCE = 0.08;

export function bannerSizeWarning(
  device: BannerDevice,
  width: number | null,
  height: number | null,
): string | null {
  if (!width || !height) return null;
  const ratio = width / height;
  const fits = BANNER_GUIDE[device].ratios.some(
    (target) => Math.abs(ratio - target) / target <= RATIO_TOLERANCE,
  );
  if (!fits) {
    return device === "desktop"
      ? `התמונה \u2066${width}×${height}\u2069 — היחס שונה מ-\u206616:5\u2069, ולכן היא תיחתך למעלה ולמטה`
      : `התמונה \u2066${width}×${height}\u2069 — היחס שונה מ-\u20661:1\u2069 או \u20663:4\u2069, ולכן היא תיחתך בשוליים`;
  }
  const minWidth = device === "desktop" ? 1400 : 600;
  if (width < minWidth) {
    return `התמונה \u2066${width}×${height}\u2069 קטנה מהמומלץ ועלולה להיראות מטושטשת במסך גדול`;
  }
  return null;
}

/** קישור מותר: נתיב פנימי שמתחיל ב-/ (לא //) או כתובת http(s) — זהה לבדיקה במסד */
export function isValidBannerLink(value: string): boolean {
  const link = value.trim();
  if (link === "") return true;
  return /^(https?:\/\/\S+|\/([^/\s]\S*)?)$/.test(link);
}

let keySeed = 0;
export function newBannerKey(): string {
  keySeed += 1;
  return `b${Date.now().toString(36)}${keySeed}`;
}

export function emptySlide(placement: BannerPlacement): BannerSlide {
  return {
    key: newBannerKey(),
    placement,
    desktop_image_url: null,
    desktop_width: null,
    desktop_height: null,
    mobile_image_url: null,
    mobile_width: null,
    mobile_height: null,
    show_desktop: true,
    show_mobile: true,
    link_url: null,
    alt_text: "",
  };
}

/** השקופיות שיוצגו בפועל במכשיר: מסומנות להצגה בו ויש להן תמונה למכשיר הזה */
export function slidesFor(slides: BannerSlide[], device: BannerDevice): BannerSlide[] {
  return slides.filter((slide) =>
    device === "desktop"
      ? slide.show_desktop && !!slide.desktop_image_url
      : slide.show_mobile && !!slide.mobile_image_url,
  );
}

let cache: BannerSet | null = null;

export async function loadHomeBanners(force = false): Promise<BannerSet> {
  if (cache && !force) return cache;
  const { data, error } = await supabase
    .from("home_banner_slides")
    .select(
      "placement, position, desktop_image_url, desktop_width, desktop_height, mobile_image_url, mobile_width, mobile_height, show_desktop, show_mobile, link_url, alt_text",
    )
    .order("placement")
    .order("position");
  if (error) throw error;
  const set: BannerSet = { top: [], bottom: [] };
  for (const row of data ?? []) {
    const placement = row.placement === "bottom" ? "bottom" : "top";
    set[placement].push({ ...row, placement, key: newBannerKey() });
  }
  cache = set;
  return set;
}

/** שמירה אטומית של כל הבאנרים (מה שבמסך הניהול = מה שמוצג באתר) */
export async function saveHomeBanners(set: BannerSet): Promise<void> {
  const rows = (["top", "bottom"] as const).flatMap((placement) =>
    set[placement].map((slide, position) => ({
      placement,
      position,
      desktop_image_url: slide.desktop_image_url,
      desktop_width: slide.desktop_width,
      desktop_height: slide.desktop_height,
      mobile_image_url: slide.mobile_image_url,
      mobile_width: slide.mobile_width,
      mobile_height: slide.mobile_height,
      show_desktop: slide.show_desktop,
      show_mobile: slide.show_mobile,
      link_url: slide.link_url?.trim() || null,
      alt_text: slide.alt_text.trim(),
    })),
  );
  const { error } = await supabase.rpc("replace_home_banners", { _slides: rows });
  if (error) throw error;
  cache = null;
}

export type BannerUpload = { url: string; width: number | null; height: number | null };

function readImageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("לא הצלחנו לקרוא את הקובץ"));
    };
    image.src = url;
  });
}

function readVideoInfo(file: Blob): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (error?: Error) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else
        resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    };
    const timer = window.setTimeout(() => done(new Error("לא הצלחנו לקרוא את הסרטון")), 15000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => done();
    video.onerror = () => done(new Error("הסרטון לא נתמך — נסו MP4 (H.264) או WebM"));
    video.src = url;
  });
}

export async function uploadBannerImage(file: File, device: BannerDevice): Promise<BannerUpload> {
  const isVideo = file.type === "video/mp4" || file.type === "video/webm";
  const isGif = file.type === "image/gif";
  if (!isVideo && !file.type.startsWith("image/")) {
    throw new Error("יש לבחור תמונה, GIF או סרטון MP4 / WebM");
  }

  let upload: {
    file: Blob;
    extension: string;
    type: string;
    width: number | null;
    height: number | null;
  };
  if (isVideo) {
    if (file.size > BANNER_LIMITS.videoMb * 1024 * 1024) {
      throw new Error(`גודל הסרטון המקסימלי הוא ${BANNER_LIMITS.videoMb}MB`);
    }
    const info = await readVideoInfo(file);
    if (
      !Number.isFinite(info.duration) ||
      info.duration > BANNER_LIMITS.videoSeconds + VIDEO_SECONDS_TOLERANCE
    ) {
      throw new Error(
        `הסרטון ארוך מדי (${Number.isFinite(info.duration) ? info.duration.toFixed(1) : "?"} שניות) — עד ${BANNER_LIMITS.videoSeconds} שניות, כמו זמן ההחלפה בין הבאנרים`,
      );
    }
    upload = {
      file,
      extension: file.type === "video/webm" ? "webm" : "mp4",
      type: file.type,
      width: info.width || null,
      height: info.height || null,
    };
  } else if (isGif) {
    // GIF עולה כמו שהוא — דחיסה/המרה לתמונה רגילה מוחקת את התנועה
    if (file.size > BANNER_LIMITS.gifMb * 1024 * 1024) {
      throw new Error(`גודל ה-GIF המקסימלי הוא ${BANNER_LIMITS.gifMb}MB`);
    }
    const size = await readImageSize(file);
    upload = { file, extension: "gif", type: "image/gif", width: size.width, height: size.height };
  } else {
    if (file.size > BANNER_LIMITS.imageMb * 1024 * 1024) {
      throw new Error(`גודל התמונה המקסימלי הוא ${BANNER_LIMITS.imageMb}MB`);
    }
    const compressed =
      device === "desktop"
        ? await compressDesktopBannerImage(file)
        : await compressMobileBannerImage(file);
    upload = {
      file: compressed.file,
      extension: compressed.extension,
      type: compressed.file.type,
      width: compressed.width ?? null,
      height: compressed.height ?? null,
    };
  }

  const path = `site/banners/${device}-${Date.now()}-${Math.round(Math.random() * 1e6)}.${upload.extension}`;
  const { error } = await supabase.storage.from(BRANDING_BUCKET).upload(path, upload.file, {
    upsert: false,
    contentType: upload.type,
    cacheControl: "31536000",
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, width: upload.width, height: upload.height };
}

/** מחיקת קבצי באנר שכבר לא בשימוש (אחרי שמירה). שגיאה כאן לא מפילה את השמירה. */
export async function removeBannerFiles(urls: string[]): Promise<void> {
  const marker = `/${BRANDING_BUCKET}/`;
  const paths = urls
    .map((url) => {
      const index = url.indexOf(marker);
      return index === -1 ? null : decodeURIComponent(url.slice(index + marker.length));
    })
    .filter((path): path is string => path !== null && path.startsWith("site/banners/"));
  if (paths.length === 0) return;
  await supabase.storage.from(BRANDING_BUCKET).remove(paths);
}

export function bannerUrls(set: BannerSet): Set<string> {
  const urls = new Set<string>();
  for (const slide of [...set.top, ...set.bottom]) {
    if (slide.desktop_image_url) urls.add(slide.desktop_image_url);
    if (slide.mobile_image_url) urls.add(slide.mobile_image_url);
  }
  return urls;
}
