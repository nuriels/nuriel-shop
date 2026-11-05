// שרת מדומה לשירותים חיצוניים בבדיקות E2E — אף בקשה לא יוצאת החוצה:
//   • Resend (RESEND_API_URL): POST /emails → נשמר, לא נשלח
//       נמען עם "+reject" → 422 (הספק דחה); נמען עם "+bounce" → יתקבל, ואז last_event = bounced
//   • Resend: GET /emails/:id → { last_event } (delivered, או bounced לפי הנמען) — לבדיקת
//     הסטטוס האמיתי ("התקבל לשליחה" → "נמסר" רק אחרי אישור מסירה)
//   • Grow (GROW_SANDBOX_URL): כל בקשה → 503 (אין סליקה בבדיקות; תשלום = mock)
//   • GET /__calls → כל הבקשות שהתקבלו (לבדיקה שמייל "נשלח")
import { createServer } from "node:http";

const port = Number(process.env.MOCK_PORT ?? 4010);
const calls = [];
/** מזהה מייל → האירוע האחרון שהספק "מדווח" עליו */
const emailEvents = new Map();
const json = (res, status, value) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};
const recipientsOf = (body) => {
  try {
    const to = JSON.parse(body).to;
    return (Array.isArray(to) ? to : [to]).map((a) => String(a ?? ""));
  } catch {
    return [];
  }
};

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method === "GET" && req.url === "/__calls") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(calls));
    }
    if (req.method === "GET" && req.url?.startsWith("/emails/")) {
      const id = decodeURIComponent(req.url.slice("/emails/".length));
      const event = emailEvents.get(id);
      if (!event) return json(res, 404, { name: "not_found", message: "Email not found" });
      return json(res, 200, { object: "email", id, last_event: event });
    }
    // גוף מלא (מיילים עם קבצים מצורפים) — עד 5MB
    calls.push({
      method: req.method,
      url: req.url,
      body: body.slice(0, 5_000_000),
      at: Date.now(),
    });
    if (req.url?.startsWith("/emails")) {
      const to = recipientsOf(body);
      if (to.some((a) => a.includes("+reject"))) {
        return json(res, 422, {
          name: "validation_error",
          message: "Invalid `to` field (e2e mock)",
        });
      }
      const id = `mock-${calls.length}`;
      emailEvents.set(id, to.some((a) => a.includes("+bounce")) ? "bounced" : "delivered");
      return json(res, 200, { id });
    }
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "payments are mocked in e2e" }));
  });
}).listen(port, "127.0.0.1", () => console.log(`mock services on :${port}`));
