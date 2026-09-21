import { validateDocument } from "../../packages/zettel-ast/dist/v1/index.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => typeof value === "string" && value.length > 0;
function fields(node, allowed) {
  return Object.keys(node)
    .filter((key) => !allowed.includes(key))
    .map((key) => `Unknown field: ${key}`);
}
export const lixExtensions = {
  inline: {
    lix_ref(node) {
      const errors = fields(node, ["_type", "_key", "target", "label"]);
      if (!text(node.target) || !node.target.startsWith("lix_row_ref:v1:"))
        errors.push("target must be an engine-generated RowRef string");
      if (!text(node.label)) errors.push("label must be nonempty text");
      return errors;
    },
  },
  blocks: {
    lix_attachment(node) {
      const errors = fields(node, [
        "_type",
        "_key",
        "file_id",
        "display",
        "alt",
        "caption",
      ]);
      if (typeof node.file_id !== "string" || !uuid.test(node.file_id))
        errors.push("file_id must be a file UUID");
      if (!["file", "image"].includes(node.display))
        errors.push("display must be file or image");
      for (const key of ["alt", "caption"])
        if (node[key] !== undefined && typeof node[key] !== "string")
          errors.push(`${key} must be text`);
      return errors;
    },
  },
};
/** Shape validation only. Reference existence/authorization is not a document invariant. */
export function validateBody(body) {
  return validateDocument(body, lixExtensions);
}
