// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, KEY_ENTER_COMMAND, SELECT_ALL_COMMAND, type LexicalEditor } from 'lexical';
import { createZettelEditor, registerZettelLexicalPlugin, loadDocument, exportDocument, ZettelListItemNode, ZettelSpanNode } from './index.js';

// A list in a comment box arrives by paste; the writer then has to be able to
// continue after it and to get rid of it with the keyboard.
const paragraph = (key: string, text: string, extra: Record<string, unknown> = {}) => ({ _type: 'zettel_block', _key: key, style: 'normal', markDefs: [], children: text ? [{ _type: 'zettel_span', _key: `${key}-s`, text, marks: [] }] : [], ...extra });
const item = (key: string, text: string, more: unknown[] = []) => ({ _type: 'zettel_list_item', _key: key, spread: false, blocks: [paragraph(`${key}-b`, text), ...more] });
const list = (key: string, items: unknown[], kind = 'bullet') => ({ _type: 'zettel_list', _key: key, kind, spread: false, items, ...(kind === 'number' ? { start: 1 } : {}) });
function setup(blocks: unknown[] = [list('list', [item('a', 'one'), item('b', 'two')])]): LexicalEditor {
 const editor = createZettelEditor({ onError: error => { throw error; } });
 const element = document.createElement("div");
 document.body.append(element);
 editor.setRootElement(element);
 registerZettelLexicalPlugin(editor);
 loadDocument(editor, { _type: 'zettel_doc', blocks } as any);
 return editor;
}
const key = (name: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: name, ...init });
const caretInItem = (editor: LexicalEditor, index: number, offset: number) => editor.update(() => {
 (($getRoot().getFirstChildOrThrow() as any).getChildAtIndex(index).getFirstChild().getFirstChild()).select(offset, offset);
}, { discrete: true });
const caretAtText = (editor: LexicalEditor, text: string, offset: number) => editor.update(() => {
 const node = $getRoot().getAllTextNodes().find(candidate => candidate.getTextContent() === text)!;
 node.select(offset, offset);
}, { discrete: true });
const press = (editor: LexicalEditor, name: 'Enter' | 'Backspace' | 'Delete') => editor.update(() => {
 editor.dispatchCommand(name === 'Enter' ? KEY_ENTER_COMMAND : name === 'Backspace' ? KEY_BACKSPACE_COMMAND : KEY_DELETE_COMMAND, key(name));
}, { discrete: true });
const items = (editor: LexicalEditor) => (exportDocument(editor).blocks[0] as any).items as any[];
const text = (block: any): string => block.children ? block.children.map((child: any) => child.text ?? '\n').join('') : '';
// A compact picture of the document: text blocks as strings, lists as arrays of items.
const shape = (blocks: any[]): unknown[] => blocks.map(block => block._type === 'zettel_block' ? text(block) : block._type === 'zettel_list' ? { [block.kind]: block.items.map((listItem: any) => shape(listItem.blocks)) } : block._type === 'zettel_quote' ? { quote: shape(block.blocks) } : block._type);
const selectedText = (editor: LexicalEditor) => editor.getEditorState().read(() => { const selection = $getSelection(); return $isRangeSelection(selection) ? [selection.anchor.getNode().getTextContent(), selection.anchor.offset] : null; });

it('Backspace at the start of a list item joins it to the previous item without leaving an empty item', () => {
 const editor = setup();
 caretInItem(editor, 1, 0);
 press(editor, 'Backspace');
 expect(items(editor).every(listItem => listItem.blocks.length > 0)).toBe(true);
 expect(items(editor)).toHaveLength(1);
 // The first Backspace turns the item into a paragraph, the second joins it.
 expect(shape(exportDocument(editor).blocks)).toEqual([{ bullet: [['one']] }, 'two']);
 press(editor, 'Backspace');
 expect(shape(exportDocument(editor).blocks)).toEqual([{ bullet: [['onetwo']] }]);
 // The caret stays at the join.
 expect(selectedText(editor)).toEqual(['one', 3]);
});

it('Enter on an empty last list item leaves the list instead of adding a paragraph after it', () => {
 const editor = setup();
 caretInItem(editor, 1, 3);
 press(editor, 'Enter');
 press(editor, 'Enter');
 const blocks = exportDocument(editor).blocks as any[];
 expect(blocks.map(block => block._type)).toEqual(['zettel_list', 'zettel_block']);
 expect(blocks[0].items).toHaveLength(2);
});

it('select all + Backspace over a list leaves one empty paragraph, not an empty bullet', () => {
 const editor = setup();
 editor.update(() => { editor.dispatchCommand(SELECT_ALL_COMMAND, undefined as any); }, { discrete: true });
 press(editor, 'Backspace');
 expect(exportDocument(editor).blocks.map(block => block._type)).toEqual(['zettel_block']);
});

it('select all + Delete over paragraphs, a quote and a list leaves one empty paragraph', () => {
 const editor = setup([paragraph('p', 'intro'), { _type: 'zettel_quote', _key: 'q', blocks: [paragraph('q1', 'quoted')] }, list('list', [item('a', 'one'), item('b', 'two')])]);
 editor.update(() => { editor.dispatchCommand(SELECT_ALL_COMMAND, undefined as any); }, { discrete: true });
 press(editor, 'Delete');
 expect(shape(exportDocument(editor).blocks)).toEqual(['']);
});

it('Backspace in the only, empty item removes the bullet', () => {
 const editor = setup([list('list', [item('a', '')])]);
 editor.update(() => { ($getRoot().getFirstChildOrThrow() as any).getFirstChild().getFirstChild().selectStart(); }, { discrete: true });
 press(editor, 'Backspace');
 expect(shape(exportDocument(editor).blocks)).toEqual(['']);
});

it('Backspace at the start of the first item turns it into a paragraph before the rest of the list', () => {
 const editor = setup([list('list', [item('a', 'one'), item('b', 'two'), item('c', 'three')], 'number')]);
 caretInItem(editor, 0, 0);
 press(editor, 'Backspace');
 const blocks = exportDocument(editor).blocks as any[];
 expect(shape(blocks)).toEqual(['one', { number: [['two'], ['three']] }]);
 // The remaining items continue the count without the lifted item.
 expect(blocks[1].start).toBe(1);
 expect(selectedText(editor)).toEqual(['one', 0]);
});

it('Enter on an empty item in the middle splits the list around a paragraph', () => {
 const editor = setup([list('list', [item('a', 'one'), item('b', 'two'), item('c', 'three')], 'number')]);
 caretInItem(editor, 0, 3);
 press(editor, 'Enter');
 press(editor, 'Enter');
 const blocks = exportDocument(editor).blocks as any[];
 expect(shape(blocks)).toEqual([{ number: [['one']] }, '', { number: [['two'], ['three']] }]);
 expect(blocks[2].start).toBe(2);
});

it('Enter on an empty nested item outdents it', () => {
 const editor = setup([list('list', [item('a', 'one', [list('nested', [item('n', 'inner')])]), item('b', 'two')])]);
 caretAtText(editor, 'inner', 5);
 press(editor, 'Enter');
 press(editor, 'Enter');
 expect(shape(exportDocument(editor).blocks)).toEqual([{ bullet: [['one', { bullet: [['inner']] }], [''], ['two']] }]);
});

it('Enter on an empty last line of a quote leaves the quote; Backspace at its start lifts the line out', () => {
 const editor = setup([{ _type: 'zettel_quote', _key: 'q', blocks: [paragraph('q1', 'quoted')] }]);
 caretAtText(editor, 'quoted', 6);
 press(editor, 'Enter');
 press(editor, 'Enter');
 expect(shape(exportDocument(editor).blocks)).toEqual([{ quote: ['quoted'] }, '']);
 caretAtText(editor, 'quoted', 0);
 press(editor, 'Backspace');
 expect(shape(exportDocument(editor).blocks)).toEqual(['quoted', '']);
});

it('deleting from a list item into the paragraph after the list keeps a valid document', () => {
 const editor = setup([list('list', [item('a', 'one'), item('b', 'two')]), { ...paragraph('p', ''), markDefs: [{ _type: 'zettel_link', _key: 'link', href: 'https://example.com' }], children: [{ _type: 'zettel_span', _key: 's1', text: 'see ', marks: [] }, { _type: 'zettel_span', _key: 's2', text: 'docs', marks: ['link'] }] }]);
 editor.update(() => {
  const two = $getRoot().getAllTextNodes().find(node => node.getTextContent() === 'two')!;
  const see = $getRoot().getAllTextNodes().find(node => node.getTextContent() === 'see ')!;
  const selection = two.select(1, 1);
  selection.focus.set(see.getKey(), 4, 'text');
 }, { discrete: true });
 press(editor, 'Backspace');
 const blocks = exportDocument(editor).blocks as any[];
 expect(shape(blocks)).toEqual([{ bullet: [['one'], ['tdocs']] }]);
 // The link moved with its text and still resolves.
 const merged = blocks[0].items[1].blocks[0];
 const linked = merged.children.find((child: any) => child.text === 'docs');
 expect(merged.markDefs.find((definition: any) => linked.marks.includes(definition._key))?.href).toBe('https://example.com');
});

it('repairs list structure that Lexical edits can leave behind before it is committed', () => {
 const editor = setup([list('list', [item('a', 'one'), item('b', 'two')]), list('other', [item('c', 'three')])]);
 editor.update(() => {
  const [first, second] = $getRoot().getChildren() as any[];
  // Text directly in an item, an item without blocks, and a list without items.
  (first.getFirstChild() as ZettelListItemNode).append(new ZettelSpanNode({ text: 'stray', marks: [] }));
  (first.getLastChild() as ZettelListItemNode).clear();
  second.getFirstChild().remove();
 }, { discrete: true });
 expect(shape(exportDocument(editor).blocks)).toEqual([{ bullet: [['one', 'stray']] }]);
});
