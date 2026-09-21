# Markdown review

Independent review of `packages/zettel-markdown` against the pinned
`fixtures/gfm/cmark-gfm-spec.txt` corpus and the installed micromark GFM
renderer (2026-09-21).

## Checks completed

TypeScript compilation, the package unit tests, and the 672-example semantic
round-trip test pass (16 tests). The package build also passes:

```text
pnpm --filter @opral/zettel-markdown test
pnpm --filter @opral/zettel-markdown build
```

I also ran a temporary line-oriented extractor over the fixture, replacing the
fixture's `→` tab marker with an actual tab, and compared
`micromark(source)` with `micromark(toMarkdown(fromMarkdown(source)))` using
`gfm()`/`gfmHtml()` and dangerous HTML enabled. The fixture has 672 `example`
fences. The previous regex extractor reported
670 because the two examples with an empty expected HTML section were
skipped/merged by its required extra newline; the package test now uses the
line-oriented extraction and covers all 672.

After the current serializer fixes, raw HTML and soft-newline cases match the
micromark baseline across the full corpus. The remaining baseline differences
are delimiter canonicalization caused by Zettel's unordered, duplicate-free
mark set (for example `****foo****` becomes `**foo**`). The old cmark fixture
also differs from this micromark
version in tag filtering, autolink literals, URL parsing, and delimiter
nesting; those differences are present in `micromark(source)` before Zettel
conversion.

## Verified behavior

- Formal footnote syntax is disabled at the micromark parser level. The input
  `[^a]\n\n[^a]: /url` becomes a normal link reference with text `^a` and
  destination `/url`; a standalone `[^a]` remains literal. Definitions are
  omitted, and an indented continuation remains an ordinary code block.
- Duplicate and normalized reference labels are first-definition-wins. For
  `[x][FOO] [y][foo]` followed by `[foo]: /first` and `[FOO]: /second`, both
  links resolve to `/first`.
- Empty link/image destinations, titles, linked images, and adjacent inline raw
  HTML preserve their AST meaning through export/import. For example,
  `[![alt](img "it")](dest "dt")` round-trips unchanged semantically.
- Inline code preserves leading/trailing spaces, repeated spaces, backticks,
  and embedded LF through canonical export/import.
- Invalid JSON/unknown schema values are rejected by `toMarkdown` with
  `MarkdownConversionError`; unknown extension nodes, extra core properties,
  unresolved marks, and non-plain JSON objects are not silently dropped.
- The serializer now protects authored entity text. Both `plain \\&#10; text`
  and `plain &#38;#10; text` round-trip as the literal text `&#10;`, while an
  actual LF remains an LF.
- Raw HTML adjacency preserves soft LF semantics. `Foo\n<a href="bar">\nbaz`
  exports with an `&#10;` sentinel before the inline tag and rereads with the
  original LF. The nested HTML/Markdown case from cmark example 118 also
  renders to the same micromark tree without the prior trailing space before
  `</pre>`.

## Resolved conversion finding

The parser repair now handles an escaped plus in an email autolink, which the
formal cmark-GFM example treats as literal text:

```text
source:  <foo\+@bar.example.com>
expected GFM: <p>&lt;foo+@bar.example.com&gt;</p>
```

The verified current behavior is:

```ts
const document = fromMarkdown("<foo\\+@bar.example.com>");
toMarkdown(document);
// "\\<foo\\+\\@bar.example.com>\\n"
```

`fromMarkdown` now produces one unmarked literal span with
`<foo+@bar.example.com>`, and rereading the canonical Markdown preserves that
span. Formal example 614 therefore passes in the full 672-example corpus.

The literal-entity probes also pass: `plain \\&#10; text`, `plain &#38;#10;
text`, and `plain &amp;#10; text` export as `plain &amp;#10; text` and reread
as the literal text `&#10;`; an actual `&#10;` source remains an LF.
