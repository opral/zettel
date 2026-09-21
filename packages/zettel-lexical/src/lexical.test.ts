import { describe, expect, it } from "vitest";
import { createEditor } from "lexical";
import {
  SCHEMA_URL,
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

const link = { type: "zettel_link" as const, zettel_key: "link-1", href: "https://example.com", title: "Example" };

function fixture(): Document {
  return {
    $schema: SCHEMA_URL,
    blocks: [
      {
        type: "zettel_text",
        zettel_key: "text-1",
        style: "normal",
        markDefs: [link],
        children: [
          { type: "zettel_span", zettel_key: "span-1", text: "Hello ", marks: [] },
          { type: "zettel_span", zettel_key: "span-2", text: "world", marks: ["strong", "link-1"] },
          { type: "zettel_break", zettel_key: "break-1", marks: ["em"] },
          { type: "zettel_image", zettel_key: "image-1", src: "https://example.com/a.png", alt: "A", marks: [] },
        ],
      },
      {
        type: "zettel_list",
        zettel_key: "list-1",
        kind: "number",
        start: 3,
        spread: false,
        items: [{
          type: "zettel_list_item",
          zettel_key: "item-1",
          spread: false,
          checked: true,
          blocks: [{ type: "zettel_text", zettel_key: "item-text", style: "normal", markDefs: [], children: [{ type: "zettel_span", zettel_key: "item-span", text: "Task", marks: [] }] }],
        }],
      },
      { type: "zettel_code", zettel_key: "code-1", code: "const x = 1;", language: "js" },
      {
        type: "zettel_table",
        zettel_key: "table-1",
        align: ["left", "right"],
        rows: [{
          type: "zettel_table_row",
          zettel_key: "row-1",
          cells: [
            { type: "zettel_table_cell", zettel_key: "cell-1", markDefs: [], children: [{ type: "zettel_span", zettel_key: "cell-span", text: "A", marks: [] }] },
            { type: "zettel_table_cell", zettel_key: "cell-2", markDefs: [], children: [{ type: "zettel_span", zettel_key: "cell-span-2", text: "B", marks: [] }] },
          ],
        }],
      },
      { type: "zettel_html", zettel_key: "html-1", value: "<script>should stay source</script>" },
    ],
  };
}

describe("Zettel Lexical state", () => {
  it("round trips every core node while retaining keys and shared mark definitions", () => {
    const document = fixture();
    const editor = createZettelEditor();
    loadDocument(editor, document);
    const exported = exportDocument(editor);
    expect(exported).toEqual(document);
    expect((exported.blocks[0] as any).markDefs).toBe((document.blocks[0] as any).markDefs);
    expect((exported.blocks[0] as any).children[1].zettel_key).toBe("span-2");
  });

  it("uses real editable TextNodes and exports meaningful text edits", () => {
    const editor = createEditor({ nodes: [...ZettelNodes] });
    registerZettelLexicalPlugin(editor);
    const document = fixture();
    loadDocument(editor, document);
    editor.update(() => {
      const root = editor.getEditorState()._nodeMap.get("root") as any;
      const block = root.getFirstChild();
      const span = block.getFirstChild();
      span.setTextContent("Edited ");
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
