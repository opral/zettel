import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { startServer } from "./server.mjs";
const running = await startServer({ port: 0, persist: false });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_BIN
    ? { executablePath: process.env.BROWSER_BIN }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1060 },
  deviceScaleFactor: 1,
});
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const results = [];
try {
  await page.goto(running.url);
  await page.waitForSelector(".comment");
  const initial = await (
    await page.request.get(`${running.url}/api/state`)
  ).json();
  await mkdir(new URL("./artifacts/", import.meta.url), { recursive: true });
  await page.screenshot({
    path: new URL("./artifacts/desktop.png", import.meta.url).pathname,
    fullPage: true,
  });
  await page.locator("#conversations button").nth(1).click();
  await page.locator(".comment .attachment").waitFor();
  assert.ok((await page.locator(".comment li li").count()) > 0);
  await page.screenshot({
    path: new URL("./artifacts/nested.png", import.meta.url).pathname,
    fullPage: true,
  });
  await page.locator("#conversations button").first().click();
  results.push(
    "seeded conversations render with shared link and nested content",
  );
  const oldCount = await page.locator(".comment").count();
  await page.getByRole("button", { name: "Try nested content" }).click();
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll(".comment").length === count,
    oldCount + 1,
  );
  const last = page.locator(".comment").last();
  assert.equal(await last.locator("li").count(), 2);
  assert.equal(await last.locator("li blockquote").count(), 1);
  assert.equal(
    await last.locator('a[href="https://example.com/proposal"]').count(),
    1,
  );
  results.push(
    "Markdown post persists nested item content and renders one shared link",
  );
  await last.getByRole("button", { name: "Edit JSON" }).click();
  const doc = JSON.parse(await page.locator("#draft").inputValue());
  const bad = { ...doc, unknown: true };
  await page.locator("#draft").fill(JSON.stringify(bad));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  assert.match(await page.locator("#error").textContent(), /unknown/i);
  const unchanged = await (
    await page.request.get(`${running.url}/api/state`)
  ).json();
  assert.equal(unchanged.comments.length, initial.comments.length + 1);
  doc.blocks[0].children[0].text =
    "Edited directly in JSON. Same node identity.";
  await page.locator("#draft").fill(JSON.stringify(doc));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#save-status").textContent.includes("Saved to Lix"),
  );
  await page.waitForFunction(() =>
    document
      .querySelector(".comment:last-child .document")
      .textContent.includes("Edited directly"),
  );
  const updated = await (
    await page.request.get(`${running.url}/api/state`)
  ).json();
  const edited = updated.comments.find(
    (c) => c.body.blocks[0]?._key === doc.blocks[0]._key,
  );
  assert.deepEqual(edited.body, doc);
  results.push(
    "invalid JSON stays rejected; valid JSON edit preserves exact document keys",
  );
  await page.locator("#upload").setInputFiles({
    name: "review-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Attachment bytes outside JSONB.\n"),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#save-status")
      .textContent.includes("File uploaded"),
  );
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll(".comment").length === count,
    oldCount + 2,
  );
  const download = page.locator(".comment").last().locator("a.attachment");
  const uploaded = await page.request.get(
    `${running.url}${await download.getAttribute("href")}`,
  );
  assert.equal(await uploaded.text(), "Attachment bytes outside JSONB.\n");
  results.push(
    "upload stores real Lix file bytes and comment stores only file ID",
  );
  await page.locator("#mention").selectOption(initial.targets[0].ref);
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll(".comment").length === count,
    oldCount + 3,
  );
  assert.equal(
    await page.locator(".comment").last().locator(".mention").count(),
    1,
  );
  const final = await (
    await page.request.get(`${running.url}/api/state`)
  ).json();
  assert.ok(
    final.comments.some((c) =>
      c.body.blocks.some((b) =>
        b.children?.some(
          (n) => n._type === "lix_ref" && n.target === initial.targets[0].ref,
        ),
      ),
    ),
  );
  results.push("mention inserts an engine-generated RowRef");
  const snapshot = await page.request.get(`${running.url}/api/snapshot`);
  assert.equal(snapshot.status(), 200);
  assert.ok((await snapshot.body()).length > 0);
  results.push("database snapshot downloads");
  await running.model.execute(
    "UPDATE zettel_demo_comment SET body=$1::jsonb WHERE id=$2",
    [JSON.stringify({ format: "zettel", version: 2, blocks: [] }), edited.id],
  );
  await page.reload();
  await page
    .getByText(
      "Unsupported document — preserved as read-only JSON. Use Inspect to see the original.",
    )
    .waitFor();
  const unsupported = page.locator(`.comment[data-id="${edited.id}"]`);
  assert.equal(
    await unsupported.getByRole("button", { name: "Edit JSON" }).isDisabled(),
    true,
  );
  await unsupported
    .getByRole("button", { name: "Inspect", exact: true })
    .click();
  assert.equal(
    JSON.parse(await page.locator("#json-view").textContent()).version,
    2,
  );
  results.push("unsupported stored document remains inspectable and read-only");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: new URL("./artifacts/mobile.png", import.meta.url).pathname,
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  results.push("mobile layout has no horizontal overflow");
  assert.deepEqual(pageErrors, []);
  await writeFile(
    new URL("./artifacts/browser-results.json", import.meta.url),
    JSON.stringify(
      { passed: results.length, checks: results, pageErrors },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ passed: results.length, checks: results }, null, 2),
  );
} finally {
  await browser.close();
  await running.close();
}
