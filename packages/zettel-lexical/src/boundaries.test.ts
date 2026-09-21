import { $getRoot, KEY_ENTER_COMMAND } from "lexical";
import { describe, expect, it } from "vitest";
import { createDocument, type Document } from "@opral/zettel-ast";
import {
  createZettelEditor,
  exportDocument,
  fromLexicalState,
  loadDocument,
  toLexicalState,
  registerZettelLexicalPlugin,
} from "./index.js";

const document = (): Document =>
  createDocument([
    {
      type: "zettel_text",
      zettel_key: "p",
      style: "normal",
      markDefs: [],
      children: [
        { type: "zettel_span", zettel_key: "s", text: "Keep me", marks: [] },
      ],
    },
  ]);
describe("public binding boundaries", () => {
  it("splits linked text without duplicating document annotation keys", () => {
    const doc = document();
    const block = doc.blocks[0] as import("@opral/zettel-ast").TextBlock;
    block.markDefs = [{ type: "zettel_link", zettel_key: "link", href: "https://example.com" }];
    block.children[0]!.marks = ["link"];
    const editor = createZettelEditor();
    registerZettelLexicalPlugin(editor);
    loadDocument(editor, doc);
    editor.update(() => {
      const span = $getRoot().getFirstDescendant() as import("./nodes/index.js").ZettelSpanNode;
      span.select(4, 4);
      editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    }, { discrete: true });
    const result = exportDocument(editor);
    expect(result.blocks).toHaveLength(2);
    const blocks = result.blocks as import("@opral/zettel-ast").TextBlock[];
    expect(blocks[0]!.markDefs[0]!.zettel_key).not.toBe(blocks[1]!.markDefs[0]!.zettel_key);
    expect(blocks.map(b => b.markDefs[0]!.href)).toEqual(["https://example.com", "https://example.com"]);
    expect(block.markDefs).toHaveLength(1);
  });

  it("rejects invalid and unknown-version documents before changing editor content", () => {
    const editor = createZettelEditor();
    loadDocument(editor, document());
    for (const invalid of [
      { ...document(), $schema: "https://example.com/future" },
      { ...document(), blocks: [{ type: "zettel_text", zettel_key: "p" }] },
    ]) {
      expect(() => loadDocument(editor, invalid as Document)).toThrow();
      expect(() => toLexicalState(invalid as Document)).toThrow();
      expect(exportDocument(editor)).toEqual(document());
    }
  });
  it("uses actual node serialization, including empty documents", () => {
    for (const doc of [createDocument(), document()])
      expect(fromLexicalState(toLexicalState(doc))).toEqual(doc);
    expect(() => fromLexicalState({})).toThrow();
  });
  it("preserves opaque extension atoms at their original inline and block locations", () => {
    const doc = document();
    (doc.blocks[0] as any).children.push({
      type: "app_chip",
      zettel_key: "chip",
      label: "hello",
    });
    doc.blocks.push({
      type: "app_card",
      zettel_key: "card",
      payload: { nested: [1, true] },
    });
    const editor = createZettelEditor();
    loadDocument(editor, doc);
    expect(exportDocument(editor)).toEqual(doc);
    expect(fromLexicalState(toLexicalState(doc))).toEqual(doc);
  });
  it("validates input without invoking accessors", () => {
    let calls = 0;
    const value = { ...document() };
    Object.defineProperty(value, "blocks", {
      enumerable: true,
      get() {
        calls++;
        return [];
      },
    });
    expect(() => toLexicalState(value)).toThrow();
    expect(calls).toBe(0);
  });
});
