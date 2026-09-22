import { describe, it, expect } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
	createDocument,
	createDocumentSchema,
	documentSchema,
	validateDocument,
	generateKey,
	type Document,
} from "./index.js";
const paragraph = () => ({
	_type: "zettel_block",
	_key: "p",
	style: "normal",
	markDefs: [{ _type: "zettel_link", _key: "link", href: "https://example.com" }],
	children: [{ _type: "zettel_span", _key: "s", text: "Hello", marks: ["link", "strong"] }],
});
const doc = (): any => ({ _type: "zettel_doc", blocks: [paragraph()] });
describe("Zettel document validation", () => {
	it("validates shared marks and empty documents", () => {
		const d = doc();
		d.blocks[0].children.push({
			_type: "zettel_span",
			_key: "s2",
			text: " world",
			marks: ["link"],
		});
		expect(validateDocument(d).ok).toBe(true);
		expect(validateDocument(createDocument()).ok).toBe(true);
		expect(generateKey()).toMatch(/^[A-Za-z0-9_-]+$/);
	});
	it("requires the document discriminator, own required fields, and closed objects", () => {
		for (const d of [{ blocks: [] }, { _type: "other", blocks: [] }, { $schema: "https://zettel.dev/schema/1/schema.json", blocks: [] }, { ...doc(), version: 1 }, { ...doc(), _key: "root" }, { _type: "zettel_doc", blocks: [{ ...paragraph(), _type: "zettel_text" }] }, { type: "zettel_doc", content: [] }])
			expect(validateDocument(d).ok).toBe(false);
		const old = Object.getOwnPropertyDescriptor(Object.prototype, "blocks");
		try {
			Object.defineProperty(Object.prototype, "blocks", { value: [], configurable: true });
			expect(validateDocument({ _type: "zettel_doc" }).ok).toBe(false);
		} finally {
			if (old) Object.defineProperty(Object.prototype, "blocks", old);
			else delete (Object.prototype as any).blocks;
		}
	});
	it("rejects duplicate identity, duplicate/unresolved marks and multiple links", () => {
		const d = doc();
		d.blocks[0].children[0]._key = "p";
		expect(validateDocument(d).ok).toBe(false);
		for (const marks of [["bad"], ["strong", "strong"], ["link", "two"]]) {
			const v = doc();
			v.blocks[0].markDefs.push({ _type: "zettel_link", _key: "two", href: "" });
			v.blocks[0].children[0].marks = marks;
			expect(validateDocument(v).ok).toBe(false);
		}
	});
	it("supports links around images and hard breaks", () => {
		const d = doc();
		d.blocks[0].children.push(
			{ _type: "zettel_image", _key: "i", src: "image.png", alt: "", marks: ["link"] },
			{ _type: "zettel_break", _key: "b", marks: [] }
		);
		expect(validateDocument(d).ok).toBe(true);
	});
	it("supports mixed tasks, empty items, and nested blocks", () => {
		const d = {
			_type: "zettel_doc",
			blocks: [
				{
					_type: "zettel_list",
					_key: "l",
					kind: "number",
					start: 3,
					spread: true,
					items: [
						{
							_type: "zettel_list_item",
							_key: "a",
							spread: false,
							checked: false,
							blocks: [paragraph()],
						},
						{ _type: "zettel_list_item", _key: "b", spread: false, blocks: [] },
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
			_type: "zettel_doc",
			blocks: [
				{
					_type: "zettel_table",
					_key: "t",
					align: ["left", null],
					rows: [
						{
							_type: "zettel_table_row",
							_key: "r",
							cells: [{ _type: "zettel_table_cell", _key: "c", children: [], markDefs: [] }],
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
			expect(validateDocument({ _type: "zettel_doc", blocks }).ok).toBe(false);
		const cycle: any = {};
		cycle.x = cycle;
		expect(validateDocument(cycle).ok).toBe(false);
	});
	it("registers extensions explicitly and isolates callbacks", () => {
		const d = {
			_type: "zettel_doc",
			blocks: [{ _type: "app_card", _key: "x", label: "before" }],
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
						_type: { const: "app_card" },
						_key: { type: "string" },
						label: { type: "string" },
					},
					required: ["_type", "_key", "label"],
					additionalProperties: false,
				},
			],
		});
		const check = new Ajv2020({ strict: false }).compile(schema);
		expect(
			check({
				_type: "zettel_doc",
				blocks: [
					{
						_type: "zettel_quote",
						_key: "q",
						blocks: [{ _type: "app_card", _key: "c", label: "ok" }],
					},
				],
			})
		).toBe(true);
		expect(check({ ...doc(), extra: 1 })).toBe(false);
		expect(documentSchema.$defs.extensionBlock.not).toEqual({});
	});
});
