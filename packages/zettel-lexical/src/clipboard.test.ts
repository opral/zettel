// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { $getRoot, CONTROLLED_TEXT_INSERTION_COMMAND, type TextNode } from "lexical";
import { copyDocumentToClipboard, createZettelEditor, exportDocument, loadDocument, parseClipboardData, pasteClipboardData, registerZettelLexicalPlugin, type Document } from "./index.js";

const document: Document = {
  _type: "zettel_doc",
  blocks: [{ _type: "zettel_block", _key: "p-1", style: "normal", markDefs: [], children: [{ _type: "zettel_span", _key: "s-1", text: "Copy me", marks: ["strong"] }] }],
};

describe("Zettel clipboard", () => {
  it("writes text/zettel, HTML, and plain text together", () => {
    const editor = createZettelEditor();
    loadDocument(editor, document);
    const values: Record<string, string> = {};
    const event = { clipboardData: { setData(type: string, value: string) { values[type] = value; } }, preventDefault() {} } as unknown as ClipboardEvent;
    expect(copyDocumentToClipboard(editor, event)).toBe(true);
    expect(values["text/plain"]).toBe("Copy me");
    expect(values["text/html"]).toContain("zettel_block");
    expect(JSON.parse(values["text/zettel"]).blocks[0].children[0].text).toBe("Copy me");
  });

  it("imports HTML through zettel-html and drops executable markup", () => {
    const result = parseClipboardData({ "text/html": "<p><strong>Hello</strong><script>window.x=1</script></p>", "text/plain": "Hello" });
    expect(result.handled).toBe(true);
    expect(result.document?.blocks[0]).toMatchObject({ _type: "zettel_block" });
    expect(JSON.stringify(result.document)).not.toContain("window.x");
  });

  it("reports an invalid internal document and falls back explicitly", () => {
    const result = parseClipboardData({ "text/zettel": JSON.stringify({ _type: "future_doc", blocks: [] }), "text/plain": "fallback" });
    expect(result.handled).toBe(true);
    expect(result.diagnostics?.length).toBeGreaterThan(0);
    expect(result.document?.blocks[0]).toMatchObject({ _type: "zettel_block" });
  });

  it("keeps opaque extension content in internal and plain copy when HTML has no handler", () => {
    const editor = createZettelEditor();
    const extension = {
      _type: "zettel_doc",
      blocks: [{ _type: "app_card", _key: "card-1", title: "Keep me" }],
    } as unknown as Document;
    loadDocument(editor, extension);
    const values: Record<string, string> = {};
    const event = { clipboardData: { setData(type: string, value: string) { values[type] = value; } }, preventDefault() {} } as unknown as ClipboardEvent;
    expect(copyDocumentToClipboard(editor, event)).toBe(true);
    expect(JSON.parse(values["text/zettel"]).blocks[0]).toMatchObject({ _type: "app_card", title: "Keep me" });
    expect(values["text/plain"]).toContain("app_card");
    expect(values["text/html"]).not.toContain("<script");
  });

  it("does not add or remap mark fields on opaque inline extensions", () => {
    const source = {
      _type: "zettel_doc",
      blocks: [{
        _type: "zettel_block", _key: "p-opaque", style: "normal", markDefs: [],
        children: [{ _type: "app_chip", _key: "chip-1", label: "Keep shape" }],
      }],
    } as unknown as Document;
    const result = parseClipboardData({ "text/zettel": JSON.stringify(source) });
    const child = result.document?.blocks[0] && (result.document.blocks[0] as any).children[0];
    expect(child).toMatchObject({ _type: "app_chip", label: "Keep shape" });
    expect(child).not.toHaveProperty("marks");
  });
  it("leaves the caret after pasted inline content", () => {
    for (const payload of [{ "text/plain": "PASTED" }, { "text/html": "<p><strong>PASTED</strong></p>" }]) {
      const editor = createZettelEditor();
      registerZettelLexicalPlugin(editor);
      loadDocument(editor, { _type: "zettel_doc", blocks: [{ _type: "zettel_block", _key: "p", style: "normal", markDefs: [], children: [{ _type: "zettel_span", _key: "s", text: "Before after.", marks: [] }] }] });
      editor.update(() => { ($getRoot().getFirstDescendant() as TextNode).select(7, 7); }, { discrete: true });
      pasteClipboardData(editor, payload);
      editor.update(() => { editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "!"); }, { discrete: true });
      const block = exportDocument(editor).blocks[0] as any;
      expect(block.children.map((child: any) => child.text).join("")).toBe("Before PASTED!after.");
    }
  });
  it("leaves the caret at the end of a pasted list", () => {
    const editor = createZettelEditor();
    registerZettelLexicalPlugin(editor);
    loadDocument(editor, { _type: "zettel_doc", blocks: [{ _type: "zettel_block", _key: "p", style: "normal", markDefs: [], children: [{ _type: "zettel_span", _key: "s", text: "Before", marks: [] }] }] });
    editor.update(() => { ($getRoot().getFirstDescendant() as TextNode).select(6, 6); }, { discrete: true });
    pasteClipboardData(editor, { "text/html": "<p> one</p><ul><li>two</li></ul>" });
    editor.update(() => { editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "!"); }, { discrete: true });
    const [paragraph, list] = exportDocument(editor).blocks as any[];
    expect(paragraph.children.map((child: any) => child.text).join("")).toBe("Before one");
    expect(list.items[0].blocks[0].children.map((child: any) => child.text).join("")).toBe("two!");
  });
});
