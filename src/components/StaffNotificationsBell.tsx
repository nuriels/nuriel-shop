import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Bell, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

const POLL_MS = 30_000;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק'`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע'`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

/** פעמון התראות לצוות (סוכן/מנהל): לקוח חדש שויך + הזמנה חדשה */
export function StaffNotificationsBell({ userId }: { userId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("staff_notifications")
      .select("id, kind, title, body, link, is_read, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data as NotificationRow[] | null) ?? []);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, userId]);

  const unreadCount = items.filter((i) => !i.is_read).length;

  const markRead = async (id: string) => {
    setItems((current) => current.map((i) => (i.id === id ? { ...i, is_read: true } : i)));
    await supabase.from("staff_notifications").update({ is_read: true }).eq("id", id);
  };

  const markAllRead = async () => {
    const unreadIds = items.filter((i) => !i.is_read).map((i) => i.id);
    if (unreadIds.length === 0) return;
    setItems((current) => current.map((i) => ({ ...i, is_read: true })));
    await supabase.from("staff_notifications").update({ is_read: true }).in("id", unreadIds);
  };

  const open_ = (item: NotificationRow) => {
    setOpen(false);
    if (!item.is_read) void markRead(item.id);
    if (item.link) void router.navigate({ to: item.link });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex size-10 items-center justify-center rounded-md text-primary-foreground/85 transition-colors hover:bg-white/10 hover:text-primary-foreground"
          aria-label="התראות"
        >
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute left-1 top-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" align="end" className="w-80 p-0 text-right">
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-sm font-bold">התראות</span>
          {unreadCount > 0 && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={markAllRead}>
              <Check className="size-3.5" />
              סימון הכול כנקרא
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">אין התראות</p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => open_(item)}
                className={`flex w-full flex-col gap-0.5 border-b border-border p-3 text-right transition-colors last:border-0 hover:bg-secondary ${
                  item.is_read ? "" : "bg-secondary/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  {!item.is_read && <span className="size-1.5 shrink-0 rounded-full bg-accent" />}
                  <span className="flex-1 truncate text-sm font-medium">{item.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {timeAgo(item.created_at)}
                  </span>
                </div>
                {item.body && (
                  <p className="truncate text-xs text-muted-foreground">{item.body}</p>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
