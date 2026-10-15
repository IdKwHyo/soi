import test from 'node:test';
import assert from 'node:assert/strict';
import {aiView} from '../dist/copilot/ai-view.mjs';
import {createAiDemoState,updateAiDemo,summarizeAiDemo} from '../dist/copilot/ai-demo.mjs';

test('live AI route shows the unconnected state even if sample data is accidentally supplied',()=>{
 const aiState=createAiDemoState(),summary=summarizeAiDemo(aiState);
 for(const language of ['en','th']){
  const html=aiView({language,demo:false,aiState,summary,messages:[{role:'assistant',content:'PRIVATE SAMPLE SENTINEL'}]});
  assert.match(html,/href="\/copilot\/demo#ai"/);
  assert.doesNotMatch(html,/PRIVATE SAMPLE SENTINEL|cp-ai-form|data-ai-action|13\/10\/2569/);
 }
});

test('AI demo preserves unconfirmed costs, escapes chat, and keeps confirmations keyboard accessible',()=>{
 let aiState=createAiDemoState();
 const question='<img src=x onerror=alert(1)>',messages=[{role:'user',content:question},{role:'assistant',content:'Evidence',sources:[{title:question,url:'javascript:alert(1)'}]}];
 for(const language of ['en','th']){
  const html=aiView({language,demo:true,aiState,summary:summarizeAiDemo(aiState),messages});
  assert.match(html,/13\/10\/2569/);assert.match(html,/2026-10-13/);
  assert.match(html,/id="cp-ai-form"/);assert.match(html,/id="cp-ai-storage"/);assert.match(html,/id="cp-ai-demand"/);
  assert.ok(!html.includes(question));assert.doesNotMatch(html,/href="javascript:/);
  assert.match(html,/&lt;img/);assert.match(html,/href="#order"/);
  assert.equal(summarizeAiDemo(aiState).weeklyMetrics[1].contributionCents,null);
 }
 aiState=updateAiDemo(aiState,{action:'confirm-receipt'});
 const html=aiView({language:'en',demo:true,aiState,summary:summarizeAiDemo(aiState),messages:[]});
 const confirm=html.match(/<button\b[^>]*id="cp-ai-confirm"[^>]*>/)?.[0];
 assert.ok(confirm);assert.doesNotMatch(confirm,/\bdisabled\b/);
 assert.match(html,/Sample confirmed/);assert.match(html,/Fixed fictional comparison/);
});
