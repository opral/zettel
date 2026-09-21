export { documentSchema } from "./schema.js";
export type {
	Block,
	BulletList,
	CheckList,
	CodeBlock,
	CoreBlock,
	CoreDocument,
	Decorator,
	Document,
	ExtensionBlock,
	ExtensionInline,
	ExtensionNode,
	Inline,
	Link,
	Mark,
	NumberList,
	RuleBlock,
	Span,
	TextBlock,
	ZettelList,
	ZettelListItem,
	ZettelQuote,
} from "./schema.js";
export { generateKey, validateDocument } from "./validate.js";
export type {
	ExtensionValidator,
	ValidationError,
	ValidationOptions,
	ValidationResult,
} from "./validate.js";
