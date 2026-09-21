/**
 * The small structural type layer used by the Lexical adapter.
 *
 * The editor re-exports the AST package's breaking replacement types so
 * callers can use one set of document and node definitions throughout a
 * Lexical integration.
 */

import { SCHEMA_URL, generateKey, createDocument } from "@opral/zettel-ast";
import type {
  Block,
  Break,
  Code,
  Document,
  Html,
  Image,
  Inline,
  InlineHtml,
  Link,
  List,
  ListItem,
  Quote,
  Rule,
  Span,
  Table,
  TableCell,
  TableRow,
  TextBlock,
} from "@opral/zettel-ast";
export { SCHEMA_URL, generateKey, createDocument };
export type {
  Block,
  Break,
  Code,
  Document,
  Html,
  Image,
  Inline,
  InlineHtml,
  Link,
  List,
  ListItem,
  Quote,
  Rule,
  Span,
  Table,
  TableCell,
  TableRow,
  TextBlock,
};
export type Mark = string;

export function isSpan(value: unknown): value is Span {
  return isNode(value, "zettel_span") && typeof (value as Span).text === "string";
}

export function isNode(value: unknown, type?: string): value is { _type: string; _key: string } {
  return Boolean(value && typeof value === "object" && typeof (value as { _type?: unknown })._type === "string" && (type === undefined || (value as { _type: string })._type === type) && typeof (value as { _key?: unknown })._key === "string");
}
