import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { startServer } from './server.mjs';
const app=await startServer({port:0,persist:false});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${app.url}/target-lab.html`);
 await page.getByRole('heading',{name:'sql content edit',exact:true}).waitFor();
 await page.getByRole('button',{name:'file delete target',exact:true}).click();
 assert.match(await page.locator('#result').textContent(),/Target no longer exists/);
 await page.locator('#kind').selectOption('csv');assert.match(await page.locator('#result').textContent(),/Design,100/);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const response=page.waitForResponse(r=>r.url().endsWith('/api/target-lab'),{timeout:120000});
 await page.locator('#run').click();const res=await response;assert.equal(res.status(),200);const report=await res.json();
 assert.equal(report.results.length,28);
 for(const r of report.results){assert.equal(r.error,undefined,`${r.kind}: ${r.name}: ${r.error}`);for(const field of ['commentRetained','checkpointCommentRetained','reopenRefUnchanged','reopenResolutionUnchanged','checkpointRetained'])assert.equal(r[field],true,`${r.kind}/${r.name}/${field}`);assert.equal(r.historicalContent,r.kind==='csv'?'Design,100':'Ship on Monday.');assert.equal(r.after,r.rows.map(row=>row.content).join(r.kind==='csv'?'\n':'\n\n')+'\n',`${r.kind}/${r.name}/serialized rows`);}
 await page.waitForFunction(()=>!document.getElementById('run').disabled);
 assert.match(await page.locator('#status').textContent(),/28 experiments/);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({experiments:report.results.length,semanticExpectationsMet:report.results.filter(r=>r.meetsExpectation===true).length,semanticMismatches:report.results.filter(r=>r.meetsExpectation===false).map(r=>`${r.kind}: ${r.name}`),ambiguous:report.results.filter(r=>r.meetsExpectation===null).length,persistenceChecks:'all passed',browserErrors:errors},null,2));
} finally {await browser.close();await app.close();}
