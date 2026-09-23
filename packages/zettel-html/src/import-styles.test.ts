import { test, expect } from "vitest";
import { validateDocument, type TextBlock } from "@opral/zettel-ast";
import { importHtml } from "./html.js";

// What Google Docs puts on the clipboard: every run is a <span> whose
// formatting lives in its style attribute, inside a
// <b style="font-weight:normal" id="docs-internal-guid-…"> wrapper.
const googleDocs =
	'<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234">' +
	'<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">' +
	'<span style="font-size:11pt;font-family:Arial;font-weight:700;">Bold</span>' +
	'<span style="font-size:11pt;font-family:Arial;font-weight:400;"> plain </span>' +
	'<span style="font-size:11pt;font-style:italic;">italic</span>' +
	'<span style="font-size:11pt;text-decoration:line-through;"> struck</span>' +
	"</p></b>";

test("Google Docs' styled spans keep bold, italic and strike-through", () => {
	const result = importHtml(googleDocs);
	expect(validateDocument(result.document).ok).toBe(true);
	const [paragraph] = result.document.blocks as TextBlock[];
	expect(paragraph!.children.map((child: any) => [child.text, child.marks])).toEqual([
		["Bold", ["strong"]],
		[" plain ", []],
		["italic", ["em"]],
		[" struck", ["strike-through"]],
	]);
});

test("font-weight on a span imports as strong; the wrapper's font-weight:normal does not", () => {
	for (const style of ["font-weight:bold", "font-weight: 600", "font-weight:700"]) {
		const [paragraph] = importHtml(`<p><span style="${style}">x</span></p>`).document.blocks as TextBlock[];
		expect((paragraph!.children[0] as any).marks, style).toEqual(["strong"]);
	}
	const [paragraph] = importHtml('<p><b style="font-weight:normal">x</b></p>').document.blocks as TextBlock[];
	expect((paragraph!.children[0] as any).marks).toEqual([]);
});

test("a <br> between copied paragraphs is a blank line, not a block holding a hard break", () => {
	const html =
		'<b style="font-weight:normal;" id="docs-internal-guid-1234"><p dir="ltr"><span>First</span></p><br><p dir="ltr"><span>Second</span></p></b><br class="Apple-interchange-newline">';
	const blocks = importHtml(html).document.blocks as any[];
	expect(JSON.stringify(blocks)).not.toContain("zettel_break");
	expect(blocks.filter((block) => block.children?.length).map((block) => block.children[0].text)).toEqual(["First", "Second"]);
	// The trailing Apple-interchange-newline is clipboard framing, not content.
	expect(blocks.at(-1).children.map((child: any) => child.text)).toEqual(["Second"]);
});

test("words copied from inside one Google Docs paragraph do not paste as bold", () => {
	// No <p> inside the wrapper, so it is inline formatting: <b> with
	// font-weight:normal, which must not become the strong mark.
	const html =
		'<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-9f"><span style="font-size:11pt;font-family:Arial;font-weight:400;">a few plain words</span></b>';
	const [paragraph] = importHtml(html).document.blocks as TextBlock[];
	expect(paragraph!.children.map((child: any) => [child.text, child.marks])).toEqual([["a few plain words", []]]);
});
