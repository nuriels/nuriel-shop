// מצב הפרסום של האתר — תווית קצרה וטקסט הסבר (משותף לממשק הניהול ולפאנל הפלטפורמה)
import { Badge } from "@/platform/ui";
import type { SiteState } from "../types";

export const STATUS_LABEL: Record<SiteState["status"], string> = {
  draft: "טיוטה — לא פורסם",
  pending_review: "ממתין לאישור פרסום",
  live: "באוויר",
};

export function StatusBadge({ state }: { state: SiteState }) {
  const live = state.status === "live" && state.public_enabled;
  const label =
    state.status === "live" && !state.public_enabled ? "פורסם, מוסתר" : STATUS_LABEL[state.status];
  return (
    <Badge variant={live ? "default" : "secondary"} data-testid="bp-status">
      {label}
    </Badge>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}
