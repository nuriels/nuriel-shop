import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, Copy, Gift, Megaphone, Pause, Play, Truck } from "lucide-react";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { isValidBannerLink } from "@/lib/banners";
import { getCouponShowcase, type CouponShowcase } from "@/lib/coupon-showcase.functions";
import { cn } from "@/lib/utils";

const SPEED_PX_PER_S = 40;
const SLIDE_MS = 500;

export type TickerIcon = "truck" | "gift" | "megaphone";

/** הודעה אחת אחרי שנפתרה: הטקסט הסופי, הקופון (אם עובד עכשיו), הקישור והאייקון */
export type TickerItem = {
  id: string;
  text: string;
  coupon: CouponShowcase | null;
  link: string | null;
  icon: TickerIcon;
};

export type AnnouncementContent = {
  items: TickerItem[];
  style: "gold" | "black";
  mode: "rotate" | "marquee";
  intervalSeconds: number;
};

const ICONS = { truck: Truck, gift: Gift, megaphone: Megaphone } as const;

export function freeShippingText(threshold: number): string {
  return `משלוח חינם בקנייה מעל ₪${threshold.toLocaleString("he-IL")}`;
}

/**
 * ההודעות שמוצגות בפועל: פעילות, שלא עבר תאריך הסיום שלהן, ובלי קופון שלא עובד
 * (השרת בודק: פעיל, בתוקף, לא נוצל, זמין לכולם). הודעה שנשארה בלי תוכן נשמטת.
 */
export function useAnnouncement(): AnnouncementContent | null {
  const { settings } = useSiteSettings();
  const [showcases, setShowcases] = useState<Map<string, CouponShowcase | null>>(new Map());
  const [now, setNow] = useState(() => Date.now());

  const enabled = settings?.announcement_enabled === true;
  const items = useMemo(
    () => (enabled ? (settings?.announcement_items ?? []) : []),
    [enabled, settings],
  );
  const codesKey = [
    ...new Set(items.filter((i) => i.active && i.coupon_code).map((i) => i.coupon_code)),
  ]
    .sort()
    .join(",");

  // תאריכי סיום: בדיקה מחדש כל דקה
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const codes = codesKey === "" ? [] : codesKey.split(",");
    if (codes.length === 0) return;
    let cancelled = false;
    void Promise.all(
      codes.map((code) =>
        getCouponShowcase({ data: { code } })
          .then((result) => [code, result] as const)
          .catch(() => [code, null] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setShowcases(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [codesKey]);

  return useMemo(() => {
    if (!settings || !enabled) return null;
    const threshold = settings.free_shipping_threshold;
    const resolved: TickerItem[] = [];
    for (const item of items) {
      if (!item.active) continue;
      if (item.ends_at && Date.parse(item.ends_at) <= now) continue;
      const coupon = item.coupon_code ? (showcases.get(item.coupon_code) ?? null) : null;
      let text = item.text.trim();
      if (item.kind === "free_shipping") {
        if (threshold === null || !(threshold > 0)) continue;
        text = freeShippingText(threshold);
      }
      if (text === "" && !coupon) continue;
      const link = item.link_url && isValidBannerLink(item.link_url) ? item.link_url : null;
      resolved.push({
        id: item.id,
        text,
        coupon,
        link,
        icon: item.kind === "free_shipping" ? "truck" : coupon ? "gift" : "megaphone",
      });
    }
    if (resolved.length === 0) return null;
    return {
      items: resolved,
      style: settings.announcement_style,
      mode: settings.announcement_mode,
      intervalSeconds: settings.announcement_interval_seconds,
    };
  }, [settings, enabled, items, now, showcases]);
}

function CouponChip({
  coupon,
  style,
  interactive,
}: {
  coupon: CouponShowcase;
  style: "gold" | "black";
  interactive: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      toast.success(`הקוד ${coupon.code} הועתק — הדביקו אותו בקופה`);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.info(`הקוד: ${coupon.code}`);
    }
  };
  return (
    <button
      type="button"
      tabIndex={interactive ? 0 : -1}
      onClick={() => void copy()}
      aria-label={`העתקת קוד הקופון ${coupon.code}`}
      data-announcement-coupon
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-full border border-dashed px-3 py-0.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        style === "gold"
          ? "border-[#f5c542] text-[#f5c542] hover:bg-[#f5c542]/15"
          : "border-black/60 bg-white/90 text-black hover:bg-white",
      )}
    >
      <span>{coupon.label}</span>
      <span dir="ltr" className="font-mono tracking-widest">
        {coupon.code}
      </span>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function ItemView({
  item,
  style,
  interactive,
  truncate,
}: {
  item: TickerItem;
  style: "gold" | "black";
  interactive: boolean;
  truncate: boolean;
}) {
  const Icon = ICONS[item.icon];
  const external = item.link ? /^https?:\/\//i.test(item.link) : false;
  const text = item.text ? (
    <span className={cn("text-sm font-bold", truncate ? "truncate" : "whitespace-nowrap")}>
      {item.text}
    </span>
  ) : null;
  return (
    <span className="flex min-w-0 items-center gap-2" data-announcement-item={item.id}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {text &&
        (item.link ? (
          <a
            href={item.link}
            tabIndex={interactive ? 0 : -1}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            title={item.text}
            data-announcement-link
            className="min-w-0 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {text}
          </a>
        ) : (
          <span className="min-w-0" title={item.text}>
            {text}
          </span>
        ))}
      {item.coupon && <CouponChip coupon={item.coupon} style={style} interactive={interactive} />}
    </span>
  );
}

/**
 * פס הודעות בכותרת. שני מצבים:
 *  - rotate: הודעה אחת בכל פעם; כל כמה שניות היא "עולה" למעלה והבאה נכנסת מלמטה.
 *    גובה קבוע (בלי קפיצות), נעצר בריחוף / במיקוד / בלשונית לא פעילה / בכפתור עצירה,
 *    ולמי שביקש פחות תנועה — מתחלף בלי אנימציה.
 *  - marquee: כל ההודעות בגלילה רציפה (כמו קודם).
 * זהב: כתב זהב על הכחול. שחור: כתב שחור על רצועה לבנה (קריא על הכחול).
 */
export function AnnouncementTicker({
  content,
  className,
}: {
  content: AnnouncementContent;
  className?: string;
}) {
  const { style } = content;
  return (
    <div
      role="region"
      aria-label="הודעות החנות"
      data-announcement={style}
      data-announcement-mode={content.mode}
      className={cn(
        "min-w-0 rounded-full px-3 py-1",
        style === "gold" ? "text-[#f5c542]" : "bg-white/90 text-black",
        className,
      )}
    >
      {content.mode === "marquee" ? (
        <MarqueeStrip content={content} />
      ) : content.items.length > 1 ? (
        <RotatingStrip content={content} />
      ) : (
        <div className="flex h-6 items-center justify-center" data-announcement-single>
          <ItemView item={content.items[0]!} style={style} interactive truncate />
        </div>
      )}
    </div>
  );
}

function RotatingStrip({ content }: { content: AnnouncementContent }) {
  const { items, style } = content;
  const count = items.length;
  const [pos, setPos] = useState<{ index: number; prev: number | null }>({ index: 0, prev: null });
  const [userPaused, setUserPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const current = Math.min(pos.index, count - 1);
  const prev = pos.prev;

  const running = !userPaused && !hovering;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setPos((value) => ({
        index: (Math.min(value.index, count - 1) + 1) % count,
        prev: Math.min(value.index, count - 1),
      }));
    }, content.intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [running, count, content.intervalSeconds, current]);

  const go = (target: number) => setPos({ index: target, prev: current });

  const position = (i: number): CSSProperties => {
    const base: CSSProperties = reducedMotion
      ? {}
      : { transition: `transform ${SLIDE_MS}ms ease-out, opacity ${SLIDE_MS}ms ease-out` };
    if (i === current) return { ...base, transform: "translateY(0)", opacity: 1 };
    // היוצאת עולה למעלה; כל השאר מחכות למטה
    if (i === prev) return { ...base, transform: "translateY(-100%)", opacity: 0 };
    return { ...base, transform: "translateY(100%)", opacity: 0 };
  };

  return (
    <div
      className="flex items-center gap-2"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
    >
      <div className="relative h-6 min-w-0 flex-1 overflow-hidden" data-announcement-viewport>
        {items.map((item, i) => (
          <div
            key={item.id}
            aria-hidden={i !== current}
            data-announcement-slide={i === current ? "current" : "idle"}
            className="absolute inset-0 flex items-center justify-center"
            style={position(i)}
          >
            <ItemView item={item} style={style} interactive={i === current} truncate />
          </div>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="hidden items-center gap-1 xl:flex" aria-hidden={false}>
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onClick={() => go(i)}
              aria-label={`הודעה ${i + 1} מתוך ${count}`}
              aria-current={i === current}
              className={cn(
                "h-1.5 rounded-full bg-current transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                i === current ? "w-4 opacity-100" : "w-1.5 opacity-40 hover:opacity-70",
              )}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setUserPaused((value) => !value)}
          aria-label={userPaused ? "הפעלת ההחלפה האוטומטית" : "עצירת ההחלפה האוטומטית"}
          data-announcement-pause
          className="flex size-5 items-center justify-center rounded-full hover:bg-current/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {userPaused ? (
            <Play className="pointer-events-none size-3" />
          ) : (
            <Pause className="pointer-events-none size-3" />
          )}
        </button>
      </div>
    </div>
  );
}

function MarqueeStrip({ content }: { content: AnnouncementContent }) {
  const { items, style } = content;
  const boxRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const [overflow, setOverflow] = useState(false);
  const signature = items
    .map((item) => `${item.id}:${item.text}:${item.coupon?.code ?? ""}`)
    .join("|");

  useEffect(() => {
    const box = boxRef.current;
    const copy = copyRef.current;
    if (!box || !copy) return;
    const measure = () => {
      const width = copy.offsetWidth;
      setOverflow(width > box.clientWidth);
      setShift(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [signature]);

  const strip = items.map((item, i) => (
    <span key={item.id} className="flex shrink-0 items-center gap-3">
      <ItemView item={item} style={style} interactive truncate={false} />
      {i < items.length - 1 && <span aria-hidden="true">•</span>}
    </span>
  ));
  return (
    <div
      ref={boxRef}
      className="hot-marquee"
      data-animate={overflow ? "true" : "false"}
      style={
        overflow
          ? ({
              "--hot-shift": `${shift + 32}px`,
              "--hot-duration": `${Math.max(8, Math.round((shift + 32) / SPEED_PX_PER_S))}s`,
            } as CSSProperties)
          : undefined
      }
    >
      <div className="hot-track flex w-max items-center">
        <div ref={copyRef} className="flex shrink-0 items-center gap-3 pe-8">
          {strip}
        </div>
        {overflow && (
          <div className="flex shrink-0 items-center gap-3 pe-8" aria-hidden="true">
            {strip}
          </div>
        )}
      </div>
    </div>
  );
}
