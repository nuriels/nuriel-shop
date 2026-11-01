// הפרמטרים של עמוד ההזמנה בכתובת (/stay/book?unit=…&from=…&to=…&adults=…&children=…)

export interface BookSearch {
  unit?: string;
  /** סוג חדר (מלון) — slug */
  type?: string;
  from?: string;
  to?: string;
  adults?: number;
  children?: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** הפרמטרים בכתובת (/stay/book?unit=…&from=…&to=…) — רק ערכים תקינים */
export function validateBookSearch(raw: Record<string, unknown>): BookSearch {
  const out: BookSearch = {};
  if (typeof raw["unit"] === "string" && raw["unit"].length <= 200) out.unit = raw["unit"];
  if (typeof raw["type"] === "string" && raw["type"].length <= 200) out.type = raw["type"];
  if (typeof raw["from"] === "string" && ISO.test(raw["from"])) out.from = raw["from"];
  if (typeof raw["to"] === "string" && ISO.test(raw["to"])) out.to = raw["to"];
  const n = (v: unknown, min: number) => {
    const x = Number(v);
    return Number.isInteger(x) && x >= min && x <= 50 ? x : undefined;
  };
  const adults = n(raw["adults"], 1);
  const children = n(raw["children"], 0);
  if (adults !== undefined) out.adults = adults;
  if (children !== undefined) out.children = children;
  return out;
}
