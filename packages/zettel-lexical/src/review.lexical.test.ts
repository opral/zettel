import { describe, expect, it } from "vitest";
import { $getRoot, $getSelection, $isRangeSelection, KEY_ENTER_COMMAND } from "lexical";
import {
  copyDocumentToClipboard,
  createDocument,
  createZettelEditor,
  exportDocument,
  loadDocument,
  pasteClipboardData,
  registerZettelLexicalPlugin,
  type Document,
} from "./index.js";

const schema = "https://zettel.dev/schema/1/schema.json";
const span = (zettel_key: string, text: string, marks: string[] = []) => ({ type: "zettel_span" as const, zettel_key, text, marks });
const paragraph = (zettel_key: string, children: ReturnType<typeof span>[]) => ({ type: "zettel_text" as const, zettel_key, style: "normal" as const, children, markDefs: [] });

function selectAt(editor: ReturnType<typeof createZettelEditor>, text: string, offset: number): void {
  editor.update(() => {
    const node = $getRoot().getAllTextNodes().find((candidate) => candidate.getTextContent() === text);
    if (!node) throw new Error(`Missing text node ${text}`);
    node.select(offset, offset);
  }, { discrete: true });
}

function setup(document: Document) {
  const editor = createZettelEditor();
  registerZettelLexicalPlugin(editor);
  loadDocument(editor, document);
  return editor;
}

function tick(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 0)); }

describe("Lexical editing and clipboard edge cases", () => {
  it("keeps Return inside list items and Shift+Return as an explicit break", async () => {
    const editor = setup(createDocument([{
      type: "zettel_list", zettel_key: "list", kind: "bullet", spread: false,
      items: [{ type: "zettel_list_item", zettel_key: "item", spread: false, blocks: [paragraph("p", [span("s", "one two")])] }],
    }]));
    selectAt(editor, "one two", 3);
    const event = { shiftKey: false, preventDefault() {} } as KeyboardEvent;
    expect(editor.dispatchCommand(KEY_ENTER_COMMAND, event)).toBe(true);
    await tick();
    const list = exportDocument(editor).blocks[0] as any;
    expect(list.items.map((item: any) => item.blocks.map((block: any) => block.children.map((child: any) => child.text).join("")))).toEqual([["one"], [" two"]]);

    const second = setup(createDocument([paragraph("p", [span("s", "one two")])]));
    selectAt(second, "one two", 3);
    expect(second.dispatchCommand(KEY_ENTER_COMMAND, { shiftKey: true, preventDefault() {} } as KeyboardEvent)).toBe(true);
    await tick();
    expect((exportDocument(second).blocks[0] as any).children.map((child: any) => child.type)).toEqual(["zettel_span", "zettel_break", "zettel_span"]);
  });

  it("keeps Enter in code as a code newline", async () => {
    const editor = setup(createDocument([{ type: "zettel_code", zettel_key: "code", code: "one two" }]));
    selectAt(editor, "one two", 3);
    editor.dispatchCommand(KEY_ENTER_COMMAND, { shiftKey: false, preventDefault() {} } as KeyboardEvent);
    await tick();
    expect((exportDocument(editor).blocks[0] as any).code).toBe("one\n two");
  });

  it("retains every block when a rich paste starts at a text caret", async () => {
    const editor = setup(createDocument([paragraph("target", [span("target-span", "Before after")])]));
    selectAt(editor, "Before after", 7);
    const pasted = { $schema: schema, blocks: [paragraph("first", [span("first-span", "one")]), paragraph("second", [span("second-span", "two")])] };
    expect(pasteClipboardData(editor, { "text/zettel": JSON.stringify(pasted) }).handled).toBe(true);
    await tick();
    expect(exportDocument(editor).blocks.map((block: any) => block.children?.map((child: any) => child.text).join("") ?? "")).toEqual(["Before one", "two", "after"]);
  });

  it("clones annotation definitions when rich paste splits a linked target", async () => {
    const editor = setup(createDocument([{ type: "zettel_text", zettel_key: "target", style: "normal", markDefs: [{ type: "zettel_link", zettel_key: "target-link", href: "https://target.example" }], children: [span("target-span", "Before after", ["target-link"]) ] }]));
    selectAt(editor, "Before after", 7);
    const pasted = {
      $schema: schema,
      blocks: [{ type: "zettel_text", zettel_key: "first", style: "normal", markDefs: [{ type: "zettel_link", zettel_key: "paste-link", href: "https://paste.example" }], children: [span("first-span", "one", ["paste-link"]) ] }, paragraph("second", [span("second-span", "two")])],
    } as Document;
    expect(pasteClipboardData(editor, { "text/zettel": JSON.stringify(pasted) }).handled).toBe(true);
    await tick();
    const result = exportDocument(editor);
    const keys = result.blocks.flatMap((block: any) => block.markDefs?.map((definition: any) => definition.zettel_key) ?? []);
    expect(new Set(keys).size).toBe(keys.length);
    const merged = result.blocks[0] as any;
    const pastedSpan = merged.children.find((child: any) => child.text === "one");
    expect(pastedSpan.marks).toHaveLength(1);
    expect(merged.markDefs.find((definition: any) => definition.zettel_key === pastedSpan.marks[0]).href).toBe("https://paste.example");
    expect((result.blocks[2] as any).markDefs[0].href).toBe("https://target.example");
  });

  it("copies a cross-paragraph selection as separate blocks", async () => {
    const editor = setup(createDocument([paragraph("p1", [span("s1", "first")]), paragraph("p2", [span("s2", "second")])]));
    await tick();
    editor.update(() => {
      const [first, second] = $getRoot().getAllTextNodes();
      first.select(2, 2);
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Missing range selection");
      selection.focus.set(second.getKey(), 3, "text");
    }, { discrete: true });
    const values: Record<string, string> = {};
    copyDocumentToClipboard(editor, { clipboardData: { setData(type: string, value: string) { values[type] = value; } }, preventDefault() {} } as unknown as ClipboardEvent);
    expect(JSON.parse(values["text/zettel"]).blocks).toHaveLength(2);
    expect(values["text/plain"]).toBe("rst\nsec");
  });

  it("copies only the selected table cell fragment", async () => {
    const editor = setup(createDocument([{
      type: "zettel_table", zettel_key: "table", align: ["left"], rows: [{
        type: "zettel_table_row", zettel_key: "row", cells: [{
          type: "zettel_table_cell", zettel_key: "cell", markDefs: [], children: [span("cell-span", "table")],
        }],
      }],
    }]));
    await tick();
    editor.update(() => {
      const [cellSpan] = $getRoot().getAllTextNodes();
      cellSpan.select(1, 1);
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Missing range selection");
      selection.focus.set(cellSpan.getKey(), 4, "text");
    }, { discrete: true });
    const values: Record<string, string> = {};
    copyDocumentToClipboard(editor, { clipboardData: { setData(type: string, value: string) { values[type] = value; } }, preventDefault() {} } as unknown as ClipboardEvent);
    const copied = JSON.parse(values["text/zettel"]);
    expect(copied.blocks[0].rows[0].cells[0].children[0].text).toBe("abl");
    expect(values["text/plain"]).toBe("abl");
  });

  it("rejects an unknown schema before it can be rewritten on export", () => {
    const editor = setup(createDocument([paragraph("p", [span("s", "keep")])]));
    const unknown = { $schema: "https://zettel.dev/schema/99/schema.json", blocks: [paragraph("future", [span("future-span", "future")])] } as unknown as Document;
    expect(() => loadDocument(editor, unknown)).toThrow(/Unsupported Zettel schema|Invalid Zettel document/);
    expect((exportDocument(editor).blocks[0] as any).zettel_key).toBe("p");
  });
});
