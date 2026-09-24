import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import {
  ZettelCodeNode,
  ZettelListItemNode,
  ZettelListNode,
  ZettelQuoteNode,
  ZettelSpanNode,
  ZettelTableCellNode,
  ZettelTextBlockNode,
} from "./nodes/index.js";
import { generateKey, type List } from "./types.js";

/**
 * Markdown-style input rules for a Zettel Lexical editor. They only create
 * nodes the Zettel profile stores: the strong, em, strike-through and code
 * decorators, links, bullet and numbered lists, and quotes.
 *
 * - `**x**` / `__x__` bold, `*x*` / `_x_` italic, `` `x` `` inline code and
 *   `~~x~~` strike-through, applied when the closing marker is typed.
 * - `- ` / `* ` bullet list, `1. ` / `1) ` numbered list and `> ` quote, typed
 *   at the start of a paragraph.
 * - A bare http(s) URL becomes a link when it is followed by a space or
 *   Return, or when it is pasted. Pasting a URL over selected text links it.
 *
 * Every conversion is its own undo step: Undo restores the typed Markdown.
 */
export function registerZettelMarkdownShortcuts(editor: LexicalEditor, linkSelection: (href: string) => boolean): () => void {
  return mergeRegister(
    editor.registerUpdateListener(({ tags, dirtyLeaves, editorState, prevEditorState }) => {
      if (tags.has("historic") || tags.has("collaboration") || tags.has(MARKDOWN_SHORTCUT_TAG) || editor.isComposing()) return;
      const typed = typedCharacter(editorState, prevEditorState, dirtyLeaves);
      if (typed) {
        editor.update(() => {
          const node = $getNodeByKey(typed.key);
          if (!(node instanceof ZettelSpanNode) || !node.isAttached()) return;
          $applyTypedShortcut(node, typed.offset, linkSelection);
        }, { tag: [MARKDOWN_SHORTCUT_TAG, "history-push"] });
        return;
      }
      const split = splitBlock(editorState, prevEditorState);
      if (split) {
        editor.update(() => {
          const block = $getNodeByKey(split);
          if (block instanceof ZettelTextBlockNode) $autolinkBlockEnd(block, linkSelection);
        }, { tag: [MARKDOWN_SHORTCUT_TAG, "history-push"] });
      }
    }),
    editor.registerCommand(PASTE_COMMAND, (event) => {
      const data = event && "clipboardData" in event ? (event as ClipboardEvent).clipboardData : null;
      const url = data?.getData("text/plain").trim() ?? "";
      if (!BARE_URL.test(url)) return false;
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      const anchorBlock = inlineContainer(selection.anchor.getNode());
      if (!anchorBlock || anchorBlock !== inlineContainer(selection.focus.getNode())) return false;
      if (selection.isCollapsed()) {
        selection.insertText(url);
        const after = $getSelection();
        if (!$isRangeSelection(after) || after.anchor.type !== "text") return true;
        const node = after.anchor.getNode();
        const end = after.anchor.offset;
        if (node instanceof ZettelSpanNode && end >= url.length) {
          node.select(end - url.length, end);
          linkSelection(url);
          collapseToEnd();
        }
      } else if (!linkSelection(url)) {
        return false;
      }
      (event as ClipboardEvent).preventDefault();
      return true;
    }, COMMAND_PRIORITY_LOW),
  );
}

const MARKDOWN_SHORTCUT_TAG = "zettel-markdown-shortcut";
const BARE_URL = /^https?:\/\/[^\s<>"]+$/i;
const TRAILING_URL = /(^|\s)(https?:\/\/[^\s<>"]+)$/i;

/** The caret moved one character right in the node that changed: a character was typed. */
function typedCharacter(editorState: EditorState, prevEditorState: EditorState, dirtyLeaves: Set<string>): { key: string; offset: number } | null {
  const current = editorState.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== "text") return null;
    const key = selection.anchor.key;
    if (!dirtyLeaves.has(key)) return null;
    const node = $getNodeByKey(key);
    if (!(node instanceof ZettelSpanNode)) return null;
    return { key, offset: selection.anchor.offset, length: node.getTextContentSize() };
  });
  if (!current) return null;
  const previous = prevEditorState.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
    const node = $getNodeByKey(current.key);
    return {
      key: selection.anchor.key,
      offset: selection.anchor.offset,
      length: node instanceof ZettelSpanNode ? node.getTextContentSize() : 0,
    };
  });
  if (!previous) return null;
  const offset = current.offset;
  const sameNode = previous.key === current.key && previous.offset + 1 === offset;
  if (!sameNode && offset !== 1) return null;
  // Only a one-character insertion, not a paste or a replacement.
  if (current.length !== previous.length + 1) return null;
  return { key: current.key, offset };
}

/** Return created a new text block and put the caret at its start. */
function splitBlock(editorState: EditorState, prevEditorState: EditorState): string | null {
  const current = editorState.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.offset !== 0) return null;
    const block = nearestTextBlock(selection.anchor.getNode());
    if (!block) return null;
    let previous: LexicalNode | null = block.getPreviousSibling();
    const item = block.getParent();
    const previousItem = item instanceof ZettelListItemNode ? item.getPreviousSibling() : null;
    if (!previous && previousItem instanceof ZettelListItemNode) previous = previousItem.getLastChild();
    return {
      blockKey: block.getKey(),
      previousBlockKey: previous instanceof ZettelTextBlockNode ? previous.getKey() : null,
    };
  });
  if (!current?.previousBlockKey) return null;
  const before = prevEditorState.read(() => ({
    block: $getNodeByKey(current.blockKey),
    previousBlock: $getNodeByKey(current.previousBlockKey!),
  }));
  return !before.block && before.previousBlock instanceof ZettelTextBlockNode
    ? current.previousBlockKey
    : null;
}

function nearestTextBlock(node: LexicalNode): ZettelTextBlockNode | null {
  for (let current: LexicalNode | null = node; current; current = current.getParent()) {
    if (current instanceof ZettelTextBlockNode) return current;
  }
  return null;
}

function inlineContainer(node: LexicalNode): ZettelTextBlockNode | ZettelTableCellNode | null {
  for (let current: LexicalNode | null = node; current; current = current.getParent()) {
    if (current instanceof ZettelTextBlockNode || current instanceof ZettelTableCellNode) return current;
  }
  return null;
}

function inCode(node: LexicalNode): boolean {
  for (let current: LexicalNode | null = node; current; current = current.getParent()) {
    if (current instanceof ZettelCodeNode) return true;
  }
  return false;
}

function collapseToEnd(): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const end = selection.isBackward() ? selection.anchor : selection.focus;
  selection.anchor.set(end.key, end.offset, end.type);
  selection.focus.set(end.key, end.offset, end.type);
}

interface InlineRule {
  marker: string;
  mark: "strong" | "em" | "code" | "strike-through";
  pattern: RegExp;
}

// Longer markers first: `**bold*` must not become italic before the second `*`.
// The content may not start or end with a space, and a marker only opens
// after a non-word character, so snake_case_names and 2*3*4 stay as typed.
const INLINE_RULES: InlineRule[] = [
  { marker: "**", mark: "strong", pattern: /(?:^|[^*\w\\])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/ },
  { marker: "__", mark: "strong", pattern: /(?:^|[^_\w\\])__([^_\s](?:[^_]*[^_\s])?)__$/ },
  { marker: "~~", mark: "strike-through", pattern: /(?:^|[^~\w\\])~~([^~\s](?:[^~]*[^~\s])?)~~$/ },
  { marker: "*", mark: "em", pattern: /(?:^|[^*\w\\])\*([^*\s](?:[^*]*[^*\s])?)\*$/ },
  { marker: "_", mark: "em", pattern: /(?:^|[^_\w\\])_([^_\s](?:[^_]*[^_\s])?)_$/ },
  { marker: "`", mark: "code", pattern: /(?:^|[^`\\])`([^`]+)`$/ },
];

const BLOCK_RULE = /^(?:([-*])|(\d{1,9})[.)]|(>)) $/;

function $applyTypedShortcut(node: ZettelSpanNode, offset: number, linkSelection: (href: string) => boolean): void {
  if (inCode(node) || node.toZettel().marks.includes("code")) return;
  const text = node.getTextContent();
  const typed = text[offset - 1];
  const before = text.slice(0, offset);
  if (typed === " " && $applyBlockRule(node, before)) return;
  if (typed === " " || typed === "\t") {
    $autolinkBefore(node, offset - 1, linkSelection);
    return;
  }
  if (!typed || !"*_~`".includes(typed)) return;
  for (const rule of INLINE_RULES) {
    const match = rule.pattern.exec(before);
    if (!match) continue;
    const content = match[1]!;
    const closeStart = offset - rule.marker.length;
    const openStart = closeStart - content.length - rule.marker.length;
    $formatRange(node, openStart, closeStart, rule.marker.length, rule.mark);
    return;
  }
}

/** Remove the markers around text[openStart + marker, closeStart) and mark that text. */
function $formatRange(node: ZettelSpanNode, openStart: number, closeStart: number, markerLength: number, mark: InlineRule["mark"]): void {
  const format = node.getFormat();
  const text = node.getTextContent();
  const content = text.slice(openStart + markerLength, closeStart);
  const next = text.slice(0, openStart) + content + text.slice(closeStart + markerLength);
  node.setTextContent(next);
  const parts = node.splitText(openStart, openStart + content.length);
  const target = parts[openStart === 0 ? 0 : 1] as ZettelSpanNode;
  const marks = target.toZettel().marks;
  if (!marks.includes(mark)) target.setMarks([...marks, mark]);
  // Continue typing after the formatted text, without its new mark.
  const after = target.getNextSibling();
  if (after instanceof ZettelSpanNode && !after.toZettel().marks.includes(mark)) after.select(0, 0);
  else {
    const selection = target.select(content.length, content.length);
    selection.format = format;
  }
}

function $applyBlockRule(node: ZettelSpanNode, before: string): boolean {
  const match = BLOCK_RULE.exec(before);
  if (!match) return false;
  const block = node.getParent();
  if (!(block instanceof ZettelTextBlockNode) || block.style !== "normal" || !node.is(block.getFirstChild())) return false;
  const container = block.getParent();
  if (!$isRootNode(container) && !(container instanceof ZettelQuoteNode)) return false;
  const rest = node.getTextContent().slice(before.length);
  if (rest) {
    node.setTextContent(rest);
    node.select(0, 0);
  } else {
    node.remove();
    block.selectStart();
  }
  if (match[3]) {
    const quote = new ZettelQuoteNode({ _type: "zettel_quote", _key: generateKey(), blocks: [] });
    block.insertBefore(quote);
    quote.append(block);
    return true;
  }
  const kind: List["kind"] = match[2] ? "number" : "bullet";
  const list = new ZettelListNode({ _type: "zettel_list", _key: generateKey(), kind, spread: false, ...(kind === "number" ? { start: Number(match[2]) } : {}) });
  const item = new ZettelListItemNode({ _type: "zettel_list_item", _key: generateKey(), spread: false });
  block.insertBefore(list);
  item.append(block);
  list.append(item);
  // Adjacent lists of one kind are one list in Markdown; keep them one here.
  const previous = list.getPreviousSibling();
  if (previous instanceof ZettelListNode && previous.kind === kind) {
    previous.append(...list.getChildren());
    list.remove();
  }
  return true;
}

/** Link a bare URL that ends at `end` in the span (the caret is right after it). */
function $autolinkBefore(node: ZettelSpanNode, end: number, linkSelection: (href: string) => boolean): void {
  if (hasLink(node)) return;
  const text = node.getTextContent();
  const match = TRAILING_URL.exec(text.slice(0, end));
  if (!match) return;
  const url = trimUrl(match[2]!);
  if (!url) return;
  const start = end - match[2]!.length;
  const caret = $getSelection();
  const caretOffset = $isRangeSelection(caret) ? caret.anchor.offset : end + 1;
  node.select(start, start + url.length);
  if (!linkSelection(url)) return;
  // Put the caret back after the typed character, outside the link.
  const linked = $getSelection();
  if (!$isRangeSelection(linked)) return;
  const tail = (linked.isBackward() ? linked.anchor : linked.focus).getNode().getNextSibling();
  if (tail instanceof ZettelSpanNode) tail.select(caretOffset - start - url.length, caretOffset - start - url.length);
}

/** Return after a bare URL: link it in the block the caret just left. */
function $autolinkBlockEnd(block: ZettelTextBlockNode, linkSelection: (href: string) => boolean): void {
  const last = block.getLastChild();
  if (!(last instanceof ZettelSpanNode) || hasLink(last) || last.toZettel().marks.includes("code")) return;
  const selection = $getSelection();
  const caret = $isRangeSelection(selection) ? { key: selection.anchor.key, offset: selection.anchor.offset, type: selection.anchor.type } : null;
  const text = last.getTextContent();
  const match = TRAILING_URL.exec(text);
  if (!match) return;
  const url = trimUrl(match[2]!);
  if (!url) return;
  const start = text.length - match[2]!.length;
  last.select(start, start + url.length);
  linkSelection(url);
  const restored = $getSelection();
  if (caret && $isRangeSelection(restored)) {
    restored.anchor.set(caret.key, caret.offset, caret.type);
    restored.focus.set(caret.key, caret.offset, caret.type);
  }
}

function hasLink(node: ZettelSpanNode): boolean {
  const container = inlineContainer(node);
  const marks = node.toZettel().marks;
  return Boolean(container?.markDefs.some((definition) => marks.includes(definition._key)));
}

/** GFM autolinks leave trailing punctuation out of the link. */
function trimUrl(url: string): string {
  let result = url.replace(/[.,:;!?"'*_~]+$/, "");
  while (result.endsWith(")") && (result.match(/\(/g)?.length ?? 0) < (result.match(/\)/g)?.length ?? 0)) result = result.slice(0, -1);
  return /^https?:\/\/[^/?#]+/i.test(result) ? result : "";
}
