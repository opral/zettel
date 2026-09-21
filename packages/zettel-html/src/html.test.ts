import { describe, expect, test } from "vitest";
import { parseFragment } from "parse5";
import { fromHtml, importHtml, toHtml } from "./html.js";
import type { Document } from "@opral/zettel-ast";

const span = (key: string, text: string, marks: string[] = []) => ({ _type: "zettel_span" as const, _key: key, text, marks });
const documentWith = (blocks: Document["blocks"]): Document => ({ _type: "zettel_doc", blocks });

describe("canonical HTML", () => {
	test("rejects malformed documents before tag interpolation", () => {
		const malformed = documentWith([{ _type: "zettel_block", _key: "p-1", style: "img onerror=alert(1)" as never, children: [], markDefs: [] }]);
		expect(() => toHtml(malformed)).toThrow(/Invalid Zettel document/);
		expect(() => toHtml({ $schema: "https://example.invalid/schema.json", blocks: [] } as unknown as Document)).toThrow(/Invalid Zettel document/);
	});

	test("round trips semantic blocks, marks, links, images, and tables", () => {
		const document = documentWith([
			{
				_type: "zettel_block",
				_key: "p-1",
				style: "h2",
				children: [
					span("s-1", "Hello "),
					span("s-2", "world", ["strong", "link-1"]),
					{ _type: "zettel_break", _key: "br-1", marks: [] },
					{ _type: "zettel_image", _key: "im-1", src: "https://example.com/a.png", alt: "A", title: "image", marks: [] },
				],
				markDefs: [{ _type: "zettel_link", _key: "link-1", href: "https://example.com", title: "Example" }],
			},
			{
				_type: "zettel_list",
				_key: "list-1",
				kind: "number",
				start: 3,
				spread: false,
				items: [
					{ _type: "zettel_list_item", _key: "item-1", spread: false, checked: true, blocks: [{ _type: "zettel_block", _key: "item-p", style: "normal", children: [span("item-s", "Task")], markDefs: [] }] },
				],
			},
			{
				_type: "zettel_table",
				_key: "table-1",
				align: ["left", "right"],
				rows: [
					{ _type: "zettel_table_row", _key: "row-1", cells: [{ _type: "zettel_table_cell", _key: "cell-1", children: [span("head-1", "A")], markDefs: [] }, { _type: "zettel_table_cell", _key: "cell-2", children: [span("head-2", "B")], markDefs: [] }] },
					{ _type: "zettel_table_row", _key: "row-2", cells: [{ _type: "zettel_table_cell", _key: "cell-3", children: [span("body-1", "1")], markDefs: [] }, { _type: "zettel_table_cell", _key: "cell-4", children: [span("body-2", "2")], markDefs: [] }] },
				],
			},
		]);
		const html = toHtml(document);
		expect(html).toContain('<div class="zettel">');
		expect(html).toContain("<thead>");
		expect(html).toContain('data-zettel-mark-key="link-1"');
		expect(html).toContain('data-checked="true"');
		expect(fromHtml(html)).toEqual(document);
	});

	test("emits valid semantic table sections", () => {
		const document = documentWith([{
			_type: "zettel_table",
			_key: "table-1",
			align: [null],
			rows: [{
				_type: "zettel_table_row",
				_key: "row-1",
				cells: [{ _type: "zettel_table_cell", _key: "cell-1", children: [], markDefs: [] }],
			}],
		}]);
		const fragment = parseFragment(toHtml(document)) as any;
		const table = fragment.childNodes[0].childNodes.find((node: any) => node.tagName === "table");
		expect(table.attrs.find((attribute: any) => attribute.name === "<thead")).toBeUndefined();
		expect(table.childNodes.map((node: any) => node.tagName)).toEqual(["thead"]);
		expect(table.childNodes[0].childNodes[0].tagName).toBe("tr");
	});

	test("escapes raw HTML and omits unsafe links and images", () => {
		const document = documentWith([
			{ _type: "zettel_html", _key: "raw-1", value: '<script>alert("x")</script>' },
			{ _type: "zettel_block", _key: "p-1", style: "normal", children: [span("s-1", "bad", ["link-1"]), { _type: "zettel_image", _key: "im-1", src: "javascript:alert(1)", alt: "fallback", marks: [] }], markDefs: [{ _type: "zettel_link", _key: "link-1", href: "javascript:alert(1)" }] },
		]);
		const html = toHtml(document);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("javascript:");
		expect(html).toContain("&lt;script&gt;");
	});
});

describe("clipboard fragment import", () => {
	test("strips executable content and reports diagnostics", () => {
		const result = importHtml('<p onclick="evil()">Safe <a href="javascript:alert(1)">link</a></p><script>alert(1)</script><style>p{display:none}</style>');
		expect(result.document.blocks[0]).toMatchObject({ _type: "zettel_block", children: [{ text: "Safe ", marks: [] }, { text: "link", marks: [] }] });
		expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["dropped-attribute", "unsafe-url", "dropped-element"]));
		expect(JSON.stringify(result.document)).not.toContain("javascript:");
	});

	test("preserves unsupported source as read-only HTML and keeps list task state", () => {
		const result = importHtml('<ul data-tight="true"><li><input type="checkbox" checked disabled>done</li></ul><custom-widget data-x="1">raw</custom-widget>');
		expect(result.document.blocks[0]).toMatchObject({ _type: "zettel_list", spread: false, items: [{ checked: true }] });
		expect(result.document.blocks[1]).toMatchObject({ _type: "zettel_html", value: '<custom-widget data-x="1">raw</custom-widget>' });
		expect(result.diagnostics.some((item) => item.code === "preserved-raw-html")).toBe(true);
	});

	test("imports top-level inline fragments and does not discard wrapper siblings", () => {
		const result = importHtml('<strong>inline</strong><div class="zettel"><p>inside</p></div><p>after</p>');
		expect(result.document.blocks.map((block) => block._type)).toEqual(["zettel_block", "zettel_block", "zettel_block"]);
		expect(result.document.blocks.map((block) => (block._type === "zettel_block" ? (block as { children: Array<{ text?: string }> }).children[0]?.text : ""))).toEqual(["inline", "inside", "after"]);
	});

	test("normalizes invalid empty containers instead of emitting invalid core nodes", () => {
		const result = importHtml('<ol start="-2"></ol><table></table>');
		expect(result.document.blocks).toHaveLength(2);
		expect(result.document.blocks[0]?._type).toBe("zettel_html");
		expect(result.document.blocks[1]?._type).toBe("zettel_html");
		expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["invalid-table"]));
	});

	test("diagnoses unrepresentable table spans while retaining cell text", () => {
		const result = importHtml('<table><tr><th>A</th></tr><tr><td colspan="2" rowspan="2">B</td></tr></table>');
		expect(result.document.blocks[0]).toMatchObject({ _type: "zettel_table", rows: [{ cells: [{ children: [{ text: "A" }] }] }, { cells: [{ children: [{ text: "B" }] }] }] });
		expect(result.diagnostics.some((item) => item.code === "unsupported-table-span")).toBe(true);
	});

	test("contains malformed extension results and reports dropped controls", () => {
		const invalidExtension = importHtml('<custom data-zettel-type="card"></custom><custom data-zettel-type="card"></custom>', {
			extensions: {
				card: { fromHtml: () => ({ _type: "zettel_block", _key: "duplicate", style: "bad", children: [], markDefs: [] }) },
			},
		});
		expect(invalidExtension.document.blocks).toHaveLength(2);
		expect(invalidExtension.document.blocks.every((block) => block._type === "zettel_html")).toBe(true);
		expect(invalidExtension.diagnostics.filter((item) => item.code === "invalid-extension")).toHaveLength(2);

		const controls = importHtml('<p>before<input type="text" value="secret"><input type="checkbox">after</p>');
		expect(controls.document.blocks[0]).toMatchObject({ _type: "zettel_block", children: [{ text: "before" }, { text: "after" }] });
		expect(controls.diagnostics.some((item) => item.code === "dropped-control")).toBe(true);
	});
});
