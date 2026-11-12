// לוח חתימה: ציור באצבע או בעכבר (Pointer Events), נשמר כקווים בלבד בתוך 600×200 — אותו כלל כמו
// במסד. ולמי שלא יכול לצייר (נגישות — WCAG 2.5.1: פעולה בתנועה צריכה חלופה) — חתימה בהקלדת השם המלא.
// בטלפון הלוח גבוה יותר (3:2 במקום 3:1) — מקום נוח לאצבע: המסך ממופה לתחום 600×200 בקנה מידה אחיד
// (כמו "slice" בתצוגה), כך שהחתימה נשמרת בפרופורציות שלה, ממורכזת, ותמיד בתוך התחום שהמסד בודק.
// קו ארוך מאוד מתפצל לשני קווים (המסד מגביל אורך של קו אחד).
import { Eraser, PenLine, Type } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button, Input, Label, cn } from "@/platform/ui";
import {
  SIGNATURE_HEIGHT,
  SIGNATURE_MAX_PATHS,
  SIGNATURE_WIDTH,
  clampPoint,
  validSignaturePaths,
  type ContractSignature,
} from "./signature";

/** אורך קו (בתווים) שאחריו הוא מתפצל; המסד מקבל עד 8000 לקו */
const STROKE_SPLIT = 7000;
const STROKE_MAX = 7900;

export function SignaturePad({
  onChange,
  allowTyped = true,
  label = "החתימה",
  testId = "signature-pad",
}: {
  onChange: (signature: ContractSignature | null) => void;
  allowTyped?: boolean;
  label?: string;
  testId?: string;
}) {
  const id = useId();
  const area = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [strokes, setStrokes] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const point = (e: React.PointerEvent) => {
    const r = area.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    // קנה מידה אחיד: כל הלוח נכנס ל-600×200 (בלוח 3:1 — בדיוק כמו קודם), ממורכז
    const k = Math.min(SIGNATURE_WIDTH / r.width, SIGNATURE_HEIGHT / r.height);
    return clampPoint(
      (SIGNATURE_WIDTH - r.width * k) / 2 + (e.clientX - r.left) * k,
      (SIGNATURE_HEIGHT - r.height * k) / 2 + (e.clientY - r.top) * k,
    );
  };
  const emit = (all: string[]) =>
    onChange(validSignaturePaths(all) ? { kind: "drawn", paths: all } : null);
  const clear = () => {
    setStrokes([]);
    setCurrent(null);
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium" id={`${id}-label`}>
          {label}
        </span>
        {allowTyped && (
          <div role="radiogroup" aria-label="אופן החתימה" className="flex gap-1">
            {(
              [
                ["draw", "ציור", PenLine],
                ["type", "הקלדת השם", Type],
              ] as const
            ).map(([m, text, Icon]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => {
                  setMode(m);
                  onChange(
                    m === "draw"
                      ? validSignaturePaths(strokes)
                        ? { kind: "drawn", paths: strokes }
                        : null
                      : typed.trim().length >= 2
                        ? { kind: "typed", name: typed.trim() }
                        : null,
                  );
                }}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm",
                  mode === m
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {text}
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === "draw" ? (
        <>
          <div
            ref={area}
            role="img"
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-hint`}
            data-testid={`${testId}-area`}
            className="relative aspect-[3/2] max-h-64 w-full touch-none rounded-lg border-2 border-dashed border-border bg-white select-none sm:aspect-[3/1] sm:max-h-none"
            onPointerDown={(e) => {
              if (strokes.length >= SIGNATURE_MAX_PATHS) return;
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              const p = point(e);
              if (p) setCurrent(`M${p}`);
            }}
            onPointerMove={(e) => {
              if (current === null) return;
              const p = point(e);
              if (!p || current.endsWith(p)) return;
              if (current.length > STROKE_SPLIT && strokes.length < SIGNATURE_MAX_PATHS - 1) {
                // קו ארוך — נסגר כאן וממשיך כקו חדש מאותה נקודה
                setStrokes([...strokes, `${current} L${p}`]);
                setCurrent(`M${p}`);
              } else if (current.length < STROKE_MAX) setCurrent(`${current} L${p}`);
            }}
            onPointerUp={() => {
              if (current === null) return;
              // נקודה בודדת (הקשה) — לא קו
              const next = current.includes(" L") ? [...strokes, current] : strokes;
              setStrokes(next);
              setCurrent(null);
              emit(next);
            }}
            onPointerCancel={() => setCurrent(null)}
          >
            <svg
              viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`}
              preserveAspectRatio="xMidYMid slice"
              className="pointer-events-none absolute inset-0 size-full"
              aria-hidden="true"
            >
              {[...strokes, ...(current ? [current] : [])].map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="#12211F"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </svg>
            {strokes.length === 0 && !current && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                חתמו כאן באצבע או בעכבר
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {allowTyped ? 'קשה לצייר? אפשר לבחור "הקלדת השם".' : "חתמו בתוך המסגרת."}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-10 gap-1.5"
              onClick={clear}
            >
              <Eraser className="size-4" aria-hidden="true" />
              ניקוי
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-typed`}>השם המלא כחתימה</Label>
          <Input
            id={`${id}-typed`}
            value={typed}
            maxLength={80}
            autoComplete="name"
            className="min-h-11 text-lg"
            onChange={(e) => {
              setTyped(e.target.value);
              const v = e.target.value.trim();
              onChange(v.length >= 2 ? { kind: "typed", name: v } : null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            הקלדת השם המלא כאן היא חתימה אלקטרונית על ההסכם, בדיוק כמו חתימה בציור.
          </p>
        </div>
      )}
    </div>
  );
}

/** חתימה שמורה (לתצוגה): הקווים כ-SVG */
export function SignatureImage({ paths, className }: { paths: string[]; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`}
      className={className}
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="#12211F"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
