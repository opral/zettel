import { describe, expect, it } from "vitest";
import type { CoreBlock } from "./schema.js";

describe("core-only recursive types", () => {
	it("keeps extension atoms out of core descendants at compile time", () => {
		const core: CoreBlock = {
			_type: "zettel_block",
			_key: "p",
			style: "normal",
			markDefs: [],
			children: [],
		};
		expect(core._type).toBe("zettel_block");
	});

	// These assignments are intentionally compile-time fixtures. The recursive
	// CoreBlock aliases must reject application atoms in every container.
	const badInline: CoreBlock = {
		_type: "zettel_block",
		_key: "p",
		style: "normal",
		markDefs: [],
		// @ts-expect-error extension inline atom is not a CoreInline child
		children: [{ _type: "app_mention", _key: "m", label: "x" }],
	};
	const badNested: CoreBlock = {
		_type: "zettel_list",
		_key: "l",
		kind: "bullet",
		spread: false,
		items: [{
			_type: "zettel_list_item",
			_key: "i",
			spread: false,
			// @ts-expect-error extension block atom is not a CoreBlock list descendant
			blocks: [{ _type: "app_card", _key: "c", label: "x" }],
		}],
	};

	void badInline;
	void badNested;
});
