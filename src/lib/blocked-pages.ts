// עמודי חסימה — משותפים לשרת (src/server.ts מחזיר אותם כ-HTML עם סטטוס 403
// בטעינה ראשונה) ולדפדפן (הנתיבים /locked ו-/forbidden בניווט פנימי).

export type BlockedPage = { title: string; message: string; note: string };

export const SUSPENDED_PAGE: BlockedPage = {
  title: "האתר נעול זמנית",
  message: "האתר אינו זמין כרגע. ניתן לחזור ולנסות מאוחר יותר.",
  note: "בעל האתר? היכנסו לפאנל הניהול כדי להסדיר את המנוי.",
};

export const FORBIDDEN_PAGE: BlockedPage = {
  title: "אין הרשאת גישה",
  message: "העמוד הזה זמין רק למנהלי הפלטפורמה.",
  note: "אם הגעתם לכאן בטעות — חזרו לדף הבית.",
};

/** נתיבים שזמינים גם בחנות מוקפאת: פאנל הניהול של החנות, התחברות, ועמוד הנעילה */
export const SUSPENDED_ALLOWED_PATHS = /^\/(admin|login|reset-password|locked)(\/|$)/;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** HTML עצמאי (בלי האפליקציה) — לתשובת 403 מהשרת */
export function renderBlockedPageHtml(page: BlockedPage, links: { href: string; label: string }[]) {
  const buttons = links
    .map((l) => `<a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`)
    .join("");
  return `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(page.title)}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem;
             font: 16px/1.6 Heebo, system-ui, -apple-system, sans-serif; background: #f6f7f9; color: #12211f; }
      .card { max-width: 30rem; width: 100%; background: #fff; border-radius: 16px; padding: 2.5rem 2rem;
              box-shadow: 0 10px 30px rgba(18, 33, 31, 0.08); text-align: center; }
      .icon { width: 64px; height: 64px; margin: 0 auto 1.25rem; border-radius: 50%; background: #fdecea;
              display: grid; place-items: center; font-size: 30px; }
      .code { font-size: 0.8rem; letter-spacing: 0.15em; color: #b42318; font-weight: 700; }
      h1 { font-size: 1.6rem; margin: 0.25rem 0 0.75rem; }
      p { margin: 0 0 0.75rem; color: #475467; }
      .note { font-size: 0.9rem; color: #667085; }
      .actions { margin-top: 1.5rem; display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a { display: inline-block; padding: 0.6rem 1.2rem; border-radius: 10px; text-decoration: none;
          background: #12211f; color: #fff; font-weight: 600; }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="icon">🔒</div>
      <div class="code">403</div>
      <h1>${escapeHtml(page.title)}</h1>
      <p>${escapeHtml(page.message)}</p>
      <p class="note">${escapeHtml(page.note)}</p>
      <div class="actions">${buttons}</div>
    </main>
  </body>
</html>`;
}
