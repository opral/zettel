import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { startServer } from './server.mjs';
import { initialMarkdown } from './model.mjs';

const browserBinary = process.env.BROWSER_BIN ?? chromium.executablePath();
const artifactDir = new URL('./artifacts/', import.meta.url);
const resultPath = new URL('./qa-editing-results.json', artifactDir);
const checks = [];
const pageErrors = [];
let app;
let browser;
let page;

const textOf = node => node?.textContent ?? '';

async function json() {
  const raw = await page.locator('#json').inputValue();
  const value = JSON.parse(raw);
  assert.equal(value._type, 'zettel_doc');
  assert(Array.isArray(value.blocks), 'document blocks must be an array');
  return value;
}

async function reloadComposer() {
  await page.goto(app.url);
  await page.locator('[data-target="checkpoint"]').waitFor();
  await page.locator('#editor').waitFor();
  await page.waitForFunction(() => Boolean(document.querySelector('#json')?.value));
  assert.equal((await page.locator('#error').textContent()).trim(), '');
}

async function importMarkdown(markdown) {
  const details = page.locator('.composer details');
  if (!(await details.evaluate(node => node.open))) await details.locator('summary').click();
  await page.locator('#markdown').fill(markdown);
  await page.locator('#import-md').click();
  await page.waitForFunction(() => Boolean(document.querySelector('#json')?.value));
  assert.equal((await page.locator('#error').textContent()).trim(), '');
}

async function cleanClientState(startErrorCount) {
  await page.waitForTimeout(60);
  const uiError = (await page.locator('#error').textContent()).trim();
  const newPageErrors = pageErrors.slice(startErrorCount);
  assert.equal(uiError, '', `#error contains: ${uiError}`);
  assert.deepEqual(newPageErrors, [], `pageerror: ${newPageErrors.join(' | ')}`);
}

async function scenario(name, fn) {
  const startErrorCount = pageErrors.length;
  try {
    await reloadComposer();
    const detail = await fn();
    await cleanClientState(startErrorCount);
    checks.push({ name, status: 'passed', detail });
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      error: error?.stack ?? String(error),
      uiError: (await page.locator('#error').textContent().catch(() => '')).trim(),
      pageErrors: pageErrors.slice(startErrorCount),
    });
  }
}

try {
  // This deliberately avoids the user's .data snapshot and does not persist.
  app = await startServer({ port: 0, persist: false });
  browser = await chromium.launch({ headless: true, executablePath: browserBinary });
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', error => pageErrors.push(error.message));

  await scenario('fresh composer accepts direct typing', async () => {
    await page.locator('#editor').click();
    await page.keyboard.type('Fresh base');
    await page.waitForFunction(() => document.querySelector('#json').value.includes('Fresh base'));
    const documentValue = await json();
    assert.equal(documentValue.blocks.length, 1);
    assert.equal(documentValue.blocks[0].children[0].text, 'Fresh base');
    return { blocks: documentValue.blocks.length, text: documentValue.blocks[0].children[0].text };
  });

  await scenario('Enter splits blocks and Backspace/Delete mutate the active text', async () => {
    await page.locator('#editor').click();
    await page.keyboard.type('alpha');
    await page.keyboard.press('Enter');
    await page.keyboard.type('beta');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Delete');
    const documentValue = await json();
    const texts = documentValue.blocks.map(block => block.children?.map(child => child.text ?? '').join('') ?? '');
    assert.deepEqual(texts, ['alpha', 'be']);
    return { texts };
  });

  await scenario('Delete at a selected range and direct replacement stay valid', async () => {
    await page.locator('#editor').click();
    await page.keyboard.type('replace me');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    const blank = await json();
    assert.equal(blank.blocks.length, 1);
    await page.keyboard.type('replacement');
    await page.waitForFunction(() => document.querySelector('#json').value.includes('replacement'));
    await page.keyboard.press('Backspace');
    const replaced = await json();
    assert.equal(replaced.blocks[0].children[0].text, 'replacemen');
    return { afterDeleteBlocks: blank.blocks.length, replacement: replaced.blocks[0].children[0].text };
  });

  await scenario('list items support typing and Enter-created items', async () => {
    await importMarkdown('- one\n- two\n');
    await page.locator('#editor').click();
    await page.locator('#editor li').first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Home');
    await page.keyboard.type('A ');
    await page.waitForFunction(() => document.querySelector('#json').value.includes('A one'));
    await page.locator('#editor li').nth(1).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.type('three');
    const documentValue = await json();
    assert.equal(documentValue.blocks[0]._type, 'zettel_list');
    const items = documentValue.blocks[0].items;
    const itemTexts = items.map(item => item.blocks.flatMap(block => block.children ?? []).map(child => child.text ?? '').join(''));
    assert.deepEqual(itemTexts, ['A one', 'two', 'three']);
    assert.equal(items.length, 3);
    return { itemTexts };
  });

  await scenario('table cells support click, End, and direct text editing', async () => {
    await importMarkdown('| Check | Result |\n| --- | --- |\n| Build | Passed |\n');
    const firstHeader = page.locator('#editor th').first();
    await firstHeader.click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    const documentValue = await json();
    assert.equal(documentValue.blocks[0]._type, 'zettel_table');
    const firstCell = documentValue.blocks[0].rows[0].cells[0];
    assert.equal(firstCell.children.map(child => child.text ?? '').join(''), 'Check!');
    return { firstCell: firstCell.children.map(child => child.text ?? '').join(''), rows: documentValue.blocks[0].rows.length };
  });

  await scenario('code blocks support Enter and direct code editing', async () => {
    await importMarkdown('```js\nconst x = 1;\n```\n');
    const code = page.locator('#editor pre.zettel_code');
    await code.click();
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    await page.keyboard.type('const y = 2;');
    const documentValue = await json();
    assert.equal(documentValue.blocks[0]._type, 'zettel_code');
    assert.match(documentValue.blocks[0].code, /const x = 1;\nconst y = 2;/);
    return { code: documentValue.blocks[0].code };
  });

  await scenario('toolbar code formatting updates stored span marks', async () => {
    await page.locator('#editor').click();
    await page.keyboard.type('inline code');
    await page.keyboard.press('Control+A');
    await page.locator('[data-format="code"]').click();
    const documentValue = await json();
    const span = documentValue.blocks[0].children[0];
    assert.equal(span.text, 'inline code');
    assert.deepEqual(span.marks, ['code']);
    return { text: span.text, marks: span.marks };
  });

  await scenario('saved JSON survives Edit, typing, and update', async () => {
    await page.locator('#editor').click();
    await page.keyboard.type('persisted text');
    await page.waitForFunction(() => document.querySelector('#json').value.includes('persisted text'));
    const beforeSave = await json();
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved to Lix');
    const stateAfterCreate = await (await page.request.get(`${app.url}/api/state`)).json();
    assert.equal(stateAfterCreate.comments.length, 1);
    assert.deepEqual(stateAfterCreate.comments[0].body, beforeSave);
    const id = stateAfterCreate.comments[0].id;
    await page.locator(`#comments article[data-comment-id="${id}"] button`).click();
    await page.waitForTimeout(100);
    await page.locator('#editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' revised');
    await page.waitForFunction(() => document.querySelector('#json').value.includes(' revised'));
    const afterEdit = await json();
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved to Lix');
    const stateAfterUpdate = await (await page.request.get(`${app.url}/api/state`)).json();
    assert.equal(stateAfterUpdate.comments.length, 1);
    assert.equal(stateAfterUpdate.comments[0].id, id);
    assert.deepEqual(stateAfterUpdate.comments[0].body, afterEdit);
    return { id, beforeText: beforeSave.blocks[0].children[0].text, afterText: afterEdit.blocks[0].children[0].text };
  });

  const result = {
    browserBinary,
    server: 'startServer({ port: 0, persist: false })',
    source: 'artifacts/qa-editing.mjs',
    scenarios: checks,
    pageErrors,
    passed: checks.filter(check => check.status === 'passed').length,
    failed: checks.filter(check => check.status === 'failed').length,
    findings: checks.filter(check => check.status === 'failed').map(check => ({
      scenario: check.name,
      errorElement: check.uiError,
      pageErrors: check.pageErrors,
      error: check.error,
    })),
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.failed ? 1 : 0;
} finally {
  if (browser) await browser.close();
  if (app) await app.close();
}
