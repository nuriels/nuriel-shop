// חלקים משותפים לטפסים של "מסמכי לקוחות" (שליחת חוזה להזמנה / לאירוע, ומסמך עצמאי): שלב ממוספר,
// בחירה (radio), חיפוש, רשימת בחירה ובחירת לקוח קיים
import { useQuery } from "@tanstack/react-query";
import { Search, UserRound, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, Input, Label, cn } from "@/platform/ui";
import { hospitalityGuests } from "../../api/guests.functions";
import { errorText } from "../catalog/refresh";
import { CONTRACTS_KEY, useDebounced } from "./model";

export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5">
      <legend className="flex items-center gap-2 px-1 text-sm font-bold">
        <span
          className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
          aria-hidden="true"
        >
          {n}
        </span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

export function Choice({
  checked,
  onChange,
  name,
  title,
  text,
  testId,
}: {
  checked: boolean;
  onChange: () => void;
  name: string;
  title: string;
  text?: string;
  testId?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
        checked ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50",
      )}
      data-testid={testId}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-4"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {text && <span className="text-xs text-muted-foreground">{text}</span>}
      </span>
    </label>
  );
}

export function SearchBox({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 ps-9"
          autoComplete="off"
        />
      </div>
    </div>
  );
}

export function PickList({
  children,
  empty,
  loading,
  error,
}: {
  children: ReactNode[];
  empty: string;
  loading: boolean;
  error: unknown;
}) {
  if (error) return <p className="text-sm text-destructive">{errorText(error)}</p>;
  if (loading) return <p className="text-sm text-muted-foreground">מחפש…</p>;
  if (children.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <ul className="flex flex-col gap-1.5">{children}</ul>;
}

/** לקוח שנבחר מהרשימה (האימייל והטלפון — למילוי מראש, למי שצריך) */
export interface PickedGuest {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}

export function GuestPicker({
  guest,
  onPick,
}: {
  guest: { id: string; name: string } | null;
  onPick: (g: PickedGuest | null) => void;
}) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const list = useQuery({
    queryKey: [...CONTRACTS_KEY, "pick-guest", q],
    enabled: q.length >= 2,
    queryFn: () => hospitalityGuests({ data: { q, limit: 8, offset: 0 } }),
  });
  if (guest)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <span className="flex items-center gap-2">
          <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
          {guest.name}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-10 gap-1"
          onClick={() => onPick(null)}
        >
          <X className="size-4" aria-hidden="true" />
          החלפה
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-2" data-testid="guest-picker">
      <SearchBox
        id="cs-guest-q"
        label="חיפוש לקוח — שם, טלפון או אימייל"
        value={text}
        onChange={setText}
      />
      {q.length >= 2 && (
        <PickList loading={list.isLoading} error={list.error} empty="לא נמצאו לקוחות.">
          {(list.data?.items ?? [])
            .filter((g) => !g.anonymized)
            .map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() =>
                    onPick({
                      id: g.id,
                      name: g.name,
                      email: g.email ?? null,
                      phone: g.phone ?? null,
                    })
                  }
                  className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-start text-sm hover:bg-muted"
                >
                  <span>{g.name}</span>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {[g.email, g.phone].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
        </PickList>
      )}
    </div>
  );
}
