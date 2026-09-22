export * from "./schema.js";
export * from "./validate.js";
import { type Block, type Document } from "./schema.js";
export function generateKey(): string {
	return globalThis.crypto.randomUUID();
}
export function createDocument(blocks: Block[] = []): Document {
	return { _type: "zettel_doc", blocks };
}
