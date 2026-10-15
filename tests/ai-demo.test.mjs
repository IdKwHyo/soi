import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiDemoState,updateAiDemo,summarizeAiDemo,answerAiDemo} from '../dist/copilot/ai-demo.mjs';
import {createCopilotState,applyCopilotAction} from '../dist/copilot/domain.mjs';

const confirmed=()=>updateAiDemo(createAiDemoState(),{action:'confirm-receipt',value:true});

test('fictional Thai receipt normalizes Buddhist date and kg, while unreviewed money remains outside analysis',()=>{
  const state=createAiDemoState(),summary=summarizeAiDemo(state);
  assert.deepEqual(summary.window,{start:'2026-10-01',end:'2026-10-14',asOf:'2026-10-14'});
  assert.equal(summary.simulation,true);assert.equal(summary.receipt.dateRaw,'13/10/2569');assert.equal(summary.receipt.dateISO,'2026-10-13');
  assert.equal(summary.receipt.quantityG,2000);assert.equal(summary.receipt.purchaseCostCents,18000);assert.equal(summary.receipt.unitCostCentsPerG,9);assert.equal(summary.receipt.unitCostCentsPerKg,9000);assert.equal(summary.receipt.portionCostCents,900);
  assert.equal(summary.weeklyMetrics[1].purchaseCents,72000);assert.equal(summary.weeklyMetrics[1].pendingPurchaseCents,18000);assert.equal(summary.weeklyMetrics[1].recipeCogsCents,null);assert.equal(summary.weeklyMetrics[1].contributionCents,null);
  const approved=summarizeAiDemo(updateAiDemo(state,{action:'confirm-receipt'}));assert.equal(approved.weeklyMetrics[1].purchaseCents,90000);assert.equal(approved.weeklyMetrics[1].pendingPurchaseCents,0);assert.equal(state.receiptConfirmed,false);
});

test('two-week calculation separates purchases, recipe usage, cancellations and channel fees',()=>{
  const summary=summarizeAiDemo(confirmed()),[a,b]=summary.weeklyMetrics;
  assert.equal(a.completedPortions,100);assert.equal(a.cancelledPortions,4);assert.equal(a.offlinePortions,70);assert.equal(a.onlinePortions,30);
  assert.equal(b.completedPortions,120);assert.equal(b.cancelledPortions,6);assert.equal(b.offlinePortions,80);assert.equal(b.onlinePortions,40);
  assert.deepEqual([a.purchaseCents,b.purchaseCents],[120000,90000]);assert.deepEqual([a.purchasedG,b.purchasedG],[12000,10000]);
  assert.deepEqual([a.chickenUsedG,b.chickenUsedG],[10000,12000]);assert.deepEqual([a.chickenCostCents,b.chickenCostCents],[100000,108000]);
  assert.deepEqual([a.recipeCogsCents,b.recipeCogsCents],[190000,216000]);assert.deepEqual([a.orderValueCents,b.orderValueCents],[710000,860000]);
  assert.deepEqual([a.feeCents,b.feeCents],[76500,102000]);assert.equal(a.offlineFeeBps,0);assert.equal(b.onlineFeeBps,3000);
  assert.deepEqual([a.contributionCents,b.contributionCents],[393500,482000]);assert.equal(summary.comparison.contributionChangeCents,88500);assert.equal(summary.comparison.contributionChangePercent,22.49);
  assert.ok(summary.assumptions.some(value=>value.includes('Cancellation waste is unknown')));assert.ok(summary.assumptions.some(value=>value.includes('not net profit')));
});

test('demand changes only the explicit adaptive prep rule and cannot invent stock or reorder quantities',()=>{
  const original=confirmed(),expectedWeekly=summarizeAiDemo(original).weeklyMetrics;
  for(const [value,plates] of [[80,13],[100,17],[120,20]]){
    const next=updateAiDemo(original,{action:'demand',value}),summary=summarizeAiDemo(next);
    assert.deepEqual(summary.weeklyMetrics,expectedWeekly);assert.equal(summary.suggestedPrep.plates,plates);assert.equal(summary.suggestedPrep.chickenG,plates*100);
    assert.equal(summary.suggestedPrep.reorderQuantityG,null);assert.equal(summary.suggestedPrep.inventoryKnown,false);assert.match(summary.suggestedPrep.method,/not a forecast or a trained model/);
  }
  assert.equal(original.demandPercent,100);for(const value of [0,99,Infinity,'100'])assert.throws(()=>updateAiDemo(original,{action:'demand',value}));
  assert.throws(()=>updateAiDemo(original,{action:'storage',value:'room temperature'}));assert.throws(()=>updateAiDemo(original,{action:'confirm-receipt',value:'yes'}));
});

test('stock reminder requires confirmed receipt and explicit cold-storage assumption; no expiry is inferred',()=>{
  const unconfirmed=updateAiDemo(createAiDemoState(),{action:'storage',value:'chilled'});assert.equal(summarizeAiDemo(unconfirmed).stockReview.reviewOn,null);
  const unknown=summarizeAiDemo(confirmed()).stockReview;assert.equal(unknown.status,'storage-unknown');assert.equal(unknown.reviewOn,null);assert.equal(unknown.expiryDate,null);
  const chilled=summarizeAiDemo(updateAiDemo(confirmed(),{action:'storage',value:'chilled'})).stockReview;
  assert.equal(chilled.reviewOn,'2026-10-14');assert.equal(chilled.expiryKnown,false);assert.equal(chilled.expiryDate,null);assert.equal(chilled.remainingStockG,null);
  assert.deepEqual(chilled.guideline,{ingredient:'Raw chicken pieces',temperatureMaxC:4,minDays:1,maxDays:2,scope:'General home refrigeration guidance; not a commercial use-by certification.'});
  assert.match(chilled.detail,/not an expiry date/);assert.match(chilled.detail,/earlier limit takes precedence/);
  assert.deepEqual(chilled.sources.map(source=>new URL(source.url).hostname),['www.foodsafety.gov','www.who.int']);
  const reset=updateAiDemo(updateAiDemo(confirmed(),{action:'storage',value:'chilled'}),{action:'storage',value:'unknown'});assert.equal(summarizeAiDemo(reset).stockReview.reviewOn,null);
});

test('QR service context updates its own cost totals without contaminating the fixed 14-day comparison',()=>{
  let copilotState=createCopilotState();copilotState=applyCopilotAction(copilotState,{action:'costing',payload:{menuId:'basil-chicken',source:'demo',ingredients:[{name:'Chicken',source:'demo',purchaseCostCents:18000,purchaseQuantity:2000,portionQuantity:100,unit:'g'}],packagingCents:300,otherVariableCents:200,onlineFeeBps:3000}}).state;
  const state=confirmed(),before=summarizeAiDemo(state,{copilotState});
  copilotState=applyCopilotAction(copilotState,{action:'order',payload:{requestId:'ai-current-service-001',channel:'offline',table:'QR table',items:[{id:'basil-chicken',quantity:2}],note:''}}).state;
  const after=summarizeAiDemo(state,{copilotState});assert.deepEqual(before.weeklyMetrics,after.weeklyMetrics);assert.equal(after.currentService.quantity,2);assert.equal(after.currentService.openQuantity,2);assert.equal(after.currentService.orderValueCents,13000);assert.equal(after.currentService.contributionCents,10200);
  const answer=answerAiDemo('How are current service QR orders doing?',state,'en',{copilotState});assert.equal(answer.topic,'current-service');assert.match(answer.content,/THB 130.00/);assert.match(answer.content,/not added/);
  assert.equal(summarizeAiDemo(state).currentService,null);assert.match(answerAiDemo('Current service?',state).content,/No current-service context/);
});

test('advisor responses are deterministic, bilingual, bounded and explicit about missing evidence and simulation',()=>{
  const state=confirmed(),snapshot=JSON.stringify(state);
  for(const language of ['en','th'])for(const question of ['OCR receipt','profit this week','prepare tomorrow','safe storage expiry','which Gemini model','unrelated competitive secret']){
    const a=answerAiDemo(question,state,language),b=answerAiDemo(question,state,language);assert.deepEqual(a,b);assert.equal(a.mode,'deterministic-demo');assert.equal(a.simulation,true);assert.equal(a.role,'assistant');assert.ok(a.content.length>40);
  }
  assert.match(answerAiDemo('which Gemini model',state).content,/No Gemini, Llama or API/);assert.match(answerAiDemo('unrelated competitive secret',state).content,/no evidence/);
  assert.match(answerAiDemo('is raw chicken safe for the 14 day window?',state).content,/not chicken shelf life/);
  assert.match(answerAiDemo('profit this week',createAiDemoState()).content,/remain unknown/);assert.match(answerAiDemo('หมดอายุไหม',state,'th').content,/ไม่ใช่อายุเก็บไก่/);
  assert.equal(JSON.stringify(state),snapshot);assert.throws(()=>answerAiDemo('',state));assert.throws(()=>answerAiDemo('x'.repeat(1001),state));assert.throws(()=>answerAiDemo('hi',state,'jp'));
});


test('today wording does not steal prep intent and current-service answers cite their own context',()=>{
  const state=confirmed();
  assert.equal(answerAiDemo('How much chicken should I prepare today?',state).topic,'prep');
  assert.equal(answerAiDemo('วันนี้ควรเตรียมไก่เท่าไร',state,'th').topic,'prep');
  assert.equal(answerAiDemo('Prepare portions for QR demand today',state).topic,'prep');
  const current=answerAiDemo('How are current QR orders?',state,'en',{copilotState:createCopilotState()});
  assert.deepEqual(current.sources.map(source=>source.id),['current-service']);assert.match(current.sources[0].title,/Current browser demo orders/);
  assert.equal(answerAiDemo('What date is the receipt?',state).topic,'receipt');
});
