import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search, UserRound, UserRoundCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchPosCustomers } from "@/lib/pos-data";
import type { PosCustomer, PosCustomerForm } from "@/lib/pos";
import { cn } from "@/lib/utils";

/**
 * שלב 1 בקופה: הלקוח. חיפוש לקוח קיים (רשום, או מי שהזמין בעבר כאורח —
 * לפי שם / טלפון / אימייל), או פרטי לקוח חדש. לקוח רשום → ההזמנה נשמרת
 * בחשבון שלו ובמחירים שלו; אורח → שם + נייד. אימייל — לא חובה (רק לשליחת
 * אישור הזמנה ללקוח במייל).
 * למשלוח עד הבית — גם עיר וכתובת.
 */
export function PosCustomerSection({
  customer,
  form,
  onFormChange,
  onSelect,
  onClear,
  needsAddress,
  pricingNote,
}: {
  /** לקוח רשום שנבחר (null = לקוח חדש / אורח) */
  customer: PosCustomer | null;
  form: PosCustomerForm;
  onFormChange: (next: PosCustomerForm) => void;
  onSelect: (customer: PosCustomer) => void;
  onClear: () => void;
  needsAddress: boolean;
  /** "מחירון אישי — …" ללקוח עם מחירים משלו */
  pricingNote: string | null;
}) {
  const set = (key: keyof PosCustomerForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onFormChange({ ...form, [key]: event.target.value });
  const guest = customer === null;

  return (
    <Card className="shadow-card" data-testid="pos-customer">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            1
          </span>
          לקוח
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {customer ? (
          <div
            className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
            data-testid="pos-selected-customer"
          >
            <UserRoundCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-0.5 text-sm">
              <p className="font-semibold">{customer.name}</p>
              <p className="text-muted-foreground">
                חשבון באתר
                {customer.email ? (
                  <>
                    {" · "}
                    <span dir="ltr">{customer.email}</span>
                  </>
                ) : null}
                {customer.orders_count > 0 ? ` · ${customer.orders_count} הזמנות קודמות` : ""}
              </p>
              {pricingNote && <p className="text-xs font-medium text-primary">{pricingNote}</p>}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              aria-label="החלפת לקוח"
              data-testid="pos-clear-customer"
            >
              <X className="size-4" aria-hidden="true" />
              החלפה
            </Button>
          </div>
        ) : (
          <>
            <CustomerSearch onSelect={onSelect} />
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              או פרטי לקוח חדש / אורח
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.3fr]">
          <div className="space-y-1.5">
            <Label htmlFor="pos-name">{guest ? "שם מלא *" : "שם בהזמנה"}</Label>
            <Input
              id="pos-name"
              value={form.name}
              maxLength={120}
              autoComplete="off"
              placeholder="ישראל ישראלי"
              onChange={set("name")}
              data-testid="pos-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pos-phone">{guest ? "נייד *" : "טלפון"}</Label>
            <Input
              id="pos-phone"
              value={form.phone}
              dir="ltr"
              inputMode="tel"
              autoComplete="off"
              placeholder="050-1234567"
              className="text-right"
              onChange={set("phone")}
              data-testid="pos-phone"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pos-email">
              אימייל <span className="font-normal text-muted-foreground">(לא חובה)</span>
            </Label>
            <Input
              id="pos-email"
              value={form.email}
              dir="ltr"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="name@example.com"
              className="text-right"
              onChange={set("email")}
              aria-describedby="pos-email-hint"
              data-testid="pos-email"
            />
            <p id="pos-email-hint" className="text-xs text-muted-foreground">
              רק אם רוצים לשלוח ללקוח אישור הזמנה במייל
            </p>
          </div>
        </div>

        {needsAddress && (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3 sm:grid-cols-[1fr_1.6fr_0.8fr]">
            <p className="text-xs font-semibold text-muted-foreground sm:col-span-3">
              כתובת למשלוח עד הבית
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pos-city">עיר *</Label>
              <Input id="pos-city" value={form.city} maxLength={80} onChange={set("city")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-address">רחוב ומספר בית *</Label>
              <Input
                id="pos-address"
                value={form.address}
                maxLength={200}
                onChange={set("address")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-zip">מיקוד</Label>
              <Input
                id="pos-zip"
                value={form.zip}
                dir="ltr"
                inputMode="numeric"
                maxLength={9}
                className="text-right"
                onChange={set("zip")}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** חיפוש לקוח: בלי מונח — הלקוחות האחרונים; עם מונח — שם / טלפון / אימייל */
function CustomerSearch({ onSelect }: { onSelect: (customer: PosCustomer) => void }) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchPosCustomers(term.trim())
        .then((rows) => {
          if (!alive) return;
          setResults(rows);
          setActive(0);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!alive) return;
          setResults([]);
          setError(reason instanceof Error ? reason.message : "החיפוש נכשל");
        })
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [term, open]);

  // לחיצה מחוץ לתיבה סוגרת את הרשימה
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const pick = (customer: PosCustomer) => {
    setOpen(false);
    setTerm("");
    onSelect(customer);
  };

  return (
    <div ref={boxRef} className="relative space-y-1.5">
      <Label htmlFor="pos-customer-search">חיפוש לקוח קיים</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="pos-customer-search"
          value={term}
          autoComplete="off"
          placeholder="שם, טלפון או אימייל"
          className="pr-9"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          data-testid="pos-customer-search"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(results.length - 1, index + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter") {
              const chosen = results[active];
              if (open && chosen) {
                event.preventDefault();
                pick(chosen);
              }
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {loading && (
          <Loader2
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="לקוחות"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          data-testid="pos-customer-results"
        >
          {error ? (
            <p className="px-3 py-2 text-sm text-destructive">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {loading
                ? "מחפש…"
                : term.trim() === ""
                  ? "עדיין אין לקוחות — הזינו פרטי לקוח חדש למטה"
                  : "לא נמצא לקוח — הזינו פרטי לקוח חדש למטה"}
            </p>
          ) : (
            <>
              {term.trim() === "" && (
                <p className="px-3 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground">
                  לקוחות אחרונים
                </p>
              )}
              {results.map((customer, index) => (
                <button
                  key={`${customer.kind}:${customer.customer_id ?? customer.email ?? customer.phone ?? index}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(customer)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-start text-sm",
                    index === active ? "bg-secondary" : "hover:bg-secondary/60",
                  )}
                >
                  {customer.kind === "account" ? (
                    <UserRoundCheck
                      className="mt-0.5 size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  ) : (
                    <UserRound
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{customer.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[customer.phone, customer.email].filter(Boolean).map((value, i) => (
                        <span key={i}>
                          {i > 0 ? " · " : ""}
                          <span dir="ltr">{value}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {customer.kind === "account" ? "חשבון" : "הזמין כאורח"}
                    {customer.orders_count > 0 ? ` · ${customer.orders_count}` : ""}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
