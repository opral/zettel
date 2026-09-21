// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  $getRoot,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  KEY_ENTER_COMMAND,
} from "lexical";
import {
  createZettelEditor,
  exportDocument,
  loadDocument,
  registerZettelLexicalPlugin,
  ZettelCodeNode,
} from "./index.js";

function setup(code: string) {
  const editor = createZettelEditor();
  registerZettelLexicalPlugin(editor);
  loadDocument(editor, {
    _type: "zettel_doc",
    blocks: [{ _type: "zettel_code", _key: "code", code }],
  });
  return editor;
}

function pressEnter(editor: ReturnType<typeof createZettelEditor>): void {
  editor.update(() => {
    $getRoot().getFirstChildOrThrow().selectEnd();
    editor.dispatchCommand(KEY_ENTER_COMMAND, {
      preventDefault() {},
      shiftKey: false,
    } as KeyboardEvent);
  }, { discrete: true });
}

it("keeps code Enter line breaks and preserves insertion before the final break", () => {
  const editor = setup("const x = 1;");

  pressEnter(editor);
  let codeChildren: string[] = [];
  editor.getEditorState().read(() => {
    const code = $getRoot().getFirstChildOrThrow() as ZettelCodeNode;
    codeChildren = code.getChildren().map((child) => child.getType());
  });
  expect(codeChildren).toEqual(["zettel_span", "linebreak"]);
  expect((exportDocument(editor).blocks[0] as { code: string }).code).toBe("const x = 1;\n");

  // Selecting the span end targets the position immediately before LineBreakNode.
  editor.update(() => {
    const code = $getRoot().getFirstChildOrThrow() as ZettelCodeNode;
    code.getFirstChildOrThrow().selectEnd();
    editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X");
  }, { discrete: true });
  expect((exportDocument(editor).blocks[0] as { code: string }).code).toBe("const x = 1;X\n");

  pressEnter(editor);
  expect((exportDocument(editor).blocks[0] as { code: string }).code).toBe("const x = 1;X\n\n");
});
