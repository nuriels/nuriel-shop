// מאגר ההעדפות של כפתור הנגישות (בדפדפן בלבד): נקרא ונשמר ב-localStorage, מוחל על <html>, ומעדכן
// את הרכיבים דרך useSyncExternalStore. בשרת — תמיד ברירת המחדל (ההעדפות מוחלות לפני הציור על ידי
// A11Y_BOOTSTRAP ב-<head>). שינוי בלשונית אחרת של אותו אתר — מתעדכן גם כאן.
import { useSyncExternalStore } from "react";
import {
  A11Y_STORAGE_KEY,
  A11Y_VERSION,
  DEFAULT_PREFS,
  applyPrefs,
  normalizePrefs,
  type A11yPrefs,
} from "./prefs";

function read(): A11yPrefs {
  try {
    const raw = window.localStorage.getItem(A11Y_STORAGE_KEY);
    return raw ? normalizePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

const listeners = new Set<() => void>();
let cached: A11yPrefs | undefined;

function publish(next: A11yPrefs) {
  cached = next;
  if (typeof document !== "undefined") applyPrefs(document.documentElement, next);
  for (const cb of listeners) cb();
}

function onStorage(e: StorageEvent) {
  if (e.key === A11Y_STORAGE_KEY || e.key === null) publish(read());
}

export const a11yStore = {
  subscribe(cb: () => void): () => void {
    if (listeners.size === 0 && typeof window !== "undefined")
      window.addEventListener("storage", onStorage);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
      if (listeners.size === 0 && typeof window !== "undefined")
        window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): A11yPrefs {
    if (cached === undefined) cached = read();
    return cached;
  },
  getServerSnapshot(): A11yPrefs {
    return DEFAULT_PREFS;
  },
  set(partial: Partial<Omit<A11yPrefs, "v">>): A11yPrefs {
    const next = normalizePrefs({ ...this.getSnapshot(), ...partial, v: A11Y_VERSION });
    try {
      window.localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // אחסון חסום (גלישה פרטית / מכסה) — ההעדפות נשארות לביקור הזה בלבד
    }
    publish(next);
    return next;
  },
  reset(): A11yPrefs {
    try {
      window.localStorage.removeItem(A11Y_STORAGE_KEY);
    } catch {
      // ממשיכים — ההעדפות מתאפסות לפחות בביקור הזה
    }
    publish(DEFAULT_PREFS);
    return DEFAULT_PREFS;
  },
  /** אחרי הטעינה: מחיל שוב את מה שנשמר (אם הסקריפט המוקדם לא רץ), בלי לכתוב לאחסון */
  reapply(): void {
    publish(read());
  },
};

export function useA11yPrefs(): A11yPrefs {
  return useSyncExternalStore(
    a11yStore.subscribe,
    () => a11yStore.getSnapshot(),
    () => a11yStore.getServerSnapshot(),
  );
}
