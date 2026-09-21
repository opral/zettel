import {
  $getRoot,
  CLEAR_HISTORY_COMMAND,
  createEditor,
  type LexicalEditor,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from "lexical";
import {
  assertDocument,
  type ValidationOptions,
} from "@opral/zettel-ast";
import { createDocument, type Document } from "./types.js";
import {
  createLexicalNode,
  exportBlockNode,
  type NodeRegistryOptions,
  createNodeRegistry,
  type ZettelNodeRegistry,
} from "./nodes/index.js";

/** Validate core structure while retaining application atoms as read-only JSON.
 * Payload semantics remain the application's responsibility; this adapter does
 * not pretend to understand unregistered extensions.
 */
export function assertEditorDocument(
  value: unknown,
): asserts value is Document {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getOwnPropertyDescriptor(value, "_type")?.value !== "zettel_doc"
  ) {
    throw new Error("Unsupported Zettel document type");
  }
  const validators: NonNullable<ValidationOptions["blocks"]> = {};
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const descriptors = Object.getOwnPropertyDescriptors(node);
    const type: unknown = descriptors._type?.value;
    if (typeof type === "string" && !type.startsWith("zettel_")) {
      Object.defineProperty(validators, type, {
        value: () => [],
        enumerable: true,
        configurable: true,
      });
    }
    for (const descriptor of Object.values(descriptors)) {
      if ("value" in descriptor) visit(descriptor.value);
    }
  };
  visit(value);
  assertDocument(value, { blocks: validators, inline: validators });
}

function isRegistry(
  value: ZettelNodeRegistry | NodeRegistryOptions | undefined,
): value is ZettelNodeRegistry {
  return Boolean(value && "nodes" in value && "extensionTypes" in value);
}
function detachedEditor(
  registry?: ZettelNodeRegistry | NodeRegistryOptions,
): LexicalEditor {
  const nodeRegistry = isRegistry(registry)
    ? registry
    : createNodeRegistry(registry);
  return createEditor({
    nodes: [...nodeRegistry.nodes],
    onError: (error) => {
      throw error;
    },
  });
}

/** Use the actual node serializers, so saved Lexical state and live edits agree. */
export function toLexicalState(
  document: Document,
  registry?: ZettelNodeRegistry | NodeRegistryOptions,
): SerializedEditorState {
  assertEditorDocument(document);
  const editor = detachedEditor(registry);
  loadDocument(editor, document, registry);
  return editor.getEditorState().toJSON();
}

/** Restore the supported Lexical envelope without silently defaulting a bad root. */
export function fromLexicalState(
  state:
    | SerializedEditorState
    | { root?: { children?: SerializedLexicalNode[] } },
): Document {
  const root = state?.root as
    | { type?: unknown; version?: unknown; children?: unknown }
    | undefined;
  if (
    !root ||
    root.type !== "root" ||
    root.version !== 1 ||
    !Array.isArray(root.children)
  ) {
    throw new Error(
      "Expected a Lexical root with version 1 and a children array",
    );
  }
  const editor = detachedEditor();
  const parsed = editor.parseEditorState(state as SerializedEditorState);
  let document: Document | undefined;
  parsed.read(() => {
    document = createDocument($getRoot().getChildren().map(exportBlockNode));
  });
  assertEditorDocument(document);
  return document;
}

/** Validate before clearing the editor: an unsupported version must leave it intact. */
export function loadDocument(
  editor: LexicalEditor,
  document: Document,
  registry?: ZettelNodeRegistry | NodeRegistryOptions,
): void {
  assertEditorDocument(document);
  const nodeRegistry = isRegistry(registry)
    ? registry
    : createNodeRegistry(registry);
  // A loaded document starts a new editing session. Do not allow undo to
  // restore content from a different comment or from before an import.
  // Clear first so the load itself becomes the fresh undo baseline.
  editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  editor.update(
    () => {
      const nodes = document.blocks.map((block) =>
        createLexicalNode(block, nodeRegistry),
      );
      const root = $getRoot();
      root.clear();
      root.append(...nodes);
    },
    { discrete: true },
  );
}

/** Export only valid document structure; unknown application atoms stay opaque. */
export function exportDocument(editor: LexicalEditor): Document {
  let result: Document | undefined;
  editor.getEditorState().read(() => {
    result = createDocument($getRoot().getChildren().map(exportBlockNode));
  });
  assertEditorDocument(result);
  return result;
}
