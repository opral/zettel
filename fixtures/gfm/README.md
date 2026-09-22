# GFM fixtures

`cases.json` contains a small conformance corpus copied from examples in the
[GitHub Flavored Markdown specification](https://github.github.com/gfm/).
`cmark-gfm-spec.txt` is the complete upstream example corpus. The source
specification is `github/cmark-gfm`'s `test/spec.txt`, pinned at commit
`499789b49373bfa045d0e7547e5ee63444c77bca` (version 0.29, 2019-04-06), and is
licensed CC BY-SA 4.0. The attribution and license are retained here because
these fixture inputs are redistributed for testing.

The parser and serializer under test are `remark-parse`, `remark-gfm`, and
`remark-stringify`; the expected values in package tests assert the semantic
properties needed by the Zettel AST rather than comparing HTML bytes.

Source: <https://github.com/github/cmark-gfm/blob/499789b49373bfa045d0e7547e5ee63444c77bca/test/spec.txt>
License: <https://creativecommons.org/licenses/by-sa/4.0/>
