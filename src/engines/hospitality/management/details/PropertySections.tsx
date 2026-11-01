// עמוד המתחם — פרטי 2d: מתקנים במתחם, חניה, מיקום, מידע לאורחים וכללי המקום. כולם חלק
// מהטופס של העמוד (שמירה אחת, "עודכן בינתיים" כמו שאר הפרטים).
import { ExternalLink, Plus, X } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@/platform/ui";
import type { CatalogView } from "../../types/catalog";
import {
  MAX_RULES,
  PROPERTY_DETAIL_LABELS as L,
  RULE_MAX,
  googleMapsLink,
  parseMapLocation,
  wazeLink,
} from "../../validation/details";
import { ChoiceField, NumberField, TextAreaField, TextField } from "../lib/fields";
import type { PropertyForm, PropertyFormErrors } from "../catalog/model";
import { AmenityPicker } from "./AmenityPicker";
import {
  EVENTS_LABELS,
  PARKING_LABELS,
  PARKING_TYPE_LABELS,
  PETS_LABELS,
  SMOKING_LABELS,
} from "./labels";

type Set = <K extends keyof PropertyForm>(k: K, v: PropertyForm[K]) => void;
interface Props {
  view: CatalogView;
  form: PropertyForm;
  set: Set;
  errors: PropertyFormErrors;
  readOnly: boolean;
}

function Section(props: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card data-section={props.id} id={props.id}>
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>{props.title}</h2>
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">{props.children}</CardContent>
    </Card>
  );
}

/** "" ↔ "לא צוין" — רדיו עם אפשרות ריקה */
const opts = <T extends string>(labels: Record<T, string>, none = "לא צוין") => [
  { value: "" as "" | T, label: none },
  ...(Object.keys(labels) as T[]).map((k) => ({ value: k as "" | T, label: labels[k] })),
];

export function PropertyDetailSections({ view, form, set, errors, readOnly }: Props) {
  const hasType = form.parking === "free" || form.parking === "paid";
  const loc = parseMapLocation(form.location);
  return (
    <>
      <Section
        id="shared-amenities"
        title="מתקנים במתחם"
        description="מה משותף לכל האורחים — בריכה, חצר, פינת מנגל."
      >
        <AmenityPicker
          view={view}
          scope="property"
          value={form.amenities}
          onChange={(v) => set("amenities", v)}
          readOnly={readOnly}
          error={errors.amenities}
        />
      </Section>

      <Section id="parking" title="חניה" description="האורחים יראו את זה באתר ובאישור ההזמנה.">
        <ChoiceField
          name="parking"
          label={L.parking}
          value={form.parking}
          onChange={(v) => set("parking", v)}
          options={opts(PARKING_LABELS)}
        />
        {hasType && (
          <>
            <ChoiceField
              name="parking_type"
              label={L.parking_type}
              value={form.parking_type}
              onChange={(v) => set("parking_type", v)}
              options={opts(PARKING_TYPE_LABELS, "לבחור…").slice(1)}
            />
            {errors.parking_type && (
              <p className="text-sm text-destructive">{errors.parking_type}</p>
            )}
            <NumberField
              idPrefix="property"
              name="parking_spaces"
              label={`${L.parking_spaces} (לא חובה)`}
              min={0}
              max={500}
              value={form.parking_spaces}
              onChange={(v) => set("parking_spaces", v)}
              error={errors.parking_spaces}
            />
          </>
        )}
        {form.parking === "paid" && (
          <TextField
            idPrefix="property"
            name="parking_fee_note"
            label={L.parking_fee_note}
            value={form.parking_fee_note}
            onChange={(v) => set("parking_fee_note", v)}
            error={errors.parking_fee_note}
            placeholder="למשל 30 ₪ ללילה"
          />
        )}
        {form.parking !== "" && (
          <TextAreaField
            idPrefix="property"
            name="parking_instructions"
            label={L.parking_instructions}
            value={form.parking_instructions}
            onChange={(v) => set("parking_instructions", v)}
            error={errors.parking_instructions}
            rows={3}
            hint="גלוי לאורחים. לא לכתוב כאן קודים — הם נשמרים ב״מידע פרטי להגעה״."
          />
        )}
      </Section>

      <Section
        id="location"
        title="מיקום במפה"
        description="מדביקים קישור מ-Google Maps / Waze, או כותבים קואורדינטות. אנחנו לא פותחים את הקישור — רק קוראים ממנו את המיקום."
      >
        <TextField
          idPrefix="property"
          name="location"
          label={L.location}
          value={form.location}
          dir="ltr"
          onChange={(v) => set("location", v)}
          error={errors.location}
          placeholder="https://maps.google.com/… או 32.79, 35.53"
        />
        {loc.ok && (
          <div className="flex flex-col gap-2" data-testid="location-preview">
            <p className="text-sm" dir="ltr">
              {loc.lat}, {loc.lng}
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm font-medium text-primary hover:underline"
                href={googleMapsLink(loc.lat, loc.lng)}
                target="_blank"
                rel="noopener noreferrer"
              >
                פתיחה ב-Google Maps
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
              <a
                className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm font-medium text-primary hover:underline"
                href={wazeLink(loc.lat, loc.lng)}
                target="_blank"
                rel="noopener noreferrer"
              >
                פתיחה ב-Waze
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        )}
        {form.location.trim() !== "" && !readOnly && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-fit"
            onClick={() => set("location", "")}
          >
            מחיקת המיקום
          </Button>
        )}
      </Section>

      <Section
        id="guest-info"
        title="מידע לאורחים"
        description="ציבורי: יוצג באתר ובאישור ההזמנה. קודים וסיסמאות — רק ב״מידע פרטי להגעה״."
      >
        <TextAreaField
          idPrefix="property"
          name="guest_info"
          label={L.guest_info}
          value={form.guest_info}
          onChange={(v) => set("guest_info", v)}
          error={errors.guest_info}
          rows={5}
          hint="דרכי הגעה, מה יש באזור, מה כדאי להביא. עד 4,000 תווים."
        />
      </Section>

      <Section
        id="house-rules"
        title="כללי המקום"
        description="נפרד ממדיניות הביטולים. כל הזמנה חדשה שומרת את הכללים שחלו כשהוזמנה."
      >
        <ChoiceField
          name="rules_smoking"
          label={L.rules_smoking}
          value={form.rules_smoking}
          onChange={(v) => set("rules_smoking", v)}
          options={opts(SMOKING_LABELS)}
        />
        <ChoiceField
          name="rules_pets"
          label={L.rules_pets}
          value={form.rules_pets}
          onChange={(v) => set("rules_pets", v)}
          options={opts(PETS_LABELS)}
        />
        {(form.rules_pets === "on_request" || form.rules_pets === "allowed") && (
          <TextField
            idPrefix="property"
            name="rules_pets_note"
            label={L.rules_pets_note}
            value={form.rules_pets_note}
            onChange={(v) => set("rules_pets_note", v)}
            error={errors.rules_pets_note}
            placeholder="למשל כלבים קטנים בלבד, בתוספת 50 ₪"
          />
        )}
        <ChoiceField
          name="rules_events"
          label={L.rules_events}
          value={form.rules_events}
          onChange={(v) => set("rules_events", v)}
          options={opts(EVENTS_LABELS)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            idPrefix="property"
            name="quiet_from"
            type="time"
            dir="ltr"
            label={`${L.quiet_from} (לא חובה)`}
            value={form.quiet_from}
            onChange={(v) => set("quiet_from", v)}
            error={errors.quiet_from}
          />
          <TextField
            idPrefix="property"
            name="quiet_to"
            type="time"
            dir="ltr"
            label={L.quiet_to}
            value={form.quiet_to}
            onChange={(v) => set("quiet_to", v)}
            error={errors.quiet_to}
          />
        </div>
        <p className="text-sm text-muted-foreground" data-testid="check-times">
          כניסה מ-{view.check_in_time ?? "—"} · יציאה עד {view.check_out_time ?? "—"} (נקבע בהגדרות
          העסק).
        </p>
        <CustomRules
          value={form.rules_custom}
          onChange={(v) => set("rules_custom", v)}
          error={errors.rules_custom}
          readOnly={readOnly}
        />
      </Section>
    </>
  );
}

function CustomRules(props: {
  value: string[];
  onChange: (v: string[]) => void;
  error?: string | undefined;
  readOnly: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{L.rules_custom}</legend>
      {props.value.map((rule, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            aria-label={`כלל ${i + 1}`}
            value={rule}
            maxLength={RULE_MAX}
            onChange={(e) =>
              props.onChange(props.value.map((r, j) => (j === i ? e.target.value : r)))
            }
            className="min-h-11"
          />
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-11 shrink-0"
            aria-label={`הסרת כלל ${i + 1}`}
            onClick={() => props.onChange(props.value.filter((_, j) => j !== i))}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      {!props.readOnly && props.value.length < MAX_RULES && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-fit gap-2"
          onClick={() => props.onChange([...props.value, ""])}
        >
          <Plus className="size-4" aria-hidden="true" />
          הוספת כלל
        </Button>
      )}
      {props.error && <p className="text-sm text-destructive">{props.error}</p>}
    </fieldset>
  );
}
