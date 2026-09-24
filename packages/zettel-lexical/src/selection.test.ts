// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  $getRoot,
  $selectAll,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  CUT_COMMAND,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  REMOVE_TEXT_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from "lexical";
import type { Document, TextBlock } from "@opral/zettel-ast";
import {
  createZettelEditor,
  exportDocument,
  loadDocument,
  registerZettelLexicalPlugin,
  ZettelSpanNode,
  ZettelTextBlockNode,
} from "./index.js";

const span = (_key: string, text: string, marks: string[] = []) => ({ _type: "zettel_span" as const, _key, text, marks });
const block = (_key: string, children: ReturnType<typeof span>[], style: TextBlock["style"] = "normal"): TextBlock => ({ _type: "zettel_block", _key, style, markDefs: [], children });

function setup(document: Document): { editor: LexicalEditor; errors: Error[] } {
  const errors: Error[] = [];
  const editor = createZettelEditor({ onError: (error) => errors.push(error) });
  registerZettelLexicalPlugin(editor);
  loadDocument(editor, document);
  return { editor, errors };
}

const texts = (editor: LexicalEditor) =>
  exportDocument(editor).blocks.map((b) => (b as TextBlock).children.map((c) => ("text" in c ? c.text : c._type)).join(""));

const clipboard = (data: Record<string, string>) => ({
  clipboardData: { types: Object.keys(data), getData: (type: string) => data[type] ?? "", setData() {} },
  preventDefault() {},
});

describe("deleting a range that crosses blocks", () => {
  // Lexical (<= 0.51) throws "$getTextNodeOffset: invalid offset 3 for size 1"
  // for a range from the start of a block into a text run of a later block
  // that has further runs, so the key press did nothing.
  const document = (): Document => ({
    _type: "zettel_doc",
    blocks: [
      block("a", [span("a1", "one", ["strong"]), span("a2", "two")]),
      block("b", [span("b1", "four", ["em"]), span("b2", "five"), span("b3", "six")]),
    ],
  });
  const cases: Array<[string, LexicalCommand<any>, () => unknown, string[]]> = [
    ["Backspace", KEY_BACKSPACE_COMMAND, () => null, ["rfivesix"]],
    ["Delete", KEY_DELETE_COMMAND, () => null, ["rfivesix"]],
    ["deleteContentBackward", DELETE_CHARACTER_COMMAND, () => true, ["rfivesix"]],
    ["Alt+Backspace", DELETE_WORD_COMMAND, () => true, ["rfivesix"]],
    ["Cmd+Backspace", DELETE_LINE_COMMAND, () => true, ["rfivesix"]],
    ["typing", CONTROLLED_TEXT_INSERTION_COMMAND, () => "X", ["Xrfivesix"]],
    ["Enter", KEY_ENTER_COMMAND, () => null, ["", "rfivesix"]],
    ["paste", PASTE_COMMAND, () => clipboard({ "text/plain": "P" }), ["Prfivesix"]],
    ["cut", CUT_COMMAND, () => clipboard({}), ["rfivesix"]],
    ["drag move (deleteByDrag)", REMOVE_TEXT_COMMAND, () => null, ["rfivesix"]],
  ];
  for (const backward of [false, true]) {
    for (const [name, command, payload, expected] of cases) {
      it(`${name}${backward ? " (backward selection)" : ""}`, () => {
        const { editor, errors } = setup(document());
        editor.update(() => {
          const [first, second] = $getRoot().getChildren() as ZettelTextBlockNode[];
          const start = first!.getFirstChild() as ZettelSpanNode;
          // Inside the first of three text runs of the second block.
          const end = second!.getFirstChild() as ZettelSpanNode;
          const selection = start.select(0, 0);
          if (backward) {
            selection.anchor.set(end.getKey(), 3, "text");
            selection.focus.set(start.getKey(), 0, "text");
          } else selection.focus.set(end.getKey(), 3, "text");
        }, { discrete: true });
        let handled: boolean | undefined;
        editor.update(() => { handled = editor.dispatchCommand(command, payload()); }, { discrete: true });
        expect(errors).toEqual([]);
        expect(handled).toBe(true);
        expect(texts(editor)).toEqual(expected);
      });
    }
  }

  it("keeps the caret where the range was, so typing continues there", () => {
    const { editor, errors } = setup(document());
    editor.update(() => {
      const [first, second] = $getRoot().getChildren() as ZettelTextBlockNode[];
      (first!.getFirstChild() as ZettelSpanNode).select(0, 0).focus.set(second!.getFirstChild()!.getKey(), 3, "text");
    }, { discrete: true });
    editor.update(() => { editor.dispatchCommand(KEY_BACKSPACE_COMMAND, null as unknown as KeyboardEvent); }, { discrete: true });
    editor.update(() => { editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "Y"); }, { discrete: true });
    expect(errors).toEqual([]);
    expect(texts(editor)).toEqual(["Yrfivesix"]);
  });
});

describe("select-all delete", () => {
  // Since Lexical 0.50 a whole-document delete removes the blocks and leaves a
  // fresh Lexical ParagraphNode; Zettel must turn it into one of its blocks.
  it("leaves one empty Zettel text block that keeps its key and splits on Enter", () => {
    const { editor, errors } = setup({
      _type: "zettel_doc",
      blocks: [block("h", [span("h1", "Heading")], "h1"), block("p", [span("p1", "Body")])],
    });
    editor.update(() => { $selectAll(); }, { discrete: true });
    editor.update(() => { editor.dispatchCommand(KEY_BACKSPACE_COMMAND, null as unknown as KeyboardEvent); }, { discrete: true });
    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(ZettelTextBlockNode);
    });
    editor.update(() => { editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "fresh text"); }, { discrete: true });
    const first = exportDocument(editor);
    expect(exportDocument(editor)).toEqual(first);
    expect((first.blocks[0] as TextBlock).style).toBe("normal");
    expect(texts(editor)).toEqual(["fresh text"]);
    editor.update(() => {
      const text = $getRoot().getFirstDescendant() as ZettelSpanNode;
      text.select(6, 6);
      editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    }, { discrete: true });
    expect(texts(editor)).toEqual(["fresh ", "text"]);
    expect(errors).toEqual([]);
  });
});
