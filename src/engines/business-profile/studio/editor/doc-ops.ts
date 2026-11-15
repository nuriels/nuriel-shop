// פעולות על מסמך האתר בעורך — טהורות (מחזירות מסמך חדש, לא משנות את הקיים), נבדקות ביחידה
import { BLOCK_DEFINITIONS, type BlockType } from "../../document/blocks";
import type { Block, JsonValue, LocalizedText, Page, SiteDocument } from "../../document/schema";
import { MAX_BLOCKS_PER_PAGE } from "../../document/schema";

export const homePage = (doc: SiteDocument): Page =>
  doc.pages.find((p) => p.slug === "") ?? doc.pages[0]!;

function withHome(doc: SiteDocument, change: (page: Page) => Page): SiteDocument {
  const home = homePage(doc);
  return { ...doc, pages: doc.pages.map((p) => (p.id === home.id ? change(p) : p)) };
}

export function moveBlock(doc: SiteDocument, id: string, delta: -1 | 1): SiteDocument {
  return withHome(doc, (page) => {
    const i = page.blocks.findIndex((b) => b.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= page.blocks.length) return page;
    const blocks = [...page.blocks];
    [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!];
    return { ...page, blocks };
  });
}

export function setBlockHidden(doc: SiteDocument, id: string, hidden: boolean): SiteDocument {
  return withHome(doc, (page) => ({
    ...page,
    blocks: page.blocks.map((b) => (b.id === id ? { ...b, hidden } : b)),
  }));
}

export function setBlockProp(
  doc: SiteDocument,
  id: string,
  key: string,
  value: JsonValue,
): SiteDocument {
  return withHome(doc, (page) => ({
    ...page,
    blocks: page.blocks.map((b) =>
      b.id === id ? { ...b, props: { ...b.props, [key]: value } } : b,
    ),
  }));
}

export function addBlock(doc: SiteDocument, type: BlockType): SiteDocument {
  return withHome(doc, (page) => {
    if (page.blocks.length >= MAX_BLOCKS_PER_PAGE) return page;
    const taken = new Set(page.blocks.map((b) => b.id));
    let n = 1;
    let id: string = type;
    while (taken.has(id)) id = `${type}-${++n}`;
    const block: Block = {
      id,
      type,
      v: BLOCK_DEFINITIONS[type].version,
      hidden: false,
      props: BLOCK_DEFINITIONS[type].defaults() as unknown as Record<string, JsonValue>,
    };
    return { ...page, blocks: [...page.blocks, block] };
  });
}

export function removeBlock(doc: SiteDocument, id: string): SiteDocument {
  return withHome(doc, (page) => ({ ...page, blocks: page.blocks.filter((b) => b.id !== id) }));
}

/** מזהה חדש לפריט ברשימה (שירות, המלצה, עבודה, קטגוריה) — קצר, ייחודי ברשימה */
export function newId(prefix: string, taken: readonly { id: string }[]): string {
  const ids = new Set(taken.map((x) => x.id));
  for (let i = taken.length + 1; ; i++) {
    const id = `${prefix}-${i}`;
    if (!ids.has(id)) return id;
  }
}

export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const j = index + delta;
  if (index < 0 || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[index], next[j]] = [next[j]!, next[index]!];
  return next;
}

export const he = (text: string): LocalizedText => ({ he: text });

/** העברית של טקסט, עם שמירה על האנגלית אם הוזנה */
export const setHe = (text: LocalizedText | undefined, value: string): LocalizedText => ({
  ...(text ?? { he: "" }),
  he: value,
});
