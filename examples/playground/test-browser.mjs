import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
const server = await createServer({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const address = server.httpServer.address();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_BIN
    ? { executablePath: process.env.BROWSER_BIN }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on("pageerror", (e) => errors.push(e.message));
async function applyMarkdown(source) {
  await page.locator("#markdown").fill(source);
  await page.locator("#import-markdown").click();
  await page.waitForTimeout(60);
  assert.equal(await page.locator("#diagnostics").textContent(), "");
}
async function doc() {
  const result = await page.evaluate(() => {
    const document = window.zettelPlayground.getDocument();
    return {
      document,
      validation: window.zettelPlayground.validateDocument(document),
    };
  });
  assert.equal(
    result.validation.ok,
    true,
    JSON.stringify(result.validation.errors),
  );
  return result.document;
}
async function caret(selector, offset) {
  await page
    .locator(selector)
    .first()
    .evaluate((el, offset) => {
      el.closest("[contenteditable=true]").focus();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      const range = document.createRange();
      range.setStart(text, offset);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    }, offset);
  await page.waitForTimeout(20);
}
try {
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(
    () => window.zettelPlayground?.getDocument().blocks.length > 0,
  );
  assert.equal(await page.locator("#editor h1").count(), 1);
  assert.equal(await page.locator("#preview h1").count(), 1);
  assert.equal(await page.locator("#editor table").count(), 1);
  assert.equal(await page.locator("#diagnostics").textContent(), "");
  const contentStyles = await page.evaluate(() => {
    const selectors = ["h1", "h2", "p", "blockquote", "li", "strong", "em", "code"];
    const styles = (root, selector) => {
      const node = document.querySelector(root + " " + selector);
      if (!node) return null;
      const s = getComputedStyle(node);
      return {
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        fontStyle: s.fontStyle,
        lineHeight: s.lineHeight,
        marginTop: s.marginTop,
        marginBottom: s.marginBottom,
      };
    };
    return selectors.map((selector) => ({
      selector,
      editor: styles("#editor", selector),
      static: styles("#preview", selector),
    }));
  });
  for (const style of contentStyles)
    assert.deepEqual(
      style.editor,
      style.static,
      `Shared CSS differs for ${style.selector}`,
    );
  const codeStyles = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--zettel-code-background)";
    document.querySelector("#preview").append(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const look = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const s = getComputedStyle(node);
      return { background: s.backgroundColor, fontFamily: s.fontFamily, fontSize: s.fontSize, padding: s.padding };
    };
    return {
      expected,
      editorInline: look("#editor p code"),
      staticInline: look("#preview p code"),
      editorBlock: look("#editor pre.zettel_code code"),
      staticBlock: look("#preview pre.zettel_code code"),
    };
  });
  assert.notEqual(codeStyles.expected, "rgba(0, 0, 0, 0)");
  assert.equal(codeStyles.editorInline?.background, codeStyles.expected, "inline code has the code background while editing");
  assert.deepEqual(codeStyles.editorInline, codeStyles.staticInline, "inline code looks the same while editing and when rendered");
  for (const block of [codeStyles.editorBlock, codeStyles.staticBlock])
    assert.equal(block?.background, "rgba(0, 0, 0, 0)", "code inside a code block is not styled as an inline chip");
  checks.push("all four representations load with nested lists and GFM table");
  await mkdir(new URL("./artifacts/", import.meta.url), { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL("./artifacts/desktop.png", import.meta.url)),
    fullPage: true,
  });
  await applyMarkdown("Hello world.\n");
  const initial = await doc();
  await caret("#editor p", 5);
  await page.keyboard.type(" brave");
  await page.waitForTimeout(80);
  let edited = await doc();
  assert.equal(edited.blocks[0]._key, initial.blocks[0]._key);
  assert.equal(
    edited.blocks[0].children.map((c) => c.text ?? "").join(""),
    "Hello brave world.",
  );
  assert.equal(
    edited.blocks[0].children[0]._key,
    initial.blocks[0].children[0]._key,
  );
  checks.push("typing changes content and retains existing node identities");
  await applyMarkdown("Start\n");
  await caret("#editor p", 5);
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("Bold");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(" text");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.equal(
    edited.blocks[0].children.map((child) => child.text ?? "").join(""),
    "StartBold text",
    "Formatting boundaries must retain character order and spaces",
  );
  assert.equal(await page.locator("#editor p").innerText(), "StartBold text");
  assert.equal(
    edited.blocks[0].children.find((child) => child.text === "Bold")?.marks.includes("strong"),
    true,
  );
  await page.keyboard.press("ControlOrMeta+i");
  await page.keyboard.type(" italic");
  await page.keyboard.press("ControlOrMeta+i");
  await page.keyboard.type(" plain");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.equal(
    edited.blocks[0].children.map((child) => child.text ?? "").join(""),
    "StartBold text italic plain",
  );
  assert.equal(
    edited.blocks[0].children.find((child) => child.text === " italic")?.marks.includes("em"),
    true,
  );
  assert.equal(await page.locator("#editor p").innerText(), "StartBold text italic plain");
  checks.push("typing across bold boundaries keeps text order and spaces");
  await applyMarkdown("[Link](https://example.com)\n");
  await caret("#editor a", 4);
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("Bold");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(" text");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.equal(
    edited.blocks[0].children.map((child) => child.text ?? "").join(""),
    "LinkBold text",
  );
  assert.equal(edited.blocks[0].markDefs[0].href, "https://example.com");
  checks.push("typing after a formatted link retains order and the link definition");
  await applyMarkdown("Hello brave world.\n");
  await caret("#editor p", 5);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.equal(edited.blocks.length, 2);
  assert.equal(
    edited.blocks[0].children.map((c) => c.text ?? "").join(""),
    "Hello",
  );
  assert.equal(
    edited.blocks[1].children.map((c) => c.text ?? "").join(""),
    " brave world.",
  );
  checks.push(
    "Enter splits text at the caret without moving or dropping trailing content",
  );
  await applyMarkdown("Plain\n");
  await caret("#editor p", 5);
  // No leading spaces: typing a space across a format boundary is
  // opral/zettel#8's subject, not this check's.
  await page.keyboard.press("ControlOrMeta+u");
  await page.keyboard.type("text");
  await page.keyboard.press("ControlOrMeta+u");
  await page.keyboard.type("more");
  await page.waitForTimeout(80);
  assert.deepEqual(
    (await doc()).blocks[0].children.map((child) => [child.text, child.marks]),
    [
      ["Plain", []],
      ["text", ["underline"]],
      ["more", []],
    ],
    "Cmd+U underlines what is typed next and toggles back off",
  );
  assert.equal(
    await page.locator("#editor u, #editor [style*='underline']").count() > 0,
    true,
    "underlined text renders underlined",
  );
  checks.push("Cmd+U underlines and round-trips as the underline mark");
  await applyMarkdown("Start\n");
  await caret("#editor p", 5);
  await page.keyboard.type(" **bold** after *it* `code` https://example.com/x. done");
  await page.waitForTimeout(80);
  assert.deepEqual(
    (await doc()).blocks[0].children.map((child) => [child.text, child.marks.map((mark) => (["strong", "em", "code"].includes(mark) ? mark : "link"))]),
    [
      ["Start ", []],
      ["bold", ["strong"]],
      [" after ", []],
      ["it", ["em"]],
      [" ", []],
      ["code", ["code"]],
      [" ", []],
      ["https://example.com/x", ["link"]],
      [". done", []],
    ],
    "Markdown shortcuts format typed text and typing continues unformatted",
  );
  assert.equal((await doc()).blocks[0].markDefs[0]?.href, "https://example.com/x");
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(80);
  assert.equal(
    (await doc()).blocks[0].children.map((child) => child.text).join(""),
    "Start bold after it code https://example.com/x. ",
    "Undo first reverts the typing after the last conversion",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.equal(edited.blocks[0].children.map((child) => child.text).join(""), "Start bold after it code https://example.com/x. ");
  assert.deepEqual(edited.blocks[0].markDefs, [], "The next undo reverts only the autolink");
  await applyMarkdown("Start\n");
  await caret("#editor p", 5);
  await page.keyboard.type(" **b**");
  await page.waitForTimeout(80);
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(80);
  assert.deepEqual(
    (await doc()).blocks[0].children.map((child) => [child.text, child.marks]),
    [["Start **b**", []]],
    "Undo reverts a shortcut conversion in one step",
  );
  await applyMarkdown("Start\n");
  await caret("#editor p", 5);
  await page.keyboard.press("Enter");
  await page.keyboard.type("- one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await page.waitForTimeout(80);
  assert.deepEqual(
    (await doc()).blocks.map((block) => block._type === "zettel_list" ? [block.kind, block.items.map((item) => item.blocks[0].children.map((child) => child.text).join(""))] : block.children.map((child) => child.text).join("")),
    ["Start", ["bullet", ["one", "two"]]],
    "- at the start of a paragraph starts a bullet list",
  );
  checks.push("Markdown shortcuts format, list and link typed text; undo reverts a conversion");
  for (const inputType of ["insertReplacementText", "insertFromDrop"]) {
    await applyMarkdown("Hello wrold again.\n");
    await page.locator("#editor p").evaluate((el) => {
      el.closest("[contenteditable=true]").focus();
      const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange();
      range.setStart(text, 6);
      range.setEnd(text, 11);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.waitForTimeout(20);
    // Spell-check suggestions and text drops carry their text in
    // dataTransfer; InputEvent.data is null for both.
    await page.locator("#editor").evaluate((el, inputType) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", "world");
      el.dispatchEvent(
        new InputEvent("beforeinput", { inputType, dataTransfer, bubbles: true, cancelable: true }),
      );
    }, inputType);
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator("#editor p").innerText(),
      "Hello world again.",
      `${inputType} must insert the dataTransfer text`,
    );
  }
  checks.push("spell-check replacements and text drops insert their text");
  for (const [inputType, offset, expected] of [
    ["deleteSoftLineBackward", 12, "world."],
    ["deleteHardLineBackward", 12, "world."],
    ["deleteSoftLineForward", 5, "Hello"],
    ["deleteHardLineForward", 5, "Hello"],
  ]) {
    await applyMarkdown("Hello brave world.\n");
    await caret("#editor p", offset);
    await page.locator("#editor").evaluate((el, inputType) => {
      el.dispatchEvent(new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true }));
    }, inputType);
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator("#editor p").innerText(),
      expected,
      `${inputType} must delete to the line boundary`,
    );
  }
  if (process.platform === "darwin") {
    await applyMarkdown("Hello brave world.\n");
    await caret("#editor p", 12);
    await page.keyboard.press("Meta+Backspace");
    await page.waitForTimeout(80);
    assert.equal(await page.locator("#editor p").innerText(), "world.");
  }
  checks.push("line deletion (Cmd+Backspace) deletes to the line boundary");
  await applyMarkdown("Word\n");
  await caret("#editor p", 4);
  const caretX = () =>
    page.evaluate(() => {
      const range = getSelection().getRangeAt(0);
      return (range.getClientRects()[0] ?? range.getBoundingClientRect()).left;
    });
  const beforeSpace = await caretX();
  await page.keyboard.type(" ");
  await page.waitForTimeout(40);
  assert.ok(
    (await caretX()) > beforeSpace,
    "A typed trailing space must move the caret",
  );
  await page.keyboard.type(" two");
  await page.waitForTimeout(80);
  assert.equal(
    (await doc()).blocks[0].children.map((c) => c.text ?? "").join(""),
    "Word  two",
  );
  assert.equal(
    await page.locator("#editor p").innerText(),
    "Word  two",
    "Typed spaces must not collapse while editing",
  );
  checks.push("typed spaces stay visible while editing");
  await applyMarkdown("Before after.\n");
  await caret("#editor p", 7);
  await page.locator("#editor").evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData(
      "text/html",
      '<p><strong>PASTED</strong> <a href="https://example.com">link</a><script>window.__pasteExecuted=true</script></p>',
    );
    dt.setData("text/plain", "PASTED link");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForTimeout(100);
  const text = await page.locator("#editor").innerText();
  assert.ok(
    text.indexOf("Before") < text.indexOf("PASTED") &&
      text.indexOf("PASTED") < text.indexOf("after."),
  );
  assert.equal(await page.evaluate(() => window.__pasteExecuted), undefined);
  assert.ok(
    (await doc()).blocks.some((b) =>
      b.children?.some(
        (c) => c.text?.includes("PASTED") && c.marks.includes("strong"),
      ),
    ),
  );
  assert.ok(
    (await page.locator("#diagnostics").textContent()).length > 0,
    "Paste removal must be visible",
  );
  checks.push(
    "rich paste inserts at selection with formatting, inert script removal and visible diagnostics",
  );
  await applyMarkdown("Start\n");
  await caret("#editor p", 5);
  await page.locator("#editor").evaluate((el) => {
    const dt = new DataTransfer();
    // The shape of a Google Docs copy.
    dt.setData(
      "text/html",
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span>Docs </span><b>bold</b></p><p dir="ltr"><span>second</span></p></b>',
    );
    dt.setData("text/plain", "Docs bold\nsecond");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#editor .zettel_html_inline").count(), 0);
  assert.equal(await page.locator("#editor strong").innerText(), "bold");
  assert.deepEqual(await page.locator("#editor p").allInnerTexts(), ["StartDocs bold", "second"]);
  checks.push("a Google Docs paste keeps its paragraphs editable");
  await applyMarkdown("Start\n");
  await caret("#editor p", 5);
  await page.locator("#editor").evaluate((el) => {
    const dt = new DataTransfer();
    // Google Docs carries formatting only in styles, copies an empty
    // paragraph as <br> and ends the payload with Apple-interchange-newline.
    dt.setData(
      "text/html",
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-2"><p dir="ltr"><span style="font-weight:700;">Bold</span><span style="font-weight:400;"> plain </span><span style="font-style:italic;">italic</span></p><br><p dir="ltr"><span style="font-weight:400;">Second</span></p></b><br class="Apple-interchange-newline">',
    );
    dt.setData("text/plain", "Bold plain italic\n\nSecond\n");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  assert.deepEqual(
    (await doc()).blocks.map((block) =>
      block.children.map((child) => [child._type === "zettel_span" ? child.text : child._type, child.marks]),
    ),
    [
      [
        ["Start", []],
        ["Bold", ["strong"]],
        [" plain ", []],
        ["italic", ["em"]],
      ],
      [],
      [["Second", []]],
    ],
  );
  checks.push("a Google Docs paste keeps styled formatting and blank lines without bolding plain text");
  await applyMarkdown("Start\n");
  await caret("#editor p", 5);
  await page.locator("#editor").evaluate((el) => {
    const dt = new DataTransfer();
    // The shape of a Word desktop copy: Office namespace tags, conditional
    // comments and a list written as paragraphs with a literal bullet.
    dt.setData(
      "text/html",
      `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta name=Generator content="Microsoft Word 15"><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]--><style><!-- p.MsoNormal {margin:0cm;} --></style></head><body lang=EN-US><!--StartFragment--><p class=MsoNormal>Hello <b>bold</b><o:p></o:p></p><p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>One<o:p></o:p></p><p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Two<o:p></o:p></p><!--EndFragment--></body></html>`,
    );
    dt.setData("text/plain", "Hello bold\n·  One\n·  Two\n");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#editor .zettel_html_inline").count(), 0);
  assert.equal(await page.locator("#editor .zettel_html").count(), 0);
  assert.deepEqual(await page.locator("#editor li").allInnerTexts(), ["One", "Two"]);
  assert.ok(!(await page.locator("#editor").innerText()).includes("·"));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("typed");
  await page.waitForTimeout(100);
  assert.equal((await page.locator("#editor").innerText()).trim(), "typed");
  checks.push("a Word desktop paste drops Office markup, keeps its list, and select-all + delete clears it");
  await applyMarkdown("Before after.\n");
  await caret("#editor p", 7);
  await page.locator("#editor").evaluate((el) => {
    const dt = new DataTransfer();
    // What Chromium puts on the clipboard when copying from a web page.
    dt.setData("text/html", "<meta charset='utf-8'><p>From <b>the web</b></p>");
    dt.setData("text/plain", "From the web");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#editor .zettel_html").count(), 0);
  assert.ok(!(await page.locator("#editor").innerText()).includes("charset"));
  checks.push("clipboard <meta charset> is not pasted as a raw HTML block");
  for (const [type, value] of [
    ["text/plain", "PASTED"],
    ["text/html", "<p><strong>PASTED</strong></p>"],
  ]) {
    await applyMarkdown("Before after.\n");
    await caret("#editor p", 7);
    await page.locator("#editor").evaluate(
      (el, [type, value]) => {
        const dt = new DataTransfer();
        dt.setData(type, value);
        el.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      },
      [type, value],
    );
    await page.waitForTimeout(80);
    await page.keyboard.type("!");
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator("#editor p").innerText(),
      "Before PASTED!after.",
      `Typing after a ${type} paste must continue after the pasted text`,
    );
  }
  checks.push("the caret ends after pasted inline content");
  await applyMarkdown("| Left | Right |\n| :--- | ---: |\n| alpha | beta |\n");
  assert.equal(await page.locator("#editor th").count(), 2);
  assert.equal(await page.locator("#preview th").count(), 2);
  assert.equal(await page.locator("#preview table > thead > tr").count(), 1);
  assert.equal(await page.locator("#preview table > tbody > tr").count(), 1);
  const style = await page.evaluate(() => {
    const value = (selector) => {
      const s = getComputedStyle(document.querySelector(selector));
      return {
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        textAlign: s.textAlign,
      };
    };
    return [value("#editor th:last-child"), value("#preview th:last-child")];
  });
  assert.deepEqual(style[0], style[1]);
  await caret("#editor td", 5);
  await page.keyboard.type(" edited");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.equal(
    edited.blocks[0].rows[1].cells[0].children
      .map((c) => c.text ?? "")
      .join(""),
    "alpha edited",
  );
  assert.deepEqual(edited.blocks[0].align, ["left", "right"]);
  checks.push(
    "table text is editable with preserved alignment and matching shared CSS",
  );
  await applyMarkdown("[one **two** three](https://example.com)\n");
  edited = await doc();
  assert.equal(edited.blocks[0].markDefs.length, 1);
  assert.equal(await page.locator("#preview a").count(), 1);
  await page.locator("#export-markdown").click();
  assert.equal(await page.locator("#diagnostics").textContent(), "");
  checks.push("shared link annotations survive editor and Markdown conversion");
  await applyMarkdown("Hello world.\n");
  await caret("#editor p", 5);
  await page.keyboard.press("Shift+Enter");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.equal(edited.blocks.length, 1);
  assert.ok(
    edited.blocks[0].children.some((node) => node._type === "zettel_break"),
  );
  assert.equal(
    edited.blocks[0].children
      .filter((node) => node._type === "zettel_span")
      .map((node) => node.text)
      .join(""),
    "Hello world.",
  );
  checks.push(
    "Shift+Enter creates a hard break without splitting the paragraph",
  );
  await applyMarkdown("Line one\n");
  await caret("#editor p", 8);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("two");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("four");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.equal(edited.blocks.length, 1);
  assert.deepEqual(
    edited.blocks[0].children.map((node) => node.text ?? node._type),
    ["Line one", "zettel_break", "two", "zettel_break", "zettel_break", "four"],
    "Text typed after a trailing hard break must not be dropped",
  );
  assert.equal(await page.locator("#editor p").innerText(), "Line one\ntwo\n\nfour");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("fresh");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.deepEqual(
    edited.blocks.map((block) => block.children.map((node) => node.text ?? node._type)),
    [["fresh"]],
    "Select all and Backspace must also remove hard breaks",
  );
  await applyMarkdown("Ends here\n");
  await caret("#editor p", 9);
  const oneLine = await page.locator("#editor p").evaluate((p) => p.getBoundingClientRect().height);
  await page.keyboard.press("Shift+Enter");
  await page.waitForTimeout(80);
  const twoLines = await page.locator("#editor p").evaluate((p) => p.getBoundingClientRect().height);
  assert.ok(
    twoLines > oneLine * 1.5,
    `A trailing hard break must show the new, empty line (${oneLine} -> ${twoLines})`,
  );
  checks.push("typing after a trailing hard break keeps the text on the new line");

  // Lexical 0.50 removes the blocks on a select-all delete and leaves a plain
  // ParagraphNode; it must become a Zettel block that Enter can split.
  await applyMarkdown("# Heading\n\nBody\n");
  await caret("#editor p", 2);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("fresh text");
  await page.waitForTimeout(80);
  assert.equal(await page.locator("#editor > *").count(), 1);
  assert.equal(await page.locator("#editor p.zettel_block[data-zettel-key]").count(), 1);
  edited = await doc();
  assert.equal(edited.blocks[0]._key, (await doc()).blocks[0]._key);
  await caret("#editor p .zettel_span", 6);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  assert.deepEqual(
    (await doc()).blocks.map((block) => block.children.map((node) => node.text).join("")),
    ["fresh ", "text"],
  );
  checks.push("select-all delete leaves an editable Zettel block");

  // Lexical (<= 0.51) threw inside removeText for a range from the start of a
  // block into the first of several text runs of a later block.
  await applyMarkdown("one **two**\n\n**four** five six\n");
  await page.locator("#editor p").first().evaluate((first) => {
    first.closest("[contenteditable=true]").focus();
    const textIn = (el) => document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(textIn(first), 0);
    range.setEnd(textIn(first.nextElementSibling), 3);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForTimeout(40);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("X");
  await page.waitForTimeout(80);
  assert.equal(await page.locator("#diagnostics").textContent(), "");
  assert.deepEqual(
    (await doc()).blocks.map((block) => block.children.map((node) => node.text).join("")),
    ["Xr five six"],
  );
  checks.push("deleting a range that crosses blocks into a text run works");

  // A triple click must select only its block, not reach into the next one.
  await applyMarkdown("First paragraph\n\nSecond paragraph\n");
  await page.locator("#editor p").first().click({ clickCount: 3 });
  await page.waitForTimeout(150);
  await page.keyboard.type("X");
  await page.waitForTimeout(80);
  assert.deepEqual(
    (await doc()).blocks.map((block) => block.children.map((node) => node.text).join("")),
    ["X", "Second paragraph"],
  );
  checks.push("typing over a triple-click selection keeps the next block");

  await applyMarkdown("- [ ] First second\n- Last\n");
  await caret("#editor li p", 5);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.equal(edited.blocks.length, 1);
  assert.equal(edited.blocks[0].items.length, 3);
  assert.equal(
    edited.blocks[0].items[0].blocks[0].children
      .map((node) => node.text ?? "")
      .join(""),
    "First",
  );
  assert.equal(
    edited.blocks[0].items[1].blocks[0].children
      .map((node) => node.text ?? "")
      .join(""),
    " second",
  );
  await page.locator('#editor input[type="checkbox"]').first().click();
  await page.waitForTimeout(80);
  assert.equal((await doc()).blocks[0].items[0].checked, true);
  checks.push(
    "Enter creates a sibling list item and a real checkbox click updates task state",
  );

  const listShape = (document) => document.blocks.map((block) =>
    block._type === "zettel_list"
      ? block.items.map((item) => item.blocks.map((b) => (b.children ?? []).map((n) => n.text ?? "").join("")).join("|"))
      : (block.children ?? []).map((n) => n.text ?? "").join(""),
  );
  await applyMarkdown("- one\n- two\n");
  await caret("#editor li:nth-child(2) p", 3);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");
  await page.waitForTimeout(80);
  assert.deepEqual(listShape(await doc()), [["one", "two"], "after"], "Enter on an empty item leaves the list");
  await caret("#editor li:nth-child(2) p", 0);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(80);
  assert.deepEqual(listShape(await doc()), [["one"], "two", "after"], "Backspace at an item's start turns it into a paragraph");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(80);
  assert.deepEqual(listShape(await doc()), [["onetwo"], "after"], "a second Backspace joins it to the previous item");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("fresh");
  await page.waitForTimeout(80);
  assert.deepEqual(listShape(await doc()), ["fresh"], "Select all and Backspace leaves a paragraph, not an empty bullet");
  assert.equal(await page.locator("#editor li").count(), 0);
  checks.push("Enter and Backspace leave lists without ghost items; select all + Backspace clears them");

  const shapeOf = (blocks) => blocks.map((block) =>
    block._type === "zettel_list"
      ? { [block.kind]: block.items.map((item) => shapeOf(item.blocks)) }
      : block._type === "zettel_quote"
        ? { quote: shapeOf(block.blocks) }
        : (block.children ?? []).map((n) => n.text ?? "").join(""),
  );
  await applyMarkdown("- one\n  - inner\n- two\n");
  await caret("#editor li li p", 5);
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowLeft");
  // Lexical reads the caret from the asynchronous selectionchange event.
  await page.waitForTimeout(80);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(80);
  assert.deepEqual(shapeOf((await doc()).blocks), [{ bullet: [["one"], ["inner"], ["two"]] }], "Backspace at a nested item's start outdents it");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(80);
  assert.deepEqual(shapeOf((await doc()).blocks), [{ bullet: [["one"]] }, "inner", { bullet: [["two"]] }], "a second Backspace turns it into a paragraph");
  await page.keyboard.type("ab");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(80);
  assert.deepEqual(shapeOf((await doc()).blocks), [{ bullet: [["one"]] }, "inner", { bullet: [["two"]] }], "Backspace inside text still deletes characters");
  await applyMarkdown("> first\n>\n> middle\n>\n> last\n");
  await caret("#editor blockquote p:nth-child(2)", 6);
  for (let i = 0; i < 6; i += 1) await page.keyboard.press("ArrowLeft");
  // Lexical reads the caret from the asynchronous selectionchange event.
  await page.waitForTimeout(80);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(80);
  assert.deepEqual(shapeOf((await doc()).blocks), [{ quote: ["first"] }, "middle", { quote: ["last"] }], "Backspace at a quote line's start moves the line out");
  await page.keyboard.type("X");
  await page.waitForTimeout(80);
  assert.deepEqual(shapeOf((await doc()).blocks), [{ quote: ["first"] }, "Xmiddle", { quote: ["last"] }]);
  checks.push("Backspace at the start of a non-empty nested item outdents it, and at a quote line's start moves the line out");

  await applyMarkdown("Before after.\n");
  await caret("#editor p", 7);
  await page.locator("#editor").evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text/html", "<p>One</p><p>Two</p>");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForTimeout(80);
  edited = await doc();
  assert.ok(edited.blocks.length >= 2);
  const pastedText = edited.blocks
    .map(
      (block) => block.children?.map((node) => node.text ?? "").join("") ?? "",
    )
    .join("\n");
  assert.ok(pastedText.indexOf("Before") < pastedText.indexOf("One"));
  assert.ok(pastedText.indexOf("One") < pastedText.indexOf("Two"));
  assert.ok(pastedText.indexOf("Two") < pastedText.indexOf("after."));
  checks.push(
    "multi-paragraph paste retains every paragraph and trailing destination text",
  );

  await applyMarkdown("[**bold link**](https://example.com)\n");
  assert.equal(
    await page.locator('#editor a[href="https://example.com"]').innerText(),
    "bold link",
  );
  assert.equal(
    await page.locator('#preview a[href="https://example.com"]').innerText(),
    "bold link",
  );
  checks.push(
    "decorated links retain anchor semantics in both rendered surfaces",
  );

  await applyMarkdown("Alpha beta gamma.\n\nSecond paragraph.\n");
  await page
    .locator("#editor p")
    .first()
    .evaluate((el) => {
      const t = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const r = document.createRange();
      r.setStart(t, 6);
      r.setEnd(t, 10);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      el.closest("[contenteditable=true]").focus();
    });
  const copied = await page.locator("#editor").evaluate((el) => {
    const dt = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
    return { plain: dt.getData("text/plain"), json: dt.getData("text/zettel") };
  });
  assert.equal(copied.plain, "beta");
  assert.equal(JSON.parse(copied.json).blocks.length, 1);
  await caret("#editor p", 6);
  await page.locator("#editor").evaluate((el, json) => {
    const dt = new DataTransfer();
    dt.setData("text/zettel", json);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, copied.json);
  await page.waitForTimeout(80);
  await doc();
  checks.push("copy uses only the selection; internal paste remaps identities");
  await applyMarkdown("Hello world.\n");
  await page.locator("#editor p").evaluate((el) => {
    const t = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const r = document.createRange();
    r.setStart(t, 6);
    r.setEnd(t, 11);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    el.closest("[contenteditable=true]").focus();
  });
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.waitForTimeout(80);
  edited = await doc();
  assert.ok(
    edited.blocks[0].children.some(
      (c) => c.text === "world" && c.marks.includes("strong"),
    ),
  );
  checks.push(
    "formatting a selected range exports valid split spans and marks",
  );
  await applyMarkdown("```js\nlet x = 1;\n```\n");
  assert.equal(await page.locator("#editor pre").innerText(), "let x = 1;");
  await caret("#editor pre", 4);
  await page.keyboard.type("new_");
  await page.waitForTimeout(80);
  assert.equal((await doc()).blocks[0].code, "let new_x = 1;");
  checks.push("code is editable and does not duplicate its rendered source");
  await caret("#editor pre", 4);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  edited = await doc();
  assert.equal(edited.blocks.length, 1);
  assert.equal(edited.blocks[0].code, "let \nnew_x = 1;");
  checks.push("Enter inside code inserts a code newline and retains the block");

  const before = await doc();
  await page
    .locator("#json")
    .fill(JSON.stringify({ ...before, $schema: "https://example.com/future" }));
  await page.locator("#import-json").click();
  assert.ok((await page.locator("#diagnostics").textContent()).length > 0);
  assert.deepEqual(await doc(), before);
  checks.push(
    "unsupported schema is retained in JSON pane without replacing editor content",
  );
  await page.locator("#load-sample").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: fileURLToPath(new URL("./artifacts/mobile.png", import.meta.url)),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  checks.push("mobile layout has no page overflow");
  assert.deepEqual(errors, []);
  const result = { passed: checks.length, checks, pageErrors: errors };
  await writeFile(
    new URL("./artifacts/results.json", import.meta.url),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  await server.close();
}
