// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, REMOVE_TEXT_COMMAND, UNDO_COMMAND, type LexicalEditor, type TextNode } from 'lexical';
import { assertDocument } from '@opral/zettel-ast';
import { createZettelEditor, registerZettelLexicalPlugin, loadDocument, exportDocument, toLexicalState, ZettelSpanNode, ZettelTextBlockNode } from './index.js';

// Links live in the markDefs of the block that holds them. Joining two blocks
// moves the spans of one into the other; their links have to move with them.
type Piece = string | [text: string, linkKey: string];
const link = (key: string, href: string) => ({ _type: 'zettel_link', _key: key, href });
const block = (key: string, pieces: Piece[], markDefs: unknown[] = []) => ({
 _type: 'zettel_block', _key: key, style: 'normal', markDefs,
 children: pieces.map((piece, index) => typeof piece === 'string'
  ? { _type: 'zettel_span', _key: `${key}-${index}`, text: piece, marks: [] }
  : { _type: 'zettel_span', _key: `${key}-${index}`, text: piece[0], marks: [piece[1]] }),
});
const listOf = (key: string, blocks: unknown[]) => ({ _type: 'zettel_list', _key: key, kind: 'bullet', spread: false, items: blocks.map((listBlock, index) => ({ _type: 'zettel_list_item', _key: `${key}-${index}`, spread: false, blocks: [listBlock] })) });
const quoteOf = (key: string, blocks: unknown[]) => ({ _type: 'zettel_quote', _key: key, blocks });

function setup(blocks: unknown[]): LexicalEditor {
 const editor = createZettelEditor({ onError: error => { throw error; } });
 const element = document.createElement('div');
 document.body.append(element);
 editor.setRootElement(element);
 registerZettelLexicalPlugin(editor);
 loadDocument(editor, { _type: 'zettel_doc', blocks } as any);
 return editor;
}
const textNode = (text: string) => $getRoot().getAllTextNodes().find(node => node.getTextContent() === text) as TextNode;
const caretAt = (editor: LexicalEditor, text: string, offset: number) => editor.update(() => { textNode(text).select(offset, offset); }, { discrete: true });
const press = (editor: LexicalEditor, name: 'Backspace' | 'Delete') => editor.update(() => {
 editor.dispatchCommand(name === 'Backspace' ? KEY_BACKSPACE_COMMAND : KEY_DELETE_COMMAND, new KeyboardEvent('keydown', { key: name }));
}, { discrete: true });

const textBlocks = (blocks: any[]): any[] => blocks.flatMap(child => child._type === 'zettel_block' ? [child]
 : child._type === 'zettel_list' ? child.items.flatMap((item: any) => textBlocks(item.blocks))
 : child._type === 'zettel_quote' ? textBlocks(child.blocks) : []);
/** Every text block as its text plus [text, href] for each linked span; throws if a mark cannot be resolved. */
function exported(editor: LexicalEditor) {
 const document = exportDocument(editor);
 assertDocument(document);
 // Export and load again: the links must survive a round trip.
 const reloaded = setup([]);
 loadDocument(reloaded, document);
 expect(exportDocument(reloaded)).toEqual(document);
 return textBlocks(document.blocks).map(textBlock => {
  const keys = textBlock.markDefs.map((definition: any) => definition._key);
  expect(new Set(keys).size).toBe(keys.length);
  return {
   text: textBlock.children.map((child: any) => child.text ?? '\n').join(''),
   links: textBlock.children.flatMap((child: any) => (child.marks ?? []).flatMap((mark: string) => {
    const definition = textBlock.markDefs.find((candidate: any) => candidate._key === mark);
    return definition ? [[child.text, definition.href]] : [];
   })),
  };
 });
}
/** The href each linked DOM span renders, so the view agrees with the document. */
const renderedLinks = (editor: LexicalEditor) => [...editor.getRootElement()!.querySelectorAll('a')].map(anchor => [anchor.textContent, anchor.getAttribute('href')]);

it('Backspace at the start of a block keeps the links of the block it joins', () => {
 const editor = setup([block('a', ['First. ']), block('b', ['See ', ['the docs', 'l1'], ' now.'], [link('l1', 'https://example.com/docs')])]);
 caretAt(editor, 'See ', 0);
 press(editor, 'Backspace');
 expect(exported(editor)).toEqual([{ text: 'First. See the docs now.', links: [['the docs', 'https://example.com/docs']] }]);
 expect(renderedLinks(editor)).toEqual([['the docs', 'https://example.com/docs']]);
});

it('keeps the links of a joined block in an editor restored from Lexical JSON', () => {
 // Nodes parsed from serialized state only know the key of their definition.
 const editor = setup([]);
 editor.setEditorState(editor.parseEditorState(toLexicalState({ _type: 'zettel_doc', blocks: [block('a', ['First. ']), block('b', [['the docs', 'l1'], ' now.'], [link('l1', 'https://example.com/docs')])] } as any)));
 caretAt(editor, 'the docs', 0);
 press(editor, 'Backspace');
 expect(exported(editor)).toEqual([{ text: 'First. the docs now.', links: [['the docs', 'https://example.com/docs']] }]);
});

it('undo after a join restores both blocks with their links', () => {
 const original = [block('a', ['First. ']), block('b', ['See ', ['the docs', 'l1']], [link('l1', 'https://example.com/docs')])];
 const editor = setup(original);
 caretAt(editor, 'See ', 0);
 press(editor, 'Backspace');
 editor.update(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); }, { discrete: true });
 expect(exported(editor)).toEqual([{ text: 'First. ', links: [] }, { text: 'See the docs', links: [['the docs', 'https://example.com/docs']] }]);
});

it('keeps the link of a linked image in a joined block', () => {
 const editor = setup([
  block('a', ['Logo: ']),
  { _type: 'zettel_block', _key: 'b', style: 'normal', markDefs: [link('l', 'https://example.com')], children: [{ _type: 'zettel_image', _key: 'img', src: 'https://example.com/logo.png', alt: 'logo', marks: ['l'] }, { _type: 'zettel_span', _key: 'b-s', text: ' end', marks: [] }] },
 ]);
 caretAt(editor, 'Logo: ', 6);
 press(editor, 'Delete');
 const [joined] = exportDocument(editor).blocks as any[];
 assertDocument(exportDocument(editor));
 const image = joined.children.find((child: any) => child._type === 'zettel_image');
 expect(image && joined.markDefs.find((definition: any) => definition._key === image.marks[0])?.href).toBe('https://example.com');
});

it('Delete at the end of a block keeps the links of the block it joins', () => {
 const editor = setup([block('a', ['First. ']), block('b', [['the docs', 'l1'], ' now.'], [link('l1', 'https://example.com/docs')])]);
 caretAt(editor, 'First. ', 7);
 press(editor, 'Delete');
 expect(exported(editor)).toEqual([{ text: 'First. the docs now.', links: [['the docs', 'https://example.com/docs']] }]);
});

it('joins two blocks that both have links to different pages', () => {
 const editor = setup([
  block('a', [['one', 'k1'], ' and '], [link('k1', 'https://example.com/one')]),
  block('b', [['two', 'k2'], '.'], [link('k2', 'https://example.com/two')]),
 ]);
 caretAt(editor, 'two', 0);
 press(editor, 'Backspace');
 expect(exported(editor)).toEqual([{ text: 'one and two.', links: [['one', 'https://example.com/one'], ['two', 'https://example.com/two']] }]);
 expect(renderedLinks(editor)).toEqual([['one', 'https://example.com/one'], ['two', 'https://example.com/two']]);
});

it('reuses the definition when both blocks link to the same page', () => {
 const editor = setup([
  block('a', [['one', 'x'], ' and '], [link('x', 'https://example.com')]),
  block('b', [['two', 'y']], [link('y', 'https://example.com')]),
 ]);
 caretAt(editor, ' and ', 5);
 press(editor, 'Delete');
 expect(exported(editor)).toEqual([{ text: 'one and two', links: [['one', 'https://example.com'], ['two', 'https://example.com']] }]);
 const joined = exportDocument(editor).blocks[0] as any;
 expect(joined.markDefs.filter((definition: any) => definition.href === 'https://example.com')).toHaveLength(1);
});

it('keeps a link that meets another link at the join', () => {
 // The text before the caret ends in a link and the joined block starts with one.
 const editor = setup([
  block('a', ['Read ', ['part one', 'p1']], [link('p1', 'https://example.com/1')]),
  block('b', [['part two', 'p2'], ' too'], [link('p2', 'https://example.com/2')]),
 ]);
 caretAt(editor, 'part two', 0);
 press(editor, 'Backspace');
 expect(exported(editor)).toEqual([{ text: 'Read part onepart two too', links: [['part one', 'https://example.com/1'], ['part two', 'https://example.com/2']] }]);
});

it('keeps links when a paragraph joins into a list item and a list item into a paragraph', () => {
 const editor = setup([
  listOf('list', [block('i', [['item link', 'a']], [link('a', 'https://example.com/item')])]),
  block('p', [['para link', 'b']], [link('b', 'https://example.com/para')]),
 ]);
 // Paragraph after the list joins into the last item's block.
 caretAt(editor, 'item link', 9);
 press(editor, 'Delete');
 expect(exported(editor)).toEqual([{ text: 'item linkpara link', links: [['item link', 'https://example.com/item'], ['para link', 'https://example.com/para']] }]);

 const other = setup([
  block('p', ['Intro ']),
  listOf('list', [block('i', [['item link', 'a']], [link('a', 'https://example.com/item')])]),
 ]);
 caretAt(other, 'Intro ', 6);
 press(other, 'Delete');
 expect(exported(other).flatMap(textBlock => textBlock.links)).toEqual([['item link', 'https://example.com/item']]);
 expect(exported(other).map(textBlock => textBlock.text).join('|')).toContain('Intro item link');
});

it('keeps links when blocks join across a quote boundary', () => {
 const editor = setup([
  quoteOf('q', [block('qa', [['quoted', 'a']], [link('a', 'https://example.com/q')])]),
  block('p', [['after', 'b']], [link('b', 'https://example.com/p')]),
 ]);
 caretAt(editor, 'quoted', 6);
 press(editor, 'Delete');
 expect(exported(editor).flatMap(textBlock => textBlock.links)).toEqual([['quoted', 'https://example.com/q'], ['after', 'https://example.com/p']]);
 expect(exported(editor).map(textBlock => textBlock.text)).toContain('quotedafter');
});

it('keeps the rest of a link when a range deletion runs from one block into it', () => {
 const editor = setup([
  block('a', ['Keep this. Drop']),
  block('b', ['drop ', ['linked words', 'l']], [link('l', 'https://example.com/l')]),
 ]);
 editor.update(() => {
  textNode('Keep this. Drop').select(10, 10);
  const range = $getSelection();
  if (!$isRangeSelection(range)) throw new Error('no range');
  range.focus.set(textNode('linked words').getKey(), 7, 'text');
 }, { discrete: true });
 editor.update(() => { editor.dispatchCommand(REMOVE_TEXT_COMMAND, null as any); }, { discrete: true });
 expect(exported(editor)).toEqual([{ text: 'Keep this.words', links: [['words', 'https://example.com/l']] }]);
});

it('never exports a mark without a definition, even after a raw node move', () => {
 // Whatever moves a span, it must not leave a mark pointing at a definition
 // in another block.
 const editor = setup([
  block('a', ['One ']),
  block('b', [['linked', 'l'], ' ', 'ghost'], [link('l', 'https://example.com')]),
 ]);
 editor.update(() => {
  const [first, second] = $getRoot().getChildren() as ZettelTextBlockNode[];
  // A mark whose definition was never anywhere, and no href to rebuild it from.
  (textNode('ghost') as ZettelSpanNode).setMarks(['missing']);
  for (const child of second.getChildren()) first.append(child);
  second.remove();
 }, { discrete: true });
 expect(exported(editor)).toEqual([{ text: 'One linked ghost', links: [['linked', 'https://example.com']] }]);
 const spans = (exportDocument(editor).blocks[0] as any).children;
 expect(spans.find((span: any) => span.text === 'ghost').marks).toEqual([]);
 editor.getEditorState().read(() => {
  expect(($getRoot().getAllTextNodes() as ZettelSpanNode[]).every(node => node instanceof ZettelSpanNode)).toBe(true);
 });
});
