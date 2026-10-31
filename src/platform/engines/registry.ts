// רישום המנועים: מי רשום, ולמי שייכת כל פונקציית שרת.
// הפלטפורמה לא מייבאת מנועים — שורש ההרכבה מעביר אותם לכאן.
import type { Engine, ServerFnOwner, SiteType } from "./contract";
import { isPlatformServerFn } from "./shared-functions";

/** מנוע ברירת המחדל: כל פונקציית שרת שאף אחד אחר לא טוען לה (קוד החנויות הקיים) */
export const DEFAULT_ENGINE: SiteType = "ecommerce";

export interface EngineRegistry {
  get(key: SiteType): Engine | undefined;
  all(): readonly Engine[];
  ownerOf(filename: string): ServerFnOwner;
}

/** נתיב יחסי לשורש הפרויקט, עם / (גם אם הגיע מוחלט או עם ./) */
export function normalizeFilename(filename: string): string {
  const unix = filename.replace(/\\/g, "/").replace(/^\.\//, "");
  const at = unix.lastIndexOf("/src/");
  return at >= 0 ? unix.slice(at + 1) : unix;
}

export function createEngineRegistry(engines: readonly Engine[]): EngineRegistry {
  const byKey = new Map<SiteType, Engine>();
  for (const engine of engines) {
    if (byKey.has(engine.key)) throw new Error(`engine registered twice: ${engine.key}`);
    byKey.set(engine.key, engine);
  }
  if (!byKey.has(DEFAULT_ENGINE))
    throw new Error(`the default engine (${DEFAULT_ENGINE}) is missing`);
  const claimants = engines.filter((engine) => engine.key !== DEFAULT_ENGINE);

  return {
    get: (key) => byKey.get(key),
    all: () => engines,
    ownerOf(filename) {
      const file = normalizeFilename(filename);
      if (isPlatformServerFn(file)) return "platform";
      const owners = claimants.filter((engine) => engine.ownsServerFn(file));
      if (owners.length > 1) {
        throw new Error(`${file} is claimed by ${owners.map((o) => o.key).join(", ")}`);
      }
      return owners[0]?.key ?? DEFAULT_ENGINE;
    },
  };
}
