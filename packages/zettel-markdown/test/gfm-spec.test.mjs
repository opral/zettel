import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { fromMarkdown, toMarkdown } from "../src/index.ts";

const fixture = readFileSync(
  new URL("../../../fixtures/gfm/cmark-gfm-spec.txt", import.meta.url),
  "utf8",
);
const fixtureLines = fixture.split("\n");
const examples = [];
for (let index = 0; index < fixtureLines.length; index += 1) {
  const opening = /^(?<fence>`{6,}) example(?:[^\n]*)$/.exec(
    fixtureLines[index],
  );
  if (!opening) continue;
  const fence = opening.groups.fence;
  let dot = index + 1;
  while (dot < fixtureLines.length && fixtureLines[dot] !== ".") dot += 1;
  if (dot >= fixtureLines.length)
    throw new Error("Missing GFM example output marker");
  let closing = dot + 1;
  while (closing < fixtureLines.length && fixtureLines[closing] !== fence)
    closing += 1;
  if (closing >= fixtureLines.length)
    throw new Error("Missing GFM example closing fence");
  // cmark's spec harness displays tabs as U+2192 arrows in the fixture.
  examples.push({
    index: examples.length + 1,
    source: fixtureLines
      .slice(index + 1, dot)
      .join("\n")
      .replaceAll("→", "\t"),
    expectedHtml: fixtureLines
      .slice(dot + 1, closing)
      .join("\n")
      .replaceAll("→", "\t"),
  });
  index = closing;
}

function semanticDocument(document) {
  return { blocks: document.blocks.map((block) => semanticBlock(block)) };
}

function semanticBlock(block) {
  switch (block.type) {
    case "zettel_text":
      return {
        type: block.type,
        style: block.style,
        children: semanticChildren(block.children, block.markDefs),
      };
    case "zettel_list": {
      const loose = block.spread || block.items.some((item) => item.spread);
      return {
        type: block.type,
        kind: block.kind,
        start: block.start ?? null,
        spread: loose,
        items: block.items.map((item) => ({
          blocks: item.blocks.map((child) => semanticBlock(child)),
          spread: loose || item.spread,
          checked: item.checked ?? null,
        })),
      };
    }
    case "zettel_quote":
      return {
        type: block.type,
        blocks: block.blocks.map((child) => semanticBlock(child)),
      };
    case "zettel_code":
      return {
        type: block.type,
        code: block.code,
        language: block.language ?? null,
        meta: block.meta ?? null,
      };
    case "zettel_rule":
      return { type: block.type };
    case "zettel_table":
      return {
        type: block.type,
        align: block.align,
        rows: block.rows.map((row) =>
          row.cells.map((cell) => ({
            children: semanticChildren(cell.children, cell.markDefs),
          })),
        ),
      };
    case "zettel_html":
      // remark-stringify terminates a final raw HTML block with one LF. That
      // delimiter is outside the authored block and is not HTML content.
      return {
        type: block.type,
        value: block.value.replace(/\n$/, ""),
      };
    default:
      return block;
  }
}

function semanticChildren(children, markDefs) {
  const result = [];
  for (const child of children) {
    const current = semanticInline(child, markDefs);
    const previous = result.at(-1);
    if (
      previous?.type === "zettel_span" &&
      current.type === "zettel_span" &&
      JSON.stringify(previous.marks) === JSON.stringify(current.marks)
    ) {
      previous.text += current.text;
    } else {
      result.push(current);
    }
  }
  return result;
}

function semanticInline(inline, markDefs) {
  const marks = inline.marks.map((mark) => {
    const definition = markDefs.find(
      (candidate) => candidate.zettel_key === mark,
    );
    return definition
      ? { type: "link", href: definition.href, title: definition.title ?? null }
      : mark;
  });
  if (inline.type === "zettel_span") {
    return {
      type: inline.type,
      text: inline.marks.includes("code")
        ? inline.text
        : inline.text.replace(/\n/g, " "),
      marks,
    };
  }
  if (inline.type === "zettel_break") {
    return { type: inline.type, marks };
  }
  if (inline.type === "zettel_image") {
    return {
      type: inline.type,
      src: inline.src,
      alt: inline.alt,
      title: inline.title ?? null,
      marks,
    };
  }
  if (inline.type === "zettel_html_inline") {
    return { type: inline.type, value: inline.value, marks };
  }
  return inline;
}

describe("upstream cmark-gfm corpus", () => {
  test("matches the formal HTML oracle for representative GFM extensions", () => {
    const sources = [
      "| foo | bar |\n| --- | --- |\n| baz | bim |",
      "- [ ] foo\n- [x] bar",
      "~~Hi~~ Hello, world!",
      "foo\\\nbar",
      "```ruby\ndef foo(x)\n  return 3\nend\n```",
      '<DIV CLASS="foo">\n\n*Markdown*\n\n</DIV>',
    ];
    for (const source of sources) {
      const example = examples.find((candidate) => candidate.source === source);
      expect(
        example,
        `missing pinned fixture for ${JSON.stringify(source)}`,
      ).toBeTruthy();
      const canonical = toMarkdown(fromMarkdown(source));
      const actual = micromark(canonical, {
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
        allowDangerousHtml: true,
      });
      expect(normalizeHtml(actual)).toBe(normalizeHtml(example.expectedHtml));
    }
  });

  test("all formal GFM examples round trip without semantic loss", () => {
    expect(examples).toHaveLength(672);
    for (const example of examples) {
      try {
        const original = fromMarkdown(example.source);
        const canonical = toMarkdown(original);
        const reread = fromMarkdown(canonical);
        expect(semanticDocument(reread)).toEqual(semanticDocument(original));
      } catch (error) {
        throw new Error(
          `GFM example ${example.index} failed: ${error instanceof Error ? error.message : String(error)}\n${example.source}`,
        );
      }
    }
  });
});

function normalizeHtml(value) {
  return (
    value
      .replace(/\r\n?/g, "\n")
      .replace(/\n/g, "")
      // micromark and cmark-gfm differ in checkbox attribute order and void-tag
      // syntax; compare the same HTML tree rather than serializer trivia.
      .replace(/<input\b([^>]*)\/?\s*>/g, (_match, raw) => {
        const attributes = [...raw.matchAll(/\s+([^\s=]+)="([^"]*)"/g)]
          .map((attribute) => [attribute[1], attribute[2]])
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, content]) => ` ${name}="${content}"`)
          .join("");
        return `<input${attributes}>`;
      })
      .replace(/>\s+</g, "><")
      .replace(/\s+/g, " ")
      .trim()
  );
}
