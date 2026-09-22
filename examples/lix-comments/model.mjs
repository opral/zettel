import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { openLix } from '../../../lix/packages/js-sdk/dist/index.js';
import { assertDocument } from '@opral/zettel-ast';
import { fromMarkdown } from '@opral/zettel-markdown';

const column = (name, type = 'text') => ({ name, type, nullable: false });
const schema = (key, columns, extra = {}) => ({ $schema: 'https://lix.dev/schema-v1.json', key, columns, primary_key: ['id'], ...extra });
export const schemas = [
  schema('demo_account', [column('id'), column('name')]),
  schema('demo_markdown_paragraph', [column('id'), column('file_path'), column('position', 'int8'), column('text')]),
  schema('demo_csv_row', [column('id'), column('file_path'), column('position', 'int8'), column('data', 'jsonb')]),
  schema('demo_conversation', [column('id'), column('target'), column('title')]),
  schema('demo_comment', [column('id'), column('conversation_id'), column('author_id'), column('body', 'jsonb'), column('created_at', 'timestamptz')], {
    foreign_keys: [
      { columns: ['conversation_id'], references: { schema_key: 'demo_conversation', columns: ['id'] } },
      { columns: ['author_id'], references: { schema_key: 'demo_account', columns: ['id'] } },
    ],
  }),
];
export const defaultPath = new URL('./.data/comments-v2.lix', import.meta.url).pathname;
export async function openModel({ path = defaultPath, persist = true } = {}) {
  let bytes;
  if (persist) {
    try { bytes = await readFile(path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const lix = bytes ? await openLix.fromSnapshot(new Uint8Array(bytes)) : await openLix();
  const query = async (sql, params = []) => (await lix.execute(sql, params)).rows;
  const ref = async (table, id) => (await query(`SELECT lix_row_ref('${table}', $1) AS ref`, [id]))[0].ref;
  async function save() {
    if (!persist) return;
    const snapshot = new Uint8Array(await new Response(lix.exportSnapshot()).arrayBuffer());
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, snapshot);
    await rename(temporary, path);
  }
  if (!bytes) {
    for (const value of schemas) await lix.execute('INSERT INTO lix_registered_schema (value) VALUES (CAST($1 AS JSONB))', [JSON.stringify(value)]);
    await lix.execute("INSERT INTO demo_account (id, name) VALUES ('alice', 'Alice'), ('bob', 'Bob')");
    await lix.execute("INSERT INTO demo_markdown_paragraph (id, file_path, position, text) VALUES ('paragraph-1', '/guide.md', 0, 'Ship the release on Monday.')");
    await lix.execute('INSERT INTO demo_csv_row (id, file_path, position, data) VALUES ($1, $2, $3, CAST($4 AS JSONB))', ['row-1', '/budget.csv', 0, JSON.stringify({ team: 'Design', budget: 100 })]);
    const commit = (await query('SELECT commit_id FROM lix_create_checkpoint()'))[0].commit_id;
    for (const [id, table, target, title] of [
      ['checkpoint', 'lix_commit', commit, 'Release checkpoint'],
      ['paragraph', 'demo_markdown_paragraph', 'paragraph-1', 'Guide · release paragraph'],
      ['csv', 'demo_csv_row', 'row-1', 'Budget · Design row'],
    ]) await lix.execute('INSERT INTO demo_conversation (id, target, title) VALUES ($1, $2, $3)', [id, String(await ref(table, target)), title]);
    await save();
  }
  let tail = Promise.resolve();
  const serial = (fn) => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
  };
  async function state() {
    return {
      conversations: await query('SELECT id, target, title FROM demo_conversation ORDER BY id'),
      comments: await query('SELECT id, conversation_id, author_id, body, created_at FROM demo_comment ORDER BY created_at, id'),
      accounts: await query('SELECT id, name FROM demo_account ORDER BY id'),
      paragraphs: await query('SELECT id, file_path, position, text FROM demo_markdown_paragraph ORDER BY position'),
      csvRows: await query('SELECT id, file_path, position, data FROM demo_csv_row ORDER BY position'),
    };
  }
  return {
    lix, query, ref, save, serial, state,
    async create({ conversationId, authorId = 'alice', body }) {
      assertDocument(body);
      const id = randomUUID();
      await lix.execute('INSERT INTO demo_comment (id, conversation_id, author_id, body, created_at) VALUES ($1, $2, $3, CAST($4 AS JSONB), $5)', [id, conversationId, authorId, JSON.stringify(body), new Date().toISOString()]);
      await save();
      return { id };
    },
    async update(id, body) {
      assertDocument(body);
      if (!(await query('SELECT id FROM demo_comment WHERE id = $1', [id])).length) throw new Error('Comment not found');
      await lix.execute('UPDATE demo_comment SET body = CAST($1 AS JSONB) WHERE id = $2', [JSON.stringify(body), id]);
      await save();
      return { id };
    },
    async close() { await tail; await lix.close(); },
  };
}
export const initialMarkdown = 'Ready for **review**.\n\n- [ ] Check the release notes\n- [x] Run tests\n\n| Check | Result |\n| --- | --- |\n| Build | Passed |\n';
export const initialBody = () => fromMarkdown(initialMarkdown);
