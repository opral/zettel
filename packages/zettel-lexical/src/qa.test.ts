// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { $getRoot, CONTROLLED_TEXT_INSERTION_COMMAND, FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND, TextNode } from 'lexical';
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
