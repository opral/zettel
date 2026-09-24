// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, CONTROLLED_TEXT_INSERTION_COMMAND, FORMAT_TEXT_COMMAND, REMOVE_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND, TextNode } from 'lexical';
import { createZettelEditor, registerZettelLexicalPlugin, loadDocument, exportDocument } from './index.js';
function setup(link = false) {
 const editor = createZettelEditor();
 registerZettelLexicalPlugin(editor);
 loadDocument(editor, { _type: 'zettel_doc', blocks: [{ _type: 'zettel_block', _key: 'p', style: 'normal', markDefs: link ? [{ _type: 'zettel_link', _key: 'link', href: 'https://example.com' }] : [], children: link ? [{ _type: 'zettel_span', _key: 's', text: 'hello world', marks: ['link'] }] : [] }] });
 return editor;
}
it('keeps identities stable across repeated exports of newly typed text', () => {
 const editor = setup();
 editor.update(() => { $getRoot().getFirstChildOrThrow().selectStart(); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'hello'); }, { discrete: true });
 expect(exportDocument(editor)).toEqual(exportDocument(editor));
});
it('keeps the link on every segment when formatting part of a linked span', () => {
 const editor = setup(true);
 editor.update(() => { const node = ($getRoot().getFirstChildOrThrow() as any).getFirstChild() as TextNode; node.select(0, 5); editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'); }, { discrete: true });
 const block = exportDocument(editor).blocks[0] as any;
 expect(block.children.map((node: any) => node.text).join('')).toBe('hello world');
 expect(block.children.every((node: any) => node.marks.includes('link'))).toBe(true);
 expect(block.children.find((node: any) => node.text === 'hello').marks).toContain('strong');
});

it('reconciles fresh typing and formatting in a mounted editor without DOM errors', () => {
 const errors: Error[] = [];
 const editor = createZettelEditor({ onError: error => errors.push(error) });
 const element = document.createElement('div');
 document.body.append(element);
 editor.setRootElement(element);
 const unregister = registerZettelLexicalPlugin(editor);
 try {
  loadDocument(editor, { _type: 'zettel_doc', blocks: [{ _type: 'zettel_block', _key: 'p', style: 'normal', markDefs: [], children: [] }] });
  editor.update(() => { $getRoot().getFirstChildOrThrow().selectStart(); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'hello'); }, { discrete: true });
  editor.update(() => { editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' world'); }, { discrete: true });
  editor.update(() => { const text = ($getRoot().getFirstChildOrThrow() as any).getFirstChild() as TextNode; text.select(0, 5); editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'); }, { discrete: true });
  expect(element.textContent).toBe('hello world');
  expect(element.querySelector('strong')?.textContent).toBe('hello');
  expect(errors).toEqual([]);
 } finally { unregister(); editor.setRootElement(null); element.remove(); }
});
it('does not resurrect original source when all code text is deleted', () => {
 const editor = createZettelEditor();
 loadDocument(editor, { _type: 'zettel_doc', blocks: [{ _type: 'zettel_code', _key: 'code', code: 'old code' }] });
 editor.update(() => { ($getRoot().getFirstChildOrThrow() as any).clear(); }, { discrete: true });
 expect((exportDocument(editor).blocks[0] as any).code).toBe('');
});

it('undoes the first edit after load and never restores a previous document', () => {
 const editor = setup(true);
 editor.update(() => { const text = ($getRoot().getFirstChildOrThrow() as any).getFirstChild() as TextNode; text.select(0, 5); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'bye'); }, { discrete: true });
 editor.update(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); }, { discrete: true });
 expect((exportDocument(editor).blocks[0] as any).children.map((n: any) => n.text).join('')).toBe('hello world');
 editor.update(() => { editor.dispatchCommand(REDO_COMMAND, undefined); }, { discrete: true });
 expect((exportDocument(editor).blocks[0] as any).children.map((n: any) => n.text).join('')).toBe('bye world');
 loadDocument(editor, { _type: 'zettel_doc', blocks: [{ _type: 'zettel_block', _key: 'new', style: 'normal', markDefs: [], children: [] }] });
 editor.update(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); }, { discrete: true });
 expect(exportDocument(editor).blocks[0]._key).toBe('new');
});

it('inserts spell-check replacements and drops, whose text is in dataTransfer', () => {
 const editor = setup(true);
 editor.update(() => { (($getRoot().getFirstChildOrThrow() as any).getFirstChild() as TextNode).select(6, 11); }, { discrete: true });
 const replacement = { inputType: 'insertReplacementText', data: null, dataTransfer: { getData: (type: string) => type === 'text/plain' ? 'there' : '' } } as unknown as InputEvent;
 let handled = false;
 editor.update(() => { handled = editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, replacement); }, { discrete: true });
 expect(handled).toBe(true);
 expect((exportDocument(editor).blocks[0] as any).children.map((n: any) => n.text).join('')).toBe('hello there');
});
it('removes the dragged selection (deleteByDrag)', () => {
 const editor = setup(true);
 editor.update(() => { (($getRoot().getFirstChildOrThrow() as any).getFirstChild() as TextNode).select(5, 11); }, { discrete: true });
 let handled = false;
 editor.update(() => { handled = editor.dispatchCommand(REMOVE_TEXT_COMMAND, null as any); }, { discrete: true });
 expect(handled).toBe(true);
 expect((exportDocument(editor).blocks[0] as any).children.map((n: any) => n.text).join('')).toBe('hello');
});
it('Cmd+U underlines: it round-trips as the underline mark and toggles off', () => {
 const editor = setup();
 editor.update(() => { $getRoot().getFirstChildOrThrow().selectStart(); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'Plain '); }, { discrete: true });
 editor.update(() => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline'); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'text'); }, { discrete: true });
 editor.update(() => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline'); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' more'); }, { discrete: true });
 const spans = () => (exportDocument(editor).blocks[0] as any).children.map((n: any) => [n.text, n.marks]);
 expect(spans()).toEqual([['Plain ', []], ['text', ['underline']], [' more', []]]);
 // It survives export and load.
 const reloaded = setup();
 loadDocument(reloaded, exportDocument(editor));
 expect((exportDocument(reloaded).blocks[0] as any).children.map((n: any) => [n.text, n.marks])).toEqual(spans());
 // Cmd+U again on the underlined text removes the mark (spans keep their
 // own keys, as with bold).
 editor.update(() => { (($getRoot().getFirstChildOrThrow() as any).getChildAtIndex(1) as TextNode).select(0, 4); editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline'); }, { discrete: true });
 expect(spans().map(([, marks]: any) => marks)).toEqual([[], [], []]);
 expect(spans().map(([text]: any) => text).join('')).toBe('Plain text more');
});
it('ignores formats Zettel cannot store (highlight, subscript) instead of splitting spans', () => {
 const editor = setup();
 editor.update(() => { $getRoot().getFirstChildOrThrow().selectStart(); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'abc'); }, { discrete: true });
 editor.update(() => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'highlight'); editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'subscript'); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'def'); }, { discrete: true });
 expect((exportDocument(editor).blocks[0] as any).children.map((n: any) => [n.text, n.marks])).toEqual([['abcdef', []]]);
});
it('toggles a format on a range by what every selected character has, however the range was selected', () => {
 // Lexical 0.47+ toggles by selection.format, which only a DOM selection
 // change derives; a range selected in code must behave the same.
 const editor = setup();
 editor.update(() => { $getRoot().getFirstChildOrThrow().selectStart(); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'hello world'); }, { discrete: true });
 const marks = () => (exportDocument(editor).blocks[0] as any).children.map((n: any) => [n.text, n.marks]);
 const select = (from: number, to: number) => editor.update(() => { (($getRoot().getFirstChildOrThrow() as any).getFirstChild() as TextNode).select(from, to); }, { discrete: true });
 select(0, 5);
 editor.update(() => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'); }, { discrete: true });
 expect(marks()).toEqual([['hello', ['strong']], [' world', []]]);
 // Partly bold: bold everything.
 editor.update(() => { const block = $getRoot().getFirstChildOrThrow() as any; block.getFirstChild().select(0, 0); const s = $getSelection(); if ($isRangeSelection(s)) s.focus.set(block.getLastChild().getKey(), 6, 'text'); }, { discrete: true });
 editor.update(() => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'); }, { discrete: true });
 expect(marks()).toEqual([['hello', ['strong']], [' world', ['strong']]]);
 // All bold: unbold.
 editor.update(() => { const block = $getRoot().getFirstChildOrThrow() as any; block.getFirstChild().select(0, 0); const s = $getSelection(); if ($isRangeSelection(s)) s.focus.set(block.getLastChild().getKey(), 6, 'text'); }, { discrete: true });
 editor.update(() => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'); }, { discrete: true });
 expect(marks()).toEqual([['hello', []], [' world', []]]);
});
