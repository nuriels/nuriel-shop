// סרטון הפתיח: הסרטון מתנגן (בלי קול, inline בטלפון) → בסופו התמונה הראשית 5 שניות → שוב הסרטון,
// וחוזר חלילה. התמונה תמיד מתחת לסרטון: עד שהסרטון מתחיל לרוץ באמת (playing), בזמן ההפסקה, בזמן
// טעינה איטית או תקיעה, ובכל תקלה — רואים את התמונה, אף פעם לא מסך ריק.
//   • הפעלה: play() מיד בטעינה (באייפון הדפדפן לא טוען נתונים בלי play — לא מחכים ל-canplaythrough).
//   • חסימת הפעלה אוטומטית (חיסכון בסוללה באייפון, הגדרת דפדפן): התמונה, וכפתור ההפעלה מפעיל ידנית.
//   • שגיאה / פורמט שהדפדפן לא מנגן (למשל HEVC בחלק מהמכשירים): רק התמונה, בלי כפתור.
//   • כפתור עצירה תמיד ליד הסרטון (IS 5568 / WCAG 2.2.2): עצירה → התמונה; הפעלה → הסרטון מההתחלה.
//   • הלשונית ברקע / הפתיח מחוץ למסך: הסרטון והטיימר נעצרים, וממשיכים כשחוזרים.
//   • בלי סרטון בכלל — רק התמונה: "עצירת אנימציות" בכפתור הנגישות, תנועה מופחתת במערכת ההפעלה,
//     חיסכון בנתונים או רשת איטית מאוד. במצבים האלה הסרטון לא נטען בכלל (וגם לא בשרת).
//   • מעבר לעמוד אחר: הטעינה נעצרת (src מוסר); חזרה לעמוד — מתחיל שוב מהסרטון.
//   • גבול האורך גם בנגן: סיבוב לא עובר 15.5 שניות (15 + הסובלנות), גם אם הקובץ באחסון הוחלף
//     אחרי שהשרת מדד אותו — בגבול עוברים לתמונה, כמו בסוף הסרטון.
// הסרטון עצמו דקורטיבי (aria-hidden): התוכן והתמונה עם הטקסט החלופי נשארים מתחתיו.
import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/platform/ui";
import { heroPlaybackOverLimit } from "../../media/video-info";
import type { PublicMedia } from "../../types/website";
import { prefersReducedMotion } from "../a11y/prefs";
import { useA11yPrefs } from "../a11y/store";
import { useCopy } from "../copy";

/** כמה זמן התמונה הראשית מוצגת בין סיבוב לסיבוב של הסרטון */
export const HERO_IMAGE_MS = 5000;
/** תקיעה באמצע (רשת איטית) — אחרי כמה זמן חוזרים לתמונה עד שהסרטון ממשיך */
const STALL_MS = 2500;

/** loading — מחכים שהסרטון יתחיל; playing — רץ ומוצג; resting — התמונה בין הסיבובים;
 *  stopped — נעצר בכפתור; blocked — הדפדפן חסם הפעלה אוטומטית (הכפתור מפעיל); failed — רק התמונה */
export type HeroVideoPhase = "loading" | "playing" | "resting" | "stopped" | "blocked" | "failed";

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
  const [phase, setPhase] = useState<HeroVideoPhase>("loading");
  const [stalled, setStalled] = useState(false);
  const [cycles, setCycles] = useState(0);
  // הלשונית ברקע / הפתיח מחוץ למסך — עצירה זמנית (לא של המשתמש)
  const [hidden, setHidden] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const suspended = hidden || offscreen;
  const restTimer = useRef<number | null>(null);
  const stallTimer = useRef<number | null>(null);
  // הסיבוב נגמר פעם אחת בלבד — בסוף הקובץ או בגבול האורך, גם אם שני האירועים מגיעים יחד
  const roundOver = useRef(false);

  useEffect(() => {
    const decide = () => setAllowed(!prefersReducedMotion() && !slowConnection());
    decide();
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    mq?.addEventListener?.("change", decide);
    return () => mq?.removeEventListener?.("change", decide);
  }, [motion]);

  const clearTimers = useCallback(() => {
    if (restTimer.current !== null) window.clearTimeout(restTimer.current);
    if (stallTimer.current !== null) window.clearTimeout(stallTimer.current);
    restTimer.current = null;
    stallTimer.current = null;
  }, []);

  /** play() — דחייה: חסימה אוטומטית (NotAllowedError) או פורמט לא נתמך; AbortError (נקטע בעצירה) — כלום */
  const start = useCallback((fromStart: boolean) => {
    const v = ref.current;
    if (!v) return;
    // בלי קול — גם כמאפיין וגם כתכונה (חלק מהדפדפנים בודקים את התכונה לפני הפעלה אוטומטית)
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    if (fromStart && v.currentTime > 0) v.currentTime = 0;
    roundOver.current = false;
    v.play().catch((error: unknown) => {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "AbortError") return;
      setPhase(name === "NotAllowedError" ? "blocked" : "failed");
    });
  }, []);

  /** סוף הסיבוב → התמונה הראשית (ואחרי 5 שניות — שוב הסרטון) */
  const finishRound = useCallback(() => {
    if (roundOver.current) return;
    roundOver.current = true;
    setCycles((n) => n + 1);
    setStalled(false);
    setPhase((p) => (p === "playing" || p === "loading" ? "resting" : p));
  }, []);

  // ההתחלה: מיד כשמותר (בלי לחכות 5 שניות — הסרטון קודם, התמונה אחריו)
  useEffect(() => {
    if (!allowed) return;
    setPhase("loading");
    start(true);
  }, [allowed, start]);

  // ברקע / מחוץ למסך — עוצרים הכל; חוזרים — ממשיכים מאותו שלב
  useEffect(() => {
    const v = ref.current;
    if (!allowed || !v) return;
    if (suspended) {
      clearTimers();
      if (!v.paused) v.pause();
      return;
    }
    if (phase === "playing" || phase === "loading") start(false);
    if (phase === "resting") {
      restTimer.current = window.setTimeout(() => {
        restTimer.current = null;
        setPhase("loading");
        start(true);
      }, HERO_IMAGE_MS);
    }
    return clearTimers;
  }, [allowed, suspended, phase, start, clearTimers]);

  useEffect(() => {
    if (!allowed) return;
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    const v = ref.current;
    let observer: IntersectionObserver | null = null;
    if (v && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setOffscreen(!entry.isIntersecting);
      });
      observer.observe(v);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, [allowed]);

  // יציאה מהעמוד: לעצור ולשחרר את הטעינה (בלי להמשיך להוריד ברקע)
  useEffect(() => {
    const v = ref.current;
    return () => {
      clearTimers();
      if (v) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
    };
  }, [allowed, clearTimers]);

  if (!video.url || !allowed || phase === "failed") return null;

  const visible = phase === "playing" && !stalled && !suspended;
  const userStopped = phase === "stopped" || phase === "blocked";
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (userStopped) {
      setPhase("loading");
      start(true);
    } else {
      clearTimers();
      setStalled(false);
      v.pause();
      setPhase("stopped");
    }
  };

  return (
    <>
      <video
        ref={ref}
        src={video.url}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
        data-hero-video={stalled && phase === "playing" ? "stalled" : phase}
        data-hero-cycles={cycles}
        onPlaying={() => {
          if (stallTimer.current !== null) window.clearTimeout(stallTimer.current);
          stallTimer.current = null;
          setStalled(false);
          setPhase((p) => (p === "stopped" || p === "blocked" ? p : "playing"));
        }}
        onWaiting={() => {
          if (stallTimer.current !== null) return;
          stallTimer.current = window.setTimeout(() => {
            stallTimer.current = null;
            setStalled(true);
          }, STALL_MS);
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.paused || !heroPlaybackOverLimit(v.currentTime, v.duration)) return;
          v.pause();
          finishRound();
        }}
        onEnded={finishRound}
        onError={() => setPhase("failed")}
        className={cn(
          "pointer-events-none object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none",
          visible ? "opacity-100" : "opacity-0",
          className,
        )}
      />
      <button
        type="button"
        aria-pressed={userStopped}
        onClick={toggle}
        data-testid="hero-video-toggle"
        className={cn(
          "absolute bottom-4 end-4 z-10 inline-flex size-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
          buttonClassName,
        )}
      >
        {userStopped ? (
          <Play className="size-5" aria-hidden="true" />
        ) : (
          <Pause className="size-5" aria-hidden="true" />
        )}
        <span className="sr-only">{t.hero.stopVideo}</span>
      </button>
    </>
  );
}
