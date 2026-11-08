// סרטון הפתיח (H-1): קודם התמונה — 5 שניות — ואז מעבר רך לסרטון, רק כשהוא נטען מספיק כדי לרוץ
// עד הסוף בלי לעצור (canplaythrough). בלי קול, בלולאה, inline בטלפון.
//   • כפתור עצירה תמיד ליד הסרטון (IS 5568 / WCAG 2.2.2: תנועה שמתחילה לבד ונמשכת יותר מ-5 שניות).
//   • בלי סרטון בכלל — רק התמונה: "עצירת אנימציות" בכפתור הנגישות, תנועה מופחתת במערכת ההפעלה,
//     חיסכון בנתונים או רשת איטית מאוד. הסרטון לא נטען בכלל במצבים האלה (וגם לא בשרת).
//   • שגיאה, פורמט שהדפדפן לא מנגן (למשל HEVC בחלק מהמכשירים) או חסימת הפעלה אוטומטית — התמונה.
// הסרטון עצמו דקורטיבי (aria-hidden): התוכן והתמונה עם הטקסט החלופי נשארים מתחתיו.
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/platform/ui";
import type { PublicMedia } from "../../types/website";
import { prefersReducedMotion } from "../a11y/prefs";
import { useA11yPrefs } from "../a11y/store";
import { useCopy } from "../copy";

/** כמה זמן התמונה לבד לפני המעבר לסרטון */
export const HERO_IMAGE_MS = 5000;

function slowConnection(): boolean {
  const c = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  return Boolean(c?.saveData) || c?.effectiveType === "slow-2g" || c?.effectiveType === "2g";
}

export function HeroVideo({
  video,
  className,
  buttonClassName,
}: {
  video: PublicMedia;
  /** שכבת הסרטון (מעל התמונה, מתחת להכהיה ולטקסט) */
  className?: string | undefined;
  buttonClassName?: string | undefined;
}) {
  const t = useCopy();
  const ref = useRef<HTMLVideoElement>(null);
  const motion = useA11yPrefs().motion;
  // בשרת ובציור הראשון — תמיד התמונה (בלי הבדל בין השרת לדפדפן)
  const [allowed, setAllowed] = useState(false);
  const [due, setDue] = useState(false);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const decide = () => setAllowed(!prefersReducedMotion() && !slowConnection());
    decide();
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    mq?.addEventListener?.("change", decide);
    return () => mq?.removeEventListener?.("change", decide);
  }, [motion]);

  useEffect(() => {
    const id = window.setTimeout(() => setDue(true), HERO_IMAGE_MS);
    return () => window.clearTimeout(id);
  }, []);

  // כבר במטמון (חזרה לעמוד) — ייתכן שאין אירוע canplaythrough חדש
  useEffect(() => {
    if (allowed && (ref.current?.readyState ?? 0) >= 4) setReady(true);
  }, [allowed]);

  const shouldPlay = allowed && !failed && !stopped && due && ready;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (shouldPlay) {
      // play() נדחה כשהדפדפן חוסם הפעלה אוטומטית (למשל מצב חיסכון בסוללה באייפון) — נשארים עם התמונה
      v.play().catch(() => setFailed(true));
    } else if (!v.paused) v.pause();
  }, [shouldPlay]);

  if (!video.url || failed || !allowed) return null;
  const visible = started;
  return (
    <>
      <video
        ref={ref}
        src={video.url}
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
        data-hero-video={visible ? (stopped ? "stopped" : "playing") : "waiting"}
        onCanPlayThrough={() => setReady(true)}
        onPlaying={() => setStarted(true)}
        onError={() => setFailed(true)}
        className={cn(
          "pointer-events-none object-cover transition-opacity duration-1000 ease-out motion-reduce:transition-none",
          visible ? "opacity-100" : "opacity-0",
          className,
        )}
      />
      <button
        type="button"
        aria-pressed={stopped}
        onClick={() => setStopped((s) => !s)}
        data-testid="hero-video-toggle"
        className={cn(
          "absolute bottom-4 end-4 z-10 inline-flex size-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
          buttonClassName,
        )}
      >
        {stopped ? (
          <Play className="size-5" aria-hidden="true" />
        ) : (
          <Pause className="size-5" aria-hidden="true" />
        )}
        <span className="sr-only">{t.hero.stopVideo}</span>
      </button>
    </>
  );
}
