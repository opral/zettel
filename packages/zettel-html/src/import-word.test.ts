import { test, expect } from "vitest";
import { validateDocument, type Block, type Document } from "@opral/zettel-ast";
import { importHtml } from "./html.js";

// Clipboard HTML from Word desktop (Windows and macOS) and Outlook. Word
// writes a whole HTML document: Office namespace tags (<o:p>, <st1:*>,
// <w:*>), conditional comments, `mso-*` styles, lines wrapped at ~80
// columns, and lists as paragraphs whose bullet is literal text in a
// `mso-list:Ignore` span.

/**
 * Blocks as `[style, [[text, marks]]]`; lists as `[kind, items]` where each
 * item is the outline of its blocks.
 */
function outline(blocks: Block[]): unknown[] {
	return blocks.map((block: any) => {
		if (block._type === "zettel_block")
			return [
				block.style,
				block.children.map((child: any) => [
					child._type === "zettel_span"
						? child.text
						: child._type === "zettel_break"
							? "<br>"
							: child._type,
					child.marks,
				]),
			];
		if (block._type === "zettel_list")
			return [
				block.kind === "number" ? `number:${block.start}` : "bullet",
				block.items.map((item: any) => outline(item.blocks)),
			];
		return [block._type];
	});
}
function importWord(html: string): { blocks: unknown[]; document: Document; json: string } {
	const result = importHtml(html);
	expect(validateDocument(result.document).ok).toBe(true);
	expect(result.diagnostics.filter((d) => d.code === "preserved-raw-html")).toEqual([]);
	const json = JSON.stringify(result.document);
	// Nothing Word-specific may reach the document.
	expect(json).not.toContain("zettel_html");
	expect(json).not.toMatch(/o:p|mso-|\[if|endif|supportLists/);
	return { blocks: outline(result.document.blocks), document: result.document, json };
}

/** A Word for Windows clipboard document around a fragment, as a browser hands it to paste. */
function wordDocument(fragment: string): string {
	return `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"
xmlns="http://www.w3.org/TR/REC-html40">

<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=ProgId content=Word.Document>
<meta name=Generator content="Microsoft Word 15">
<meta name=Originator content="Microsoft Word 15">
<link rel=File-List
href="file:///C:/Users/sam/AppData/Local/Temp/msohtmlclip1/01/clip_filelist.xml">
<!--[if gte mso 9]><xml>
 <o:OfficeDocumentSettings>
  <o:AllowPNG/>
 </o:OfficeDocumentSettings>
</xml><![endif]--><!--[if gte mso 9]><xml>
 <w:WordDocument>
  <w:View>Normal</w:View>
  <w:Zoom>0</w:Zoom>
 </w:WordDocument>
</xml><![endif]-->
<style>
<!--
 /* Font Definitions */
 @font-face
	{font-family:Symbol;
	panose-1:5 5 1 2 1 7 6 2 5 7;
	mso-font-charset:2;}
 /* Style Definitions */
 p.MsoNormal, li.MsoNormal, div.MsoNormal
	{mso-style-unhide:no;
	mso-style-qformat:yes;
	margin:0cm;
	font-size:12.0pt;
	font-family:"Aptos",sans-serif;}
 /* List Definitions */
 @list l0:level1
	{mso-level-number-format:bullet;
	mso-level-text:\\F0B7;}
-->
</style>
<!--[if gte mso 10]>
<style>
 /* Style Definitions */
 table.MsoNormalTable
	{mso-style-name:"Table Normal";}
</style>
<![endif]-->
</head>

<body lang=EN-US style='tab-interval:36.0pt;word-wrap:break-word'>
<!--StartFragment-->

${fragment}

<!--EndFragment-->
</body>

</html>`;
}

const bullet = (marker: string, font: string) =>
	`<![if !supportLists]><span style='font-family:${font};mso-fareast-font-family:${font};mso-bidi-font-family:${font}'><span
style='mso-list:Ignore'>${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
</span></span></span><![endif]>`;
const numbered = (marker: string) =>
	`<![if !supportLists]><span style='mso-bidi-font-family:Aptos'><span
style='mso-list:Ignore'>${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
</span></span></span><![endif]>`;

test("Word desktop: <o:p> paragraph marks are dropped, not kept as read-only inline HTML", () => {
	const { blocks } = importWord(
		wordDocument(`<p class=MsoNormal>Hello <b>bold</b><o:p></o:p></p>`)
	);
	expect(blocks).toEqual([
		[
			"normal",
			[
				["Hello ", []],
				["bold", ["strong"]],
			],
		],
	]);
});

test("Word desktop: bare fragment without the document wrapper", () => {
	const { blocks } = importWord(`<p class=MsoNormal>Hello <b>bold</b><o:p></o:p></p>`);
	expect(blocks).toEqual([
		[
			"normal",
			[
				["Hello ", []],
				["bold", ["strong"]],
			],
		],
	]);
});

test("Word desktop: an empty paragraph (<o:p>&nbsp;</o:p>) is an empty paragraph", () => {
	const { blocks } = importWord(
		wordDocument(
			`<p class=MsoNormal>First<o:p></o:p></p>

<p class=MsoNormal><o:p>&nbsp;</o:p></p>

<p class=MsoNormal>Second<o:p></o:p></p>`
		)
	);
	expect(blocks).toEqual([
		["normal", [["First", []]]],
		["normal", []],
		["normal", [["Second", []]]],
	]);
});

test("Word desktop: runs, smart tags and wrapped lines import as clean text", () => {
	const { blocks } = importWord(
		wordDocument(`<p class=MsoNormal><span lang=DE style='mso-ansi-language:DE'>Meet me in </span><st1:place
w:st="on"><st1:City w:st="on"><span lang=DE style='mso-ansi-language:DE'>Berlin</span></st1:City></st1:place><span
lang=DE style='mso-ansi-language:DE'> on Monday. This sentence is long enough that
Word wraps it onto the next line of the clipboard HTML.<span
style='mso-spacerun:yes'>&nbsp; </span><i>Italic</i> and <u>under</u><o:p></o:p></span></p>`)
	);
	expect(blocks).toEqual([
		[
			"normal",
			[
				["Meet me in ", []],
				["Berlin", []],
				[
					" on Monday. This sentence is long enough that Word wraps it onto the next line of the clipboard HTML.",
					[],
				],
				["\u00a0 ", []],
				["Italic", ["em"]],
				[" and ", []],
				["under", ["underline"]],
			],
		],
	]);
});

test("Word desktop: MsoListParagraph bullets become a real bullet list without the literal marker", () => {
	const { blocks, json } = importWord(
		wordDocument(`<p class=MsoNormal>Groceries:<o:p></o:p></p>

<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'>${bullet("·", "Symbol")}Apples<o:p></o:p></p>

<p class=MsoListParagraphCxSpMiddle style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'>${bullet("·", "Symbol")}<b>Bread</b><o:p></o:p></p>

<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:l0 level2 lfo1'>${bullet("o", '"Courier New"')}Sourdough<o:p></o:p></p>

<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'>${bullet("·", "Symbol")}Milk<o:p></o:p></p>

<p class=MsoNormal>After<o:p></o:p></p>`)
	);
	expect(json).not.toContain("·");
	expect(json).not.toContain("\u00a0");
	expect(blocks).toEqual([
		["normal", [["Groceries:", []]]],
		[
			"bullet",
			[
				[["normal", [["Apples", []]]]],
				[
					["normal", [["Bread", ["strong"]]]],
					["bullet", [[["normal", [["Sourdough", []]]]]]],
				],
				[["normal", [["Milk", []]]]],
			],
		],
		["normal", [["After", []]]],
	]);
});

test("Word desktop: a single-item list (MsoListParagraph) and macOS comment markers", () => {
	// Word for Mac writes the downlevel markers as real comments.
	const { blocks } = importWord(
		`<p class=MsoListParagraph style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><!--[if !supportLists]--><span
style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
</span></span></span><!--[endif]-->Only item<o:p></o:p></p>`
	);
	expect(blocks).toEqual([["bullet", [[["normal", [["Only item", []]]]]]]]);
});

test("Word desktop: numbered lists keep their kind and start, and separate lists stay separate", () => {
	const { blocks } = importWord(
		wordDocument(`<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'>${numbered("1.")}One<o:p></o:p></p>

<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;text-indent:-18.0pt;mso-list:l1 level2 lfo2'>${numbered("a.")}One-a<o:p></o:p></p>

<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'>${numbered("2.")}Two<o:p></o:p></p>

<p class=MsoNormal><o:p>&nbsp;</o:p></p>

<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l2 level1 lfo3'>${numbered("3.")}Three<o:p></o:p></p>

<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'>${bullet("·", "Symbol")}Bullet<o:p></o:p></p>`)
	);
	expect(blocks).toEqual([
		[
			"number:1",
			[
				[
					["normal", [["One", []]]],
					["number:1", [[["normal", [["One-a", []]]]]]],
				],
				[["normal", [["Two", []]]]],
			],
		],
		["normal", []],
		["number:3", [[["normal", [["Three", []]]]]]],
		["bullet", [[["normal", [["Bullet", []]]]]]],
	]);
});

test("Word desktop: numbered headings drop their list marker", () => {
	const { blocks } = importWord(
		wordDocument(
			`<h1 style='margin-left:21.6pt;text-indent:-21.6pt;mso-list:l3 level1 lfo4'>${numbered("1")}Introduction<o:p></o:p></h1>`
		)
	);
	expect(blocks).toEqual([["h1", [["Introduction", []]]]]);
});

test("Word desktop: content controls (<w:sdt>) and VML are unwrapped, hidden text is dropped", () => {
	const { blocks } = importWord(
		wordDocument(`<w:Sdt ShowingPlcHdr="t" DocPart="DefaultPlaceholder_-1854013440" ID="-1511372196"><p class=MsoNormal>Inside a content control<o:p></o:p></p></w:Sdt>

<p class=MsoNormal>Visible<span style='display:none;mso-hide:all'> hidden</span><!--[if gte vml 1]><v:shape id="Picture_x0020_1"
 o:spid="_x0000_i1025" type="#_x0000_t75" style='width:10pt;height:10pt'><v:imagedata
 src="file:///C:/Users/sam/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png"
 o:title=""/></v:shape><![endif]--><o:p></o:p></p>`)
	);
	expect(blocks).toEqual([
		["normal", [["Inside a content control", []]]],
		["normal", [["Visible", []]]],
	]);
});

test("Outlook: MsoNormal paragraphs with nested <o:p> import as plain paragraphs", () => {
	const { blocks } = importWord(
		`<div class=WordSection1><p class=MsoNormal><span style='mso-fareast-language:EN-US'>Hi team,<o:p></o:p></span></p><p class=MsoNormal><span style='mso-fareast-language:EN-US'><o:p>&nbsp;</o:p></span></p><p class=MsoNormal><span style='mso-fareast-language:EN-US'>Thanks, <b>Sam</b><o:p></o:p></span></p></div>`
	);
	expect(blocks).toEqual([
		["normal", [["Hi team,", []]]],
		["normal", []],
		[
			"normal",
			[
				["Thanks, ", []],
				["Sam", ["strong"]],
			],
		],
	]);
});

test("namespaced tags outside Word HTML are unwrapped too, and other unknown tags stay read-only", () => {
	const result = importHtml("<p>a<x:note>b</x:note><o:p></o:p><kbd>c</kbd></p>");
	expect(validateDocument(result.document).ok).toBe(true);
	expect(outline(result.document.blocks)).toEqual([
		[
			"normal",
			[
				["a", []],
				["b", []],
				["zettel_html_inline", []],
			],
		],
	]);
});
