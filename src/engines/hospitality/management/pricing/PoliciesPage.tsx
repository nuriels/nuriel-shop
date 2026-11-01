// מסך "מדיניות ביטול" (/manage/policies) — Stage 2f: המדיניות של העסק, ברירת מחדל, עורך עם
// תבניות (גמיש / רגיל / קפדני), מדרגות, אי-הגעה ומקדמה; דוגמה חיה מהשרת ("אם אורח מבטל N ימים
// לפני — מקבל בחזרה X") בדיוק לפי המנוע; היסטוריית גרסאות. כל שינוי יוצר גרסה חדשה — הזמנות
// קיימות שומרות את התנאים שאושרו בהן. כללי המקום — בעמוד המתחם (2d).
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, History, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
  cn,
} from "@/platform/ui";
import {
  hospitalityArchivePolicy,
  hospitalityPolicyHistory,
  hospitalityPolicyPreview,
  hospitalityPricing,
  hospitalitySavePolicy,
  hospitalitySetDefaultPolicy,
} from "../../api/pricing.functions";
import type { FeeTier, Policy, PolicyPreview, PolicyRules, PricingView } from "../../types/pricing";
import { FEE_LABELS, POLICY_TEMPLATES, policyError } from "../../validation/pricing";
import { FormSheet } from "../catalog/CatalogSheets";
import { ConfirmButton, LoadError, PageSkeleton, StatusPill } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import { DEFAULT_POLICY_RULES, money, policySummary, pricingKey, refundAt } from "./model";

export function PoliciesPage() {
  const ctx = useManagement();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: pricingKey,
    queryFn: () => hospitalityPricing(),
    refetchOnWindowFocus: false,
  });
  const [editing, setEditing] = useState<Policy | "new" | null>(null);
  const [history, setHistory] = useState<Policy | null>(null);
  if (!ctx.permissions["policies"])
    return <p className="p-4">אין לכם הרשאה לנהל מדיניות ביטול באתר הזה.</p>;
  if (query.isError) return <LoadError error={query.error} />;
  if (!query.data) return <PageSkeleton label="טוען את המדיניות…" />;
  const v = query.data;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: pricingKey });
    void queryClient.invalidateQueries({ queryKey: manageKeys.context });
  };
  const active = v.policies.filter((p) => !p.is_archived);
  const archived = v.policies.filter((p) => p.is_archived);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">מדיניות ביטול</h1>
        <p className="text-muted-foreground">
          מה קורה כשאורח מבטל. כל שינוי יוצר גרסה חדשה — הזמנות קיימות שומרות את התנאים שהאורח אישר.
          כללי המקום (עישון, חיות, שעות שקט) — בעמוד המתחם.{" "}
          <Link to="/manage/pricing" className="font-medium text-primary hover:underline">
            ← מחירים
          </Link>
        </p>
      </header>
      {active.map((p) => (
        <Card key={p.id} data-policy={p.name}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              <h2>{p.name}</h2>
              {p.is_default && <StatusPill tone="ok">ברירת המחדל</StatusPill>}
              <span className="text-sm font-normal text-muted-foreground">גרסה {p.version}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm" data-testid="policy-summary">
              {policySummary(p.rules)}
            </p>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 gap-1"
                onClick={() => setEditing(p)}
              >
                <Pencil className="size-4" aria-hidden="true" />
                עריכה
              </Button>
              {!p.is_default && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 gap-1"
                  onClick={async () => {
                    try {
                      await hospitalitySetDefaultPolicy({ data: { id: p.id } });
                      toast.success(`${p.name} היא עכשיו ברירת המחדל`);
                      refresh();
                    } catch (e) {
                      toast.error(errorText(e));
                    }
                  }}
                >
                  <Star className="size-4" aria-hidden="true" />
                  ברירת מחדל
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 gap-1"
                onClick={() => setHistory(p)}
              >
                <History className="size-4" aria-hidden="true" />
                גרסאות קודמות
              </Button>
              {!p.is_default && (
                <ConfirmButton
                  label="העברה לארכיון"
                  icon={<Archive className="size-4" aria-hidden="true" />}
                  title={`להעביר את ${p.name} לארכיון?`}
                  description={
                    <p>יחידות וכללים שהשתמשו בה יעברו לברירת המחדל. הזמנות קיימות לא משתנות.</p>
                  }
                  confirmLabel="העברה לארכיון"
                  onConfirm={async () => {
                    try {
                      await hospitalityArchivePolicy({ data: { id: p.id } });
                      toast.success("המדיניות הועברה לארכיון");
                      refresh();
                    } catch (e) {
                      toast.error(errorText(e));
                    }
                  }}
                />
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-fit gap-2"
        onClick={() => setEditing("new")}
      >
        <Plus className="size-4" aria-hidden="true" />
        מדיניות חדשה
      </Button>
      {archived.length > 0 && (
        <p className="text-sm text-muted-foreground">
          בארכיון: {archived.map((p) => p.name).join(", ")}
        </p>
      )}
      {editing && (
        <PolicySheet
          policy={editing === "new" ? null : editing}
          currency={v.currency}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          onConflict={(view) => queryClient.setQueryData(pricingKey, view)}
        />
      )}
      {history && <HistorySheet policy={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function PolicySheet(props: {
  policy: Policy | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
  onConflict: (view: PricingView) => void;
}) {
  const p = props.policy;
  const [name, setName] = useState(p?.name ?? "");
  const [rules, setRules] = useState<PolicyRules>(p?.rules ?? DEFAULT_POLICY_RULES);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PolicyPreview | null>(null);
  const [daysBefore, setDaysBefore] = useState("5");
  const error = policyError(name, rules);
  const set = <K extends keyof PolicyRules>(k: K, val: PolicyRules[K]) =>
    setRules((r) => ({ ...r, [k]: val }));
  const setTier = (i: number, t: Partial<FeeTier>) =>
    set(
      "fee_tiers",
      rules.fee_tiers.map((x, j) => (j === i ? { ...x, ...t } : x)),
    );

  // דוגמה חיה מהשרת (אותו חישוב כמו בהזמנה), אחרי שהמשתמש מפסיק להקליד
  useEffect(() => {
    if (policyError("x", rules)) return;
    const t = setTimeout(() => {
      hospitalityPolicyPreview({
        data: { rules, total: 1000, checkIn: iso(new Date(Date.now() + 60 * 86400000)) },
      })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(t);
  }, [rules]);

  const submit = async () => {
    setSubmitted(true);
    if (error) return;
    setBusy(true);
    setServerError(null);
    try {
      const data = { name: name.trim(), ...rules, guest_text: rules.guest_text?.trim() || null };
      const r = await hospitalitySavePolicy({
        data: { id: p?.id ?? null, data, version: p?.version ?? null },
      });
      if (r.status === "conflict") {
        props.onConflict(r.view);
        setServerError(
          "המדיניות עודכנה בינתיים על ידי משתמש אחר — סגרו ופתחו שוב כדי לראות את הגרסה העדכנית.",
        );
        return;
      }
      toast.success(p ? `נשמרה גרסה ${r.value.version}` : "המדיניות נוספה");
      props.onSaved();
      props.onClose();
    } catch (e) {
      setServerError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const example = preview ? refundAt(preview, Number(daysBefore) || 0) : null;
  const sel = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-base";
  return (
    <FormSheet
      open
      title={p ? `עריכת ${p.name}` : "מדיניות ביטול חדשה"}
      description="אפשר להתחיל מתבנית ולשנות כל ערך. שמירה יוצרת גרסה חדשה."
      dirty={
        name !== (p?.name ?? "") ||
        JSON.stringify(rules) !== JSON.stringify(p?.rules ?? DEFAULT_POLICY_RULES)
      }
      busy={busy}
      submitLabel={p ? "שמירת גרסה חדשה" : "הוספה"}
      serverError={serverError}
      notice={null}
      hasErrors={Boolean(error)}
      submitted={submitted}
      onSubmit={() => void submit()}
      onClose={props.onClose}
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="תבניות">
        {(Object.keys(POLICY_TEMPLATES) as (keyof typeof POLICY_TEMPLATES)[]).map((k) => (
          <Button
            key={k}
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setRules((r) => ({ ...r, ...POLICY_TEMPLATES[k].rules }))}
          >
            תבנית: {POLICY_TEMPLATES[k].label}
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="policy-name">שם המדיניות</Label>
        <Input
          id="policy-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className="min-h-11"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="policy-free">ביטול חינם עד כמה ימים לפני ההגעה</Label>
        <Input
          id="policy-free"
          inputMode="numeric"
          dir="ltr"
          placeholder="ריק — אין ביטול חינם"
          value={rules.free_cancel_days === null ? "" : String(rules.free_cancel_days)}
          onChange={(e) =>
            set(
              "free_cancel_days",
              e.target.value.trim() === "" ? null : Number(e.target.value.replace(/\D/g, "")),
            )
          }
          className="min-h-11 text-center"
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">אחרי הביטול החינם — דמי ביטול</legend>
        {rules.fee_tiers.length === 0 && (
          <p className="text-sm text-muted-foreground">בלי מדרגות — הסכום המלא.</p>
        )}
        {rules.fee_tiers.map((t, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_1.4fr_1fr_auto] items-end gap-2"
            data-tier={i + 1}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor={`tier-${i}-days`} className="text-xs">
                מ-X ימים לפני
              </Label>
              <Input
                id={`tier-${i}-days`}
                inputMode="numeric"
                dir="ltr"
                value={String(t.from_days)}
                onChange={(e) =>
                  setTier(i, { from_days: Number(e.target.value.replace(/\D/g, "")) || 0 })
                }
                className="min-h-11 text-center"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`tier-${i}-fee`} className="text-xs">
                דמי ביטול
              </Label>
              <select
                id={`tier-${i}-fee`}
                className={sel}
                value={t.fee}
                onChange={(e) => setTier(i, { fee: e.target.value as FeeTier["fee"], value: 0 })}
              >
                {(Object.keys(FEE_LABELS) as FeeTier["fee"][]).map((k) => (
                  <option key={k} value={k}>
                    {FEE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`tier-${i}-value`} className="text-xs">
                ערך
              </Label>
              <Input
                id={`tier-${i}-value`}
                inputMode="decimal"
                dir="ltr"
                disabled={!["percent_total", "percent_deposit", "fixed"].includes(t.fee)}
                value={String(t.value ?? 0)}
                onChange={(e) => setTier(i, { value: Number(e.target.value) || 0 })}
                className="min-h-11 text-center"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 min-w-11"
              aria-label={`הסרת מדרגה ${i + 1}`}
              onClick={() =>
                set(
                  "fee_tiers",
                  rules.fee_tiers.filter((_, j) => j !== i),
                )
              }
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        {rules.fee_tiers.length < 10 && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-fit gap-2"
            onClick={() =>
              set("fee_tiers", [
                ...rules.fee_tiers,
                {
                  from_days: Math.max(
                    0,
                    (rules.fee_tiers.at(-1)?.from_days ?? rules.free_cancel_days ?? 3) - 1,
                  ),
                  fee: "full",
                  value: 0,
                },
              ])
            }
          >
            <Plus className="size-4" aria-hidden="true" />
            הוספת מדרגה
          </Button>
        )}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="policy-noshow">אם האורח לא מגיע</Label>
          <select
            id="policy-noshow"
            className={sel}
            value={rules.no_show_fee}
            onChange={(e) => set("no_show_fee", e.target.value as PolicyRules["no_show_fee"])}
          >
            <option value="full">הסכום המלא</option>
            <option value="percent_total">אחוז מהסכום</option>
            <option value="fixed">סכום קבוע</option>
            <option value="deposit">המקדמה</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="policy-noshow-value">ערך</Label>
          <Input
            id="policy-noshow-value"
            inputMode="decimal"
            dir="ltr"
            disabled={rules.no_show_fee !== "percent_total" && rules.no_show_fee !== "fixed"}
            value={String(rules.no_show_value)}
            onChange={(e) => set("no_show_value", Number(e.target.value) || 0)}
            className="min-h-11 text-center"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="policy-deposit">מקדמה</Label>
          <select
            id="policy-deposit"
            className={sel}
            value={rules.deposit_kind}
            onChange={(e) => set("deposit_kind", e.target.value as PolicyRules["deposit_kind"])}
          >
            <option value="none">בלי מקדמה</option>
            <option value="percent">אחוז מהסכום</option>
            <option value="fixed">סכום קבוע</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="policy-deposit-value">גובה המקדמה</Label>
          <Input
            id="policy-deposit-value"
            inputMode="decimal"
            dir="ltr"
            disabled={rules.deposit_kind === "none"}
            value={String(rules.deposit_value)}
            onChange={(e) => set("deposit_value", Number(e.target.value) || 0)}
            className="min-h-11 text-center"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        גביית תשלום באתר תתווסף בשלב התשלומים — עד אז המקדמה מוצגת לאורח כתנאי.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="policy-text">הסבר לאורח (לא חובה)</Label>
        <Textarea
          id="policy-text"
          rows={3}
          maxLength={2000}
          value={rules.guest_text ?? ""}
          onChange={(e) => set("guest_text", e.target.value)}
          className="text-base"
        />
      </div>
      {submitted && error && <p className="text-sm text-destructive">{error}</p>}
      <section
        className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3"
        aria-label="דוגמה חיה"
        data-testid="policy-example"
      >
        <p className="text-sm font-medium">דוגמה: הזמנה של {money(1000, props.currency)}</p>
        <div className="flex items-center gap-2">
          <Label htmlFor="example-days" className="text-sm">
            אם האורח מבטל
          </Label>
          <Input
            id="example-days"
            inputMode="numeric"
            dir="ltr"
            value={daysBefore}
            onChange={(e) => setDaysBefore(e.target.value.replace(/\D/g, "").slice(0, 3))}
            className="min-h-11 w-20 text-center"
          />
          <span className="text-sm">ימים לפני ההגעה</span>
        </div>
        {error ? (
          <p className="text-sm text-muted-foreground">תקנו את השדות כדי לראות דוגמה.</p>
        ) : example ? (
          <p className={cn("text-sm font-semibold")} data-testid="policy-example-result">
            {example.fee === 0
              ? `ביטול חינם — מקבל בחזרה את כל ${money(1000, props.currency)}`
              : `משלם ${money(example.fee, props.currency)} ומקבל בחזרה ${money(example.refund, props.currency)}`}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">מחשב…</p>
        )}
        {preview && (
          <p className="text-xs text-muted-foreground">
            אם לא מגיע: {money(preview.schedule.no_show_fee, props.currency)}.
          </p>
        )}
      </section>
    </FormSheet>
  );
}

function HistorySheet({ policy, onClose }: { policy: Policy; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["hospitality", "manage", "policy-history", policy.id],
    queryFn: () => hospitalityPolicyHistory({ data: { id: policy.id } }),
  });
  return (
    <FormSheet
      open
      title={`הגרסאות של ${policy.name}`}
      description="לקריאה בלבד. כל הזמנה שומרת את הגרסה שהאורח אישר."
      dirty={false}
      busy={false}
      submitLabel="סגירה"
      serverError={q.isError ? errorText(q.error) : null}
      notice={null}
      hasErrors={false}
      submitted={false}
      onSubmit={onClose}
      onClose={onClose}
    >
      <ol className="flex flex-col gap-2" data-testid="policy-history">
        {(q.data ?? []).map((v) => (
          <li key={v.version} className="rounded-md border p-2 text-sm">
            <p className="font-medium">
              גרסה {v.version} · {new Date(v.saved_at).toLocaleDateString("he-IL")}
            </p>
            <p className="text-muted-foreground">{policySummary(v.rules)}</p>
          </li>
        ))}
      </ol>
    </FormSheet>
  );
}
