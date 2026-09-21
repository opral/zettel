import {
  $applyNodeReplacement,
  ElementNode,
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  LexicalNode,
  TextNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import {
  Block,
  Break,
  Code,
  generateKey,
  Html,
  Image,
  Inline,
  InlineHtml,
  Link,
  List,
  ListItem,
  Quote,
  Rule,
  Span,
  Table,
  TableCell,
  TableRow,
  TextBlock,
  isNode,
} from "../types.js";

export type ZettelNodeData = Block | Inline;
type SerializedZettelNode = SerializedLexicalNode & Record<string, unknown>;

const MARK_FORMATS: Record<string, number> = {
  strong: IS_BOLD,
  bold: IS_BOLD,
  em: IS_ITALIC,
  italic: IS_ITALIC,
  "strike-through": IS_STRIKETHROUGH,
  strikethrough: IS_STRIKETHROUGH,
  code: IS_CODE,
};

const FORMAT_MARKS: Array<[number, string]> = [
  [IS_BOLD, "strong"],
  [IS_ITALIC, "em"],
  [IS_STRIKETHROUGH, "strike-through"],
  [IS_CODE, "code"],
];

function hasDOM(): boolean {
  return typeof document !== "undefined";
}

function element(tag: string, className: string, key: string): HTMLElement {
  if (!hasDOM()) {
    // Lexical only calls createDOM when an editor has a root element.  Giving
    // headless callers a useful error is preferable to a cryptic ReferenceError.
    throw new Error("Zettel Lexical DOM rendering requires a document");
  }
  const result = document.createElement(tag);
  result.className = className;
  result.dataset.zettelKey = key;
  return result;
}

function cloneWithoutChildren<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const result = { ...value };
  delete result.children;
  delete result.blocks;
  delete result.items;
  delete result.cells;
  delete result.code;
  return result;
}

function jsonFor(node: LexicalNode, zettel: Record<string, unknown>, children: SerializedLexicalNode[] = []): SerializedZettelNode {
  return { type: node.getType(), version: 1, ...zettel, ...(children.length || node instanceof ElementNode ? { children } : {}) };
}

function textFormatFor(marks: string[]): number {
  return marks.reduce((format, mark) => format | (MARK_FORMATS[mark] ?? 0), 0);
}

function marksForFormat(format: number): string[] {
  return FORMAT_MARKS.filter(([flag]) => Boolean(format & flag)).map(([, mark]) => mark);
}

function preserveMarkOrder(original: string[], format: number): string[] {
  const active = new Set(marksForFormat(format));
  const emitted = new Set<string>();
  const result: string[] = [];
  for (const mark of original) {
    const canonical = MARK_FORMATS[mark] === undefined ? mark : FORMAT_MARKS.find(([flag]) => flag === MARK_FORMATS[mark])?.[1];
    if (canonical === undefined || !active.has(canonical)) {
      if (MARK_FORMATS[mark] === undefined) result.push(mark);
      continue;
    }
    if (!emitted.has(canonical)) {
      result.push(canonical);
      emitted.add(canonical);
    }
  }
  for (const mark of active) if (!emitted.has(mark)) result.push(mark);
  return result;
}

function markClass(marks: string[]): string {
  return marks.length ? ` zettel-marks-${marks.join("-")}` : "";
}

function decoratorTag(marks: string[]): string | undefined {
  if (marks.includes("strong")) return "strong";
  if (marks.includes("em")) return "em";
  if (marks.includes("strike-through")) return "del";
  if (marks.includes("code")) return "code";
  return undefined;
}

function applyMarkStyles(node: HTMLElement, marks: string[]): void {
  node.style.fontWeight = marks.includes("strong") ? "700" : "";
  node.style.fontStyle = marks.includes("em") ? "italic" : "";
  node.style.textDecoration = marks.includes("strike-through") ? "line-through" : "";
  node.style.fontFamily = marks.includes("code") ? "ui-monospace, SFMono-Regular, Consolas, monospace" : "";
}

function safeImageUrl(value: string): string {
  try {
    const protocol = new URL(value, typeof location === "undefined" ? "https://zettel.invalid" : location.href).protocol;
    return protocol === "http:" || protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}

function safeLinkUrl(value: string): string {
  try {
    const protocol = new URL(value, typeof location === "undefined" ? "https://zettel.invalid" : location.href).protocol;
    return ["http:", "https:", "mailto:", "tel:"].includes(protocol) ? value : "";
  } catch {
    return "";
  }
}

export class ZettelSpanNode extends TextNode {
  readonly zettel_key: string;
  private zettelMarks: string[];
  private source?: Span;
  private sourceText?: string;
  private linkHref?: string;

  constructor(data: Partial<Span> & { text?: string }, key?: NodeKey) {
    super(data.text ?? "", key);
    this.zettel_key = data.zettel_key ?? generateKey();
    this.zettelMarks = [...(data.marks ?? [])];
    this.source = data.type === "zettel_span" && typeof data.text === "string" && Array.isArray(data.marks) && typeof data.zettel_key === "string" ? data as Span : undefined;
    this.sourceText = data.text;
    // Lexical's built-in formatting makes keyboard and toolbar formatting work;
    // the AST-facing names remain in zettelMarks and are emitted below.
    this.__format = textFormatFor(this.zettelMarks);
  }

  static getType(): string { return "zettel_span"; }
  static clone(node: ZettelSpanNode): ZettelSpanNode {
    const result = new ZettelSpanNode({ zettel_key: node.zettel_key, text: node.__text, marks: node.zettelMarks }, node.__key);
    result.linkHref = node.linkHref;
    return result;
  }
  static importJSON(node: SerializedZettelNode): ZettelSpanNode {
    return new ZettelSpanNode({
      type: "zettel_span",
      zettel_key: typeof node.zettel_key === "string" ? node.zettel_key : undefined,
      text: typeof node.text === "string" ? node.text : "",
      marks: Array.isArray(node.marks) ? node.marks.filter((mark): mark is string => typeof mark === "string") : [],
    });
  }
  getMarks(): string[] { return [...this.zettelMarks]; }
  setMarks(marks: string[]): this {
    const writable = this.getWritable();
    writable.zettelMarks = [...marks];
    writable.__format = textFormatFor(marks);
    return writable;
  }
  setLinkHref(href: string | undefined): this { this.linkHref = href; return this; }
  private resolvedLinkHref(): string | undefined {
    if (this.linkHref !== undefined) return this.linkHref;
    const parent = this.getParent();
    if (parent instanceof ZettelTextBlockNode || parent instanceof ZettelTableCellNode) {
      return this.toZettel().marks.map((mark) => parent.markDefs.find((definition) => definition.zettel_key === mark)?.href).find(Boolean);
    }
    return undefined;
  }
  toZettel(): Span {
    const marks = preserveMarkOrder(this.zettelMarks, this.getFormat());
    if (this.source && this.sourceText === this.getTextContent() && marks.join("\u0000") === this.source.marks.join("\u0000")) return this.source;
    return { type: "zettel_span", zettel_key: this.zettel_key, text: this.getTextContent(), marks };
  }
  override exportJSON(): any { return jsonFor(this, this.toZettel() as unknown as Record<string, unknown>); }
  override createDOM(_config: EditorConfig): HTMLElement {
    const marks = this.toZettel().marks;
    const decorator = decoratorTag(marks);
    const linkHref = this.resolvedLinkHref();
    const tag = linkHref ? "a" : decorator ?? "span";
    const span = element(tag, "zettel_span", this.zettel_key);
    if (linkHref) span.setAttribute("href", safeLinkUrl(linkHref));
    span.className += markClass(this.toZettel().marks);
    if (marks.length) span.dataset.zettelMarks = marks.join(" ");
    const content = linkHref && decorator ? document.createElement(decorator) : span;
    applyMarkStyles(content, marks);
    content.textContent = this.getTextContent();
    if (content !== span) span.append(content);
    return span;
  }
  override updateDOM(_prevNode: ZettelSpanNode, dom: HTMLElement): boolean {
    const marks = this.toZettel().marks;
    const decorator = decoratorTag(marks);
    const linkHref = this.resolvedLinkHref();
    const expectedTag = linkHref ? "a" : decorator ?? "span";
    if (dom.tagName.toLowerCase() !== expectedTag) return true;
    const content = linkHref && decorator ? dom.firstElementChild as HTMLElement | null : dom;
    if (!content || (decorator && content.tagName.toLowerCase() !== decorator)) return true;
    if (linkHref) dom.setAttribute("href", safeLinkUrl(linkHref));
    else dom.removeAttribute("href");
    dom.className = `zettel_span${markClass(marks)}`;
    if (marks.length) dom.dataset.zettelMarks = marks.join(" ");
    else delete dom.dataset.zettelMarks;
    applyMarkStyles(content, marks);
    content.textContent = this.getTextContent();
    return false;
  }
  override exportDOM(_editor: LexicalEditor): DOMExportOutput { return { element: this.createDOM({} as EditorConfig) }; }
}

export class ZettelTextBlockNode extends ElementNode {
  readonly zettel_key: string;
  style: TextBlock["style"];
  markDefs: Link[];

  constructor(data: Partial<TextBlock> & { type?: string }, key?: NodeKey) {
    super(key);
    this.zettel_key = data.zettel_key ?? generateKey();
    this.style = data.style ?? "normal";
    this.markDefs = data.markDefs ?? [];
  }
  static getType(): string { return "zettel_text"; }
  static clone(node: ZettelTextBlockNode): ZettelTextBlockNode {
    return new ZettelTextBlockNode({ type: "zettel_text", zettel_key: node.zettel_key, style: node.style, markDefs: node.markDefs }, node.__key);
  }
  static importJSON(node: SerializedZettelNode): ZettelTextBlockNode {
    return new ZettelTextBlockNode(node as unknown as TextBlock);
  }
  toZettel(): TextBlock {
    return {
      type: "zettel_text",
      zettel_key: this.zettel_key,
      style: this.style,
      children: this.getChildren().flatMap(exportInlineNode),
      markDefs: this.markDefs,
    };
  }
  override exportJSON(): any {
    return jsonFor(this, { type: "zettel_text", zettel_key: this.zettel_key, style: this.style, markDefs: this.markDefs });
  }
  override createDOM(_config: EditorConfig): HTMLElement {
    const tag = this.style === "normal" ? "p" : this.style;
    const result = element(tag, "zettel_text", this.zettel_key);
    result.dataset.zettelStyle = this.style;
    return result;
  }
}

export class ZettelBreakNode extends ElementNode {
  readonly zettel_key: string;
  marks: string[];
  constructor(data: Partial<Break>, key?: NodeKey) { super(key); this.zettel_key = data.zettel_key ?? generateKey(); this.marks = [...(data.marks ?? [])]; }
  static getType(): string { return "zettel_break"; }
  static clone(node: ZettelBreakNode): ZettelBreakNode { return new ZettelBreakNode({ zettel_key: node.zettel_key, marks: node.marks }, node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelBreakNode { return new ZettelBreakNode(node as unknown as Break); }
  override isInline(): boolean { return true; }
  toZettel(): Break { return { type: "zettel_break", zettel_key: this.zettel_key, marks: [...this.marks] }; }
  override exportJSON(): any { return jsonFor(this, this.toZettel() as unknown as Record<string, unknown>); }
  override createDOM(_config: EditorConfig): HTMLElement { return element("br", "zettel_break", this.zettel_key); }
  override exportDOM(_editor: LexicalEditor): DOMExportOutput { return { element: this.createDOM({} as EditorConfig) }; }
}

export class ZettelImageNode extends ElementNode {
  readonly zettel_key: string;
  src: string;
  alt: string;
  title?: string;
  marks: string[];
  private linkHref?: string;
  constructor(data: Partial<Image>, key?: NodeKey) { super(key); this.zettel_key = data.zettel_key ?? generateKey(); this.src = data.src ?? ""; this.alt = data.alt ?? ""; this.title = data.title; this.marks = [...(data.marks ?? [])]; }
  static getType(): string { return "zettel_image"; }
  static clone(node: ZettelImageNode): ZettelImageNode { const result = new ZettelImageNode(node.toZettel(), node.__key); result.linkHref = node.linkHref; return result; }
  static importJSON(node: SerializedZettelNode): ZettelImageNode { return new ZettelImageNode(node as unknown as Image); }
  override isInline(): boolean { return true; }
  setLinkHref(href: string | undefined): this { this.linkHref = href; return this; }
  toZettel(): Image { const image: Image = { type: "zettel_image", zettel_key: this.zettel_key, src: this.src, alt: this.alt, marks: [...this.marks] }; if (this.title !== undefined) image.title = this.title; return image; }
  override exportJSON(): any { return jsonFor(this, this.toZettel() as unknown as Record<string, unknown>); }
  override createDOM(_config: EditorConfig): HTMLElement { const wrapper = element(this.linkHref ? "a" : "span", "zettel_image", this.zettel_key); if (this.linkHref) wrapper.setAttribute("href", safeLinkUrl(this.linkHref)); const image = document.createElement("img"); image.src = safeImageUrl(this.src); image.alt = this.alt; if (this.title !== undefined) image.title = this.title; wrapper.append(image); return wrapper; }
  override exportDOM(_editor: LexicalEditor): DOMExportOutput { return { element: this.createDOM({} as EditorConfig) }; }
}

export class ZettelInlineHtmlNode extends ElementNode {
  readonly zettel_key: string;
  value: string;
  marks: string[];
  constructor(data: Partial<InlineHtml>, key?: NodeKey) { super(key); this.zettel_key = data.zettel_key ?? generateKey(); this.value = data.value ?? ""; this.marks = [...(data.marks ?? [])]; }
  static getType(): string { return "zettel_html_inline"; }
  static clone(node: ZettelInlineHtmlNode): ZettelInlineHtmlNode { return new ZettelInlineHtmlNode(node.toZettel(), node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelInlineHtmlNode { return new ZettelInlineHtmlNode(node as unknown as InlineHtml); }
  override isInline(): boolean { return true; }
  toZettel(): InlineHtml { return { type: "zettel_html_inline", zettel_key: this.zettel_key, value: this.value, marks: [...this.marks] }; }
  override exportJSON(): any { return jsonFor(this, this.toZettel() as unknown as Record<string, unknown>); }
  override createDOM(_config: EditorConfig): HTMLElement { const span = element("span", "zettel_html_inline", this.zettel_key); span.dataset.zettelReadonly = "true"; span.contentEditable = "false"; span.textContent = this.value; return span; }
  override canInsertTextBefore(): boolean { return false; }
  override canInsertTextAfter(): boolean { return false; }
}

abstract class ZettelBlockNode extends ElementNode {
  readonly zettel_key: string;
  constructor(keyValue: string | undefined, key?: NodeKey) { super(key); this.zettel_key = keyValue ?? generateKey(); }
}

export class ZettelListNode extends ZettelBlockNode {
  kind: List["kind"]; start?: number; spread: boolean;
  constructor(data: Partial<List>, key?: NodeKey) { super(data.zettel_key, key); this.kind = data.kind ?? "bullet"; this.start = data.start; this.spread = data.spread ?? false; }
  static getType(): string { return "zettel_list"; }
  static clone(node: ZettelListNode): ZettelListNode { return new ZettelListNode(node.toZettel(), node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelListNode { return new ZettelListNode(node as unknown as List); }
  toZettel(): List { const result: List = { type: "zettel_list", zettel_key: this.zettel_key, kind: this.kind, spread: this.spread, items: this.getChildren().filter((child): child is ZettelListItemNode => child instanceof ZettelListItemNode).map((child) => child.toZettel()) }; if (this.kind === "number") result.start = this.start ?? 1; return result; }
  override exportJSON(): any { return jsonFor(this, cloneWithoutChildren(this.toZettel() as unknown as Record<string, unknown>)); }
  override createDOM(_config: EditorConfig): HTMLElement { const list = element(this.kind === "number" ? "ol" : "ul", "zettel_list", this.zettel_key); if (this.kind === "number") (list as HTMLOListElement).start = this.start ?? 1; list.dataset[this.spread ? "spread" : "tight"] = "true"; return list; }
}

export class ZettelListItemNode extends ZettelBlockNode {
  spread: boolean; checked?: boolean;
  constructor(data: Partial<ListItem>, key?: NodeKey) { super(data.zettel_key, key); this.spread = data.spread ?? false; this.checked = data.checked; }
  static getType(): string { return "zettel_list_item"; }
  static clone(node: ZettelListItemNode): ZettelListItemNode { return new ZettelListItemNode(node.toZettel(), node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelListItemNode { return new ZettelListItemNode(node as unknown as ListItem); }
  toZettel(): ListItem { const result: ListItem = { type: "zettel_list_item", zettel_key: this.zettel_key, blocks: this.getChildren().map(exportBlockNode), spread: this.spread }; if (this.checked !== undefined) result.checked = this.checked; return result; }
  override exportJSON(): any { return jsonFor(this, cloneWithoutChildren(this.toZettel() as unknown as Record<string, unknown>)); }
  override createDOM(_config: EditorConfig): HTMLElement { const item = element("li", "zettel_list_item", this.zettel_key); if (this.checked !== undefined) { item.dataset.checked = String(this.checked); const input = document.createElement("input"); input.type = "checkbox"; input.checked = this.checked; item.append(input); } item.dataset[this.spread ? "spread" : "tight"] = "true"; return item; }
}

export class ZettelQuoteNode extends ZettelBlockNode {
  constructor(data: Partial<Quote>, key?: NodeKey) { super(data.zettel_key, key); }
  static getType(): string { return "zettel_quote"; }
  static clone(node: ZettelQuoteNode): ZettelQuoteNode { return new ZettelQuoteNode({ type: "zettel_quote", zettel_key: node.zettel_key, blocks: [] }, node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelQuoteNode { return new ZettelQuoteNode(node as unknown as Quote); }
  toZettel(): Quote { return { type: "zettel_quote", zettel_key: this.zettel_key, blocks: this.getChildren().map(exportBlockNode) }; }
  override exportJSON(): any { return jsonFor(this, { type: "zettel_quote", zettel_key: this.zettel_key }); }
  override createDOM(_config: EditorConfig): HTMLElement { return element("blockquote", "zettel_quote", this.zettel_key); }
}

export class ZettelCodeNode extends ZettelBlockNode {
  code: string; language?: string; meta?: string;
  constructor(data: Partial<Code>, key?: NodeKey) { super(data.zettel_key, key); this.code = data.code ?? ""; this.language = data.language; this.meta = data.meta; }
  static getType(): string { return "zettel_code"; }
  static clone(node: ZettelCodeNode): ZettelCodeNode { return new ZettelCodeNode(node.toZettel(), node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelCodeNode { return new ZettelCodeNode(node as unknown as Code); }
  toZettel(): Code { const result: Code = { type: "zettel_code", zettel_key: this.zettel_key, code: this.getChildren().length ? this.getTextContent() : this.code }; if (this.language !== undefined) result.language = this.language; if (this.meta !== undefined) result.meta = this.meta; return result; }
  override exportJSON(): any { return jsonFor(this, { type: "zettel_code", zettel_key: this.zettel_key, code: this.code, ...(this.language === undefined ? {} : { language: this.language }), ...(this.meta === undefined ? {} : { meta: this.meta }) }); }
  override createDOM(_config: EditorConfig): HTMLElement { const pre = element("pre", "zettel_code", this.zettel_key); if (this.language) pre.dataset.language = this.language; return pre; }
}

export class ZettelRuleNode extends ZettelBlockNode {
  constructor(data: Partial<Rule>, key?: NodeKey) { super(data.zettel_key, key); }
  static getType(): string { return "zettel_rule"; }
  static clone(node: ZettelRuleNode): ZettelRuleNode { return new ZettelRuleNode({ type: "zettel_rule", zettel_key: node.zettel_key }, node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelRuleNode { return new ZettelRuleNode(node as unknown as Rule); }
  toZettel(): Rule { return { type: "zettel_rule", zettel_key: this.zettel_key }; }
  override exportJSON(): any { return jsonFor(this, this.toZettel() as unknown as Record<string, unknown>); }
  override createDOM(_config: EditorConfig): HTMLElement { return element("hr", "zettel_rule", this.zettel_key); }
}

export class ZettelTableNode extends ZettelBlockNode {
  align: Table["align"];
  constructor(data: Partial<Table>, key?: NodeKey) { super(data.zettel_key, key); this.align = data.align ?? []; }
  static getType(): string { return "zettel_table"; }
  static clone(node: ZettelTableNode): ZettelTableNode { return new ZettelTableNode(node.toZettel(), node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelTableNode { return new ZettelTableNode(node as unknown as Table); }
  toZettel(): Table { return { type: "zettel_table", zettel_key: this.zettel_key, align: [...this.align], rows: this.getChildren().filter((child): child is ZettelTableRowNode => child instanceof ZettelTableRowNode).map((child) => child.toZettel()) }; }
  override exportJSON(): any { return jsonFor(this, { type: "zettel_table", zettel_key: this.zettel_key, align: this.align }); }
  override createDOM(_config: EditorConfig): HTMLElement { return element("table", "zettel_table", this.zettel_key); }
}

export class ZettelTableRowNode extends ZettelBlockNode {
  constructor(data: Partial<TableRow>, key?: NodeKey) { super(data.zettel_key, key); }
  static getType(): string { return "zettel_table_row"; }
  static clone(node: ZettelTableRowNode): ZettelTableRowNode { return new ZettelTableRowNode({ type: "zettel_table_row", zettel_key: node.zettel_key, cells: [] }, node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelTableRowNode { return new ZettelTableRowNode(node as unknown as TableRow); }
  toZettel(): TableRow { return { type: "zettel_table_row", zettel_key: this.zettel_key, cells: this.getChildren().filter((child): child is ZettelTableCellNode => child instanceof ZettelTableCellNode).map((child) => child.toZettel()) }; }
  override exportJSON(): any { return jsonFor(this, { type: "zettel_table_row", zettel_key: this.zettel_key }); }
  override createDOM(_config: EditorConfig): HTMLElement { return element("tr", "zettel_table_row", this.zettel_key); }
}

export class ZettelTableCellNode extends ZettelBlockNode {
  markDefs: Link[];
  constructor(data: Partial<TableCell>, key?: NodeKey) { super(data.zettel_key, key); this.markDefs = data.markDefs ?? []; }
  static getType(): string { return "zettel_table_cell"; }
  static clone(node: ZettelTableCellNode): ZettelTableCellNode { return new ZettelTableCellNode({ type: "zettel_table_cell", zettel_key: node.zettel_key, children: [], markDefs: node.markDefs }, node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelTableCellNode { return new ZettelTableCellNode(node as unknown as TableCell); }
  toZettel(): TableCell { return { type: "zettel_table_cell", zettel_key: this.zettel_key, children: this.getChildren().flatMap(exportInlineNode), markDefs: this.markDefs }; }
  override exportJSON(): any { return jsonFor(this, { type: "zettel_table_cell", zettel_key: this.zettel_key, markDefs: this.markDefs }); }
  override createDOM(_config: EditorConfig): HTMLElement {
    const row = this.getParent<ZettelTableRowNode>();
    const table = row?.getParent<ZettelTableNode>();
    const isHeader = Boolean(row && table && table.getFirstChild() === row);
    const cell = element(isHeader ? "th" : "td", "zettel_table_cell", this.zettel_key);
    const column = row?.getChildren().indexOf(this) ?? -1;
    const alignment = column >= 0 ? table?.align[column] : undefined;
    if (alignment) cell.setAttribute("align", alignment);
    return cell;
  }
}

export class ZettelHtmlNode extends ZettelBlockNode {
  value: string;
  constructor(data: Partial<Html>, key?: NodeKey) { super(data.zettel_key, key); this.value = data.value ?? ""; }
  static getType(): string { return "zettel_html"; }
  static clone(node: ZettelHtmlNode): ZettelHtmlNode { return new ZettelHtmlNode({ type: "zettel_html", zettel_key: node.zettel_key, value: node.value }, node.__key); }
  static importJSON(node: SerializedZettelNode): ZettelHtmlNode { return new ZettelHtmlNode(node as unknown as Html); }
  toZettel(): Html { return { type: "zettel_html", zettel_key: this.zettel_key, value: this.value }; }
  override exportJSON(): any { return jsonFor(this, this.toZettel() as unknown as Record<string, unknown>); }
  override createDOM(_config: EditorConfig): HTMLElement { const pre = element("pre", "zettel_html", this.zettel_key); pre.dataset.zettelReadonly = "true"; pre.contentEditable = "false"; pre.textContent = this.value; return pre; }
  override canInsertTextBefore(): boolean { return false; }
  override canInsertTextAfter(): boolean { return false; }
}

/** An explicit, read-only representation for unregistered extension nodes. */
export class ZettelUnknownNode extends ZettelBlockNode {
  readonly payload: Record<string, unknown>;
  private readonly inline: boolean;
  constructor(payload: Record<string, unknown>, key?: NodeKey, inline = false) { super(typeof payload.zettel_key === "string" ? payload.zettel_key : undefined, key); this.payload = payload; this.inline = inline; }
  static getType(): string { return "zettel_unknown"; }
  static clone(node: ZettelUnknownNode): ZettelUnknownNode { return new ZettelUnknownNode(node.payload, node.__key, node.inline); }
  static importJSON(node: SerializedZettelNode): ZettelUnknownNode { const payload = (node.payload as Record<string, unknown> | undefined) ?? node; return new ZettelUnknownNode(payload, undefined, node.inline === true); }
  toZettel(): Block { return this.payload as Block; }
  override exportJSON(): any { return jsonFor(this, { payload: this.payload, inline: this.inline }); }
  override createDOM(_config: EditorConfig): HTMLElement { const pre = element(this.inline ? "span" : "pre", this.inline ? "zettel_html_inline" : "zettel_html", this.zettel_key); pre.dataset.zettelReadonly = "true"; pre.contentEditable = "false"; pre.textContent = JSON.stringify(this.payload); return pre; }
  override isInline(): boolean { return this.inline; }
  override canInsertTextBefore(): boolean { return false; }
  override canInsertTextAfter(): boolean { return false; }
}

export function $createZettelSpanNode(data: Partial<Span> & { text?: string }): ZettelSpanNode { return $applyNodeReplacement(new ZettelSpanNode(data)); }
export function $createZettelTextBlockNode(data: Partial<TextBlock> = {}): ZettelTextBlockNode { return $applyNodeReplacement(new ZettelTextBlockNode(data)); }
export function $createZettelBreakNode(data: Partial<Break> = {}): ZettelBreakNode { return $applyNodeReplacement(new ZettelBreakNode(data)); }

export const ZettelNodes = [
  ZettelSpanNode,
  ZettelTextBlockNode,
  ZettelBreakNode,
  ZettelImageNode,
  ZettelInlineHtmlNode,
  ZettelListNode,
  ZettelListItemNode,
  ZettelQuoteNode,
  ZettelCodeNode,
  ZettelRuleNode,
  ZettelTableNode,
  ZettelTableRowNode,
  ZettelTableCellNode,
  ZettelHtmlNode,
  ZettelUnknownNode,
] as const;

export interface NodeRegistryOptions {
  extensions?: Record<string, unknown> | string[];
}

export interface ZettelNodeRegistry {
  nodes: readonly (typeof ZettelNodes)[number][];
  extensionTypes: ReadonlySet<string>;
}

export function createNodeRegistry(options: NodeRegistryOptions = {}): ZettelNodeRegistry {
  const extensions = Array.isArray(options.extensions) ? options.extensions : Object.keys(options.extensions ?? {});
  for (const type of extensions) {
    if (type.startsWith("zettel_")) throw new Error(`Reserved Zettel node type cannot be overridden: ${type}`);
  }
  return { nodes: [...ZettelNodes], extensionTypes: new Set(extensions) };
}

export function nodeRegistry(options: NodeRegistryOptions = {}): ZettelNodeRegistry { return createNodeRegistry(options); }

export function createLexicalNode(value: Block | Inline | ListItem | TableRow | TableCell, registry?: ZettelNodeRegistry, context: "block" | "inline" = "block"): LexicalNode {
  if (!isNode(value)) throw new Error("Cannot create a Lexical node from a value without type and zettel_key");
  switch (value.type) {
    case "zettel_span": return new ZettelSpanNode(value as Span);
    case "zettel_text": return makeTextBlock(value as TextBlock);
    case "zettel_break": return new ZettelBreakNode(value as Break);
    case "zettel_image": return new ZettelImageNode(value as Image);
    case "zettel_html_inline": return new ZettelInlineHtmlNode(value as InlineHtml);
    case "zettel_list": return makeList(value as List, registry);
    case "zettel_list_item": return makeListItem(value as unknown as ListItem, registry);
    case "zettel_quote": return makeQuote(value as Quote, registry);
    case "zettel_code": return makeCode(value as Code);
    case "zettel_rule": return new ZettelRuleNode(value as Rule);
    case "zettel_table": return makeTable(value as Table, registry);
    case "zettel_table_row": return makeTableRow(value as unknown as TableRow, registry);
    case "zettel_table_cell": return makeTableCell(value as unknown as TableCell, registry);
    case "zettel_html": return new ZettelHtmlNode(value as Html);
    default:
      if (registry?.extensionTypes.has(value.type)) return new ZettelUnknownNode(value as Record<string, unknown>, undefined, context === "inline");
      return new ZettelUnknownNode(value as Record<string, unknown>, undefined, context === "inline");
  }
}

function makeTextBlock(value: TextBlock): ZettelTextBlockNode { const node = new ZettelTextBlockNode(value); appendInline(node, value.children, value.markDefs); return node; }
function makeList(value: List, registry?: ZettelNodeRegistry): ZettelListNode { const node = new ZettelListNode(value); node.append(...value.items.map((item) => makeListItem(item, registry))); return node; }
function makeListItem(value: ListItem, registry?: ZettelNodeRegistry): ZettelListItemNode { const node = new ZettelListItemNode(value); node.append(...value.blocks.map((block) => createLexicalNode(block, registry))); return node; }
function makeQuote(value: Quote, registry?: ZettelNodeRegistry): ZettelQuoteNode { const node = new ZettelQuoteNode(value); node.append(...value.blocks.map((block) => createLexicalNode(block, registry))); return node; }
function makeCode(value: Code): ZettelCodeNode { const node = new ZettelCodeNode(value); if (value.code) node.append(new ZettelSpanNode({ text: value.code, zettel_key: generateKey(), marks: ["code"] })); return node; }
function makeTable(value: Table, registry?: ZettelNodeRegistry): ZettelTableNode { const node = new ZettelTableNode(value); node.append(...value.rows.map((row) => makeTableRow(row, registry))); return node; }
function makeTableRow(value: TableRow, registry?: ZettelNodeRegistry): ZettelTableRowNode { const node = new ZettelTableRowNode(value); node.append(...value.cells.map((cell) => makeTableCell(cell, registry))); return node; }
function makeTableCell(value: TableCell, _registry?: ZettelNodeRegistry): ZettelTableCellNode { const node = new ZettelTableCellNode(value); appendInline(node, value.children, value.markDefs); return node; }
function appendInline(parent: ElementNode, children: Inline[], markDefs: Link[] = []): void {
  const nodes = children.map((child) => createLexicalNode(child, undefined, "inline"));
  for (const node of nodes) {
    const link = (node instanceof ZettelSpanNode || node instanceof ZettelImageNode) ? node.toZettel().marks.map((mark) => markDefs.find((definition) => definition.zettel_key === mark)).find(Boolean) : undefined;
    if (node instanceof ZettelSpanNode || node instanceof ZettelImageNode) node.setLinkHref(link?.href);
  }
  parent.append(...nodes);
}

export function exportInlineNode(node: LexicalNode): Inline[] {
  if (node instanceof ZettelSpanNode) return [node.toZettel()];
  if (node instanceof ZettelBreakNode) return [node.toZettel()];
  if (node instanceof ZettelImageNode) return [node.toZettel()];
  if (node instanceof ZettelInlineHtmlNode) return [node.toZettel()];
  if (node instanceof ZettelUnknownNode && node.isInline()) return [node.toZettel() as unknown as Inline];
  if (node instanceof TextNode) return [{ type: "zettel_span", zettel_key: generateKey(), text: node.getTextContent(), marks: marksForFormat(node.getFormat()) }];
  if (node instanceof ElementNode) return node.getChildren().flatMap(exportInlineNode);
  return [];
}

export function exportBlockNode(node: LexicalNode): any {
  if (node instanceof ZettelTextBlockNode) return node.toZettel();
  if (node instanceof ZettelListNode) return node.toZettel();
  if (node instanceof ZettelListItemNode) return node.toZettel();
  if (node instanceof ZettelQuoteNode) return node.toZettel();
  if (node instanceof ZettelCodeNode) return node.toZettel();
  if (node instanceof ZettelRuleNode) return node.toZettel();
  if (node instanceof ZettelTableNode) return node.toZettel();
  if (node instanceof ZettelTableRowNode) return node.toZettel();
  if (node instanceof ZettelTableCellNode) return node.toZettel();
  if (node instanceof ZettelHtmlNode) return node.toZettel();
  if (node instanceof ZettelUnknownNode) return node.toZettel();
  if (node instanceof ElementNode) return { type: "zettel_text", zettel_key: generateKey(), style: "normal", children: node.getChildren().flatMap(exportInlineNode), markDefs: [] };
  throw new Error(`Unsupported Lexical block: ${node.getType()}`);
}
