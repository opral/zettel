import type { Document } from "./schema.js";

export type ExtensionValidator = (node: Record<string, unknown>) => string[];

export interface ValidationOptions {
	inline?: Record<string, ExtensionValidator>;
	blocks?: Record<string, ExtensionValidator>;
}

export interface ValidationError {
	path: string;
	message: string;
}

export interface ValidationResult {
	ok: boolean;
	errors: ValidationError[];
}

const CORE_TYPES = new Set([
	"block",
	"span",
	"link",
	"zettel_list",
	"zettel_list_item",
	"zettel_quote",
	"code",
	"zettel_rule",
]);
const DECORATORS = new Set(["strong", "em", "strike-through", "underline", "code"]);
const KEY_RE = /^[A-Za-z0-9_-]+$/;
const ALLOWED_ROOT_FIELDS = new Set(["format", "version", "blocks"]);
const ALLOWED_BLOCK_FIELDS = new Set(["_type", "_key", "style", "children", "markDefs"]);
const ALLOWED_LINK_FIELDS = new Set(["_type", "_key", "href", "title"]);
const ALLOWED_SPAN_FIELDS = new Set(["_type", "_key", "text", "marks"]);
const ALLOWED_LIST_FIELDS = new Set(["_type", "_key", "kind", "start", "items"]);
const ALLOWED_ITEM_FIELDS = new Set(["_type", "_key", "blocks", "checked"]);
const ALLOWED_QUOTE_FIELDS = new Set(["_type", "_key", "blocks"]);
const ALLOWED_CODE_FIELDS = new Set(["_type", "_key", "code", "language"]);
const ALLOWED_RULE_FIELDS = new Set(["_type", "_key"]);

interface State {
	errors: ValidationError[];
	keys: Set<string>;
	options: NormalizedOptions;
}

interface NormalizedOptions {
	inline: Record<string, ExtensionValidator>;
	blocks: Record<string, ExtensionValidator>;
}

function emptyOptions(): NormalizedOptions {
	return {
		inline: Object.create(null) as Record<string, ExtensionValidator>,
		blocks: Object.create(null) as Record<string, ExtensionValidator>,
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function addError(state: State, path: string, message: string): void {
	state.errors.push({ path, message });
}

function exactFields(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	path: string,
	state: State
): void {
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") {
			addError(state, path, "property names must be strings");
		} else if (!allowed.has(key)) {
			addError(state, `${path}.${key}`, "unknown field");
		}
	}
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function requireString(
	value: Record<string, unknown>,
	key: string,
	path: string,
	state: State,
	options: { nonEmpty?: boolean; noCarriageReturn?: boolean } = {}
): string | undefined {
	const childPath = `${path}.${key}`;
	if (!hasOwn(value, key) || typeof value[key] !== "string") {
		addError(state, childPath, "must be a string");
		return undefined;
	}
	const result = value[key] as string;
	if (options.nonEmpty && result.length === 0) addError(state, childPath, "must be non-empty");
	if (options.noCarriageReturn && result.includes("\r")) {
		addError(state, childPath, "must use LF for hard breaks and must not contain CR");
	}
	return result;
}

function registerKey(
	value: Record<string, unknown>,
	path: string,
	state: State
): string | undefined {
	const key = requireString(value, "_key", path, state, { nonEmpty: true });
	if (key === undefined) return undefined;
	if (!KEY_RE.test(key)) {
		addError(state, `${path}._key`, "must match [A-Za-z0-9_-]+");
		return undefined;
	}
	if (state.keys.has(key)) addError(state, `${path}._key`, `duplicate document key '${key}'`);
	else state.keys.add(key);
	return key;
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object" || seen.has(value)) return false;
	if (!Array.isArray(value) && !isPlainObject(value)) return false;
	seen.add(value);
	const keys = Reflect.ownKeys(value);
	if (Array.isArray(value) && keys.length !== value.length + 1) return false;
	for (const key of keys) {
		if (Array.isArray(value) && key === "length") continue;
		if (typeof key !== "string") return false;
		if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
			return false;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (
			!descriptor ||
			!descriptor.enumerable ||
			!("value" in descriptor) ||
			!isJsonValue(descriptor.value, seen)
		)
			return false;
	}
	seen.delete(value);
	return true;
}

function validateOptions(options: ValidationOptions | undefined, state: State): void {
	if (options === undefined) return;
	if (!isPlainObject(options)) {
		addError(state, "options", "must be a plain object");
		return;
	}
	for (const field of Reflect.ownKeys(options)) {
		if (field !== "inline" && field !== "blocks") {
			addError(state, `options.${String(field)}`, "unknown option");
		}
	}
	const normalized = emptyOptions();
	for (const kind of ["inline", "blocks"] as const) {
		if (!hasOwn(options, kind)) continue;
		const mapping = options[kind];
		if (!isPlainObject(mapping)) {
			addError(state, `options.${kind}`, "must be a plain object");
			continue;
		}
		for (const type of Reflect.ownKeys(mapping)) {
			if (typeof type !== "string") {
				addError(state, `options.${kind}`, "extension names must be strings");
				continue;
			}
			if (CORE_TYPES.has(type) || type.startsWith("zettel_")) {
				addError(
					state,
					`options.${kind}.${type}`,
					"cannot override a core or reserved zettel_ type"
				);
				continue;
			}
			const validator = mapping[type];
			if (typeof validator !== "function") {
				addError(state, `options.${kind}.${type}`, "must be a validation callback");
				continue;
			}
			normalized[kind][type] = validator as ExtensionValidator;
		}
	}
	state.options = normalized;
}

function extensionTypeIsReserved(type: string): boolean {
	return CORE_TYPES.has(type) || type.startsWith("zettel_");
}

function validateExtension(
	value: Record<string, unknown>,
	path: string,
	state: State,
	kind: "inline" | "blocks"
): void {
	const type = requireString(value, "_type", path, state, { nonEmpty: true });
	registerKey(value, path, state);
	if (type === undefined) return;
	if (extensionTypeIsReserved(type)) {
		addError(state, `${path}._type`, "core and reserved zettel_ types cannot be extensions");
		return;
	}
	const callback = state.options[kind][type];
	if (!callback) {
		addError(state, `${path}._type`, `unsupported ${kind} extension '${type}'`);
		return;
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || !isJsonValue(value[key])) {
			addError(state, path, "extension payload must contain only plain JSON values");
			break;
		}
	}
	try {
		const callbackErrors = callback(structuredClone(value));
		if (!Array.isArray(callbackErrors)) {
			addError(state, path, "extension validation callback must return string[]");
			return;
		}
		for (const message of callbackErrors) {
			if (typeof message === "string")
				addError(state, path, message || "extension payload is invalid");
			else addError(state, path, "extension validation callback returned a non-string error");
		}
	} catch {
		addError(state, path, "extension validation callback threw");
	}
}

function validateLink(
	value: unknown,
	path: string,
	state: State,
	linkKeys: Map<string, string>
): void {
	if (!isPlainObject(value)) {
		addError(state, path, "must be a plain object");
		return;
	}
	exactFields(value, ALLOWED_LINK_FIELDS, path, state);
	const type = requireString(value, "_type", path, state);
	if (type !== "link") addError(state, `${path}._type`, "must be 'link'");
	const key = registerKey(value, path, state);
	if (key !== undefined) {
		if (DECORATORS.has(key)) addError(state, `${path}._key`, "must not equal a decorator name");
		else linkKeys.set(key, path);
	}
	requireString(value, "href", path, state, { nonEmpty: true });
	if (hasOwn(value, "title") && typeof value.title !== "string")
		addError(state, `${path}.title`, "must be a string");
}

function validateSpan(
	value: unknown,
	path: string,
	state: State,
	links: ReadonlyMap<string, string>
): void {
	if (!isPlainObject(value)) {
		addError(state, path, "must be a plain object");
		return;
	}
	exactFields(value, ALLOWED_SPAN_FIELDS, path, state);
	const type = requireString(value, "_type", path, state);
	if (type !== "span") addError(state, `${path}._type`, "must be 'span'");
	registerKey(value, path, state);
	const text = requireString(value, "text", path, state, {
		nonEmpty: true,
		noCarriageReturn: true,
	});
	if (text !== undefined && text.length === 0) addError(state, `${path}.text`, "must be non-empty");
	if (!hasOwn(value, "marks") || !Array.isArray(value.marks)) {
		addError(state, `${path}.marks`, "must be an array");
		return;
	}
	const seen = new Set<string>();
	let linkCount = 0;
	for (let index = 0; index < value.marks.length; index++) {
		const markPath = `${path}.marks[${index}]`;
		const mark = value.marks[index];
		if (typeof mark !== "string") {
			addError(state, markPath, "must be a string");
			continue;
		}
		if (seen.has(mark)) addError(state, markPath, "duplicate mark");
		seen.add(mark);
		if (DECORATORS.has(mark)) continue;
		if (links.has(mark)) {
			linkCount++;
			if (linkCount > 1) addError(state, markPath, "a span may have at most one link annotation");
		} else {
			addError(state, markPath, "must be a decorator or a link key from this block");
		}
	}
}

function validateListItem(
	value: unknown,
	path: string,
	kind: "bullet" | "number" | "check",
	state: State
): void {
	if (!isPlainObject(value)) {
		addError(state, path, "must be a plain object");
		return;
	}
	exactFields(value, ALLOWED_ITEM_FIELDS, path, state);
	const type = requireString(value, "_type", path, state);
	if (type !== "zettel_list_item") addError(state, `${path}._type`, "must be 'zettel_list_item'");
	registerKey(value, path, state);
	if (!hasOwn(value, "blocks") || !Array.isArray(value.blocks)) {
		addError(state, `${path}.blocks`, "must be a non-empty array");
	} else if (value.blocks.length === 0) {
		addError(state, `${path}.blocks`, "must be a non-empty array");
	} else {
		for (let index = 0; index < value.blocks.length; index++) {
			validateBlock(value.blocks[index], `${path}.blocks[${index}]`, state, true);
		}
	}
	if (kind === "check") {
		if (!hasOwn(value, "checked") || typeof value.checked !== "boolean")
			addError(state, `${path}.checked`, "must be a boolean for checklist items");
	} else if (hasOwn(value, "checked")) {
		addError(state, `${path}.checked`, "is only allowed for checklist items");
	}
}

function validateTextBlock(value: Record<string, unknown>, path: string, state: State): void {
	exactFields(value, ALLOWED_BLOCK_FIELDS, path, state);
	const type = requireString(value, "_type", path, state);
	if (type !== "block") addError(state, `${path}._type`, "must be 'block'");
	registerKey(value, path, state);
	const style = requireString(value, "style", path, state);
	if (style !== undefined && !/^(normal|h[1-6])$/.test(style))
		addError(state, `${path}.style`, "must be normal or h1 through h6");
	if (!hasOwn(value, "markDefs") || !Array.isArray(value.markDefs)) {
		addError(state, `${path}.markDefs`, "must be an array");
	}
	const linkKeys = new Map<string, string>();
	if (hasOwn(value, "markDefs") && Array.isArray(value.markDefs)) {
		for (let index = 0; index < value.markDefs.length; index++) {
			validateLink(value.markDefs[index], `${path}.markDefs[${index}]`, state, linkKeys);
		}
	}
	if (!hasOwn(value, "children") || !Array.isArray(value.children)) {
		addError(state, `${path}.children`, "must be an array");
		return;
	}
	for (let index = 0; index < value.children.length; index++) {
		validateInline(value.children[index], `${path}.children[${index}]`, state, linkKeys);
	}
}

function validateInline(
	value: unknown,
	path: string,
	state: State,
	links: ReadonlyMap<string, string>
): void {
	if (!isPlainObject(value)) {
		addError(state, path, "must be a plain object");
		return;
	}
	const type = hasOwn(value, "_type") && typeof value._type === "string" ? value._type : undefined;
	if (type === "span") {
		validateSpan(value, path, state, links);
	} else if (type !== undefined && state.options.inline[type]) {
		validateExtension(value, path, state, "inline");
	} else {
		addError(state, `${path}._type`, "must be 'span' or a registered inline extension");
	}
}

function validateBlock(value: unknown, path: string, state: State, allowExtensions: boolean): void {
	if (!isPlainObject(value)) {
		addError(state, path, "must be a plain object");
		return;
	}
	const type = hasOwn(value, "_type") && typeof value._type === "string" ? value._type : undefined;
	if (type === "block") {
		validateTextBlock(value, path, state);
		return;
	}
	if (type === "zettel_list") {
		exactFields(value, ALLOWED_LIST_FIELDS, path, state);
		registerKey(value, path, state);
		const kind = requireString(value, "kind", path, state);
		if (kind !== "bullet" && kind !== "number" && kind !== "check") {
			addError(state, `${path}.kind`, "must be bullet, number, or check");
			return;
		}
		if (kind === "number") {
			if (
				!hasOwn(value, "start") ||
				typeof value.start !== "number" ||
				!Number.isInteger(value.start)
			) {
				addError(state, `${path}.start`, "must be an integer for numbered lists");
			} else if (value.start < 0 || value.start > 2_147_483_647) {
				addError(state, `${path}.start`, "must be between 0 and 2147483647");
			}
		} else if (hasOwn(value, "start")) {
			addError(state, `${path}.start`, "is only allowed for numbered lists");
		}
		if (!hasOwn(value, "items") || !Array.isArray(value.items)) {
			addError(state, `${path}.items`, "must be a non-empty array");
		} else if (value.items.length === 0) {
			addError(state, `${path}.items`, "must be a non-empty array");
		} else {
			for (let index = 0; index < value.items.length; index++) {
				validateListItem(value.items[index], `${path}.items[${index}]`, kind, state);
			}
		}
		return;
	}
	if (type === "zettel_quote") {
		exactFields(value, ALLOWED_QUOTE_FIELDS, path, state);
		registerKey(value, path, state);
		if (!hasOwn(value, "blocks") || !Array.isArray(value.blocks)) {
			addError(state, `${path}.blocks`, "must be an array");
		} else {
			for (let index = 0; index < value.blocks.length; index++) {
				validateBlock(value.blocks[index], `${path}.blocks[${index}]`, state, true);
			}
		}
		return;
	}
	if (type === "code") {
		exactFields(value, ALLOWED_CODE_FIELDS, path, state);
		registerKey(value, path, state);
		requireString(value, "code", path, state);
		if (hasOwn(value, "language") && typeof value.language !== "string")
			addError(state, `${path}.language`, "must be a string");
		return;
	}
	if (type === "zettel_rule") {
		exactFields(value, ALLOWED_RULE_FIELDS, path, state);
		registerKey(value, path, state);
		return;
	}
	if (type !== undefined && allowExtensions && state.options.blocks[type]) {
		validateExtension(value, path, state, "blocks");
		return;
	}
	if (type !== undefined && extensionTypeIsReserved(type)) {
		addError(state, `${path}._type`, "core and reserved zettel_ types cannot be extensions");
	} else {
		addError(state, `${path}._type`, "must be a core block or a registered block extension");
	}
}

/** Generates a collision-resistant key accepted by the v1 key grammar. */
export function generateKey(): string {
	const randomUUID = globalThis.crypto?.randomUUID;
	if (typeof randomUUID !== "function") {
		throw new Error("Secure random UUID generation is unavailable in this runtime");
	}
	return randomUUID.call(globalThis.crypto);
}

/**
 * Validate a v1 document without coercing, defaulting, stripping, or
 * mutating its input. Malformed values and extension callbacks are converted
 * into ordinary validation errors rather than escaping as exceptions.
 */
export function validateDocument(value: unknown, options?: ValidationOptions): ValidationResult {
	const state: State = { errors: [], keys: new Set<string>(), options: emptyOptions() };
	try {
		validateOptions(options, state);
		if (!isJsonValue(value)) {
			addError(
				state,
				"$",
				"document must contain only plain JSON data, without cycles, accessors, hidden fields, or sparse arrays"
			);
			return { ok: false, errors: state.errors };
		}
		if (!isPlainObject(value)) {
			addError(state, "$", "document must be a plain object");
			return { ok: false, errors: state.errors };
		}
		exactFields(value, new Set(["format", "version", "blocks"]), "$", state);
		if (!hasOwn(value, "format") || value.format !== "zettel")
			addError(state, "$.format", "must be 'zettel'");
		if (!hasOwn(value, "version") || value.version !== 1)
			addError(state, "$.version", "must be 1");
		if (!hasOwn(value, "blocks") || !Array.isArray(value.blocks)) {
			addError(state, "$.blocks", "must be an array");
		} else {
			for (let index = 0; index < value.blocks.length; index++) {
				validateBlock(value.blocks[index], `$.blocks[${index}]`, state, true);
			}
		}
	} catch {
		addError(state, "$", "document contains an unreadable or malformed value");
	}
	return state.errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors: state.errors };
}
