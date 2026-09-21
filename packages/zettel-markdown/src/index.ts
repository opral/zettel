import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import type {
  Block,
  CoreBlock,
  CoreInline,
  CoreListItem,
  CoreTable,
  CoreTableCell,
  CoreTableRow,
  Document,
  Inline,
  Link,
  ListItem as ZettelListItem,
  Table,
  TableCell,
  TableRow,
} from "@opral/zettel-ast";
import { assertDocument, generateKey, SCHEMA_URL } from "@opral/zettel-ast";
import type {
  BlockContent,
  Definition,
  Heading,
  Link as MdastLink,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table as MdastTable,
  TableCell as MdastTableCell,
  TableRow as MdastTableRow,
} from "mdast";

/** An error raised when Markdown cannot represent a Zettel value faithfully. */
export class MarkdownConversionError extends Error {
  readonly path?: string;

  constructor(message: string, path?: string) {
    super(path ? `${message} (${path})` : message);
    this.name = "MarkdownConversionError";
    this.path = path;
  }
}

type MarkDefinitionMap = Map<string, Link>;
type MarkdownReferenceMap = Map<string, Pick<Definition, "url" | "title">>;

const coreBlockTypes = new Set([
  "zettel_text",
  "zettel_list",
  "zettel_quote",
  "zettel_code",
  "zettel_rule",
  "zettel_table",
  "zettel_html",
]);
const coreInlineTypes = new Set([
  "zettel_span",
  "zettel_break",
  "zettel_image",
  "zettel_html_inline",
]);
const softLineEntitySentinel = "\uE000";
const literalNumericEntitySentinel = "\uE001";

/** Parse CommonMark plus the complete remark GFM extension into a Zettel document. */
export function fromMarkdown(source: string): Document {
  if (typeof source !== "string") {
    throw new MarkdownConversionError("Markdown source must be a string");
  }

  const tree = markdownParser.parse(source) as Root;
  repairEscapedEmailAutolinks(tree.children, source);
  const references: MarkdownReferenceMap = new Map();
  collectReferences(tree.children, references);
  const blocks = blocksFromMdast(tree.children, "blocks", references, source);
  return { $schema: SCHEMA_URL, blocks } as Document;
}

/**
 * mdast-util-gfm-autolink-literal accepts an escaped plus inside an angle
 * wrapped email where micromark's GFM HTML tokenizer keeps the source literal.
 * Repair that narrow upstream divergence before converting to the Zettel AST.
 */
function repairEscapedEmailAutolinks(
  nodes: readonly RootContent[],
  source: string,
): void {
  for (const node of nodes) {
    if (node.type === "paragraph") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const sourceValue =
        start !== undefined && end !== undefined
          ? source.slice(start, end)
          : undefined;
      const children = node.children;
      if (sourceValue && children.length === 3) {
        const left = children[0];
        const link = children[1];
        const right = children[2];
        const candidate = /<([^<>\n]*\\\+[^<>\n]*)>/.exec(sourceValue);
        if (
          candidate &&
          left?.type === "text" &&
          left.value.endsWith("<") &&
          link?.type === "link" &&
          link.url.startsWith("mailto:") &&
          right?.type === "text" &&
          right.value.startsWith(">")
        ) {
          children.splice(0, 3, {
            type: "text",
            value: `${left.value.slice(0, -1)}<${candidate[1]!.replaceAll("\\", "")}>${right.value.slice(1)}`,
          });
        }
      }
    }
    if ("children" in node && Array.isArray(node.children)) {
      repairEscapedEmailAutolinks(node.children as RootContent[], source);
    }
  }
}

function blocksFromMdast(
  nodes: readonly RootContent[],
  path: string,
  references: MarkdownReferenceMap,
  source: string,
): CoreBlock[] {
  const blocks: CoreBlock[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const grouped = rawHtmlBlock(nodes, index, source);
    if (grouped) {
      blocks.push(grouped.block);
      index = grouped.nextIndex - 1;
      continue;
    }
    const node = nodes[index];
    if (!node) continue;
    const block = blockFromMdast(node, `${path}[${index}]`, references, source);
    if (block) blocks.push(block);
  }
  return blocks;
}

function rawHtmlBlock(
  nodes: readonly RootContent[],
  index: number,
  source: string,
): { block: CoreBlock; nextIndex: number } | null {
  const node = nodes[index];
  if (!node || node.type !== "html") return null;
  const opening = /^\s*<([A-Za-z][A-Za-z0-9:-]*)(?:\s[^>]*|)>/.exec(node.value);
  if (!opening || /\/\s*>\s*$/.test(node.value)) return null;
  const tag = opening[1];
  if (!tag || new RegExp(`</${escapeRegExp(tag)}\\s*>`, "i").test(node.value)) {
    return null;
  }
  for (let end = index + 1; end < nodes.length; end += 1) {
    const candidate = nodes[end];
    // A blank line inside an HTML container can re-enable Markdown parsing.
    // Keep those parsed blocks visible instead of swallowing them into the
    // surrounding raw source. Contiguous HTML nodes remain one source block.
    if (nodes.slice(index + 1, end).some((child) => child?.type !== "html"))
      continue;
    if (
      candidate?.type !== "html" ||
      !new RegExp(`</${escapeRegExp(tag)}\\s*>`, "i").test(candidate.value)
    ) {
      continue;
    }
    const startOffset = node.position?.start.offset;
    const endOffset = candidate.position?.end.offset;
    if (startOffset === undefined || endOffset === undefined) return null;
    return {
      block: {
        type: "zettel_html",
        zettel_key: generateKey(),
        value: source.slice(startOffset, endOffset),
      },
      nextIndex: end + 1,
    };
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectReferences(
  nodes: readonly unknown[],
  references: MarkdownReferenceMap,
): void {
  for (const value of nodes) {
    if (!value || typeof value !== "object") continue;
    const node = value as {
      type?: unknown;
      identifier?: unknown;
      url?: unknown;
      title?: unknown;
      children?: unknown;
    };
    if (
      node.type === "definition" &&
      typeof node.identifier === "string" &&
      typeof node.url === "string" &&
      (node.title === null || typeof node.title === "string")
    ) {
      if (!references.has(node.identifier))
        references.set(node.identifier, {
          url: node.url,
          title: node.title,
        });
    }
    if (Array.isArray(node.children))
      collectReferences(node.children, references);
  }
}

/** Serialize a Zettel document with remark's canonical GFM serializer. */
export function toMarkdown(document: Document): string {
  try {
    assertDocument(document);
  } catch (error) {
    if (error instanceof MarkdownConversionError) throw error;
    throw new MarkdownConversionError(
      error instanceof Error ? error.message : "Invalid Zettel document",
    );
  }
  const children = document.blocks.map((block, index) =>
    mdastFromBlock(block, `blocks[${index}]`),
  );
  // Resource links avoid autolink escaping ambiguities for literal backslashes
  // in URLs while retaining the same GFM link semantics.
  const output = markdownWriter.stringify({ type: "root", children });
  // `mdast-util-to-markdown` escapes the ampersand in a character reference
  // even though GFM needs `&#10;` here to keep decoded blank lines in a
  // paragraph. Undo only that serializer escape for the generated reference.
  return (
    output
      .replaceAll(softLineEntitySentinel, "&#10;")
      // Keep a literal numeric reference (for example an escaped `&#10;`) from
      // becoming a decoded soft line ending when the canonical output is read.
      .replaceAll(literalNumericEntitySentinel, "&amp;")
      // Escape plus signs in plain angle-wrapped email text. This keeps
      // mdast's text-only value from being reinterpreted as an autolink.
      .replace(/(\\<[^>\n]*?)\+(\\?@[^>\n]*>)/g, "$1\\+$2")
  );
}

function disableGfmFootnotes(this: {
  data: () => { micromarkExtensions?: unknown[] };
}): void {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({
    disable: {
      null: [
        "gfmFootnoteDefinition",
        "gfmFootnoteCall",
        "gfmPotentialFootnoteCall",
      ],
    },
  });
}

const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(disableGfmFootnotes);
const markdownWriter = unified()
  .use(remarkStringify, { resourceLink: true })
  .use(remarkGfm);

function blockFromMdast(
  node: RootContent,
  path: string,
  references: MarkdownReferenceMap,
  source: string,
): CoreBlock | null {
  switch (node.type) {
    case "paragraph": {
      const converted = inlineFromMdast(node.children, path, references);
      return {
        type: "zettel_text",
        zettel_key: generateKey(),
        style: "normal",
        children: converted.children,
        markDefs: converted.markDefs,
      };
    }
    case "heading": {
      const converted = inlineFromMdast(node.children, path, references);
      return {
        type: "zettel_text",
        zettel_key: generateKey(),
        style: `h${node.depth}` as `h${1 | 2 | 3 | 4 | 5 | 6}`,
        children: converted.children,
        markDefs: converted.markDefs,
      };
    }
    case "list":
      return listFromMdast(node, path, references, source);
    case "blockquote":
      return {
        type: "zettel_quote",
        zettel_key: generateKey(),
        blocks: blocksFromMdast(
          node.children,
          `${path}.blocks`,
          references,
          source,
        ),
      };
    case "code":
      return {
        type: "zettel_code",
        zettel_key: generateKey(),
        code: node.value,
        ...(node.lang ? { language: node.lang } : {}),
        ...(node.meta ? { meta: node.meta } : {}),
      };
    case "thematicBreak":
      return { type: "zettel_rule", zettel_key: generateKey() };
    case "table":
      return tableFromMdast(node, path, references);
    case "html":
      return {
        type: "zettel_html",
        zettel_key: generateKey(),
        value: node.value,
      };
    case "definition":
      // Definitions are consumed by mdast links and carry no document content.
      return null;
    default:
      throw unsupportedImport(node.type, path);
  }
}

function listFromMdast(
  node: List,
  path: string,
  references: MarkdownReferenceMap,
  source: string,
): CoreBlock {
  const items = node.children.map((item, index) =>
    listItemFromMdast(item, `${path}.items[${index}]`, references, source),
  );
  return {
    type: "zettel_list",
    zettel_key: generateKey(),
    kind: node.ordered ? "number" : "bullet",
    ...(node.ordered ? { start: node.start ?? 1 } : {}),
    spread: (node.spread ?? false) || items.some((item) => item.spread),
    items,
  };
}

function listItemFromMdast(
  node: ListItem,
  path: string,
  references: MarkdownReferenceMap,
  source: string,
): CoreListItem {
  const blocks = blocksFromMdast(
    node.children,
    `${path}.blocks`,
    references,
    source,
  );
  return {
    type: "zettel_list_item" as const,
    zettel_key: generateKey(),
    blocks,
    spread: node.spread ?? false,
    ...(node.checked === true || node.checked === false
      ? { checked: node.checked }
      : {}),
  };
}

function tableFromMdast(
  node: MdastTable,
  path: string,
  references: MarkdownReferenceMap,
): CoreTable {
  if (node.children.length === 0) {
    throw new MarkdownConversionError(
      "GFM tables must contain at least one row",
      path,
    );
  }
  const width = node.children[0]?.children.length ?? 0;
  if (width === 0) {
    throw new MarkdownConversionError(
      "GFM tables must contain at least one column",
      path,
    );
  }
  const rows = node.children.map((row, index) => {
    return tableRowFromMdast(row, `${path}.rows[${index}]`, references, width);
  });
  return {
    type: "zettel_table",
    zettel_key: generateKey(),
    align: Array.from(
      { length: width },
      (_, index) => node.align?.[index] ?? null,
    ),
    rows,
  };
}

function tableRowFromMdast(
  node: MdastTableRow,
  path: string,
  references: MarkdownReferenceMap,
  width: number,
): CoreTableRow {
  return {
    type: "zettel_table_row",
    zettel_key: generateKey(),
    // cmark-GFM pads short rows and ignores cells beyond the header width.
    cells: Array.from({ length: width }, (_, index) => {
      const cell = node.children[index];
      return cell
        ? tableCellFromMdast(cell, `${path}.cells[${index}]`, references)
        : {
            type: "zettel_table_cell" as const,
            zettel_key: generateKey(),
            children: [],
            markDefs: [],
          };
    }),
  };
}

function tableCellFromMdast(
  node: MdastTableCell,
  path: string,
  references: MarkdownReferenceMap,
): CoreTableCell {
  const converted = inlineFromMdast(node.children, path, references);
  return {
    type: "zettel_table_cell",
    zettel_key: generateKey(),
    children: converted.children,
    markDefs: converted.markDefs,
  };
}

function inlineFromMdast(
  nodes: PhrasingContent[],
  path: string,
  references: MarkdownReferenceMap,
): {
  children: CoreInline[];
  markDefs: Link[];
} {
  const markDefs: Link[] = [];
  const definitions: MarkDefinitionMap = new Map();
  const children: CoreInline[] = [];
  for (const [index, node] of nodes.entries()) {
    children.push(
      ...inlineNodeFromMdast(
        node,
        [],
        definitions,
        `${path}.children[${index}]`,
        references,
      ),
    );
  }
  markDefs.push(...definitions.values());
  return { children, markDefs };
}

function inlineNodeFromMdast(
  node: PhrasingContent,
  marks: string[],
  definitions: MarkDefinitionMap,
  path: string,
  references: MarkdownReferenceMap,
): CoreInline[] {
  switch (node.type) {
    case "text":
      return node.value.length > 0
        ? [
            {
              type: "zettel_span",
              zettel_key: generateKey(),
              text: node.value,
              marks: canonicalMarks(marks),
            },
          ]
        : [];
    case "strong":
      return inlineChildren(
        node.children,
        appendMark(marks, "strong"),
        definitions,
        path,
        references,
      );
    case "emphasis":
      return inlineChildren(
        node.children,
        appendMark(marks, "em"),
        definitions,
        path,
        references,
      );
    case "delete":
      return inlineChildren(
        node.children,
        appendMark(marks, "strike-through"),
        definitions,
        path,
        references,
      );
    case "inlineCode":
      return [
        {
          type: "zettel_span",
          zettel_key: generateKey(),
          text: node.value,
          marks: canonicalMarks(appendMark(marks, "code")),
        },
      ];
    case "break":
      return [
        {
          type: "zettel_break",
          zettel_key: generateKey(),
          marks: canonicalMarks(marks),
        },
      ];
    case "image":
      return [
        {
          type: "zettel_image",
          zettel_key: generateKey(),
          src: node.url,
          alt: node.alt ?? "",
          ...(node.title !== null && node.title !== undefined
            ? { title: node.title }
            : {}),
          marks: canonicalMarks(marks),
        },
      ];
    case "link": {
      const key = linkDefinition(node, definitions);
      return inlineChildren(
        node.children,
        [...marks, key],
        definitions,
        path,
        references,
      );
    }
    case "linkReference": {
      const reference = references.get(node.identifier);
      if (!reference) throw unsupportedImport(node.type, path);
      const key = linkDefinitionFromUrl(
        reference.url,
        reference.title,
        definitions,
      );
      return inlineChildren(
        node.children,
        [...marks, key],
        definitions,
        path,
        references,
      );
    }
    case "imageReference": {
      const reference = references.get(node.identifier);
      if (!reference) throw unsupportedImport(node.type, path);
      return [
        {
          type: "zettel_image",
          zettel_key: generateKey(),
          src: reference.url,
          alt: node.alt ?? "",
          ...(reference.title !== null && reference.title !== undefined
            ? { title: reference.title }
            : {}),
          marks: canonicalMarks(marks),
        },
      ];
    }
    case "html":
      return [
        {
          type: "zettel_html_inline",
          zettel_key: generateKey(),
          value: node.value,
          marks: canonicalMarks(marks),
        },
      ];
    default:
      throw unsupportedImport(node.type, path);
  }
}

function inlineChildren(
  nodes: PhrasingContent[],
  marks: string[],
  definitions: MarkDefinitionMap,
  path: string,
  references: MarkdownReferenceMap,
): CoreInline[] {
  return nodes.flatMap((child, index) =>
    inlineNodeFromMdast(
      child,
      marks,
      definitions,
      `${path}.children[${index}]`,
      references,
    ),
  );
}

function appendMark(marks: string[], mark: string): string[] {
  return marks.includes(mark) ? [...marks] : [...marks, mark];
}

function linkDefinition(
  node: MdastLink,
  definitions: MarkDefinitionMap,
): string {
  return linkDefinitionFromUrl(node.url, node.title, definitions);
}

function linkDefinitionFromUrl(
  url: string,
  rawTitle: string | null | undefined,
  definitions: MarkDefinitionMap,
): string {
  const title = rawTitle ?? undefined;
  const signature = JSON.stringify([url, title]);
  const existing = definitions.get(signature);
  if (existing) return existing.zettel_key;
  const definition: Link = {
    type: "zettel_link",
    zettel_key: generateKey(),
    href: url,
    ...(title !== undefined ? { title } : {}),
  };
  definitions.set(signature, definition);
  return definition.zettel_key;
}

function mdastFromBlock(block: Block, path: string): BlockContent {
  if (!coreBlockTypes.has(block.type))
    throw unsupportedExport(block.type, path);
  const core = block as CoreBlock;
  switch (core.type) {
    case "zettel_text": {
      const converted = inlineToMdast(
        core.children,
        core.markDefs,
        `${path}.children`,
      );
      if (core.style === "normal")
        return { type: "paragraph", children: converted };
      if (/^h[1-6]$/.test(core.style)) {
        return {
          type: "heading",
          depth: Number(core.style.slice(1)) as Heading["depth"],
          children: converted,
        };
      }
      throw unsupportedExport(`text style ${core.style}`, path);
    }
    case "zettel_list":
      return {
        type: "list",
        ordered: core.kind === "number",
        start: core.kind === "number" ? core.start! : null,
        spread: core.spread,
        children: core.items.map((item, index) =>
          listItemToMdast(item, `${path}.items[${index}]`),
        ),
      };
    case "zettel_quote":
      return {
        type: "blockquote",
        children: core.blocks.map((child, index) =>
          mdastFromBlock(child, `${path}.blocks[${index}]`),
        ),
      };
    case "zettel_code":
      return {
        type: "code",
        lang: core.language ?? null,
        meta: core.meta ?? null,
        value: core.code,
      };
    case "zettel_rule":
      return { type: "thematicBreak" };
    case "zettel_table":
      return tableToMdast(core, path);
    case "zettel_html":
      return { type: "html", value: core.value };
    default:
      throw unsupportedExport("unknown core block", path);
  }
}

function listItemToMdast(item: ZettelListItem, path: string): ListItem {
  return {
    type: "listItem",
    spread: item.spread,
    checked: item.checked ?? null,
    children: item.blocks.map((block, index) =>
      mdastFromBlock(block, `${path}.blocks[${index}]`),
    ),
  };
}

function tableToMdast(block: Table, path: string): MdastTable {
  if (block.rows.length === 0 || block.rows[0]?.cells.length === 0) {
    throw new MarkdownConversionError(
      "GFM tables must contain at least one cell",
      path,
    );
  }
  const width = block.rows[0]?.cells.length ?? 0;
  if (block.align.length !== width) {
    throw new MarkdownConversionError(
      "GFM table alignment must match the number of columns",
      `${path}.align`,
    );
  }
  const rows: MdastTableRow[] = block.rows.map((row, index) => {
    if (row.cells.length !== width) {
      throw new MarkdownConversionError(
        "GFM table rows must be rectangular",
        `${path}.rows[${index}]`,
      );
    }
    return {
      type: "tableRow",
      children: row.cells.map((cell, cellIndex) =>
        tableCellToMdast(cell, `${path}.rows[${index}].cells[${cellIndex}]`),
      ),
    };
  });
  return { type: "table", align: block.align, children: rows };
}

function tableCellToMdast(cell: TableCell, path: string): MdastTableCell {
  return {
    type: "tableCell",
    children: inlineToMdast(cell.children, cell.markDefs, `${path}.children`),
  };
}

function inlineToMdast(
  children: Inline[],
  markDefs: Link[],
  path: string,
): PhrasingContent[] {
  const definitions = new Map(
    markDefs.map((definition) => [definition.zettel_key, definition]),
  );
  const output: PhrasingContent[] = [];
  const frames: Array<{ mark: string; children: PhrasingContent[] }> = [];

  const closeFrames = (depth: number): void => {
    while (frames.length > depth) {
      const frame = frames.pop();
      if (!frame) continue;
      const wrapped = wrapMark(frame.mark, frame.children, definitions, path);
      const parent = frames.at(-1);
      if (parent) parent.children.push(wrapped);
      else output.push(wrapped);
    }
  };

  children.forEach((child, index) => {
    if (!coreInlineTypes.has(child.type))
      throw unsupportedExport(child.type, `${path}[${index}]`);
    const core = child as CoreInline;
    const normalizedMarks = canonicalMarks(core.marks);
    if (normalizedMarks.includes("code") && core.type !== "zettel_span") {
      throw unsupportedExport(
        "code mark on non-text inline",
        `${path}[${index}]`,
      );
    }
    const marks = normalizedMarks.filter((mark) => mark !== "code");
    let shared = 0;
    while (
      shared < frames.length &&
      shared < marks.length &&
      frames[shared]?.mark === marks[shared]
    ) {
      shared += 1;
    }
    closeFrames(shared);
    for (let markIndex = shared; markIndex < marks.length; markIndex += 1) {
      frames.push({ mark: marks[markIndex]!, children: [] });
    }
    const node = inlineNodeToMdast(
      core,
      definitions,
      `${path}[${index}]`,
      children[index + 1]?.type === "zettel_html_inline",
    );
    const frame = frames.at(-1);
    if (frame) frame.children.push(node);
    else output.push(node);
  });
  closeFrames(0);
  return output;
}

function inlineNodeToMdast(
  inline: CoreInline,
  definitions: Map<string, Link>,
  path: string,
  preserveTrailingLineEnding = false,
): PhrasingContent {
  if (inline.type === "zettel_span") {
    const core = inline;
    if (core.text.length === 0)
      throw new MarkdownConversionError(
        "Spans must contain nonempty text",
        path,
      );
    const sourceText = core.marks.includes("code")
      ? core.text
      : core.text.replace(
          /&(?=#[0-9]+;|#x[0-9a-f]+;)/gi,
          literalNumericEntitySentinel,
        );
    const textValue =
      !core.marks.includes("code") &&
      (preserveTrailingLineEnding || /\n{2,}/.test(core.text))
        ? sourceText
            .replace(/\n$/, softLineEntitySentinel)
            .replaceAll("\n", softLineEntitySentinel)
        : sourceText;
    return core.marks.includes("code")
      ? { type: "inlineCode", value: textValue }
      : { type: "text", value: textValue };
  }
  if (inline.type === "zettel_break") return { type: "break" };
  if (inline.type === "zettel_image") {
    return {
      type: "image",
      url: inline.src,
      alt: inline.alt,
      title: inline.title ?? null,
    };
  }
  if (inline.type === "zettel_html_inline")
    return { type: "html", value: inline.value };
  throw unsupportedExport("unknown core inline", path);
}

function wrapMark(
  mark: string,
  children: PhrasingContent[],
  definitions: Map<string, Link>,
  path: string,
): PhrasingContent {
  if (mark === "strong") return { type: "strong", children };
  if (mark === "em") return { type: "emphasis", children };
  if (mark === "strike-through") return { type: "delete", children };
  if (mark === "code") {
    throw unsupportedExport("code mark on non-text inline", path);
  }
  const definition = definitions.get(mark);
  if (!definition)
    throw new MarkdownConversionError(
      `Link mark definition ${mark} is missing`,
      path,
    );
  return {
    type: "link",
    url: definition.href,
    title: definition.title ?? null,
    children,
  };
}

function canonicalMarks(marks: string[]): string[] {
  const result: string[] = [];
  for (const mark of marks) {
    if (!result.includes(mark)) result.push(mark);
  }
  return result;
}

function unsupportedImport(
  type: string,
  path: string,
): MarkdownConversionError {
  return new MarkdownConversionError(`Unsupported Markdown node ${type}`, path);
}

function unsupportedExport(
  type: string,
  path: string,
): MarkdownConversionError {
  return new MarkdownConversionError(
    `Cannot represent Zettel node ${type} in Markdown`,
    path,
  );
}
