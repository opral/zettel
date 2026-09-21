import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import { validateBody } from "../profile.mjs";
const parser = unified().use(remarkParse).use(remarkGfm);
const writer = unified()
  .use(remarkStringify, { bullet: "-", fences: true })
  .use(remarkGfm);
const key = () => crypto.randomUUID().replaceAll("-", "");
const fail = (message) => {
  throw new Error(message);
};
const uri = (kind, id) => `lix://${kind}/${encodeURIComponent(id)}`;
function target(url) {
  if (!url.startsWith("lix:")) return null;
  const match = /^lix:\/\/(row|file)\/([^/?#]+)$/.exec(url);
  if (!match) fail("Unsupported Lix reference URI");
  let id;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    fail("Invalid percent encoding in Lix URI");
  }
  return { kind: match[1], id };
}
function check(doc) {
  const result = validateBody(doc);
  if (!result.ok)
    fail(result.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
  return doc;
}
export function fromMarkdown(source) {
  const ast = parser.parse(source);
  function block(node) {
    if (node.type === "paragraph" && node.children.length === 1) {
      const child = node.children[0];
      if (child.type === "image" || child.type === "link") {
        const ref = target(child.url);
        if (ref?.kind === "file") {
          if (child.type === "image")
            return {
              _type: "lix_attachment",
              _key: key(),
              file_id: ref.id,
              display: "image",
              alt: child.alt ?? "",
              ...(child.title != null ? { caption: child.title } : {}),
            };
          if (child.children.some((c) => c.type !== "text"))
            fail("Attachment captions must be plain text");
          if (child.title != null)
            fail("File attachment link titles are unsupported");
          if (
            !child.children.length ||
            !child.children
              .map((c) => c.value)
              .join("")
              .trim()
          )
            fail("File attachments need nonempty captions");
          return {
            _type: "lix_attachment",
            _key: key(),
            file_id: ref.id,
            display: "file",
            caption: child.children.map((c) => c.value).join(""),
          };
        }
      }
    }
    if (node.type === "paragraph" || node.type === "heading") {
      const markDefs = [],
        children = [];
      function push(text, marks) {
        if (text)
          children.push({
            _type: "span",
            _key: key(),
            text,
            marks: [...marks],
          });
      }
      function inline(n, marks = []) {
        if (n.type === "text")
          return push(n.value.replace(/\r\n?|\n/g, " "), marks);
        if (n.type === "break") return push("\n", marks);
        if (n.type === "inlineCode") {
          if (n.value.includes("\r") || n.value.includes("\n"))
            fail("Multiline inline code is unsupported");
          return push(n.value, [...marks, "code"]);
        }
        const decorator = {
          strong: "strong",
          emphasis: "em",
          delete: "strike-through",
        }[n.type];
        if (decorator) {
          for (const c of n.children) inline(c, [...marks, decorator]);
          return;
        }
        if (n.type === "link") {
          if (!n.children.length)
            fail("Empty link labels are outside this Markdown profile");
          const ref = target(n.url);
          if (ref) {
            if (ref.kind === "file")
              fail("Attachments must occupy their own paragraph");
            if (
              marks.length ||
              n.title != null ||
              n.children.some((c) => c.type !== "text")
            )
              fail(
                "Mentions must have a plain label without formatting or a title",
              );
            children.push({
              _type: "lix_ref",
              _key: key(),
              target: ref.id,
              label: n.children.map((c) => c.value).join(""),
            });
            return;
          }
          const annotation = {
            _type: "link",
            _key: key(),
            href: n.url,
            ...(n.title != null ? { title: n.title } : {}),
          };
          markDefs.push(annotation);
          for (const c of n.children) inline(c, [...marks, annotation._key]);
          return;
        }
        fail(
          n.type === "image"
            ? "Upload images as Lix files before inserting them"
            : `Unsupported Markdown inline: ${n.type}`,
        );
      }
      node.children.forEach((n) => inline(n));
      return {
        _type: "block",
        _key: key(),
        style: node.type === "heading" ? `h${node.depth}` : "normal",
        markDefs,
        children,
      };
    }
    if (node.type === "blockquote")
      return {
        _type: "zettel_quote",
        _key: key(),
        blocks: node.children.map(block),
      };
    if (node.type === "list") {
      const checks = node.children.map((n) => typeof n.checked === "boolean");
      if (checks.some(Boolean) && !checks.every(Boolean))
        fail("Mixed task and ordinary list items need separate lists");
      if (node.ordered && checks.some(Boolean))
        fail("Numbered task lists are outside this profile");
      const kind = checks.every(Boolean)
        ? "check"
        : node.ordered
          ? "number"
          : "bullet";
      return {
        _type: "zettel_list",
        _key: key(),
        kind,
        ...(kind === "number" ? { start: node.start ?? 1 } : {}),
        items: node.children.map((n) => ({
          _type: "zettel_list_item",
          _key: key(),
          blocks: n.children.map(block),
          ...(kind === "check" ? { checked: n.checked } : {}),
        })),
      };
    }
    if (node.type === "code") {
      if (node.meta != null) fail("Code fence metadata is unsupported");
      return {
        _type: "code",
        _key: key(),
        code: node.value,
        ...(node.lang != null ? { language: node.lang } : {}),
      };
    }
    if (node.type === "thematicBreak")
      return { _type: "zettel_rule", _key: key() };
    fail(`Unsupported Markdown block: ${node.type}`);
  }
  return check({
    format: "zettel",
    version: 1,
    blocks: ast.children.map(block),
  });
}
export function toMarkdown(document) {
  check(document);
  function inline(block) {
    const defs = new Map(block.markDefs.map((n) => [n._key, n]));
    if (
      block.markDefs.some(
        (d) =>
          !block.children.some(
            (c) => c._type === "span" && c.marks.includes(d._key),
          ),
      )
    )
      fail("Markdown cannot preserve unused link definitions");
    const output = [];
    let activeLink = null,
      linkNode = null;
    for (const n of block.children) {
      if (n._type === "lix_ref") {
        output.push({
          type: "link",
          url: uri("row", n.target),
          children: [{ type: "text", value: n.label }],
        });
        activeLink = null;
        continue;
      }
      if (n._type !== "span") fail(`Unsupported inline node: ${n._type}`);
      if (n.marks.includes("underline"))
        fail("Markdown cannot preserve underline");
      const link = n.marks.find((m) => defs.has(m));
      let parts;
      if (n.marks.includes("code")) {
        if (/[\r\n]/.test(n.text) || /^\s+$/.test(n.text))
          fail("Markdown cannot preserve this inline code whitespace");
        parts = [{ type: "inlineCode", value: n.text }];
      } else
        parts = n.text
          .split("\n")
          .flatMap((value, i) => [
            ...(i ? [{ type: "break" }] : []),
            ...(value ? [{ type: "text", value }] : []),
          ]);
      for (const [mark, type] of [
        ["em", "emphasis"],
        ["strong", "strong"],
        ["strike-through", "delete"],
      ])
        if (n.marks.includes(mark)) parts = [{ type, children: parts }];
      if (link) {
        if (activeLink !== link) {
          const def = defs.get(link);
          linkNode = {
            type: "link",
            url: def.href,
            ...(def.title !== undefined ? { title: def.title } : {}),
            children: [],
          };
          output.push(linkNode);
        }
        linkNode.children.push(...parts);
        activeLink = link;
      } else {
        output.push(...parts);
        activeLink = null;
      }
    }
    return output;
  }
  function block(n) {
    if (n._type === "block") {
      if (n.style === "normal" && !n.children.length)
        fail("Markdown cannot preserve an empty paragraph");
      return {
        type: n.style === "normal" ? "paragraph" : "heading",
        ...(n.style === "normal" ? {} : { depth: Number(n.style.slice(1)) }),
        children: inline(n),
      };
    }
    if (n._type === "zettel_quote") {
      if (!n.blocks.length) fail("Markdown cannot preserve an empty quote");
      return { type: "blockquote", children: n.blocks.map(block) };
    }
    if (n._type === "zettel_list") {
      if (n.kind === "number" && n.start > 999999999)
        fail("Markdown list markers support at most nine digits");
      return {
        type: "list",
        ordered: n.kind === "number",
        ...(n.kind === "number" ? { start: n.start } : {}),
        spread: n.items.some((i) => i.blocks.length > 1),
        children: n.items.map((i) => ({
          type: "listItem",
          checked: n.kind === "check" ? i.checked : null,
          spread: i.blocks.length > 1,
          children: i.blocks.map(block),
        })),
      };
    }
    if (n._type === "code") {
      if (
        n.language !== undefined &&
        (!n.language || /[\s`~]/.test(n.language))
      )
        fail("Code language is not representable by this Markdown profile");
      return {
        type: "code",
        value: n.code,
        ...(n.language !== undefined ? { lang: n.language } : {}),
      };
    }
    if (n._type === "zettel_rule") return { type: "thematicBreak" };
    if (n._type === "lix_attachment") {
      if (n.display === "image") {
        if (n.alt === undefined)
          fail("Image attachment needs explicit alt text for Markdown export");
        return {
          type: "paragraph",
          children: [
            {
              type: "image",
              url: uri("file", n.file_id),
              alt: n.alt,
              ...(n.caption !== undefined ? { title: n.caption } : {}),
            },
          ],
        };
      }
      if (n.alt !== undefined)
        fail("Markdown cannot preserve alt text on a file attachment");
      if (!n.caption)
        fail("File attachment needs a caption for Markdown export");
      return {
        type: "paragraph",
        children: [
          {
            type: "link",
            url: uri("file", n.file_id),
            children: [{ type: "text", value: n.caption }],
          },
        ],
      };
    }
    fail(`Unsupported block: ${n._type}`);
  }
  const markdown = writer.stringify({
    type: "root",
    children: document.blocks.map(block),
  });
  if (
    JSON.stringify(semantic(fromMarkdown(markdown))) !==
    JSON.stringify(semantic(document))
  )
    fail(
      "Markdown cannot preserve this document exactly; use JSON to retain its content and formatting.",
    );
  return markdown;
}

// Compare rendered document semantics, deliberately excluding node/annotation identities.
// Adjacent equally marked text runs may coalesce during Markdown parsing.
function semantic(document) {
  function node(n, defs = new Map()) {
    if (n._type === "span")
      return {
        _type: "span",
        text: n.text,
        marks: n.marks
          .map((m) =>
            defs.has(m)
              ? {
                  link: defs.get(m).href,
                  ...(defs.get(m).title !== undefined
                    ? { title: defs.get(m).title }
                    : {}),
                }
              : m,
          )
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      };
    const result = {};
    for (const field of Object.keys(n).sort()) {
      if (field === "_key" || field === "markDefs") continue;
      if (field === "children") {
        const children = n.children.map((c) =>
          node(c, new Map(n.markDefs.map((d) => [d._key, d]))),
        );
        result.children = [];
        for (const child of children) {
          const previous = result.children.at(-1);
          if (
            child._type === "span" &&
            previous?._type === "span" &&
            JSON.stringify(child.marks) === JSON.stringify(previous.marks)
          )
            previous.text += child.text;
          else result.children.push(child);
        }
      } else if (Array.isArray(n[field]))
        result[field] = n[field].map((c) => node(c));
      else result[field] = n[field];
    }
    return result;
  }
  return node(document);
}
