// כפתור הנגישות הצף בכל עמודי האתר: מגירה עם העדפות תצוגה (גודל טקסט, ניגודיות, הדגשת קישורים,
// ריווח, עצירת אנימציות, סמן, ניווט מקלדת, איפוס). נשמר בדפדפן, נפתח גם ב-Alt+A.
// כלי העדפות בלבד: לא משנה תוכן ולא ARIA, ואינו אישור שהאתר עומד בתקן — ההנגשה עצמה בקוד האתר.
// מיקום: בפינה בצד ההתחלה (ימין בעברית); בטלפון, בעמודים עם שורת הפעולות הקבועה — מעליה, כך שלא
// יסתיר את כפתור ההזמנה או את החיוג.
import { Link, useLocation } from "@tanstack/react-router";
import {
  Accessibility,
  AlignJustify,
  Contrast,
  Keyboard,
  LetterText,
  Link2,
  Minus,
  MousePointer2,
  Pause,
  Plus,
  RotateCcw,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useId, useState } from "react";
import { cn } from "@/platform/ui";
import { a11yStore, useA11yPrefs } from "../a11y/store";
import { TEXT_STEPS, isAnyActive, stepText, type A11yToggle } from "../a11y/prefs";
import { useCopy } from "../copy";
import { hasActionBar } from "../lib/action-bar";
import { useSite } from "../lib/site-context";
import { themeStyle } from "../theme/themes";
import {
  SidePanel,
  SidePanelClose,
  SidePanelContent,
  SidePanelDescription,
  SidePanelTitle,
  SidePanelTrigger,
} from "./SidePanel";

const TOGGLES: { key: A11yToggle; icon: LucideIcon }[] = [
  { key: "contrast", icon: Contrast },
  { key: "links", icon: Link2 },
  { key: "lines", icon: AlignJustify },
  { key: "spacing", icon: LetterText },
  { key: "motion", icon: Pause },
  { key: "cursor", icon: MousePointer2 },
  { key: "focus", icon: Keyboard },
];

/** קיצור המקלדת Alt+A (לפי מיקום המקש — גם בפריסה עברית ובמק); לא בזמן הקלדה בשדה */
function isShortcut(e: KeyboardEvent): boolean {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== "KeyA") return false;
  const el = e.target instanceof HTMLElement ? e.target : null;
  return !(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

export function AccessibilityWidget() {
  const t = useCopy();
  const { theme, design } = useSite();
  const { pathname } = useLocation();
  const prefs = useA11yPrefs();
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const textLabel = useId();

  // רשת ביטחון: אם הסקריפט המוקדם לא רץ (אחסון חסום, תצוגה מקדימה) — מחילים אחרי הטעינה
  useEffect(() => a11yStore.reapply(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const min = prefs.text === TEXT_STEPS[0];
  const max = prefs.text === TEXT_STEPS[TEXT_STEPS.length - 1];
  const size = (dir: 1 | -1) => {
    if ((dir < 0 && min) || (dir > 0 && max)) return;
    a11yStore.set({ text: stepText(prefs.text, dir) });
    setAnnounce("");
  };

  return (
    <SidePanel open={open} onOpenChange={setOpen}>
      <SidePanelTrigger
        className={cn(
          "fixed start-3 z-40 inline-flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-background transition-transform hover:scale-105 focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none sm:start-5 print:hidden",
          hasActionBar(pathname)
            ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-6"
            : "bottom-4 sm:bottom-6",
        )}
        aria-label={t.a11y.open}
        aria-keyshortcuts="Alt+A"
        data-testid="a11y-trigger"
      >
        <Accessibility className="size-7" aria-hidden="true" />
        {isAnyActive(prefs) && (
          <span
            className="absolute -end-0.5 -top-0.5 size-3.5 rounded-full bg-[var(--site-gold)] ring-2 ring-background"
            aria-hidden="true"
          />
        )}
      </SidePanelTrigger>
      <SidePanelContent
        closeLabel={t.a11y.close}
        dir={t.dir}
        lang={t.locale}
        style={themeStyle(theme, design.colors[theme.id], design.fonts?.[theme.id])}
        data-testid="a11y-panel"
      >
        <div className="border-b border-border px-6 pt-5 pb-4 pe-16">
          <SidePanelTitle className="font-display text-2xl font-medium">
            {t.a11y.title}
          </SidePanelTitle>
          <SidePanelDescription className="mt-1 text-sm text-muted-foreground">
            {t.a11y.intro}
          </SidePanelDescription>
        </div>
        <div className="flex-1 space-y-5 px-4 py-5">
          <div
            role="group"
            aria-labelledby={textLabel}
            className="rounded-md border border-border px-3 py-3"
          >
            <p id={textLabel} className="mb-2 flex items-center gap-2 text-base font-medium">
              <Type className="size-5 shrink-0" aria-hidden="true" />
              {t.a11y.textSize}
            </p>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => size(-1)}
                aria-disabled={min}
                aria-label={t.a11y.smaller}
                className="inline-flex size-11 items-center justify-center rounded-sm border border-border hover:bg-muted aria-disabled:opacity-50"
                data-testid="a11y-text-smaller"
              >
                <Minus className="size-5" aria-hidden="true" />
              </button>
              <output
                aria-live="polite"
                className="min-w-16 text-center text-lg tabular-nums"
                data-testid="a11y-text-value"
              >
                {prefs.text}%
              </output>
              <button
                type="button"
                onClick={() => size(1)}
                aria-disabled={max}
                aria-label={t.a11y.larger}
                className="inline-flex size-11 items-center justify-center rounded-sm border border-border hover:bg-muted aria-disabled:opacity-50"
                data-testid="a11y-text-larger"
              >
                <Plus className="size-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <ul className="space-y-2">
            {TOGGLES.map(({ key, icon: Icon }) => (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={prefs[key]}
                  onClick={() => {
                    a11yStore.set({ [key]: !prefs[key] });
                    setAnnounce("");
                  }}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2 text-start text-base transition-colors",
                    prefs[key]
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted",
                  )}
                  data-a11y-toggle={key}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{t.a11y[key]}</span>
                  {/* המצב לעין; לקורא המסך — aria-pressed */}
                  <span className="text-sm" aria-hidden="true">
                    {prefs[key] ? t.a11y.on : t.a11y.off}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => {
              a11yStore.reset();
              setAnnounce(t.a11y.resetDone);
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-sm px-2 text-base font-medium underline-offset-4 hover:underline"
            data-testid="a11y-reset"
          >
            <RotateCcw className="size-5" aria-hidden="true" />
            {t.a11y.reset}
          </button>
          <p role="status" className="sr-only">
            {announce}
          </p>

          <div className="rounded-md bg-muted px-3 py-3">
            <h3 className="mb-2 text-base font-medium">{t.a11y.keysTitle}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              {t.a11y.keys.map(([key, what]) => (
                <Fragment key={key}>
                  <dt>
                    <kbd
                      dir="ltr"
                      className="rounded border border-border bg-background px-1.5 py-0.5 font-sans text-xs"
                    >
                      {key}
                    </kbd>
                  </dt>
                  <dd>{what}</dd>
                </Fragment>
              ))}
            </dl>
          </div>

          <div className="space-y-2 border-t border-border pt-4 text-sm">
            <p>{t.a11y.note}</p>
            <SidePanelClose asChild>
              <Link
                to="/stay/accessibility"
                className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
              >
                {t.a11y.statement}
              </Link>
            </SidePanelClose>
          </div>
        </div>
      </SidePanelContent>
    </SidePanel>
  );
}
