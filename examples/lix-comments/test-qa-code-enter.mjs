import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { startServer } from './server.mjs';

const browserBinary = process.env.BROWSER_BIN ?? chromium.executablePath();
const resultPath = new URL('./artifacts/qa-code-enter-results.json', import.meta.url);
const pageErrors = [];
let app;
let browser;

async function snapshot(page, label) {
  return page.evaluate(label => {
    const editor = window.commentDemo.editor;
    let model;
    editor.getEditorState().read(() => {
      const state = editor.getEditorState();
      const selection = state._selection;
      const node = selection?.anchor ? state._nodeMap.get(selection.anchor.key) : undefined;
      const parent = node?.getParent();
      model = {
        selection: selection && { key: selection.anchor.key, offset: selection.anchor.offset },
        node: node && { key: node.getKey(), type: node.getType(), text: node.getTextContent() },
        parent: parent && { type: parent.getType(), text: parent.getTextContent() },
        children: parent?.getChildren?.().map(child => ({ type: child.getType(), text: child.getTextContent() })),
      };
    });
    const native = getSelection();
    return {
      label,
      model,
      native: native && { offset: native.anchorOffset, text: native.anchorNode?.textContent },
      html: document.querySelector('#editor')?.innerHTML,
    };
  }, label);
}

try {
  app = await startServer({ port: 0, persist: false });
  browser = await chromium.launch({ headless: true, executablePath: browserBinary });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(app.url);
  await page.locator('[data-target="checkpoint"]').waitFor();
  const details = page.locator('.composer details');
  await details.locator('summary').click();
  await page.locator('#markdown').fill('```js\nconst x = 1;\n```\n');
  await page.locator('#import-md').click();
  const code = page.locator('#editor pre.zettel_code');
  await code.click();
  await page.waitForTimeout(100);
  await page.keyboard.press('End');
  await page.waitForTimeout(100);
  const beforeEnter = await snapshot(page, 'before Enter');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const afterEnter = await snapshot(page, 'after Enter');
  await page.keyboard.type('const y = 2;');
  await page.waitForFunction(() => document.querySelector('#json').value.includes('const y = 2;'));
  await page.waitForTimeout(150);
  const afterTyping = await snapshot(page, 'after direct typing');
  const documentValue = JSON.parse(await page.locator('#json').inputValue());
  assert.equal(documentValue.blocks[0].code, 'const x = 1;\nconst y = 2;');
  assert.equal((await page.locator('#error').textContent()).trim(), '');
  assert.deepEqual(pageErrors, []);

  await page.reload();
  await page.locator('[data-target="checkpoint"]').waitFor();
  const beforeNewlineDetails = page.locator('.composer details');
  await beforeNewlineDetails.locator('summary').click();
  await page.locator('#markdown').fill('```js\nline1\n```\n');
  await page.locator('#import-md').click();
  await page.locator('#editor pre.zettel_code').click();
  await page.waitForTimeout(100);
  await page.keyboard.press('End');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  // Select the exact text offset before the explicit LineBreakNode. Arrow
  // navigation around a terminal <br> is browser-dependent and can land
  // after the break again.
  await page.evaluate(() => {
    const text = document.querySelector('#editor pre.zettel_code code')?.firstChild;
    if (!text) throw new Error('code text node missing');
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.waitForTimeout(150);
  await page.keyboard.type('X');
  await page.waitForFunction(() => document.querySelector('#json').value.includes('line1X'));
  const beforeNewline = await snapshot(page, 'typing before terminal newline');
  const beforeNewlineValue = JSON.parse(await page.locator('#json').inputValue());
  assert.equal(beforeNewlineValue.blocks[0].code, 'line1X\n');
  assert.equal((await page.locator('#error').textContent()).trim(), '');
  assert.deepEqual(pageErrors, []);

  await page.reload();
  await page.locator('[data-target="checkpoint"]').waitFor();
  const secondDetails = page.locator('.composer details');
  await secondDetails.locator('summary').click();
  await page.locator('#markdown').fill('```js\nold code\n```\n');
  await page.locator('#import-md').click();
  await page.locator('#editor pre.zettel_code').click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('fresh code');
  await page.waitForFunction(() => document.querySelector('#json').value.includes('fresh code'));
  const afterDeleteTyping = await snapshot(page, 'after delete-all and direct typing');
  const clearedValue = JSON.parse(await page.locator('#json').inputValue());
  assert.equal(clearedValue.blocks[0].code, 'fresh code');
  assert.equal((await page.locator('#error').textContent()).trim(), '');
  assert.deepEqual(pageErrors, []);

  const result = { browserBinary, server: 'startServer({ port: 0, persist: false })', beforeEnter, afterEnter, afterTyping, beforeNewline, afterDeleteTyping, code: documentValue.blocks[0].code, beforeNewlineCode: beforeNewlineValue.blocks[0].code, clearedCode: clearedValue.blocks[0].code, pageErrors, passed: true };
  await mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  if (app) await app.close();
}
