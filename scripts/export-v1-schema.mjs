import { writeFile } from "node:fs/promises";
import { documentSchema } from "../packages/zettel-ast/dist/index.js";
const text = JSON.stringify(documentSchema, null, 2) + "\n";
await Promise.all(
  ["../spec/v1.schema.json", "../packages/zettel-ast/schema.json"].map((path) =>
    writeFile(new URL(path, import.meta.url), text),
  ),
);
