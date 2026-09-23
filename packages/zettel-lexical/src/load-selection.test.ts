// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { $getRoot, CONTROLLED_TEXT_INSERTION_COMMAND, KEY_ENTER_COMMAND } from 'lexical';
import { createZettelEditor, registerZettelLexicalPlugin, loadDocument, exportDocument, ZettelTextBlockNode } from './index.js';

const empty = (key: string) => ({ _type: 'zettel_doc' as const, blocks: [{ _type: 'zettel_block' as const, _key: key, style: 'normal', markDefs: [], children: [] }] });

// A comment box clears itself after sending by loading an empty document
// while the writer's caret is still in it. The next keystrokes must land in a
// Zettel text block, not in a stray Lexical ParagraphNode next to it.
it('typing after loadDocument replaced the document under the caret stays in a Zettel block', () => {
 const errors: Error[] = [];
 const editor = createZettelEditor({ onError: error => errors.push(error) });
 const element = document.createElement('div');
 document.body.append(element);
 editor.setRootElement(element);
 const unregister = registerZettelLexicalPlugin(editor);
 try {
  loadDocument(editor, empty('first'));
  editor.update(() => { $getRoot().getFirstChildOrThrow().selectStart(); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'sent comment'); }, { discrete: true });
  // "Send": the field is cleared with the caret still inside it.
  loadDocument(editor, empty('second'));
  editor.update(() => { editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'next'); }, { discrete: true });
  const types = editor.getEditorState().read(() => $getRoot().getChildren().map(node => node.getType()));
  expect(types).toEqual([ZettelTextBlockNode.getType()]);
  expect(exportDocument(editor).blocks).toHaveLength(1);
  expect(element.querySelectorAll('p:not(.zettel_block)')).toHaveLength(0);
  // Shift+Enter in that block is a hard break, not a new paragraph.
  editor.update(() => { editor.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true })); editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'line'); }, { discrete: true });
  const blocks = exportDocument(editor).blocks as any[];
  expect(blocks).toHaveLength(1);
  expect(blocks[0].children.map((child: any) => child._type)).toEqual(['zettel_span', 'zettel_break', 'zettel_span']);
  expect(errors).toEqual([]);
 } finally { unregister(); editor.setRootElement(null); element.remove(); }
});
