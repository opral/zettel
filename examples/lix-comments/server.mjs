import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BodyValidationError,
  MAX_COMMENT_BODY_BYTES,
  MAX_UPLOAD_BYTES,
  createDemo,
  validateDocumentBody,
} from "./model.mjs";

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PORT = 4174;
const JSON_LIMIT = MAX_COMMENT_BODY_BYTES;
const UPLOAD_LIMIT = MAX_UPLOAD_BYTES;

const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/style.css", { file: "style.css", type: "text/css; charset=utf-8" }],
]);

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function empty(res, status, headers = {}) {
  res.writeHead(status, headers);
  res.end();
}

function requestError(error) {
  if (
    error?.statusCode === 413 ||
    error?.statusCode === 415 ||
    error?.statusCode === 403
  ) {
    return { status: error.statusCode, payload: { error: error.message } };
  }
  if (error?.statusCode === 404)
    return { status: 404, payload: { error: error.message } };
  if (error instanceof BodyValidationError) {
    return {
      status: 400,
      payload: { error: error.message, errors: error.errors },
    };
  }
  if (
    /required|invalid|must be|not found|unknown/i.test(error?.message || "")
  ) {
    return { status: 400, payload: { error: error.message } };
  }
  return { status: 500, payload: { error: "Internal server error" } };
}

async function readRequestBody(request, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > limit) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

async function readJson(request) {
  const bytes = await readRequestBody(request, JSON_LIMIT);
  if (bytes.byteLength === 0) {
    const error = new Error("JSON request body is required");
    error.statusCode = 400;
    throw error;
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function contentType(request) {
  const raw = request.headers["content-type"];
  if (Array.isArray(raw))
    return raw[0]?.split(";", 1)[0] || "application/octet-stream";
  return (
    (raw || "application/octet-stream").split(";", 1)[0] ||
    "application/octet-stream"
  );
}

function contentDisposition(name) {
  const safe =
    basename(String(name || "download.bin")).replace(
      /[^A-Za-z0-9._-]+/g,
      "_",
    ) || "download.bin";
  return `attachment; filename="${safe.replaceAll('"', "_")}"`;
}

async function serveStatic(request, response, pathname) {
  const descriptor = STATIC_FILES.get(pathname);
  if (!descriptor) return false;
  if (request.method !== "GET" && request.method !== "HEAD") {
    empty(response, 405, { allow: "GET, HEAD" });
    return true;
  }
  const path = join(APP_DIR, descriptor.file);
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "content-type": descriptor.type,
      "content-length": metadata.size,
      "cache-control": "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(path).pipe(response);
  } catch {
    json(response, 404, { error: "Static asset not found" });
  }
  return true;
}

async function handleApi(request, response, model, url) {
  const { pathname } = url;
  if (request.method === "OPTIONS") {
    empty(response, 204);
    return;
  }

  try {
    const origin = request.headers.origin;
    if (
      origin &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method || "")
    ) {
      const expectedOrigin = `http://${request.headers.host || "127.0.0.1"}`;
      if (origin !== expectedOrigin) {
        json(response, 403, { error: "Cross-origin mutation rejected" });
        return;
      }
    }
    const requireJson = () => {
      if (!contentType(request).toLowerCase().startsWith("application/json")) {
        const error = new Error("JSON content-type is required");
        error.statusCode = 415;
        throw error;
      }
    };
    if (request.method === "GET" && pathname === "/api/state") {
      json(response, 200, await model.state());
      return;
    }
    if (request.method === "GET" && pathname === "/api/snapshot") {
      const bytes = await model.exportSnapshot();
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="demo.lix"',
        "content-length": bytes.byteLength,
        "cache-control": "no-store",
      });
      response.end(bytes);
      return;
    }
    if (request.method === "POST" && pathname === "/api/validate") {
      requireJson();
      const value = await readJson(request);
      json(response, 200, validateDocumentBody(value?.body ?? value));
      return;
    }
    if (request.method === "POST" && pathname === "/api/comments") {
      requireJson();
      const value = await readJson(request);
      const comment = await model.createComment({
        conversationId: value?.conversation_id,
        body: value?.body,
      });
      json(response, 201, comment);
      return;
    }
    const commentMatch = pathname.match(/^\/api\/comments\/([^/]+)$/);
    if (request.method === "PUT" && commentMatch) {
      requireJson();
      const value = await readJson(request);
      const comment = await model.updateComment(
        decodeURIComponent(commentMatch[1]),
        value?.body ?? value,
      );
      json(response, 200, comment);
      return;
    }
    if (request.method === "POST" && pathname === "/api/files") {
      const bytes = await readRequestBody(request, UPLOAD_LIMIT);
      const rawName = request.headers["x-file-name"];
      const name = Array.isArray(rawName) ? rawName[0] : rawName;
      const file = await model.uploadFile({
        name,
        mediaType: contentType(request),
        bytes,
      });
      json(response, 201, file);
      return;
    }
    const fileMatch = pathname.match(/^\/api\/files\/([^/]+)$/);
    if (request.method === "GET" && fileMatch) {
      const file = await model.readFile(decodeURIComponent(fileMatch[1]));
      response.writeHead(200, {
        "content-type": file.mediaType,
        "content-length": file.bytes.byteLength,
        "content-disposition": contentDisposition(file.name),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(file.bytes);
      return;
    }
    json(response, 404, { error: "API route not found" });
  } catch (error) {
    if (error?.statusCode === 413) {
      json(response, 413, { error: error.message });
      return;
    }
    const failure = requestError(error);
    json(response, failure.status, failure.payload);
  }
}

export async function startServer({
  port = Number(process.env.PORT || DEFAULT_PORT),
  persist = true,
  snapshotPath,
} = {}) {
  const model = await createDemo({
    persist,
    ...(snapshotPath ? { snapshotPath } : {}),
  });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(
        request.url || "/",
        `http://${request.headers.host || "127.0.0.1"}`,
      );
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, model, url);
        return;
      }
      if (!(await serveStatic(request, response, url.pathname)))
        json(response, 404, { error: "Not found" });
    } catch (error) {
      const failure = requestError(error);
      json(response, failure.status, failure.payload);
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });

  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;
  return {
    server,
    model,
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    async close() {
      await model.close();
      await new Promise((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      );
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const running = await startServer();
  console.log(`Lix comments demo listening at ${running.url}`);
}
