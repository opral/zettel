// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { $getRoot, KEY_BACKSPACE_COMMAND, KEY_ENTER_COMMAND, SELECT_ALL_COMMAND, type LexicalEditor } from 'lexical';
import { createZettelEditor, registerZettelLexicalPlugin, loadDocument, exportDocument } from './index.js';

// A list in a comment box arrives by paste; the writer then has to be able to
// continue after it and to get rid of it with the keyboard.
const item = (key: string, text: string) => ({ _type: 'zettel_list_item', _key: key, spread: false, blocks: [{ _type: 'zettel_block', _key: `${key}-b`, style: 'normal', markDefs: [], children: [{ _type: 'zettel_span', _key: `${key}-s`, text, marks: [] }] }] });
function setup(): LexicalEditor {
 const editor = createZettelEditor({ onError: error => { throw error; } });
 const element = document.createElement("div");
 document.body.append(element);
 editor.setRootElement(element);
 registerZettelLexicalPlugin(editor);
 loadDocument(editor, { _type: 'zettel_doc', blocks: [{ _type: 'zettel_list', _key: 'list', kind: 'bullet', spread: false, items: [item('a', 'one'), item('b', 'two')] }] } as any);
 return editor;
}
const key = (name: string) => new KeyboardEvent('keydown', { key: name });
const caretInItem = (editor: LexicalEditor, index: number, offset: number) => editor.update(() => {
 (($getRoot().getFirstChildOrThrow() as any).getChildAtIndex(index).getFirstChild().getFirstChild()).select(offset, offset);
}, { discrete: true });
const press = (editor: LexicalEditor, name: 'Enter' | 'Backspace') => editor.update(() => {
 editor.dispatchCommand(name === 'Enter' ? KEY_ENTER_COMMAND : KEY_BACKSPACE_COMMAND, key(name));
}, { discrete: true });
const items = (editor: LexicalEditor) => (exportDocument(editor).blocks[0] as any).items as any[];

it('Backspace at the start of a list item joins it to the previous item without leaving an empty item', () => {
 const editor = setup();
 caretInItem(editor, 1, 0);
 press(editor, 'Backspace');
 expect(items(editor).every(listItem => listItem.blocks.length > 0)).toBe(true);
 expect(items(editor)).toHaveLength(1);
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
