import { describe, expect, it } from "vitest";
import { $getRoot, $getSelection, $isRangeSelection, CONTROLLED_TEXT_INSERTION_COMMAND, KEY_ENTER_COMMAND } from "lexical";
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

const span = (_key: string, text: string, marks: string[] = []) => ({ _type: "zettel_span" as const, _key, text, marks });
const paragraph = (_key: string, children: ReturnType<typeof span>[]) => ({ _type: "zettel_block" as const, _key, style: "normal" as const, children, markDefs: [] });

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
      _type: "zettel_list", _key: "list", kind: "bullet", spread: false,
      items: [{ _type: "zettel_list_item", _key: "item", spread: false, blocks: [paragraph("p", [span("s", "one two")])] }],
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
    expect((exportDocument(second).blocks[0] as any).children.map((child: any) => child._type)).toEqual(["zettel_span", "zettel_break", "zettel_span"]);
  });

  it("keeps text typed after a trailing Shift+Return break", async () => {
    const editor = setup(createDocument([paragraph("p", [span("s", "one")])]));
    selectAt(editor, "one", 3);
    const shift = { shiftKey: true, preventDefault() {} } as KeyboardEvent;
    editor.dispatchCommand(KEY_ENTER_COMMAND, shift);
    editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "two");
    editor.dispatchCommand(KEY_ENTER_COMMAND, shift);
    editor.dispatchCommand(KEY_ENTER_COMMAND, shift);
    editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "four");
    await tick();
    const blocks = exportDocument(editor).blocks as any[];
    expect(blocks.map((block) => block.children.map((child: any) => child.text ?? child._type))).toEqual([
      ["one", "zettel_break", "two", "zettel_break", "zettel_break", "four"],
    ]);
  });

  it("keeps Enter in code as a code newline", async () => {
    const editor = setup(createDocument([{ _type: "zettel_code", _key: "code", code: "one two" }]));
    selectAt(editor, "one two", 3);
    editor.dispatchCommand(KEY_ENTER_COMMAND, { shiftKey: false, preventDefault() {} } as KeyboardEvent);
    await tick();
    expect((exportDocument(editor).blocks[0] as any).code).toBe("one\n two");
  });

  it("retains every block when a rich paste starts at a text caret", async () => {
    const editor = setup(createDocument([paragraph("target", [span("target-span", "Before after")])]));
    selectAt(editor, "Before after", 7);
    const pasted = { _type: "zettel_doc", blocks: [paragraph("first", [span("first-span", "one")]), paragraph("second", [span("second-span", "two")])] };
    expect(pasteClipboardData(editor, { "text/zettel": JSON.stringify(pasted) }).handled).toBe(true);
    await tick();
    expect(exportDocument(editor).blocks.map((block: any) => block.children?.map((child: any) => child.text).join("") ?? "")).toEqual(["Before one", "two", "after"]);
  });

  it("clones annotation definitions when rich paste splits a linked target", async () => {
    const editor = setup(createDocument([{ _type: "zettel_block", _key: "target", style: "normal", markDefs: [{ _type: "zettel_link", _key: "target-link", href: "https://target.example" }], children: [span("target-span", "Before after", ["target-link"]) ] }]));
    selectAt(editor, "Before after", 7);
    const pasted = {
      _type: "zettel_doc",
      blocks: [{ _type: "zettel_block", _key: "first", style: "normal", markDefs: [{ _type: "zettel_link", _key: "paste-link", href: "https://paste.example" }], children: [span("first-span", "one", ["paste-link"]) ] }, paragraph("second", [span("second-span", "two")])],
    } as Document;
    expect(pasteClipboardData(editor, { "text/zettel": JSON.stringify(pasted) }).handled).toBe(true);
    await tick();
    const result = exportDocument(editor);
    const keys = result.blocks.flatMap((block: any) => block.markDefs?.map((definition: any) => definition._key) ?? []);
    expect(new Set(keys).size).toBe(keys.length);
    const merged = result.blocks[0] as any;
    const pastedSpan = merged.children.find((child: any) => child.text === "one");
    expect(pastedSpan.marks).toHaveLength(1);
    expect(merged.markDefs.find((definition: any) => definition._key === pastedSpan.marks[0]).href).toBe("https://paste.example");
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
      _type: "zettel_table", _key: "table", align: ["left"], rows: [{
        _type: "zettel_table_row", _key: "row", cells: [{
          _type: "zettel_table_cell", _key: "cell", markDefs: [], children: [span("cell-span", "table")],
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

  it("rejects an unknown document root before it can be rewritten on export", () => {
    const editor = setup(createDocument([paragraph("p", [span("s", "keep")])]));
    const unknown = { _type: "future_doc", blocks: [paragraph("future", [span("future-span", "future")])] } as unknown as Document;
    expect(() => loadDocument(editor, unknown)).toThrow(/Unsupported Zettel document type|Invalid Zettel document/);
    expect((exportDocument(editor).blocks[0] as any)._key).toBe("p");
  });
});
