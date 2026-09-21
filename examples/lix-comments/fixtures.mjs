/**
 * Runtime seed data for the Lix comments demo.
 *
 * The fixture factory receives RowRefs and a real Lix file UUID so that every
 * reference in the JSONB documents is an address produced by the engine.
 */

function span(_key, text, marks = []) {
  return { _type: "span", _key, text, marks };
}

function paragraph(_key, children, markDefs = [], style = "normal") {
  return { _type: "block", _key, style, children, markDefs };
}

export const DEMO_FILE_SEEDS = Object.freeze([
  {
    key: "checkpoint",
    name: "checkpoint-notes.txt",
    path: "/demo/checkpoint-notes.txt",
    mediaType: "text/plain",
    content: "Checkpoint target\nThis small text file is tracked by Lix.\n",
  },
  {
    key: "guide",
    name: "project-guide.md",
    path: "/demo/project-guide.md",
    mediaType: "text/markdown",
    content: "# Project guide\n\nThe comments demo uses ordinary Lix files.\n",
  },
  {
    key: "preview",
    name: "preview.svg",
    path: "/demo/preview.svg",
    mediaType: "image/svg+xml",
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><rect width="320" height="120" rx="14" fill="#dbeafe"/><circle cx="62" cy="60" r="30" fill="#2563eb"/><path d="M48 60h28M62 46v28" stroke="white" stroke-width="6" stroke-linecap="round"/><text x="108" y="68" font-family="sans-serif" font-size="22" fill="#172554">Lix preview</text></svg>',
  },
]);

export function buildSeedDocuments({
  accountRef,
  conversationRef,
  fileRef,
  attachmentFileId,
}) {
  const sharedLink = {
    _type: "link",
    _key: "link-project-guide",
    href: "https://example.test/project-guide",
    title: "Project guide",
  };

  const first = {
    format: "zettel",
    version: 1,
    blocks: [
      paragraph(
        "intro-block",
        [
          span("intro-1", "The release plan is ready. "),
          {
            _type: "lix_ref",
            _key: "intro-account-ref",
            target: accountRef,
            label: "@Anonymous",
          },
          span("intro-2", " can compare the "),
          span("intro-link-1", "project ", ["link-project-guide"]),
          span("intro-link-2", "guide", ["link-project-guide", "strong"]),
          span("intro-3", " before the checkpoint. "),
          span("intro-break", "\nThe source file is "),
          {
            _type: "lix_ref",
            _key: "intro-file-ref",
            target: fileRef,
            label: "checkpoint-notes.txt",
          },
        ],
        [sharedLink],
      ),
      paragraph("decision-block", [
        span("decision-text", "Decision: keep the API stable for this demo.", [
          "em",
        ]),
      ]),
      {
        _type: "zettel_rule",
        _key: "intro-rule",
      },
    ],
  };

  const second = {
    format: "zettel",
    version: 1,
    blocks: [
      {
        _type: "zettel_list",
        _key: "plan-list",
        kind: "number",
        start: 1,
        items: [
          {
            _type: "zettel_list_item",
            _key: "plan-item-1",
            blocks: [
              paragraph("plan-item-1-a", [
                span("plan-1-a", "Review the open questions."),
              ]),
              paragraph(
                "plan-item-1-b",
                [
                  span("plan-1-b", "Leave the notes in the shared guide.", [
                    "link-project-guide",
                  ]),
                ],
                [sharedLink],
              ),
            ],
          },
          {
            _type: "zettel_list_item",
            _key: "plan-item-2",
            blocks: [
              paragraph("plan-item-2-a", [
                span("plan-2-a", "Publish the summary after the checkpoint."),
              ]),
              {
                _type: "zettel_list",
                _key: "plan-sublist",
                kind: "check",
                items: [
                  {
                    _type: "zettel_list_item",
                    _key: "plan-check-1",
                    checked: true,
                    blocks: [
                      paragraph("plan-check-1-block", [
                        span("plan-check-1-text", "Confirm the file bytes."),
                      ]),
                    ],
                  },
                  {
                    _type: "zettel_list_item",
                    _key: "plan-check-2",
                    checked: false,
                    blocks: [
                      paragraph("plan-check-2-block", [
                        span("plan-check-2-text", "Add a final reviewer."),
                      ]),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        _type: "zettel_quote",
        _key: "plan-quote",
        blocks: [
          paragraph("plan-quote-block", [
            span(
              "plan-quote-text",
              "Small, explicit steps make the review easy.",
              ["strong"],
            ),
          ]),
        ],
      },
      {
        _type: "lix_attachment",
        _key: "plan-attachment",
        file_id: attachmentFileId,
        display: "image",
        alt: "Blue Lix preview mark",
        caption: "The SVG is stored in lix_file, outside the JSON body.",
      },
    ],
  };

  const third = {
    format: "zettel",
    version: 1,
    blocks: [
      paragraph("summary-block", [
        span("summary-1", "The generic target is "),
        {
          _type: "lix_ref",
          _key: "summary-conversation-ref",
          target: conversationRef,
          label: "this conversation",
        },
        span("summary-2", "."),
      ]),
      {
        _type: "code",
        _key: "summary-code",
        code: "const checkpoint = await openLix();\nawait checkpoint.execute(sql);\n",
        language: "javascript",
      },
    ],
  };

  return [first, second, third];
}
