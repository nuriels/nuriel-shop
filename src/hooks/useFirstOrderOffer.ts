import { useEffect, useState } from "react";
import { getFirstOrderOffer, type FirstOrderOffer } from "@/lib/first-order.functions";

const APPROVED_KEY = "first-order-approved:v1";

/** האם הלקוח אישר את ההצעה (נשמר בדפדפן, כדי שיעבור מהסל לקופה) */
export function readFirstOrderApproval(): string | null {
  try {
    return window.localStorage.getItem(APPROVED_KEY);
  } catch {
    return null;
  }
}

export function writeFirstOrderApproval(code: string | null): void {
  try {
    if (code) window.localStorage.setItem(APPROVED_KEY, code);
    else window.localStorage.removeItem(APPROVED_KEY);
    window.dispatchEvent(new Event("first-order-approval"));
  } catch {
    // אחסון חסום — האישור נשמר רק בעמוד הנוכחי
  }
}

export function useFirstOrderApproval(): [string | null, (code: string | null) => void] {
  const [approved, setApproved] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setApproved(readFirstOrderApproval());
    sync();
    window.addEventListener("first-order-approval", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("first-order-approval", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [
    approved,
    (code) => {
      setApproved(code);
      writeFirstOrderApproval(code);
    },
  ];
}

/**
 * ההצעה להזמנה ראשונה של הקונה הנוכחי. אימייל שהוקלד (אורח) נבדק אחרי השהיה קצרה;
 * לקוח מחובר מזוהה בשרת לפי החשבון.
 */
export function useFirstOrderOffer(email: string | null, enabled = true) {
  const [offer, setOffer] = useState<FirstOrderOffer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const clean = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim() : null;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        void getFirstOrderOffer({ data: { email: clean } })
          .then((result) => {
            if (cancelled) return;
            setOffer(result);
            setLoaded(true);
          })
          .catch(() => {
            if (cancelled) return;
            setOffer(null);
            setLoaded(true);
          });
      },
      loaded ? 450 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // loaded נקרא רק לקביעת ההשהיה — לא צריך להפעיל מחדש
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clean, enabled]);

  return { offer, loaded };
}
