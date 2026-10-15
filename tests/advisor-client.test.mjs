import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../dist/data.mjs';
import {parseReceipt,confirmReceipt} from '../dist/advisor.mjs';

function browserStorage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const photo=()=>new File([Uint8Array.of(137,80,78,71,13,10,26,10)],'receipt.png',{type:'image/png'});
async function withBrowser(path,run){
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage,oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 globalThis.localStorage=browserStorage();Object.defineProperty(globalThis,'location',{value:{pathname:path,origin:'https://studio.test'},writable:true,configurable:true});
 try{await run();}finally{globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage;if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else delete globalThis.location;}
}
test('demo chat, retrieval, receipt reading and comparison never contact backend or OCR models',()=>withBrowser('/demo',async()=>{
 let requests=0;globalThis.fetch=async()=>{requests++;throw Error('Backend down');};
 const client=await import('../dist/client.mjs?advisor-demo');await client.loadWorkspace();
 await client.commit('business',{business:{audience:'Night shift workers'}});
 const draft=await client.readReceipt(photo());assert.equal(draft.source.mode,'simulated');assert.equal(draft.total,223);
 const confirmed=await client.saveReceipt(draft,photo());assert.equal(confirmed.state.receipts.length,1);
 let result=await client.askAdvisor({text:'Read my latest receipt',language:'en'});
 assert.match(result.operation.response.answer,/223/);assert.ok(result.operation.response.sources.some(source=>source.id.startsWith('receipt:')));
 result=await client.askAdvisor({text:'Who are my customers?',language:'en'});assert.match(result.operation.response.answer,/Night shift workers/);
 assert.equal(result.operation.response.retrieval.mode,'simulated');assert.ok(result.state.messages.every(message=>message.mode==='simulated'));
 result=await client.commit('candidates',{language:'en'});assert.equal(result.state.runs.at(-1).evaluation.mode,'simulated');
 result=await client.clearChat();assert.equal(result.state.messages.length,0);assert.equal(result.state.receipts.length,1);assert.equal(requests,0);
}));
test('main app never substitutes a simulated reply or receipt for unavailable real providers',()=>withBrowser('/',async()=>{
 let writes=0;globalThis.fetch=async(url,options)=>{if(options.method==='GET')return Response.json({state:createWorkspace(),capabilities:{storage:'cloud',model:'rules',advisor:'not-configured'}});writes++;throw Error('Unexpected live write');};
 const client=await import('../dist/client.mjs?advisor-main-unconfigured');await client.loadWorkspace();
 await assert.rejects(client.askAdvisor({text:'Compare campaigns',language:'en'}),/not connected/);
 await assert.rejects(client.readReceipt(photo()),/Web Workers/);assert.equal(writes,0);
}));
test('main receipt confirms only after private photo archival and uses returned cloud revision',()=>withBrowser('/',async()=>{
 let saved=createWorkspace();const calls=[];
 globalThis.fetch=async(url,options)=>{
  if(options.method==='GET')return Response.json({state:saved,capabilities:{storage:'cloud',advisor:'not-configured'}});
  calls.push(url);
  if(url==='/api/receipt-source'){
   assert.ok(options.body instanceof FormData);assert.equal(options.body.get('expectedRevision'),'0');
   saved=structuredClone(saved);saved.receiptUploads.push({id:'upload-1',name:'receipt.png',contentType:'image/png',bytes:8,createdAt:new Date().toISOString()});saved.revision=1;
   return Response.json({state:saved,capabilities:{storage:'cloud'},operation:{source:{id:'upload-1'}}});
  }
  const body=JSON.parse(options.body);assert.equal(body.action,'receipt');assert.equal(body.expectedRevision,1);assert.equal(body.payload.receipt.uploadId,'upload-1');
  saved=structuredClone(saved);const receipt=confirmReceipt(saved,body.payload);return Response.json({state:saved,capabilities:{storage:'cloud'},operation:{receipt}});
 };
 const client=await import('../dist/client.mjs?advisor-main-archive');await client.loadWorkspace();
 const draft=parseReceipt('SHOP\n2026-10-12\nRice 2 x 89.00 178.00\nTOTAL 178.00',{name:'Receipt',engine:'Tesseract.js 7'});
 const result=await client.saveReceipt(draft,photo());assert.deepEqual(calls,['/api/receipt-source','/api/workspace']);assert.equal(result.state.receipts[0].source.mode,'ocr');assert.equal(result.state.revision,2);
}));
test('failed private photo upload never confirms a receipt',()=>withBrowser('/',async()=>{
 let commits=0;globalThis.fetch=async(url,options)=>options.method==='GET'?Response.json({state:createWorkspace(),capabilities:{storage:'cloud'}}):url==='/api/receipt-source'?Response.json({error:'Photo archive unavailable'},{status:503}):(commits++,Response.json({}));
 const client=await import('../dist/client.mjs?advisor-main-archive-fail');await client.loadWorkspace();
 const draft=parseReceipt('SHOP\nRice 2 x 89.00 178.00\nTOTAL 178.00',{engine:'Tesseract.js 7'});
 await assert.rejects(client.saveReceipt(draft,photo()),/archive unavailable/);assert.equal(commits,0);
}));
test('retry after a lost manual confirmation response returns the already-confirmed record',()=>withBrowser('/',async()=>{
 let saved=createWorkspace(),writes=0;
 globalThis.fetch=async(url,options)=>{
  if(options.method==='GET')return Response.json({state:saved,capabilities:{storage:'cloud'}});
  writes++;const body=JSON.parse(options.body);saved=structuredClone(saved);confirmReceipt(saved,body.payload);
  throw new TypeError('Connection lost after commit');
 };
 const client=await import('../dist/client.mjs?advisor-ambiguous-confirm');await client.loadWorkspace();
 const draft=parseReceipt('SHOP\nRice 2 x 89.00 178.00\nTOTAL 178.00',{engine:'Owner-entered receipt fields · no OCR'});draft.source.mode='manual';
 await assert.rejects(client.saveReceipt(draft),/Connection lost/);
 const result=await client.saveReceipt(draft);assert.equal(result.operation.alreadyConfirmed,true);assert.equal(result.state.receipts.length,1);assert.equal(writes,1);
}));
