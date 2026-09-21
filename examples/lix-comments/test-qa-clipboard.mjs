import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { startServer } from './server.mjs';
import { fromMarkdown, toMarkdown } from '@opral/zettel-markdown';

const executablePath = process.env.BROWSER_BIN ?? chromium.executablePath();
await mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
const checks = [];
const failures = [];
const pageErrors = [];
const consoleErrors = [];
let app;
let browser;
let context;

function record(name, detail = '') {
  checks.push({ name, detail });
}

function fail(name, error) {
  failures.push({ name, error: error?.stack ?? String(error) });
}

async function editorState(page) {
  return await page.locator('#json').inputValue().then((value) => JSON.parse(value));
}

function textOf(document) {
  return document.blocks
    .flatMap((block) => block.children ?? block.items?.flatMap((item) => item.blocks.flatMap((nested) => nested.children ?? [])) ?? [])
    .map((child) => child.text ?? child.code ?? '')
    .join('');
}

async function markdown(page, value) {
  const details = page.locator('.composer details');
  if (!(await details.evaluate((node) => node.open))) await details.locator('summary').click();
  await page.locator('#markdown').fill(value);
  await page.locator('#import-md').click();
  await page.waitForFunction(() => document.querySelector('#json').value.includes('zettel_doc'));
  assert.equal(await page.locator('#error').textContent(), '', 'Markdown import should not show an error');
}

async function selectText(page, start, length) {
  await page.locator('#editor').click();
  await page.keyboard.press('Control+Home');
  for (let index = 0; index < start; index += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.down('Shift');
  for (let index = 0; index < length; index += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => getSelection()?.toString() ?? ''), (await page.locator('#editor').innerText()).slice(start, start + length));
}

async function clearError(page) {
  assert.equal(await page.locator('#error').textContent(), '', 'No visible #error should be present');
}

try {
  app = await startServer({ port: 0, persist: false });
  console.log(`APP ${app.url}`);
  browser = await chromium.launch({ headless: true, executablePath });
  context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(app.url, { timeout: 10000 });
  await page.locator('#editor').waitFor({ timeout: 10000 });
  console.log('READY');

  const scenario = async (name, fn) => {
    console.log(`RUN ${name}`);
    try {
      await fn();
      await clearError(page);
      record(name);
      console.log(`PASS ${name}`);
    } catch (error) {
      fail(name, error);
      console.log(`FAIL ${name}: ${error.message}`);
    }
  };

  await scenario('toolbar bold applies only the selected text and survives export', async () => {
    await markdown(page, 'hello world');
    await selectText(page, 0, 5);
    await page.locator('[data-format="bold"]').click();
    const document = await editorState(page);
    assert.equal(document.blocks[0].children[0].text, 'hello');
    assert.deepEqual(document.blocks[0].children[0].marks, ['strong']);
    assert.equal(document.blocks[0].children[1].text, ' world');
    assert.match(await page.locator('#editor').innerHTML(), /<strong[^>]*>hello<\/strong>/);
  });

  await scenario('toolbar italic and code apply independently to a selected range', async () => {
    await markdown(page, 'alpha beta gamma');
    await selectText(page, 6, 4);
    await page.locator('[data-format="italic"]').click();
    let document = await editorState(page);
    assert.deepEqual(document.blocks[0].children.find((child) => child.text === 'beta').marks, ['em']);
    await selectText(page, 0, 5);
    await page.locator('[data-format="code"]').click();
    document = await editorState(page);
    assert.deepEqual(document.blocks[0].children.find((child) => child.text === 'alpha').marks, ['code']);
  });

  await scenario('keyboard shortcuts Ctrl+B and Ctrl+I toggle marks on a selection', async () => {
    await markdown(page, 'bold italic');
    await selectText(page, 0, 4);
    await page.keyboard.press('Control+b');
    await selectText(page, 5, 6);
    await page.keyboard.press('Control+i');
    const document = await editorState(page);
    assert.deepEqual(document.blocks[0].children.find((child) => child.text === 'bold').marks, ['strong']);
    assert.deepEqual(document.blocks[0].children.find((child) => child.text === 'italic').marks, ['em']);
  });

  await scenario('typing after a formatted selection keeps the inserted text in the intended mark context', async () => {
    await markdown(page, 'hello world');
    await selectText(page, 0, 5);
    await page.locator('[data-format="bold"]').click();
    await page.keyboard.type('hi');
    const document = await editorState(page);
    assert.equal(textOf(document), 'hi world');
    assert.deepEqual(document.blocks[0].children[0].marks, ['strong']);
    assert.equal(document.blocks[0].children[0].text, 'hi');
  });

  await scenario('typing replaces a nonformatted selection without retaining deleted text', async () => {
    await markdown(page, 'abcdef');
    await selectText(page, 2, 2);
    await page.keyboard.type('XY');
    const document = await editorState(page);
    assert.equal(textOf(document), 'abXYef');
    assert.equal(document.blocks[0].children.map((child) => child.text).join(''), 'abXYef');
  });

  await scenario('forward Delete removes the character at the caret after Backspace', async () => {
    await markdown(page, 'alpha\n\nbeta');
    await page.locator('#editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Delete');
    const document = await editorState(page);
    assert.equal(document.blocks.map((block) => (block.children ?? []).map((child) => child.text ?? '').join('')).join('\\n'), 'alpha\\nbe');
  });

  await scenario('cut removes the selected text and places both plain and rich clipboard data', async () => {
    await markdown(page, 'cut me please');
    await selectText(page, 0, 6);
    await page.keyboard.press('Control+x');
    const document = await editorState(page);
    assert.equal(textOf(document), ' please');
    const clipboard = await page.evaluate(async () => ({
      plain: await navigator.clipboard.readText(),
      html: (await navigator.clipboard.read()).find((item) => item.types.includes('text/html')) ? await (await navigator.clipboard.read())[0].getType('text/html').then((blob) => blob.text()) : '',
    }));
    assert.equal(clipboard.plain, 'cut me');
    assert.match(clipboard.html, /cut me/);
  });

  await scenario('copy and paste a rich selection preserves inline marks', async () => {
    await markdown(page, '**bold** plain');
    await selectText(page, 0, 4);
    await page.keyboard.press('Control+c');
    await page.locator('#editor').click();
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(50);
    const document = await editorState(page);
    assert.equal(textOf(document), 'bold plainbold');
    const boldSpans = document.blocks[0].children.filter((child) => child.text === 'bold');
    assert.equal(boldSpans.length, 2);
    assert.ok(boldSpans.every((child) => child.marks.includes('strong')));
  });

  await scenario('plain text paste at a caret inserts text without creating a literal HTML fragment', async () => {
    await markdown(page, 'Before after');
    await page.evaluate(async () => navigator.clipboard.writeText('plain paste'));
    await page.locator('#editor').click();
    await page.keyboard.press('Control+Home');
    for (let index = 0; index < 7; index += 1) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(50);
    const document = await editorState(page);
    assert.equal(textOf(document), 'Before plain pasteafter');
    assert.equal(document.blocks[0].children.some((child) => String(child.text).includes('<span')), false);
  });

  await scenario('undo and redo restore a replaced selection in order', async () => {
    await markdown(page, 'abcdef');
    await page.locator('#editor').click();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(50);
    assert.equal(textOf(await editorState(page)), 'abcdef', 'loading a document clears any prior undo history');
    await selectText(page, 2, 2);
    await page.keyboard.type('X');
    assert.equal(textOf(await editorState(page)), 'abXef');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(50);
    assert.equal(textOf(await editorState(page)), 'abcdef');
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(50);
    assert.equal(textOf(await editorState(page)), 'abXef');
  });

  await scenario('Markdown import/export preserves GFM heading, emphasis, code, task list, and links', async () => {
    const source = '# Heading\n\nA **bold** and *italic* and `code`.\n\n- [x] done\n- [ ] todo\n\n[link](https://example.com)\n';
    await markdown(page, source);
    await page.locator('#export-md').click();
    const exported = await page.locator('#markdown').inputValue();
    assert.equal(exported, toMarkdown(fromMarkdown(source)));
    await page.locator('#import-md').click();
    assert.equal(await page.locator('#error').textContent(), '');
  });

  await scenario('multi-block rich paste preserves following content and Markdown round trip', async () => {
    await markdown(page, 'Before after');
    const richPayload = { _type: 'zettel_doc', blocks: [
      { _type: 'zettel_block', _key: 'first', style: 'normal', markDefs: [], children: [{ _type: 'zettel_span', _key: 'first-span', text: 'one', marks: ['strong'] }] },
      { _type: 'zettel_block', _key: 'second', style: 'normal', markDefs: [], children: [{ _type: 'zettel_span', _key: 'second-span', text: 'two', marks: [] }] },
    ] };
    await page.locator('#editor').click();
    await page.keyboard.press('Control+Home');
    for (let index = 0; index < 7; index += 1) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);
    await page.evaluate((payload) => {
      const data = new DataTransfer();
      data.setData('text/zettel', JSON.stringify(payload));
      data.setData('text/plain', 'one\ntwo');
      document.querySelector('#editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, richPayload);
    await page.waitForTimeout(50);
    const document = await editorState(page);
    assert.equal(document.blocks.length, 3);
    assert.deepEqual(document.blocks.map((block) => (block.children ?? []).map((child) => child.text ?? '').join('')), ['Before one', 'two', 'after']);
    await page.locator('#export-md').click();
    const exported = await page.locator('#markdown').inputValue();
    assert.match(exported, /Before \*\*one\*\*/);
    assert.match(exported, /two/);
    assert.match(exported, /after/);
  });

  const result = {
    browser: executablePath,
    url: app.url,
    passed: checks.length,
    failed: failures.length,
    checks,
    failures,
    pageErrors,
    consoleErrors,
  };
  await writeFile(new URL('./artifacts/qa-clipboard-results.json', import.meta.url), JSON.stringify(result, null, 2));
  const report = [
    '# Clipboard and editing QA',
    '',
    `Passed: ${result.passed}  Failed: ${result.failed}`,
    '',
    ...checks.map(({ name }) => `- PASS: ${name}`),
    ...failures.map(({ name, error }) => `- FAIL: ${name} (${error.split('\\n')[0]})`),
    '',
    `Page errors: ${pageErrors.length}`,
    ...pageErrors.map((error) => `- ${error}`),
    `Console errors: ${consoleErrors.length}`,
    ...consoleErrors.map((error) => `- ${error}`),
    '',
    'The server was started with `startServer({port: 0, persist: false})`; no live database was opened or modified.',
  ].join('\n');
  await writeFile(new URL('./artifacts/qa-clipboard-report.md', import.meta.url), `${report}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context?.close();
  await browser?.close();
  await app?.close();
}
