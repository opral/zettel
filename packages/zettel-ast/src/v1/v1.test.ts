import { TypeCompiler } from "@sinclair/typebox/compiler";
import { test, expect } from "vitest";
import {
	documentSchema,
	generateKey,
	validateDocument,
	type Document,
	type CoreDocument,
	type BulletList,
	type NumberList,
} from "./index.js";

const paragraph = (key = "p", text = "hello"): Document["blocks"][number] => ({
	_type: "block",
	_key: key,
	style: "normal",
	markDefs: [],
	children: [{ _type: "span", _key: `${key}_span`, text, marks: [] }],
});

test("accepts an empty document, paragraph, quote, and code block", () => {
	const document = {
		format: "zettel",
		version: 1,
		blocks: [
			{ _type: "block", _key: "empty", style: "normal", markDefs: [], children: [] },
			{ _type: "zettel_quote", _key: "quote", blocks: [] },
			{ _type: "code", _key: "code", code: "" },
		],
	};
	expect(validateDocument(document)).toEqual({ ok: true, errors: [] });
});

test("validates shared block-local links and rejects multiple links on one span", () => {
	const document = {
		format: "zettel",
		version: 1,
		blocks: [
			{
				_type: "block",
				_key: "p",
				style: "normal",
				markDefs: [{ _type: "link", _key: "link", href: "https://example.com" }],
				children: [
					{ _type: "span", _key: "a", text: "one", marks: ["link"] },
					{ _type: "span", _key: "b", text: "two", marks: ["strong", "link"] },
				],
			},
		],
	};
	expect(validateDocument(document).ok).toBe(true);
	expect(
		validateDocument({
			...document,
			blocks: [
				{
					...document.blocks[0],
					markDefs: [
						{ _type: "link", _key: "link", href: "https://example.com" },
						{ _type: "link", _key: "other", href: "https://example.org" },
					],
					children: [{ _type: "span", _key: "a", text: "one", marks: ["link", "other"] }],
				},
			],
		}).ok
	).toBe(false);
});

test("validates list variants and nested container blocks", () => {
	const document = {
		format: "zettel",
		version: 1,
		blocks: [
			{
				_type: "zettel_list",
				_key: "list",
				kind: "number",
				start: 0,
				items: [{ _type: "zettel_list_item", _key: "item", blocks: [paragraph("nested")] }],
			},
			{
				_type: "zettel_list",
				_key: "checklist",
				kind: "check",
				items: [
					{
						_type: "zettel_list_item",
						_key: "checked",
						blocks: [paragraph("todo")],
						checked: false,
					},
				],
			},
		],
	};
	expect(validateDocument(document).ok).toBe(true);
	expect(
		validateDocument({
			...document,
			blocks: [{ ...document.blocks[0], kind: "bullet", start: 1 }],
		}).ok
	).toBe(false);
});

test("rejects unknown fields, CR prose, duplicate keys, and malformed values", () => {
	const source = paragraph("same");
	const malformed = {
		format: "zettel",
		version: 1,
		blocks: [
			{
				...source,
				extra: true,
				children: [{ _type: "span", _key: "same", text: "bad\rtext", marks: [] }],
			},
			42,
		],
	};
	const result = validateDocument(malformed);
	expect(result.ok).toBe(false);
	expect(result.errors.some((error) => error.path.includes("extra"))).toBe(true);
	expect(result.errors.some((error) => error.path.includes("text"))).toBe(true);
	expect(result.errors.some((error) => error.message.includes("duplicate"))).toBe(true);
	expect(validateDocument(null).ok).toBe(false);
	expect(validateDocument({ format: "zettel", version: 1, blocks: [new Date()] }).ok).toBe(false);
});

test("runs registered extension validators and preserves the input", () => {
	const document = {
		format: "zettel",
		version: 1,
		blocks: [
			{
				_type: "app_card",
				_key: "card",
				value: "A",
			},
			{
				_type: "block",
				_key: "p",
				style: "normal",
				markDefs: [],
				children: [{ _type: "app_mention", _key: "mention", id: "u1" }],
			},
		],
	};
	const before = JSON.stringify(document);
	expect(
		validateDocument(document, {
			blocks: { app_card: (node) => (typeof node.value === "string" ? [] : ["value required"]) },
			inline: { app_mention: (node) => (typeof node.id === "string" ? [] : ["id required"]) },
		}).ok
	).toBe(true);
	expect(JSON.stringify(document)).toBe(before);
	expect(validateDocument(document, { blocks: { app_card: () => ["bad"] } }).ok).toBe(false);
	expect(validateDocument(document, { blocks: { zettel_bad: () => [] } }).ok).toBe(false);
});

test("core schema and validator agree on a representative core document", () => {
	const document = {
		format: "zettel",
		version: 1,
		blocks: [paragraph("p")],
	};
	const schemaValidator = TypeCompiler.Compile(documentSchema);
	expect(schemaValidator.Check(document)).toBe(true);
	expect(validateDocument(document).ok).toBe(true);
});

test("generateKey returns accepted, distinct keys", () => {
	const keys = new Set(Array.from({ length: 20 }, () => generateKey()));
	expect(keys.size).toBe(20);
	for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
});

test("extension callbacks cannot mutate source identity or nested payload", () => {
	const source = {
		format: "zettel",
		version: 1,
		blocks: [{ _type: "app_card", _key: "original", payload: { title: "Original" } }],
	};
	const before = structuredClone(source);
	const result = validateDocument(source, {
		blocks: {
			app_card(node) {
				node._key = "changed";
				node._type = "zettel_rule";
				(node.payload as { title: string }).title = "Changed";
				return [];
			},
		},
	});
	expect(result.ok).toBe(true);
	expect(source).toEqual(before);
});

test("rejects JavaScript shapes that JSON serialization would change", () => {
	const hidden = Object.defineProperty({}, "format", { value: "zettel", enumerable: false });
	Object.assign(hidden, { version: 1, blocks: [] });
	expect(validateDocument(hidden).ok).toBe(false);
	let getterCalled = false;
	const accessor = {
		get format() {
			getterCalled = true;
			return "zettel";
		},
		version: 1,
		blocks: [],
	};
	expect(validateDocument(accessor).ok).toBe(false);
	expect(getterCalled).toBe(false);
	const array: unknown[] & { extra?: boolean } = [];
	array.extra = true;
	expect(validateDocument({ format: "zettel", version: 1, blocks: array }).ok).toBe(false);
	expect(validateDocument({ format: "zettel", version: 1, blocks: new Array(1) }).ok).toBe(false);
});

test("does not read required fields from a polluted Object.prototype", () => {
	const names = [
		"_type",
		"format",
		"version",
		"blocks",
		"children",
		"markDefs",
		"marks",
		"items",
		"checked",
	] as const;
	const originals = new Map(
		names.map((name) => [name, Object.getOwnPropertyDescriptor(Object.prototype, name)])
	);
	try {
		for (const [name, value] of [
			["_type", "block"],
			["format", "zettel"],
			["version", 1],
			["blocks", []],
			["children", []],
			["markDefs", []],
			["marks", []],
			["items", []],
			["checked", true],
		] as const) {
			Object.defineProperty(Object.prototype, name, {
				value,
				writable: true,
				configurable: true,
				enumerable: false,
			});
		}

		expect(validateDocument({}).ok).toBe(false);
		expect(
			validateDocument({
				format: "zettel",
				version: 1,
				blocks: [{ _type: "block", _key: "p", style: "normal" }],
			}).ok
		).toBe(false);
		expect(
			validateDocument({
				format: "zettel",
				version: 1,
				blocks: [{ _key: "p", style: "normal", markDefs: [], children: [] }],
			}).ok
		).toBe(false);
		expect(
			validateDocument({
				format: "zettel",
				version: 1,
				blocks: [
					{
						_type: "block",
						_key: "p",
						style: "normal",
						markDefs: [],
						children: [{ _type: "span", _key: "s", text: "x" }],
					},
				],
			}).ok
		).toBe(false);
		expect(
			validateDocument({
				format: "zettel",
				version: 1,
				blocks: [
					{
						_type: "zettel_list",
						_key: "list",
						kind: "check",
						items: [{ _type: "zettel_list_item", _key: "item" }],
					},
				],
			}).ok
		).toBe(false);
	} finally {
		for (const name of names) {
			const descriptor = originals.get(name);
			if (descriptor) Object.defineProperty(Object.prototype, name, descriptor);
			else delete (Object.prototype as Record<string, unknown>)[name];
		}
	}
});

test("core TypeScript types reject nested atoms and non-check checked state", () => {
	const inline: CoreDocument = {
		format: "zettel",
		version: 1,
		blocks: [
			{
				_type: "block",
				_key: "p",
				style: "normal",
				markDefs: [],
				children: [
					// @ts-expect-error CoreDocument has no application inline atoms.
					{ _type: "app_mention", _key: "m", accountId: "a" },
				],
			},
		],
	};
	const quote: CoreDocument = {
		format: "zettel",
		version: 1,
		blocks: [
			{
				_type: "zettel_quote",
				_key: "q",
				blocks: [
					// @ts-expect-error Nested core blocks cannot be extension atoms.
					{ _type: "app_card", _key: "c" },
				],
			},
		],
	};
	const bullet: BulletList = {
		_type: "zettel_list",
		_key: "b",
		kind: "bullet",
		items: [
			{
				_type: "zettel_list_item",
				_key: "i",
				blocks: [],
				// @ts-expect-error Only check items carry checked.
				checked: true,
			},
		],
	};
	const number: NumberList = {
		_type: "zettel_list",
		_key: "n",
		kind: "number",
		start: 1,
		items: [
			{
				_type: "zettel_list_item",
				_key: "j",
				blocks: [],
				// @ts-expect-error Only check items carry checked.
				checked: false,
			},
		],
	};
	expect(validateDocument(inline).ok).toBe(false);
	expect(validateDocument(quote).ok).toBe(false);
	expect(validateDocument({ format: "zettel", version: 1, blocks: [bullet, number] }).ok).toBe(
		false
	);
});
