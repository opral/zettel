export * from "./types.js";
export * from "./nodes/index.js";
export * from "./lexical-state.js";
export * from "./clipboard.js";
export { $removeSelectedText } from "./selection.js";
export { SET_ZETTEL_LINK_COMMAND, $setZettelLink, getZettelDocument, registerZettelLexicalPlugin, setZettelListItemChecked, type ZettelLexicalPluginOptions } from "./plugin.js";

import { createEditor, type CreateEditorArgs, type LexicalEditor } from "lexical";
import { createNodeRegistry, type NodeRegistryOptions, type ZettelNodeRegistry, ZettelNodes } from "./nodes/index.js";

export interface ZettelEditorOptions extends Omit<CreateEditorArgs, "nodes"> {
  registry?: ZettelNodeRegistry | NodeRegistryOptions;
}

/** Create a configured Lexical editor for a vanilla app or playground. */
export function createZettelEditor(options: ZettelEditorOptions = {}): LexicalEditor {
  const registry = options.registry && "nodes" in options.registry ? options.registry : createNodeRegistry(options.registry);
  return createEditor({ ...options, nodes: [...(registry?.nodes ?? ZettelNodes)] });
}
