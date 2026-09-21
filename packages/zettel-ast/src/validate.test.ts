import { describe, it, expect } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
	SCHEMA_URL,
	createDocument,
	createDocumentSchema,
	documentSchema,
	validateDocument,
	generateKey,
	type Document,
} from "./index.js";
const paragraph = () => ({
	type: "zettel_text",
	zettel_key: "p",
	style: "normal",
	markDefs: [{ type: "zettel_link", zettel_key: "link", href: "https://example.com" }],
	children: [{ type: "zettel_span", zettel_key: "s", text: "Hello", marks: ["link", "strong"] }],
});
const doc = (): any => ({ $schema: SCHEMA_URL, blocks: [paragraph()] });
describe("Zettel document validation", () => {
	it("validates shared marks and empty documents", () => {
		const d = doc();
		d.blocks[0].children.push({
			type: "zettel_span",
			zettel_key: "s2",
			text: " world",
			marks: ["link"],
		});
		expect(validateDocument(d).ok).toBe(true);
		expect(validateDocument(createDocument()).ok).toBe(true);
		expect(generateKey()).toMatch(/^[A-Za-z0-9_-]+$/);
	});
	it("requires the exact schema identifier, own required fields, and closed objects", () => {
		for (const d of [{ blocks: [] }, { $schema: "other", blocks: [] }, { ...doc(), version: 1 }])
			expect(validateDocument(d).ok).toBe(false);
		const old = Object.getOwnPropertyDescriptor(Object.prototype, "blocks");
		try {
			Object.defineProperty(Object.prototype, "blocks", { value: [], configurable: true });
			expect(validateDocument({ $schema: SCHEMA_URL }).ok).toBe(false);
		} finally {
			if (old) Object.defineProperty(Object.prototype, "blocks", old);
			else delete (Object.prototype as any).blocks;
		}
	});
	it("rejects duplicate identity, duplicate/unresolved marks and multiple links", () => {
		const d = doc();
		d.blocks[0].children[0].zettel_key = "p";
		expect(validateDocument(d).ok).toBe(false);
		for (const marks of [["bad"], ["strong", "strong"], ["link", "two"]]) {
			const v = doc();
			v.blocks[0].markDefs.push({ type: "zettel_link", zettel_key: "two", href: "" });
			v.blocks[0].children[0].marks = marks;
			expect(validateDocument(v).ok).toBe(false);
		}
	});
	it("supports links around images and hard breaks", () => {
		const d = doc();
		d.blocks[0].children.push(
			{ type: "zettel_image", zettel_key: "i", src: "image.png", alt: "", marks: ["link"] },
			{ type: "zettel_break", zettel_key: "b", marks: [] }
		);
		expect(validateDocument(d).ok).toBe(true);
	});
	it("supports mixed tasks, empty items, and nested blocks", () => {
		const d = {
			$schema: SCHEMA_URL,
			blocks: [
				{
					type: "zettel_list",
					zettel_key: "l",
					kind: "number",
					start: 3,
					spread: true,
					items: [
						{
							type: "zettel_list_item",
							zettel_key: "a",
							spread: false,
							checked: false,
							blocks: [paragraph()],
						},
						{ type: "zettel_list_item", zettel_key: "b", spread: false, blocks: [] },
					],
				},
			],
		};
		expect(validateDocument(d).ok).toBe(true);
		delete (d.blocks[0] as any).start;
		expect(validateDocument(d).ok).toBe(false);
	});
	it("checks table shape beyond JSON Schema", () => {
		const d = {
			$schema: SCHEMA_URL,
			blocks: [
				{
					type: "zettel_table",
					zettel_key: "t",
					align: ["left", null],
					rows: [
						{
							type: "zettel_table_row",
							zettel_key: "r",
							cells: [{ type: "zettel_table_cell", zettel_key: "c", children: [], markDefs: [] }],
						},
					],
				},
			],
		};
		expect(validateDocument(d).errors.some((e) => e.message.includes("rectangular"))).toBe(true);
	});
	it("rejects non-JSON data without invoking accessors or mutating input", () => {
		const d = doc();
		let called = false;
		Object.defineProperty(d, "blocks", {
			get() {
				called = true;
				return [];
			},
			enumerable: true,
		});
		expect(validateDocument(d).ok).toBe(false);
		expect(called).toBe(false);
		const sparse: any[] = [];
		sparse.length = 1;
		for (const blocks of [sparse, [undefined], [NaN]])
			expect(validateDocument({ $schema: SCHEMA_URL, blocks }).ok).toBe(false);
		const cycle: any = {};
		cycle.x = cycle;
		expect(validateDocument(cycle).ok).toBe(false);
	});
	it("registers extensions explicitly and isolates callbacks", () => {
		const d = {
			$schema: SCHEMA_URL,
			blocks: [{ type: "app_card", zettel_key: "x", label: "before" }],
		};
		expect(validateDocument(d).ok).toBe(false);
		expect(
			validateDocument(d, {
				blocks: {
					app_card: (v) => {
						v.label = "after";
						return [];
					},
				},
			}).ok
		).toBe(true);
		expect(d.blocks[0]?.label).toBe("before");
		expect(validateDocument(d, { blocks: { app_card: () => ["bad"] } }).ok).toBe(false);
		expect(validateDocument(d, { blocks: { zettel_card: () => [] } }).ok).toBe(false);
	});
	it("builds recursively extensible schemas without widening core nodes", () => {
		const schema = createDocumentSchema({
			blocks: [
				{
					type: "object",
					properties: {
						type: { const: "app_card" },
						zettel_key: { type: "string" },
						label: { type: "string" },
					},
					required: ["type", "zettel_key", "label"],
					additionalProperties: false,
				},
			],
		});
		const check = new Ajv2020({ strict: false }).compile(schema);
		expect(
			check({
				$schema: SCHEMA_URL,
				blocks: [
					{
						type: "zettel_quote",
						zettel_key: "q",
						blocks: [{ type: "app_card", zettel_key: "c", label: "ok" }],
					},
				],
			})
		).toBe(true);
		expect(check({ ...doc(), extra: 1 })).toBe(false);
		expect(documentSchema.$defs.extensionBlock.not).toEqual({});
	});
});
