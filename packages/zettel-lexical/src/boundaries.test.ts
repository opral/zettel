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
      _type: "zettel_block",
      _key: "p",
      style: "normal",
      markDefs: [],
      children: [
        { _type: "zettel_span", _key: "s", text: "Keep me", marks: [] },
      ],
    },
  ]);
describe("public binding boundaries", () => {
  it("splits linked text without duplicating document annotation keys", () => {
    const doc = document();
    const block = doc.blocks[0] as import("@opral/zettel-ast").TextBlock;
    block.markDefs = [{ _type: "zettel_link", _key: "link", href: "https://example.com" }];
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
    expect(blocks[0]!.markDefs[0]!._key).not.toBe(blocks[1]!.markDefs[0]!._key);
    expect(blocks.map(b => b.markDefs[0]!.href)).toEqual(["https://example.com", "https://example.com"]);
    expect(block.markDefs).toHaveLength(1);
  });

  it("rejects invalid and unknown-version documents before changing editor content", () => {
    const editor = createZettelEditor();
    loadDocument(editor, document());
    for (const invalid of [
      { ...document(), $schema: "https://example.com/future" },
      { ...document(), blocks: [{ _type: "zettel_block", _key: "p" }] },
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
      _type: "app_chip",
      _key: "chip",
      label: "hello",
    });
    doc.blocks.push({
      _type: "app_card",
      _key: "card",
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
