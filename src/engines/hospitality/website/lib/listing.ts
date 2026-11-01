// מה שהאתר מוכר: יחידות רגילות (צימר, וילה, דירה, "כל המתחם") וסוגי חדרים (מלונות). חדר ששייך
// לסוג לא מוצג לבד — הסוג מוצג במקומו של החדר הראשון שלו (כך הסדר של העסק נשמר). טהור.
import type { PublicRoomType, PublicSite, PublicUnit } from "../../types/website";

export interface TypeListing {
  type: PublicRoomType;
  /** החדרים הפעילים של הסוג, לפי הסדר */
  rooms: PublicUnit[];
  /** החדר הראשון — לתמונות, למיטות ולמתקנים של הסוג */
  lead: PublicUnit;
  capacity: number;
  /** "החל מ-" — המחיר הנמוך מבין החדרים (0 = לפי התאריכים) */
  fromPrice: number;
  minNights: number;
}

export type ListingItem = { kind: "unit"; unit: PublicUnit } | { kind: "type"; type: TypeListing };

function typeListings(site: PublicSite): TypeListing[] {
  const byId = new Map(site.units.map((u) => [u.id, u]));
  return (site.room_types ?? [])
    .map((type): TypeListing | null => {
      const rooms = type.room_ids.map((id) => byId.get(id)).filter((u): u is PublicUnit => !!u);
      const lead = rooms[0];
      if (!lead) return null;
      const prices = rooms.map((r) => r.base_price).filter((p) => p > 0);
      return {
        type,
        rooms,
        lead,
        capacity: Math.max(...rooms.map((r) => r.capacity)),
        fromPrice: prices.length ? Math.min(...prices) : 0,
        minNights: Math.min(...rooms.map((r) => r.min_nights)),
      };
    })
    .filter((x): x is TypeListing => x !== null);
}

export function siteListing(site: PublicSite): ListingItem[] {
  const types = typeListings(site);
  const typeOfRoom = new Map<string, TypeListing>();
  for (const t of types) for (const r of t.rooms) typeOfRoom.set(r.id, t);
  const emitted = new Set<string>();
  const out: ListingItem[] = [];
  for (const unit of site.units) {
    const t = typeOfRoom.get(unit.id);
    if (!t) {
      out.push({ kind: "unit", unit });
    } else if (!emitted.has(t.type.id)) {
      emitted.add(t.type.id);
      out.push({ kind: "type", type: t });
    }
  }
  return out;
}

export function findType(site: PublicSite, slug: string | undefined): TypeListing | undefined {
  if (!slug) return undefined;
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // נשאר כמו שהוא
  }
  return typeListings(site).find((t) => t.type.slug === slug || t.type.slug === decoded);
}

/** המזהה של פריט (יחידה או סוג) — לסינון "יחידות נוספות" */
export const listingId = (i: ListingItem) => (i.kind === "unit" ? i.unit.id : i.type.type.id);
