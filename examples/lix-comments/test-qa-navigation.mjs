import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { startServer } from './server.mjs';

const browserBin = process.env.BROWSER_BIN ?? chromium.executablePath();
const artifactDir = new URL('./artifacts/', import.meta.url);
await mkdir(artifactDir, { recursive: true });

const results = [];
const pageErrors = [];
const consoleErrors = [];
const httpErrors = [];
let app;
let browser;
let page;

function scenario(name, fn) {
  return (async () => {
    const started = Date.now();
    try {
      const details = await fn();
      results.push({ name, status: 'pass', durationMs: Date.now() - started, ...details });
    } catch (error) {
      results.push({ name, status: 'fail', durationMs: Date.now() - started, error: error?.stack ?? String(error) });
      await page?.screenshot({ path: new URL(`./artifacts/qa-navigation-${name.replaceAll(/[^a-z0-9]+/gi, '-')}.png`, import.meta.url).pathname, fullPage: true }).catch(() => {});
    }
  })();
}

async function state() {
  const response = await page.request.get(`${app.url}/api/state`);
  assert.equal(response.ok(), true);
  return response.json();
}

async function waitReady() {
  await page.locator('[data-target="checkpoint"]').waitFor();
  await page.locator('#editor').waitFor();
}

async function openDetails() {
  const details = page.locator('.composer details');
  if (!(await details.evaluate(node => node.open))) await details.locator('summary').click();
  return details;
}

async function selectConversation(id) {
  await page.locator(`[data-target="${id}"]`).click();
  await assertCurrentConversation(id);
}

async function assertCurrentConversation(id) {
  assert.equal(await page.locator(`[data-target="${id}"]`).evaluate(node => node.classList.contains('active')), true);
}

async function editorText() {
  return page.locator('#editor').innerText();
}

async function beforeUnloadState() {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    const dispatched = window.dispatchEvent(event);
    return { dispatched, defaultPrevented: event.defaultPrevented, returnValue: event.returnValue };
  });
}

async function saveAndWait() {
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved to Lix');
}

async function switchWithDialog(id, decision) {
  const dialog = page.waitForEvent('dialog').then(async d => {
    assert.match(d.message(), /Discard the unsaved draft/);
    if (decision === 'accept') await d.accept();
    else await d.dismiss();
  });
  await Promise.all([dialog, page.locator(`[data-target="${id}"]`).click()]);
}

try {
  app = await startServer({ port: 0, persist: false });
  browser = await chromium.launch({ headless: true, executablePath: browserBin });
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }); });
  await page.goto(app.url);
  await waitReady();

  await scenario('create-save-reload', async () => {
    await selectConversation('checkpoint');
    await page.locator('#author').selectOption('bob');
    await page.locator('#editor').click();
    await page.keyboard.type('Navigation create');
    await saveAndWait();
    let current = await state();
    const saved = current.comments.find(comment => comment.conversation_id === 'checkpoint');
    assert.ok(saved, 'saved comment should be returned by state');
    assert.equal(saved.author_id, 'bob');
    assert.equal(saved.conversation_id, 'checkpoint');
    assert.match(JSON.stringify(saved.body), /Navigation create/);
    assert.equal(await page.locator('#error').textContent(), '');
    await page.reload();
    await waitReady();
    await selectConversation('checkpoint');
    assert.match(await page.locator('#comments').innerText(), /Navigation create/);
    current = await state();
    assert.equal(current.comments.find(comment => comment.id === saved.id).author_id, 'bob');
    return { commentId: saved.id, authorId: saved.author_id, target: saved.conversation_id };
  });

  await scenario('edit-cancel-preserves', async () => {
    const before = (await state()).comments.find(comment => comment.conversation_id === 'checkpoint');
    await page.locator(`#comments article[data-comment-id="${before.id}"] button`).click();
    assert.equal(await page.locator('#compose-title').textContent(), 'Edit comment');
    assert.equal(await page.locator('#author').isDisabled(), true);
    assert.equal(await page.locator('#author').inputValue(), before.author_id);
    await page.locator('#editor').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('Discarded edit ');
    await page.locator('#cancel').click();
    assert.equal(await page.locator('#compose-title').textContent(), 'Add a comment');
    assert.equal(await page.locator('#cancel').isHidden(), true);
    assert.equal(await page.locator('#author').isDisabled(), false);
    assert.match(await page.locator('#comments').innerText(), /Navigation create/);
    assert.doesNotMatch(await page.locator('#comments').innerText(), /Discarded edit/);
    const after = (await state()).comments.find(comment => comment.id === before.id);
    assert.deepEqual(after.body, before.body);
    return { commentId: before.id, bodyUnchanged: true, authorLockedWhileEditing: true };
  });

  await scenario('edit-save-retains-author-target', async () => {
    const before = (await state()).comments.find(comment => comment.conversation_id === 'checkpoint');
    await page.locator(`#comments article[data-comment-id="${before.id}"] button`).click();
    await page.locator('#editor').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('Revised navigation ');
    await saveAndWait();
    const after = (await state()).comments.find(comment => comment.id === before.id);
    assert.equal(after.id, before.id);
    assert.equal(after.author_id, before.author_id);
    assert.equal(after.conversation_id, before.conversation_id);
    assert.match(JSON.stringify(after.body), /Revised navigation/);
    assert.equal((await state()).comments.filter(comment => comment.conversation_id === 'checkpoint').length, 1);
    return { commentId: after.id, authorId: after.author_id, target: after.conversation_id };
  });

  await scenario('duplicate-save-is-single-request', async () => {
    await selectConversation('paragraph');
    await page.locator('#editor').click();
    await page.keyboard.type('Single request comment');
    let requestCount = 0;
    const requestListener = request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/comments')) requestCount += 1;
    };
    page.on('request', requestListener);
    await Promise.all([
      page.locator('#save').click(),
      page.locator('#save').click(),
    ]);
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved to Lix');
    page.off('request', requestListener);
    assert.equal(requestCount, 1, 'busy guard should permit one POST');
    const comments = (await state()).comments.filter(comment => comment.conversation_id === 'paragraph' && JSON.stringify(comment.body).includes('Single request comment'));
    assert.equal(comments.length, 1);
    return { requestCount, commentCount: comments.length };
  });

  await scenario('failed-save-keeps-draft-and-retries', async () => {
    await selectConversation('csv');
    await page.locator('#author').selectOption('alice');
    await page.locator('#editor').click();
    await page.keyboard.type('Retry after failure');
    await page.route('**/api/comments', async route => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'simulated save failure' }) });
      else await route.continue();
    });
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#error').textContent.includes('simulated save failure'));
    assert.match(await editorText(), /Retry after failure/);
    assert.match(await page.locator('#json').inputValue(), /Retry after failure/);
    assert.equal(await page.locator('#author').inputValue(), 'alice');
    assert.equal(await page.locator('#status').textContent(), '', 'failed save should not retain a prior success status');
    await page.unroute('**/api/comments');
    await saveAndWait();
    const saved = (await state()).comments.find(comment => comment.conversation_id === 'csv' && JSON.stringify(comment.body).includes('Retry after failure'));
    assert.ok(saved, 'retry should save the retained draft');
    assert.equal(saved.author_id, 'alice');
    assert.equal(saved.conversation_id, 'csv');
    return { retainedAfterFailure: true, retriedCommentId: saved.id, authorId: saved.author_id, target: saved.conversation_id };
  });

  await scenario('post-success-refresh-failure-retries-same-id', async () => {
    await selectConversation('paragraph');
    await page.locator('#editor').click();
    await page.keyboard.type('Refresh failure must not duplicate');
    await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'simulated refresh failure' }) }));
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('refresh failed'));
    assert.match(await page.locator('#error').textContent(), /Saved to Lix.*simulated refresh failure/);
    assert.equal(await page.locator('#compose-title').textContent(), 'Edit comment');
    assert.equal(await page.locator('#cancel').isHidden(), false);
    assert.equal(await page.locator('#author').isDisabled(), true);
    const saved = (await state()).comments.filter(comment => comment.conversation_id === 'paragraph' && JSON.stringify(comment.body).includes('Refresh failure must not duplicate'));
    assert.equal(saved.length, 1);
    const savedId = saved[0].id;
    await page.unroute('**/api/state');
    await saveAndWait();
    const retried = (await state()).comments.filter(comment => comment.conversation_id === 'paragraph' && JSON.stringify(comment.body).includes('Refresh failure must not duplicate'));
    assert.equal(retried.length, 1, 'retry after refresh failure must update the saved ID');
    assert.equal(retried[0].id, savedId);
    return { savedId, duplicateCount: retried.length, visibleSavedRefreshFailure: true };
  });

  await scenario('switching-rich-text-draft-prompts', async () => {
    await selectConversation('checkpoint');
    await selectConversation('paragraph');
    assert.equal(await page.locator('#status').textContent(), '', 'switching conversations should clear transient save status');
    await page.locator('#editor').click();
    await page.keyboard.type('Unsaved rich text draft');
    await switchWithDialog('csv', 'dismiss');
    assert.equal(await page.locator(`[data-target="paragraph"]`).evaluate(node => node.classList.contains('active')), true);
    assert.match(await editorText(), /Unsaved rich text draft/);
    await switchWithDialog('csv', 'accept');
    assert.equal(await page.locator(`[data-target="csv"]`).evaluate(node => node.classList.contains('active')), true);
    assert.doesNotMatch(await editorText(), /Unsaved rich text draft/);
    return { discardPromptOnEditorDraft: true, cancelPreservedDraft: true, acceptDiscardedDraft: true };
  });

  await scenario('switching-markdown-only-draft', async () => {
    await selectConversation('checkpoint');
    const details = await openDetails();
    await page.locator('#markdown').fill('Markdown-only draft that must be noticed');
    const dialog = page.waitForEvent('dialog').then(async d => {
      assert.match(d.message(), /Discard the unsaved draft/);
      await d.dismiss();
    });
    await Promise.all([dialog, page.locator('[data-target="paragraph"]').click()]);
    const markdownAfterCancel = await page.locator('#markdown').inputValue();
    const error = await page.locator('#error').textContent();
    assert.equal(await assertCurrentConversation('checkpoint'), undefined);
    const kept = markdownAfterCancel.includes('Markdown-only draft that must be noticed');
    assert.equal(kept, true);
    const discard = page.waitForEvent('dialog').then(async d => {
      assert.match(d.message(), /Discard the unsaved draft/);
      await d.accept();
    });
    await Promise.all([discard, page.locator('[data-target="paragraph"]').click()]);
    assert.equal(await assertCurrentConversation('paragraph'), undefined);
    return { prompted: true, markdownDraftKeptAfterCancel: kept, error, detailsOpenBeforeSwitch: await details.evaluate(node => node.open) };
  });

  await scenario('markdown-import-draft-prompts', async () => {
    await selectConversation('checkpoint');
    await openDetails();
    await page.locator('#markdown').fill('Imported **draft**');
    await page.locator('#import-md').click();
    await switchWithDialog('paragraph', 'dismiss');
    assert.equal(await page.locator(`[data-target="checkpoint"]`).evaluate(node => node.classList.contains('active')), true);
    assert.match(await editorText(), /Imported draft/);
    await switchWithDialog('paragraph', 'accept');
    assert.equal(await page.locator(`[data-target="paragraph"]`).evaluate(node => node.classList.contains('active')), true);
    return { importedMarkdownCountsAsDirty: true, cancelPreservedDraft: true };
  });

  await scenario('pending-markdown-save-is-blocked', async () => {
    await selectConversation('checkpoint');
    const existing = (await state()).comments.find(comment => comment.conversation_id === 'checkpoint');
    await page.locator(`#comments article[data-comment-id="${existing.id}"] button`).click();
    await openDetails();
    await page.locator('#markdown').fill('Markdown typed but not imported');
    let posts = 0;
    const requestListener = request => { if (request.method() === 'POST' && request.url().endsWith('/api/comments/' + encodeURIComponent(existing.id))) posts += 1; };
    page.on('request', requestListener);
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#error').textContent.includes('Import Markdown before saving'));
    page.off('request', requestListener);
    assert.equal(posts, 0, 'pending Markdown must not save the stale editor body');
    assert.deepEqual((await state()).comments.find(comment => comment.id === existing.id).body, existing.body);
    assert.equal(await page.locator('#status').textContent(), '');
    await page.locator('#cancel').click();
    return { blockedWithoutImport: true, postCount: posts, staleBodyPreserved: true };
  });

  await scenario('beforeunload-warns-on-dirty-drafts', async () => {
    await selectConversation('paragraph');
    assert.equal((await beforeUnloadState()).defaultPrevented, false);
    await page.locator('#editor').click();
    await page.keyboard.type('Dirty before unload');
    assert.equal((await beforeUnloadState()).defaultPrevented, true);
    await switchWithDialog('csv', 'accept');
    await openDetails();
    await page.locator('#markdown').fill('Markdown dirty before unload');
    assert.equal((await beforeUnloadState()).defaultPrevented, true);
    await switchWithDialog('paragraph', 'accept');
    return { cleanDraftAllowsUnload: true, richTextWarns: true, markdownWarns: true };
  });

  await scenario('reload-resets-unsaved-draft', async () => {
    await selectConversation('csv');
    await openDetails();
    await page.locator('#markdown').fill('Reload-only Markdown draft');
    await page.locator('#editor').click();
    await page.keyboard.type('Reload-only rich draft');
    let unloadDialogSeen = false;
    const unloadHandler = dialog => {
      if (dialog.type() === 'beforeunload') unloadDialogSeen = true;
      return dialog.accept();
    };
    page.on('dialog', unloadHandler);
    await page.reload();
    page.off('dialog', unloadHandler);
    await waitReady();
    const markdown = await openDetails().then(() => page.locator('#markdown').inputValue());
    assert.doesNotMatch(await editorText(), /Reload-only rich draft/);
    assert.equal(markdown, '');
    return { unsavedRichTextCleared: true, unsavedMarkdownCleared: true, beforeUnloadDialogSeen: unloadDialogSeen, selectedAfterReload: 'checkpoint' };
  });

  await scenario('mobile-layout-and-errors', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(app.url);
    await waitReady();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await selectConversation('csv');
    await openDetails();
    assert.equal(await page.locator('#save').isVisible(), true);
    await page.screenshot({ path: new URL('./artifacts/qa-navigation-mobile.png', import.meta.url).pathname, fullPage: true });
    return { viewport: '390x844', horizontalOverflow: false };
  });
} finally {
  if (browser) await browser.close();
  if (app) await app.close();
}

const report = {
  browserBin,
  server: 'isolated startServer({ port: 0, persist: false })',
  scenarios: results,
  pageErrors,
  consoleErrors,
  httpErrors,
  unexpectedHttpErrors: httpErrors.filter(error => !error.url.endsWith('/favicon.ico') && !(error.status === 500 && error.url.endsWith('/api/comments')) && !(error.status === 503 && error.url.endsWith('/api/state'))),
  failures: results.filter(result => result.status === 'fail').map(result => result.name),
};
await writeFile(new URL('./artifacts/qa-navigation-results.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failures.length || pageErrors.length || report.unexpectedHttpErrors.length) process.exitCode = 1;
