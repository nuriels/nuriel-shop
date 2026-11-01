// מסך "אורחים" (/manage/guests) — Stage 2j: כל האורחים של העסק (שם, פרטי קשר ממוסכים,
// כמה שהיות, השהייה האחרונה / הבאה, יש הערות), חיפוש לפי שם / טלפון / אימייל, "הצגת עוד".
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { NotebookPen, Search } from "lucide-react";
import { Button, Card, CardContent, Input, Label } from "@/platform/ui";
import { hospitalityGuests } from "../../api/guests.functions";
import { LoadError, PageSkeleton } from "../catalog/parts";
import { dayText } from "../bookings/model";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";

const PAGE = 50;

export function GuestsPage() {
  const ctx = useManagement();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setLimit(PAGE), [q]);
  const query = useQuery({
    queryKey: [...manageKeys.all, "guests", q, limit],
    queryFn: () => hospitalityGuests({ data: { q: q || null, limit, offset: 0 } }),
    placeholderData: keepPreviousData,
  });
  if (!ctx.permissions["guests"])
    return <p className="p-4">אין לכם הרשאה לראות אורחים באתר הזה.</p>;
  if (query.isError && !query.data) return <LoadError error={query.error} />;
  if (!query.data) return <PageSkeleton label="טוען אורחים…" />;
  const data = query.data;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">אורחים</h1>
        <p className="text-muted-foreground">
          {data.total} אורחים. טלפון ואימייל מלאים — בכרטיס האורח.
        </p>
      </header>
      <div className="flex flex-col gap-1">
        <Label htmlFor="gs-search">חיפוש — שם, טלפון או אימייל</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="gs-search"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-11 ps-9"
          />
        </div>
      </div>
      {data.items.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-muted-foreground">
          {q ? `לא נמצאו אורחים עבור "${q}".` : "עדיין אין אורחים — הם נוספים עם כל הזמנה."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="guests-list">
          {data.items.map((g) => (
            <li key={g.id}>
              <Link
                to="/manage/guests/$guestId"
                params={{ guestId: g.id }}
                className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="transition-colors hover:border-primary">
                  <CardContent className="flex flex-col gap-1 p-4 text-sm">
                    <p className="flex items-center gap-2 font-semibold">
                      {g.name}
                      {g.has_notes && (
                        <NotebookPen
                          className="size-4 text-muted-foreground"
                          aria-label="יש הערות"
                        />
                      )}
                    </p>
                    {!g.anonymized && (
                      <p className="flex flex-wrap gap-x-3 text-muted-foreground" dir="ltr">
                        {g.phone && <span>{g.phone}</span>}
                        {g.email && <span>{g.email}</span>}
                      </p>
                    )}
                    <p className="flex flex-wrap gap-x-3">
                      <span>
                        {g.stays === 0
                          ? "עוד לא שהה"
                          : g.stays === 1
                            ? "שהייה אחת"
                            : `${g.stays} שהיות`}
                      </span>
                      {g.next_stay && <span>הבאה: {dayText(g.next_stay)}</span>}
                      {g.last_stay && (
                        <span className="text-muted-foreground">
                          אחרונה: {dayText(g.last_stay)}
                        </span>
                      )}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.items.length < data.total && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={query.isFetching}
          onClick={() => setLimit((l) => Math.min(l + PAGE, 100))}
        >
          הצגת עוד ({data.total - data.items.length})
        </Button>
      )}
    </div>
  );
}
