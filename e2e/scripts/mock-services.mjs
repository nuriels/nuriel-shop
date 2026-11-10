// שרת מדומה לשירותים חיצוניים בבדיקות E2E — אף בקשה לא יוצאת החוצה:
//   • Resend (RESEND_API_URL): POST /emails → נשמר, לא נשלח
//       נמען עם "+reject" → 422 (הספק דחה); נמען עם "+bounce" → יתקבל, ואז last_event = bounced
//   • Resend: GET /emails/:id → { last_event } (delivered, או bounced לפי הנמען) — לבדיקת
//     הסטטוס האמיתי ("התקבל לשליחה" → "נמסר" רק אחרי אישור מסירה)
//   • Grow (GROW_SANDBOX_URL): כל בקשה → 503 (אין סליקה בבדיקות; תשלום = mock)
//   • GET /__calls → כל הבקשות שהתקבלו (לבדיקה שמייל "נשלח")
//   • NURIEL AI (AI_ASSISTANT_TEST_API_URL): POST /v1/messages → "דגם" דטרמיניסטי שמסווג לפי רשימת
//     המדריכים שבבקשה: המדריך הראשון שאחד הניסוחים שלו מופיע בשאלה; שאלה עם "מזג האוויר" → off_topic;
//     שאלה עם "תקלה בשירות" → 529. בלי מפתח אמיתי ובלי קריאה החוצה.
//     בקשת "הצעות למוצרים כפולים" (סכמה עם groups) → מקבץ מוצרים שיש להם אותן מילים בסדר אחר
//     (אותו מוצר בניסוח אחר); שמות זהים לא מוצעים (הם כבר ברשימה הרגילה).
import { createServer } from "node:http";

/** "דגם" מדומה להצעות כפילויות: אותן מילים בסדר אחר = אותו מוצר */
function duplicatesMock(request) {
  const message = String(request.messages?.at(-1)?.content ?? "");
  const block = /<products>\n([\s\S]*?)\n<\/products>/.exec(message)?.[1] ?? "";
  const byWords = new Map();
  for (const line of block.split("\n")) {
    const [n, name] = line.split(" | ");
    const number = Number(n);
    if (!Number.isInteger(number) || !name) continue;
    const exact = name.trim().toLowerCase().replace(/\s+/g, " ");
    const key = exact.split(" ").sort().join(" ");
    const list = byWords.get(key) ?? [];
    list.push({ number, exact });
    byWords.set(key, list);
  }
  const groups = [];
  for (const list of byWords.values()) {
    if (list.length >= 2 && new Set(list.map((x) => x.exact)).size > 1)
      groups.push({ items: list.map((x) => x.number), reason: "reworded", confidence: "high" });
  }
  return {
    id: "msg_e2e_duplicates",
    type: "message",
    role: "assistant",
    model: request.model,
    content: [{ type: "text", text: JSON.stringify({ groups }) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 900,
      output_tokens: 30,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

/** "דגם" מדומה: מסווג לפי הניסוחים (id | title | keywords | summary) שבהוראות */
function anthropicMock(body) {
  const request = JSON.parse(body);
  if (request.output_config?.format?.schema?.properties?.groups) return duplicatesMock(request);
  const system = (request.system ?? []).map((b) => b.text ?? "").join("\n");
  const message = String(request.messages?.at(-1)?.content ?? "");
  const question = (/<question>\n([\s\S]*?)\n<\/question>/.exec(message)?.[1] ?? "").trim();
  const allowed = new Set(
    request.output_config?.format?.schema?.properties?.guides?.items?.enum ?? [],
  );
  let topic = "off_topic";
  let guides = [];
  if (!/מזג האוויר|weather/.test(question)) {
    for (const line of system.split("\n")) {
      const [id, title, keywords] = line.split(" | ");
      if (!id || !allowed.has(id) || keywords === undefined) continue;
      const phrases = [title, ...keywords.split(", ")]
        .map((p) => p.trim())
        .filter((p) => p.length >= 3);
      if (phrases.some((p) => question.includes(p))) {
        topic = "site_help";
        guides = [id];
        break;
      }
    }
    if (guides.length === 0 && /איך|למה|איפה/.test(question)) topic = "site_help";
  }
  return {
    id: "msg_e2e",
    type: "message",
    role: "assistant",
    model: request.model,
    content: [{ type: "text", text: JSON.stringify({ topic, guides }) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 3000,
    },
  };
}

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
    if (req.method === "POST" && req.url === "/v1/messages") {
      if (/תקלה בשירות/.test(body))
        return json(res, 529, {
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        });
      try {
        return json(res, 200, anthropicMock(body));
      } catch {
        return json(res, 400, {
          type: "error",
          error: { type: "invalid_request_error", message: "bad request" },
        });
      }
    }
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
