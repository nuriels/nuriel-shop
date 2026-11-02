// האימות נגד בוטים בטופס ההזמנה (security/pow.ts): ברגע שהטופס מוצג — מבקשים אתגר מהשרת
// ופותרים אותו ברקע, בזמן שהאורח ממלא את הפרטים. האורח לא רואה כלום (אין תמונה, אין שאלה, אין
// עוגייה); אם לחץ "שליחה" לפני שהחישוב הסתיים — השליחה מחכה לו. וכך גם אם שלח מהר מהזמן המינימלי
// שהשרת דורש (מילוי אוטומטי של הדפדפן) — השליחה מחכה את השניות שנשארו, במקום שהשרת ידחה אותו.
import { useCallback, useEffect, useRef, useState } from "react";
import { hospitalitySiteChallenge } from "../../api/website.functions";
import { isPowChallenge, powSendDelay, solvePow, type PowSolution } from "../../security/pow";

interface Solved {
  solution: PowSolution;
  /** מתי האתגר הגיע לדפדפן (Date.now) — ממנו נמדד הזמן המינימלי */
  receivedAt: number;
}

export type BotCheckState = "working" | "ready" | "failed";

export function useBotCheck() {
  const [state, setState] = useState<BotCheckState>("working");
  const pending = useRef<Promise<Solved | null> | null>(null);
  const abort = useRef<AbortController | null>(null);

  const start = useCallback((): Promise<Solved | null> => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState("working");
    const run = (async () => {
      try {
        const challenge: unknown = await hospitalitySiteChallenge();
        if (!isPowChallenge(challenge)) throw new Error("invalid challenge");
        const receivedAt = Date.now();
        const solution = await solvePow(challenge, { signal: controller.signal });
        if (!controller.signal.aborted) setState(solution ? "ready" : "failed");
        return solution ? { solution, receivedAt } : null;
      } catch {
        if (!controller.signal.aborted) setState("failed");
        return null;
      }
    })();
    pending.current = run;
    return run;
  }, []);

  useEffect(() => {
    void start();
    return () => abort.current?.abort();
  }, [start]);

  /** הפתרון לשליחה: מחכה לחישוב שברקע (ולזמן המינימלי); אם נכשל — ניסיון אחד נוסף מההתחלה */
  const solution = useCallback(async (): Promise<PowSolution | null> => {
    const ready = (await (pending.current ?? start())) ?? (await start());
    if (!ready) return null;
    const wait = powSendDelay(ready.receivedAt, Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return ready.solution;
  }, [start]);

  return { state, solution, renew: start };
}
