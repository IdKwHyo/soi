import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleApi} from '../worker/backend.mjs';
import {cosineSimilarity,resolveAssistantReply} from '../worker/assistant.mjs';
import {createStorage} from '../worker/storage.mjs';
import {createWorkspace} from '../dist/data.mjs';

function harness(overrides={}) {
  const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');
  for(const name of ['0000_initial.sql','0001_advisor_records.sql'])database.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  const DB={prepare(sql){const stmt=database.prepare(sql);return {bind(...args){return {sql,args,first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)})};}};},async batch(statements){database.exec('BEGIN');try{const rows=statements.map(({sql,args})=>({meta:{changes:database.prepare(sql).run(...args).changes}}));database.exec('COMMIT');return rows;}catch(error){database.exec('ROLLBACK');throw error;}}};
  const files=new Map(),BUCKET={async put(key,bytes,metadata){files.set(key,{bytes:new Uint8Array(bytes),metadata});},async get(key){const file=files.get(key);return file?{body:new Blob([file.bytes]).stream()}:null;},async delete(key){files.delete(key);}};
  return {env:{DB,BUCKET,...overrides},files,database};
}
async function call(env,{user='owner',action,payload={},revision=0,path='/api/workspace',body,contentType,origin='https://example.test'}={}) {
  const method=action||body?'POST':'GET',headers={};if(user)headers['oai-authenticated-user-id']=user;
  if(method==='POST') {if(origin)headers.Origin=origin;if(!body)headers['Content-Type']='application/json';else if(contentType)headers['Content-Type']=contentType;}
  const response=await handleApi(new Request(`https://example.test${path}`,{method,headers,body:method==='POST'?(body||JSON.stringify({action,payload,expectedRevision:revision})):undefined}),env);
  return {status:response.status,body:response.headers.get('Content-Type')?.includes('json')?await response.json():new Uint8Array(await response.arrayBuffer()),response};
}
const png=()=>new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
function uploadForm(revision=0,{bytes=png(),type='image/png'}={}) {const form=new FormData();form.set('expectedRevision',String(revision));form.set('file',new Blob([bytes],{type}),'receipt.png');return form;}

test('cosine uses semantic vectors and rejects incompatible dimensions or invalid values',()=>{
  assert.equal(cosineSimilarity([1,0],[1,0]),1);assert.equal(cosineSimilarity([1,0],[0,1]),0);
  assert.throws(()=>cosineSimilarity([1,0],[1]));assert.throws(()=>cosineSimilarity([0,0],[1,0]));assert.throws(()=>cosineSimilarity([Infinity,0],[1,0]));
});
test('reply sources and actions resolve from server evidence only',()=>{
  const docs=[{id:'private-fact',title:'Owner fact',sourceType:'memory',source:'Owner',text:'Fact',updatedAt:'now'}];
  const output={answer:'Based on your confirmed fact.',sourceIds:['private-fact'],assumptions:['No measured uplift yet.'],actions:[{type:'compare',label:'Compare strategies'}]};
  assert.equal(resolveAssistantReply(output,docs,{mode:'semantic'}).sources[0].source,'Owner');
  assert.throws(()=>resolveAssistantReply({...output,sourceIds:['other-business-fact']},docs,{}));
  assert.throws(()=>resolveAssistantReply({...output,actions:[{type:'delete',label:'Delete data'}]},docs,{}));
  assert.throws(()=>resolveAssistantReply({...output,answer:'See https://invented.test'},docs,{}));
});
test('real chat missing key and merchant provider gate never return simulated replies',async()=>{
  const {env}=harness();await call(env);
  const result=await call(env,{action:'chat',payload:{text:'What should I do?',language:'en'}});assert.equal(result.status,503);assert.match(result.body.error,/GEMINI_API_KEY/);assert.equal((await call(env)).body.state.messages.length,0);
  env.GEMINI_API_KEY='server-secret';env.MODEL_FETCH=async()=>{throw Error('Must not dispatch private question');};
  const denied=await call(env,{action:'chat',payload:{text:'My secret supplier contract'}});assert.equal(denied.status,503);assert.match(denied.body.error,/ALLOW_MERCHANT_AI/);
});
test('receipt image archive is private, owner scoped and revision guarded',async()=>{
  const {env,files,database}=harness();await call(env);
  const uploaded=await call(env,{path:'/api/receipt-source',body:uploadForm()});assert.equal(uploaded.status,200);assert.equal(files.size,1);assert.equal(uploaded.body.state.revision,1);
  const source=uploaded.body.operation.source;assert.equal(source.contentType,'image/png');
  assert.deepEqual((await call(env,{path:`/api/receipt-source/${source.id}`})).body,png());
  assert.equal((await call(env,{user:'other',path:`/api/receipt-source/${source.id}`})).status,404);
  assert.equal((await call(env,{path:'/api/receipt-source',body:uploadForm()})).status,409);
  assert.equal(database.prepare("SELECT count(*) AS n FROM records WHERE kind='receipt-upload'").get().n,1);
});
test('receipt upload checks image magic, content type, origin and size before saving',async()=>{
  const {env,files}=harness();await call(env);
  assert.equal((await call(env,{path:'/api/receipt-source',body:uploadForm(0,{bytes:new TextEncoder().encode('not an actual png image')} )})).status,400);
  assert.equal((await call(env,{path:'/api/receipt-source',body:uploadForm(0,{type:'image/jpeg'})})).status,400);
  assert.equal((await call(env,{path:'/api/receipt-source',body:uploadForm(),origin:'https://evil.test'})).status,403);
  const tooBig=new Uint8Array(8*1024*1024+20_000);tooBig.set(png());
  assert.equal((await call(env,{path:'/api/receipt-source',body:tooBig,contentType:'multipart/form-data; boundary=large'})).status,413);
  assert.equal(files.size,0);assert.equal((await call(env)).body.state.revision,0);
});
test('receipt upload CAS loser releases only its unreferenced private source',async()=>{
  const {env,files}=harness();await call(env);
  const results=await Promise.all([1,2].map(()=>call(env,{path:'/api/receipt-source',body:uploadForm()})));
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);assert.equal(files.size,1);
});
const receipt=(uploadId)=>({name:'Real receipt',kind:'sale',merchant:'Shop',date:'2026-10-12',currency:'THB',items:[{name:'Tea',quantity:1,unitPrice:45,lineTotal:45}],total:45,text:'Tea 45 total 45',source:{mode:'ocr',engine:'Tesseract Thai/English'},warnings:[],...(uploadId?{uploadId}:{})});
test('confirmed receipt uses owned source, preserves dataset and rejects simulation on main',async()=>{
  const {env}=harness();const initial=(await call(env)).body.state;
  const other=await call(env,{user:'other',path:'/api/receipt-source',body:uploadForm()});
  assert.equal((await call(env,{action:'receipt',payload:{receipt:receipt(other.body.operation.source.id),reviewed:true}})).status,400);
  assert.equal((await call(env,{action:'receipt',payload:{receipt:{...receipt(),source:{mode:'simulated',engine:'Demo'}},reviewed:true}})).status,400);
  const uploaded=await call(env,{path:'/api/receipt-source',body:uploadForm()});
  const saved=await call(env,{action:'receipt',revision:1,payload:{receipt:receipt(uploaded.body.operation.source.id),reviewed:true}});assert.equal(saved.status,200);assert.equal(saved.body.state.receipts.length,1);
  assert.deepEqual(saved.body.state.datasets,initial.datasets);assert.equal(saved.body.state.activeDatasetId,initial.activeDatasetId);
  assert.equal((await call(env,{action:'chat-clear',revision:2})).body.state.receipts.length,1);
});

function vectorFor(text) {const values=new Array(768).fill(0);values[/query:|private margin note|FINALRECEIPTITEM/i.test(text)?0:1]=1;return values;}
function modelHarness({invalidCitation=false,fail=false,echoKey=false}={}) {
  const requests=[];
  const MODEL_FETCH=async(url,options)=>{
    const body=JSON.parse(options.body);requests.push({url,body});assert.equal(new Headers(options.headers).get('x-goog-api-key'),'server-only-test-key');
    if(fail)return Response.json({error:{message:'provider echoed server-only-test-key'}},{status:503});
    if(url.endsWith(':batchEmbedContents'))return Response.json({embeddings:body.requests.map(request=>({values:vectorFor(request.content.parts[0].text)}))});
    if(url.endsWith(':embedContent'))return Response.json({embedding:{values:vectorFor(body.content.parts[0].text)}});
    const prompt=JSON.parse(body.contents[0].parts[0].text);let output;
    if(prompt.evidence&&prompt.candidates&&prompt.purpose!=='candidate-generation')output={summary:'Value keeps factual copy and exact economics.',winnerKind:'value',candidates:prompt.candidates.map(candidate=>({kind:candidate.kind,groundedness:candidate.kind==='value'?0.9:0.3,unsupportedClaims:candidate.kind==='value'?[]:['Unsupported nutrition claim'],evidenceIds:[prompt.evidence[0].id],reason:'Reviewed against supplied owner facts and code calculations.'}))};
    else if(prompt.evidence&&!prompt.candidates)output={answer:echoKey?'provider echoed server-only-test-key':'Use the confirmed owner facts and review the assumptions.',sourceIds:[invalidCitation?'cross-owner-invented-id':prompt.evidence[0].id],assumptions:['Order uplift is not measured.'],actions:[{type:'compare',label:'Compare two strategies'}]};
    else output=['discount','value'].map((kind,index)=>({kind,title:`Model ${kind}`,summary:'Explicit campaign assumptions.',discount:index?0:10,extraOrders:index?30:40,existingOrders:20,budget:600,drafts:{social:'Clear factual wording',message:'Owner reviewed wording',announcement:'Offer details'}}));
    return Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify(output)}]},finishReason:'STOP'}]});
  };
  return {...harness({GEMINI_API_KEY:'server-only-test-key',GEMINI_MODEL:'gemini-test',ALLOW_MERCHANT_AI:'true',MODEL_FETCH}),requests};
}
test('real SDK semantic retrieval, scoped embedding reuse and persisted chat form a complete backend flow',async()=>{
  const {env,requests,database}=modelHarness();await call(env);
  await call(env,{action:'memory',payload:{key:'private margin note',value:'private margin note from owner A only',source:'Owner A'}});
  const first=await call(env,{action:'chat',revision:1,payload:{text:'How do I improve contribution?',language:'en'}});assert.equal(first.status,200);
  assert.equal(first.body.operation.response.retrieval.mode,'semantic');assert.equal(first.body.operation.response.retrieval.topK,4);assert.equal(first.body.state.messages.length,2);assert.equal(first.body.state.messages[1].mode,'gemini');
  assert.ok(first.body.operation.response.sources.some(source=>source.source==='Owner A'));assert.ok(!JSON.stringify(first.body).includes('server-only-test-key'));
  assert.equal(requests.filter(request=>request.url.includes('EmbedContent')).length,1);
  const again=await call(env,{action:'chat',revision:2,payload:{text:'How do I improve contribution?',language:'en'}});assert.equal(again.status,200);assert.ok(again.body.operation.response.retrieval.embeddingCacheHits>0);
  assert.equal(requests.filter(request=>request.url.includes('EmbedContent')).length,1);
  const b=await call(env,{user:'owner-b'});assert.equal(b.body.state.messages.length,0);
  const secondOwner=await call(env,{user:'owner-b',action:'chat',payload:{text:'How do I improve contribution?',language:'en'}});assert.equal(secondOwner.status,200);
  const bRequests=requests.slice(-2);assert.ok(!JSON.stringify(bRequests).includes('private margin note from owner A only'));
  assert.equal(database.prepare('SELECT count(DISTINCT business_id) AS n FROM model_cache').get().n,2);
});
test('invalid generated citations and provider failures cannot commit chat or leak errors',async()=>{
  for(const options of [{invalidCitation:true},{fail:true},{echoKey:true}]) {
    const {env,database}=modelHarness(options);await call(env);
    const result=await call(env,{action:'chat',payload:{text:'Which menu should I promote?'}});assert.equal(result.status,503);assert.ok(!JSON.stringify(result.body).includes('server-only-test-key'));
    assert.equal((await call(env)).body.state.revision,0);assert.equal((await call(env)).body.state.messages.length,0);assert.equal(database.prepare('SELECT count(*) AS n FROM model_cache').get().n,0);
  }
});
test('evidence A/B evaluator ranks generated drafts while code gates remain authoritative',async()=>{
  const {env,requests}=modelHarness();await call(env);
  const compared=await call(env,{action:'candidates',payload:{mode:'gemini',evidenceEvaluation:true,allowFallback:false,language:'en'}});assert.equal(compared.status,200);
  const run=compared.body.state.runs[0],discount=run.candidates.find(candidate=>candidate.kind==='discount'),value=run.candidates.find(candidate=>candidate.kind==='value');
  assert.ok(requests[0].url.endsWith(':batchEmbedContents'));
  const generationPrompt=JSON.parse(requests[1].body.contents[0].parts[0].text),judgePrompt=JSON.parse(requests[2].body.contents[0].parts[0].text);
  assert.equal(generationPrompt.purpose,'candidate-generation');assert.equal(generationPrompt.evidence.length,4);assert.equal(generationPrompt.memory,undefined);
  assert.deepEqual(generationPrompt.evidence.map(source=>source.id),judgePrompt.evidence.map(source=>source.id));
  assert.equal(run.evaluation.mode,'gemini-evidence-evaluator');assert.equal(run.evaluation.trained,false);assert.equal(run.evaluation.winnerId,value.id);
  assert.equal(discount.approvable,false);assert.equal(discount.checks.find(check=>check.key==='evidence').passed,false);
  assert.equal(value.approvable,true);assert.equal(value.checks.find(check=>check.key==='budget').passed,true);
  assert.equal((await call(env,{action:'approve',revision:1,payload:{candidateId:discount.id,reviewedCapacity:true,reviewedContent:true}})).status,400);
  const repeated=await call(env,{action:'candidates',revision:1,payload:{mode:'gemini',evidenceEvaluation:true,language:'en'}});assert.equal(repeated.status,200);assert.equal(requests.length,3);
  const newRun=repeated.body.state.runs.at(-1);assert.notEqual(newRun.candidates[1].id,value.id);assert.equal(newRun.evaluation.winnerId,newRun.candidates[1].id);
});
test('forward migration retains existing records, primary key, index and business ownership FK',()=>{
  const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');database.exec(readFileSync(new URL('../migrations/0000_initial.sql',import.meta.url),'utf8'));
  database.prepare('INSERT INTO businesses VALUES(?,?,?)').run('business','owner','now');database.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run('business','memory','prior',0,'{"fact":"preserved"}','now');
  database.exec(readFileSync(new URL('../migrations/0001_advisor_records.sql',import.meta.url),'utf8'));
  assert.equal(database.prepare('SELECT payload FROM records WHERE record_id=?').get('prior').payload,'{"fact":"preserved"}');
  assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='records_business_kind'").get());
  assert.throws(()=>database.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run('foreign-business','receipt','r',1,'{}','now'));
  database.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run('business','receipt','r',1,'{}','now');
  assert.throws(()=>database.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run('business','receipt','r',1,'{}','now'));
});
test('cache refresh at capacity replaces its footprint and deduplicates staged keys',async()=>{
  const {env,database}=harness(),storage=createStorage(env),loaded=await storage.load('owner',createWorkspace);
  const expiresAt=new Date(Date.now()+60_000).toISOString(),insert=database.prepare('INSERT INTO model_cache VALUES(?,?,?,?)');
  for(let index=0;index<700;index++)insert.run(loaded.businessId,`cached-${index}`,JSON.stringify({value:index}),expiresAt);
  const state=structuredClone(loaded.state);
  await storage.save('owner',loaded.businessId,state,0,'chat-clear',{previousState:loaded.state,caches:[{key:'cached-0',value:{value:'first'},expiresAt},{key:'cached-0',value:{value:'last'},expiresAt}]});
  assert.equal(database.prepare('SELECT count(*) AS n FROM model_cache').get().n,700);
  assert.deepEqual(await storage.cached(loaded.businessId,'cached-0'),{value:'last'});
  const current=await storage.load('owner',createWorkspace);
  await storage.save('owner',loaded.businessId,structuredClone(current.state),1,'chat-clear',{previousState:current.state,cache:{key:'extra',value:{value:1},expiresAt}});
  assert.equal((await storage.load('owner',createWorkspace)).state.revision,2);
  assert.equal(database.prepare('SELECT count(*) AS n FROM model_cache').get().n,700);
  assert.deepEqual(await storage.cached(loaded.businessId,'extra'),{value:1});
});

test('valid boundary-length names remain retrievable and late receipt lines are available as cited excerpts',async()=>{
  const {env,requests}=modelHarness();const initial=(await call(env)).body.state;
  const menus=initial.datasets[0].menus.map((menu,index)=>({...menu,name:index===0?'m'.repeat(200):menu.name}));
  assert.equal((await call(env,{action:'manual',payload:{menus}})).status,200);
  const first=await call(env,{action:'chat',revision:1,payload:{text:'Which menu contribution is strongest?'}});assert.equal(first.status,200);
  const longReceipt=receipt();longReceipt.items=Array.from({length:30},(_,index)=>({name:`${index===29?'FINALRECEIPTITEM':'receipt item '+index} ${'x'.repeat(180)}`,quantity:1,unitPrice:45,lineTotal:45}));longReceipt.total=1350;
  assert.equal((await call(env,{action:'receipt',revision:2,payload:{receipt:longReceipt,reviewed:true}})).status,200);
  const reply=await call(env,{action:'chat',revision:3,payload:{text:'What is FINALRECEIPTITEM on my receipt?'}});assert.equal(reply.status,200);
  assert.ok(reply.body.operation.response.sources.some(source=>source.text.includes('FINALRECEIPTITEM')));
  assert.ok(reply.body.operation.response.sources.some(source=>source.reference?.includes('excerpt')));
  const input=requests.at(-1).body.contents[0].parts[0].text;assert.ok(input.includes('FINALRECEIPTITEM'));assert.ok(input.includes('only the following receipt lines'));
});
test('concurrent real chat commits one transcript and only its model caches',async()=>{
  const {env,database}=modelHarness();await call(env);
  const results=await Promise.all(['First question','Second question'].map(text=>call(env,{action:'chat',payload:{text,language:'en'}})));
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  const state=(await call(env)).body.state;assert.equal(state.messages.length,2);assert.equal(state.revision,1);
  assert.equal(database.prepare('SELECT count(*) AS n FROM mutation_audit').get().n,1);
  assert.equal(database.prepare("SELECT count(*) AS n FROM model_cache WHERE json_extract(payload,'$.answer') IS NOT NULL").get().n,1);
});
test('full ephemeral cache evicts only owner cache and does not block valid real chat',async()=>{
  const {env,database}=modelHarness(),initial=(await call(env)).body.state,other=(await call(env,{user:'other-owner'})).body.state;
  const expiresAt=new Date(Date.now()+60_000).toISOString(),insert=database.prepare('INSERT INTO model_cache VALUES(?,?,?,?)');
  for(let index=0;index<700;index++)insert.run(initial.id,`older-cache-${index}`,JSON.stringify({value:index}),expiresAt);
  insert.run(other.id,'keep-other-owner',JSON.stringify({value:'Other private cache'}),expiresAt);
  const reply=await call(env,{action:'chat',payload:{text:'What are my margin assumptions?'}});assert.equal(reply.status,200);assert.equal(reply.body.state.messages.length,2);
  assert.equal(database.prepare('SELECT count(*) AS n FROM model_cache WHERE business_id=?').get(initial.id).n,700);
  assert.equal(database.prepare('SELECT count(*) AS n FROM model_cache WHERE business_id=? AND cache_key=?').get(other.id,'keep-other-owner').n,1);
});
test('main manually entered receipt is honest, stable and cannot be confirmed twice',async()=>{
  const {env}=harness();await call(env);
  const entered={...receipt(),id:'receipt_owner_entered',source:{mode:'manual',engine:'Owner-entered receipt fields'}};
  const saved=await call(env,{action:'receipt',payload:{receipt:entered,reviewed:true}});assert.equal(saved.status,200);assert.equal(saved.body.state.receipts[0].id,entered.id);
  assert.equal(saved.body.state.receipts[0].source.mode,'manual');assert.match(saved.body.state.receipts[0].reviewNote,/no OCR extraction occurred/);
  assert.equal((await call(env,{action:'receipt',revision:1,payload:{receipt:entered,reviewed:true}})).status,400);
  assert.equal((await call(env)).body.state.receipts.length,1);
});
