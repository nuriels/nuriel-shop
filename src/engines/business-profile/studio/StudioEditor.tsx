// "עריכת האתר": התצוגה המקדימה של הטיוטה במסגרת בגודל מחשב או נייד. (העורך עצמו — Stage 2.)
import { useState } from "react";
import { Button } from "@/platform/ui";

const SIZES = {
  desktop: { w: "100%", label: "מחשב" },
  mobile: { w: "390px", label: "נייד" },
} as const;

export function StudioEditor() {
  const [size, setSize] = useState<keyof typeof SIZES>("desktop");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">עריכת האתר</h1>
        <div role="group" aria-label="גודל התצוגה" className="flex gap-1">
          {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((k) => (
            <Button
              key={k}
              variant={size === k ? "default" : "outline"}
              size="sm"
              aria-pressed={size === k}
              onClick={() => setSize(k)}
            >
              {SIZES[k].label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex justify-center rounded-lg border bg-background p-2">
        <iframe
          title="תצוגה מקדימה של האתר"
          src="/studio/preview"
          className="h-[78vh] rounded-md border-0 bg-white"
          style={{ width: SIZES[size].w, maxWidth: "100%" }}
        />
      </div>
    </div>
  );
}
