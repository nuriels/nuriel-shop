// עמוד ההזמנה בניהול (מיגרציה 60): סוג העסקה לפי הערוץ (הזמנה באתר / בטלפון = עסקת מכר מרחוק;
// במקום; ידנית; ערוץ חיצוני), ואילו גרסאות של מסמכי האתר האורח אישר, ומתי. מידע לצוות — לא ייעוץ
// משפטי: זכויות הביטול לפי הדין נבדקות לפי ההזמנה, המדיניות שנשמרה איתה והחוק.
import { useQuery } from "@tanstack/react-query";
import { hospitalityBookingDocuments } from "../../api/documents.functions";
import type { BookingDetail } from "../../types/bookings";
import { formatDateTime } from "../lib/format";

const CHANNEL: Record<BookingDetail["source"], string> = {
  site: "הזמנה באתר — עסקת מכר מרחוק (חוק הגנת הצרכן, סעיף 14ג): זכות הביטול לפי החוק ותקנותיו חלה, והמדיניות של העסק אינה גורעת ממנה.",
  phone: "הזמנה בטלפון — גם עסקת מכר מרחוק: המדיניות שנמסרה לאורח בשיחה חלה, בכפוף לדין.",
  walk_in: "הזמנה במקום, פנים אל פנים.",
  owner: "הזמנה שהוזנה ידנית בניהול.",
  external: "הזמנה דרך ערוץ חיצוני — חלים גם התנאים של הערוץ.",
};

export function AcceptedDocumentsCard({ b }: { b: BookingDetail }) {
  const docs = useQuery({
    queryKey: ["hospitality", "manage", "booking-documents", b.id],
    queryFn: () => hospitalityBookingDocuments({ data: { bookingId: b.id } }),
  });
  return (
    <div className="space-y-3 text-sm" data-testid="booking-documents">
      <p>{CHANNEL[b.source]}</p>
      {docs.data && docs.data.length > 0 ? (
        <>
          <p className="font-medium">מסמכי האתר שהאורח אישר בהזמנה:</p>
          <ul className="list-disc space-y-1 ps-5">
            {docs.data.map((d) => (
              <li key={d.kind}>
                {d.title} — גרסה {d.version}, אושרה {formatDateTime(d.accepted_at)}
              </li>
            ))}
          </ul>
        </>
      ) : docs.data ? (
        <p className="text-muted-foreground">
          לא נרשם אישור של מסמכי האתר בהזמנה הזו (לא פורסמו מסמכים בזמן ההזמנה, או שההזמנה לא נעשתה
          באתר). מדיניות הביטול שהאורח ראה נשמרה עם ההזמנה.
        </p>
      ) : null}
    </div>
  );
}
