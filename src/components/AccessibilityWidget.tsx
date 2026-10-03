import { useEffect, useRef, useState } from "react";
import {
  Accessibility,
  Contrast,
  Link2,
  MousePointerClick,
  RotateCcw,
  Type,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

type A11ySettings = {
  fontStep: 0 | 1 | 2 | 3; // 100% / 112.5% / 125% / 140%
  contrast: "normal" | "high" | "invert";
  links: boolean;
  focus: boolean;
};

const DEFAULTS: A11ySettings = { fontStep: 0, contrast: "normal", links: false, focus: false };
const FONT_STEPS = ["100%", "112.5%", "125%", "140%"] as const;
const STORAGE_KEY = "a11y-settings-v1";

function loadSettings(): A11ySettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<A11ySettings>;
    return {
      fontStep: ([0, 1, 2, 3] as const).includes(parsed.fontStep as 0)
        ? (parsed.fontStep as A11ySettings["fontStep"])
        : 0,
      contrast:
        parsed.contrast === "high" || parsed.contrast === "invert" ? parsed.contrast : "normal",
      links: parsed.links === true,
      focus: parsed.focus === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function applySettings(settings: A11ySettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.fontSize = settings.fontStep === 0 ? "" : FONT_STEPS[settings.fontStep];
  root.classList.toggle("a11y-contrast", settings.contrast === "high");
  root.classList.toggle("a11y-invert", settings.contrast === "invert");
  root.classList.toggle("a11y-links", settings.links);
  root.classList.toggle("a11y-focus", settings.focus);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* מצב פרטי / אחסון חסום — ההגדרות יחזיקו לרענון בלבד */
  }
}

/**
 * רכיב נגישות צף (תקן WCAG 2.0 AA): גודל טקסט, ניגודיות/צבעים נגדיים,
 * הדגשת קישורים וניווט מקלדת ברור. ההעדפות נשמרות בדפדפן.
 */
export function AccessibilityWidget() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<A11ySettings>(DEFAULTS);
  const panelRef = useRef<HTMLDivElement>(null);

  // טעינה והחלה בעליית הדף (אחרי hydration בלבד)
  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    applySettings(loaded);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const update = (patch: Partial<A11ySettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      applySettings(next);
      return next;
    });
  };

  const isDefault =
    settings.fontStep === 0 && settings.contrast === "normal" && !settings.links && !settings.focus;

  return (
    // --a11y-bottom: עמוד עם סרגל פעולות קבוע בתחתית (עמוד השליח) מרים את הכפתור מעליו
    <div
      dir="rtl"
      className="fixed bottom-[var(--a11y-bottom,1rem)] right-4 z-[60] flex flex-col items-end print:hidden"
    >
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="תפריט נגישות"
          className="mb-2 w-72 rounded-2xl border border-border bg-card p-4 text-right shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 font-bold text-foreground">
              <Accessibility className="size-4" aria-hidden="true" />
              נגישות
            </p>
            <Button
              size="sm"
              variant="ghost"
              aria-label="סגירת תפריט הנגישות"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="space-y-3 text-sm">
            <div>
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                <Type className="size-3.5" aria-hidden="true" /> גודל טקסט
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="הקטנת טקסט"
                  disabled={settings.fontStep === 0}
                  onClick={() =>
                    update({
                      fontStep: Math.max(0, settings.fontStep - 1) as A11ySettings["fontStep"],
                    })
                  }
                >
                  א-
                </Button>
                <span className="min-w-14 text-center tabular-nums" aria-live="polite">
                  {FONT_STEPS[settings.fontStep]}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="הגדלת טקסט"
                  disabled={settings.fontStep === 3}
                  onClick={() =>
                    update({
                      fontStep: Math.min(3, settings.fontStep + 1) as A11ySettings["fontStep"],
                    })
                  }
                >
                  א+
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                <Contrast className="size-3.5" aria-hidden="true" /> ניגודיות
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { value: "normal", label: "רגילה" },
                    { value: "high", label: "גבוהה" },
                    { value: "invert", label: "נגדית" },
                  ] as const
                ).map((option) => (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={settings.contrast === option.value ? "default" : "outline"}
                    aria-pressed={settings.contrast === option.value}
                    onClick={() => update({ contrast: option.value })}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-medium">
                <Link2 className="size-3.5" aria-hidden="true" /> הדגשת קישורים
              </span>
              <input
                type="checkbox"
                checked={settings.links}
                onChange={(event) => update({ links: event.target.checked })}
                className="size-4 accent-primary"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-medium">
                <MousePointerClick className="size-3.5" aria-hidden="true" /> ניווט מקלדת ברור
              </span>
              <input
                type="checkbox"
                checked={settings.focus}
                onChange={(event) => update({ focus: event.target.checked })}
                className="size-4 accent-primary"
              />
            </label>

            <div className="flex items-center justify-between border-t border-border pt-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={isDefault}
                onClick={() => update({ ...DEFAULTS })}
              >
                <RotateCcw className="size-3.5" />
                איפוס
              </Button>
              <Link
                to="/about"
                hash="accessibility"
                className="text-xs text-primary underline underline-offset-2"
                onClick={() => setOpen(false)}
              >
                הצהרת נגישות
              </Link>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        aria-label={open ? "סגירת תפריט הנגישות" : "פתיחת תפריט הנגישות"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex size-12 items-center justify-center rounded-full border-2 border-primary-foreground/20 bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Accessibility className="size-6" aria-hidden="true" />
      </button>
    </div>
  );
}
