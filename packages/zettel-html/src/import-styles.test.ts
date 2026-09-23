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
		const [paragraph] = importHtml(`<p><span style="${style}">x</span></p>`).document
			.blocks as TextBlock[];
		expect((paragraph!.children[0] as any).marks, style).toEqual(["strong"]);
	}
	const [paragraph] = importHtml('<p><b style="font-weight:normal">x</b></p>').document
		.blocks as TextBlock[];
	expect((paragraph!.children[0] as any).marks).toEqual([]);
});

test("a <br> between copied paragraphs is a blank line, not a block holding a hard break", () => {
	const html =
		'<b style="font-weight:normal;" id="docs-internal-guid-1234"><p dir="ltr"><span>First</span></p><br><p dir="ltr"><span>Second</span></p></b><br class="Apple-interchange-newline">';
	const blocks = importHtml(html).document.blocks as any[];
	expect(JSON.stringify(blocks)).not.toContain("zettel_break");
	expect(
		blocks.filter((block) => block.children?.length).map((block) => block.children[0].text)
	).toEqual(["First", "Second"]);
	// The trailing Apple-interchange-newline is clipboard framing, not content.
	expect(blocks.at(-1).children.map((child: any) => child.text)).toEqual(["Second"]);
});

test("words copied from inside one Google Docs paragraph do not paste as bold", () => {
	// No <p> inside the wrapper, so it is inline formatting: <b> with
	// font-weight:normal, which must not become the strong mark.
	const html =
		'<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-9f"><span style="font-size:11pt;font-family:Arial;font-weight:400;">a few plain words</span></b>';
	const [paragraph] = importHtml(html).document.blocks as TextBlock[];
	expect(paragraph!.children.map((child: any) => [child.text, child.marks])).toEqual([
		["a few plain words", []],
	]);
});

function marksOf(html: string): Array<[string, string[]]> {
	const result = importHtml(html);
	expect(validateDocument(result.document).ok).toBe(true);
	const [paragraph] = result.document.blocks as TextBlock[];
	return paragraph!.children.map((child: any) => [child.text, child.marks]);
}

test("an explicit normal style cancels the bold or italic of an ancestor tag", () => {
	expect(marksOf('<p><b>bold <span style="font-weight:400">plain</span></b></p>')).toEqual([
		["bold ", ["strong"]],
		["plain", []],
	]);
	expect(marksOf('<p><i>it <span style="font-style:normal">upright</span></i></p>')).toEqual([
		["it ", ["em"]],
		["upright", []],
	]);
	expect(
		marksOf(
			'<p><span style="font-weight:300">light</span> <span style="font-style:oblique 10deg">slanted</span></p>'
		)
	).toEqual([
		["light", []],
		[" ", []],
		["slanted", ["em"]],
	]);
});

test("text-decoration styles map to underline and strike-through", () => {
	expect(
		marksOf(
			'<p><span style="text-decoration:underline">u</span><span style="text-decoration-line: underline line-through">both</span><u style="text-decoration:none">not</u><u><span style="text-decoration:none">still</span></u></p>'
		)
	).toEqual([
		["u", ["underline"]],
		["both", ["strike-through", "underline"]],
		["not", []],
		// Decorations propagate in CSS: a child's `none` cannot remove its parent's line.
		["still", ["underline"]],
	]);
});

test("Google Docs' underline styling on links is not an underline mark", () => {
	const result = importHtml(
		'<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><a href="https://example.com" style="text-decoration:none;"><span style="font-size:11pt;color:#1155cc;font-weight:400;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;">a link</span></a><span style="text-decoration:underline;"> underlined</span></p></b>'
	);
	const [paragraph] = result.document.blocks as TextBlock[];
	const [link] = paragraph!.markDefs;
	expect(paragraph!.children.map((child: any) => [child.text, child.marks])).toEqual([
		["a link", [link!._key]],
		[" underlined", ["underline"]],
	]);
	// An explicit <u> inside a link is still the author's underline.
	expect(marksOf('<p><a href="https://example.com"><u>u</u></a></p>')[0]![1]).toContain(
		"underline"
	);
});

test("Google Docs headings keep their text unbolded and empty paragraphs become empty blocks", () => {
	const html =
		'<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-2">' +
		'<h1 dir="ltr" style="line-height:1.38;margin-top:20pt;"><span style="font-size:20pt;font-family:Arial;font-weight:400;">Title</span></h1>' +
		'<p dir="ltr"><span style="font-weight:400;">One</span></p><br><br><p dir="ltr"><span style="font-weight:700;">Two</span></p>' +
		'</b><br class="Apple-interchange-newline">';
	const blocks = importHtml(html).document.blocks as TextBlock[];
	expect(
		blocks.map((block) => [
			block.style,
			block.children.map((child: any) => [child.text, child.marks]),
		])
	).toEqual([
		["h1", [["Title", []]]],
		["normal", [["One", []]]],
		["normal", []],
		["normal", []],
		["normal", [["Two", ["strong"]]]],
	]);
});

test("a trailing Apple-interchange-newline after inline content is not a hard break", () => {
	expect(marksOf('<span>words</span><br class="Apple-interchange-newline">')).toEqual([
		["words", []],
	]);
});
