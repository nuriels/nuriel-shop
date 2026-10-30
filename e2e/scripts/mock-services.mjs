// שרת מדומה לשירותים חיצוניים בבדיקות E2E — אף בקשה לא יוצאת החוצה:
//   • Resend (RESEND_API_URL): POST /emails → נשמר, לא נשלח
//   • Grow (GROW_SANDBOX_URL): כל בקשה → 503 (אין סליקה בבדיקות; תשלום = mock)
//   • GET /__calls → כל הבקשות שהתקבלו (לבדיקה שמייל "נשלח")
import { createServer } from "node:http";

const port = Number(process.env.MOCK_PORT ?? 4010);
const calls = [];

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method === "GET" && req.url === "/__calls") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(calls));
    }
    calls.push({ method: req.method, url: req.url, body: body.slice(0, 2000), at: Date.now() });
    if (req.url?.startsWith("/emails")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id: `mock-${calls.length}` }));
    }
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "payments are mocked in e2e" }));
  });
}).listen(port, "127.0.0.1", () => console.log(`mock services on :${port}`));
