let report, selected='sql content edit';
const $=id=>document.getElementById(id);
const labels={attached:'Target still matches',detached:'Target no longer exists',retargeted:'Target now contains different content'};
function node(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
function render(){
 const results=report.results.filter(r=>r.kind===$('kind').value);
 $('status').textContent=`${report.results.length} experiments · ${(report.durationMs/1000).toFixed(1)} seconds · ${report.generatedAt}`;
 $('cases').replaceChildren();for(const result of results){const button=node('button',result.name);button.classList.toggle('active',result.name===selected);button.onclick=()=>{selected=result.name;render();};$('cases').append(button);}
 const r=results.find(r=>r.name===selected);const article=node('article','');
 article.append(node('h2',r.name),node('h3',r.error?'Experiment error':labels[r.outcome]),node('p',r.error??`Original target: ${r.kind==='csv'?'Design,100':'Ship on Monday.'} → Current content: ${r.resolvedContent??'(missing)'}`));
 article.append(node('p',r.expectation==='ambiguous'?'Duplication and structural changes can make author intent ambiguous. The outcome here records identity behavior, not a guaranteed correct semantic attachment.':`Expected: ${r.expectation}. ${r.meetsExpectation?'Expectation met.':'Expectation not met.'}`));
 for(const [label,text] of [['Before file',r.before],['After file',r.after]])article.append(node('h3',label),node('pre',text??''));
 article.append(node('h3','Rows after the change'));
 for(const row of r.rows??[])article.append(node('p',`${row.id===r.targetId?'→ Original target · ':''}${row.content} [${row.id}]`));
 article.append(node('h3','Persistence and history'),node('p',`Comment retained: ${r.commentRetained}. Reference unchanged: ${r.reopenRefUnchanged}. Resolution unchanged on reopen: ${r.reopenResolutionUnchanged}. Checkpoint retained: ${r.checkpointRetained}.`),node('p',`Original content queried from checkpoint: ${r.historicalContent??'(missing)'}`));
 const details=node('details','');details.append(node('summary','Raw experiment evidence'),node('pre',JSON.stringify(r,null,2)));article.append(details);$('result').replaceChildren(article);
}
$('kind').onchange=render;
$('run').onclick=async()=>{ $('run').disabled=true;$('status').textContent='Running real plugin experiments…';try{const response=await fetch('/api/target-lab',{method:'POST'});report=await response.json();if(!response.ok)throw new Error(report.error);render();}catch(e){$('status').textContent=e.message;}finally{$('run').disabled=false;}};
try{const response=await fetch('/target-lab-results.json');if(!response.ok)throw new Error('Run experiments to generate results.');report=await response.json();render();}catch(e){$('status').textContent=e.message;}
