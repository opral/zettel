import { parseFragment } from "parse5";
import { assertDocument, generateKey, validateDocument, SCHEMA_URL } from "@opral/zettel-ast";
import type {
	Block,
	Break,
	Code,
	Document,
	Extension,
	Html,
	Image,
	Inline,
	Link,
	List,
	ListItem,
	Quote,
	Rule,
	Table,
	TableCell,
	TableRow,
	TextBlock,
} from "./types.js";
import type {
	Break as AstBreak,
	Code as AstCode,
	Image as AstImage,
	InlineHtml as AstInlineHtml,
	List as AstList,
	ListItem as AstListItem,
	Quote as AstQuote,
	Rule as AstRule,
	Span as AstSpan,
	Table as AstTable,
	TextBlock as AstTextBlock,
	Html as AstHtml,
} from "@opral/zettel-ast";

const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const DECORATOR_TAGS: Record<string, string> = {
	strong: "strong",
	b: "strong",
	em: "em",
	i: "em",
	s: "strike-through",
	del: "strike-through",
	code: "code",
};
const BLOCK_TAGS = new Set([
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"blockquote",
	"pre",
	"hr",
	"table",
	"div",
	"section",
	"article",
	"header",
	"footer",
	"main",
	"aside",
]);
const INLINE_TAGS = new Set([
	"span",
	"strong",
	"b",
	"em",
	"i",
	"s",
	"del",
	"code",
	"a",
	"img",
	"br",
	"input",
]);

export type DiagnosticSeverity = "warning" | "error";
export interface Diagnostic {
	severity: DiagnosticSeverity;
	code: string;
	message: string;
	path?: string;
}

interface HtmlNode {
	nodeName?: string;
	tagName?: string;
	value?: string;
	attrs?: Array<{ name: string; value: string }>;
	childNodes?: HtmlNode[];
}
type HtmlElement = HtmlNode & { tagName: string; attrs: Array<{ name: string; value: string }> };

export interface ExtensionHandler {
	toHtml?: (value: Extension, context: { inline: boolean }) => string;
	fromHtml?: (
		element: HtmlElement,
		context: { diagnostics: Diagnostic[] }
	) => Block | Inline | null;
}
export interface HtmlExportOptions {
	allowDataImages?: boolean;
	extensions?: Record<string, ExtensionHandler>;
}
export interface HtmlImportOptions {
	allowDataImages?: boolean;
	allowedLinkProtocols?: readonly string[];
	allowedImageProtocols?: readonly string[];
	extensions?: Record<string, ExtensionHandler>;
}
export interface HtmlImportResult {
	document: Document;
	diagnostics: Diagnostic[];
}

interface ParseContext {
	usedKeys: Set<string>;
	handledCheckboxes: WeakSet<object>;
	diagnostics: Diagnostic[];
	options: HtmlImportOptions;
}

function extensionValidationOptions(options: HtmlImportOptions): {
	blocks: Record<string, () => string[]>;
	inline: Record<string, () => string[]>;
} {
	const types = Object.keys(options.extensions ?? {}).filter((type) => !type.startsWith("zettel_"));
	const validators = Object.fromEntries(types.map((type) => [type, () => [] as string[]]));
	return { blocks: validators, inline: validators };
}

/** Collect node identities while intentionally treating extension payload descendants as application data. */
function knownNodeKeys(node: unknown, keys: Set<string>): void {
	if (!node || typeof node !== "object" || Array.isArray(node)) return;
	const value = node as Record<string, unknown>;
	if (typeof value.zettel_key === "string") keys.add(value.zettel_key);
	if (typeof value.type !== "string") return;
	if (value.type === "zettel_text" || value.type === "zettel_table_cell") {
		if (Array.isArray(value.markDefs)) for (const def of value.markDefs) knownNodeKeys(def, keys);
		if (Array.isArray(value.children))
			for (const child of value.children) knownNodeKeys(child, keys);
	} else if (value.type === "zettel_table") {
		if (Array.isArray(value.rows)) for (const row of value.rows) knownNodeKeys(row, keys);
	} else if (value.type === "zettel_table_row") {
		if (Array.isArray(value.cells)) for (const cell of value.cells) knownNodeKeys(cell, keys);
	} else if (value.type === "zettel_list") {
		if (Array.isArray(value.items)) for (const item of value.items) knownNodeKeys(item, keys);
	} else if (value.type === "zettel_list_item" || value.type === "zettel_quote") {
		if (Array.isArray(value.blocks)) for (const block of value.blocks) knownNodeKeys(block, keys);
	}
}

function acceptHandlerNode(
	value: unknown,
	inline: boolean,
	context: ParseContext,
	path: string
): value is Block | Inline {
	const candidate = inline
		? {
				$schema: SCHEMA_URL,
				blocks: [
					{
						type: "zettel_text",
						zettel_key: generateKey(),
						style: "normal",
						children: [value],
						markDefs: [],
					},
				],
			}
		: { $schema: SCHEMA_URL, blocks: [value] };
	const result = validateDocument(candidate, extensionValidationOptions(context.options));
	if (!result.ok) {
		addErrorDiagnostic(
			context,
			"invalid-extension",
			`Extension handler returned an invalid ${inline ? "inline" : "block"} node: ${result.errors
				.map((error) => error.message)
				.join("; ")}`,
			path
		);
		return false;
	}
	const candidateKeys = new Set<string>();
	knownNodeKeys(value, candidateKeys);
	if ([...candidateKeys].some((key) => context.usedKeys.has(key))) {
		addErrorDiagnostic(
			context,
			"invalid-extension",
			"Extension handler returned a node with a duplicate document key.",
			path
		);
		return false;
	}
	for (const key of candidateKeys) context.usedKeys.add(key);
	return true;
}

function escapeText(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function escapeAttribute(value: string): string {
	return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function isElement(node: HtmlNode): node is HtmlElement {
	return typeof node.tagName === "string";
}
function attr(node: HtmlNode, name: string): string | undefined {
	return node.attrs?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}
function hasAttr(node: HtmlNode, name: string): boolean {
	return node.attrs?.some((item) => item.name.toLowerCase() === name.toLowerCase()) ?? false;
}
function classes(node: HtmlNode): string[] {
	return (attr(node, "class") ?? "").split(/\s+/).filter(Boolean);
}
function hasClass(node: HtmlNode, value: string): boolean {
	return classes(node).includes(value);
}
function validKey(value: string | undefined): value is string {
	return typeof value === "string" && value.length > 0 && KEY_PATTERN.test(value);
}
function addDiagnostic(context: ParseContext, code: string, message: string, path?: string): void {
	context.diagnostics.push({ severity: "warning", code, message, ...(path ? { path } : {}) });
}
function addErrorDiagnostic(
	context: ParseContext,
	code: string,
	message: string,
	path?: string
): void {
	context.diagnostics.push({ severity: "error", code, message, ...(path ? { path } : {}) });
}
function keyFor(node: HtmlNode | undefined, context: ParseContext, path: string): string {
	const candidate = attr(node ?? {}, "data-zettel-key");
	if (validKey(candidate) && !context.usedKeys.has(candidate)) {
		context.usedKeys.add(candidate);
		return candidate;
	}
	if (candidate)
		addDiagnostic(
			context,
			"invalid-key",
			`Ignored invalid or duplicate zettel key '${candidate}'.`,
			path
		);
	let key = generateKey();
	while (context.usedKeys.has(key)) key = generateKey();
	context.usedKeys.add(key);
	return key;
}
function exportKey(value: unknown): string {
	if (typeof value !== "string" || !validKey(value))
		throw new Error("Zettel HTML export requires valid zettel_key values.");
	return value;
}

function safeUrl(
	value: string,
	kind: "link" | "image",
	options: HtmlImportOptions | HtmlExportOptions
): string | undefined {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
	if (
		trimmed.startsWith("#") ||
		trimmed.startsWith("/") ||
		trimmed.startsWith("./") ||
		trimmed.startsWith("../")
	)
		return trimmed;
	const protocol = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
	if (!protocol) return trimmed;
	if (["javascript", "vbscript", "file"].includes(protocol)) return undefined;
	if (protocol === "data" && kind === "image" && options.allowDataImages) return trimmed;
	const defaults = kind === "link" ? ["http", "https", "mailto", "tel"] : ["http", "https"];
	const allowed =
		kind === "link"
			? (options as HtmlImportOptions).allowedLinkProtocols
			: (options as HtmlImportOptions).allowedImageProtocols;
	return (allowed ?? defaults).includes(protocol) ? trimmed : undefined;
}
function dataKey(key: string): string {
	return ` data-zettel-key="${escapeAttribute(exportKey(key))}"`;
}

function renderMarks(
	inner: string,
	marks: string[],
	markDefs: Link[],
	options: HtmlExportOptions
): string {
	let result = inner;
	for (const mark of [...marks].reverse()) {
		if (["strong", "em", "strike-through", "code"].includes(mark)) {
			const tag = mark === "strike-through" ? "del" : mark;
			result = `<${tag}>${result}</${tag}>`;
			continue;
		}
		const definition = markDefs.find((candidate) => candidate.zettel_key === mark);
		if (!definition) throw new Error(`Cannot export unknown inline mark '${mark}'.`);
		const href = safeUrl(definition.href, "link", options);
		const hrefAttribute = href === undefined ? "" : ` href="${escapeAttribute(href)}"`;
		const title =
			definition.title === undefined ? "" : ` title="${escapeAttribute(definition.title)}"`;
		result = `<a data-zettel-mark-key="${escapeAttribute(exportKey(definition.zettel_key))}"${hrefAttribute}${title}>${result}</a>`;
	}
	return result;
}

function renderInline(inline: Inline, markDefs: Link[], options: HtmlExportOptions): string {
	const key = exportKey(inline.zettel_key);
	const value = inline as AstSpan | AstBreak | AstImage | AstInlineHtml;
	let result: string;
	switch (value.type) {
		case "zettel_span":
			if (!value.text.length) throw new Error("Zettel span text must be nonempty.");
			result = `<span${dataKey(key)}>${escapeText(value.text)}</span>`;
			break;
		case "zettel_break":
			result = `<br${dataKey(key)}>`;
			break;
		case "zettel_image": {
			const src = safeUrl(value.src, "image", options);
			const srcAttribute = src === undefined ? "" : ` src="${escapeAttribute(src)}"`;
			const title = value.title === undefined ? "" : ` title="${escapeAttribute(value.title)}"`;
			result = `<img class="zettel_image"${dataKey(key)}${srcAttribute} alt="${escapeAttribute(value.alt)}"${title}>`;
			break;
		}
		case "zettel_html_inline":
			result = `<code class="zettel_html_inline" data-zettel-readonly="true"${dataKey(key)}>${escapeText(value.value)}</code>`;
			break;
		default: {
			const handler = options.extensions?.[inline.type];
			if (!handler?.toHtml)
				throw new Error(`No HTML extension handler registered for '${inline.type}'.`);
			result = handler.toHtml(inline as Extension, { inline: true });
			break;
		}
	}
	const marks =
		"marks" in inline && Array.isArray(inline.marks) ? (inline.marks as string[]) : value.marks;
	return renderMarks(result, marks, markDefs, options);
}

function linkMark(inline: Inline, markDefs: Link[]): string | undefined {
	const marks = "marks" in inline && Array.isArray(inline.marks) ? (inline.marks as string[]) : [];
	return marks.find((mark) => markDefs.some((definition) => definition.zettel_key === mark));
}

/** Keep a contiguous link selection in one anchor while retaining each child span. */
function renderInlineChildren(
	children: Inline[],
	markDefs: Link[],
	options: HtmlExportOptions
): string {
	let output = "";
	for (let index = 0; index < children.length; ) {
		const first = children[index];
		if (!first) break;
		const key = linkMark(first, markDefs);
		if (!key) {
			output += renderInline(first, markDefs, options);
			index += 1;
			continue;
		}
		const run: Inline[] = [first];
		index += 1;
		while (index < children.length && linkMark(children[index] as Inline, markDefs) === key) {
			run.push(children[index] as Inline);
			index += 1;
		}
		const inner = run
			.map((child) => {
				const marks =
					"marks" in child && Array.isArray(child.marks)
						? (child.marks as string[]).filter((mark) => mark !== key)
						: [];
				return renderInline({ ...child, marks } as Inline, markDefs, options);
			})
			.join("");
		output += renderMarks(inner, [key], markDefs, options);
	}
	return output;
}

function renderText(block: TextBlock, options: HtmlExportOptions): string {
	const tag = block.style === "normal" ? "p" : block.style;
	return `<${tag} class="zettel_text"${dataKey(exportKey(block.zettel_key))}>${renderInlineChildren(block.children, block.markDefs, options)}</${tag}>`;
}
function renderListItem(item: ListItem, options: HtmlExportOptions): string {
	const checked =
		item.checked === undefined ? "" : ` data-checked="${item.checked ? "true" : "false"}"`;
	const checkbox =
		item.checked === undefined
			? ""
			: `<input type="checkbox" disabled${item.checked ? " checked" : ""}>`;
	const spread = item.spread ? ' data-spread="true"' : ' data-tight="true"';
	const taskClass = item.checked === undefined ? "" : " zettel_task_item";
	return `<li class="zettel_list_item${taskClass}"${dataKey(exportKey(item.zettel_key))}${checked}${spread}>${checkbox}${item.blocks
		.map((child) => renderBlock(child, options))
		.join("")}</li>`;
}
function renderTable(table: Table, options: HtmlExportOptions): string {
	const rows = table.rows
		.map(
			(row, rowIndex) =>
				`<tr${dataKey(exportKey(row.zettel_key))}>${row.cells
					.map((cell, columnIndex) => {
						const tag = rowIndex === 0 ? "th" : "td";
						const align = table.align[columnIndex];
						const alignment = align ? ` align="${align}"` : "";
						return `<${tag}${dataKey(exportKey(cell.zettel_key))}${alignment}>${renderInlineChildren(cell.children, cell.markDefs, options)}</${tag}>`;
					})
					.join("")}</tr>`
		)
		.join("");
	const header = table.rows.length ? rows.split("</tr>")[0] + "</tr>" : "";
	const body = table.rows.length ? rows.slice(header.length) : "";
	return `<table class="zettel_table"${dataKey(exportKey(table.zettel_key))}>${header ? `<thead>${header}</thead>` : ""}${body ? `<tbody>${body}</tbody>` : ""}</table>`;
}
function renderBlock(block: Block, options: HtmlExportOptions): string {
	const key = exportKey(block.zettel_key);
	const value = block as
		| AstTextBlock
		| AstList
		| AstListItem
		| AstQuote
		| AstCode
		| AstRule
		| AstTable
		| AstHtml;
	switch (value.type) {
		case "zettel_text":
			return renderText(value, options);
		case "zettel_list": {
			const tag = value.kind === "number" ? "ol" : "ul";
			const start = value.kind === "number" ? ` start="${String(value.start ?? 1)}"` : "";
			const spread = value.spread ? ' data-spread="true"' : ' data-tight="true"';
			return `<${tag} class="zettel_list"${dataKey(key)}${start}${spread}>${value.items
				.map((item) => renderListItem(item, options))
				.join("")}</${tag}>`;
		}
		case "zettel_list_item":
			return renderListItem(value, options);
		case "zettel_quote":
			return `<blockquote class="zettel_quote"${dataKey(key)}>${value.blocks.map((child) => renderBlock(child, options)).join("")}</blockquote>`;
		case "zettel_code": {
			const language = value.language ? ` class="language-${escapeAttribute(value.language)}"` : "";
			const meta = value.meta === undefined ? "" : ` data-meta="${escapeAttribute(value.meta)}"`;
			return `<pre class="zettel_code"${dataKey(key)}><code${language}${meta}>${escapeText(value.code)}</code></pre>`;
		}
		case "zettel_rule":
			return `<hr class="zettel_rule"${dataKey(key)}>`;
		case "zettel_table":
			return renderTable(value, options);
		case "zettel_html":
			return `<pre class="zettel_html" data-zettel-readonly="true"${dataKey(key)}><code>${escapeText(value.value)}</code></pre>`;
		default: {
			const handler = options.extensions?.[block.type];
			if (!handler?.toHtml)
				throw new Error(`No HTML extension handler registered for '${block.type}'.`);
			return handler.toHtml(block as Extension, { inline: false });
		}
	}
}

export function toHtml(document: Document, options: HtmlExportOptions = {}): string {
	if (!document || !Array.isArray(document.blocks))
		throw new Error("toHtml expects a Zettel Document.");
	const blockExtensions: Record<string, (value: Record<string, unknown>) => string[]> = {};
	const inlineExtensions: Record<string, (value: Record<string, unknown>) => string[]> = {};
	for (const [type, handler] of Object.entries(options.extensions ?? {})) {
		const validate = (): string[] =>
			handler.toHtml ? [] : [`Extension '${type}' has no toHtml handler.`];
		blockExtensions[type] = validate;
		inlineExtensions[type] = validate;
	}
	assertDocument(document, { blocks: blockExtensions, inline: inlineExtensions });
	return `<div class="zettel">${document.blocks.map((block) => renderBlock(block, options)).join("")}</div>`;
}

function textContent(node: HtmlNode): string {
	if (node.nodeName === "#text") return node.value ?? "";
	return (node.childNodes ?? []).map(textContent).join("");
}
function scrubAttributes(node: HtmlElement, context: ParseContext, path: string): void {
	for (const item of node.attrs) {
		const name = item.name.toLowerCase();
		if (name.startsWith("on") || name === "style")
			addDiagnostic(context, "dropped-attribute", `Dropped unsafe ${item.name} attribute.`, path);
	}
}
function cleanRaw(node: HtmlNode): string {
	if (node.nodeName === "#text") return escapeText(node.value ?? "");
	if (!isElement(node) || node.tagName === "script" || node.tagName === "style") return "";
	const attributes = node.attrs
		.filter(
			(item) => !item.name.toLowerCase().startsWith("on") && item.name.toLowerCase() !== "style"
		)
		.map((item) => ` ${item.name}="${escapeAttribute(item.value)}"`)
		.join("");
	const voidTags = new Set([
		"area",
		"base",
		"br",
		"col",
		"embed",
		"hr",
		"img",
		"input",
		"link",
		"meta",
		"param",
		"source",
		"track",
		"wbr",
	]);
	if (voidTags.has(node.tagName)) return `<${node.tagName}${attributes}>`;
	return `<${node.tagName}${attributes}>${(node.childNodes ?? []).map(cleanRaw).join("")}</${node.tagName}>`;
}
function safeParsedUrl(
	value: string | undefined,
	kind: "link" | "image",
	context: ParseContext,
	path: string
): string | undefined {
	if (value === undefined) return undefined;
	const safe = safeUrl(value, kind, context.options);
	if (safe === undefined) addDiagnostic(context, "unsafe-url", `Dropped unsafe ${kind} URL.`, path);
	return safe;
}
function inlineMarks(node: HtmlElement, inherited: string[]): string[] {
	const marks = [...inherited];
	const mark = DECORATOR_TAGS[node.tagName];
	if (mark && !marks.includes(mark)) marks.push(mark);
	return marks;
}
function normalizeMarks(marks: string[]): string[] {
	const decorators = ["strong", "em", "strike-through", "code"];
	return [
		...marks.filter((mark) => decorators.includes(mark)),
		...marks.filter((mark) => !decorators.includes(mark)),
	];
}

function parseInlineNodes(
	nodes: HtmlNode[],
	context: ParseContext,
	markDefs: Link[],
	inherited: string[] = [],
	path = "inline"
): Inline[] {
	const result: Inline[] = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) continue;
		if (node.nodeName === "#text") {
			if (node.value)
				result.push({
					type: "zettel_span",
					zettel_key: keyFor(undefined, context, `${path}[${index}]`),
					text: node.value,
					marks: [...inherited],
				});
			continue;
		}
		if (node.nodeName === "#comment" || !isElement(node)) continue;
		const currentPath = `${path}.${node.tagName}[${index}]`;
		scrubAttributes(node, context, currentPath);
		if (node.tagName === "script" || node.tagName === "style") {
			addDiagnostic(context, "dropped-element", `Dropped <${node.tagName}> element.`, currentPath);
			continue;
		}
		const registeredExtension = context.options.extensions?.[attr(node, "data-zettel-type") ?? ""];
		if (registeredExtension?.fromHtml) {
			const value = registeredExtension.fromHtml(node, { diagnostics: context.diagnostics });
			if (value !== null && value !== undefined) {
				if (acceptHandlerNode(value, true, context, currentPath)) result.push(value as Inline);
				else
					result.push({
						type: "zettel_html_inline",
						zettel_key: keyFor(node, context, currentPath),
						value: cleanRaw(node),
						marks: [...inherited],
					});
				continue;
			}
		}
		if (node.tagName === "br") {
			result.push({
				type: "zettel_break",
				zettel_key: keyFor(node, context, currentPath),
				marks: [...inherited],
			});
			continue;
		}
		if (node.tagName === "img") {
			const src = safeParsedUrl(attr(node, "src"), "image", context, currentPath);
			if (src === undefined) {
				const alt = attr(node, "alt") ?? "";
				if (alt)
					result.push({
						type: "zettel_span",
						zettel_key: keyFor(undefined, context, currentPath),
						text: alt,
						marks: [...inherited],
					});
				continue;
			}
			result.push({
				type: "zettel_image",
				zettel_key: keyFor(node, context, currentPath),
				src,
				alt: attr(node, "alt") ?? "",
				...(attr(node, "title") !== undefined ? { title: attr(node, "title") } : {}),
				marks: [...inherited],
			});
			continue;
		}
		if (node.tagName === "input") {
			const type = (attr(node, "type") ?? "").toLowerCase();
			if (type !== "checkbox" || !context.handledCheckboxes.has(node))
				addDiagnostic(
					context,
					"dropped-control",
					`Dropped unsupported <input type="${type || "text"}"> control.`,
					currentPath
				);
			continue;
		}
		if (node.tagName === "a") {
			const href = safeParsedUrl(attr(node, "href"), "link", context, currentPath);
			let nextMarks = [...inherited];
			if (href !== undefined) {
				const supplied = attr(node, "data-zettel-mark-key");
				const title = attr(node, "title");
				const usableKey =
					validKey(supplied) && !["strong", "em", "strike-through", "code"].includes(supplied);
				const existing = usableKey
					? markDefs.find(
							(definition) =>
								definition.zettel_key === supplied &&
								definition.href === href &&
								definition.title === title
						)
					: undefined;
				let linkKey = existing?.zettel_key;
				if (!linkKey && usableKey && !context.usedKeys.has(supplied)) {
					linkKey = supplied;
					context.usedKeys.add(linkKey);
				}
				if (!linkKey) linkKey = keyFor(undefined, context, currentPath);
				if (!existing)
					markDefs.push({
						type: "zettel_link",
						zettel_key: linkKey,
						href,
						...(attr(node, "title") !== undefined ? { title: attr(node, "title") } : {}),
					});
				nextMarks.push(linkKey);
			}
			result.push(
				...parseInlineNodes(node.childNodes ?? [], context, markDefs, nextMarks, currentPath)
			);
			continue;
		}
		if (node.tagName === "span" && validKey(attr(node, "data-zettel-key"))) {
			const spanKey = keyFor(node, context, currentPath);
			const nested = parseInlineNodes(
				node.childNodes ?? [],
				context,
				markDefs,
				inlineMarks(node, inherited),
				currentPath
			);
			const first = nested[0];
			if (first && "zettel_key" in first) first.zettel_key = spanKey;
			result.push(...nested);
			continue;
		}
		if (hasClass(node, "zettel_html_inline") || attr(node, "data-zettel-readonly") === "true") {
			result.push({
				type: "zettel_html_inline",
				zettel_key: keyFor(node, context, currentPath),
				value: textContent(node),
				marks: [...inherited],
			});
			continue;
		}
		if (!INLINE_TAGS.has(node.tagName)) {
			addDiagnostic(
				context,
				"preserved-raw-html",
				`Preserved unsupported <${node.tagName}> as read-only inline HTML.`,
				currentPath
			);
			result.push({
				type: "zettel_html_inline",
				zettel_key: keyFor(node, context, currentPath),
				value: cleanRaw(node),
				marks: [...inherited],
			});
			continue;
		}
		result.push(
			...parseInlineNodes(
				node.childNodes ?? [],
				context,
				markDefs,
				inlineMarks(node, inherited),
				currentPath
			)
		);
	}
	return result.map((node) => {
		if (!("marks" in node) || !Array.isArray(node.marks)) return node;
		return { ...node, marks: normalizeMarks(node.marks as string[]) } as Inline;
	});
}

function makeTextBlock(
	node: HtmlNode,
	style: TextBlock["style"],
	context: ParseContext,
	path: string
): TextBlock {
	const markDefs: Link[] = [];
	return {
		type: "zettel_text",
		zettel_key: keyFor(node, context, path),
		style,
		children: parseInlineNodes(node.childNodes ?? [], context, markDefs, [], path),
		markDefs,
	};
}
function parseCode(node: HtmlElement, context: ParseContext, path: string): Code {
	const codeNode = (node.childNodes ?? []).find(
		(child) => isElement(child) && child.tagName === "code"
	);
	const languageClass =
		codeNode && (attr(codeNode, "class") ?? "").match(/(?:^|\s)language-([^\s]+)/)?.[1];
	const language = attr(node, "data-language") ?? languageClass;
	const meta = attr(node, "data-meta") ?? (codeNode ? attr(codeNode, "data-meta") : undefined);
	return {
		type: "zettel_code",
		zettel_key: keyFor(node, context, path),
		code: textContent(codeNode ?? node),
		...(language ? { language } : {}),
		...(meta ? { meta } : {}),
	};
}
function parseTable(node: HtmlElement, context: ParseContext, path: string): Table {
	const rows: HtmlElement[] = [];
	const visit = (current: HtmlNode): void => {
		if (isElement(current) && current.tagName === "tr") rows.push(current);
		else for (const child of current.childNodes ?? []) visit(child);
	};
	visit(node);
	const parsedRows: TableRow[] = [];
	const align: ("left" | "right" | "center" | null)[] = [];
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
		const row = rows[rowIndex];
		if (!row) continue;
		const cells: TableCell[] = [];
		for (let cellIndex = 0; cellIndex < (row.childNodes ?? []).length; cellIndex += 1) {
			const cell = row.childNodes?.[cellIndex];
			if (!cell || !isElement(cell) || !["th", "td"].includes(cell.tagName)) continue;
			const colspan = attr(cell, "colspan");
			const rowspan = attr(cell, "rowspan");
			if ((colspan !== undefined && colspan !== "1") || (rowspan !== undefined && rowspan !== "1"))
				addDiagnostic(
					context,
					"unsupported-table-span",
					"Table cell spans cannot be represented; retained cell content without the span.",
					`${path}.row[${rowIndex}].cell[${cellIndex}]`
				);
			const markDefs: Link[] = [];
			const rawAlign = (attr(cell, "align") ?? attr(cell, "data-align") ?? "").toLowerCase();
			if (rowIndex === 0)
				align.push(
					rawAlign === "left" || rawAlign === "right" || rawAlign === "center" ? rawAlign : null
				);
			cells.push({
				type: "zettel_table_cell",
				zettel_key: keyFor(cell, context, `${path}.row[${rowIndex}].cell[${cellIndex}]`),
				children: parseInlineNodes(cell.childNodes ?? [], context, markDefs, [], `${path}.cell`),
				markDefs,
			});
		}
		parsedRows.push({
			type: "zettel_table_row",
			zettel_key: keyFor(row, context, `${path}.row[${rowIndex}]`),
			cells,
		});
	}
	const width = Math.max(0, ...parsedRows.map((row) => row.cells.length));
	for (const row of parsedRows) {
		if (row.cells.length < width)
			addDiagnostic(
				context,
				"nonrectangular-table",
				"Padded a short table row with empty cells; existing content was retained.",
				path
			);
		while (row.cells.length < width)
			row.cells.push({
				type: "zettel_table_cell",
				zettel_key: keyFor(undefined, context, path),
				children: [],
				markDefs: [],
			});
	}
	while (align.length < width) align.push(null);
	return {
		type: "zettel_table",
		zettel_key: keyFor(node, context, path),
		align: align.slice(0, width),
		rows: parsedRows,
	};
}
function parseListItem(node: HtmlElement, context: ParseContext, path: string): ListItem {
	const blocks: Block[] = [];
	const inline: HtmlNode[] = [];
	const dataChecked = attr(node, "data-checked");
	let checked: boolean | undefined =
		dataChecked === "true" ? true : dataChecked === "false" ? false : undefined;
	const flush = (): void => {
		if (!inline.length) return;
		const markDefs: Link[] = [];
		const children = parseInlineNodes(inline.splice(0), context, markDefs, [], `${path}.inline`);
		if (children.length)
			blocks.push({
				type: "zettel_text",
				zettel_key: keyFor(undefined, context, path),
				style: "normal",
				children,
				markDefs,
			});
	};
	for (const child of node.childNodes ?? []) {
		if (isElement(child)) scrubAttributes(child, context, path);
		if (
			isElement(child) &&
			child.tagName === "input" &&
			(attr(child, "type") ?? "").toLowerCase() === "checkbox"
		) {
			context.handledCheckboxes.add(child);
			checked = hasAttr(child, "checked") || attr(node, "data-checked") === "true";
			continue;
		}
		if (isElement(child) && (child.tagName === "ul" || child.tagName === "ol")) {
			flush();
			blocks.push(...parseBlocks([child], context, `${path}.${child.tagName}`));
		} else if (
			isElement(child) &&
			["p", "h1", "h2", "h3", "h4", "h5", "h6"].includes(child.tagName)
		) {
			const checkbox = (child.childNodes ?? []).find(
				(n) =>
					isElement(n) &&
					n.tagName === "input" &&
					(attr(n, "type") ?? "").toLowerCase() === "checkbox"
			);
			if (checkbox) {
				context.handledCheckboxes.add(checkbox);
				if (checked === undefined) checked = hasAttr(checkbox, "checked");
			}
			flush();
			blocks.push(
				makeTextBlock(
					child,
					child.tagName === "p" ? "normal" : (child.tagName as TextBlock["style"]),
					context,
					path
				)
			);
		} else if (isElement(child) && BLOCK_TAGS.has(child.tagName)) {
			flush();
			blocks.push(...parseBlocks([child], context, path));
		} else inline.push(child);
	}
	flush();
	const explicitSpread = attr(node, "data-spread");
	const spread =
		explicitSpread === "true" ||
		(explicitSpread === undefined &&
			!hasAttr(node, "data-tight") &&
			(node.childNodes ?? []).some((child) => isElement(child) && child.tagName === "p"));
	return {
		type: "zettel_list_item",
		zettel_key: keyFor(node, context, path),
		blocks,
		spread,
		...(checked === undefined ? {} : { checked }),
	};
}
function parseList(node: HtmlElement, context: ParseContext, path: string): List {
	const kind = node.tagName === "ol" ? "number" : "bullet";
	const parsedStart = Number.parseInt(attr(node, "start") ?? "1", 10);
	const start = Number.isFinite(parsedStart) ? Math.min(999999999, Math.max(0, parsedStart)) : 1;
	if (kind === "number" && start !== parsedStart)
		addDiagnostic(
			context,
			"invalid-list-start",
			"Clamped ordered-list start to the supported range 0–999999999.",
			path
		);
	const explicitSpread = attr(node, "data-spread");
	const inferredSpread = (node.childNodes ?? []).some(
		(child) =>
			isElement(child) &&
			child.tagName === "li" &&
			(child.childNodes ?? []).some((nested) => isElement(nested) && nested.tagName === "p")
	);
	const spread =
		explicitSpread === "true" ||
		(explicitSpread === undefined && !hasAttr(node, "data-tight") && inferredSpread);
	const list: List = {
		type: "zettel_list",
		zettel_key: keyFor(node, context, path),
		kind,
		...(kind === "number" ? { start } : {}),
		spread,
		items: [],
	};
	for (const [index, child] of (node.childNodes ?? []).entries())
		if (isElement(child) && child.tagName === "li")
			list.items.push(parseListItem(child, context, `${path}.li[${index}]`));
	return list;
}

function parseBlocks(nodes: HtmlNode[], context: ParseContext, path = "blocks"): Block[] {
	const blocks: Block[] = [];
	const inlineBuffer: HtmlNode[] = [];
	const flushInline = (): void => {
		if (!inlineBuffer.length) return;
		const markDefs: Link[] = [];
		const children = parseInlineNodes(
			inlineBuffer.splice(0),
			context,
			markDefs,
			[],
			`${path}.inline`
		);
		if (children.length)
			blocks.push({
				type: "zettel_text",
				zettel_key: keyFor(undefined, context, path),
				style: "normal",
				children,
				markDefs,
			});
	};
	for (const [index, node] of nodes.entries()) {
		if (node.nodeName === "#comment") continue;
		if (node.nodeName === "#text") {
			if ((node.value ?? "").trim()) inlineBuffer.push(node);
			continue;
		}
		if (!isElement(node)) continue;
		const currentPath = `${path}.${node.tagName}[${index}]`;
		scrubAttributes(node, context, currentPath);
		if (node.tagName === "script" || node.tagName === "style") {
			flushInline();
			addDiagnostic(context, "dropped-element", `Dropped <${node.tagName}> element.`, currentPath);
			continue;
		}
		const registeredExtension = context.options.extensions?.[attr(node, "data-zettel-type") ?? ""];
		if (registeredExtension?.fromHtml) {
			flushInline();
			const value = registeredExtension.fromHtml(node, { diagnostics: context.diagnostics });
			if (value !== null && value !== undefined) {
				if (acceptHandlerNode(value, false, context, currentPath)) blocks.push(value as Block);
				else
					blocks.push({
						type: "zettel_html",
						zettel_key: keyFor(node, context, currentPath),
						value: cleanRaw(node),
					});
				continue;
			}
		}
		if (hasClass(node, "zettel_html")) {
			flushInline();
			blocks.push({
				type: "zettel_html",
				zettel_key: keyFor(node, context, currentPath),
				value: textContent(node),
			});
			continue;
		}
		if (node.tagName === "p" || /^h[1-6]$/.test(node.tagName)) {
			flushInline();
			blocks.push(
				makeTextBlock(
					node,
					node.tagName === "p" ? "normal" : (node.tagName as TextBlock["style"]),
					context,
					currentPath
				)
			);
			continue;
		}
		if (node.tagName === "ul" || node.tagName === "ol") {
			flushInline();
			const list = parseList(node, context, currentPath);
			if (!list.items.length) {
				addDiagnostic(
					context,
					"invalid-list",
					"Preserved an empty list as read-only HTML.",
					currentPath
				);
				blocks.push({ type: "zettel_html", zettel_key: list.zettel_key, value: cleanRaw(node) });
			} else blocks.push(list);
			continue;
		}
		if (node.tagName === "blockquote") {
			flushInline();
			blocks.push({
				type: "zettel_quote",
				zettel_key: keyFor(node, context, currentPath),
				blocks: parseBlocks(node.childNodes ?? [], context, currentPath),
			});
			continue;
		}
		if (node.tagName === "pre") {
			flushInline();
			blocks.push(parseCode(node, context, currentPath));
			continue;
		}
		if (node.tagName === "hr") {
			flushInline();
			blocks.push({ type: "zettel_rule", zettel_key: keyFor(node, context, currentPath) });
			continue;
		}
		if (node.tagName === "table") {
			flushInline();
			const table = parseTable(node, context, currentPath);
			if (!table.rows.length || !table.rows[0]?.cells.length) {
				addDiagnostic(
					context,
					"invalid-table",
					"Preserved an empty table as read-only HTML.",
					currentPath
				);
				blocks.push({ type: "zettel_html", zettel_key: table.zettel_key, value: cleanRaw(node) });
			} else blocks.push(table);
			continue;
		}
		if (["div", "section", "article", "header", "footer", "main", "aside"].includes(node.tagName)) {
			flushInline();
			blocks.push(...parseBlocks(node.childNodes ?? [], context, currentPath));
			continue;
		}
		if (INLINE_TAGS.has(node.tagName)) {
			inlineBuffer.push(node);
			continue;
		}
		flushInline();
		const source = cleanRaw(node);
		if (source) {
			addDiagnostic(
				context,
				"preserved-raw-html",
				`Preserved unsupported <${node.tagName}> as read-only HTML.`,
				currentPath
			);
			blocks.push({
				type: "zettel_html",
				zettel_key: keyFor(node, context, currentPath),
				value: source,
			});
		}
	}
	flushInline();
	return blocks;
}

export function importHtml(html: string, options: HtmlImportOptions = {}): HtmlImportResult {
	if (typeof html !== "string") throw new TypeError("importHtml expects an HTML string.");
	const diagnostics: Diagnostic[] = [];
	const context: ParseContext = {
		usedKeys: new Set(),
		handledCheckboxes: new WeakSet(),
		diagnostics,
		options,
	};
	const fragment = parseFragment(html) as unknown as HtmlNode;
	const roots = fragment.childNodes ?? [];
	const wrapper = roots.find((node) => isElement(node) && hasClass(node, "zettel"));
	const source =
		wrapper && isElement(wrapper)
			? roots.flatMap((node) => (node === wrapper ? (wrapper.childNodes ?? []) : [node]))
			: roots;
	const document = { $schema: SCHEMA_URL, blocks: parseBlocks(source, context) } as Document;
	// Importers must never return an invalid Document, even when a handler or
	// a future parser change violates an invariant not caught locally.
	assertDocument(document, extensionValidationOptions(options));
	return { document, diagnostics };
}

export function fromHtml(html: string, options: HtmlImportOptions = {}): Document {
	return importHtml(html, options).document;
}
