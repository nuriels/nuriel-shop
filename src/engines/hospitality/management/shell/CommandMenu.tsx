// חיפוש מהיר באזור הניהול (שלב F2b): Ctrl+K / ⌘K או כפתור החיפוש. מעבר לכל מסך שמותר למשתמש,
// פעולות ("הזמנה חדשה", "חסימת תאריכים"…), וחיפוש הזמנה לפי מספר / שם / טלפון / אימייל
// (פותח את מסך ההזמנות עם החיפוש). רק מסכים ופעולות שמותרים — ההרשאה עצמה נאכפת במסד.
import { useNavigate } from "@tanstack/react-router";
import { Ban, BedDouble, CalendarPlus, LifeBuoy, Search } from "lucide-react";
import { useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/platform/ui";
import type { NavItem } from "../lib/nav";
import { useManagement } from "./management-context";
import { NAV_ICONS } from "./nav-icons";

export function CommandMenu({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: NavItem[];
}) {
  const ctx = useManagement();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const q = text.trim();
  const go = (fn: () => void) => {
    onOpenChange(false);
    setText("");
    fn();
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {/* כפתור הסגירה של החלון יושב בפינה הימנית — מרחיקים ממנו את אייקון החיפוש (RTL) */}
      <div dir="rtl" className="[&_[cmdk-input-wrapper]]:ps-11">
        <CommandInput
          placeholder="לאן לעבור? מסך, פעולה או מספר הזמנה…"
          value={text}
          onValueChange={setText}
          aria-label="חיפוש מהיר"
        />
        <CommandList>
          <CommandEmpty>לא נמצא מסך מתאים.</CommandEmpty>
          {ctx.permissions["bookings"] && q.length >= 2 && (
            <>
              <CommandGroup heading="הזמנות">
                <CommandItem
                  value={`חיפוש הזמנות ${q}`}
                  onSelect={() =>
                    go(() => void navigate({ to: "/manage/bookings", search: { q } }))
                  }
                  className="min-h-11 gap-2"
                >
                  <Search className="size-4 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
                  חיפוש &quot;{q}&quot; בהזמנות
                </CommandItem>
              </CommandGroup>
            </>
          )}
          <CommandGroup heading="פעולות">
            {ctx.permissions["bookings"] && (
              <CommandItem
                value="הזמנה חדשה טלפון דלפק"
                onSelect={() => go(() => void navigate({ to: "/manage/bookings/new" }))}
                className="min-h-11 gap-2"
              >
                <CalendarPlus className="size-4 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
                הזמנה חדשה
              </CommandItem>
            )}
            {ctx.permissions["bookings"] && (
              <CommandItem
                value="חסימת תאריכים שיפוץ"
                onSelect={() =>
                  go(() => void navigate({ to: "/manage/calendar", search: { block: "1" } }))
                }
                className="min-h-11 gap-2"
              >
                <Ban className="size-4 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
                חסימת תאריכים
              </CommandItem>
            )}
            {ctx.permissions["catalog"] && (
              <CommandItem
                value="יחידה חדשה הוספת יחידה חדר צימר"
                onSelect={() =>
                  go(() => void navigate({ to: "/manage/units", search: { add: "unit" } }))
                }
                className="min-h-11 gap-2"
              >
                <BedDouble className="size-4 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
                יחידה חדשה
              </CommandItem>
            )}
            {ctx.permissions["settings"] && (
              <CommandItem
                value="פנייה לתמיכה עזרה תקלה שאלה"
                onSelect={() =>
                  go(() => void navigate({ to: "/manage/support", search: { new: "1" } }))
                }
                className="min-h-11 gap-2"
              >
                <LifeBuoy className="size-4 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
                פנייה לתמיכה
              </CommandItem>
            )}
          </CommandGroup>
          <CommandGroup heading="מסכים">
            {items.map((item) => {
              const Icon = NAV_ICONS[item.key];
              return (
                <CommandItem
                  key={item.key}
                  value={`${item.label} ${item.keywords ?? ""}`}
                  onSelect={() => go(() => void navigate({ to: item.to }))}
                  className="min-h-11 gap-2"
                >
                  <Icon className="size-4 text-[var(--hm-lagoon-500)]" aria-hidden="true" />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </div>
    </CommandDialog>
  );
}
