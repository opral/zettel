// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, CONTROLLED_TEXT_INSERTION_COMMAND, KEY_DOWN_COMMAND, KEY_ENTER_COMMAND, PASTE_COMMAND, UNDO_COMMAND, type LexicalEditor } from 'lexical';
import { createZettelEditor, registerZettelLexicalPlugin, loadDocument, exportDocument, type ZettelLexicalPluginOptions } from './index.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
// Not mounted: jsdom's selectionchange timestamps cannot match Lexical's, so a
// mounted editor would reset the caret format from the DOM. The Chromium
// playground covers the mounted editor.
function setup(text = '', options: ZettelLexicalPluginOptions = { markdownShortcuts: true }): LexicalEditor {
 const editor = createZettelEditor({ onError: error => { throw error; } });
 const unregister = registerZettelLexicalPlugin(editor, options);
 cleanups.push(unregister);
 loadDocument(editor, { _type: 'zettel_doc', blocks: [{ _type: 'zettel_block', _key: 'p', style: 'normal', markDefs: [], children: text ? [{ _type: 'zettel_span', _key: 's', text, marks: [] }] : [] }] });
 editor.update(() => { $getRoot().getFirstChildOrThrow().selectEnd(); }, { discrete: true });
 return editor;
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function type(editor: LexicalEditor, text: string) {
 for (const character of text) {
  editor.update(() => { editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, character); }, { discrete: true });
  await flush();
 }
}
async function enter(editor: LexicalEditor) {
 editor.update(() => { editor.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent('keydown', { key: 'Enter' })); }, { discrete: true });
 await flush();
}
async function undo(editor: LexicalEditor) {
 editor.update(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); }, { discrete: true });
 await flush();
}
async function paste(editor: LexicalEditor, text: string) {
 const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
 Object.defineProperty(event, 'clipboardData', { value: { types: ['text/plain'], getData: (type: string) => type === 'text/plain' ? text : '' } });
 editor.update(() => { editor.dispatchCommand(PASTE_COMMAND, event); }, { discrete: true });
 await flush();
}
// Text blocks as [text, marks] pairs; links show as `link:<href>`.
const spans = (block: any) => block.children.map((child: any) => [child.text, child.marks.map((mark: string) => block.markDefs.find((definition: any) => definition._key === mark) ? `link:${block.markDefs.find((definition: any) => definition._key === mark).href}` : mark)]);
const first = (editor: LexicalEditor) => exportDocument(editor).blocks[0] as any;
const plain = (block: any) => block.children.map((child: any) => child.text).join('');

it('turns **x**, __x__, *x*, _x_, `x` and ~~x~~ into marks when the closing marker is typed', async () => {
 for (const [source, mark] of [['**bold**', 'strong'], ['__bold__', 'strong'], ['*it*', 'em'], ['_it_', 'em'], ['`code`', 'code'], ['~~gone~~', 'strike-through']] as const) {
  const editor = setup('say ');
  await type(editor, source);
  const text = source.replace(/[*_`~]/g, '');
  expect(spans(first(editor)), source).toEqual([['say ', []], [text, [mark]]]);
  // Typing continues without the new mark.
  await type(editor, ' next');
  expect(spans(first(editor)).at(-1), source).toEqual([' next', []]);
  exportDocument(editor);
 }
});

it('leaves unmatched and intra-word markers as typed', async () => {
 const editor = setup();
 await type(editor, 'a * b * c snake_case_name 2*3*4 ** x** ');
 expect(spans(first(editor))).toEqual([['a * b * c snake_case_name 2*3*4 ** x** ', []]]);
});

it('does not apply inline shortcuts inside inline code', async () => {
 const editor = setup();
 await type(editor, '`a  c`');
 expect(spans(first(editor))).toEqual([['a  c', ['code']]]);
 // Put the caret inside the code text, with the code format a click would give it.
 editor.update(() => { const code = $getRoot().getAllTextNodes()[0]!; code.select(2, 2).format = code.getFormat(); }, { discrete: true });
 await type(editor, '*b*');
 expect(spans(first(editor))).toEqual([['a *b* c', ['code']]]);
});

it('undo reverts a conversion in one step and keeps the typed Markdown', async () => {
 const editor = setup();
 await type(editor, '**bold**');
 expect(spans(first(editor))).toEqual([['bold', ['strong']]]);
 await undo(editor);
 expect(spans(first(editor))).toEqual([['**bold**', []]]);
 const list = setup();
 await type(list, '- ');
 expect(exportDocument(list).blocks[0]._type).toBe('zettel_list');
 await undo(list);
 expect(exportDocument(list).blocks.map(block => block._type)).toEqual(['zettel_block']);
 expect(plain(first(list))).toBe('- ');
});

it('turns "- ", "* ", "1. " and "> " at the start of a paragraph into lists and quotes', async () => {
 for (const [marker, expected] of [['- ', { _type: 'zettel_list', kind: 'bullet' }], ['* ', { _type: 'zettel_list', kind: 'bullet' }], ['1. ', { _type: 'zettel_list', kind: 'number', start: 1 }], ['3) ', { _type: 'zettel_list', kind: 'number', start: 3 }], ['> ', { _type: 'zettel_quote' }]] as const) {
  const editor = setup();
  await type(editor, `${marker}item`);
  const [block] = exportDocument(editor).blocks as any[];
  expect(block, marker).toMatchObject(expected);
  const inner = block._type === 'zettel_list' ? block.items[0].blocks[0] : block.blocks[0];
  expect(plain(inner), marker).toBe('item');
 }
});

it('continues a list with Enter and joins a new list to the list right before it', async () => {
 const editor = setup();
 await type(editor, '- one');
 await enter(editor);
 await type(editor, 'two');
 expect((exportDocument(editor).blocks[0] as any).items.map((item: any) => plain(item.blocks[0]))).toEqual(['one', 'two']);
 // A paragraph right after the list.
 loadDocument(editor, { _type: 'zettel_doc', blocks: [{ ...(exportDocument(editor).blocks[0] as any) }, { _type: 'zettel_block', _key: 'after', style: 'normal', markDefs: [], children: [] }] } as any);
 editor.update(() => { $getRoot().getLastChildOrThrow().selectStart(); }, { discrete: true });
 await type(editor, '- three');
 const blocks = exportDocument(editor).blocks as any[];
 expect(blocks.map(block => block._type)).toEqual(['zettel_list']);
 expect(blocks[0].items.map((item: any) => plain(item.blocks[0]))).toEqual(['one', 'two', 'three']);
});

it('does not start a list mid-paragraph or in a heading', async () => {
 const editor = setup('text ');
 await type(editor, '- x');
 expect(exportDocument(editor).blocks[0]._type).toBe('zettel_block');
});

it('links a typed bare URL on space and on Enter, without the trailing punctuation', async () => {
 const editor = setup();
 await type(editor, 'see https://example.com/a?b=1. ok');
 expect(spans(first(editor))).toEqual([['see ', []], ['https://example.com/a?b=1', ['link:https://example.com/a?b=1']], ['. ok', []]]);
 await type(editor, ' http://x.test');
 await enter(editor);
 const blocks = exportDocument(editor).blocks as any[];
 expect(spans(blocks[0]).at(-1)).toEqual(['http://x.test', ['link:http://x.test']]);
 expect(blocks).toHaveLength(2);
 // Undo removes the link and keeps the URL text and the new line.
 await undo(editor);
 const undone = exportDocument(editor).blocks as any[];
 expect(undone).toHaveLength(2);
 expect(spans(undone[0]).at(-1)).toEqual(['. ok http://x.test', []]);
});

it('links a pasted bare URL, and pasting a URL over selected text links the text', async () => {
 const editor = setup('go ');
 await paste(editor, 'https://example.com/path');
 expect(spans(first(editor))).toEqual([['go ', []], ['https://example.com/path', ['link:https://example.com/path']]]);
 const selected = setup('read the docs');
 selected.update(() => { const text = $getRoot().getAllTextNodes()[0]!; text.select(9, 13); }, { discrete: true });
 await paste(selected, 'https://docs.test');
 expect(spans(first(selected))).toEqual([['read the ', []], ['docs', ['link:https://docs.test']]]);
});

it('Mod+K asks the application for a link and applies it', async () => {
 const requests: unknown[] = [];
 const editor = setup('read the docs', { onLinkShortcut: (link) => { requests.push(link); return 'https://docs.test'; } });
 editor.update(() => { $getRoot().getAllTextNodes()[0]!.select(9, 13); }, { discrete: true });
 const shortcut = (init: KeyboardEventInit) => { const event = new KeyboardEvent('keydown', { key: 'k', cancelable: true, ...init }); editor.update(() => { editor.dispatchCommand(KEY_DOWN_COMMAND, event); }, { discrete: true }); return event; };
 const event = shortcut(/Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true });
 await flush();
 expect(event.defaultPrevented).toBe(true);
 expect(requests).toEqual([{ text: 'docs' }]);
 expect(spans(first(editor))).toEqual([['read the ', []], ['docs', ['link:https://docs.test']]]);
});

it('is off unless the plugin is registered with markdownShortcuts', async () => {
 const editor = setup('', {});
 await type(editor, '**bold** - x https://example.com ');
 expect(spans(first(editor))).toEqual([['**bold** - x https://example.com ', []]]);
 const selection = editor.getEditorState().read(() => { const current = $getSelection(); return $isRangeSelection(current) ? current.anchor.offset : -1; });
 expect(selection).toBe(33);
});
