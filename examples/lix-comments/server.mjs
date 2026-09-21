import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { openModel } from './model.mjs';
export async function startServer({ port = 49705, path, persist = true } = {}) {
  const model = await openModel({ path, persist });
  const server = await createServer({
    root: fileURLToPath(new URL('.', import.meta.url)),
    configFile: false,
    server: { host: '127.0.0.1', port, strictPort: true },
    plugins: [{ name: 'lix-comments-api', configureServer(vite) {
      vite.middlewares.use('/api', (req, res) => {
        model.serial(async () => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          const origin = req.headers.origin;
          if (req.method !== 'GET' && origin && origin !== `http://${req.headers.host}`) {
            res.statusCode = 403; res.end(JSON.stringify({ error: 'Cross-origin mutation rejected' })); return;
          }
          if (req.method === 'GET' && req.url === '/state') { res.end(JSON.stringify(await model.state())); return; }
          if (req.method !== 'POST' || !/^\/comments(?:\/[^/]+)?$/.test(req.url)) {
            res.statusCode = 404; res.end(JSON.stringify({ error: 'Unknown endpoint' })); return;
          }
          if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON');
          let length = 0; const parts = [];
          for await (const part of req) { length += part.length; if (length > 2 * 1024 * 1024) throw new Error('Comment is too large'); parts.push(part); }
          const input = JSON.parse(Buffer.concat(parts).toString());
          const result = req.url === '/comments' ? await model.create(input) : await model.update(decodeURIComponent(req.url.slice('/comments/'.length)), input.body);
          res.end(JSON.stringify(result));
        }).catch(error => { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); });
      });
    } }],
  });
  try { await server.listen(); } catch (e) { await model.close(); throw e; }
  return { model, server, url: `http://localhost:${server.httpServer.address().port}`, async close() { await server.close(); await model.close(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startServer({ port: Number(process.env.PORT ?? 49705) });
  console.log(`Lix comments: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
