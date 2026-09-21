import './style.css';
import { createDocument } from '@opral/zettel-ast';
import { fromMarkdown, toMarkdown } from '@opral/zettel-markdown';
import { toHtml } from '@opral/zettel-html';
import { createZettelEditor, loadDocument, exportDocument, registerZettelLexicalPlugin } from '@opral/zettel-lexical';
import { FORMAT_TEXT_COMMAND } from 'lexical';
const $ = id => document.getElementById(id);
let state, selected = 'checkpoint', editing = null, busy = false, dirty = false;
const editor = createZettelEditor({ namespace: 'lix-comments', onError: showError });
editor.setRootElement($('editor'));
registerZettelLexicalPlugin(editor);
function showError(e) { $('error').textContent = e.message ?? String(e); }
function syncJson() { $('json').value = JSON.stringify(exportDocument(editor), null, 2); }
function apply(body) { loadDocument(editor, body); syncJson(); }
editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
  if (!dirtyElements.size && !dirtyLeaves.size) return;
  dirty = true; syncJson();
});
async function api(path, payload) {
  const response = await fetch(`/api${path}`, payload === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function reset() { editing = null; $('compose-title').textContent = 'Add a comment'; $('cancel').hidden = true; $('author').disabled = false; apply(createDocument()); $('markdown').value = ''; dirty = false; }
function render() {
  $('targets').replaceChildren();
  for (const conversation of state.conversations) {
    const button = document.createElement('button'); button.textContent = conversation.title; button.dataset.target = conversation.id;
    button.classList.toggle('active', conversation.id === selected);
    button.onclick = () => { if (busy) return; if (dirty && !confirm('Discard the unsaved draft?')) return; selected = conversation.id; reset(); render(); };
    $('targets').append(button);
  }
  const conversation = state.conversations.find(c => c.id === selected);
  $('title').textContent = conversation.title;
  $('target-ref').textContent = conversation.target;
  $('context').textContent = selected === 'paragraph' ? state.paragraphs[0].text : selected === 'csv' ? JSON.stringify(state.csvRows[0].data, null, 2) : 'Checkpoint of the guide and budget rows. Comments address the commit itself.';
  $('comments').replaceChildren();
  for (const comment of state.comments.filter(c => c.conversation_id === selected)) {
    const article = document.createElement('article'); article.dataset.commentId = comment.id;
    const byline = document.createElement('div'); byline.className = 'byline'; byline.textContent = `${state.accounts.find(a => a.id === comment.author_id)?.name ?? comment.author_id} · ${new Date(comment.created_at).toLocaleString()}`;
    const edit = document.createElement('button'); edit.textContent = 'Edit'; edit.onclick = () => {
      if (busy || (dirty && !confirm('Discard the unsaved draft?'))) return;
      editing = comment.id; $('compose-title').textContent = 'Edit comment'; $('cancel').hidden = false; $('author').value = comment.author_id; $('author').disabled = true;
      apply(comment.body); $('markdown').value = toMarkdown(comment.body); dirty = false;
    };
    byline.append(edit); const content = document.createElement('div'); content.className = 'comment-body'; content.innerHTML = toHtml(comment.body);
    article.append(byline, content); $('comments').append(article);
  }
}
$('save').onclick = async () => {
  if (busy) return; busy = true; $('save').disabled = true; editor.setEditable(false); $('error').textContent = '';
  try {
    const body = exportDocument(editor);
    if (!body.blocks.length) throw new Error('Write a comment first.');
    await api(editing ? `/comments/${encodeURIComponent(editing)}` : '/comments', { body, conversationId: selected, authorId: $('author').value });
    state = await api('/state'); reset(); render(); $('status').textContent = 'Saved to Lix';
  } catch (e) { showError(e); } finally { busy = false; $('save').disabled = false; editor.setEditable(true); }
};
$('cancel').onclick = () => { if (!busy) reset(); };
$('import-md').onclick = () => { if (busy) return; try { apply(fromMarkdown($('markdown').value)); dirty = true; $('error').textContent = ''; } catch (e) { showError(e); } };
$('export-md').onclick = () => { try { $('markdown').value = toMarkdown(exportDocument(editor)); } catch (e) { showError(e); } };
for (const button of document.querySelectorAll('[data-format]')) {
  button.onmousedown = event => event.preventDefault();
  button.onclick = () => { if (!busy) editor.dispatchCommand(FORMAT_TEXT_COMMAND, button.dataset.format); };
}
window.commentDemo = { editor, getDocument: () => exportDocument(editor) };
try { state = await api('/state'); reset(); render(); } catch (e) { showError(e); }
