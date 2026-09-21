import { describe, expect, it } from "vitest";
import type { CoreBlock } from "./schema.js";

describe("core-only recursive types", () => {
	it("keeps extension atoms out of core descendants at compile time", () => {
		const core: CoreBlock = {
			type: "zettel_text",
			zettel_key: "p",
			style: "normal",
			markDefs: [],
			children: [],
		};
		expect(core.type).toBe("zettel_text");
	});

	// These assignments are intentionally compile-time fixtures. The recursive
	// CoreBlock aliases must reject application atoms in every container.
	const badInline: CoreBlock = {
		type: "zettel_text",
		zettel_key: "p",
		style: "normal",
		markDefs: [],
		// @ts-expect-error extension inline atom is not a CoreInline child
		children: [{ type: "app_mention", zettel_key: "m", label: "x" }],
	};
	const badNested: CoreBlock = {
		type: "zettel_list",
		zettel_key: "l",
		kind: "bullet",
		spread: false,
		items: [{
			type: "zettel_list_item",
			zettel_key: "i",
			spread: false,
			// @ts-expect-error extension block atom is not a CoreBlock list descendant
			blocks: [{ type: "app_card", zettel_key: "c", label: "x" }],
		}],
	};

	void badInline;
	void badNested;
});
