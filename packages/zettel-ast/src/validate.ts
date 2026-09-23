import { Ajv2020 } from "ajv/dist/2020.js";
import { createDocumentSchema, documentSchema, type Document } from "./schema.js";
export interface ValidationError {
	path: string;
	message: string;
}
export interface ValidationResult {
	ok: boolean;
	errors: ValidationError[];
}
export type ExtensionValidator = (node: Record<string, unknown>) => string[];
export interface ValidationOptions {
	blocks?: Record<string, ExtensionValidator>;
	inline?: Record<string, ExtensionValidator>;
}
const ajv = new Ajv2020({
	allErrors: false,
	strict: false,
	ownProperties: true,
	addUsedSchema: false,
});
const core = ajv.compile(documentSchema);
const decorators = new Set(["strong", "em", "underline", "strike-through", "code"]);
function jsonData(v: unknown, ancestors = new Set<object>()): boolean {
	if (v === null || typeof v === "string" || typeof v === "boolean") return true;
	if (typeof v === "number") return Number.isFinite(v);
	if (typeof v !== "object" || ancestors.has(v)) return false;
	const array = Array.isArray(v);
	if (!array && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
		return false;
	ancestors.add(v);
	const keys = Reflect.ownKeys(v);
	if (array && keys.length !== v.length + 1) return false;
	for (const k of keys) {
		if (array && k === "length") continue;
		if (typeof k !== "string" || (array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)))
			return false;
		const d = Object.getOwnPropertyDescriptor(v, k);
		if (!d?.enumerable || !("value" in d) || !jsonData(d.value, ancestors)) return false;
	}
	ancestors.delete(v);
	return true;
}
export function validateDocument(
	value: unknown,
	options: ValidationOptions = {}
): ValidationResult {
	const errors: ValidationError[] = [];
	const error = (path: string, message: string): void => {
		errors.push({ path, message });
	};
	try {
		if (!jsonData(value))
			return {
				ok: false,
				errors: [
					{
						path: "$",
						message:
							"Must contain only plain JSON data (no accessors, cycles, hidden properties, or sparse arrays)",
					},
				],
			};
		const extensionSchemas: {
			blocks: Record<string, unknown>[];
			inline: Record<string, unknown>[];
		} = { blocks: [], inline: [] };
		for (const kind of ["blocks", "inline"] as const) {
			for (const [type, callback] of Object.entries(options[kind] ?? {})) {
				if (!type || type.startsWith("zettel_") || typeof callback !== "function")
					error(`options.${kind}.${type}`, "Invalid or reserved extension registration");
				else extensionSchemas[kind].push({ type: "object", properties: { _type: { const: type } } });
			}
		}
		if (errors.length) return { ok: false, errors };
		const shape =
			extensionSchemas.blocks.length || extensionSchemas.inline.length
				? ajv.compile(createDocumentSchema(extensionSchemas))
				: core;
		if (!shape(value))
			return {
				ok: false,
				errors: (shape.errors ?? []).map((e) => ({
					path: e.instancePath || "$",
					message: e.message ?? "Invalid structure",
				})),
			};
		const keys = new Set<string>();
		const register = (n: any, path: string): void => {
			if (keys.has(n._key)) error(`${path}._key`, "Duplicate document key");
			keys.add(n._key);
		};
		const visit = (n: any, path: string, kind: "blocks" | "inline" = "blocks"): void => {
			register(n, path);
			if (!n._type.startsWith("zettel_")) {
				const callback = options[kind]?.[n._type];
				if (!callback) {
					error(path, "Unregistered extension");
					return;
				}
				const result = callback(structuredClone(n));
				if (!Array.isArray(result) || result.some((m) => typeof m !== "string"))
					error(path, "Extension callback must return string[]");
				else for (const message of result) error(path, message);
				return;
			}
			if (n._type === "zettel_block" || n._type === "zettel_table_cell") {
				const refs = new Set<string>();
				n.markDefs.forEach((def: any, i: number) => {
					register(def, `${path}.markDefs[${i}]`);
					refs.add(def._key);
					if (decorators.has(def._key)) error(path, "Annotation key collides with decorator");
				});
				n.children.forEach((child: any, i: number) => {
					const childPath = `${path}.children[${i}]`;
					if (child._type.startsWith("zettel_")) {
						const marks: string[] = child.marks;
						if (new Set(marks).size !== marks.length) error(childPath, "Duplicate mark");
						if (marks.filter((m) => refs.has(m)).length > 1)
							error(childPath, "At most one link annotation per inline node");
						for (const mark of marks)
							if (!decorators.has(mark) && !refs.has(mark))
								error(childPath, `Unresolved mark '${mark}'`);
					}
					visit(child, childPath, "inline");
				});
			} else if (n._type === "zettel_table") {
				n.rows.forEach((row: any, i: number) => {
					register(row, `${path}.rows[${i}]`);
					if (row.cells.length !== n.align.length)
						error(path, "Table must be rectangular and match alignment width");
					row.cells.forEach((cell: any, j: number) =>
						visit(cell, `${path}.rows[${i}].cells[${j}]`)
					);
				});
			} else if (n._type === "zettel_list")
				n.items.forEach((item: any, i: number) => visit(item, `${path}.items[${i}]`));
			else if (n._type === "zettel_list_item" || n._type === "zettel_quote")
				n.blocks.forEach((block: any, i: number) => visit(block, `${path}.blocks[${i}]`));
		};
		(value as Document).blocks.forEach((n, i) => visit(n, `$.blocks[${i}]`));
	} catch {
		error("$", "Malformed document or extension validator threw");
	}
	return { ok: errors.length === 0, errors };
}
export function assertDocument(
	value: unknown,
	options?: ValidationOptions
): asserts value is Document {
	const result = validateDocument(value, options);
	if (!result.ok)
		throw new Error(
			`Invalid Zettel document: ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
		);
}
