import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildSeedDocuments, DEMO_FILE_SEEDS } from "./fixtures.mjs";
import { validateBody } from "./profile.mjs";

const MODEL_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SDK_PATH = resolve(
  MODEL_DIR,
  "../../../lix/packages/js-sdk/dist/index.js",
);
export const DEFAULT_SNAPSHOT_PATH = resolve(MODEL_DIR, ".data/demo.lix");
export const GLOBAL_BRANCH_ID = "ffffffff-ffff-7fff-bfff-ffffffffffff";
export const MAX_COMMENT_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const CONVERSATION_SCHEMA = Object.freeze({
  $schema: "https://lix.dev/schema-v1.json",
  key: "zettel_demo_conversation",
  columns: [
    { name: "id", type: "text", nullable: false },
    // Lix has an opaque RowRef value kind, but registered application columns
    // intentionally store this address as text so it can travel through JSONB.
    { name: "target", type: "text", nullable: false },
    { name: "title", type: "text", nullable: false },
  ],
  primary_key: ["id"],
});

export const COMMENT_SCHEMA = Object.freeze({
  $schema: "https://lix.dev/schema-v1.json",
  key: "zettel_demo_comment",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "conversation_id", type: "text", nullable: false },
    { name: "author_id", type: "uuid", nullable: false },
    { name: "body", type: "jsonb", nullable: false },
    { name: "created_at", type: "timestamptz", nullable: false },
  ],
  primary_key: ["id"],
  foreign_keys: [
    {
      columns: ["conversation_id"],
      references: { schema_key: "zettel_demo_conversation", columns: ["id"] },
    },
    {
      columns: ["author_id"],
      references: { schema_key: "lix_account", columns: ["id"] },
    },
  ],
});

const SCHEMAS = [CONVERSATION_SCHEMA, COMMENT_SCHEMA];

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function asBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value || []);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export class BodyValidationError extends Error {
  constructor(errors) {
    super("Invalid comment body");
    this.name = "BodyValidationError";
    this.errors = Array.isArray(errors)
      ? errors
      : [{ path: "", message: String(errors) }];
  }
}

/** Normalize the profile's result without making any claims about RowRef authenticity. */
export function validateDocumentBody(body) {
  try {
    const result = validateBody(body);
    if (result?.ok === false) {
      return {
        ok: false,
        errors: Array.isArray(result.errors) ? result.errors : [],
      };
    }
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [{ path: "", message: errorMessage(error) }] };
  }
}

export function assertValidDocumentBody(body) {
  const result = validateDocumentBody(body);
  if (!result.ok) throw new BodyValidationError(result.errors);
  return body;
}

function safeFileName(input) {
  let decoded = input;
  if (typeof input === "string") {
    try {
      decoded = decodeURIComponent(input);
    } catch {
      decoded = input;
    }
  }
  const original =
    typeof decoded === "string" && decoded.trim()
      ? basename(decoded.trim())
      : "upload.bin";
  const normalized = original
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+$/, "")
    .slice(0, 160);
  return normalized || "upload.bin";
}

function mediaTypeFromMetadata(
  metadata,
  fallback = "application/octet-stream",
) {
  const value =
    metadata && typeof metadata === "object" ? metadata.mediaType : undefined;
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function displayFileName(row) {
  const originalName =
    row.lixcol_metadata && typeof row.lixcol_metadata === "object"
      ? row.lixcol_metadata.originalName
      : undefined;
  return typeof originalName === "string" && originalName.length > 0
    ? originalName
    : row.name;
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export class DemoModel {
  constructor({ sdk, lix, persist, snapshotPath }) {
    this.sdk = sdk;
    this.lix = lix;
    this.persist = Boolean(persist);
    this.snapshotPath = snapshotPath;
    this.mutationTail = Promise.resolve();
    this.closed = false;
  }

  async query(sql, params = []) {
    if (this.closed) throw new Error("Demo model is closed");
    return (await this.lix.execute(sql, params)).rows;
  }

  async execute(sql, params = []) {
    if (this.closed) throw new Error("Demo model is closed");
    return this.lix.execute(sql, params);
  }

  /** Serialize all state-changing SQL and snapshot writes. */
  async mutate(operation) {
    const previous = this.mutationTail;
    let release;
    this.mutationTail = new Promise((resolveRelease) => {
      release = resolveRelease;
    });
    await previous;
    try {
      const result = await operation();
      if (this.persist) await this.writeSnapshot();
      return result;
    } finally {
      release();
    }
  }

  /**
   * Built-in accounts live on Lix's global branch. Current engine FK checking
   * does not resolve that global parent from a main-branch child, so the
   * FK-bearing conversation/comment rows are kept global. Reads remain on the
   * caller's branch and include global rows through Lix's normal visibility rules.
   */
  async withGlobalBranch(operation) {
    const current = await this.lix.activeBranchId();
    if (current === GLOBAL_BRANCH_ID) return operation();
    await this.lix.switchBranch({ branchId: GLOBAL_BRANCH_ID });
    try {
      return await operation();
    } finally {
      await this.lix.switchBranch({ branchId: current });
    }
  }

  async writeSnapshot() {
    const bytes = new Uint8Array(
      await new Response(this.lix.exportSnapshot()).arrayBuffer(),
    );
    await mkdir(dirname(this.snapshotPath), { recursive: true });
    const temporaryPath = `${this.snapshotPath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      await rename(temporaryPath, this.snapshotPath);
    } catch (error) {
      try {
        await import("node:fs/promises").then(({ unlink }) =>
          unlink(temporaryPath),
        );
      } catch {
        // Preserve the original persistence error.
      }
      throw error;
    }
  }

  async rowRef(relation, primaryKey) {
    // relation is always one of the fixed literals at call sites; the key is
    // parameterized so user input never becomes SQL.
    const rows = await this.query(
      `SELECT lix_row_ref('${relation}', $1) AS ref`,
      [primaryKey],
    );
    return rows[0]?.ref;
  }

  async ensureSchemas() {
    const rows = await this.query(
      "SELECT schema_key FROM lix_registered_schema WHERE schema_key IN ($1, $2)",
      SCHEMAS.map((schema) => schema.key),
    );
    const present = new Set(rows.map((row) => row.schema_key));
    for (const schema of SCHEMAS) {
      if (!present.has(schema.key)) {
        await this.execute(
          "INSERT INTO lix_registered_schema (value, lixcol_global) VALUES ($1, true)",
          [this.sdk.Value.jsonb(schema)],
        );
      }
    }
  }

  async seedFile(seed) {
    const rows = await this.query("SELECT id FROM lix_file WHERE path = $1", [
      seed.path,
    ]);
    if (rows.length > 0) return rows[0].id;
    const result = await this.execute(
      "INSERT INTO lix_file (path, content, lixcol_metadata) VALUES ($1, $2, $3) RETURNING id",
      [
        seed.path,
        new TextEncoder().encode(seed.content),
        this.sdk.Value.jsonb({
          mediaType: seed.mediaType,
          originalName: seed.name,
        }),
      ],
    );
    return result.rows[0].id;
  }

  async insertConversation(id, target, title) {
    await this.execute(
      "INSERT INTO zettel_demo_conversation (id, target, title) VALUES ($1, $2, $3)",
      [id, target, title],
    );
  }

  async insertComment({
    id,
    conversationId,
    authorId,
    body,
    createdAt = new Date().toISOString(),
  }) {
    assertValidDocumentBody(body);
    await this.execute(
      "INSERT INTO zettel_demo_comment (id, conversation_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5)",
      [id, conversationId, authorId, this.sdk.Value.jsonb(body), createdAt],
    );
  }

  async seed() {
    const fileIds = {};
    for (const seed of DEMO_FILE_SEEDS)
      fileIds[seed.key] = await this.seedFile(seed);

    const accountId = await this.lix.activeAccountId();
    const accountRef = await this.rowRef("lix_account", accountId);
    const checkpointTarget = await this.rowRef("lix_file", fileIds.checkpoint);
    const guideTarget = await this.rowRef("lix_file", fileIds.guide);

    const checkpointRows = await this.query(
      "SELECT commit_id FROM lix_create_checkpoint(ARRAY[lix_row_ref('lix_file', $1)])",
      [fileIds.checkpoint],
    );
    const checkpointId = checkpointRows[0]?.commit_id;
    if (!checkpointId)
      throw new Error("Lix did not return the seed checkpoint commit");
    const checkpointCommitRef = await this.rowRef("lix_commit", checkpointId);

    const seedResult = await this.withGlobalBranch(async () => {
      await this.insertConversation(
        "checkpoint",
        checkpointCommitRef,
        "Checkpoint review",
      );
      await this.insertConversation(
        "guide",
        guideTarget,
        "Project guide follow-up",
      );
      const guideRef = await this.rowRef("zettel_demo_conversation", "guide");
      const checkpointConversationRef = await this.rowRef(
        "zettel_demo_conversation",
        "checkpoint",
      );
      const documents = buildSeedDocuments({
        accountRef,
        conversationRef: guideRef,
        fileRef: checkpointTarget,
        attachmentFileId: fileIds.preview,
      });
      await this.insertComment({
        id: "comment-checkpoint",
        conversationId: "checkpoint",
        authorId: accountId,
        body: documents[0],
      });
      await this.insertComment({
        id: "comment-guide-plan",
        conversationId: "guide",
        authorId: accountId,
        body: documents[1],
      });
      await this.insertComment({
        id: "comment-guide-summary",
        conversationId: "guide",
        authorId: accountId,
        body: documents[2],
      });
      return { checkpointConversationRef };
    });

    return { checkpoint: checkpointId, accountId, ...seedResult, fileIds };
  }

  async initialize() {
    const schemaRows = await this.query(
      "SELECT schema_key FROM lix_registered_schema WHERE schema_key IN ($1, $2)",
      SCHEMAS.map((schema) => schema.key),
    );
    const conversations =
      schemaRows.length === SCHEMAS.length
        ? await this.query(
            "SELECT id FROM zettel_demo_conversation WHERE id IN ($1, $2) LIMIT 1",
            ["checkpoint", "guide"],
          )
        : [];
    if (conversations.length === 0) {
      await this.withGlobalBranch(() => this.ensureSchemas());
      await this.seed();
      if (this.persist) await this.writeSnapshot();
    }
    return this;
  }

  async getAccount() {
    const accountId = await this.lix.activeAccountId();
    const rows = await this.query(
      "SELECT id, name FROM lix_account WHERE id = $1",
      [accountId],
    );
    return rows[0] ?? { id: accountId, name: "Anonymous" };
  }

  async listConversations() {
    return this.query(
      "SELECT id, title, target FROM zettel_demo_conversation WHERE id IN ($1, $2) ORDER BY id",
      ["checkpoint", "guide"],
    );
  }

  async listComments() {
    return this.query(
      "SELECT id, conversation_id, author_id, body, created_at FROM zettel_demo_comment ORDER BY created_at, id",
    );
  }

  async listFiles() {
    const rows = await this.query(
      "SELECT id, name, path, lixcol_metadata FROM lix_file WHERE path NOT LIKE '/.lix/%' ORDER BY path",
    );
    return rows.map((row) => ({
      id: row.id,
      name: displayFileName(row),
      mediaType: mediaTypeFromMetadata(row.lixcol_metadata),
    }));
  }

  async checkpointInfo() {
    const rows = await this.query(
      "SELECT id FROM lix_commit WHERE is_checkpoint = true ORDER BY created_at DESC LIMIT 1",
    );
    const conversation = (
      await this.query(
        "SELECT target FROM zettel_demo_conversation WHERE id = $1",
        ["checkpoint"],
      )
    )[0];
    return rows[0] && conversation
      ? { id: rows[0].id, ref: conversation.target }
      : null;
  }

  async state() {
    const conversations = await this.listConversations();
    const comments = await this.listComments();
    const files = await this.listFiles();
    const account = await this.getAccount();
    const accountRef = await this.rowRef("lix_account", account.id);
    const checkpoint = await this.checkpointInfo();
    const targets = [{ label: account.name, ref: accountRef }];
    if (checkpoint)
      targets.push({
        label: `Checkpoint ${checkpoint.id.slice(0, 8)}`,
        ref: checkpoint.ref,
      });
    for (const conversation of conversations)
      targets.push({
        label: conversation.title,
        ref: await this.rowRef("zettel_demo_conversation", conversation.id),
      });
    for (const file of files)
      targets.push({
        label: file.name,
        ref: await this.rowRef("lix_file", file.id),
      });
    return {
      conversations,
      comments,
      account,
      targets,
      files,
      checkpoint,
    };
  }

  async createComment({ conversationId, body }) {
    return this.mutate(async () => {
      if (typeof conversationId !== "string" || conversationId.length === 0) {
        throw new Error("conversation_id is required");
      }
      if (
        !(
          await this.query(
            "SELECT id FROM zettel_demo_conversation WHERE id = $1",
            [conversationId],
          )
        ).length
      ) {
        const error = new Error("conversation not found");
        error.statusCode = 404;
        throw error;
      }
      assertValidDocumentBody(body);
      const comment = {
        id: `comment-${randomUUID()}`,
        conversationId,
        authorId: await this.lix.activeAccountId(),
        body: clone(body),
        createdAt: new Date().toISOString(),
      };
      await this.withGlobalBranch(() => this.insertComment(comment));
      return {
        id: comment.id,
        conversation_id: comment.conversationId,
        author_id: comment.authorId,
        body: comment.body,
        created_at: comment.createdAt,
      };
    });
  }

  async updateComment(id, body) {
    return this.mutate(async () => {
      assertValidDocumentBody(body);
      const result = await this.withGlobalBranch(() =>
        this.execute(
          "UPDATE zettel_demo_comment SET body = $1 WHERE id = $2 RETURNING id, conversation_id, author_id, body, created_at",
          [this.sdk.Value.jsonb(body), id],
        ),
      );
      if (!result.rows[0]) {
        const error = new Error("comment not found");
        error.statusCode = 404;
        throw error;
      }
      return result.rows[0];
    });
  }

  async uploadFile({ name, mediaType, bytes }) {
    return this.mutate(async () => {
      const idHint = randomUUID();
      const fileName = safeFileName(name);
      const path = `/uploads/${idHint}-${fileName}`;
      const result = await this.execute(
        "INSERT INTO lix_file (path, content, lixcol_metadata) VALUES ($1, $2, $3) RETURNING id, name, lixcol_metadata",
        [
          path,
          asBytes(bytes),
          this.sdk.Value.jsonb({
            mediaType: mediaType || "application/octet-stream",
            originalName: fileName,
          }),
        ],
      );
      const row = result.rows[0];
      return {
        id: row.id,
        name: displayFileName(row),
        mediaType: mediaType || mediaTypeFromMetadata(row.lixcol_metadata),
      };
    });
  }

  async readFile(id) {
    const rows = await this.query(
      "SELECT id, name, content, lixcol_metadata FROM lix_file WHERE id = $1 AND path NOT LIKE '/.lix/%'",
      [id],
    );
    if (!rows[0]) {
      const error = new Error("file not found");
      error.statusCode = 404;
      throw error;
    }
    return {
      id: rows[0].id,
      name: displayFileName(rows[0]),
      mediaType: mediaTypeFromMetadata(rows[0].lixcol_metadata),
      bytes: asBytes(rows[0].content),
    };
  }

  async exportSnapshot() {
    await this.mutationTail;
    return new Uint8Array(
      await new Response(this.lix.exportSnapshot()).arrayBuffer(),
    );
  }

  async close() {
    if (this.closed) return;
    await this.mutationTail;
    this.closed = true;
    await this.lix.close();
  }
}

export async function createDemo({
  persist = true,
  snapshotPath = DEFAULT_SNAPSHOT_PATH,
} = {}) {
  const sdkPath = process.env.LIX_SDK_PATH || DEFAULT_SDK_PATH;
  const sdk = await import(pathToFileURL(resolve(sdkPath)).href);
  const hasSnapshot = persist && (await pathExists(snapshotPath));
  let lix;
  if (hasSnapshot) {
    const bytes = await readFile(snapshotPath);
    lix = await sdk.openLix.fromSnapshot(new Uint8Array(bytes));
  } else {
    lix = await sdk.openLix();
  }
  const model = new DemoModel({ sdk, lix, persist, snapshotPath });
  try {
    await model.initialize();
    return model;
  } catch (error) {
    await lix.close().catch(() => {});
    throw error;
  }
}

export { safeFileName };
