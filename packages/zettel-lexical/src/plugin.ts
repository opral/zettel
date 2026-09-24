import {
  $getSelection,
  createCommand,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_BEFORE_CRITICAL,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  COPY_COMMAND,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  CUT_COMMAND,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  FORMAT_TEXT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  LexicalEditor,
  ParagraphNode,
  PASTE_COMMAND,
  REMOVE_TEXT_COMMAND,
  SELECT_ALL_COMMAND,
  SELECTION_CHANGE_COMMAND,
  $getEditor,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isRootNode,
  $selectAll,
  ElementNode,
  $setSelection,
  toggleTextFormatType,
  type LexicalNode,
  type PointType,
  type RangeSelection,
  type TextFormatType,
} from "lexical";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { NormalizeTripleClickSelectionExtension } from "@lexical/extension/NormalizeTripleClickSelectionExtension";
import { mergeRegister } from "@lexical/utils";
import { copyDocumentToClipboard, pasteClipboardData } from "./clipboard.js";
import { $editRange, $removeSelectedText } from "./selection.js";
import { exportDocument } from "./lexical-state.js";
import { registerZettelMarkdownShortcuts } from "./markdown-shortcuts.js";
import {
  $createZettelBreakNode,
  $createZettelTextBlockNode,
  ZettelBreakNode,
  ZettelCodeNode,
  ZettelImageNode,
  ZettelInlineHtmlNode,
  ZettelListItemNode,
  ZettelListNode,
  ZettelQuoteNode,
  ZettelSpanNode,
  ZettelTableCellNode,
  ZettelTextBlockNode,
} from "./nodes/index.js";
import { generateKey, type Link } from "./types.js";

const ZETTEL_TEXT_FORMATS = new Set<TextFormatType>(["bold", "italic", "underline", "strikethrough", "code"]);
/** How long after a triple click its selection change is expected (as in Lexical's NormalizeTripleClickSelectionExtension). */
const TRIPLE_CLICK_SELECTION_MS = 100;

/**
 * The formats every selected character has. Lexical toggles a format on a
 * range by `selection.format`, which it only derives from the DOM selection;
 * a range selected in code keeps the caret's stale format, so derive it here.
 */
function $selectedTextFormat(selection: RangeSelection): number {
  const [start, end] = selection.isBackward() ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];
  let format: number | undefined;
  for (const node of selection.getNodes()) {
    if (!$isTextNode(node)) continue;
    const size = node.getTextContentSize();
    if (size === 0) continue;
    if (node.getKey() === start.key && start.type === "text" && start.offset === size) continue;
    if (node.getKey() === end.key && end.type === "text" && end.offset === 0) continue;
    format = format === undefined ? node.getFormat() : format & node.getFormat();
  }
  return format ?? selection.format;
}

/** Apply, edit, or remove a link on selected prose text. */
export const SET_ZETTEL_LINK_COMMAND = createCommand<string | null>("SET_ZETTEL_LINK_COMMAND");

export function $setZettelLink(href: string | null): boolean {
  if (href !== null && !/^(https?:\/\/|mailto:)/i.test(href.trim())) {
    throw new Error("Use an https://, http://, or mailto: URL.");
  }
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  if (selection.isCollapsed()) {
    const anchor = selection.anchor.getNode();
    const parent = anchor.getParent();
    if (!(anchor instanceof ZettelSpanNode) || !(parent instanceof ZettelTextBlockNode || parent instanceof ZettelTableCellNode)) return false;
    const link = parent.markDefs.find(def => anchor.toZettel().marks.includes(def._key));
    if (!link) return false;
    // A formatted link may comprise several adjacent spans.
    let first = anchor, last = anchor;
    while (first.getPreviousSibling() instanceof ZettelSpanNode && (first.getPreviousSibling() as ZettelSpanNode).toZettel().marks.includes(link._key)) first = first.getPreviousSibling() as ZettelSpanNode;
    while (last.getNextSibling() instanceof ZettelSpanNode && (last.getNextSibling() as ZettelSpanNode).toZettel().marks.includes(link._key)) last = last.getNextSibling() as ZettelSpanNode;
    selection.setTextNodeRange(first, 0, last, last.getTextContentSize());
  }
  let changed = false;
  for (const node of selection.extract()) {
    if (!(node instanceof ZettelSpanNode)) continue;
    const parent = node.getParent();
    if (!(parent instanceof ZettelTextBlockNode || parent instanceof ZettelTableCellNode)) continue;
    const marks = node.toZettel().marks.filter(mark => !parent.markDefs.some(def => def._key === mark));
    if (href !== null) {
      const url = href.trim();
      let definition = parent.markDefs.find(def => def.href === url);
      if (!definition) {
        definition = { _type: "zettel_link", _key: generateKey(), href: url };
        parent.getWritable().markDefs = [...parent.markDefs, definition];
      }
      marks.push(definition._key);
    }
    node.setMarks(marks);
    node.setLinkHref(href?.trim());
    changed = true;
  }
  return changed;
}

export interface ZettelLexicalPluginOptions {
  onPasteDiagnostics?: (diagnostics: unknown[]) => void;
  /**
   * Opt in to Markdown-style input rules: `**bold**`, `__bold__`, `*italic*`,
   * `_italic_`, `` `code` `` and `~~strike~~` when the closing marker is
   * typed; `- `, `* `, `1. ` and `> ` at the start of a paragraph for lists
   * and quotes; and links for bare http(s) URLs followed by a space or
   * Return, or pasted (over selected text, a pasted URL links the text).
   * Undo reverts a conversion and leaves the typed Markdown.
   */
  markdownShortcuts?: boolean;
  /**
   * Handle Mod+K (Cmd+K on macOS, Ctrl+K elsewhere) on selected text or in a
   * link. Receive the selected text and the current href; return an href to
   * link, `null` to remove the link, or `undefined` to leave it unchanged.
   * The editor has no link UI of its own, so Mod+K is left to the browser
   * when this is not set.
   */
  onLinkShortcut?: (link: { text: string; href?: string }) => string | null | undefined | Promise<string | null | undefined>;
}

/** Register normal editor commands plus Zettel clipboard integration. */
export function registerZettelLexicalPlugin(editor: LexicalEditor, options: ZettelLexicalPluginOptions = {}): () => void {
  // Called at once with the current root, then on every root change. The
  // returned cleanup runs before the next change and on unregister.
  const unregisterRoot = editor.registerRootListener((root) => {
    const currentRoot = root as (HTMLElement & { __zettelEditor?: LexicalEditor }) | null;
    if (!currentRoot) return;
    currentRoot.classList.add("zettel");
    currentRoot.setAttribute("data-zettel-doc", "true");
    currentRoot.__zettelEditor = editor;
    currentRoot.addEventListener("change", onChecklistChange);
    currentRoot.addEventListener("beforeinput", onPlainTextBeforeInput, true);
    currentRoot.addEventListener("mousedown", onPointerClick, true);
    currentRoot.addEventListener("mouseup", onPointerClick, true);
    return () => {
      currentRoot.removeEventListener("change", onChecklistChange);
      currentRoot.removeEventListener("beforeinput", onPlainTextBeforeInput, true);
      currentRoot.removeEventListener("mousedown", onPointerClick, true);
      currentRoot.removeEventListener("mouseup", onPointerClick, true);
    };
  });
  // A triple click selects a block and the browser puts the focus at the start
  // of the next block, so typing or deleting would merge that block too.
  // Lexical before 0.45 corrected this in core; it now lives in
  // NormalizeTripleClickSelectionExtension, which only rich-text and
  // plain-text editors get. Apply the same correction here.
  let tripleClickAt = 0;
  function onPointerClick(event: MouseEvent): void {
    if (event.detail > 2) tripleClickAt = Date.now();
  }
  const $fixTripleClickOverselection = NormalizeTripleClickSelectionExtension.config?.$fixFocusOverselection;
  if (!$fixTripleClickOverselection) throw new Error("@lexical/extension no longer provides $fixFocusOverselection");
  function onPlainTextBeforeInput(event: Event): void {
    const input = event as InputEvent;
    if (event.defaultPrevented || input.inputType !== "insertText" || input.isComposing || input.data === null) return;
    // Zettel spans are custom TextNodes. Native browser insertion after a
    // formatting boundary can place the next character before a trailing
    // space even when Lexical's selection is after it. Keep ordinary typing
    // on the same controlled path as empty-block insertion. Composition stays
    // native so IME input is not interrupted.
    event.preventDefault();
    event.stopImmediatePropagation();
    editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, input.data);
  }
  return mergeRegister(
    options.markdownShortcuts ? registerZettelMarkdownShortcuts(editor, $setZettelLink) : () => {},
    // Above COMMAND_PRIORITY_EDITOR: from Lexical 0.50, core's own keydown
    // dispatch is a KEY_DOWN_COMMAND listener at that priority and handles
    // every key, so a listener registered after it there never runs.
    options.onLinkShortcut ? editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
      if (!isLinkShortcut(event)) return false;
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      const href = currentLinkHref(selection);
      if (selection.isCollapsed() && href === undefined) return false;
      event.preventDefault();
      const saved = selection.clone();
      const apply = (result: string | null | undefined) => {
        if (result === undefined) return;
        editor.update(() => {
          if (saved.getNodes().every((node) => node.isAttached())) $setSelection(saved.clone());
          $setZettelLink(result);
        });
      };
      const result = options.onLinkShortcut!({ text: selection.getTextContent(), ...(href === undefined ? {} : { href }) });
      if (result instanceof Promise) void result.then(apply, () => {});
      else apply(result);
      return true;
    }, COMMAND_PRIORITY_LOW) : () => {},
    unregisterRoot,
    editor.registerCommand(SELECTION_CHANGE_COMMAND, () => {
      if (tripleClickAt && Date.now() - tripleClickAt <= TRIPLE_CLICK_SELECTION_MS) {
        tripleClickAt = 0;
        $fixTripleClickOverselection();
      }
      return false;
    }, COMMAND_PRIORITY_BEFORE_CRITICAL),
    // Lexical creates a plain ParagraphNode where it needs an empty block:
    // since 0.50 a select-all delete removes every block and leaves one, and
    // inline content inserted at the root is wrapped in one. Zettel documents
    // have no ParagraphNode, so turn it into an ordinary text block before it
    // renders; otherwise Enter cannot split it and it has no stable key.
    editor.registerNodeTransform(ParagraphNode, (paragraph) => {
      paragraph.replace($createZettelTextBlockNode({ style: "normal", markDefs: [] }), true);
    }),
    editor.registerCommand(SET_ZETTEL_LINK_COMMAND, $setZettelLink, COMMAND_PRIORITY_EDITOR),
    registerHistory(editor, createEmptyHistoryState(), 300),
    // Lexical routes typing in empty blocks (and other controlled insertion
    // cases) through this command rather than a native text-node mutation.
    editor.registerCommand(CONTROLLED_TEXT_INSERTION_COMMAND, (eventOrText) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      // Spell-check replacements (insertReplacementText) and text drops
      // (insertFromDrop) carry their text in dataTransfer, not in data.
      const text = typeof eventOrText === "string"
        ? eventOrText
        : eventOrText.data ?? eventOrText.dataTransfer?.getData("text/plain") ?? null;
      if (text === null) return false;
      if (selection.isCollapsed() && $isRootNode(selection.anchor.getNode())) {
        // A caret directly in the root (a document without blocks) would make
        // Lexical insert its own ParagraphNode. Type into a Zettel block.
        const block = $createZettelTextBlockNode({ style: "normal", markDefs: [] });
        const root = selection.anchor.getNode() as ReturnType<typeof $getRoot>;
        const before = root.getChildAtIndex(selection.anchor.offset);
        if (before) before.insertBefore(block); else root.append(block);
        block.select();
        const next = $getSelection();
        if (!$isRangeSelection(next)) return false;
        next.insertText(text);
        return true;
      }
      if (selection.isCollapsed()) {
        selection.insertText(text);
        return true;
      }
      // Replace the range as RangeSelection.insertText does (the text takes
      // the format of the first selected character), but remove it through
      // the guarded path.
      const first = (selection.isBackward() ? selection.focus : selection.anchor).getNode();
      const format = $isTextNode(first) ? first.getFormat() : selection.format;
      const style = $isTextNode(first) ? first.getStyle() : selection.style;
      $deleteSelection(selection, (current) => current.removeText());
      const caret = $getSelection();
      if (!$isRangeSelection(caret)) return false;
      caret.format = format;
      caret.style = style;
      if (text) caret.insertText(text);
      return true;
    }, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(FORMAT_TEXT_COMMAND, (format) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      // Zettel spans store strong, em, underline, strike-through and code.
      // Any other Lexical format (sub/superscript, highlight) would be
      // invisible, split the span and be dropped on export.
      if (!ZETTEL_TEXT_FORMATS.has(format)) return true;
      if (selection.isCollapsed()) selection.formatText(format);
      else selection.formatText(format, toggleTextFormatType($selectedTextFormat(selection), format, null));
      return true;
    }, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(COPY_COMMAND, (event) => copyDocumentToClipboard(editor, event && "clipboardData" in event ? event as ClipboardEvent : null), COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(PASTE_COMMAND, (event) => {
      if (!event || !("clipboardData" in event) || !event.clipboardData) return false;
      const result = pasteClipboardData(editor, event.clipboardData);
      if (result.diagnostics?.length) options.onPasteDiagnostics?.(result.diagnostics);
      if (result.handled) (event as ClipboardEvent).preventDefault();
      return result.handled;
    }, COMMAND_PRIORITY_EDITOR),
    // The source side of a drag-and-drop move (deleteByDrag) and of
    // deleteByCut; Lexical has already prevented the browser default.
    editor.registerCommand(REMOVE_TEXT_COMMAND, () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      $deleteSelection(selection, (current) => current.removeText());
      return true;
    }, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(CUT_COMMAND, (event) => {
      if (!event) return false;
      const copied = copyDocumentToClipboard(editor, "clipboardData" in event ? event as ClipboardEvent : null);
      if (!copied) return false;
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $deleteSelection(selection, (current) => current.removeText());
      return true;
    }, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(KEY_BACKSPACE_COMMAND, (event) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      event?.preventDefault();
      $deleteSelection(selection, (current) => current.deleteCharacter(true), true);
      return true;
    }, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(KEY_DELETE_COMMAND, (event) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      event?.preventDefault();
      $deleteSelection(selection, (current) => current.deleteCharacter(false));
      return true;
    }, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(DELETE_CHARACTER_COMMAND, (isBackward) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      $deleteSelection(selection, (current) => current.deleteCharacter(isBackward), isBackward);
      return true;
    }, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(DELETE_WORD_COMMAND, (isBackward) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      // A word or line deletion of a range deletes the range.
      $deleteSelection(selection, (current) => current.isCollapsed() ? current.deleteWord(isBackward) : current.deleteCharacter(isBackward), isBackward);
      return true;
    }, COMMAND_PRIORITY_EDITOR),
    // Cmd+Backspace / Cmd+Delete on macOS; Lexical has already prevented the
    // browser default, so an unhandled command would swallow the key.
    editor.registerCommand(DELETE_LINE_COMMAND, (isBackward) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      $deleteSelection(selection, (current) => current.isCollapsed() ? current.deleteLine(isBackward) : current.deleteCharacter(isBackward), isBackward);
      return true;
    }, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      const current = $getSelection();
      if (!$isRangeSelection(current)) return false;
      let selection: RangeSelection = current;
      // Return replaces a selected range before it creates a block or a hard
      // break. Otherwise selected text could survive a structural edit.
      if (!selection.isCollapsed()) {
        $removeSelectedText(selection);
        const next = $getSelection();
        if (!$isRangeSelection(next)) return false;
        selection = next;
      }

      const anchor = selection.anchor.getNode();
      const code = nearestAncestor(anchor, ZettelCodeNode);
      if (code) {
        // Keep code line breaks as Lexical LineBreakNodes. Chromium treats a
        // terminal literal newline in a contenteditable text node as a visual
        // line ending and inserts the next native character before it.
        selection.insertLineBreak();
        event?.preventDefault();
        return true;
      }

      const textBlock = nearestAncestor(anchor, ZettelTextBlockNode);
      if (textBlock && event?.shiftKey && !(anchor instanceof ZettelSpanNode)) {
        // An empty block, or the caret right after a trailing break.
        selection.insertNodes([$createZettelBreakNode({})]);
        event.preventDefault();
        return true;
      }
      if (textBlock && !event?.shiftKey && isEmptyTextBlock(textBlock) && $exitContainer(textBlock)) {
        // Return in an empty list item or on an empty last line of a quote
        // leaves the list or quote, like other rich-text editors.
        event?.preventDefault();
        return true;
      }
      if (textBlock && (anchor instanceof ZettelSpanNode || anchor.is(textBlock))) {
        const at = anchor instanceof ZettelSpanNode ? anchor : textBlock;
        if (event?.shiftKey && at instanceof ZettelSpanNode) insertHardBreak(textBlock, at, selection.anchor.offset);
        else {
          const item = textBlock.getParent();
          if (item instanceof ZettelListItemNode) splitListItem(item, textBlock, at, selection.anchor.offset);
          else splitTextBlock(textBlock, at, selection.anchor.offset);
        }
        event?.preventDefault();
        return true;
      }

      // Table cells have inline children by contract. Keep Return inside the
      // cell as an explicit hard break instead of creating a root paragraph.
      const cell = nearestAncestor(anchor, ZettelTableCellNode);
      if (cell && anchor instanceof ZettelSpanNode) {
        insertHardBreak(cell, anchor, selection.anchor.offset);
        event?.preventDefault();
        return true;
      }

      const top = anchor.getTopLevelElement();
      const block = $createZettelTextBlockNode({ style: "normal", markDefs: [] });
      if (top?.getParent()) top.insertAfter(block); else $getRoot().append(block);
      block.selectStart();
      event?.preventDefault();
      return true;
    }, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(SELECT_ALL_COMMAND, () => { $selectAll(); return true; }, COMMAND_PRIORITY_EDITOR),
    // Lexical's generic merging and deletion knows nothing about Zettel's
    // container and link contracts. Repair them before the update commits,
    // so an edit can never leave a document that exportDocument rejects.
    editor.registerNodeTransform(ZettelListNode, $normalizeList),
    editor.registerNodeTransform(ZettelListItemNode, $normalizeListItem),
    editor.registerNodeTransform(ZettelQuoteNode, $wrapInlineChildren),
    editor.registerNodeTransform(ZettelTextBlockNode, $resolveLinkMarks),
    editor.registerNodeTransform(ZettelTableCellNode, $resolveLinkMarks),
  );
}

function isEmptyTextBlock(block: ZettelTextBlockNode): boolean {
  return block.getChildren().every((child) => child instanceof ZettelSpanNode && child.getTextContentSize() === 0);
}

/** Return in an empty text block that ends a list item or a quote. */
function $exitContainer(block: ZettelTextBlockNode): boolean {
  const parent = block.getParent();
  if (parent instanceof ZettelListItemNode) {
    if (parent.getChildrenSize() !== 1) return false;
    if ($outdentListItem(parent)) { block.selectStart(); return true; }
    $liftListItem(parent)?.selectStart();
    return true;
  }
  if (parent instanceof ZettelQuoteNode && block.is(parent.getLastChild())) {
    parent.insertAfter(block);
    if (parent.isEmpty()) parent.remove();
    block.selectStart();
    return true;
  }
  return false;
}

function isInlineNode(node: LexicalNode): boolean {
  return $isTextNode(node) || $isLineBreakNode(node) || (($isElementNode(node) || $isDecoratorNode(node)) && node.isInline());
}

/** Containers of blocks hold blocks: wrap stray inline children in a text block. */
function $wrapInlineChildren(container: ElementNode): void {
  let run: ZettelTextBlockNode | null = null;
  for (const child of container.getChildren()) {
    if (!isInlineNode(child)) { run = null; continue; }
    if (!run) {
      run = $createZettelTextBlockNode({ style: "normal", markDefs: [] });
      child.insertBefore(run);
    }
    // $resolveLinkMarks gives moved links a definition in the new block.
    run.append(child);
  }
}

const DECORATOR_MARKS = new Set(["strong", "em", "underline", "strike-through", "code"]);

/**
 * Deleting across blocks merges the spans of one block into another, but the
 * link definitions stay in the block they came from. Give a moved linked span
 * a definition in its new block, and drop marks that cannot be resolved.
 */
function $resolveLinkMarks(block: ZettelTextBlockNode | ZettelTableCellNode): void {
  let markDefs = block.markDefs;
  for (const child of block.getChildren()) {
    if (!(child instanceof ZettelSpanNode || child instanceof ZettelImageNode || child instanceof ZettelInlineHtmlNode || child instanceof ZettelBreakNode)) continue;
    const marks = child instanceof ZettelSpanNode ? child.getMarks() : child.marks;
    const unresolved = marks.filter((mark) => !DECORATOR_MARKS.has(mark) && !markDefs.some((definition) => definition._key === mark));
    if (!unresolved.length) continue;
    const next = marks.filter((mark) => !unresolved.includes(mark));
    const href = (child instanceof ZettelSpanNode || child instanceof ZettelImageNode ? child.getLinkHref() : undefined) ?? $previousLinkHref(child, unresolved);
    if (href && !next.some((mark) => markDefs.some((definition) => definition._key === mark))) {
      let definition = markDefs.find((candidate) => candidate.href === href);
      if (!definition) {
        definition = { _type: "zettel_link", _key: generateKey(), href };
        markDefs = [...markDefs, definition];
      }
      next.push(definition._key);
    }
    const linked = next.some((mark) => markDefs.some((definition) => definition._key === mark));
    if (child instanceof ZettelSpanNode) {
      child.setMarks(next);
      child.setLinkHref(linked ? href : undefined);
    } else {
      (child.getWritable() as typeof child).marks = next;
      if (child instanceof ZettelImageNode) child.setLinkHref(linked ? href : undefined);
    }
  }
  if (markDefs !== block.markDefs) block.getWritable().markDefs = markDefs;
}

function $normalizeList(list: ZettelListNode): void {
  for (const child of list.getChildren()) {
    if (child instanceof ZettelListItemNode) continue;
    const item = new ZettelListItemNode({ _type: "zettel_list_item", _key: generateKey(), spread: list.spread });
    child.insertBefore(item);
    item.append(child);
    $wrapInlineChildren(item);
  }
  // A list has at least one item.
  if (list.isEmpty()) list.remove();
}

function $normalizeListItem(item: ZettelListItemNode): void {
  // An item that lost its blocks (its text was merged into the previous
  // item) would stay behind as an empty bullet.
  if (item.isEmpty()) { item.remove(); return; }
  if (!(item.getParent() instanceof ZettelListNode)) {
    for (const child of item.getChildren()) item.insertBefore(child);
    item.remove();
    return;
  }
  $wrapInlineChildren(item);
}

/** True when the selection spans from the first to the last position of the document. */
function $selectsWholeDocument(selection: RangeSelection): boolean {
  if (selection.isCollapsed()) return false;
  const [start, end] = selection.isBackward() ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];
  const root = $getRoot();
  return isDocumentEdge(start, root.getFirstDescendant(), "start") && isDocumentEdge(end, root.getLastDescendant(), "end");
}

function isDocumentEdge(point: PointType, leaf: LexicalNode | null, edge: "start" | "end"): boolean {
  if (!leaf) return false;
  const node = point.getNode();
  if (point.type === "text") return node.is(leaf) && point.offset === (edge === "start" ? 0 : node.getTextContentSize());
  if (!$isElementNode(node)) return false;
  const inner = edge === "start" ? node.getFirstDescendant() : node.getLastDescendant();
  return (inner ?? node).is(leaf) && point.offset === (edge === "start" ? 0 : node.getChildrenSize());
}

/**
 * Delete through Lexical, but when everything was selected leave one empty
 * paragraph rather than an empty list item or quote.
 */
function $deleteSelection(selection: RangeSelection, remove: (selection: RangeSelection) => void, isBackward = false): void {
  if (isBackward && $liftAtStart(selection)) return;
  const whole = $selectsWholeDocument(selection);
  $editRange(selection, () => remove(selection));
  if (!whole) return;
  const root = $getRoot();
  if (root.getAllTextNodes().some((node) => node.getTextContentSize() > 0)) return;
  const first = root.getFirstChild();
  if (root.getChildrenSize() === 1 && first instanceof ZettelTextBlockNode) return;
  root.clear();
  const block = $createZettelTextBlockNode({ style: "normal", markDefs: [] });
  root.append(block);
  block.selectStart();
}

function listContinuation(list: ZettelListNode, firstIndex: number): ZettelListNode {
  // The items after a removed item continue its count.
  return new ZettelListNode({ _type: "zettel_list", kind: list.kind, spread: list.spread, ...(list.kind === "number" ? { start: (list.start ?? 1) + firstIndex } : {}) });
}

/**
 * Replace a list item with its blocks at the list's position, splitting the
 * list around it. Returns the first lifted block (an empty text block if the
 * item had none), or null if the item is not in a list.
 */
function $liftListItem(item: ZettelListItemNode): ElementNode | null {
  const list = item.getParent();
  if (!(list instanceof ZettelListNode)) return null;
  const index = list.getChildren().indexOf(item);
  const following = item.getNextSiblings();
  if (following.length) {
    const rest = listContinuation(list, index);
    rest.append(...following);
    list.insertAfter(rest);
  }
  const blocks = item.getChildren();
  if (!blocks.length) blocks.push($createZettelTextBlockNode({ style: "normal", markDefs: [] }));
  let cursor: LexicalNode = list;
  for (const block of blocks) { cursor.insertAfter(block); cursor = block; }
  item.remove();
  if (list.isEmpty()) list.remove();
  const first = blocks[0];
  return first instanceof ElementNode ? first : null;
}

/**
 * Move an item of a nested list to the parent list, directly after the item
 * that contains the nested list. Items and blocks that followed it move into
 * it, so the visual order is kept. Returns false for a top-level list.
 */
function $outdentListItem(item: ZettelListItemNode): boolean {
  const list = item.getParent();
  const parentItem = list?.getParent();
  if (!(list instanceof ZettelListNode) || !(parentItem instanceof ZettelListItemNode)) return false;
  const following = item.getNextSiblings();
  if (following.length) {
    const rest = listContinuation(list, list.getChildren().indexOf(item));
    rest.append(...following);
    item.append(rest);
  }
  item.append(...list.getNextSiblings());
  parentItem.insertAfter(item);
  if (list.isEmpty()) list.remove();
  return true;
}

/**
 * Move a block out of its quote. The first block moves before the quote, a
 * later one after it; the blocks that followed it stay quoted after it.
 */
function $liftQuoteBlock(quote: ZettelQuoteNode, block: ElementNode): void {
  if (!block.getPreviousSibling()) quote.insertBefore(block);
  else {
    const following = block.getNextSiblings();
    quote.insertAfter(block);
    if (following.length) {
      const rest = new ZettelQuoteNode({ _type: "zettel_quote" });
      block.insertAfter(rest);
      rest.append(...following);
    }
  }
  if (quote.isEmpty()) quote.remove();
}

function isEmptySpan(node: LexicalNode): boolean {
  return node instanceof ZettelSpanNode && node.getTextContentSize() === 0;
}

/**
 * The text block whose very start a collapsed caret is at. The caret can be
 * a text point in the block's first non-empty span, an element point on the
 * block, or an element point at the start of the list item or quote that
 * holds it, depending on how the browser placed it.
 */
function $textBlockAtCaretStart(selection: RangeSelection): ZettelTextBlockNode | undefined {
  if (!selection.isCollapsed()) return undefined;
  let node: LexicalNode = selection.anchor.getNode();
  let offset = selection.anchor.offset;
  while ((node instanceof ZettelListItemNode || node instanceof ZettelQuoteNode) && offset === 0) {
    const first = node.getFirstChild();
    if (!first) return undefined;
    node = first;
  }
  const block = nearestAncestor(node, ZettelTextBlockNode);
  if (!block) return undefined;
  if (node.is(block)) return block.getChildren().slice(0, offset).every(isEmptySpan) ? block : undefined;
  if (offset !== 0) return undefined;
  let child: LexicalNode = node;
  while (!child.getParent()?.is(block)) child = child.getParentOrThrow();
  return child.getPreviousSiblings().every(isEmptySpan) ? block : undefined;
}

/**
 * Backspace at the very start of a list item or of a quote line, like other
 * rich-text editors: a nested item moves up one level, a top-level item
 * becomes a paragraph, and a quote line moves out of the quote. The text is
 * kept, not merged into the previous block.
 */
function $liftAtStart(selection: RangeSelection): boolean {
  const block = $textBlockAtCaretStart(selection);
  if (!block) return false;
  const parent = block.getParent();
  if (parent instanceof ZettelListItemNode && parent.getFirstChild()?.is(block)) {
    if (!$outdentListItem(parent)) $liftListItem(parent);
    block.selectStart();
    return true;
  }
  if (parent instanceof ZettelQuoteNode) {
    $liftQuoteBlock(parent, block);
    block.selectStart();
    return true;
  }
  return false;
}

function isLinkShortcut(event: KeyboardEvent): boolean {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return event.key.toLowerCase() === "k" && !event.shiftKey && !event.altKey && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

function currentLinkHref(selection: RangeSelection): string | undefined {
  for (const node of selection.getNodes()) {
    const parent = node.getParent();
    if (!(node instanceof ZettelSpanNode) || !(parent instanceof ZettelTextBlockNode || parent instanceof ZettelTableCellNode)) continue;
    const marks = node.toZettel().marks;
    const link = parent.markDefs.find((definition) => marks.includes(definition._key));
    if (link) return link.href;
  }
  return undefined;
}

/**
 * The href a node's link mark resolved to before this update, in the block
 * that held it then. Nodes restored from serialized Lexical state do not
 * carry their href, only the key of a definition in their old block.
 */
function $previousLinkHref(node: LexicalNode, marks: string[]): string | undefined {
  const previous = $getEditor().getEditorState()._nodeMap;
  const parentKey = previous.get(node.getKey())?.__parent;
  const parent = parentKey ? previous.get(parentKey) : undefined;
  if (!(parent instanceof ZettelTextBlockNode || parent instanceof ZettelTableCellNode)) return undefined;
  return marks.map((mark) => parent.markDefs.find((definition) => definition._key === mark)?.href).find(Boolean);
}

function onChecklistChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
  const key = target.closest<HTMLElement>("[data-zettel-key]")?.dataset.zettelKey;
  if (!key) return;
  const editor = (target.closest("[contenteditable]") as HTMLElement & { __zettelEditor?: LexicalEditor })?.__zettelEditor;
  if (editor) setZettelListItemChecked(editor, key, target.checked);
}

function nearestAncestor<T extends LexicalNode>(node: LexicalNode, ctor: new (...args: any[]) => T): T | undefined {
  let current: LexicalNode | null = node;
  while (current) {
    if (current instanceof ctor) return current;
    current = current.getParent();
  }
  return undefined;
}

function linkHrefFor(block: ZettelTextBlockNode | ZettelTableCellNode, marks: string[]): string | undefined {
  return marks.map((mark) => block.markDefs.find((definition) => definition._key === mark)?.href).find(Boolean);
}

function newSpanWithMarks(marks: string[], text: string, block: ZettelTextBlockNode | ZettelTableCellNode): ZettelSpanNode {
  const result = new ZettelSpanNode({ _type: "zettel_span", _key: generateKey(), text, marks });
  result.setLinkHref(linkHrefFor(block, result.toZettel().marks));
  return result;
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

function splitTextBlock(block: ZettelTextBlockNode, anchor: ZettelSpanNode | ZettelTextBlockNode, offset: number): void {
  const trailing = splitBlockContent(block, anchor, offset);
  block.insertAfter(trailing);
  trailing.selectStart();
}

function splitBlockContent(block: ZettelTextBlockNode, anchor: ZettelSpanNode | ZettelTextBlockNode, offset: number): ZettelTextBlockNode {
  const cloned = cloneMarkDefs(block.markDefs);
  const trailing = $createZettelTextBlockNode({ style: block.style, markDefs: cloned.markDefs });
  const siblings = block.getChildren();
  if (anchor.is(block)) {
    // The caret sits between inline nodes (next to an image or a break).
    for (const node of siblings.slice(offset)) {
      node.remove();
      remapInlineMarks(node, cloned.marks);
      trailing.append(node);
    }
    return trailing;
  }
  if (!(anchor instanceof ZettelSpanNode)) return trailing;
  const index = siblings.indexOf(anchor);
  const source = anchor.getTextContent();
  const marks = anchor.toZettel().marks;
  const left = source.slice(0, offset);
  const right = source.slice(offset);
  const rightNodes = siblings.slice(index + 1);
  if (left) anchor.setTextContent(left); else anchor.remove();
  if (right) rightNodes.unshift(newSpanWithMarks(marks.map((mark) => cloned.marks.get(mark) ?? mark), right, trailing));
  for (const node of rightNodes) {
    node.remove();
    remapInlineMarks(node, cloned.marks);
    trailing.append(node);
  }
  return trailing;
}

function splitListItem(item: ZettelListItemNode, block: ZettelTextBlockNode, anchor: ZettelSpanNode | ZettelTextBlockNode, offset: number): void {
  const trailing = splitBlockContent(block, anchor, offset);
  const itemBlocks = item.getChildren();
  const blockIndex = itemBlocks.indexOf(block);
  const followingBlocks = itemBlocks.slice(blockIndex + 1);
  const nextItem = new ZettelListItemNode({
    _type: "zettel_list_item",
    _key: generateKey(),
    spread: item.spread,
    ...(item.checked === undefined ? {} : { checked: false }),
  });
  // A newly created task item is unchecked. Preserve the existing item's
  // remaining blocks and paragraph structure after the split point.
  nextItem.append(trailing);
  for (const following of followingBlocks) { following.remove(); nextItem.append(following); }
  item.insertAfter(nextItem);
  nextItem.selectStart();
}

function insertHardBreak(parent: ZettelTextBlockNode | ZettelTableCellNode, anchor: ZettelSpanNode, offset: number): void {
  const source = anchor.getTextContent();
  const marks = anchor.toZettel().marks;
  const left = source.slice(0, offset);
  const right = source.slice(offset);
  const before = anchor.getPreviousSibling();
  const after = anchor.getNextSibling();
  if (left) anchor.setTextContent(left); else anchor.remove();
  const breakNode = $createZettelBreakNode({});
  const cursor = left ? anchor : before;
  if (cursor) cursor.insertAfter(breakNode);
  else if (after) after.insertBefore(breakNode);
  else parent.append(breakNode);
  if (right) {
    const rightNode = newSpanWithMarks(marks, right, parent);
    breakNode.insertAfter(rightNode);
    rightNode.select(0, 0);
  } else {
    parent.selectEnd();
  }
}

/** Set checklist state by the stable Zettel key (also used by the DOM change listener). */
export function setZettelListItemChecked(editor: LexicalEditor, zettelKey: string, checked?: boolean): boolean {
  let changed = false;
  editor.update(() => {
    const visit = (node: any): void => {
      if (node instanceof ZettelListItemNode && node._key === zettelKey) {
        const writable = node.getWritable() as ZettelListItemNode;
        writable.checked = checked ?? !Boolean(writable.checked);
        changed = true;
        return;
      }
      if (node.getChildren) for (const child of node.getChildren()) visit(child);
    };
    visit($getRoot());
  }, { discrete: true });
  return changed;
}

/** Small convenience for vanilla apps that need a serializable snapshot. */
export function getZettelDocument(editor: LexicalEditor) { return exportDocument(editor); }
