import { useEffect, useRef, useState } from "react";
import { Check, Copy, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { getCouponShowcase, type CouponShowcase } from "@/lib/coupon-showcase.functions";
import { cn } from "@/lib/utils";

const SPEED_PX_PER_S = 40;

export type AnnouncementContent = {
  text: string;
  coupon: CouponShowcase | null;
  style: "gold" | "black";
};

/** הקופון להצגה בפס — רק אם הוא עובד כרגע (השרת בודק: פעיל, בתוקף, לא נוצל) */
export function useAnnouncement(): AnnouncementContent | null {
  const { settings } = useSiteSettings();
  const code = settings?.announcement_enabled ? settings.announcement_coupon_code : null;
  const [coupon, setCoupon] = useState<CouponShowcase | null>(null);
  const [checkedCode, setCheckedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setCoupon(null);
      setCheckedCode(null);
      return;
    }
    let cancelled = false;
    void getCouponShowcase({ data: { code } })
      .then((result) => {
        if (cancelled) return;
        setCoupon(result);
        setCheckedCode(code);
      })
      .catch(() => {
        if (cancelled) return;
        setCoupon(null);
        setCheckedCode(code);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!settings?.announcement_enabled) return null;
  const text = settings.announcement_text.trim();
  const shownCoupon = code && checkedCode === code ? coupon : null;
  if (text === "" && !shownCoupon) return null;
  return { text, coupon: shownCoupon, style: settings.announcement_style };
}

function CouponChip({ coupon, style }: { coupon: CouponShowcase; style: "gold" | "black" }) {
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
      onClick={() => void copy()}
      aria-label={`העתקת קוד הקופון ${coupon.code}`}
      data-announcement-coupon
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-dashed px-3 py-0.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
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

/**
 * פס הודעות זז: טקסט חופשי ו/או קופון להקפצה, בזהב או בשחור (על רקע בהיר,
 * כדי שיהיה קריא על הכחול). גלילה רציפה בלי רווח ריק, נעצר בריחוף / במיקוד,
 * ולמי שביקש פחות תנועה — טקסט קבוע.
 */
export function AnnouncementTicker({
  content,
  className,
}: {
  content: AnnouncementContent;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const [overflow, setOverflow] = useState(false);

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
  }, [content.text, content.coupon?.code]);

  const { style } = content;
  const items = (
    <>
      <Megaphone className="size-4 shrink-0" aria-hidden="true" />
      {content.text && <span className="whitespace-nowrap text-sm font-bold">{content.text}</span>}
      {content.coupon && <CouponChip coupon={content.coupon} style={style} />}
    </>
  );
  const animate = overflow;
  return (
    <div
      role="region"
      aria-label="הודעות החנות"
      data-announcement={style}
      className={cn(
        "min-w-0 rounded-full px-3 py-1",
        style === "gold" ? "text-[#f5c542]" : "bg-white/90 text-black",
        className,
      )}
    >
      <div
        ref={boxRef}
        className="hot-marquee"
        data-animate={animate ? "true" : "false"}
        style={
          animate
            ? ({
                "--hot-shift": `${shift + 32}px`,
                "--hot-duration": `${Math.max(8, Math.round((shift + 32) / SPEED_PX_PER_S))}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <div className="hot-track flex w-max items-center">
          <div ref={copyRef} className="flex shrink-0 items-center gap-3 pe-8">
            {items}
          </div>
          {animate && (
            <div className="flex shrink-0 items-center gap-3 pe-8" aria-hidden="true">
              {items}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
