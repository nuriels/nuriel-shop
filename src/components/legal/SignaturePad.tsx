import { useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

/** לוח חתימה: אוסף את קווי העכבר/המגע ושומר אותם כ-SVG */
export function SignaturePad({ onChange }: { onChange: (svg: string | null) => void }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  const point = (event: React.PointerEvent) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.round(((event.clientX - rect.left) / rect.width) * 600);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * 200);
    return `${x},${y}`;
  };

  const emit = (allStrokes: string[]) => {
    if (allStrokes.length === 0) {
      onChange(null);
      return;
    }
    const paths = allStrokes.map(
      (d) =>
        `<path d="${d}" fill="none" stroke="#12211F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    onChange(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200">${paths.join("")}</svg>`,
    );
  };

  return (
    <div className="space-y-2">
      <div
        ref={areaRef}
        role="application"
        aria-label="אזור חתימה"
        className="relative h-40 touch-none rounded-lg border-2 border-dashed border-border bg-card"
        onPointerDown={(event) => {
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          const p = point(event);
          if (p) setCurrent(`M${p}`);
        }}
        onPointerMove={(event) => {
          if (current === null) return;
          const p = point(event);
          if (p) setCurrent(`${current} L${p}`);
        }}
        onPointerUp={() => {
          if (current === null) return;
          const next = [...strokes, current];
          setStrokes(next);
          setCurrent(null);
          emit(next);
        }}
      >
        <svg viewBox="0 0 600 200" className="pointer-events-none absolute inset-0 size-full">
          {[...strokes, ...(current ? [current] : [])].map((d, index) => (
            <path
              key={index}
              d={d}
              fill="none"
              stroke="currentColor"
              className="text-foreground"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        {strokes.length === 0 && current === null && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            חתמו כאן באצבע או בעכבר
          </span>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setStrokes([]);
          setCurrent(null);
          onChange(null);
        }}
      >
        <Eraser className="size-4" />
        ניקוי החתימה
      </Button>
    </div>
  );
}
