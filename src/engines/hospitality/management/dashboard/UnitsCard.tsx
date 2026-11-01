// כרטיס "היחידות שלכם" בלוח הבקרה (Stage 2c.4): כמה יחידות פעילות מתוך החבילה, כמה
// מתחמים, מה לא פעיל, וקיצור דרך. לעסק עם יחידה אחת — היחידה עצמה. בלי יחידות — הזמנה
// להתחיל (ההקמה הראשונה במסך היחידות).
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BedDouble, ChevronLeft, Plus } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  buttonVariants,
} from "@/platform/ui";
import { hospitalityCatalog } from "../../api/catalog.functions";
import { manageKeys } from "../lib/query-keys";
import { unitsOverview } from "../catalog/model";

export function UnitsCard() {
  const catalog = useQuery({
    queryKey: manageKeys.catalog,
    queryFn: () => hospitalityCatalog(),
    refetchOnWindowFocus: false,
  });
  const o = catalog.data ? unitsOverview(catalog.data) : null;
  return (
    <Card data-testid="units-card">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>היחידות שלכם</h2>
        </CardTitle>
        {o && <CardDescription>{o.limitText}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!o ? (
          catalog.isError ? (
            <p role="alert" className="text-destructive">
              טעינת היחידות נכשלה
            </p>
          ) : (
            <Skeleton className="h-16 w-full" />
          )
        ) : o.properties === 0 ? (
          <>
            <p className="text-muted-foreground">
              עוד לא הוספתם מקום אירוח. בשתי דקות מגדירים את המקום ואת היחידות הראשונות.
            </p>
            <Link
              to="/manage/units"
              className={buttonVariants({ className: "min-h-11 w-fit gap-2" })}
            >
              <Plus className="size-4" aria-hidden="true" />
              להקמת מקום האירוח
            </Link>
          </>
        ) : (
          <>
            {o.single ? (
              <Link
                to="/manage/units/$unitId"
                params={{ unitId: o.single.id }}
                className="flex min-h-11 items-center gap-2 font-medium text-primary hover:underline"
              >
                <BedDouble className="size-4" aria-hidden="true" />
                {o.single.name}
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">מתחמים</dt>
                <dd>{o.properties}</dd>
                <dt className="text-muted-foreground">יחידות פעילות</dt>
                <dd>{o.active}</dd>
                {o.inactive > 0 && (
                  <>
                    <dt className="text-muted-foreground">לא פעילות</dt>
                    <dd>{o.inactive}</dd>
                  </>
                )}
                {o.wholeActive > 0 && (
                  <>
                    <dt className="text-muted-foreground">"כל המתחם"</dt>
                    <dd>{o.wholeActive === 1 ? "פעיל" : `${o.wholeActive} פעילים`}</dd>
                  </>
                )}
              </dl>
            )}
            {o.missingPrice > 0 && (
              <p className="text-amber-800">
                {o.missingPrice === 1
                  ? "ליחידה אחת עוד אין מחיר"
                  : `ל-${o.missingPrice} יחידות עוד אין מחיר`}
              </p>
            )}
            <Link
              to="/manage/units"
              className={buttonVariants({ variant: "outline", className: "min-h-11 w-fit gap-2" })}
            >
              לניהול היחידות
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
