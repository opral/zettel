import "./style.css";
import "@opral/zettel-html/style.css";
import { validateDocument } from "@opral/zettel-ast";
import { fromMarkdown, toMarkdown } from "@opral/zettel-markdown";
import { toHtml } from "@opral/zettel-html";
import {
  createZettelEditor,
  loadDocument,
  exportDocument,
  registerZettelLexicalPlugin,
} from "@opral/zettel-lexical";
import { FORMAT_TEXT_COMMAND } from "lexical";
import { sample } from "./sample.js";
const $ = (id) => document.getElementById(id);
const editor = createZettelEditor({
  namespace: "zettel-playground",
  onError: (error) => showError(error),
});
editor.setRootElement($("editor"));
registerZettelLexicalPlugin(editor, {
  markdownShortcuts: true,
  onPasteDiagnostics(diagnostics) {
    $("diagnostics").textContent = diagnostics
      .map((item) => item?.message ?? String(item))
      .join("\n");
  },
});
let active;
let syncing = false;
function showError(error) {
  $("diagnostics").textContent =
    error instanceof Error ? error.message : String(error);
  $("status").textContent = "Needs attention";
}
function render(doc) {
  active = doc;
  $("json").value = JSON.stringify(doc, null, 2);
  const html = toHtml(doc);
  $("preview").innerHTML = html;
  $("html-source").textContent = html;
  $("status").textContent = "Document synchronized";
}
function apply(doc) {
  const result = validateDocument(doc);
  if (!result.ok)
    throw new Error(
      result.errors.map((e) => `${e.path}: ${e.message}`).join("\n"),
    );
  syncing = true;
  try {
    loadDocument(editor, doc);
    render(doc);
    $("diagnostics").textContent = "";
  } finally {
    syncing = false;
  }
}
function action(fn) {
  return () => {
    try {
      fn();
    } catch (error) {
      showError(error);
    }
  };
}
$("import-markdown").onclick = action(() =>
  apply(fromMarkdown($("markdown").value)),
);
$("import-json").onclick = action(() => apply(JSON.parse($("json").value)));
$("export-markdown").onclick = action(() => {
  $("markdown").value = toMarkdown(exportDocument(editor));
  $("diagnostics").textContent = "";
});
$("export-json").onclick = action(() => render(exportDocument(editor)));
$("load-sample").onclick = action(() => {
  $("markdown").value = sample;
  apply(fromMarkdown(sample));
});
$("copy-html").onclick = () =>
  navigator.clipboard.writeText($("html-source").textContent).then(() => {
    $("status").textContent = "HTML copied";
  }, showError);
for (const button of document.querySelectorAll("[data-format]")) {
  button.onmousedown = (e) => e.preventDefault();
  button.onclick = () =>
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, button.dataset.format);
}
editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
  if (syncing || (!dirtyElements.size && !dirtyLeaves.size)) return;
  try {
    render(exportDocument(editor));
  } catch (error) {
    showError(error);
  }
});
$("markdown").value = sample;
action(() => apply(fromMarkdown(sample)))();
window.zettelPlayground = {
  editor,
  getDocument: () => exportDocument(editor),
  apply,
  fromMarkdown,
  toMarkdown,
  toHtml,
  validateDocument,
};
