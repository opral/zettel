import { $getRoot, $getSelection, $isRangeSelection, ElementNode, type LexicalEditor, type LexicalNode, type RangeSelection } from "lexical";
import { createDocument, generateKey, type Block, type Document, type Inline, type TextBlock, type List, type Quote, type Code, type Table, type TableCell, type Span, type Image, type InlineHtml, type Link } from "./types.js";
import { createLexicalNode, type NodeRegistryOptions, createNodeRegistry, type ZettelNodeRegistry, ZettelBreakNode, ZettelImageNode, ZettelInlineHtmlNode, ZettelSpanNode, ZettelTextBlockNode, ZettelTableCellNode, ZettelTableNode, ZettelTableRowNode, exportBlockNode, exportInlineNode } from "./nodes/index.js";
import { assertEditorDocument, exportDocument } from "./lexical-state.js";
import { $removeSelectedText } from "./selection.js";
import { importHtml, toHtml as renderHtml } from "@opral/zettel-html";

export interface ClipboardPayload {
  "text/plain"?: string;
  "text/html"?: string;
  "text/zettel"?: string;
}

export interface PasteResult {
  handled: boolean;
  document?: Document;
  diagnostics?: unknown[];
}

/**
 * Write all three interoperable clipboard representations. A ClipboardEvent
 * is preferred because browsers only permit synchronous writes during copy.
 */
export function copyDocumentToClipboard(editor: LexicalEditor, event?: ClipboardEvent | null): boolean {
  const document = selectedDocument(editor) ?? exportDocument(editor);
  const plain = toPlainText(document);
  let html: string;
  try {
    html = toHtml(document);
  } catch {
    // Static HTML has no application extension handlers. Keep internal JSON
    // and plain text copy usable with a safe, inert fallback fragment.
    html = `<div class="zettel">${escapeHtml(plain)}</div>`;
  }
  if (event?.clipboardData) {
    event.clipboardData.setData("text/plain", plain);
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData("text/zettel", JSON.stringify(document));
    event.preventDefault();
    return true;
  }
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard?.write && typeof ClipboardItem !== "undefined" && typeof Blob !== "undefined") {
    void clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([plain], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
        "text/zettel": new Blob([JSON.stringify(document)], { type: "text/zettel" }),
      }),
    ]);
    return true;
  }
  return false;
}

/** Parse clipboard data in the contract's priority order. */
export function parseClipboardData(data: ClipboardPayload | Pick<DataTransfer, "types" | "getData">, options: NodeRegistryOptions | ZettelNodeRegistry = {}): PasteResult {
  const get = (type: string): string => {
    if ("getData" in data && typeof data.getData === "function") return data.getData(type);
    return (data as ClipboardPayload)[type as keyof ClipboardPayload] ?? "";
  };
  const types = "types" in data ? Array.from(data.types) : Object.keys(data);
  const registry = "nodes" in options ? options : createNodeRegistry(options);
  const diagnostics: unknown[] = [];

  if (types.includes("text/zettel") || get("text/zettel")) {
    try {
      const value = JSON.parse(get("text/zettel")) as Document;
      if (!value || !Array.isArray(value.blocks)) throw new Error("text/zettel does not contain a blocks array");
      assertEditorDocument(value);
      return { handled: true, document: remapDocument(value), diagnostics };
    } catch (error) {
      diagnostics.push(error);
      // Browsers frequently advertise text/zettel while only returning the
      // sanitized HTML. Falling through keeps paste useful in that case.
    }
  }
  if (types.includes("text/html") || get("text/html")) {
    const html = get("text/html");
    if (html) {
      try {
        const imported = fromHtml(html);
        return { handled: true, document: remapDocument(imported.document), diagnostics: [...diagnostics, ...(imported.diagnostics ?? [])] };
      } catch {
        // Continue to plain text if the provider supplied malformed markup.
      }
    }
  }
  if (types.includes("text/plain") || get("text/plain")) {
    const text = get("text/plain");
    return { handled: true, document: remapDocument(fromPlainText(text)), diagnostics };
  }
  void registry;
  return { handled: false, diagnostics };
}

/** Paste a parsed clipboard document at the end of the current root. */
export function pasteClipboardData(editor: LexicalEditor, data: ClipboardPayload | Pick<DataTransfer, "types" | "getData">, options?: NodeRegistryOptions | ZettelNodeRegistry): PasteResult {
  const parsed = parseClipboardData(data, options);
  if (!parsed.handled || !parsed.document) return parsed;
  const document = parsed.document;
  const registry = options && "nodes" in options ? options : createNodeRegistry(options);
  editor.update(() => {
    let selection = $getSelection();
    // Replace a selected range first, then paste at the caret it leaves.
    if ($isRangeSelection(selection) && !selection.isCollapsed()) {
      $removeSelectedText(selection);
      selection = $getSelection();
    }
    const nodes = document.blocks.map((block) => createLexicalNode(block, registry));
    if ($isRangeSelection(selection)) {
      const first = document.blocks[0] as any;
      const anchor = selection.anchor.getNode();
      const parent = anchor.getParent();
      if (selection.isCollapsed() && first?._type === "zettel_block" && anchor instanceof ZettelSpanNode && parent instanceof ElementNode && (parent instanceof ZettelTextBlockNode || parent instanceof ZettelTableCellNode)) {
        if (parent instanceof ZettelTextBlockNode && document.blocks.length > 1) {
          pasteTextBlocksAtCaret(parent, anchor, selection.anchor.offset, document.blocks, registry);
        } else {
          pasteInlineAtCaret(parent, anchor, selection.anchor.offset, first, registry);
        }
        return;
      }
      selection.insertNodes(nodes);
      return;
    }
    const root = $getRoot();
    root.append(...nodes);
  }, { discrete: true });
  return parsed;
}

function setInlineLink(node: LexicalNode, markDefs: Array<{ _key: string; href: string }>): void {
  if (!(node instanceof ZettelSpanNode) && !(node instanceof ZettelImageNode)) return;
  const href = node.toZettel().marks.map((mark) => markDefs.find((definition) => definition._key === mark)?.href).find(Boolean);
  node.setLinkHref(href);
}

function appendMarkDefs(block: ZettelTextBlockNode | ZettelTableCellNode, definitions: Link[]): void {
  if (!definitions.length) return;
  const writable = block.getWritable();
  writable.markDefs = [...writable.markDefs, ...definitions];
}

function cloneMarkDefs(markDefs: Link[]): { markDefs: Link[]; marks: Map<string, string> } {
  const marks = new Map<string, string>();
  const cloned = markDefs.map((definition) => {
    const _key = generateKey();
    marks.set(definition._key, _key);
    return { ...definition, _key };
  });
  return { markDefs: cloned, marks };
}

function remapInlineMarks(node: LexicalNode, marks: Map<string, string>): void {
  const source = node instanceof ZettelSpanNode || node instanceof ZettelImageNode || node instanceof ZettelInlineHtmlNode || node instanceof ZettelBreakNode
    ? node.toZettel()
    : undefined;
  if (!source || !("marks" in source)) return;
  const remapped = source.marks.map((mark) => marks.get(mark) ?? mark);
  if (node instanceof ZettelSpanNode) node.setMarks(remapped);
  else if (node instanceof ZettelImageNode || node instanceof ZettelInlineHtmlNode || node instanceof ZettelBreakNode) {
    const writable = node.getWritable() as typeof node;
    writable.marks = remapped;
  }
}

function inlineNodes(block: TextBlock, registry: ZettelNodeRegistry): LexicalNode[] {
  return (block.children ?? []).map((child: Inline) => {
    const node = createLexicalNode(child, registry, "inline");
    setInlineLink(node, block.markDefs ?? []);
    return node;
  });
}

function pasteInlineAtCaret(parent: ZettelTextBlockNode | ZettelTableCellNode, anchor: ZettelSpanNode, offset: number, block: TextBlock, registry: ZettelNodeRegistry): void {
  const source = anchor.getTextContent();
  const anchorMarks = anchor.toZettel().marks;
  const left = source.slice(0, offset);
  const right = source.slice(offset);
  const before = anchor.getPreviousSibling();
  const after = anchor.getNextSibling();
  if (left) anchor.setTextContent(left); else anchor.remove();
  const insertion = inlineNodes(block, registry);
  let cursor: LexicalNode | null = left ? anchor : before;
  const firstExisting = after;
  for (const node of insertion) {
    if (cursor) cursor.insertAfter(node);
    else if (firstExisting) firstExisting.insertBefore(node);
    else parent.append(node);
    cursor = node;
  }
  if (right) {
    const rightNode = new ZettelSpanNode({ _type: "zettel_span", _key: generateKey(), text: right, marks: anchorMarks });
    setInlineLink(rightNode, parent.markDefs);
    if (cursor) cursor.insertAfter(rightNode);
    else if (firstExisting) firstExisting.insertBefore(rightNode);
    else parent.append(rightNode);
  }
  appendMarkDefs(parent, block.markDefs ?? []);
  // Continue typing after the pasted content, not before it.
  const last = insertion[insertion.length - 1];
  if (last instanceof ZettelSpanNode) last.select(last.getTextContentSize(), last.getTextContentSize());
  else if (last) last.selectNext(0, 0);
}

/**
 * Insert a multi-block text paste without dropping the blocks after the first.
 * The first text block is merged at the caret; subsequent blocks and the
 * original trailing text become siblings in the current block's container.
 */
function pasteTextBlocksAtCaret(parent: ZettelTextBlockNode, anchor: ZettelSpanNode, offset: number, blocks: Block[], registry: ZettelNodeRegistry): void {
  const first = blocks[0];
  if (!first || first._type !== "zettel_block") return;
  const firstText = first as TextBlock;
  const source = anchor.getTextContent();
  const anchorMarks = anchor.toZettel().marks;
  const left = source.slice(0, offset);
  const right = source.slice(offset);
  const siblings = parent.getChildren();
  const index = siblings.indexOf(anchor);
  const rightNodes = siblings.slice(index + 1);
  const before = anchor.getPreviousSibling();
  if (left) anchor.setTextContent(left); else anchor.remove();

  let cursor: LexicalNode | null = left ? anchor : before;
  const firstExisting = rightNodes[0] ?? null;
  for (const node of inlineNodes(firstText, registry)) {
    if (cursor) cursor.insertAfter(node);
    else if (firstExisting) firstExisting.insertBefore(node);
    else parent.append(node);
    cursor = node;
  }
  const cloned = cloneMarkDefs(parent.markDefs);
  const trailing = $createTextBlockLike(parent, cloned.markDefs);
  if (right) {
    const rightNode = new ZettelSpanNode({ _type: "zettel_span", _key: generateKey(), text: right, marks: anchorMarks.map((mark) => cloned.marks.get(mark) ?? mark) });
    setInlineLink(rightNode, trailing.markDefs);
    trailing.append(rightNode);
  }
  for (const node of rightNodes) {
    node.remove();
    remapInlineMarks(node, cloned.marks);
    trailing.append(node);
  }
  appendMarkDefs(parent, firstText.markDefs ?? []);
  let blockCursor: LexicalNode = parent;
  for (const block of blocks.slice(1)) {
    const node = createLexicalNode(block, registry);
    blockCursor.insertAfter(node);
    blockCursor = node;
  }
  if (trailing.getChildren().length) {
    blockCursor.insertAfter(trailing);
    trailing.selectStart();
  } else if (blockCursor instanceof ElementNode) {
    blockCursor.selectEnd();
  }
}

function $createTextBlockLike(source: ZettelTextBlockNode, markDefs = source.markDefs): ZettelTextBlockNode {
  return new ZettelTextBlockNode({ _type: "zettel_block", style: source.style, markDefs });
}

function toPlainText(document: Document): string {
  return document.blocks.map(blockPlainText).join("\n");
}

function blockPlainText(block: Block): string {
  switch (block._type) {
    case "zettel_block": return (block as TextBlock).children.map(inlinePlainText).join("");
    case "zettel_list": return (block as List).items.map((item) => item.blocks.map(blockPlainText).join("\n")).join("\n");
    case "zettel_quote": return (block as Quote).blocks.map(blockPlainText).join("\n");
    case "zettel_code": return (block as Code).code;
    case "zettel_table": return (block as Table).rows.map((row) => row.cells.map((cell) => cell.children.map(inlinePlainText).join("")).join("\t")).join("\n");
    case "zettel_html": return (block as { value: string }).value;
    default: return JSON.stringify(block);
  }
}

function inlinePlainText(inline: Inline): string {
  if (inline._type === "zettel_span") return (inline as Span).text;
  if (inline._type === "zettel_break") return "\n";
  if (inline._type === "zettel_image") return (inline as Image).alt;
  if (inline._type === "zettel_html_inline") return (inline as InlineHtml).value;
  return JSON.stringify(inline);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fromPlainText(text: string): Document {
  return createDocument(text ? text.split(/\r?\n/).map((line): TextBlock => ({
    _type: "zettel_block",
    _key: generateKey(),
    style: "normal",
    markDefs: [],
    children: line ? [{ _type: "zettel_span", _key: generateKey(), text: line, marks: [] }] : [],
  })) : []);
}

function selectedDocument(editor: LexicalEditor): Document | undefined {
  let selected: Document | undefined;
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
    const nodes = selection.getNodes();
    const textNodes = nodes.filter((node): node is ZettelSpanNode => node instanceof ZettelSpanNode);
    const textBlocks = [...new Set(textNodes.map((node) => nearestTextBlock(node)).filter((node): node is ZettelTextBlockNode => Boolean(node)))].sort((a, b) => a.isBefore(b) ? -1 : 1);
    if (textBlocks.length) {
      selected = createDocument(textBlocks.map((block) => selectedTextBlock(block, nodes, selection)));
      return;
    }
    const tableCells = [...new Set(nodes.map((node) => nearestTableCell(node)).filter((node): node is ZettelTableCellNode => Boolean(node)))];
    if (tableCells.length) {
      const table = nearestTable(tableCells[0]);
      if (table) selected = createDocument([selectedTable(table, tableCells, nodes, selection)]);
      return;
    }
    const topLevel = nodes.map((node) => node.getTopLevelElement()).filter((node) => Boolean(node)) as LexicalNode[];
    const unique = [...new Set(topLevel)];
    if (unique.length) selected = createDocument(unique.map(exportBlockNode));
  });
  return selected;
}

function nearestTextBlock(node: LexicalNode): ZettelTextBlockNode | undefined {
  let current: LexicalNode | null = node;
  while (current) {
    if (current instanceof ZettelTextBlockNode) return current;
    current = current.getParent();
  }
  return undefined;
}

function nearestTableCell(node: LexicalNode): ZettelTableCellNode | undefined {
  let current: LexicalNode | null = node;
  while (current) {
    if (current instanceof ZettelTableCellNode) return current;
    current = current.getParent();
  }
  return undefined;
}

function nearestTable(node: LexicalNode): ZettelTableNode | undefined {
  let current: LexicalNode | null = node;
  while (current) {
    if (current instanceof ZettelTableNode) return current;
    current = current.getParent();
  }
  return undefined;
}

function selectedTable(table: ZettelTableNode, selectedCells: ZettelTableCellNode[], nodes: LexicalNode[], selection: RangeSelection): Table {
  const selected = new Set(selectedCells);
  const source = table.toZettel();
  const rows: Table["rows"] = [];
  const widths: number[] = [];
  for (const rowNode of table.getChildren().filter((node): node is ZettelTableRowNode => node instanceof ZettelTableRowNode)) {
    const cells = rowNode.getChildren().filter((node): node is ZettelTableCellNode => node instanceof ZettelTableCellNode && selected.has(node));
    if (!cells.length) continue;
    widths.push(cells.length);
    rows.push({ _type: "zettel_table_row", _key: generateKey(), cells: cells.map((cell) => selectedTableCell(cell, nodes, selection)) });
  }
  const width = Math.max(1, ...widths);
  for (const row of rows) while (row.cells.length < width) row.cells.push({ _type: "zettel_table_cell", _key: generateKey(), children: [], markDefs: [] });
  const columns = selectedCells.map((cell) => {
    const row = cell.getParent();
    return row instanceof ZettelTableRowNode ? row.getChildren().indexOf(cell) : -1;
  }).filter((column) => column >= 0);
  return { _type: "zettel_table", _key: generateKey(), align: columns.slice(0, width).map((column) => source.align[column] ?? null), rows };
}

function selectedTableCell(cell: ZettelTableCellNode, nodes: LexicalNode[], selection: RangeSelection): TableCell {
  const selectedKeys = new Set(nodes.map((node) => node.getKey()));
  const backward = selection.isBackward();
  const startKey = backward ? selection.focus.key : selection.anchor.key;
  const endKey = backward ? selection.anchor.key : selection.focus.key;
  const startOffset = backward ? selection.focus.offset : selection.anchor.offset;
  const endOffset = backward ? selection.anchor.offset : selection.focus.offset;
  const children: Inline[] = [];
  for (const child of cell.getChildren()) {
    if (!selectedKeys.has(child.getKey())) continue;
    if (child instanceof ZettelSpanNode) {
      const source = child.toZettel();
      const start = child.getKey() === startKey ? startOffset : 0;
      const end = child.getKey() === endKey ? endOffset : source.text.length;
      if (end > start) children.push({ ...source, _key: generateKey(), text: source.text.slice(start, end), marks: [...source.marks] });
    } else {
      const source = exportInlineNode(child)[0];
      if (source) children.push({ ...source, _key: generateKey() } as Inline);
    }
  }
  return { _type: "zettel_table_cell", _key: generateKey(), children, markDefs: cell.markDefs };
}

function selectedTextBlock(block: ZettelTextBlockNode, nodes: LexicalNode[], selection: RangeSelection): TextBlock {
  const selectedKeys = new Set(nodes.map((node) => node.getKey()));
  const backward = selection.isBackward();
  const startKey = backward ? selection.focus.key : selection.anchor.key;
  const endKey = backward ? selection.anchor.key : selection.focus.key;
  const startOffset = backward ? selection.focus.offset : selection.anchor.offset;
  const endOffset = backward ? selection.anchor.offset : selection.focus.offset;
  const children: Inline[] = [];
  for (const child of block.getChildren()) {
    if (!selectedKeys.has(child.getKey())) continue;
    if (child instanceof ZettelSpanNode) {
      const source = child.toZettel();
      const start = child.getKey() === startKey ? startOffset : 0;
      const end = child.getKey() === endKey ? endOffset : source.text.length;
      if (end > start) children.push({ ...source, _key: generateKey(), text: source.text.slice(start, end), marks: [...source.marks] });
    } else {
      const source = exportInlineNode(child)[0];
      if (source) children.push({ ...source, _key: generateKey() } as Inline);
    }
  }
  return { _type: "zettel_block", _key: generateKey(), style: block.style, children, markDefs: block.markDefs };
}

/** Give pasted nodes fresh document keys and rewrite local mark references. */
function remapDocument(document: Document): Document {
  const keyMap = new Map<string, string>();
  const key = (old: string): string => { const next = generateKey(); keyMap.set(old, next); return next; };
  const remapInline = (inline: Inline, marks: Map<string, string>): Inline => {
    const value = inline as Record<string, unknown>;
    const remapped: Record<string, unknown> = { ...value, _key: key(String(value._key)) };
    if (["zettel_span", "zettel_break", "zettel_image", "zettel_html_inline"].includes(String(value._type)) && Array.isArray(value.marks)) {
      remapped.marks = value.marks.map((mark) => typeof mark === "string" ? marks.get(mark) ?? mark : mark);
    }
    return remapped as Inline;
  };
  const remapBlock = (block: Block): Block => {
    const value = block as any;
    switch (value._type) {
      case "zettel_block": {
        const marks = new Map<string, string>((value.markDefs ?? []).map((definition: any) => [definition._key, key(definition._key)]));
        return { ...value, _key: key(value._key), markDefs: (value.markDefs ?? []).map((definition: any) => ({ ...definition, _key: marks.get(definition._key)! })), children: (value.children ?? []).map((child: Inline) => remapInline(child, marks)) } as Block;
      }
      case "zettel_table": return { ...value, _key: key(value._key), rows: (value.rows ?? []).map((row: any) => ({ ...row, _key: key(row._key), cells: (row.cells ?? []).map((cell: any) => { const marks = new Map<string, string>((cell.markDefs ?? []).map((definition: any) => [definition._key, key(definition._key)])); return { ...cell, _key: key(cell._key), markDefs: (cell.markDefs ?? []).map((definition: any) => ({ ...definition, _key: marks.get(definition._key)! })), children: (cell.children ?? []).map((child: Inline) => remapInline(child, marks)) }; }) })) } as Block;
      case "zettel_list": return { ...value, _key: key(value._key), items: (value.items ?? []).map((item: any) => ({ ...item, _key: key(item._key), blocks: (item.blocks ?? []).map(remapBlock) })) } as Block;
      case "zettel_quote": return { ...value, _key: key(value._key), blocks: (value.blocks ?? []).map(remapBlock) } as Block;
      default: return { ...value, _key: key(value._key) } as Block;
    }
  };
  return { ...document, blocks: document.blocks.map(remapBlock) };
}

function toHtml(document: Document): string {
  return renderHtml(document);
}

function fromHtml(html: string): { document: Document; diagnostics?: unknown[] } {
  const result = importHtml(html);
  return { document: result.document, diagnostics: result.diagnostics };
}

export { toPlainText };
