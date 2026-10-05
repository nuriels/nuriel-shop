import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronsUpDown, Crown, Loader2, Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listMyStores,
  switchStore,
  type MyStore,
  type StoreRole,
} from "@/lib/store-switcher.functions";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<StoreRole, string> = {
  admin: "מנהל",
  agent: "סוכן",
  warehouse: "מחסן",
};

/** טעינה אחת לכל המסכים (הכותרת מופיעה בכל עמוד) — לכל משתמש בנפרד */
let cached: { userId: string; stores: MyStore[] } | null = null;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function StoreBadge({ store }: { store: MyStore }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md text-sm font-bold",
        store.isCurrent ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
      )}
    >
      {store.name.trim().charAt(0) || "ח"}
    </span>
  );
}

function StoreLine({ store }: { store: MyStore }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5">
        <span className="truncate font-medium text-foreground">{store.name}</span>
        {store.isOwner && <Crown className="size-3.5 shrink-0 text-amber-500" aria-label="בעלים" />}
        {store.status === "suspended" && (
          <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 text-[10px] font-medium text-destructive">
            מוקפאת
          </span>
        )}
      </span>
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{store.isOwner ? "בעלים" : ROLE_LABEL[store.role]}</span>
        {store.url && (
          <>
            <span aria-hidden="true">·</span>
            <span dir="ltr" className="truncate">
              {hostOf(store.url)}
            </span>
          </>
        )}
      </span>
    </span>
  );
}

/**
 * מחליף החנויות (חלק 18ב) — בכותרת, לאנשי צוות שמשויכים ליותר מחנות אחת.
 * מציג את החנות הנוכחית; בלחיצה — שאר החנויות שלהם. בחירה: פעולת שרת
 * (switchStore) בודקת שוב את השיוך ומחזירה קישור כניסה חד-פעמי לכתובת של
 * החנות האחרת → הדפדפן עובר לשם (טעינה מלאה) ונכנס לניהול שלה — בלי
 * להתחבר מחדש. עם חנות אחת בלבד — לא מוצג כלום.
 */
export function StoreSwitcher({ userId }: { userId: string }) {
  const loadStores = useServerFn(listMyStores);
  const startSwitch = useServerFn(switchStore);
  const [stores, setStores] = useState<MyStore[] | null>(
    cached?.userId === userId ? cached.stores : null,
  );
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadStores()
      .then((list) => {
        cached = { userId, stores: list };
        if (alive) setStores(list);
      })
      .catch(() => {
        // בלי רשימה — פשוט לא מציגים את המחליף (לא חוסם את העמוד)
        if (alive) setStores((current) => current ?? []);
      });
    return () => {
      alive = false;
    };
  }, [loadStores, userId]);

  if (!stores || stores.length < 2) return null;
  const current = stores.find((store) => store.isCurrent) ?? null;
  const others = stores.filter((store) => !store.isCurrent);

  const choose = async (store: MyStore) => {
    if (pending) return;
    setPending(store.id);
    try {
      const { url } = await startSwitch({ data: { tenantId: store.id } });
      // מעבר מלא לכתובת של החנות (רענון) — שם נפתח החיבור ונטען הניהול שלה
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "המעבר לחנות נכשל");
      setPending(null);
    }
  };

  return (
    <DropdownMenu dir="rtl">
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-store-switcher
          disabled={pending !== null}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border border-white/20 bg-white/5 px-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-70 lg:max-w-56 lg:gap-2 lg:px-2.5"
          aria-label={`החנות הנוכחית: ${current?.name ?? "—"}. מעבר לחנות אחרת`}
          title={current?.name}
        >
          {/* מסך צר: האות הראשונה של החנות; מסך רחב: אייקון + השם המלא */}
          <span
            aria-hidden="true"
            className="grid size-6 place-items-center rounded bg-white/90 text-xs font-bold text-primary lg:hidden"
          >
            {current?.name.trim().charAt(0) || "ח"}
          </span>
          <StoreIcon className="hidden size-4 shrink-0 lg:block" aria-hidden="true" />
          <span className="hidden truncate lg:inline">{current?.name ?? "החנויות שלי"}</span>
          {pending ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-80 max-w-[calc(100vw-2rem)] text-right"
        data-store-switcher-menu
      >
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          החנויות שלך ({stores.length})
        </DropdownMenuLabel>
        {current && (
          <div
            className="flex items-center gap-2.5 rounded-sm bg-primary/5 px-2 py-2"
            aria-current="true"
          >
            <StoreBadge store={current} />
            <StoreLine store={current} />
            <Check className="size-4 shrink-0 text-primary" aria-label="החנות הנוכחית" />
          </div>
        )}
        <DropdownMenuSeparator />
        {others.map((store) => (
          <DropdownMenuItem
            key={store.id}
            disabled={pending !== null}
            onSelect={(event) => {
              // התפריט נשאר פתוח עם סימון טעינה עד שהדפדפן עובר
              event.preventDefault();
              void choose(store);
            }}
            className="cursor-pointer gap-2.5 py-2"
          >
            <StoreBadge store={store} />
            <StoreLine store={store} />
            {pending === store.id && (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            )}
          </DropdownMenuItem>
        ))}
        <p className="px-2 pb-1 pt-2 text-[11px] leading-4 text-muted-foreground">
          המעבר פותח את הניהול של החנות בכתובת שלה — בלי להתחבר מחדש.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
