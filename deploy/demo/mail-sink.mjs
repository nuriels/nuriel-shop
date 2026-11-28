#!/usr/bin/env node
// ===========================================================================================
// DEMO בלבד — "שרת דמה למיילים" לשרת ה-DEMO של MAX/Hyp (docs/payment-gateways/DEMO-SERVER-GUIDE.md).
// מחליף את Resend: כל מייל שהאפליקציה שולחת נשמר כאן בזיכרון ולא יוצא לשום מקום.
//
//   POST /emails        → נשמר (רק 200 האחרונים, בזיכרון; אתחול = הכול נמחק). מחזיר { id }
//   GET  /emails/:id    → { last_event: "delivered" } (כמו Resend, לבדיקת מסירה)
//   GET  /domains       → רשימה ריקה (אין דומיינים מאומתים ב-DEMO)
//   GET  /__mail        → למפעיל: המיילים האחרונים, טקסט בלבד. ?to=<כתובת> ?limit=<1–50>
//   GET  /__health      → ok
//
// הפורט לא נחשף מחוץ לרשת של docker (deploy/demo/compose.demo.yml: expose בלבד).
// קריאת המיילים — רק מתוך השרת, למשל:
//   docker exec nuriel-demo-mailsink node -e "fetch('http://127.0.0.1:4025/__mail?limit=3').then(r=>r.text()).then(console.log)"
// היומן מדפיס רק מזהה ומספר נמענים — לא כתובות, לא נושא ולא תוכן (יש בהם קודי אימות).
// Node מובנה בלבד, בלי חבילות.
// ===========================================================================================
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const KEEP = 200;
const MAX_BODY_BYTES = 20 * 1024 * 1024; // מיילים עם קבצים מצורפים (PDF) — התוכן של הקבצים לא נשמר
const TEXT_LIMIT = 4000;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** HTML → טקסט קריא (כדי לקרוא קוד אימות מתוך המייל). לא מנסה להיות מושלם. */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ENTITIES[name] ?? " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, TEXT_LIMIT);
}

function toList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/** שרת ה-sink (לא מאזין עד שקוראים ל-listen). log — פונקציה לשורת יומן אחת (ברירת מחדל: console.log). */
export function createMailSink({ log = (line) => console.log(line) } = {}) {
  /** @type {{ id: string, at: string, from: string, to: string[], subject: string, text: string, attachments: { filename: string, bytes: number }[] }[]} */
  const messages = [];
  let counter = 0;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mail-sink.invalid");
    const path = url.pathname;

    if (req.method === "GET" && path === "/__health") return send(res, 200, { ok: true });

    if (req.method === "POST" && path === "/emails") {
      if (!/^Bearer \S+/.test(String(req.headers.authorization ?? ""))) {
        return send(res, 401, { name: "missing_api_key", message: "Missing API key" });
      }
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          tooLarge = true;
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("error", () => {
        if (tooLarge && !res.headersSent)
          send(res, 413, { name: "too_large", message: "Body too large" });
      });
      req.on("end", () => {
        if (tooLarge) return send(res, 413, { name: "too_large", message: "Body too large" });
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return send(res, 400, { name: "invalid_json", message: "Invalid JSON" });
        }
        const to = toList(body?.to);
        if (
          !body ||
          typeof body !== "object" ||
          to.length === 0 ||
          typeof body.subject !== "string"
        ) {
          return send(res, 422, {
            name: "validation_error",
            message: "to and subject are required",
          });
        }
        counter += 1;
        const id = `demo_${counter}_${randomBytes(4).toString("hex")}`;
        messages.push({
          id,
          at: new Date().toISOString(),
          from: String(body.from ?? "").slice(0, 300),
          to,
          subject: body.subject.slice(0, 300),
          text: htmlToText(body.html ?? body.text ?? ""),
          attachments: Array.isArray(body.attachments)
            ? body.attachments.map((a) => ({
                filename: String(a?.filename ?? "").slice(0, 200),
                bytes: typeof a?.content === "string" ? Math.floor((a.content.length * 3) / 4) : 0,
              }))
            : [],
        });
        while (messages.length > KEEP) messages.shift();
        log(`[mail-sink] kept ${id} (${to.length} recipient${to.length === 1 ? "" : "s"})`);
        return send(res, 200, { id });
      });
      return;
    }

    if (req.method === "GET" && path.startsWith("/emails/")) {
      const id = decodeURIComponent(path.slice("/emails/".length));
      const found = messages.find((m) => m.id === id);
      if (!found) return send(res, 404, { name: "not_found", message: "Email not found" });
      return send(res, 200, { object: "email", id, last_event: "delivered", created_at: found.at });
    }

    if (req.method === "GET" && path === "/domains")
      return send(res, 200, { object: "list", data: [] });

    if (req.method === "GET" && path === "/__mail") {
      const to = (url.searchParams.get("to") ?? "").trim().toLowerCase();
      const limit = Math.min(
        50,
        Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "10", 10) || 10),
      );
      const list = messages
        .filter((m) => !to || m.to.some((address) => address.toLowerCase().includes(to)))
        .slice(-limit)
        .reverse();
      return send(res, 200, { count: list.length, messages: list });
    }

    return send(res, 404, { name: "not_found", message: "Not found" });
  });

  return { server, messages };
}

// הרצה ישירה (בקונטיינר של DEMO): node deploy/demo/mail-sink.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.MAIL_SINK_PORT ?? "4025", 10);
  const host = process.env.MAIL_SINK_HOST ?? "0.0.0.0";
  const { server } = createMailSink();
  server.listen(port, host, () =>
    console.log(`[mail-sink] DEMO mail sink listening on ${host}:${port} — nothing is sent`),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
