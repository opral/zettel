import { fromMarkdown, toMarkdown } from "./markdown.js";
import { validateBody } from "../profile.mjs";
const $ = (id) => document.getElementById(id);
let state,
  activeConversation,
  selected,
  mode = "markdown",
  editing = null;
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const value = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(value.error ?? value.message ?? JSON.stringify(value));
  }
  return response.json();
}
function jsonOptions(method, value) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}
function draft() {
  const doc =
    mode === "markdown"
      ? fromMarkdown($("draft").value)
      : JSON.parse($("draft").value);
  const result = validateBody(doc);
  if (!result.ok)
    throw new Error(
      result.errors.map((e) => `${e.path}: ${e.message}`).join("\n"),
    );
  return doc;
}
function showMode(next) {
  if (next === mode) return;
  try {
    const body = $("draft").value.trim()
      ? draft()
      : { format: "zettel", version: 1, blocks: [] };
    $("draft").value =
      next === "json" ? JSON.stringify(body, null, 2) : toMarkdown(body);
    mode = next;
    updateTabs();
    error("");
  } catch (e) {
    error(e.message);
  }
}
function updateTabs() {
  for (const name of ["markdown", "json"]) {
    $(`${name}-tab`).classList.toggle("active", mode === name);
    $(`${name}-tab`).setAttribute("aria-pressed", String(mode === name));
  }
  $("draft").spellcheck = mode === "markdown";
}
function inspect(comment) {
  selected = comment;
  $("json-view").textContent = JSON.stringify(comment.body, null, 2);
  $("inspector-title").textContent = "Stored comment body";
  $("inspect-error").textContent = "";
  document
    .querySelectorAll(".comment")
    .forEach((n) =>
      n.classList.toggle("selected", n.dataset.id === comment.id),
    );
}
function hrefSafe(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
function renderBlocks(blocks, parent) {
  for (const n of blocks) {
    if (n._type === "block") {
      const node = el(n.style === "normal" ? "p" : n.style);
      const defs = new Map(n.markDefs.map((d) => [d._key, d]));
      let activeLink = null,
        anchor = null;
      for (const c of n.children) {
        if (c._type === "lix_ref") {
          const atom = el("button", c.label, "mention");
          atom.type = "button";
          atom.title = c.target;
          atom.addEventListener("click", () => {
            $("inspect-error").textContent = `Reference: ${c.target}`;
          });
          node.append(atom);
          activeLink = null;
          continue;
        }
        let text = el("span");
        c.text.split("\n").forEach((part, i) => {
          if (i) text.append(el("br"));
          text.append(document.createTextNode(part));
        });
        for (const [mark, tag] of [
          ["code", "code"],
          ["strong", "strong"],
          ["em", "em"],
          ["strike-through", "s"],
          ["underline", "u"],
        ])
          if (c.marks.includes(mark)) {
            const wrap = el(tag);
            wrap.append(text);
            text = wrap;
          }
        const link = c.marks.find((m) => defs.has(m));
        if (link && hrefSafe(defs.get(link).href)) {
          if (activeLink !== link) {
            anchor = el("a");
            anchor.href = hrefSafe(defs.get(link).href);
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            if (defs.get(link).title) anchor.title = defs.get(link).title;
            node.append(anchor);
          }
          anchor.append(text);
          activeLink = link;
        } else {
          node.append(text);
          activeLink = null;
        }
      }
      parent.append(node);
    } else if (n._type === "zettel_quote") {
      const q = el("blockquote");
      renderBlocks(n.blocks, q);
      parent.append(q);
    } else if (n._type === "zettel_list") {
      const list = el(n.kind === "number" ? "ol" : "ul");
      if (n.kind === "number") list.start = n.start;
      if (n.kind === "check") list.className = "check-list";
      for (const item of n.items) {
        const li = el("li");
        if (n.kind === "check") {
          li.className = "check-item";
          const check = el("input");
          check.type = "checkbox";
          check.checked = item.checked;
          check.disabled = true;
          check.setAttribute(
            "aria-label",
            item.checked ? "Completed" : "Pending",
          );
          li.append(check);
          const content = el("div", undefined, "check-content");
          renderBlocks(item.blocks, content);
          li.append(content);
        } else renderBlocks(item.blocks, li);
        list.append(li);
      }
      parent.append(list);
    } else if (n._type === "code") {
      const pre = el("pre");
      pre.append(el("code", n.code));
      parent.append(pre);
    } else if (n._type === "zettel_rule") parent.append(el("hr"));
    else if (n._type === "lix_attachment") {
      const file = state.files.find((f) => f.id === n.file_id);
      const path = `/api/files/${encodeURIComponent(n.file_id)}`;
      if (
        n.display === "image" &&
        file &&
        /^image\/(png|jpeg|gif|webp)$/.test(file.mediaType)
      ) {
        const image = el("img", undefined, "attachment-image");
        image.src = path;
        image.alt = n.alt ?? "";
        parent.append(image);
      }
      const a = el("a", undefined, "attachment");
      a.href = path;
      a.download = file?.name ?? "attachment";
      const icon = el("span", "↳", "attachment-symbol");
      const content = el("span");
      content.append(
        el("strong", n.caption || file?.name || "Unavailable attachment"),
        el(
          "small",
          file
            ? `${file.mediaType || "File"} · stored in Lix`
            : "File is not available in this database",
        ),
      );
      a.append(icon, content);
      parent.append(a);
    } else
      parent.append(
        el("p", "Unsupported content — inspect the original JSON."),
      );
  }
}
function render() {
  const conversation =
    state.conversations.find((c) => c.id === activeConversation) ??
    state.conversations[0];
  activeConversation = conversation.id;
  $("title").textContent = conversation.title;
  $("subject").replaceChildren(
    document.createTextNode("Attached to "),
    el(
      "code",
      state.targets.find((t) => t.ref === conversation.target)?.label ??
        conversation.target,
    ),
  );
  $("conversations").replaceChildren();
  for (const c of state.conversations) {
    const b = el(
      "button",
      c.title,
      `thread-nav${c.id === activeConversation ? " active" : ""}`,
    );
    b.type = "button";
    b.append(
      el(
        "small",
        c.target === state.checkpoint?.ref
          ? "Checkpoint discussion"
          : "File discussion",
      ),
    );
    b.addEventListener("click", () => {
      activeConversation = c.id;
      reset();
      selected = null;
      render();
    });
    $("conversations").append(b);
  }
  $("comments").replaceChildren();
  const comments = state.comments.filter(
    (c) => c.conversation_id === activeConversation,
  );
  for (const c of comments) {
    const validation = validateBody(c.body);
    const article = el("article", undefined, "comment");
    article.dataset.id = c.id;
    const top = el("div", undefined, "comment-top");
    const identity = el("div");
    identity.append(
      el("div", state.account.name || "Local author", "author"),
      el(
        "div",
        new Date(c.created_at).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        "time",
      ),
    );
    const actions = el("div", undefined, "comment-actions");
    const view = el("button", "Inspect");
    view.type = "button";
    view.addEventListener("click", () => inspect(c));
    const edit = el("button", "Edit JSON");
    edit.type = "button";
    edit.disabled = !validation.ok;
    if (!validation.ok)
      edit.title =
        "Unsupported document: original JSON is available in the inspector.";
    edit.addEventListener("click", () => {
      editing = c.id;
      mode = "json";
      updateTabs();
      $("draft").value = JSON.stringify(c.body, null, 2);
      $("composer-title").textContent = "Edit comment";
      $("submit").textContent = "Save changes";
      $("cancel").hidden = false;
      inspect(c);
      $("draft").focus();
      error("");
    });
    actions.append(view, edit);
    top.append(
      el(
        "div",
        (state.account.name || "Local author").slice(0, 2).toUpperCase(),
        "avatar",
      ),
      identity,
      actions,
    );
    const body = el("div", undefined, "document");
    if (validation.ok) renderBlocks(c.body.blocks, body);
    else
      body.append(
        el(
          "p",
          "Unsupported document — preserved as read-only JSON. Use Inspect to see the original.",
        ),
      );
    article.append(top, body);
    $("comments").append(article);
  }
  if (!comments.length)
    $("comments").append(el("p", "Start this conversation.", "muted"));
  const pick = comments.find((c) => c.id === selected?.id) ?? comments[0];
  if (pick) inspect(pick);
  else {
    selected = null;
    $("json-view").textContent = "{}";
  }
  $("mention").replaceChildren(new Option("@ Mention", ""));
  for (const t of state.targets)
    $("mention").append(new Option(t.label, t.ref));
}
function reset() {
  editing = null;
  $("draft").value = "";
  mode = "markdown";
  updateTabs();
  $("composer-title").textContent = "Add a comment";
  $("submit").textContent = "Post comment";
  $("cancel").hidden = true;
  error("");
}
async function refresh() {
  state = await api("/api/state");
  render();
}
$("markdown-tab").addEventListener("click", () => showMode("markdown"));
$("json-tab").addEventListener("click", () => showMode("json"));
$("cancel").addEventListener("click", reset);
$("example").addEventListener("click", () => {
  mode = "markdown";
  updateTabs();
  $("draft").value =
    "The checkpoint looks good. A few follow-ups:\n\n- [x] Keep the shared **link definition**.\n- [ ] Review the nested content.\n\n  A second paragraph belongs to the same item.\n\n  > This quote stays inside that item.\n\n[Read **the proposal**](https://example.com/proposal)\n";
  error("");
});
$("mention").addEventListener("change", () => {
  const target = $("mention").value;
  if (!target) return;
  const label = state.targets.find((t) => t.ref === target).label;
  try {
    if (mode === "markdown")
      $("draft").value +=
        ` [${label.replace(/[\\[\]]/g, "\\$&")}](lix://row/${encodeURIComponent(target)})`;
    else {
      const body = $("draft").value.trim()
        ? draft()
        : { format: "zettel", version: 1, blocks: [] };
      body.blocks.push({
        _type: "block",
        _key: crypto.randomUUID(),
        style: "normal",
        markDefs: [],
        children: [
          { _type: "lix_ref", _key: crypto.randomUUID(), target, label },
        ],
      });
      $("draft").value = JSON.stringify(body, null, 2);
    }
    error("");
  } catch (e) {
    error(e.message);
  }
  $("mention").value = "";
});
$("upload").addEventListener("change", async () => {
  const file = $("upload").files[0];
  if (!file) return;
  try {
    const uploaded = await api("/api/files", {
      method: "POST",
      headers: {
        "x-file-name": encodeURIComponent(file.name),
        "content-type": file.type || "application/octet-stream",
      },
      body: file,
    });
    const image = /^image\/(png|jpeg|gif|webp)$/.test(file.type);
    if (mode === "markdown")
      $("draft").value +=
        `\n\n${image ? "!" : ""}[${file.name.replace(/[\\[\]]/g, "\\$&")}](lix://file/${uploaded.id})\n`;
    else {
      const body = $("draft").value.trim()
        ? draft()
        : { format: "zettel", version: 1, blocks: [] };
      body.blocks.push({
        _type: "lix_attachment",
        _key: crypto.randomUUID(),
        file_id: uploaded.id,
        display: image ? "image" : "file",
        ...(image ? { alt: file.name } : { caption: file.name }),
      });
      $("draft").value = JSON.stringify(body, null, 2);
    }
    state = await api("/api/state");
    $("save-status").textContent =
      "File uploaded. Post the comment to attach it.";
    error("");
  } catch (e) {
    error(e.message);
  }
  $("upload").value = "";
});
$("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("submit").disabled = true;
  try {
    const body = draft();
    if (!body.blocks.length) throw new Error("Write a comment before posting.");
    const comment = await api(
      editing
        ? `/api/comments/${encodeURIComponent(editing)}`
        : "/api/comments",
      jsonOptions(
        editing ? "PUT" : "POST",
        editing ? { body } : { conversation_id: activeConversation, body },
      ),
    );
    selected = comment;
    reset();
    await refresh();
    $("save-status").textContent = "Saved to Lix as Zettel JSONB.";
  } catch (e) {
    error(e.message);
  } finally {
    $("submit").disabled = false;
  }
});
$("copy-json").addEventListener("click", async () => {
  if (!selected) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(selected.body, null, 2));
    $("inspect-error").textContent = "JSON copied.";
  } catch {
    $("inspect-error").textContent =
      "Clipboard unavailable; select and copy the JSON below.";
  }
});
$("export-md").addEventListener("click", () => {
  if (!selected) return;
  try {
    const markdown = toMarkdown(selected.body);
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown" }),
    );
    const a = el("a");
    a.href = url;
    a.download = "comment.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("inspect-error").textContent =
      "Exported Markdown. Node keys remain in the JSON document.";
  } catch (e) {
    $("inspect-error").textContent = e.message;
  }
});
refresh().catch((e) => {
  $("title").textContent = "Unable to load the demo";
  error(e.message);
});
