import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace,validateWorkspace,saveMemory,commitManualDataset} from '../dist/data.mjs';
import {normalizeAssistantState,parseReceipt,sampleReceiptDraft,validateReceiptDraft,confirmReceipt,recordExchange,buildEvidence,simulateReply} from '../dist/advisor.mjs';

const question='Which menu has the highest contribution?';

test('old schema-2 workspaces migrate absent assistant arrays without losing business history',()=>{
  const state=createWorkspace();delete state.messages;delete state.receipts;delete state.receiptUploads;
  const before=JSON.stringify({business:state.business,datasets:state.datasets,memories:state.memories});
  assert.equal(normalizeAssistantState(state),state);validateWorkspace(state);
  assert.deepEqual([state.messages,state.receipts,state.receiptUploads],[[],[],[]]);
  assert.equal(JSON.stringify({business:state.business,datasets:state.datasets,memories:state.memories}),before);
  state.receipts=null;assert.throws(()=>validateWorkspace(state),/receipt/);
});
test('sample receipt is explicitly simulated and has exact THB223 arithmetic',()=>{
  const sample=sampleReceiptDraft({name:'Uploaded different photo'}),receipt=validateReceiptDraft(sample);
  assert.equal(receipt.total,223);assert.equal(receipt.source.mode,'simulated');
  assert.equal(receipt.items[0].quantity,2);assert.equal(receipt.items[0].unitPrice,89);
  assert.match(receipt.warnings[0],/different photo/);assert.match(receipt.text,/not extracted/);
});
test('Thai and English receipt parsing conservatively identifies explicit quantities, dates and totals',()=>{
  const receipt=parseReceipt('ร้านข้าวสด\nSales receipt\n11/10/2569\nItem Qty Unit Price Total\nข้าวกะเพราไก่ 2 x 89.00 178.00\nชาไทย 1 x 45.00 45.00\nTOTAL THB 223.00',{name:'Lunch receipt',engine:'Tesseract Thai + English'});
  assert.equal(receipt.date,'2026-10-11');assert.equal(receipt.merchant,'ร้านข้าวสด');assert.equal(receipt.kind,'sale');
  assert.equal(receipt.items.length,2);assert.equal(receipt.total,223);
  assert.deepEqual(receipt.items[0],{name:'ข้าวกะเพราไก่',quantity:2,unitPrice:89,lineTotal:178});
  assert.equal(validateReceiptDraft(receipt).source.mode,'ocr');
});
test('an amount does not invent a quantity, unit price or a receipt date',()=>{
  const receipt=parseReceipt('Soi Kitchen\nBasil chicken rice 178.00\nThai iced tea 45.00\nTOTAL 223.00',{engine:'Tesseract'});
  assert.equal(receipt.date,null);assert.equal(receipt.kind,'other');
  assert.equal(receipt.items[0].quantity,null);assert.equal(receipt.items[0].unitPrice,null);
  assert.equal(receipt.items[0].lineTotal,178);assert.equal(validateReceiptDraft(receipt).total,223);
});
test('Thai digits, comma grouping, ambiguous totals and invalid dates stay reviewable',()=>{
  const receipt=parseReceipt('ร้านตัวอย่าง\nวันที่ 31/02/2569\nรายการ จำนวน ราคาต่อหน่วย ยอดเงิน\nข้าว ๒ x ๑,๐๐๐.๐๐ ๒,๐๐๐.๐๐\nยอดรวม ๒,๐๐๐.๐๐\nTOTAL 1,999.00',{engine:'Tesseract'});
  assert.equal(receipt.date,null);assert.equal(receipt.total,null);
  assert.equal(receipt.items[0].quantity,2);assert.equal(receipt.items[0].unitPrice,1000);
  assert.ok(receipt.warnings.some(value=>value.includes('Multiple different totals')));
  assert.ok(receipt.warnings.some(value=>value.includes('date could not be validated')));
});
test('confirm blocks contradictory line/receipt arithmetic using satang and supports fractional purchase quantities',()=>{
  const receipt=sampleReceiptDraft();receipt.items[0].lineTotal=177.99;
  assert.throws(()=>validateReceiptDraft(receipt),/quantity.*unit price/);
  const receipt2=sampleReceiptDraft();receipt2.total=222.99;
  assert.throws(()=>validateReceiptDraft(receipt2),/known line totals/);
  const purchase={...sampleReceiptDraft(),kind:'purchase',items:[{name:'Ingredient by weight',quantity:0.125,unitPrice:10.05,lineTotal:1.26}],total:1.26};
  assert.equal(validateReceiptDraft(purchase).items[0].lineTotal,1.26);
  assert.throws(()=>validateReceiptDraft({...purchase,items:[{...purchase.items[0],quantity:0.12345}]}),/three decimal places/);
});
test('missing fields survive validation without coercion and unsupported currency is rejected',()=>{
  const receipt={...sampleReceiptDraft(),merchant:null,date:null,items:[{name:'Unread line',quantity:null,unitPrice:null,lineTotal:null}],total:null};
  assert.deepEqual(validateReceiptDraft(receipt).items,receipt.items);
  assert.equal(validateReceiptDraft(receipt).total,null);
  assert.throws(()=>validateReceiptDraft({...receipt,currency:'USD'}),/THB/);
  assert.throws(()=>validateReceiptDraft({...receipt,items:[{name:'bad',quantity:-1,unitPrice:1,lineTotal:1}]}),/quantity/);
  assert.throws(()=>validateReceiptDraft({...receipt,total:12.001}),/decimal/);
  assert.throws(()=>validateReceiptDraft({...receipt,date:'2026-02-30'}),/calendar/);
});
test('confirmed receipt is immutable, records owner review and never changes sales, costs or memory',()=>{
  const state=createWorkspace(),before=JSON.stringify({datasets:state.datasets,memories:state.memories});
  assert.throws(()=>confirmReceipt(state,{receipt:sampleReceiptDraft(),reviewed:false}),/Review/);
  const input=sampleReceiptDraft(),record=confirmReceipt(state,{receipt:input,reviewed:true});
  input.items[0].name='Changed after save';
  assert.equal(record.items[0].name,'ข้าวกะเพราไก่ · Basil chicken rice');
  assert.throws(()=>{record.items[0].quantity=3;},TypeError);
  assert.equal(record.status,'confirmed');assert.equal(record.reviewed,true);assert.equal(state.revision,1);
  assert.equal(JSON.stringify({datasets:state.datasets,memories:state.memories}),before);
  assert.throws(()=>confirmReceipt(state,{receipt:record,reviewed:true}),/already confirmed/);
  const restored=JSON.parse(JSON.stringify(state));validateWorkspace(restored);
  assert.throws(()=>{restored.receipts[0].total=1;},TypeError);
});
test('receipt attachment reference is scoped to the workspace and receipt capacity is bounded',()=>{
  const state=createWorkspace(),receipt={...sampleReceiptDraft(),uploadId:'upload_1'};
  assert.throws(()=>confirmReceipt(state,{receipt,reviewed:true}),/missing/);
  state.receiptUploads.push({id:'upload_1',name:'receipt.png',contentType:'image/png',bytes:128,createdAt:new Date().toISOString()});
  const saved=confirmReceipt(state,{receipt,reviewed:true});assert.equal(saved.uploadId,'upload_1');validateWorkspace(state);
  while(state.receipts.length<50)confirmReceipt(state,{receipt:sampleReceiptDraft(),reviewed:true});
  assert.throws(()=>confirmReceipt(state,{receipt:sampleReceiptDraft(),reviewed:true}),/Export/);
});
test('evidence includes current facts, exact metrics, confirmed receipts and honestly attributed playbook',()=>{
  const state=createWorkspace();const old=saveMemory(state,{key:'Supplier',value:'Old supplier',source:'Old invoice'});
  const current=saveMemory(state,{key:'supplier',value:'Current supplier',source:'Owner confirmation'});
  const receipt=confirmReceipt(state,{receipt:sampleReceiptDraft(),reviewed:true}),evidence=buildEvidence(state);
  assert.ok(evidence.some(document=>document.id===`memory:${current.id}`));assert.ok(!evidence.some(document=>document.id===`memory:${old.id}`));
  assert.match(evidence.find(document=>document.id.startsWith('dataset:')).text,/39015.00/);
  assert.equal(evidence.find(document=>document.id===`receipt:${receipt.id}`).sourceType,'simulated-receipt');
  assert.ok(evidence.filter(document=>document.sourceType==='project-playbook').every(document=>document.source.includes('not externally validated')));
});
test('demo replies use the current merchant data and distinguish receipt, margin, context and campaign intent',()=>{
  const state=createWorkspace();
  const margin=simulateReply(state,{text:question,language:'en'});
  assert.match(margin.answer,/Simulated reply/);assert.match(margin.answer,/37.20/);assert.match(margin.answer,/Basil chicken rice/);
  const emptyReceipt=simulateReply(state,{text:'Read my receipt',language:'en'});assert.match(emptyReceipt.answer,/no confirmed receipts/);
  confirmReceipt(state,{receipt:sampleReceiptDraft({name:'Lunch transaction'}),reviewed:true});
  const receipt=simulateReply(state,{text:'What is on my receipt?',language:'en'});assert.match(receipt.answer,/Lunch transaction/);assert.match(receipt.answer,/223.00/);
  saveMemory(state,{key:'Supplier',value:'Chicken from Local Market',source:'Owner note'});
  const remembered=simulateReply(state,{text:'What do you remember about my supplier?',language:'en'});assert.match(remembered.answer,/Chicken from Local Market/);
  state.business.capacity=10;
  const campaign=simulateReply(state,{text:'Compare campaigns A/B',language:'en'});
  assert.ok(campaign.evaluation.candidates.every(candidate=>candidate.financialChecks.capacity===false));assert.equal(campaign.evaluation.recommendation,null);
  assert.match(campaign.answer,/not an observed customer A\/B/);
  const thai=simulateReply(state,{text:'เปรียบเทียบแคมเปญ',language:'th'});assert.match(thai.answer,/คำตอบจำลอง/);assert.match(thai.answer,/กำลังผลิต/);
  state.business.name='New Merchant';commitManualDataset(state,[{...state.datasets[0].menus[0],name:'New Menu',price:100}]);
  const updated=simulateReply(state,{text:question,language:'en'});assert.match(updated.answer,/New Menu/);assert.doesNotMatch(updated.answer,/Basil chicken rice/);
});
test('demo replies do not claim evidence for unsupported questions and only emit safe review actions',()=>{
  const response=simulateReply(createWorkspace(),{text:'What is the exact weather next Tuesday?',language:'en'});
  assert.match(response.answer,/not have enough specific evidence/);
  assert.equal(response.retrieval.mode,'simulated');assert.ok(response.sources.length<=5);
  assert.ok(response.actions.every(action=>['compare','data','receipt-review'].includes(action.type)));
  assert.ok(response.sources.every(source=>typeof source.text==='string'&&source.source));
});
test('message exchanges are bounded, source-aware and persist without losing confirmed receipts',()=>{
  const state=createWorkspace();confirmReceipt(state,{receipt:sampleReceiptDraft(),reviewed:true});
  const response=simulateReply(state,{text:question,language:'en'});
  for(let index=0;index<45;index++)recordExchange(state,{question:`Question ${index}`,response,language:'en',mode:'simulated'});
  assert.equal(state.messages.length,80);assert.equal(state.messages[0].content,'Question 5');
  assert.equal(state.messages.at(-1).role,'assistant');assert.deepEqual(state.messages.at(-1).sources,response.sources);
  assert.equal(state.receipts.length,1);validateWorkspace(JSON.parse(JSON.stringify(state)));
  assert.throws(()=>recordExchange(state,{question:'a'.repeat(2001),response,language:'en',mode:'simulated'}),/2000/);
  assert.throws(()=>recordExchange(state,{question,response:{...response,actions:[{type:'send-email',label:'Send'}]},language:'en',mode:'simulated'}),/reviewable/);
  assert.throws(()=>recordExchange(state,{question,response:{...response,answer:'a'.repeat(8001)},language:'en',mode:'simulated'}),/8000/);
});


test('large menu collections become bounded individual evidence documents and simulated citations remain small',()=>{
  const state=createWorkspace();
  commitManualDataset(state,Array.from({length:100},(_,index)=>({...state.datasets[0].menus[0],name:`Menu ${index} ${'a'.repeat(180)}`})));
  const documents=buildEvidence(state);assert.equal(documents.filter(document=>document.id.startsWith('menu:')).length,100);
  assert.ok(documents.every(document=>document.text.length<=12000));
  const response=simulateReply(state,{text:'Which menu has the best contribution?',language:'en'});
  assert.ok(response.sources.every(source=>source.text.length<=2400));
  recordExchange(state,{question:'Best contribution?',response,language:'en',mode:'simulated'});validateWorkspace(state);
});


test('OCR parsing refuses explicit foreign currency and never changes a negative adjustment into a positive item',()=>{
  assert.throws(()=>parseReceipt('Store\nItem 10.00\nTOTAL USD 10.00'),/THB/);
  const receipt=parseReceipt('Store\nItem 10.00\nReturned item -5.00\nTOTAL 5.00');
  assert.equal(receipt.items.length,1);assert.ok(receipt.warnings.some(warning=>warning.includes('signed amount')));
  assert.throws(()=>validateReceiptDraft(receipt),/arithmetic/);
  const huge=parseReceipt('Store\nItem 9999999999999999999999999999.00\nTOTAL 9999999999999999999999999999.00');
  assert.equal(huge.total,null);assert.equal(huge.items[0].lineTotal,null);
});


test('manual receipts preserve honest origin and caller confirmation identifiers without claiming OCR',()=>{
  const state=createWorkspace();
  const draft={...sampleReceiptDraft(),id:'receipt_merchant_entered_1',source:{mode:'manual',engine:'Owner-entered fields · no OCR'},text:'Owner entered fields from a receipt; no OCR.'};
  const confirmed=confirmReceipt(state,{receipt:draft,reviewed:true});
  assert.equal(confirmed.id,draft.id);assert.equal(confirmed.source.mode,'manual');assert.match(confirmed.reviewNote,/no OCR extraction/);
  const evidence=buildEvidence(state).find(document=>document.id===`receipt:${draft.id}`);assert.match(evidence.source,/owner-entered fields, no OCR/);assert.equal(evidence.sourceType,'confirmed-receipt');
  validateWorkspace(JSON.parse(JSON.stringify(state)));
  assert.throws(()=>confirmReceipt(state,{receipt:draft,reviewed:true}),/already confirmed/);assert.equal(state.receipts.length,1);
  assert.throws(()=>validateReceiptDraft({...draft,id:'receipt/invalid'}),/identifier/);
  assert.throws(()=>validateReceiptDraft({...draft,id:'a'.repeat(101)}),/100/);
});
test('an already-confirmed source photo cannot create a second receipt through a new confirmation identifier',()=>{
  const state=createWorkspace();state.receiptUploads.push({id:'upload_1',name:'receipt.png',contentType:'image/png',bytes:128,createdAt:new Date().toISOString()});
  const draft={...sampleReceiptDraft(),id:'receipt_first_attempt',uploadId:'upload_1'};
  const saved=confirmReceipt(state,{receipt:draft,reviewed:true});assert.equal(saved.id,draft.id);
  assert.throws(()=>confirmReceipt(state,{receipt:{...draft,id:'receipt_second_attempt'},reviewed:true}),/already linked/);
  assert.equal(state.receipts.length,1);assert.equal(state.revision,1);
  const duplicateHistory=JSON.parse(JSON.stringify(state));duplicateHistory.receipts.push({...duplicateHistory.receipts[0],id:'receipt_duplicate_history'});assert.throws(()=>validateWorkspace(duplicateHistory),/multiple confirmed/);
  const missingHistory=JSON.parse(JSON.stringify(state));missingHistory.receiptUploads=[];assert.throws(()=>validateWorkspace(missingHistory),/missing its workspace/);
});
