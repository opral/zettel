import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMarkdown, toMarkdown } from "./markdown.js";
import { validateBody } from "../profile.mjs";
const uuid = "01950000-0000-7000-8000-000000000001";
const cases = [
  "# Checkpoint\n\nHello **bold** and *italic* with ~~strike~~ and `code`.\n",
  "1. First paragraph.\n\n   Another paragraph.\n\n   > A nested quote.\n\n2. Second item.\n",
  "- [x] Checked\n- [ ] Pending\n",
  '[Read **the proposal**](https://example.com "Proposal")\n',
  "Before  \nafter\n",
  "```js\n```\n",
  "---\n",
  `[Notes](lix://file/${uuid})\n`,
  `![Preview](lix://file/${uuid} "Caption")\n`,
  "[Checkpoint](lix://row/lix_row_ref%3Av1%3Atest-payload)\n",
  "",
];
function canonical(doc) {
  const copy = structuredClone(doc);
  let count = 0;
  function walk(n) {
    if (n._key) n._key = `k${count++}`;
    if (n.markDefs) {
      const map = new Map();
      for (const d of n.markDefs) {
        const old = d._key;
        walk(d);
        map.set(old, d._key);
      }
      for (const c of n.children) {
        if (c.marks) c.marks = c.marks.map((m) => map.get(m) ?? m);
        walk(c);
      }
    } else
      for (const field of ["blocks", "items"])
        for (const c of n[field] ?? []) walk(c);
  }
  walk(copy);
  return copy;
}
for (const [i, source] of cases.entries())
  test(`Markdown semantic roundtrip ${i}`, () => {
    const doc = fromMarkdown(source);
    assert.equal(validateBody(doc).ok, true);
    assert.deepEqual(canonical(fromMarkdown(toMarkdown(doc))), canonical(doc));
  });
test("normalizes CRLF and preserves distinct list item paragraphs", () => {
  assert.equal(fromMarkdown("a\r\nb").blocks[0].children[0].text, "a b");
  const doc = fromMarkdown(cases[1]);
  assert.equal(doc.blocks[0].items.length, 2);
  assert.equal(doc.blocks[0].items[0].blocks.length, 3);
});
test("unknown/lossy Markdown fails explicitly", () => {
  for (const source of [
    "<div>raw</div>",
    "| a |\n| - |\n| b |",
    "![remote](https://example.com/a.png)",
    "- [ ] task\n- plain",
    "```js extra\nx\n```",
  ])
    assert.throws(() => fromMarkdown(source));
  const doc = fromMarkdown("hello");
  doc.blocks[0].children[0].marks = ["underline"];
  assert.throws(() => toMarkdown(doc), /underline/);
  doc.blocks[0].children = [];
  assert.throws(() => toMarkdown(doc), /empty paragraph/);
});
test("imports allocate fresh identities", () => {
  assert.notEqual(
    fromMarkdown("hi").blocks[0]._key,
    fromMarkdown("hi").blocks[0]._key,
  );
});

test("preserves literal CRLF and CR inside code while normalizing prose", () => {
  const source =
    "before\r\nafter\r\n\r\n```text\r\nline1\rline2\r\n\r\n```\r\n";
  const doc = fromMarkdown(source);
  assert.equal(doc.blocks[0].children[0].text, "before after");
  assert.equal(doc.blocks[1].code, "line1\rline2\r\n");
  assert.deepEqual(canonical(fromMarkdown(toMarkdown(doc))), canonical(doc));
});
test("rejects empty links and file captions; preserves an empty heading", () => {
  for (const source of ["[](https://example.com)", `[](lix://file/${uuid})`])
    assert.throws(() => fromMarkdown(source), /Empty link|nonempty captions/);
  const doc = fromMarkdown("#\n");
  assert.equal(doc.blocks[0].style, "h1");
  assert.equal(doc.blocks[0].children.length, 0);
  assert.deepEqual(canonical(fromMarkdown(toMarkdown(doc))), canonical(doc));
});
