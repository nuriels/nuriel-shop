// מגירת צד של האתר (תפריט הנייד, תפריט הנגישות) על Radix Dialog: מלכודת פוקוס, Esc סוגר, הפוקוס
// חוזר לכפתור שפתח, ושאר העמוד מוסתר מקורא המסך בזמן שהמגירה פתוחה. נפתחת מצד ההתחלה (ימין בעברית).
// כפתור הסגירה עם שם בעברית ובצד השני של הכותרת — ה-Sheet המשותף אומר "Close" לקורא המסך ויושב
// מעל תחילת הכותרת, והוא של החנויות, ולכן לא משנים אותו.
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { CSSProperties, ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/platform/ui";

export const SidePanel = Dialog.Root;
export const SidePanelTrigger = Dialog.Trigger;
export const SidePanelClose = Dialog.Close;
export const SidePanelTitle = Dialog.Title;
export const SidePanelDescription = Dialog.Description;

export function SidePanelContent({
  closeLabel,
  className,
  style,
  children,
  ...props
}: {
  closeLabel: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<typeof Dialog.Content>, "className" | "style" | "children">) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <Dialog.Content
        // מחוץ למעטפת האתר: משתני הערכה מגיעים ב-style, ו-data-site-vars מחבר אותם לניגודיות הגבוהה
        data-site-vars=""
        style={style}
        className={cn(
          "fixed inset-y-0 start-0 z-50 flex h-full w-[88vw] max-w-sm flex-col overflow-y-auto bg-background text-foreground shadow-xl outline-none",
          "data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=open]:duration-300",
          "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          className,
        )}
        {...props}
      >
        {/* ראשון בסדר הקריאה והמקלדת (והפוקוס בפתיחה), בפינה שמול הכותרת */}
        <Dialog.Close
          className="absolute end-3 top-3 z-10 inline-flex size-11 items-center justify-center rounded-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={closeLabel}
        >
          <X className="size-5" aria-hidden="true" />
        </Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
