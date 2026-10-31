// אייקון לכל סוג מקום ויחידה (תצוגה בלבד)
import {
  BedDouble,
  Building2,
  Castle,
  DoorOpen,
  Hotel,
  House,
  LayoutGrid,
  Sparkles,
  Tent,
  Trees,
  type LucideIcon,
} from "lucide-react";
import type { PropertyType, UnitType } from "../../types/catalog";

export const PROPERTY_ICONS: Record<PropertyType, LucideIcon> = {
  zimmer: House,
  zimmer_complex: Trees,
  vacation_apartments: Building2,
  villa: Castle,
  boutique_hotel: Hotel,
  guest_house: DoorOpen,
  other: Sparkles,
};

export const UNIT_ICONS: Record<UnitType, LucideIcon> = {
  zimmer: House,
  suite: BedDouble,
  room: DoorOpen,
  apartment: Building2,
  villa: Castle,
  cabin: Tent,
  studio: LayoutGrid,
  other: BedDouble,
};
