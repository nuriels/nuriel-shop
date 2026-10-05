import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Ban,
  Bold,
  Check,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Palette,
  Pilcrow,
  Redo2,
  RemoveFormatting,
  Underline,
  Undo2,
  Unlink,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  escapeHtml,
  RED_MARK_CLASS,
  RICH_TEXT_COLORS,
  sanitizeRichHtml,
  toRichHtml,
  type RichTextColor,
} from "@/lib/rich-text";
import { cn } from "@/lib/utils";

/**
 * עורך טקסט עשיר קליל — contentEditable עם סרגל כלים: מודגש / נטוי / קו
 * תחתון, כותרות, רשימות, קישור, ניקוי עיצוב, בטל / בצע שוב. הדבקה עוברת
 * ניקוי (מ-Word / אתרים אחרים נשאר רק המבנה).
 *
 *  • variant="legal" (העמודים המשפטיים, חלק 16א): כותרת + כותרת משנה (H2/H3),
 *    ו"סימון באדום" — טקסט אדום מודגש למקומות שבעל החנות צריך להשלים.
 *  • variant="product" (תיאור מוצר, חלק 19): מיני-כותרות (H3/H4) וצבעי טקסט
 *    מרשימה סגורה (RICH_TEXT_COLORS) — נשמרים כמחלקה, לא כצבע חופשי.
 *
 * הערך הוא HTML; הניקוי הסופי נעשה בשמירה ובכל הצגה (src/lib/rich-text.ts).
 */

export type RichEditorVariant = "legal" | "product";

const RED_SELECTOR = "span.text-red-500";
const COLOR_SELECTOR = RICH_TEXT_COLORS.map((color) => `span.${color.className}`).join(", ");

type ActiveState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  ul: boolean;
  ol: boolean;
  red: boolean;
  /** צבע הטקסט בסמן (מפתח מ-RICH_TEXT_COLORS) */
  color: string | null;
  block: string;
};

const IDLE: ActiveState = {
  bold: false,
  italic: false,
  underline: false,
  ul: false,
  ol: false,
  red: false,
  color: null,
  block: "p",
};

/** קישור תקין לעורך: אתר, מייל, טלפון או נתיב פנימי באתר */
function editorLinkValid(url: string): boolean {
  return /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+@[^\s<>"]+|tel:\+?[0-9-]{6,20}|\/[^\s<>"]*)$/i.test(
    url.trim(),
  );
}

function closestRed(node: Node | null, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.matches(RED_SELECTOR)) return current;
    current = current.parentNode;
  }
  return null;
}

/** הצבע (מהרשימה) של הטקסט בסמן — הקרוב ביותר */
function closestColor(node: Node | null, root: HTMLElement): RichTextColor | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.tagName === "SPAN") {
      const found = RICH_TEXT_COLORS.find(
        (color) => current instanceof HTMLElement && current.classList.contains(color.className),
      );
      if (found) return found;
    }
    current = current.parentNode;
  }
  return null;
}

function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

/** הצבע שהדפדפן שם בפקודת foreColor — הופך לסימון "אדום מודגש" שלנו */
const MARK_COLOR = "#ef4444";

/** "#abc" / "#aabbcc" / "rgb(1, 2, 3)" → "#aabbcc" (אחרת null) */
function toHex(value: string): string | null {
  const text = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(text);
  if (!rgb) return null;
  return `#${rgb
    .slice(1, 4)
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** הצבע מהדפדפן → המחלקה שלנו (סימון אדום / צבע מהרשימה), או null */
function classForColor(value: string): string | null {
  const hex = toHex(value);
  if (!hex) return null;
  if (hex === MARK_COLOR) return RED_MARK_CLASS;
  return RICH_TEXT_COLORS.find((color) => color.hex === hex)?.className ?? null;
}

function normalizeMarks(root: HTMLElement): void {
  const toSpan = (element: Element, className: string) => {
    const span = document.createElement("span");
    span.className = className;
    while (element.firstChild) span.appendChild(element.firstChild);
    element.replaceWith(span);
  };
  root.querySelectorAll("font").forEach((font) => {
    const className = classForColor(font.getAttribute("color") ?? "");
    if (className) toSpan(font, className);
    else unwrap(font);
  });
  root.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    const className = element.tagName === "SPAN" ? classForColor(element.style.color) : null;
    if (className) toSpan(element, className);
    else element.removeAttribute("style");
  });
  // סימון בתוך סימון — שכבה אחת מספיקה
  root.querySelectorAll(`${RED_SELECTOR} ${RED_SELECTOR}`).forEach(unwrap);
  // צבע בתוך אותו צבע — שכבה אחת מספיקה
  root.querySelectorAll<HTMLElement>(COLOR_SELECTOR).forEach((span) => {
    const parent = span.parentElement?.closest(COLOR_SELECTOR);
    if (parent && parent.className === span.className) unwrap(span);
  });
  // span ריק מעיצוב שנשאר אחרי עריכה
  root.querySelectorAll("span:not([class])").forEach(unwrap);
}

export function RichTextEditor({
  id,
  value,
  onChange,
  ariaLabel,
  placeholder = "כתבו כאן…",
  minHeight = 320,
  variant = "legal",
}: {
  id: string;
  /** HTML (או טקסט ישן — מומר אוטומטית) */
  value: string;
  onChange: (html: string) => void;
  ariaLabel: string;
  placeholder?: string;
  minHeight?: number;
  /** legal — עמודים משפטיים (H2/H3 + סימון באדום); product — תיאור מוצר (H3/H4 + צבעים) */
  variant?: RichEditorVariant;
}) {
  const isProduct = variant === "product";
  const headings = isProduct
    ? ([
        ["h3", "כותרת", Heading3],
        ["h4", "כותרת משנה", Heading4],
      ] as const)
    : ([
        ["h2", "כותרת", Heading2],
        ["h3", "כותרת משנה", Heading3],
      ] as const);
  const editorRef = useRef<HTMLDivElement>(null);
  /** ה-HTML האחרון שיצא מהעורך — כדי לא לדרוס את מה שהמשתמש מקליד */
  const lastEmitted = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [active, setActive] = useState<ActiveState>(IDLE);
  const [linkOpen, setLinkOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");

  // ערך חדש מבחוץ (טעינה / "שחזור ברירת מחדל") — נכתב לעורך
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastEmitted.current) return;
    editor.innerHTML = sanitizeRichHtml(toRichHtml(value));
    lastEmitted.current = value;
  }, [value]);

  const emit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const html = editor.innerHTML;
    lastEmitted.current = html;
    onChange(html);
  }, [onChange]);

  const refreshState = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    if (!editor.contains(selection.anchorNode)) return;
    const query = (command: string) => {
      try {
        return document.queryCommandState(command);
      } catch {
        return false;
      }
    };
    let block = "p";
    try {
      block = String(document.queryCommandValue("formatBlock") || "p").toLowerCase();
    } catch {
      block = "p";
    }
    setActive({
      bold: query("bold"),
      italic: query("italic"),
      underline: query("underline"),
      ul: query("insertUnorderedList"),
      ol: query("insertOrderedList"),
      red: closestRed(selection.anchorNode, editor) !== null,
      color: closestColor(selection.anchorNode, editor)?.key ?? null,
      block,
    });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", refreshState);
    return () => document.removeEventListener("selectionchange", refreshState);
  }, [refreshState]);

  const focusEditor = () => {
    const editor = editorRef.current;
    if (!editor) return false;
    if (document.activeElement !== editor) editor.focus();
    return true;
  };

  const run = (command: string, arg?: string) => {
    if (!focusEditor()) return;
    document.execCommand(command, false, arg);
    emit();
    refreshState();
  };

  const toggleRed = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      toast.message("סמנו קודם טקסט בתוך העורך");
      return;
    }
    // בתוך סימון קיים — מבטלים אותו
    const around = closestRed(range.commonAncestorContainer, editor);
    if (around) {
      unwrap(around);
      emit();
      refreshState();
      return;
    }
    if (range.collapsed) {
      toast.message("סמנו את הטקסט שיודגש באדום");
      return;
    }
    focusEditor();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("foreColor", false, MARK_COLOR);
    normalizeMarks(editor);
    emit();
    refreshState();
  };

  /** צבע טקסט מהרשימה על הטקסט המסומן (תיאור מוצר) */
  const applyColor = (color: RichTextColor) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      toast.message("סמנו קודם טקסט בתוך העורך");
      return;
    }
    if (range.collapsed) {
      toast.message("סמנו את הטקסט שייצבע");
      return;
    }
    focusEditor();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("foreColor", false, color.hex);
    normalizeMarks(editor);
    emit();
    refreshState();
  };

  /** הסרת הצבע מהטקסט המסומן (או מהמילה שהסמן בתוכה) */
  const removeColor = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const around = closestColor(range.commonAncestorContainer, editor);
    const spans = [...editor.querySelectorAll<HTMLElement>(COLOR_SELECTOR)].filter((span) =>
      range.intersectsNode(span),
    );
    if (around) {
      const element = range.commonAncestorContainer.parentElement?.closest(
        `span.${around.className}`,
      );
      if (element && !spans.includes(element as HTMLElement)) spans.push(element as HTMLElement);
    }
    spans.forEach(unwrap);
    emit();
    refreshState();
  };

  const clearFormatting = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    focusEditor();
    document.execCommand("removeFormat");
    document.execCommand("unlink");
    // גם סימוני האדום והצבעים שבתוך הבחירה
    editor.querySelectorAll(`${RED_SELECTOR}, ${COLOR_SELECTOR}`).forEach((mark) => {
      if (range.intersectsNode(mark)) unwrap(mark);
    });
    document.execCommand("formatBlock", false, "<p>");
    emit();
    refreshState();
  };

  const openLink = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (
      !editor ||
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed ||
      !editor.contains(selection.anchorNode)
    ) {
      toast.message("סמנו קודם את הטקסט שיהפוך לקישור");
      return;
    }
    savedRange.current = selection.getRangeAt(0).cloneRange();
    setLinkUrl("https://");
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!editorLinkValid(url)) {
      toast.error("כתובת לא תקינה — https://…, mailto:…, tel:… או נתיב באתר כמו /contact");
      return;
    }
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      focusEditor();
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    run("createLink", url);
    setLinkOpen(false);
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    if (html) {
      document.execCommand("insertHTML", false, sanitizeRichHtml(html));
    } else if (text.includes("\n")) {
      document.execCommand(
        "insertHTML",
        false,
        escapeHtml(text.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>"),
      );
    } else {
      document.execCommand("insertText", false, text);
    }
    emit();
  };

  return (
    <div className="overflow-hidden rounded-lg border border-input bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring">
      <div
        role="toolbar"
        aria-label={`עיצוב — ${ariaLabel}`}
        aria-controls={id}
        className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 p-1"
      >
        <ToolButton label="מודגש (Ctrl+B)" pressed={active.bold} onClick={() => run("bold")}>
          <Bold />
        </ToolButton>
        <ToolButton label="נטוי (Ctrl+I)" pressed={active.italic} onClick={() => run("italic")}>
          <Italic />
        </ToolButton>
        <ToolButton
          label="קו תחתון (Ctrl+U)"
          pressed={active.underline}
          onClick={() => run("underline")}
        >
          <Underline />
        </ToolButton>
        <Divider />
        {headings.map(([tag, label, Icon]) => (
          <ToolButton
            key={tag}
            label={label}
            pressed={active.block === tag}
            onClick={() => run("formatBlock", `<${tag}>`)}
          >
            <Icon />
          </ToolButton>
        ))}
        <ToolButton
          label="פסקה רגילה"
          pressed={active.block === "p"}
          onClick={() => run("formatBlock", "<p>")}
        >
          <Pilcrow />
        </ToolButton>
        <Divider />
        <ToolButton
          label="רשימת תבליטים"
          pressed={active.ul}
          onClick={() => run("insertUnorderedList")}
        >
          <List />
        </ToolButton>
        <ToolButton
          label="רשימה ממוספרת"
          pressed={active.ol}
          onClick={() => run("insertOrderedList")}
        >
          <ListOrdered />
        </ToolButton>
        <Divider />
        <ToolButton label="קישור" onClick={openLink}>
          <Link2 />
        </ToolButton>
        <ToolButton label="הסרת קישור" onClick={() => run("unlink")}>
          <Unlink />
        </ToolButton>
        <Divider />
        {isProduct ? (
          <ToolButton
            label="צבע טקסט"
            pressed={colorOpen || active.color !== null}
            onClick={() => setColorOpen((open) => !open)}
          >
            <Palette />
          </ToolButton>
        ) : (
          <ToolButton
            label="סימון באדום מודגש (מקום להשלמה) — לחיצה נוספת מבטלת"
            pressed={active.red}
            onClick={toggleRed}
            className="text-red-600 dark:text-red-400"
          >
            <Highlighter />
          </ToolButton>
        )}
        <ToolButton label="ניקוי עיצוב" onClick={clearFormatting}>
          <RemoveFormatting />
        </ToolButton>
        <Divider />
        <ToolButton label="בטל (Ctrl+Z)" onClick={() => run("undo")}>
          <Undo2 />
        </ToolButton>
        <ToolButton label="בצע שוב (Ctrl+Y)" onClick={() => run("redo")}>
          <Redo2 />
        </ToolButton>
      </div>

      {isProduct && colorOpen && (
        <div
          role="group"
          aria-label="צבע טקסט"
          data-rich-colors
          className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/20 p-2"
        >
          <span className="text-xs font-medium">צבע לטקסט המסומן:</span>
          {RICH_TEXT_COLORS.map((color) => (
            <button
              key={color.key}
              type="button"
              title={color.label}
              aria-label={`צבע ${color.label}`}
              aria-pressed={active.color === color.key}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyColor(color)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-semibold transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active.color === color.key ? "border-foreground" : "border-border",
              )}
            >
              <span className={cn("text-base leading-none", color.className)} aria-hidden="true">
                ●
              </span>
              <span className={color.className}>{color.label}</span>
            </button>
          ))}
          <button
            type="button"
            title="בלי צבע"
            onMouseDown={(event) => event.preventDefault()}
            onClick={removeColor}
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Ban className="size-3.5" aria-hidden="true" />
            בלי צבע
          </button>
        </div>
      )}

      {linkOpen && (
        <form
          className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <label htmlFor={`${id}-link`} className="text-xs font-medium">
            כתובת הקישור
          </label>
          <Input
            id={`${id}-link`}
            dir="ltr"
            autoFocus
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://… / mailto:… / tel:… / /contact"
            className="h-8 min-w-0 flex-1 basis-56 text-sm"
          />
          <Button type="submit" size="sm" className="h-8">
            <Check className="size-4" />
            הוספה
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setLinkOpen(false)}
          >
            <X className="size-4" />
            ביטול
          </Button>
        </form>
      )}

      <div
        id={id}
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        dir="rtl"
        data-placeholder={placeholder}
        className="rich-editor rich-content max-h-[70vh] overflow-y-auto px-4 py-3 text-sm text-foreground"
        style={{ minHeight }}
        onFocus={() => {
          try {
            document.execCommand("defaultParagraphSeparator", false, "p");
          } catch {
            // דפדפן ישן — לא קריטי
          }
        }}
        onInput={emit}
        onPaste={onPaste}
      />
    </div>
  );
}

function ToolButton({
  label,
  pressed,
  onClick,
  className,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      // שומר את הבחירה בעורך (בלי זה הלחיצה "גונבת" את הסמן)
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
        pressed && "bg-primary/15 text-primary",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />;
}
