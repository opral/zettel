// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, CONTROLLED_TEXT_INSERTION_COMMAND, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, KEY_ENTER_COMMAND, PASTE_COMMAND, SELECT_ALL_COMMAND, type LexicalEditor } from 'lexical';
import { createZettelEditor, registerZettelLexicalPlugin, loadDocument, exportDocument } from './index.js';

// Seeded random editing (caret and range selections, Enter, Shift+Enter,
// Backspace, Delete, typing and pasting) over lists, quotes and links. An
// edit may be refused, but it must never leave a document that
// exportDocument rejects: that made every later keystroke throw.

// jsdom has no Selection.modify, which Lexical uses to extend a caret by a character.
(Selection.prototype as any).modify ??= function (this: Selection, alter: string, direction: string) {
 const node = this.focusNode;
 if (!node || node.nodeType !== Node.TEXT_NODE) return;
 const offset = this.focusOffset + (direction === 'backward' ? -1 : 1);
 if (offset < 0 || offset > (node as Text).length) return;
 if (alter === 'extend') this.extend(node, offset); else this.collapse(node, offset);
};

let seed = 1;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(values: T[]): T => values[Math.floor(random() * values.length)]!;
const span = (key: string, text: string, marks: string[] = []) => ({ _type: 'zettel_span', _key: key, text, marks });
const paragraph = (key: string, text: string) => ({ _type: 'zettel_block', _key: key, style: 'normal', markDefs: [], children: [span(`${key}-s`, text)] });
const linked = (key: string) => ({ _type: 'zettel_block', _key: key, style: 'normal', markDefs: [{ _type: 'zettel_link', _key: `${key}-l`, href: 'https://example.com' }], children: [span(`${key}-1`, 'see '), span(`${key}-2`, 'docs', [`${key}-l`, 'strong']), span(`${key}-3`, ' here')] });
const item = (key: string, text: string, more: unknown[] = []) => ({ _type: 'zettel_list_item', _key: key, spread: false, blocks: [paragraph(`${key}-b`, text), ...more] });
const document_ = () => ({ _type: 'zettel_doc', blocks: [
 paragraph('intro', 'before'),
 linked('link1'),
 { _type: 'zettel_quote', _key: 'quote', blocks: [paragraph('q1', 'quoted'), linked('link2')] },
 { _type: 'zettel_list', _key: 'list', kind: 'bullet', spread: false, items: [item('a', 'one'), item('b', 'two'), item('c', 'three', [{ _type: 'zettel_list', _key: 'nested', kind: 'number', start: 1, spread: false, items: [item('n1', 'inner one'), item('n2', 'inner two')] }])] },
 paragraph('outro', 'after'),
] });
const clipboard = (types: Record<string, string>) => ({ types: Object.keys(types), getData: (type: string) => types[type] ?? '' });
const pastes = [
 clipboard({ 'text/plain': 'x\ny\nz' }),
 clipboard({ 'text/plain': 'word' }),
 clipboard({ 'text/html': '<ul><li>h1</li><li>h2</li></ul>' }),
 clipboard({ 'text/html': '<p>p</p><ul><li>h1</li></ul><p>q</p>' }),
 clipboard({ 'text/html': '<ol><li>a<ul><li>b</li></ul></li></ol>' }),
];
function select(editor: LexicalEditor): void {
 editor.update(() => {
  const texts = $getRoot().getAllTextNodes();
  const elements: any[] = [];
  const visit = (node: any) => { if (node.getChildren) { elements.push(node); node.getChildren().forEach(visit); } };
  visit($getRoot());
  const roll = random();
  if (roll < 0.1) { editor.dispatchCommand(SELECT_ALL_COMMAND, undefined as any); return; }
  if (roll < 0.3 || !texts.length) { const element = pick(elements); if (element.getType() === 'root') return; if (random() < 0.5) element.selectStart(); else element.selectEnd(); return; }
  const anchor = pick(texts);
  const anchorOffset = Math.floor(random() * (anchor.getTextContentSize() + 1));
  anchor.select(anchorOffset, anchorOffset);
  if (random() < 0.5) return;
  const focus = pick(texts);
  const selection = $getSelection();
  if ($isRangeSelection(selection)) selection.focus.set(focus.getKey(), Math.floor(random() * (focus.getTextContentSize() + 1)), 'text');
 }, { discrete: true });
}
const edits: Array<(editor: LexicalEditor) => void> = [
 editor => editor.dispatchCommand(KEY_BACKSPACE_COMMAND, new KeyboardEvent('keydown', { key: 'Backspace' })),
 editor => editor.dispatchCommand(KEY_DELETE_COMMAND, new KeyboardEvent('keydown', { key: 'Delete' })),
 editor => editor.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent('keydown', { key: 'Enter' })),
 editor => editor.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true })),
 editor => editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'k'),
 editor => { const event = new Event('paste') as any; event.clipboardData = pick(pastes); editor.dispatchCommand(PASTE_COMMAND, event); },
];

it('random edit sequences never produce a document exportDocument rejects', () => {
 const failures: string[] = [];
 for (let run = 1; run <= 200; run++) {
  seed = run;
  // Lexical may refuse an edit (the update is then discarded); that is not what this test is about.
  const editor = createZettelEditor({ onError: () => {} });
  const element = document.createElement('div');
  document.body.append(element);
  editor.setRootElement(element);
  const unregister = registerZettelLexicalPlugin(editor);
  loadDocument(editor, document_() as any);
  for (let step = 0; step < 15; step++) {
   if (random() < 0.6) select(editor);
   const edit = pick(edits);
   editor.update(() => edit(editor), { discrete: true });
   try { exportDocument(editor); } catch (error) { failures.push(`seed ${run}, step ${step}: ${(error as Error).message}`); break; }
  }
  unregister();
  editor.setRootElement(null);
  element.remove();
 }
 expect(failures).toEqual([]);
});
