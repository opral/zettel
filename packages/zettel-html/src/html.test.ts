import { describe, expect, test } from "vitest";
import { SCHEMA_URL } from "@opral/zettel-ast";
import { parseFragment } from "parse5";
import { fromHtml, importHtml, toHtml } from "./html.js";
import type { Document } from "@opral/zettel-ast";

const span = (key: string, text: string, marks: string[] = []) => ({ type: "zettel_span" as const, zettel_key: key, text, marks });
const documentWith = (blocks: Document["blocks"]): Document => ({ $schema: SCHEMA_URL, blocks });

describe("canonical HTML", () => {
	test("rejects malformed documents before tag interpolation", () => {
		const malformed = documentWith([{ type: "zettel_text", zettel_key: "p-1", style: "img onerror=alert(1)" as never, children: [], markDefs: [] }]);
		expect(() => toHtml(malformed)).toThrow(/Invalid Zettel document/);
		expect(() => toHtml({ $schema: "https://example.invalid/schema.json", blocks: [] } as unknown as Document)).toThrow(/Invalid Zettel document/);
	});

	test("round trips semantic blocks, marks, links, images, and tables", () => {
		const document = documentWith([
			{
				type: "zettel_text",
				zettel_key: "p-1",
				style: "h2",
				children: [
					span("s-1", "Hello "),
					span("s-2", "world", ["strong", "link-1"]),
					{ type: "zettel_break", zettel_key: "br-1", marks: [] },
					{ type: "zettel_image", zettel_key: "im-1", src: "https://example.com/a.png", alt: "A", title: "image", marks: [] },
				],
				markDefs: [{ type: "zettel_link", zettel_key: "link-1", href: "https://example.com", title: "Example" }],
			},
			{
				type: "zettel_list",
				zettel_key: "list-1",
				kind: "number",
				start: 3,
				spread: false,
				items: [
					{ type: "zettel_list_item", zettel_key: "item-1", spread: false, checked: true, blocks: [{ type: "zettel_text", zettel_key: "item-p", style: "normal", children: [span("item-s", "Task")], markDefs: [] }] },
				],
			},
			{
				type: "zettel_table",
				zettel_key: "table-1",
				align: ["left", "right"],
				rows: [
					{ type: "zettel_table_row", zettel_key: "row-1", cells: [{ type: "zettel_table_cell", zettel_key: "cell-1", children: [span("head-1", "A")], markDefs: [] }, { type: "zettel_table_cell", zettel_key: "cell-2", children: [span("head-2", "B")], markDefs: [] }] },
					{ type: "zettel_table_row", zettel_key: "row-2", cells: [{ type: "zettel_table_cell", zettel_key: "cell-3", children: [span("body-1", "1")], markDefs: [] }, { type: "zettel_table_cell", zettel_key: "cell-4", children: [span("body-2", "2")], markDefs: [] }] },
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
			type: "zettel_table",
			zettel_key: "table-1",
			align: [null],
			rows: [{
				type: "zettel_table_row",
				zettel_key: "row-1",
				cells: [{ type: "zettel_table_cell", zettel_key: "cell-1", children: [], markDefs: [] }],
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
			{ type: "zettel_html", zettel_key: "raw-1", value: '<script>alert("x")</script>' },
			{ type: "zettel_text", zettel_key: "p-1", style: "normal", children: [span("s-1", "bad", ["link-1"]), { type: "zettel_image", zettel_key: "im-1", src: "javascript:alert(1)", alt: "fallback", marks: [] }], markDefs: [{ type: "zettel_link", zettel_key: "link-1", href: "javascript:alert(1)" }] },
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
		expect(result.document.blocks[0]).toMatchObject({ type: "zettel_text", children: [{ text: "Safe ", marks: [] }, { text: "link", marks: [] }] });
		expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["dropped-attribute", "unsafe-url", "dropped-element"]));
		expect(JSON.stringify(result.document)).not.toContain("javascript:");
	});

	test("preserves unsupported source as read-only HTML and keeps list task state", () => {
		const result = importHtml('<ul data-tight="true"><li><input type="checkbox" checked disabled>done</li></ul><custom-widget data-x="1">raw</custom-widget>');
		expect(result.document.blocks[0]).toMatchObject({ type: "zettel_list", spread: false, items: [{ checked: true }] });
		expect(result.document.blocks[1]).toMatchObject({ type: "zettel_html", value: '<custom-widget data-x="1">raw</custom-widget>' });
		expect(result.diagnostics.some((item) => item.code === "preserved-raw-html")).toBe(true);
	});

	test("imports top-level inline fragments and does not discard wrapper siblings", () => {
		const result = importHtml('<strong>inline</strong><div class="zettel"><p>inside</p></div><p>after</p>');
		expect(result.document.blocks.map((block) => block.type)).toEqual(["zettel_text", "zettel_text", "zettel_text"]);
		expect(result.document.blocks.map((block) => (block.type === "zettel_text" ? (block as { children: Array<{ text?: string }> }).children[0]?.text : ""))).toEqual(["inline", "inside", "after"]);
	});

	test("normalizes invalid empty containers instead of emitting invalid core nodes", () => {
		const result = importHtml('<ol start="-2"></ol><table></table>');
		expect(result.document.blocks).toHaveLength(2);
		expect(result.document.blocks[0]?.type).toBe("zettel_html");
		expect(result.document.blocks[1]?.type).toBe("zettel_html");
		expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["invalid-table"]));
	});

	test("diagnoses unrepresentable table spans while retaining cell text", () => {
		const result = importHtml('<table><tr><th>A</th></tr><tr><td colspan="2" rowspan="2">B</td></tr></table>');
		expect(result.document.blocks[0]).toMatchObject({ type: "zettel_table", rows: [{ cells: [{ children: [{ text: "A" }] }] }, { cells: [{ children: [{ text: "B" }] }] }] });
		expect(result.diagnostics.some((item) => item.code === "unsupported-table-span")).toBe(true);
	});

	test("contains malformed extension results and reports dropped controls", () => {
		const invalidExtension = importHtml('<custom data-zettel-type="card"></custom><custom data-zettel-type="card"></custom>', {
			extensions: {
				card: { fromHtml: () => ({ type: "zettel_text", zettel_key: "duplicate", style: "bad", children: [], markDefs: [] }) },
			},
		});
		expect(invalidExtension.document.blocks).toHaveLength(2);
		expect(invalidExtension.document.blocks.every((block) => block.type === "zettel_html")).toBe(true);
		expect(invalidExtension.diagnostics.filter((item) => item.code === "invalid-extension")).toHaveLength(2);

		const controls = importHtml('<p>before<input type="text" value="secret"><input type="checkbox">after</p>');
		expect(controls.document.blocks[0]).toMatchObject({ type: "zettel_text", children: [{ text: "before" }, { text: "after" }] });
		expect(controls.diagnostics.some((item) => item.code === "dropped-control")).toBe(true);
	});
});
