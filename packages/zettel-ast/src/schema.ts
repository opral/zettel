/** Versioned identifier; schema publication is separate from package installation. */
export const SCHEMA_URL = "https://zettel.dev/schema/1/schema.json";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Node {
	type: string;
	zettel_key: string;
}
export interface Link extends Node {
	type: "zettel_link";
	href: string;
	title?: string;
}
export interface Span extends Node {
	type: "zettel_span";
	text: string;
	marks: string[];
}
export interface Break extends Node {
	type: "zettel_break";
	marks: string[];
}
export interface Image extends Node {
	type: "zettel_image";
	src: string;
	alt: string;
	title?: string;
	marks: string[];
}
export interface InlineHtml extends Node {
	type: "zettel_html_inline";
	value: string;
	marks: string[];
}
export interface Extension extends Node {
	[key: string]: Json;
}
export type Inline = Span | Break | Image | InlineHtml | Extension;
export interface TextBlock extends Node {
	type: "zettel_text";
	style: "normal" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
	children: Inline[];
	markDefs: Link[];
}
export interface ListItem extends Node {
	type: "zettel_list_item";
	blocks: Block[];
	spread: boolean;
	checked?: boolean;
}
export interface List extends Node {
	type: "zettel_list";
	kind: "bullet" | "number";
	start?: number;
	spread: boolean;
	items: ListItem[];
}
export interface Quote extends Node {
	type: "zettel_quote";
	blocks: Block[];
}
export interface Code extends Node {
	type: "zettel_code";
	code: string;
	language?: string;
	meta?: string;
}
export interface Rule extends Node {
	type: "zettel_rule";
}
export interface TableCell extends Node {
	type: "zettel_table_cell";
	children: Inline[];
	markDefs: Link[];
}
export interface TableRow extends Node {
	type: "zettel_table_row";
	cells: TableCell[];
}
export interface Table extends Node {
	type: "zettel_table";
	align: ("left" | "right" | "center" | null)[];
	rows: TableRow[];
}
export interface Html extends Node {
	type: "zettel_html";
	value: string;
}
export type CoreInline = Span | Break | Image | InlineHtml;
/** Core-only recursive variants. The ordinary node types remain extension-capable. */
export interface CoreTextBlock extends Node {
	type: "zettel_text";
	style: TextBlock["style"];
	children: CoreInline[];
	markDefs: Link[];
}
export interface CoreListItem extends Node {
	type: "zettel_list_item";
	blocks: CoreBlock[];
	spread: boolean;
	checked?: boolean;
}
export interface CoreList extends Node {
	type: "zettel_list";
	kind: "bullet" | "number";
	start?: number;
	spread: boolean;
	items: CoreListItem[];
}
export interface CoreQuote extends Node {
	type: "zettel_quote";
	blocks: CoreBlock[];
}
export interface CoreTableCell extends Node {
	type: "zettel_table_cell";
	children: CoreInline[];
	markDefs: Link[];
}
export interface CoreTableRow extends Node {
	type: "zettel_table_row";
	cells: CoreTableCell[];
}
export interface CoreTable extends Node {
	type: "zettel_table";
	align: Table["align"];
	rows: CoreTableRow[];
}
export type CoreBlock = CoreTextBlock | CoreList | CoreQuote | Code | Rule | CoreTable | Html;
/** Extension-capable block union used by Document and ordinary node types. */
export type Block = TextBlock | List | Quote | Code | Rule | Table | Html | Extension;
export interface Document {
	$schema: typeof SCHEMA_URL;
	blocks: Block[];
}
export type JsonSchema = Record<string, any>;
const str = { type: "string" };
const arr = (items: JsonSchema, minItems = 0): JsonSchema => ({ type: "array", items, minItems });
const ref = (name: string): JsonSchema => ({ $ref: `#/$defs/${name}` });
const marks = arr(str);
const object = (properties: JsonSchema, required = Object.keys(properties)): JsonSchema => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});
const node = (type: string, props: JsonSchema = {}, optional: string[] = []): JsonSchema =>
	object(
		{
			type: { const: type },
			zettel_key: { type: "string", pattern: "^[A-Za-z0-9_-]+$" },
			...props,
		},
		["type", "zettel_key", ...Object.keys(props).filter((k) => !optional.includes(k))]
	);
/** Shape schema; validateDocument additionally checks identity and references. */
export const documentSchema: JsonSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: SCHEMA_URL,
	title: "Zettel document",
	description:
		"Canonical GFM document. Node keys are document-unique; marks reference definitions local to a text block or table cell.",
	...object({ $schema: { const: SCHEMA_URL }, blocks: arr(ref("block")) }),
	$defs: {
		link: node("zettel_link", { href: str, title: str }, ["title"]),
		span: node("zettel_span", { text: { type: "string", minLength: 1 }, marks }),
		break: node("zettel_break", { marks }),
		image: node("zettel_image", { src: str, alt: str, title: str, marks }, ["title"]),
		inlineHtml: node("zettel_html_inline", { value: str, marks }),
		text: node("zettel_text", {
			style: { enum: ["normal", "h1", "h2", "h3", "h4", "h5", "h6"] },
			children: arr(ref("inline")),
			markDefs: arr(ref("link")),
		}),
		listItem: node(
			"zettel_list_item",
			{ blocks: arr(ref("block")), spread: { type: "boolean" }, checked: { type: "boolean" } },
			["checked"]
		),
		list: {
			...node(
				"zettel_list",
				{
					kind: { enum: ["bullet", "number"] },
					start: { type: "integer", minimum: 0, maximum: 999999999 },
					spread: { type: "boolean" },
					items: arr(ref("listItem"), 1),
				},
				["start"]
			),
			allOf: [
				{
					if: { properties: { kind: { const: "number" } }, required: ["kind"] },
					then: { required: ["start"] },
					else: { not: { required: ["start"] } },
				},
			],
		},
		quote: node("zettel_quote", { blocks: arr(ref("block")) }),
		code: node("zettel_code", { code: str, language: str, meta: str }, ["language", "meta"]),
		rule: node("zettel_rule"),
		tableCell: node("zettel_table_cell", {
			children: arr(ref("inline")),
			markDefs: arr(ref("link")),
		}),
		tableRow: node("zettel_table_row", { cells: arr(ref("tableCell"), 1) }),
		table: node("zettel_table", {
			align: arr({ enum: ["left", "right", "center", null] }, 1),
			rows: arr(ref("tableRow"), 1),
		}),
		html: node("zettel_html", { value: str }),
		inline: { anyOf: ["span", "break", "image", "inlineHtml", "extensionInline"].map(ref) },
		block: {
			anyOf: ["text", "list", "quote", "code", "rule", "table", "html", "extensionBlock"].map(ref),
		},
		extensionInline: { not: {} },
		extensionBlock: { not: {} },
	},
};
const descriptions: Record<string, string> = {
	text: "Paragraph or heading; annotations are local to this block.",
	span: "Nonempty text run. Marks are decorators or local link keys. LF is a soft break.",
	break: "Explicit hard line break, distinct from a soft newline in text.",
	image: "Inline image; marks allow linked images. Asset storage is outside the format.",
	inlineHtml:
		"Literal inline HTML source, preserved for Markdown and displayed inertly by default.",
	link: "Shared annotation referenced by its zettel_key from inline marks.",
	list: "Explicit list container; numbered lists require start. spread denotes loose layout.",
	listItem: "One item owns all its blocks. checked is present only for task items.",
	quote: "An ordered sequence of blocks inside a quotation.",
	code: "Literal code with optional fence language and metadata.",
	rule: "Thematic break.",
	table: "Rectangular GFM table; first row is header. align has one entry per column.",
	tableRow: "One ordered row of table cells.",
	tableCell: "Inline table content with local annotation definitions.",
	html: "Literal HTML block source. Rendering is inert by default.",
	extensionInline: "Application-defined inline nodes; disabled in the core schema.",
	extensionBlock: "Application-defined blocks; disabled in the core schema.",
};
for (const [name, description] of Object.entries(descriptions))
	documentSchema.$defs[name].description = description;
documentSchema.examples = [
	{
		$schema: SCHEMA_URL,
		blocks: [
			{
				type: "zettel_text",
				zettel_key: "p1",
				style: "normal",
				markDefs: [],
				children: [{ type: "zettel_span", zettel_key: "s1", text: "Hello, world.", marks: [] }],
			},
		],
	},
];
/** Replace only explicit extension slots, including recursive occurrences. */
export function createDocumentSchema(
	extensions: { blocks?: JsonSchema[]; inline?: JsonSchema[] } = {}
): JsonSchema {
	const schema = structuredClone(documentSchema);
	for (const [slot, values] of [
		["extensionBlock", extensions.blocks],
		["extensionInline", extensions.inline],
	] as const) {
		if (values?.length)
			schema.$defs[slot] = {
				allOf: [
					{
						type: "object",
						required: ["type", "zettel_key"],
						properties: {
							type: { type: "string", not: { pattern: "^zettel_" } },
							zettel_key: { type: "string", pattern: "^[A-Za-z0-9_-]+$" },
						},
					},
					{ anyOf: values },
				],
			};
	}
	return schema;
}
