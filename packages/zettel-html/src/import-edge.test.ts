import { test, expect } from "vitest";
import { validateDocument, type Table, type List } from "@opral/zettel-ast";
import { importHtml } from "./html.js";
test("ragged clipboard tables pad to widest row without losing cells", () => {
	const result = importHtml("<table><tr><td>A</td></tr><tr><td>B</td><td>C</td></tr></table>");
	expect(validateDocument(result.document).ok).toBe(true);
	const table = result.document.blocks[0] as Table;
	expect(table.rows.map((r) => r.cells.length)).toEqual([2, 2]);
	expect(table.rows[1]?.cells[1]?.children[0]).toMatchObject({ text: "C" });
});
test("task checkboxes inside paragraphs retain state, not nested child task state", () => {
	const result = importHtml(
		'<ul><li><p><input type="checkbox" checked> done</p></li><li>parent<ul><li><p><input type="checkbox"> child</p></li></ul></li></ul>'
	);
	expect(validateDocument(result.document).ok).toBe(true);
	const list = result.document.blocks[0] as List;
	expect(list.items[0]?.checked).toBe(true);
	expect(list.items[1]?.checked).toBeUndefined();
	const inner = list.items[1]?.blocks[1] as List;
	expect(inner.items[0]?.checked).toBe(false);
});
test("nested empty lists and oversized start produce valid fallback/diagnostic", () => {
	for (const html of [
		"<ul><li>text<ul></ul></li></ul>",
		'<ol start="999999999999"><li>x</li></ol>',
	]) {
		const result = importHtml(html);
		expect(validateDocument(result.document).ok).toBe(true);
		expect(result.diagnostics.length).toBeGreaterThan(0);
	}
});

test("supplied annotation keys cannot change another link destination or collide with decorators", () => {
	const result = importHtml(
		'<p><a data-zettel-mark-key="shared" href="/one">one</a><a data-zettel-mark-key="shared" href="/two">two</a><a data-zettel-mark-key="strong" href="/three">three</a></p>'
	);
	expect(validateDocument(result.document).ok).toBe(true);
	const block = result.document.blocks[0] as import("@opral/zettel-ast").TextBlock;
	expect(block.markDefs.map((m) => m.href)).toEqual(["/one", "/two", "/three"]);
	expect(new Set(block.markDefs.map((m) => m._key)).size).toBe(3);
});
test("clipboard metadata (Chromium's leading <meta charset>) is not imported as content", () => {
	for (const html of [
		"<meta charset='utf-8'><p>Some <b>bold</b> text</p>",
		"<meta charset='utf-8'><span>Inline</span> copy",
		"<html><head><title>Page</title><link rel=\"stylesheet\" href=\"x.css\"></head><body><!--StartFragment--><p>Body</p><!--EndFragment--></body></html>",
	]) {
		const result = importHtml(html);
		expect(validateDocument(result.document).ok).toBe(true);
		expect(result.document.blocks.map((block) => block._type)).toEqual(["zettel_block"]);
		expect(JSON.stringify(result.document)).not.toMatch(/meta|charset|Page|stylesheet/);
	}
});
