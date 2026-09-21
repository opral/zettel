import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createDemo } from "./model.mjs";
import { startServer } from "./server.mjs";

async function request(base, path, init) {
  const response = await fetch(`${base}${path}`, init);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let body = null;
  if (
    bytes.byteLength > 0 &&
    response.headers.get("content-type")?.includes("json")
  ) {
    body = JSON.parse(new TextDecoder().decode(bytes));
  }
  return { response, bytes, body };
}

test("demo server uses real Lix schemas, JSONB bodies, files, and snapshots", async () => {
  const temp = await mkdtemp(join(tmpdir(), "zettel-lix-comments-"));
  const snapshotPath = join(temp, "demo.lix");
  const running = await startServer({ port: 0, persist: true, snapshotPath });
  try {
    for (const value of [null, [], 7, "text", { body: null }]) {
      const validation = await request(running.url, "/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      assert.equal(validation.response.status, 200);
      assert.equal(validation.body.ok, false);
    }
    const initial = await request(running.url, "/api/state");
    assert.equal(initial.response.status, 200);
    assert.equal(initial.body.conversations.length, 2);
    assert.equal(initial.body.comments.length, 3);
    assert.equal(initial.body.files.length, 3);
    assert.match(initial.body.conversations[0].target, /^lix_row_ref:v1:/);
    assert.equal(
      initial.body.checkpoint.ref,
      initial.body.conversations[0].target,
    );
    assert.equal(
      initial.body.checkpoint.ref,
      await running.model.rowRef("lix_commit", initial.body.checkpoint.id),
    );
    for (const conversation of initial.body.conversations) {
      const mention = initial.body.targets.find(
        (target) => target.label === conversation.title,
      );
      assert.equal(
        mention.ref,
        await running.model.rowRef("zettel_demo_conversation", conversation.id),
      );
      assert.notEqual(mention.ref, conversation.target);
    }
    assert.equal(initial.body.comments[1].body.format, "zettel");
    assert.equal(initial.body.comments[1].body.blocks[0]._type, "zettel_list");

    // The returned JSONB body must be a normal structured value, not a string
    // or a lossy engine wrapper.
    const stored = initial.body.comments.find(
      (comment) => comment.id === "comment-guide-plan",
    );
    assert.ok(stored.body.blocks[1].blocks.length > 0);
    assert.equal(stored.body.blocks[1]._type, "zettel_quote");

    const schemaRows = await running.model.query(
      "SELECT schema_key, value FROM lix_registered_schema WHERE schema_key IN ($1, $2) ORDER BY schema_key",
      ["zettel_demo_comment", "zettel_demo_conversation"],
    );
    assert.equal(schemaRows.length, 2);
    const commentSchema = schemaRows.find(
      (row) => row.schema_key === "zettel_demo_comment",
    ).value;
    assert.deepEqual(commentSchema.foreign_keys, [
      {
        columns: ["conversation_id"],
        references: { schema_key: "zettel_demo_conversation", columns: ["id"] },
      },
      {
        columns: ["author_id"],
        references: { schema_key: "lix_account", columns: ["id"] },
      },
    ]);

    const invalid = await request(running.url, "/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_id: "guide",
        body: {
          format: "zettel",
          version: 1,
          blocks: [{ _type: "unknown", _key: "bad-node" }],
        },
      }),
    });
    assert.equal(invalid.response.status, 400);
    const afterInvalid = await request(running.url, "/api/state");
    assert.equal(
      afterInvalid.body.comments.length,
      initial.body.comments.length,
    );

    const validBody = structuredClone(initial.body.comments[0].body);
    validBody.blocks[1].children[0].text =
      "Decision: keep the API stable after review.";
    const created = await request(running.url, "/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversation_id: "guide", body: validBody }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.conversation_id, "guide");
    assert.deepEqual(created.body.body, validBody);

    const uploadedBytes = new TextEncoder().encode(
      "uploaded bytes survive Lix snapshot roundtrip\n",
    );
    const uploaded = await request(running.url, "/api/files", {
      method: "POST",
      headers: { "content-type": "text/plain", "x-file-name": "notes.txt" },
      body: uploadedBytes,
    });
    assert.equal(uploaded.response.status, 201);
    assert.match(uploaded.body.id, /^[0-9a-f-]{36}$/i);
    assert.equal(uploaded.body.name, "notes.txt");
    const downloaded = await request(
      running.url,
      `/api/files/${encodeURIComponent(uploaded.body.id)}`,
    );
    assert.equal(downloaded.response.status, 200);
    assert.deepEqual(downloaded.bytes, uploadedBytes);
    assert.match(
      downloaded.response.headers.get("content-disposition"),
      /^attachment;/,
    );

    const snapshot = await request(running.url, "/api/snapshot");
    assert.equal(snapshot.response.status, 200);
    assert.equal(
      new TextDecoder().decode(snapshot.bytes.slice(0, 6)),
      "LIXSNA",
    );
    await writeFile(snapshotPath, snapshot.bytes);
  } finally {
    await running.close();
  }

  const reopened = await createDemo({ persist: true, snapshotPath });
  try {
    const state = await reopened.state();
    assert.equal(state.comments.length, 4);
    assert.ok(state.files.some((file) => file.name === "notes.txt"));
    const bytes = await reopened.readFile(
      state.files.find((file) => file.name === "notes.txt").id,
    );
    assert.equal(
      new TextDecoder().decode(bytes.bytes),
      "uploaded bytes survive Lix snapshot roundtrip\n",
    );
  } finally {
    await reopened.close();
    await rm(temp, { recursive: true, force: true });
  }
});
