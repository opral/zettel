import { Type } from "@sinclair/typebox";

/** The key format used by every node in a Zettel v1 document. */
const ZettelV1KeyPattern = "^[A-Za-z0-9_-]+$";

/**
 * The JSON schema describes the core document.  Extension nodes are
 * deliberately not part of this schema: they are checked by
 * `validateDocument` using the callbacks supplied by the caller.
 */
const KeySchema = Type.String({
	pattern: ZettelV1KeyPattern,
	minLength: 1,
	description: "A document-wide unique ASCII node key",
});

const SpanSchema = Type.Object(
	{
		_type: Type.Literal("span"),
		_key: KeySchema,
		text: Type.String({
			minLength: 1,
			pattern: "^[^\\r]*$",
			description: "Non-empty prose; LF is the hard-break character",
		}),
		marks: Type.Array(Type.String()),
	},
	{ additionalProperties: false }
);

const LinkSchema = Type.Object(
	{
		_type: Type.Literal("link"),
		_key: KeySchema,
		href: Type.String({ minLength: 1 }),
		title: Type.Optional(Type.String()),
	},
	{ additionalProperties: false }
);

const TextBlockSchema = Type.Object(
	{
		_type: Type.Literal("block"),
		_key: KeySchema,
		style: Type.Union([
			Type.Literal("normal"),
			Type.Literal("h1"),
			Type.Literal("h2"),
			Type.Literal("h3"),
			Type.Literal("h4"),
			Type.Literal("h5"),
			Type.Literal("h6"),
		]),
		children: Type.Array(SpanSchema),
		markDefs: Type.Array(LinkSchema),
	},
	{ additionalProperties: false }
);

/**
 * Recursive because list items and quotes contain blocks.  The recursive
 * schema still describes core blocks only; extensions are an opt-in runtime
 * concern handled by the validator.
 */
const CoreBlockJsonSchema = Type.Recursive((Block) => {
	const ListItem = (checked: boolean) =>
		Type.Object(
			checked
				? {
						_type: Type.Literal("zettel_list_item"),
						_key: KeySchema,
						blocks: Type.Array(Block, { minItems: 1 }),
						checked: Type.Boolean(),
					}
				: {
						_type: Type.Literal("zettel_list_item"),
						_key: KeySchema,
						blocks: Type.Array(Block, { minItems: 1 }),
					},
			{ additionalProperties: false }
		);

	const List = (kind: "bullet" | "number" | "check") =>
		kind === "number"
			? Type.Object(
					{
						_type: Type.Literal("zettel_list"),
						_key: KeySchema,
						kind: Type.Literal("number"),
						start: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
						items: Type.Array(ListItem(false), { minItems: 1 }),
					},
					{ additionalProperties: false }
				)
			: Type.Object(
					{
						_type: Type.Literal("zettel_list"),
						_key: KeySchema,
						kind: Type.Literal(kind),
						items: Type.Array(ListItem(kind === "check"), { minItems: 1 }),
					},
					{ additionalProperties: false }
				);

	const Quote = Type.Object(
		{
			_type: Type.Literal("zettel_quote"),
			_key: KeySchema,
			blocks: Type.Array(Block),
		},
		{ additionalProperties: false }
	);

	const Code = Type.Object(
		{
			_type: Type.Literal("code"),
			_key: KeySchema,
			code: Type.String(),
			language: Type.Optional(Type.String()),
		},
		{ additionalProperties: false }
	);

	const Rule = Type.Object(
		{
			_type: Type.Literal("zettel_rule"),
			_key: KeySchema,
		},
		{ additionalProperties: false }
	);

	return Type.Union([
		TextBlockSchema,
		List("bullet"),
		List("number"),
		List("check"),
		Quote,
		Code,
		Rule,
	]);
});

/** Core v1 envelope schema. */
const ZettelV1JsonSchema = Type.Object(
	{
		format: Type.Literal("zettel"),
		version: Type.Literal(1),
		blocks: Type.Array(CoreBlockJsonSchema),
	},
	{ additionalProperties: false }
);

/** Core v1 JSON Schema, including the recursive container vocabulary. */
export const documentSchema = ZettelV1JsonSchema;

export interface Span {
	_type: "span";
	_key: string;
	text: string;
	marks: string[];
}

export interface Link {
	_type: "link";
	_key: string;
	href: string;
	title?: string;
}

export type Decorator = "strong" | "em" | "strike-through" | "underline" | "code";
export type Mark = Decorator | string;

export interface TextBlock {
	_type: "block";
	_key: string;
	style: "normal" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
	children: Inline[];
	markDefs: Link[];
}

export interface ZettelListItem {
	_type: "zettel_list_item";
	_key: string;
	blocks: Block[];
}

export interface BulletList {
	_type: "zettel_list";
	_key: string;
	kind: "bullet";
	items: Array<ZettelListItem & { checked?: never }>;
}

export interface NumberList {
	_type: "zettel_list";
	_key: string;
	kind: "number";
	start: number;
	items: Array<ZettelListItem & { checked?: never }>;
}

export interface CheckList {
	_type: "zettel_list";
	_key: string;
	kind: "check";
	items: Array<ZettelListItem & { checked: boolean }>;
}

export type ZettelList = BulletList | NumberList | CheckList;

export interface ZettelQuote {
	_type: "zettel_quote";
	_key: string;
	blocks: Block[];
}

export interface CodeBlock {
	_type: "code";
	_key: string;
	code: string;
	language?: string;
}

export interface RuleBlock {
	_type: "zettel_rule";
	_key: string;
}

type CoreListItem = Omit<ZettelListItem, "blocks"> & { blocks: CoreBlock[] };
type CoreList =
	| (Omit<BulletList, "items"> & { items: Array<CoreListItem & { checked?: never }> })
	| (Omit<NumberList, "items"> & { items: Array<CoreListItem & { checked?: never }> })
	| (Omit<CheckList, "items"> & { items: Array<CoreListItem & { checked: boolean }> });
/** Core-only recursively, including inline children and nested containers. */
export type CoreBlock =
	| (Omit<TextBlock, "children"> & { children: Span[] })
	| CoreList
	| (Omit<ZettelQuote, "blocks"> & { blocks: CoreBlock[] })
	| CodeBlock
	| RuleBlock;

export interface CoreDocument {
	format: "zettel";
	version: 1;
	blocks: CoreBlock[];
}

/** Record shape used by extension callbacks. */
export interface ExtensionNode extends Record<string, unknown> {
	_type: string;
	_key: string;
}

export type ExtensionInline = ExtensionNode;
export type ExtensionBlock = ExtensionNode;
export type Inline = Span | ExtensionInline;

export type Block = TextBlock | ZettelList | ZettelQuote | CodeBlock | RuleBlock | ExtensionBlock;

export interface Document {
	format: "zettel";
	version: 1;
	blocks: Block[];
}
