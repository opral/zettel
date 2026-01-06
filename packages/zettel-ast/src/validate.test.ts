import { expect, test, vi } from "vitest";

const exampleDoc = {
	type: "zettel_doc",
	content: [
		{
			type: "zettel_text_block",
			zettel_key: "4ee4134378b1",
			style: "zettel_normal",
			children: [
				{
					type: "zettel_span",
					zettel_key: "e60571e00344",
					text: "Hello world",
					marks: [],
				},
			],
		},
	],
};

test("compiles lazily on first validate call", async () => {
	vi.resetModules();
	const { TypeCompiler } = await import("@sinclair/typebox/compiler");
	const compileSpy = vi.spyOn(TypeCompiler, "Compile");
	const { validate } = await import("./validate.js");

	expect(compileSpy).not.toHaveBeenCalled();
	validate(exampleDoc);
	expect(compileSpy).toHaveBeenCalledTimes(1);

	compileSpy.mockRestore();
});

test("falls back to dynamic checks when compile is blocked", async () => {
	vi.resetModules();
	const { TypeCompiler } = await import("@sinclair/typebox/compiler");
	const compileSpy = vi
		.spyOn(TypeCompiler, "Compile")
		.mockImplementation(() => {
			throw new Error("Eval disabled");
		});
	const { validate } = await import("./validate.js");

	const result = validate(exampleDoc);

	expect(compileSpy).toHaveBeenCalledTimes(1);
	expect(result.errors).toBeUndefined();

	compileSpy.mockRestore();
});
