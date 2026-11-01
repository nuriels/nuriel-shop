// "סוגי חדרים" (RT, מלונות): סוג → כמה חדרים פיזיים באותו מתחם. באתר נמכר הסוג, וההזמנה נרשמת
// לחדר פנוי מהסוג (המסד בוחר באותה טרנזקציה). צימרים ווילות לא צריכים את זה — יחידה בלי סוג
// נמכרת כמו היום. העברת הזמנה לחדר אחר — "שינוי הזמנה" בעמוד ההזמנה.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BedDouble, Pencil, Plus, Trash2 } from "lucide-react";
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
import { hospitalityCatalog } from "../../api/catalog.functions";
import {
  hospitalityRoomTypeApply,
  hospitalityRoomTypeAssign,
  hospitalityRoomTypeDelete,
  hospitalityRoomTypeSave,
  hospitalityRoomTypes,
} from "../../api/room-types.functions";
import type { CatalogProperty, CatalogUnit } from "../../types/catalog";
import type { PublicRoomType } from "../../types/website";
import { manageKeys } from "../lib/query-keys";
import { errorText } from "./refresh";

const TYPES_KEY = [...manageKeys.all, "room-types"] as const;

export function RoomTypesPage() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: manageKeys.catalog, queryFn: () => hospitalityCatalog() });
  const types = useQuery({ queryKey: TYPES_KEY, queryFn: () => hospitalityRoomTypes() });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: TYPES_KEY });
    void qc.invalidateQueries({ queryKey: manageKeys.catalog });
  };
  const properties = (catalog.data?.properties ?? []).filter((p) => p.status !== "archived");
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <Link
          to="/manage/units"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
          יחידות ומתחמים
        </Link>
        <h1 className="text-2xl font-semibold">סוגי חדרים</h1>
        <p className="mt-1 text-muted-foreground">
          למלונות ולבתי הארחה: סוג חדר ("זוגי סטנדרט", "דלקס") מקבץ כמה חדרים זהים. באתר מוצג הסוג
          אחד, והזמנה נרשמת לחדר פנוי מהסוג. צימרים ווילות לא צריכים סוגים.
        </p>
      </div>
      {catalog.isError || types.isError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-4 text-destructive">
          {errorText(catalog.error ?? types.error)}
        </p>
      ) : !catalog.data || !types.data ? (
        <Skeleton className="h-56 w-full" />
      ) : properties.length === 0 ? (
        <p className="text-muted-foreground">קודם מוסיפים מתחם וחדרים ב"יחידות".</p>
      ) : (
        properties.map((p) => (
          <PropertyTypes
            key={p.id}
            property={p}
            types={types.data.filter((t) => t.property_id === p.id)}
            showName={properties.length > 1}
            onChange={refresh}
          />
        ))
      )}
    </div>
  );
}

function PropertyTypes({
  property,
  types,
  showName,
  onChange,
}: {
  property: CatalogProperty;
  types: PublicRoomType[];
  showName: boolean;
  onChange: () => void;
}) {
  const rooms = property.units.filter((u) => u.kind !== "whole_property");
  const [adding, setAdding] = useState(types.length === 0);
  return (
    <section className="flex flex-col gap-4" aria-label={property.name}>
      {showName && <h2 className="text-lg font-semibold">{property.name}</h2>}
      {types.map((t) => (
        <TypeCard key={t.id} type={t} rooms={rooms} onChange={onChange} />
      ))}
      {adding ? (
        <TypeForm
          propertyId={property.id}
          onDone={() => {
            setAdding(false);
            onChange();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 gap-2 self-start"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-4" aria-hidden="true" />
          סוג חדר חדש
        </Button>
      )}
      {types.length > 0 && <Assignments rooms={rooms} types={types} onChange={onChange} />}
    </section>
  );
}

function TypeForm({
  propertyId,
  type,
  onDone,
  onCancel,
}: {
  propertyId: string;
  type?: PublicRoomType;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(type?.name ?? "");
  const [description, setDescription] = useState(type?.description ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await hospitalityRoomTypeSave({
        data: {
          id: type?.id ?? null,
          propertyId,
          name,
          description,
          expectedRevision: type?.revision ?? null,
        },
      });
      toast.success(type ? "סוג החדר עודכן" : "סוג החדר נוסף — עכשיו משייכים אליו חדרים");
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rt-name-${type?.id ?? propertyId}`}>שם הסוג</Label>
          <Input
            id={`rt-name-${type?.id ?? propertyId}`}
            value={name}
            maxLength={80}
            placeholder="למשל: חדר זוגי סטנדרט"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rt-desc-${type?.id ?? propertyId}`}>תיאור לאתר (לא חובה)</Label>
          <Textarea
            id={`rt-desc-${type?.id ?? propertyId}`}
            value={description}
            rows={3}
            maxLength={4000}
            placeholder="מה מיוחד בחדרים מהסוג הזה"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            className="min-h-11"
            disabled={busy || name.trim().length < 2}
            onClick={() => void save()}
          >
            {type ? "שמירה" : "הוספה"}
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
            ביטול
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TypeCard({
  type,
  rooms,
  onChange,
}: {
  type: PublicRoomType;
  rooms: CatalogUnit[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [applying, setApplying] = useState(false);
  const mine = rooms.filter((r) => type.room_ids.includes(r.id));
  if (editing)
    return (
      <TypeForm
        propertyId={type.property_id}
        type={type}
        onDone={() => {
          setEditing(false);
          onChange();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  const remove = async () => {
    try {
      await hospitalityRoomTypeDelete({ data: { id: type.id } });
      toast.success("סוג החדר נמחק");
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  return (
    <Card data-room-type={type.slug}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BedDouble className="size-5 text-muted-foreground" aria-hidden="true" />
          <span>{type.name}</span>
        </CardTitle>
        <CardDescription>
          {mine.length === 0
            ? "עוד אין חדרים מהסוג — משייכים למטה"
            : `${mine.length} חדרים: ${mine.map((r) => r.name).join(", ")}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {type.description && <p className="text-sm text-muted-foreground">{type.description}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 gap-1.5"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" aria-hidden="true" />
            עריכה
          </Button>
          {mine.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10"
              onClick={() => setApplying((v) => !v)}
            >
              מחיר ותפוסה לכל החדרים
            </Button>
          )}
          {mine.length === 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-10 gap-1.5 text-destructive"
              onClick={() => void remove()}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              מחיקה
            </Button>
          )}
        </div>
        {applying && (
          <ApplyForm
            type={type}
            lead={mine[0]}
            onDone={() => {
              setApplying(false);
              onChange();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** החלה על כל החדרים של הסוג — רק השדות שמולאו */
function ApplyForm({
  type,
  lead,
  onDone,
}: {
  type: PublicRoomType;
  lead: CatalogUnit | undefined;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    basePrice: "",
    minNights: "",
    capacity: lead ? String(lead.capacity) : "",
    maxAdults: lead?.max_adults != null ? String(lead.max_adults) : "",
    maxChildren: lead?.max_children != null ? String(lead.max_children) : "",
  });
  const [busy, setBusy] = useState(false);
  const field = (key: keyof typeof f, label: string, hint?: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`apply-${type.id}-${key}`}>{label}</Label>
      <Input
        id={`apply-${type.id}-${key}`}
        inputMode="numeric"
        value={f[key]}
        placeholder={hint}
        onChange={(e) => setF({ ...f, [key]: e.target.value.replace(/[^\d.]/g, "") })}
      />
    </div>
  );
  const apply = async () => {
    setBusy(true);
    try {
      const r = await hospitalityRoomTypeApply({
        data: {
          id: type.id,
          basePrice: f.basePrice || null,
          minNights: f.minNights || null,
          capacity: f.capacity || null,
          maxAdults: f.maxAdults || null,
          maxChildren: f.maxChildren || null,
        },
      });
      toast.success(`עודכנו ${r.rooms} חדרים`);
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">
        שדה ריק — לא משתנה. המחיר נשמר בכל חדר (כללי המחיר של העסק חלים עליהם כרגיל).
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {field("basePrice", "מחיר ללילה (₪)", "ללא שינוי")}
        {field("minNights", "מינימום לילות", "ללא שינוי")}
        {field("capacity", "עד כמה אורחים")}
        {field("maxAdults", "מבוגרים לכל היותר")}
        {field("maxChildren", "ילדים לכל היותר")}
      </div>
      <Button
        type="button"
        className="min-h-11 self-start"
        disabled={busy}
        onClick={() => void apply()}
      >
        החלה על כל החדרים
      </Button>
    </div>
  );
}

function Assignments({
  rooms,
  types,
  onChange,
}: {
  rooms: CatalogUnit[];
  types: PublicRoomType[];
  onChange: () => void;
}) {
  const typeOf = (id: string) => types.find((t) => t.room_ids.includes(id))?.id ?? "";
  const [busy, setBusy] = useState<string | null>(null);
  const assign = async (unitId: string, categoryId: string) => {
    setBusy(unitId);
    try {
      await hospitalityRoomTypeAssign({ data: { unitId, categoryId: categoryId || null } });
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">שיוך חדרים לסוגים</CardTitle>
        <CardDescription>חדר בלי סוג מוצג באתר לבד, כמו היום.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rooms.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm">
                {r.name}
                {!r.is_active && (
                  <span className="ms-2 text-xs text-muted-foreground">(לא פעיל)</span>
                )}
              </span>
              <select
                aria-label={`סוג החדר של ${r.name}`}
                value={typeOf(r.id)}
                disabled={busy === r.id}
                onChange={(e) => void assign(r.id, e.target.value)}
                className="min-h-10 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">בלי סוג</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
