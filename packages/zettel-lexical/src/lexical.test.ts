import { describe, expect, it } from "vitest";
import { createEditor, $getRoot, CONTROLLED_TEXT_INSERTION_COMMAND } from "lexical";
import {
  ZettelNodes,
  createZettelEditor,
  exportDocument,
  fromLexicalState,
  loadDocument,
  registerZettelLexicalPlugin,
  setZettelListItemChecked,
  toLexicalState,
  type Document,
} from "./index.js";

const link = { _type: "zettel_link" as const, _key: "link-1", href: "https://example.com", title: "Example" };

function fixture(): Document {
  return {
    _type: "zettel_doc",
    blocks: [
      {
        _type: "zettel_block",
        _key: "text-1",
        style: "normal",
        markDefs: [link],
        children: [
          { _type: "zettel_span", _key: "span-1", text: "Hello ", marks: [] },
          { _type: "zettel_span", _key: "span-2", text: "world", marks: ["strong", "link-1"] },
          { _type: "zettel_break", _key: "break-1", marks: ["em"] },
          { _type: "zettel_image", _key: "image-1", src: "https://example.com/a.png", alt: "A", marks: [] },
        ],
      },
      {
        _type: "zettel_list",
        _key: "list-1",
        kind: "number",
        start: 3,
        spread: false,
        items: [{
          _type: "zettel_list_item",
          _key: "item-1",
          spread: false,
          checked: true,
          blocks: [{ _type: "zettel_block", _key: "item-text", style: "normal", markDefs: [], children: [{ _type: "zettel_span", _key: "item-span", text: "Task", marks: [] }] }],
        }],
      },
      { _type: "zettel_code", _key: "code-1", code: "const x = 1;", language: "js" },
      {
        _type: "zettel_table",
        _key: "table-1",
        align: ["left", "right"],
        rows: [{
          _type: "zettel_table_row",
          _key: "row-1",
          cells: [
            { _type: "zettel_table_cell", _key: "cell-1", markDefs: [], children: [{ _type: "zettel_span", _key: "cell-span", text: "A", marks: [] }] },
            { _type: "zettel_table_cell", _key: "cell-2", markDefs: [], children: [{ _type: "zettel_span", _key: "cell-span-2", text: "B", marks: [] }] },
          ],
        }],
      },
      { _type: "zettel_html", _key: "html-1", value: "<script>should stay source</script>" },
    ],
  };
}

describe("Zettel Lexical state", () => {
  it("handles controlled insertion into an empty paragraph", () => {
    const editor = createZettelEditor();
    registerZettelLexicalPlugin(editor);
    loadDocument(editor, { _type: "zettel_doc", blocks: [{ _type: "zettel_block", _key: "empty", style: "normal", markDefs: [], children: [] }] });
    editor.update(() => {
      $getRoot().getFirstChildOrThrow().selectStart();
      expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "Hello 👋")).toBe(true);
    }, { discrete: true });
    const block = exportDocument(editor).blocks[0] as any;
    expect(block._key).toBe("empty");
    expect(block.children[0].text).toBe("Hello 👋");
  });

  it("round trips every core node while retaining keys and shared mark definitions", () => {
    const document = fixture();
    const editor = createZettelEditor();
    loadDocument(editor, document);
    const exported = exportDocument(editor);
    expect(exported).toEqual(document);
    expect((exported.blocks[0] as any).markDefs).toBe((document.blocks[0] as any).markDefs);
    expect((exported.blocks[0] as any).children[1]._key).toBe("span-2");
  });

  it("uses real editable TextNodes and exports meaningful text edits", () => {
    const editor = createEditor({ nodes: [...ZettelNodes] });
    registerZettelLexicalPlugin(editor);
    const document = fixture();
    loadDocument(editor, document);
    editor.update(() => {
      $getRoot().getAllTextNodes()[0]!.setTextContent("Edited ");
    }, { discrete: true });
    expect((exportDocument(editor).blocks[0] as any).children[0].text).toBe("Edited ");
  });

  it("serializes nested nodes through the public Lexical state envelope", () => {
    const document = fixture();
    const state = toLexicalState(document);
    expect(fromLexicalState(state)).toEqual(document);
  });

  it("updates checklist state through a stable Zettel key", () => {
    const editor = createZettelEditor();
    loadDocument(editor, fixture());
    expect(setZettelListItemChecked(editor, "item-1", false)).toBe(true);
    expect((exportDocument(editor).blocks[1] as any).items[0].checked).toBe(false);
  });
});
