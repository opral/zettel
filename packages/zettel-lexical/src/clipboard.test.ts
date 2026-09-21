// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { copyDocumentToClipboard, createZettelEditor, loadDocument, parseClipboardData, SCHEMA_URL, type Document } from "./index.js";

const document: Document = {
  $schema: SCHEMA_URL,
  blocks: [{ type: "zettel_text", zettel_key: "p-1", style: "normal", markDefs: [], children: [{ type: "zettel_span", zettel_key: "s-1", text: "Copy me", marks: ["strong"] }] }],
};

describe("Zettel clipboard", () => {
  it("writes text/zettel, HTML, and plain text together", () => {
    const editor = createZettelEditor();
    loadDocument(editor, document);
    const values: Record<string, string> = {};
    const event = { clipboardData: { setData(type: string, value: string) { values[type] = value; } }, preventDefault() {} } as unknown as ClipboardEvent;
    expect(copyDocumentToClipboard(editor, event)).toBe(true);
    expect(values["text/plain"]).toBe("Copy me");
    expect(values["text/html"]).toContain("zettel_text");
    expect(JSON.parse(values["text/zettel"]).blocks[0].children[0].text).toBe("Copy me");
  });

  it("imports HTML through zettel-html and drops executable markup", () => {
    const result = parseClipboardData({ "text/html": "<p><strong>Hello</strong><script>window.x=1</script></p>", "text/plain": "Hello" });
    expect(result.handled).toBe(true);
    expect(result.document?.blocks[0]).toMatchObject({ type: "zettel_text" });
    expect(JSON.stringify(result.document)).not.toContain("window.x");
  });

  it("reports an invalid internal document and falls back explicitly", () => {
    const result = parseClipboardData({ "text/zettel": JSON.stringify({ $schema: "https://zettel.dev/schema/2/schema.json", blocks: [] }), "text/plain": "fallback" });
    expect(result.handled).toBe(true);
    expect(result.diagnostics?.length).toBeGreaterThan(0);
    expect(result.document?.blocks[0]).toMatchObject({ type: "zettel_text" });
  });

  it("keeps opaque extension content in internal and plain copy when HTML has no handler", () => {
    const editor = createZettelEditor();
    const extension = {
      $schema: SCHEMA_URL,
      blocks: [{ type: "app_card", zettel_key: "card-1", title: "Keep me" }],
    } as unknown as Document;
    loadDocument(editor, extension);
    const values: Record<string, string> = {};
    const event = { clipboardData: { setData(type: string, value: string) { values[type] = value; } }, preventDefault() {} } as unknown as ClipboardEvent;
    expect(copyDocumentToClipboard(editor, event)).toBe(true);
    expect(JSON.parse(values["text/zettel"]).blocks[0]).toMatchObject({ type: "app_card", title: "Keep me" });
    expect(values["text/plain"]).toContain("app_card");
    expect(values["text/html"]).not.toContain("<script");
  });

  it("does not add or remap mark fields on opaque inline extensions", () => {
    const source = {
      $schema: SCHEMA_URL,
      blocks: [{
        type: "zettel_text", zettel_key: "p-opaque", style: "normal", markDefs: [],
        children: [{ type: "app_chip", zettel_key: "chip-1", label: "Keep shape" }],
      }],
    } as unknown as Document;
    const result = parseClipboardData({ "text/zettel": JSON.stringify(source) });
    const child = result.document?.blocks[0] && (result.document.blocks[0] as any).children[0];
    expect(child).toMatchObject({ type: "app_chip", label: "Keep shape" });
    expect(child).not.toHaveProperty("marks");
  });
});
