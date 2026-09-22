import { readdir, rm } from "node:fs/promises";
const packages = new URL("../packages/", import.meta.url);
for (const entry of await readdir(packages, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith("zettel-")) continue;
  // Delete generated outputs only, so removed APIs cannot survive in package tarballs.
  await rm(new URL(`${entry.name}/dist/`, packages), {
    recursive: true,
    force: true,
  });
  await rm(new URL(`${entry.name}/tsconfig.tsbuildinfo`, packages), {
    force: true,
  });
}
