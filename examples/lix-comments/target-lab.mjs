import { openLix, bundledPluginArchives } from '../../../lix/packages/js-sdk/dist/index.js';
import { createHash } from 'node:crypto';
import { schemas, initialBody } from './model.mjs';
const encode = value => new TextEncoder().encode(value);
const decode = value => new TextDecoder().decode(value);
const initial = { markdown: 'Introduction.\n\nShip on Monday.\n\nClosing notes.\n', csv: 'team,budget\nDesign,100\nEngineering,200\n' };
const config = { markdown: {table:'markdown_node',path:'/guide.md',target:'Ship on Monday.'}, csv:{table:'csv_row',path:'/budget.csv',target:'Design,100'} };
const content = row => row.cells ? row.cells.join(',') : (row.payload_json?.inline ?? []).map(n=>n.value ?? '').join('');
async function snapshot(lix) { return new Uint8Array(await new Response(lix.exportSnapshot()).arrayBuffer()); }
async function rows(lix, kind) {const c=config[kind];return (await lix.execute(`SELECT * FROM ${c.table} WHERE lixcol_file_id = $1 ORDER BY order_key, id`,[(await lix.execute('SELECT id FROM lix_file WHERE path=$1',[c.path])).rows[0].id])).rows.filter(r=>kind==='csv'||r.kind==='paragraph');}
async function write(lix,kind,text){await lix.execute('UPDATE lix_file SET content=$1 WHERE path=$2',[encode(text),config[kind].path]);}
const cases = [
 ['sql content edit','sql','edited'], ['sql reorder','sql','same'], ['file content edit','file','edited'],
 ['file insert before','file','same'], ['file reorder','file','same'], ['file delete target','file','deleted'],
 ['delete then reinsert identical','file','deleted'], ['file duplicate target','file','ambiguous'],
 ['file duplicate then edit original','file','edited'], ['file replace unrelated content','file','deleted'],
 ['file reorder and edit','file','edited'], ['paragraph split','file','ambiguous'], ['paragraph merge','file','ambiguous'],
 ['rename file','file','same'], ['branch edit and merge','sql','edited'],
];
export async function runTargetLab() {
 const started=Date.now(); const plugins=(await bundledPluginArchives()).filter(p=>['plugin_markdown','plugin_csv'].includes(p.key));
 let lix=await openLix();let base;const targets={};let checkpoint;
 try {
  for(const p of plugins) await lix.execute('INSERT INTO lix_file(path,content) VALUES($1,$2)',[`/.lix/plugins/${p.fileName}`,p.archiveBytes]);
  for(const s of schemas.filter(s=>['demo_account','demo_conversation','demo_comment'].includes(s.key)))await lix.execute('INSERT INTO lix_registered_schema(value) VALUES(CAST($1 AS JSONB))',[JSON.stringify(s)]);
  await lix.execute("INSERT INTO demo_account(id,name) VALUES('alice','Alice')");
  for(const kind of Object.keys(config)) {
   await lix.execute('INSERT INTO lix_file(path,content) VALUES($1,$2)',[config[kind].path,encode(initial[kind])]);
   const target=(await rows(lix,kind)).find(r=>content(r)===config[kind].target);
   const ref=(await lix.execute(`SELECT lix_row_ref('${config[kind].table}', $1) AS ref`,[target.id])).rows[0].ref;
   targets[kind]={id:target.id,ref,fileId:target.lixcol_file_id};
   await lix.execute('INSERT INTO demo_conversation(id,target,title) VALUES($1,$2,$3)',[kind,ref,kind]);
   await lix.execute('INSERT INTO demo_comment(id,conversation_id,author_id,body,created_at) VALUES($1,$2,$3,CAST($4 AS JSONB),$5)',[kind,kind,'alice',JSON.stringify(initialBody()),new Date().toISOString()]);
  }
  checkpoint=(await lix.execute('SELECT commit_id FROM lix_create_checkpoint()')).rows[0].commit_id;
  const ref=(await lix.execute("SELECT lix_row_ref('lix_commit',$1) AS ref",[checkpoint])).rows[0].ref;
  await lix.execute("INSERT INTO demo_conversation(id,target,title) VALUES('checkpoint',$1,'Checkpoint')",[ref]);
  await lix.execute('INSERT INTO demo_comment(id,conversation_id,author_id,body,created_at) VALUES($1,$2,$3,CAST($4 AS JSONB),$5)',['checkpoint','checkpoint','alice',JSON.stringify(initialBody()),new Date().toISOString()]);
  base=await snapshot(lix);
 } finally {await lix.close();}
 const results=[];
 for(const kind of Object.keys(config)) for(const [name,mode,expectation] of cases) {
  if(kind==='csv' && name.startsWith('paragraph')) continue;
  lix=await openLix.fromSnapshot(base); const c=config[kind], target=targets[kind]; const expected=expectation==='edited'?(kind==='csv'?'Design,150':'Ship on Tuesday.'):c.target;
  const result={kind,name,mode,expectation,expected,targetId:target.id,targetRef:target.ref,before:initial[kind]};
  try {
   const parts=kind==='csv'?initial[kind].trimEnd().split('\n'):initial[kind].trimEnd().split('\n\n');
   const render=parts=>parts.join(kind==='csv'?'\n':'\n\n')+'\n';
   const sqlEdit=()=>lix.execute(`UPDATE ${c.table} SET ${kind==='csv'?'cells':'payload_json'}=CAST($1 AS JSONB) WHERE id=$2 AND lixcol_file_id=$3`,[JSON.stringify(kind==='csv'?['Design','150']:{inline:[{type:'text',value:expected}]}),target.id,target.fileId]);
   if(name==='sql content edit')await sqlEdit();
   if(name==='sql reorder')await lix.execute(`UPDATE ${c.table} SET order_key='f0' WHERE id=$1 AND lixcol_file_id=$2`,[target.id,target.fileId]);
   if(name==='file content edit'){parts[1]=expected;await write(lix,kind,render(parts));}
   if(name==='file insert before'){parts.splice(1,0,kind==='csv'?'Research,50':'New introduction.');await write(lix,kind,render(parts));}
   if(name==='file reorder'){[parts[1],parts[2]]=[parts[2],parts[1]];await write(lix,kind,render(parts));}
   if(name==='file reorder and edit'){parts[1]=expected;[parts[1],parts[2]]=[parts[2],parts[1]];await write(lix,kind,render(parts));}
   if(name==='paragraph split'){parts.splice(1,1,'Ship on','Monday.');await write(lix,kind,render(parts));}
   if(name==='paragraph merge'){parts.splice(1,2,'Ship on Monday. Closing notes.');await write(lix,kind,render(parts));}
   if(name==='file delete target'||name==='delete then reinsert identical'){parts.splice(1,1);await write(lix,kind,render(parts));if(name.startsWith('delete then'))await write(lix,kind,initial[kind]);}
   if(name==='file duplicate target'||name==='file duplicate then edit original'){parts.splice(2,0,parts[1]);await write(lix,kind,render(parts));if(name.endsWith('original')){parts[1]=expected;await write(lix,kind,render(parts));}}
   if(name==='file replace unrelated content'){parts[1]=kind==='csv'?'Marketing,999':'Entirely unrelated replacement.';await write(lix,kind,render(parts));}
   if(name==='rename file')await lix.execute('UPDATE lix_file SET path=$1 WHERE id=$2',[kind==='csv'?'/renamed.csv':'/renamed.md',target.fileId]);
   if(name==='branch edit and merge'){const main=await lix.activeBranchId();const branch=await lix.createBranch({name:'target edit'});await lix.switchBranch({branchId:branch.id});await sqlEdit();await lix.switchBranch({branchId:main});await lix.mergeBranch({sourceBranchId:branch.id});}
   result.after=decode((await lix.execute('SELECT content FROM lix_file WHERE id=$1',[target.fileId])).rows[0].content);
   const all=(await lix.execute(`SELECT * FROM ${c.table} WHERE lixcol_file_id=$1 ORDER BY order_key,id`,[target.fileId])).rows;
   const addressed=all.find(r=>r.id===target.id);
   result.resolvedContent=addressed?content(addressed):null;
   result.candidates=all.filter(r=>content(r)===expected).map(r=>r.id);
   result.outcome=!addressed?'detached':content(addressed)===expected?'attached':'retargeted';
   result.meetsExpectation=expectation==='deleted'?!addressed:expectation==='ambiguous'?null:result.outcome==='attached';
   result.rows=all.filter(r=>kind==='csv'||r.kind==='paragraph').map(r=>({id:r.id,content:content(r),order:r.order_key}));
   const saved=await snapshot(lix);await lix.close();lix=await openLix.fromSnapshot(saved);
   const conversation=(await lix.execute('SELECT target FROM demo_conversation WHERE id=$1',[kind])).rows[0];
   result.reopenRefUnchanged=conversation.target===target.ref;
   result.commentRetained=(await lix.execute('SELECT id FROM demo_comment WHERE conversation_id=$1',[kind])).rows.length===1;
   const historical=(await lix.execute(`SELECT * FROM lix_as_of('${c.table}',$1) WHERE id=$2`,[checkpoint,target.id])).rows[0];
   result.historicalContent=historical?content(historical):null;
   result.checkpointCommentRetained=(await lix.execute("SELECT id FROM demo_comment WHERE conversation_id='checkpoint'")).rows.length===1;
   result.checkpointRetained=(await lix.execute('SELECT id FROM lix_commit WHERE id=$1',[checkpoint])).rows.length===1;
   const reopened=(await lix.execute(`SELECT * FROM ${c.table} WHERE id=$1 AND lixcol_file_id=$2`,[target.id,target.fileId])).rows[0];
   result.reopenResolutionUnchanged=(reopened?content(reopened):null)===result.resolvedContent;
  } catch(error){result.error=error.message;} finally {await lix.close();}
  results.push(result);
 }
 return {generatedAt:new Date().toISOString(),durationMs:Date.now()-started,plugins:plugins.map(p=>({key:p.key,sha256:createHash('sha256').update(p.archiveBytes).digest('hex')})),results};
}
if(process.argv[1]===new URL(import.meta.url).pathname){const {mkdir,writeFile}=await import('node:fs/promises');const report=await runTargetLab();await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('./artifacts/target-lab.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.results.some(r=>r.error))process.exitCode=1;}
