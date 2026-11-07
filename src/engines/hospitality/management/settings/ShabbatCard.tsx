// שלב א' 6: "מתחם שומר שבת" במסך ההגדרות — מתג שנשמר מיד (מיגרציה 57). כשמסומן, האתר מציג תג עם
// נרות שבת בכותרת ובתחתית העמוד, והודעה בתהליך ההזמנה; כשלא — כלום.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/platform/ui";
import { hospitalitySetShabbat } from "../../api/settings.functions";
import type { SettingsView } from "../../types/settings";
import { CandlesIcon } from "../../website/components/ShabbatBadge";
import { errorText } from "../catalog/refresh";
import { manageKeys } from "../lib/query-keys";
import { SectionCard } from "../ui/kit";

export function ShabbatCard({ view }: { view: SettingsView }) {
  const qc = useQueryClient();
  const on = view.values.shabbat_observant === true;
  const save = useMutation({
    mutationFn: (next: boolean) => hospitalitySetShabbat({ data: { on: next } }),
    onSuccess: (next) => {
      qc.setQueryData(manageKeys.settings, next);
      toast.success(
        next.values.shabbat_observant
          ? "נשמר — האתר מציג שהמתחם שומר שבת"
          : "נשמר — הסימון הוסר מהאתר",
      );
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <SectionCard title="שבת" description="מה שהאורחים רואים באתר לגבי שמירת שבת במתחם.">
      <div className="flex items-start gap-3 rounded-xl border p-4" data-testid="shabbat-setting">
        <span className="mt-0.5 text-[var(--hm-lagoon-700)]">
          <CandlesIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor="shabbat-observant" className="text-sm font-semibold">
            מתחם שומר שבת
          </label>
          <p id="shabbat-observant-hint" className="text-[13px] text-muted-foreground">
            יוצג באתר תג "המתחם שומר שבת" בכותרת ובתחתית העמוד, והודעה בתהליך ההזמנה. נשמר מיד.
          </p>
        </div>
        <Switch
          id="shabbat-observant"
          checked={on}
          disabled={save.isPending || view.values.shabbat_observant === undefined}
          onCheckedChange={(v) => save.mutate(v)}
          aria-describedby="shabbat-observant-hint"
        />
      </div>
    </SectionCard>
  );
}
