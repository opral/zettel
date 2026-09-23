import { describe, expect, test } from "vitest";
import {
  fromMarkdown,
  MarkdownConversionError,
  toMarkdown,
} from "../src/index.js";
import {
  type Document,
  type List,
  type Table,
  type TextBlock,
} from "@opral/zettel-ast";

describe("GFM import", () => {
  test("keeps nested task list ownership and mixed ordered task state", () => {
    const document = fromMarkdown(
      "3. [ ] first\n4. ordinary\n5. [x] third\n\n- [x] outer\n  - [ ] inner\n",
    );
    expect(document._type).toBe("zettel_doc");
    expect(document.blocks).toHaveLength(2);

    const ordered = document.blocks[0] as List;
    expect(ordered).toMatchObject({
      _type: "zettel_list",
      kind: "number",
      start: 3,
    });
    if (ordered._type !== "zettel_list")
      throw new Error("expected ordered list");
    expect(ordered.items.map((item) => item.checked)).toEqual([
      false,
      undefined,
      true,
    ]);

    const bullet = document.blocks[1] as List;
    expect(bullet._type).toBe("zettel_list");
    if (bullet._type !== "zettel_list") throw new Error("expected bullet list");
    expect(bullet.items).toHaveLength(1);
    expect(bullet.items[0]?.checked).toBe(true);
    const nested = bullet.items[0]?.blocks[1] as List | undefined;
    expect(nested).toMatchObject({ _type: "zettel_list", kind: "bullet" });
    if (nested?._type !== "zettel_list") throw new Error("expected nested list");
    expect(nested.items[0]?.checked).toBe(false);
  });

  test("imports tables, alignment, escaped pipes, and inline marks", () => {
    const document = fromMarkdown(
      "| f\\|oo | right |\n| :-: | ---: |\n| b `\\|` az | b **\\|** im |\n",
    );
    const table = document.blocks[0] as Table;
    expect(table).toMatchObject({
      _type: "zettel_table",
      align: ["center", "right"],
    });
    if (table._type !== "zettel_table") throw new Error("expected table");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.cells[0]?.children[0]).toMatchObject({
      text: "f|oo",
    });
    expect(table.rows[1]?.cells[0]?.children[0]).toMatchObject({ text: "b " });
    expect(table.rows[1]?.cells[0]?.children[1]).toMatchObject({
      text: "|",
      marks: ["code"],
    });
    expect(table.rows[1]?.cells[1]?.children[1]).toMatchObject({
      text: "|",
      marks: ["strong"],
    });
  });

  test("preserves raw HTML blocks and inline tags as source", () => {
    const document = fromMarkdown(
      "<section data-x='1'>\nraw\n</section>\n\nhello <kbd>x</kbd>",
    );
    expect(document.blocks[0]).toMatchObject({
      _type: "zettel_html",
      value: "<section data-x='1'>\nraw\n</section>",
    });
    const paragraph = document.blocks[1] as TextBlock;
    if (paragraph?._type !== "zettel_block")
      throw new Error("expected paragraph");
    expect(paragraph.children[1]).toMatchObject({
      _type: "zettel_html_inline",
      value: "<kbd>",
    });
    expect(paragraph.children[3]).toMatchObject({
      _type: "zettel_html_inline",
      value: "</kbd>",
    });
  });

  test("imports escapes, links, images, hard breaks, and fenced code metadata", () => {
    const document = fromMarkdown(
      '[a \\*link\\*](https://example.com "title") ![alt](image.png "caption") \\# literal\\\nnext\n\n~~~js meta=value\nconst x = `|`;\n~~~\n',
    );
    const paragraph = document.blocks[0] as TextBlock;
    if (paragraph?._type !== "zettel_block")
      throw new Error("expected paragraph");
    expect(paragraph.children[0]).toMatchObject({ text: "a *link*" });
    expect(paragraph.children[0]?.marks).toHaveLength(1);
    expect(paragraph.markDefs[0]).toMatchObject({
      href: "https://example.com",
      title: "title",
    });
    expect(paragraph.children[2]).toMatchObject({
      _type: "zettel_image",
      src: "image.png",
      alt: "alt",
      title: "caption",
      marks: [],
    });
    expect(paragraph.children[4]).toMatchObject({
      _type: "zettel_break",
      marks: [],
    });
    expect(document.blocks[1]).toMatchObject({
      _type: "zettel_code",
      language: "js",
      meta: "meta=value",
      code: "const x = `|`;",
    });
  });

  test("resolves reference links and images into local link definitions", () => {
    const document = fromMarkdown(
      '[reference][target] ![image][target]\n\n[target]: /asset.png "caption"\n',
    );
    const paragraph = document.blocks[0] as TextBlock;
    expect(paragraph.children[0]).toMatchObject({ text: "reference" });
    expect(paragraph.children[1]).toMatchObject({
      _type: "zettel_span",
      text: " ",
    });
    expect(paragraph.children[2]).toMatchObject({
      _type: "zettel_image",
      src: "/asset.png",
      alt: "image",
      title: "caption",
    });
    expect(paragraph.markDefs).toHaveLength(1);
    expect(paragraph.markDefs[0]).toMatchObject({
      href: "/asset.png",
      title: "caption",
    });
    expect(toMarkdown(document)).toBe(
      '[reference](/asset.png "caption") ![image](/asset.png "caption")\n',
    );
  });

  test("uses the first definition for duplicate GFM references", () => {
    const document = fromMarkdown(
      "[first][target] [second][target]\n\n[target]: /first\n[target]: /second\n",
    );
    const paragraph = document.blocks[0] as TextBlock;
    expect(paragraph.markDefs).toHaveLength(1);
    expect(paragraph.markDefs[0]).toMatchObject({ href: "/first" });
    expect(toMarkdown(document)).toBe("[first](/first) [second](/first)\n");
  });

  test("keeps Markdown parsed inside blank lines in HTML containers", () => {
    const document = fromMarkdown('<DIV CLASS="foo">\n\n*Markdown*\n\n</DIV>');
    expect(document.blocks.map((block) => block._type)).toEqual([
      "zettel_html",
      "zettel_block",
      "zettel_html",
    ]);
    expect(document.blocks[1]).toMatchObject({
      _type: "zettel_block",
      children: [{ text: "Markdown", marks: ["em"] }],
    });
    expect(toMarkdown(document)).toBe(
      '<DIV CLASS="foo">\n\n*Markdown*\n\n</DIV>\n',
    );
  });

  test("treats footnote-shaped syntax as formal GFM references", () => {
    const document = fromMarkdown("[^a]\n\n[^a]: /url\n");
    const paragraph = document.blocks[0] as TextBlock;
    expect(paragraph.children[0]).toMatchObject({
      text: "^a",
      marks: [paragraph.markDefs[0]?._key],
    });
    expect(paragraph.markDefs[0]).toMatchObject({ href: "/url" });
    expect(toMarkdown(document)).toBe("[^a](/url)\n");
  });

  test("keeps escaped numeric character references literal", () => {
    const document = fromMarkdown("plain \\&#10; text");
    const output = toMarkdown(document);
    expect(output).toBe("plain &amp;#10; text\n");
    expect(fromMarkdown(output).blocks[0]).toMatchObject({
      children: [{ text: "plain &#10; text" }],
    });
  });

  test("keeps escaped email autolinks literal", () => {
    const document = fromMarkdown("<foo\\+@bar.example.com>");
    expect(document.blocks[0]).toMatchObject({
      children: [{ text: "<foo+@bar.example.com>", marks: [] }],
    });
    expect(toMarkdown(document)).toBe("\\<foo\\+\\@bar.example.com>\n");
  });
});

describe("GFM export", () => {
  test("round trips semantic GFM features with canonical remark output", () => {
    const input =
      "# title\n\n- [x] done\n- plain\n\n| a | b |\n| :- | -: |\n| c | d |\n";
    const document = fromMarkdown(input);
    const output = toMarkdown(document);
    expect(output).toBe(
      "# title\n\n* [x] done\n* plain\n\n| a  |  b |\n| :- | -: |\n| c  |  d |\n",
    );
    const reread = fromMarkdown(output);
    expect(reread.blocks.map((block) => block._type)).toEqual([
      "zettel_block",
      "zettel_list",
      "zettel_table",
    ]);
  });

  test("exports nested list blocks under their owning item", () => {
    const document = fromMarkdown("- outer\n  1. inner\n  2. second\n");
    const output = toMarkdown(document);
    expect(output).toBe("* outer\n  1. inner\n  2. second\n");
  });

  test("rejects extension nodes instead of silently dropping them", () => {
    const document = {
      _type: "zettel_doc",
      blocks: [{ type: "custom_block", _key: "custom1" }],
    } as unknown as Document;
    expect(() => toMarkdown(document)).toThrow(MarkdownConversionError);
  });

  test("rejects invalid document schemas before serialization", () => {
    expect(() =>
      toMarkdown({ $schema: "https://example.invalid", blocks: [] } as never),
    ).toThrow(MarkdownConversionError);
  });
});

describe("underline", () => {
  const underlined = (text: string, marks: string[] = ["underline"]) => ({
    _type: "zettel_doc",
    blocks: [
      {
        _type: "zettel_block",
        _key: "b",
        style: "normal",
        markDefs: [],
        children: [
          { _type: "zettel_span", _key: "s1", text: "a ", marks: [] },
          { _type: "zettel_span", _key: "s2", text, marks },
          { _type: "zettel_span", _key: "s3", text: " c", marks: [] },
        ],
      },
    ],
  }) as unknown as Document;

  test("exports as inline <u> and imports back as the underline mark", () => {
    const markdown = toMarkdown(underlined("b"));
    expect(markdown.trim()).toBe("a <u>b</u> c");
    const block = fromMarkdown(markdown).blocks[0] as TextBlock;
    expect(block.children.map((child: any) => [child.text, child.marks])).toEqual([
      ["a ", []],
      ["b", ["underline"]],
      [" c", []],
    ]);
  });

  test("combines with other marks and reads <ins> too", () => {
    const markdown = toMarkdown(underlined("b", ["strong", "underline"]));
    const marks = (fromMarkdown(markdown).blocks[0] as any).children[1].marks;
    expect([...marks].sort()).toEqual(["strong", "underline"]);
    const ins = fromMarkdown("a <ins>b</ins> c").blocks[0] as any;
    expect(ins.children[1].marks).toEqual(["underline"]);
  });

  test("an unpaired <u> stays inline HTML", () => {
    const block = fromMarkdown("a <u>b c").blocks[0] as any;
    expect(block.children.map((child: any) => child._type)).toContain(
      "zettel_html_inline",
    );
  });
});
