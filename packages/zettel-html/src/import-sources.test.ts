import { test, expect } from "vitest";
import { validateDocument, type Block } from "@opral/zettel-ast";
import { importHtml } from "./html.js";

// Clipboard HTML from common sources, reduced to the shapes the importer
// sees. Each test pins the whole imported structure so a change in how one
// source is read cannot silently change another.

/** Blocks as `[style, [[text, marks]]]`; links show as `link:<href>`, breaks as `<br>`. */
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
					child.marks.map((mark: string) => {
						const link = block.markDefs.find((definition: any) => definition._key === mark);
						return link ? `link:${link.href}` : mark;
					}),
				]),
			];
		if (block._type === "zettel_list")
			return ["list", block.items.map((item: any) => outline(item.blocks))];
		if (block._type === "zettel_quote") return ["quote", outline(block.blocks)];
		return [block._type];
	});
}
function importOutline(html: string): unknown[] {
	const result = importHtml(html);
	expect(validateDocument(result.document).ok).toBe(true);
	return outline(result.document.blocks);
}

test("Word online: formatting carried in TextRun styles imports as marks", () => {
	const run = (style: string, text: string) =>
		`<span data-contrast="auto" xml:lang="EN-US" lang="EN-US" class="TextRun SCXW1 BCX0" style="margin: 0px; padding: 0px; font-size: 12pt; font-family: Aptos, Aptos_EmbeddedFont, sans-serif;${style}"><span class="NormalTextRun SCXW1 BCX0" style="margin: 0px; padding: 0px;">${text}</span></span>`;
	const html =
		'<meta charset="utf-8"><div class="OutlineElement Ltr SCXW1 BCX0" style="margin: 0px; padding: 0px;">' +
		'<p class="Paragraph SCXW1 BCX0" paraid="1" style="margin: 0px; padding: 0px; font-weight: normal; font-style: normal;">' +
		run(" font-weight: bold; font-variant-ligatures: none !important;", "Bold") +
		run("", " plain ") +
		run(" font-style: italic;", "italic") +
		run(" text-decoration: underline;", " under") +
		run(" text-decoration: line-through;", " struck") +
		'<span class="EOP SCXW1 BCX0" data-ccp-props="{}" style="font-size: 12pt;">&nbsp;</span></p></div>' +
		'<div class="OutlineElement Ltr SCXW1 BCX0"><p class="Paragraph SCXW1 BCX0" paraid="2" style="margin: 0px;">' +
		run("", "Second paragraph") +
		"</p></div>";
	expect(importOutline(html)).toEqual([
		[
			"normal",
			[
				["Bold", ["strong"]],
				[" plain ", []],
				["italic", ["em"]],
				[" under", ["underline"]],
				[" struck", ["strike-through"]],
				[" ", []],
			],
		],
		["normal", [["Second paragraph", []]]],
	]);
});

test("Notion: semantic tags import unchanged", () => {
	const html =
		'<meta charset="utf-8"><h2 id="1a2b" class="">Heading</h2>' +
		'<p id="3c4d" class="">Some <strong>bold</strong>, <em>italic</em>, <s>struck</s>, <code>code</code> and <a href="https://example.com">a link</a>.</p>' +
		'<ul id="5e6f" class="bulleted-list"><li style="list-style-type:disc">First</li></ul>' +
		'<ul id="7a8b" class="bulleted-list"><li style="list-style-type:disc">Second <strong>item</strong></li></ul>';
	expect(importOutline(html)).toEqual([
		["h2", [["Heading", []]]],
		[
			"normal",
			[
				["Some ", []],
				["bold", ["strong"]],
				[", ", []],
				["italic", ["em"]],
				[", ", []],
				["struck", ["strike-through"]],
				[", ", []],
				["code", ["code"]],
				[" and ", []],
				["a link", ["link:https://example.com"]],
				[".", []],
			],
		],
		["list", [[["normal", [["First", []]]]]]],
		[
			"list",
			[
				[
					[
						"normal",
						[
							["Second ", []],
							["item", ["strong"]],
						],
					],
				],
			],
		],
	]);
});

test("Apple Notes: tags import as marks and an empty <div><br></div> line is an empty paragraph", () => {
	const html =
		'<meta charset="UTF-8"><style type="text/css">body{font-family:-apple-system}</style>' +
		"<div><b>Bold</b> and <i>italic</i> and <u>under</u></div><div><br></div><div>Next line<br>same paragraph</div>";
	expect(importOutline(html)).toEqual([
		[
			"normal",
			[
				["Bold", ["strong"]],
				[" and ", []],
				["italic", ["em"]],
				[" and ", []],
				["under", ["underline"]],
			],
		],
		["normal", []],
		[
			"normal",
			[
				["Next line", []],
				["<br>", []],
				["same paragraph", []],
			],
		],
	]);
});

test("Pages / TextEdit (Cocoa HTML Writer): full documents import unchanged", () => {
	const html =
		'<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd"><html><head>' +
		'<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><title></title><meta name="Generator" content="Cocoa HTML Writer">' +
		"<style type=\"text/css\">p.p1 {margin: 0.0px; font: 12.0px 'Helvetica Neue'} span.s1 {font-kerning: none}</style></head><body>" +
		'<p class="p1"><span class="s1"><b>Bold</b> and <i>italic</i></span></p><p class="p1"><br></p><p class="p1"><span class="s1">Second</span></p>' +
		"</body></html>";
	expect(importOutline(html)).toEqual([
		[
			"normal",
			[
				["Bold", ["strong"]],
				[" and ", []],
				["italic", ["em"]],
			],
		],
		// A <br> inside a paragraph is its content and stays a hard break.
		["normal", [["<br>", []]]],
		["normal", [["Second", []]]],
	]);
});

test("plain <b>/<i>/<s>/<u> markup imports unchanged, styles without formatting included", () => {
	const html =
		"<p><b>b</b> <strong>s</strong> <i>i</i> <em>e</em> <s>s</s> <del>d</del> <u>u</u> <ins>n</ins> <b><i>bi</i></b> <code>c</code></p>" +
		'<p>line one<br>line two</p><p><b style="color:red">red bold</b> <i class="x" style="font-size:12px">sized italic</i></p>';
	expect(importOutline(html)).toEqual([
		[
			"normal",
			[
				["b", ["strong"]],
				[" ", []],
				["s", ["strong"]],
				[" ", []],
				["i", ["em"]],
				[" ", []],
				["e", ["em"]],
				[" ", []],
				["s", ["strike-through"]],
				[" ", []],
				["d", ["strike-through"]],
				[" ", []],
				["u", ["underline"]],
				[" ", []],
				["n", ["underline"]],
				[" ", []],
				["bi", ["strong", "em"]],
				[" ", []],
				["c", ["code"]],
			],
		],
		[
			"normal",
			[
				["line one", []],
				["<br>", []],
				["line two", []],
			],
		],
		[
			"normal",
			[
				["red bold", ["strong"]],
				[" ", []],
				["sized italic", ["em"]],
			],
		],
	]);
});

test("a GitHub-rendered Markdown page imports unchanged", () => {
	const html =
		'<meta charset="utf-8"><div class="markdown-heading" dir="auto"><h2 tabindex="-1" class="heading-element" dir="auto">Install</h2>' +
		'<a id="user-content-install" class="anchor" aria-label="Permalink: Install" href="#install"><svg class="octicon octicon-link" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m7.775 3.275"></path></svg></a></div>' +
		'<p dir="auto">Run <code>pnpm i</code>, then <strong>build</strong> and <em>test</em>. <del>Old</del> see <a href="https://github.com/opral/zettel">the repo</a>.</p>' +
		'<ul dir="auto"><li>one</li><li><strong>two</strong></li></ul><blockquote><p dir="auto">quoted</p></blockquote>' +
		'<div class="highlight highlight-source-shell notranslate position-relative overflow-auto" dir="auto"><pre>pnpm <span class="pl-c1">test</span></pre></div>';
	expect(importOutline(html)).toEqual([
		["h2", [["Install", []]]],
		["normal", [["zettel_html_inline", ["link:#install"]]]],
		[
			"normal",
			[
				["Run ", []],
				["pnpm i", ["code"]],
				[", then ", []],
				["build", ["strong"]],
				[" and ", []],
				["test", ["em"]],
				[". ", []],
				["Old", ["strike-through"]],
				[" see ", []],
				["the repo", ["link:https://github.com/opral/zettel"]],
				[".", []],
			],
		],
		["list", [[["normal", [["one", []]]]], [["normal", [["two", ["strong"]]]]]]],
		["quote", [["normal", [["quoted", []]]]]],
		["zettel_code"],
	]);
});
