import { useId, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, Info, Loader2, Play, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  MATCH_LABEL,
  type ExistingMode,
  type MatchProduct,
  type MissingMode,
  type PlanSummary,
  type PlannedRow,
  type RowChoice,
} from "@/lib/product-import-sync";
import { cn } from "@/lib/utils";

const he = (value: number) => value.toLocaleString("he-IL");
const LISTED = 100;

export type ReviewOptions = {
  existing: ExistingMode | null;
  createNew: boolean;
  missing: MissingMode;
};
export type MissingInfo = { count: number; sample: string[] };

function Card({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn" | "bad" | undefined;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-3 text-center",
        tone === "good" && "bg-emerald-50 dark:bg-emerald-950/40",
        tone === "warn" && "bg-amber-50 dark:bg-amber-950/40",
        tone === "bad" && "bg-destructive/10",
        !tone && "bg-secondary",
      )}
      data-review-card={testId}
    >
      <p className="numeric text-2xl font-black">{he(value)}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Choice({
  value,
  id,
  title,
  hint,
}: {
  value: string;
  id: string;
  title: string;
  hint?: string | undefined;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border p-2.5 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/5">
      <RadioGroupItem
        value={value}
        id={id}
        className="mt-0.5"
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer text-sm font-medium leading-5">
          {title}
        </Label>
        {hint && (
          <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

function productLabel(product: MatchProduct): string {
  return `${product.name} · מק"ט ${product.sku} · מלאי ${product.stock}${product.hidden ? " · מוסתר" : ""}`;
}

/** בחירה לשורה: איזה מוצר לעדכן / מוצר חדש / לדלג */
function RowSelect({
  plan,
  value,
  onChange,
  createNew,
}: {
  plan: PlannedRow;
  value: RowChoice;
  onChange: (choice: RowChoice) => void;
  createNew: boolean;
}) {
  const id = useId();
  const products = plan.match?.products ?? [];
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-2 sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor={id} className="min-w-0 text-sm">
        <span className="text-muted-foreground">שורה {plan.item.row} · </span>
        <span className="font-medium" dir="auto">
          {plan.item.name}
        </span>
        {plan.item.stock !== "" && (
          <span className="text-muted-foreground"> · כמות בקובץ {plan.item.stock}</span>
        )}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 max-w-full rounded-md border bg-background px-2 text-sm sm:max-w-[18rem]"
      >
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            לעדכן: {productLabel(product)}
          </option>
        ))}
        {createNew && <option value="new">זה מוצר חדש — להוסיף</option>}
        <option value="skip">לדלג על השורה</option>
      </select>
    </div>
  );
}

function Collapsible({
  title,
  count,
  children,
  open,
}: {
  title: string;
  count: number;
  children: ReactNode;
  open?: boolean;
}) {
  if (count === 0) return null;
  return (
    <details className="group rounded-xl border" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold">
        <span>
          {title} ({he(count)})
        </span>
        <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-1.5 border-t p-2">{children}</div>
    </details>
  );
}

/** שלב הבדיקה: מה נמצא, מה יקרה, והבחירות של המנהל לפני הייבוא */
export function ImportReview({
  plan,
  summary,
  options,
  onOptions,
  choices,
  onChoice,
  onSkipAllAmbiguous,
  missing,
  missingLoading,
  missingError,
  tiers,
  requiredError,
  canRun,
  onRun,
  onBack,
}: {
  plan: PlannedRow[];
  summary: PlanSummary;
  options: ReviewOptions;
  onOptions: (next: ReviewOptions) => void;
  choices: Record<number, RowChoice>;
  onChoice: (row: number, choice: RowChoice) => void;
  onSkipAllAmbiguous: () => void;
  missing: { zero: MissingInfo | null; hide: MissingInfo | null };
  missingLoading: boolean;
  missingError: string | null;
  tiers: boolean;
  requiredError: boolean;
  canRun: boolean;
  onRun: () => void;
  onBack: () => void;
}) {
  const base = useId();
  const ambiguous = plan.filter((p) => p.match?.status === "ambiguous");
  const byName = plan.filter((p) => p.match?.status === "matched" && p.match.kind === "name");
  const invalid = plan.filter((p) => p.match?.status === "invalid");
  const duplicates = plan.filter((p) => p.duplicateOf !== null);
  const stockChanges = plan.filter(
    (p) =>
      p.decision.action === "update" &&
      p.product &&
      !p.product.serial &&
      /^\d{1,7}$/.test(p.item.stock) &&
      Number(p.item.stock) !== p.product.stock,
  );
  const missingNow =
    options.missing === "zero" ? missing.zero : options.missing === "hide" ? missing.hide : null;
  const notInFile = missing.hide?.count ?? null;
  const choiceOf = (p: PlannedRow): RowChoice =>
    choices[p.item.row] ??
    (p.match?.status === "matched" ? (p.match.products[0]?.id ?? "skip") : "skip");

  return (
    <div className="space-y-4" data-import-review>
      <h3 className="text-base font-bold" tabIndex={-1} id={`${base}-title`}>
        בדיקה מול המוצרים בחנות
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Card label="מוצרים חדשים" value={summary.status.new} tone="good" testId="new" />
        <Card label="כבר בחנות" value={summary.status.matched} testId="matched" />
        <Card
          label="לא חד-משמעי"
          value={summary.status.ambiguous}
          tone={summary.status.ambiguous > 0 ? "warn" : undefined}
          testId="ambiguous"
        />
        <Card
          label="לא תקינים"
          value={summary.status.invalid}
          tone={summary.status.invalid > 0 ? "bad" : undefined}
          testId="invalid"
        />
        <Card
          label="כפולים בקובץ"
          value={summary.fileDuplicates}
          tone={summary.fileDuplicates > 0 ? "warn" : undefined}
          testId="duplicates"
        />
      </div>
      {summary.status.matched > 0 && (
        <p className="text-xs text-muted-foreground">
          זוהו לפי:{" "}
          {(["barcode", "sku", "supplier_sku", "name"] as const)
            .filter((kind) => summary.kinds[kind] > 0)
            .map((kind) => `${MATCH_LABEL[kind]} ${he(summary.kinds[kind])}`)
            .join(" · ")}
          . מוצר קיים לא יתווסף שוב.
        </p>
      )}

      <fieldset
        className={cn("space-y-2 rounded-xl border p-3", requiredError && "border-destructive")}
        aria-describedby={requiredError ? `${base}-required` : undefined}
      >
        <legend className="px-1 text-sm font-semibold">
          מה לעשות ב-
          {he(
            summary.status.matched + ambiguous.filter((p) => p.decision.action === "update").length,
          )}{" "}
          המוצרים שכבר בחנות? <span className="text-destructive">*</span>
        </legend>
        <RadioGroup
          dir="rtl"
          value={options.existing ?? ""}
          onValueChange={(value) => onOptions({ ...options, existing: value as ExistingMode })}
          aria-label="מה לעשות במוצרים שכבר בחנות"
          aria-required="true"
        >
          <Choice
            value="stock"
            id={`${base}-stock`}
            title="לעדכן את כמות המלאי לפי הקובץ"
            hint={`${he(summary.stockChanges)} מוצרים ישנו כמות (${he(summary.stockUp)} יעלו, ${he(summary.stockDown)} ירדו), מתוכם ${he(summary.toZero)} ירדו ל-0 ויסומנו "אזל".`}
          />
          <Choice
            value="stock_price"
            id={`${base}-price`}
            title="לעדכן מלאי וגם מחיר"
            hint={`בנוסף, ${he(summary.priceChanges)} מחירים ישתנו.${summary.priceLocked > 0 ? ` ${he(summary.priceLocked)} מוצרים עם מחירים שונים לדרגות לקוחות לא ישתנו.` : ""}`}
          />
          <Choice
            value="none"
            id={`${base}-none`}
            title="לא לשנות מוצרים קיימים"
            hint="רק להוסיף את המוצרים החדשים."
          />
        </RadioGroup>
        {summary.serialKept > 0 && (
          <p className="text-xs text-muted-foreground">
            {he(summary.serialKept)} מוצרים עם מספרים סידוריים — המלאי שלהם לא משתנה ביבוא (קליטת
            סחורה).
          </p>
        )}
        {summary.noStockInFile > 0 && options.existing !== "none" && (
          <p className="text-xs text-muted-foreground">
            ל-{he(summary.noStockInFile)} מוצרים אין כמות בקובץ — המלאי שלהם לא ישתנה.
          </p>
        )}
        {requiredError && (
          <p id={`${base}-required`} role="alert" className="text-sm text-destructive">
            בחרו מה לעשות במוצרים שכבר בחנות.
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-2 rounded-xl border p-3">
        <legend className="px-1 text-sm font-semibold">
          {he(summary.status.new)} מוצרים חדשים (לא נמצאו בחנות)
        </legend>
        <RadioGroup
          dir="rtl"
          value={options.createNew ? "yes" : "no"}
          onValueChange={(value) => onOptions({ ...options, createNew: value === "yes" })}
          aria-label="מה לעשות במוצרים החדשים"
        >
          <Choice
            value="yes"
            id={`${base}-new-yes`}
            title="להוסיף אותם לחנות"
            hint={
              summary.newAtZero > 0
                ? `${he(summary.newAtZero)} מהם עם כמות 0 בקובץ — יסומנו "אזל".`
                : undefined
            }
          />
          <Choice value="no" id={`${base}-new-no`} title="לא להוסיף מוצרים חדשים" />
        </RadioGroup>
      </fieldset>

      <fieldset className="space-y-2 rounded-xl border p-3">
        <legend className="px-1 text-sm font-semibold">
          מוצרים שבחנות ולא בקובץ
          {notInFile !== null ? ` (${he(notInFile)})` : ""}
        </legend>
        <RadioGroup
          dir="rtl"
          value={options.missing}
          onValueChange={(value) => onOptions({ ...options, missing: value as MissingMode })}
          aria-label="מה לעשות במוצרים שבחנות ולא בקובץ"
        >
          <Choice
            value="keep"
            id={`${base}-keep`}
            title="להשאיר אותם כמו שהם"
            hint="ברירת המחדל — הם לא משתנים."
          />
          <Choice
            value="zero"
            id={`${base}-zero`}
            title='לאפס להם את המלאי (יסומנו "אזל")'
            hint={missing.zero ? `${he(missing.zero.count)} מוצרים יאופסו.` : undefined}
          />
          <Choice
            value="hide"
            id={`${base}-hide`}
            title="להסתיר אותם מהאתר"
            hint={missing.hide ? `${he(missing.hide.count)} מוצרים יוסתרו.` : undefined}
          />
        </RadioGroup>
        <p className="text-xs text-muted-foreground">
          מוצרים דיגיטליים לא משתנים אף פעם, וגם מוצרים עם מספרים סידוריים לא מאופסים.
        </p>
        {missingLoading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            סופרים את המוצרים שלא בקובץ…
          </p>
        )}
        {missingError && (
          <p role="alert" className="text-xs text-destructive">
            {missingError}
          </p>
        )}
        {missingNow && missingNow.count > 0 && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
            data-missing-warning
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {he(missingNow.count)} מוצרים בחנות {options.missing === "zero" ? "יאופסו" : "יוסתרו"}{" "}
              כי הם לא בקובץ
              {missingNow.sample.length > 0
                ? `, למשל: ${missingNow.sample.slice(0, 5).join(", ")}`
                : ""}
              . השינוי נעשה רק בסוף, אחרי שכל הקובץ יובא — ואפשר לבטל אותו מתוך הדוח.
            </span>
          </p>
        )}
      </fieldset>

      {ambiguous.length > 0 && (
        <section
          className="space-y-2 rounded-xl border border-amber-300 p-3 dark:border-amber-700"
          aria-labelledby={`${base}-amb`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 id={`${base}-amb`} className="text-sm font-semibold">
              {he(ambiguous.length)} שורות שמתאימות לכמה מוצרים בחנות — בחרו לכל שורה
            </h4>
            <Button type="button" variant="ghost" size="sm" onClick={onSkipAllAmbiguous}>
              לדלג על כולן
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            שורה שלא בוחרים לה מוצר — מדלגים עליה (לא נוסף מוצר כפול).
          </p>
          {ambiguous.slice(0, LISTED).map((p) => (
            <RowSelect
              key={p.item.row}
              plan={p}
              value={choiceOf(p)}
              createNew={options.createNew}
              onChange={(choice) => onChoice(p.item.row, choice)}
            />
          ))}
          {ambiguous.length > LISTED && (
            <p className="text-xs text-muted-foreground">
              ועוד {he(ambiguous.length - LISTED)} שורות (ידולגו).
            </p>
          )}
        </section>
      )}

      <Collapsible title="זוהו לפי השם בלבד — אפשר לשנות" count={byName.length}>
        <p className="text-xs text-muted-foreground">
          השם בקובץ זהה לשם של מוצר בחנות. אם זה בעצם מוצר אחר — בחרו "מוצר חדש".
        </p>
        {byName.slice(0, LISTED).map((p) => (
          <RowSelect
            key={p.item.row}
            plan={p}
            value={choiceOf(p)}
            createNew={options.createNew}
            onChange={(choice) => onChoice(p.item.row, choice)}
          />
        ))}
      </Collapsible>

      <Collapsible
        title="המלאי ישתנה"
        count={options.existing && options.existing !== "none" ? stockChanges.length : 0}
      >
        <ul className="space-y-1 text-sm">
          {stockChanges.slice(0, LISTED).map((p) => (
            <li key={p.item.row} className="flex justify-between gap-2">
              <span className="truncate" dir="auto">
                {p.product?.name}
              </span>
              <span className="whitespace-nowrap" dir="ltr">
                {p.product?.stock} →{" "}
                <strong className={Number(p.item.stock) === 0 ? "text-destructive" : ""}>
                  {p.item.stock}
                </strong>
              </span>
            </li>
          ))}
        </ul>
      </Collapsible>

      <Collapsible title="שורות לא תקינות (ידולגו)" count={invalid.length}>
        <ul className="space-y-1 text-sm">
          {invalid.slice(0, LISTED).map((p) => (
            <li key={p.item.row} className="flex gap-2">
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>
                שורה {p.item.row} · {p.item.name || "—"} — {p.match?.problem}
              </span>
            </li>
          ))}
        </ul>
      </Collapsible>

      <Collapsible title="כפולים בתוך הקובץ (ידולגו)" count={duplicates.length}>
        <ul className="space-y-1 text-sm">
          {duplicates.slice(0, LISTED).map((p) => (
            <li key={p.item.row}>
              שורה {p.item.row} · {p.item.name} — כמו שורה {p.duplicateOf}
            </li>
          ))}
        </ul>
      </Collapsible>

      {tiers && options.existing === "stock_price" && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          בחנות פעילים מחירים לפי דרגות לקוחות: המחיר מתעדכן רק במוצרים עם מחיר אחיד.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowRight className="size-4" aria-hidden="true" />
          חזרה לקובץ
        </Button>
        <Button type="button" size="lg" disabled={!canRun} onClick={onRun} data-import-run>
          <Play className="size-4" aria-hidden="true" />
          {`ייבוא: ${he(summary.create)} חדשים, ${he(summary.update)} קיימים`}
        </Button>
      </div>
    </div>
  );
}
