// הסדרי הנגישות הפיזיים במתחם (מיגרציה 60): רק מה שבעל המתחם מוסר ומאשר. אין מילוי אוטומטי, אין
// ברירת מחדל "יש" — פריט שלא נענה לא מופיע בהצהרה. השמירה דורשת אישור מפורש שהמידע נכון.
// מופיע בהצהרת הנגישות בפרסום הבא שלה ("מסמכים ומדיניות האתר").
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Textarea,
} from "@/platform/ui";
import {
  hospitalityPropertyAccessibility,
  hospitalityPropertyAccessibilitySave,
} from "../../api/documents.functions";
import {
  ACCESSIBILITY_ITEMS,
  type AccessibilityAnswer,
  type AccessibilityItems,
} from "../../documents/kinds";
import { ANSWER_LABELS, ITEM_LABELS } from "../../documents/render";
import type { PropertyAccessibility } from "../../types/documents";
import { errorText } from "../catalog/refresh";
import { formatDate } from "../lib/format";

export function AccessibilityArrangementsCard({
  propertyId,
  readOnly,
}: {
  propertyId: string;
  readOnly: boolean;
}) {
  const q = useQuery({
    queryKey: ["hospitality", "manage", "property-accessibility", propertyId],
    queryFn: () => hospitalityPropertyAccessibility({ data: { propertyId } }),
  });
  return (
    <Card data-section="accessibility" id="accessibility" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="text-lg">הסדרי נגישות במתחם</CardTitle>
        <CardDescription>
          לפי מה שקיים בפועל במתחם — רק אתם יודעים. פריט שלא תענו עליו לא יופיע בהצהרת הנגישות. אחרי
          שמירה — פרסמו מחדש את הצהרת הנגישות ב
          <Link to="/manage/documents" className="underline underline-offset-4">
            מסמכים ומדיניות
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isError ? (
          <p role="alert" className="text-destructive">
            {errorText(q.error)}
          </p>
        ) : q.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <ArrangementsForm
            key={q.data?.revision ?? "new"}
            propertyId={propertyId}
            saved={q.data}
            readOnly={readOnly}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ArrangementsForm({
  propertyId,
  saved,
  readOnly,
}: {
  propertyId: string;
  saved: PropertyAccessibility | null | undefined;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [items, setItems] = useState<AccessibilityItems>(saved?.items ?? {});
  const [additional, setAdditional] = useState(saved?.additional ?? "");
  const [contactName, setContactName] = useState(saved?.contact_name ?? "");
  const [contactPhone, setContactPhone] = useState(saved?.contact_phone ?? "");
  const [contactEmail, setContactEmail] = useState(saved?.contact_email ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      hospitalityPropertyAccessibilitySave({
        data: {
          propertyId,
          items,
          confirmed,
          additional,
          contactName,
          contactPhone,
          contactEmail,
          expectedRevision: saved?.revision ?? null,
        },
      }),
    onSuccess: () => {
      toast.success("הסדרי הנגישות נשמרו — פרסמו מחדש את הצהרת הנגישות כדי לעדכן אותה באתר");
      setConfirmed(false);
      void qc.invalidateQueries({
        queryKey: ["hospitality", "manage", "property-accessibility", propertyId],
      });
      void qc.invalidateQueries({ queryKey: ["hospitality", "manage", "documents"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const setAnswer = (k: (typeof ACCESSIBILITY_ITEMS)[number], answer: AccessibilityAnswer | "") =>
    setItems((it) => {
      const next = { ...it };
      if (answer === "") delete next[k];
      else next[k] = { answer, ...(it[k]?.details ? { details: it[k]!.details } : {}) };
      return next;
    });
  const setDetails = (k: (typeof ACCESSIBILITY_ITEMS)[number], details: string) =>
    setItems((it) => (it[k] ? { ...it, [k]: { ...it[k]!, details } } : it));

  return (
    <div className="flex flex-col gap-5">
      {saved && (
        <p className="text-sm text-muted-foreground" data-testid="accessibility-confirmed">
          אושר לאחרונה: {formatDate(saved.confirmed_at)}
        </p>
      )}
      <div className="flex flex-col gap-4">
        {ACCESSIBILITY_ITEMS.map((k) => (
          <fieldset key={k} className="rounded-md border p-3" disabled={readOnly}>
            <legend className="px-1 text-sm font-medium">{ITEM_LABELS[k]}</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2" role="radiogroup">
              {(["", "yes", "partial", "no"] as const).map((a) => (
                <label key={a || "none"} className="inline-flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`a11y-${k}`}
                    value={a}
                    checked={(items[k]?.answer ?? "") === a}
                    onChange={() => setAnswer(k, a)}
                    className="size-4"
                  />
                  {a === "" ? "לא ענינו (לא יופיע)" : ANSWER_LABELS[a]}
                </label>
              ))}
            </div>
            {items[k] && (
              <div className="mt-2 grid gap-1.5">
                <Label htmlFor={`a11y-${k}-details`} className="text-xs">
                  פירוט (לא חובה)
                </Label>
                <Input
                  id={`a11y-${k}-details`}
                  value={items[k]?.details ?? ""}
                  maxLength={300}
                  onChange={(e) => setDetails(k, e.target.value)}
                />
              </div>
            )}
          </fieldset>
        ))}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="a11y-additional">התאמות נוספות (לא חובה)</Label>
        <Textarea
          id="a11y-additional"
          value={additional}
          maxLength={2000}
          rows={3}
          disabled={readOnly}
          onChange={(e) => setAdditional(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="a11y-contact-name">איש קשר למידע נוסף</Label>
          <Input
            id="a11y-contact-name"
            value={contactName}
            maxLength={80}
            disabled={readOnly}
            onChange={(e) => setContactName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="a11y-contact-phone">טלפון</Label>
          <Input
            id="a11y-contact-phone"
            type="tel"
            dir="ltr"
            value={contactPhone}
            maxLength={30}
            disabled={readOnly}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="a11y-contact-email">אימייל</Label>
          <Input
            id="a11y-contact-email"
            type="email"
            dir="ltr"
            value={contactEmail}
            maxLength={254}
            disabled={readOnly}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
      </div>
      {!readOnly && (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>אני מאשר/ת שהמידע נמסר על ידי המתחם ושהוא נכון</span>
          </label>
          <div>
            <Button
              type="button"
              className="min-h-11"
              disabled={!confirmed || save.isPending}
              onClick={() => save.mutate()}
            >
              שמירת הסדרי הנגישות
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
