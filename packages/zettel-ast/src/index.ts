export * from "./schema.js";
export * from "./validate.js";
import { SCHEMA_URL, type Block, type Document } from "./schema.js";
export function generateKey(): string {
	return globalThis.crypto.randomUUID();
}
export function createDocument(blocks: Block[] = []): Document {
	return { $schema: SCHEMA_URL, blocks };
}
