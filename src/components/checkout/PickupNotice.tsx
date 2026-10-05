import { Clock, MapPin, Store } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * בלוק בולט להזמנה באיסוף עצמי (חלק 22): "ההזמנה תמתין לך באיסוף עצמי", עם
 * כתובת החנות ושעות הפעילות מהגדרות האתר (site_settings של החנות). מוצג
 * בעמוד הצלחת ההזמנה, בעמוד התשלום בביט / בכרטיס ובפרטי ההזמנה באזור האישי.
 */
export function PickupNotice({
  address,
  hours,
  className,
}: {
  address: string | null | undefined;
  hours: string | null | undefined;
  className?: string;
}) {
  const storeAddress = address?.trim() ?? "";
  const storeHours = hours?.trim() ?? "";
  return (
    <section
      aria-label="איסוף עצמי"
      data-pickup-notice
      className={cn(
        "space-y-2 rounded-xl border-2 border-violet-300 bg-violet-50 p-4 text-right text-violet-950 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-100",
        className,
      )}
    >
      <p className="flex items-center gap-2 text-base font-bold">
        <Store className="size-5 shrink-0" aria-hidden="true" />
        ההזמנה תמתין לך באיסוף עצמי
      </p>
      {storeAddress ? (
        <p className="flex items-start gap-2 text-sm leading-6">
          <MapPin className="mt-1 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            <span className="font-semibold">כתובת החנות: </span>
            {storeAddress}
          </span>
        </p>
      ) : null}
      {storeHours ? (
        <div className="flex items-start gap-2 text-sm leading-6">
          <Clock className="mt-1 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">שעות פעילות:</p>
            <p className="whitespace-pre-line break-words">{storeHours}</p>
          </div>
        </div>
      ) : null}
      <p className="text-xs leading-5 opacity-80">נעדכן אותך כשההזמנה מוכנה לאיסוף.</p>
    </section>
  );
}
