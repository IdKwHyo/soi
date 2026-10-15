import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {handleApi} from '../worker/backend.mjs';
import {createStorage,RevisionConflict,WorkspaceLimitError,MAX_WORKSPACE_BYTES} from '../worker/storage.mjs';
import {createWorkspace} from '../dist/data.mjs';
import {menuCsv,sampleMenus} from '../dist/core.mjs';

function harness(overrides={}) {
  const database=new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for(const name of ['0000_initial.sql','0001_advisor_records.sql'])database.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  const DB={
    prepare(sql){
      const stmt=database.prepare(sql);
      return {bind(...args){return {sql,args,first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:stmt.run(...args)})};}};
    },
    async batch(statements){
      database.exec('BEGIN');
      try {
        const values=statements.map(({sql,args})=>{const result=database.prepare(sql).run(...args);return {success:true,meta:{changes:result.changes}};});
        database.exec('COMMIT');return values;
      } catch(error){database.exec('ROLLBACK');throw error;}
    }
  };
  const files=new Map();
  const BUCKET={async put(key,bytes,metadata){files.set(key,{bytes:new Uint8Array(bytes),metadata});},async get(key){const value=files.get(key);return value?{body:new Blob([value.bytes]).stream()}:null;},async delete(key){files.delete(key);}};
  return {env:{DB,BUCKET,...overrides},database,files};
}
async function call(env,{user='owner-a',action,payload={},revision,path='/api/workspace',method=action?'POST':'GET',origin='https://example.test',headers={},body}={}) {
  const requestHeaders={...headers};
  if(user)requestHeaders['oai-authenticated-user-id']=user;
  if(method==='POST'){requestHeaders['Content-Type']=headers['Content-Type']||'application/json';if(origin)requestHeaders.Origin=origin;}
  const request=new Request(`https://example.test${path}`,{method,headers:requestHeaders,body:method==='POST'?(body??JSON.stringify({action,payload,expectedRevision:revision})):undefined});
  const response=await handleApi(request,env);
  return {status:response.status,body:response.headers.get('content-type')?.includes('json')?await response.json():new Uint8Array(await response.arrayBuffer()),response};
}

test('health is public, workspace requires Sites identity, and no-binding mode is explicit',async()=>{
  assert.equal((await call({}, {user:null,path:'/api/health'})).status,200);
  const denied=await call({}, {user:null});assert.equal(denied.status,401);assert.ok(denied.body.signinPath.startsWith('/signin-with-chatgpt'));
  const local=await call({});assert.equal(local.body.state,null);assert.equal(local.body.capabilities.storage,'local');
});
test('ownership comes from membership, never client businessId',async()=>{
  const {env}=harness();const a=await call(env),b=await call(env,{user:'owner-b'});
  assert.notEqual(a.body.state.id,b.body.state.id);
  const changed=await call(env,{action:'business',revision:0,payload:{businessId:b.body.state.id,name:'Alpha'}});
  assert.equal(changed.status,200);assert.equal((await call(env,{user:'owner-b'})).body.state.business.name,'Soi Kitchen');
});
test('invalid inputs, cross-origin writes, and unsupported content types leave state unchanged',async()=>{
  const {env,database}=harness();await call(env);
  assert.equal((await call(env,{action:'business',revision:0,payload:{budget:-1}})).status,400);
  assert.equal((await call(env,{action:'memory',revision:0,payload:{key:'x',value:'y',source:'z'},origin:'https://attacker.test'})).status,403);
  assert.equal((await call(env,{action:'memory',revision:0,headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await call(env)).body.state.revision,0);assert.equal(database.prepare('SELECT count(*) AS n FROM mutation_audit').get().n,0);
});
test('streamed size cap rejects a body without trusting Content-Length',async()=>{
  const {env}=harness();await call(env);
  const oversized=await call(env,{action:'memory',revision:0,body:' '.repeat(1_200_001),headers:{'Content-Length':'1'}});
  assert.equal(oversized.status,413);assert.equal((await call(env)).body.state.revision,0);
});
test('two concurrent writes produce one revision and no stale child records',async()=>{
  const {env,database}=harness();await call(env);
  const results=await Promise.all(['a','b'].map(value=>call(env,{action:'memory',revision:0,payload:{key:'new fact',value,source:'Owner'}})));
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  assert.equal((await call(env)).body.state.revision,1);
  assert.equal(database.prepare('SELECT count(*) AS n FROM mutation_audit').get().n,1);
  assert.equal(database.prepare("SELECT count(*) AS n FROM records WHERE kind='memory'").get().n,4);
});
test('storage CAS also blocks an attempt to write another owner business directly',async()=>{
  const {env,database}=harness(),storage=createStorage(env);
  const a=await storage.load('a',createWorkspace),b=await storage.load('b',createWorkspace);
  await assert.rejects(storage.save('a',b.businessId,a.state,0,'memory'),RevisionConflict);
  assert.equal(database.prepare('SELECT count(*) AS n FROM mutation_audit').get().n,0);
  assert.equal((await storage.load('b',createWorkspace)).state.revision,0);
});
test('CSV original is losslessly archived in private R2, duplicate retry does not add records',async()=>{
  const {env,files,database}=harness();await call(env);
  const text=menuCsv(sampleMenus);
  const first=await call(env,{action:'import',revision:0,payload:{text,name:'Sales report'}});
  assert.equal(first.status,200);assert.equal(files.size,1);
  const imported=first.body.state.imports[0];assert.equal(imported.rawGzip,undefined);
  const archived=files.get(imported.rawArchive.key);assert.equal(gunzipSync(archived.bytes).toString('utf8'),text);
  assert.equal((await call(env,{path:`/api/archive/${imported.id}`})).status,200);
  assert.equal((await call(env,{user:'owner-b',path:`/api/archive/${imported.id}`})).status,404);
  const repeat=await call(env,{action:'import',revision:1,payload:{text,name:'Same report'}});
  assert.equal(repeat.body.operation.status,'duplicate');assert.equal(repeat.body.state.revision,1);
  assert.equal(database.prepare("SELECT count(*) AS n FROM records WHERE kind='import'").get().n,1);
});
test('R2 failure aborts SQL import commit and conceals internal errors',async()=>{
  const {env}=harness();await call(env);env.BUCKET.put=async()=>{throw Error('internal secret EXAMPLE_KEY');};
  const result=await call(env,{action:'import',revision:0,payload:{text:menuCsv(sampleMenus)}});
  assert.equal(result.status,503);assert.ok(!JSON.stringify(result.body).includes('EXAMPLE_KEY'));
  const state=(await call(env)).body.state;assert.equal(state.revision,0);assert.equal(state.imports.length,0);
});
test('cloud payload and retained-history caps are actionable and survive reset',async()=>{
  const {env,database}=harness(),storage=createStorage(env),loaded=await storage.load('a',createWorkspace);
  const oversized=structuredClone(loaded.state);oversized.note='x'.repeat(MAX_WORKSPACE_BYTES);
  await assert.rejects(storage.save('a',loaded.businessId,oversized,0,'memory',{previousState:loaded.state}),WorkspaceLimitError);
  assert.equal((await storage.load('a',createWorkspace)).state.revision,0);
  database.prepare('INSERT INTO records(business_id,kind,record_id,revision,payload,created_at) VALUES(?,?,?,?,?,?)').run(loaded.businessId,'memory','large-history',0,JSON.stringify({value:'x'.repeat(8_000_000)}),'now');
  const capped=await call(env,{user:'a',action:'reset',revision:0});assert.equal(capped.status,422);assert.ok(capped.body.error.includes('capacity'));
});
test('lost import CAS releases only its own unreferenced private original',async()=>{
  const {env,files}=harness();await call(env);
  const reports=await Promise.all(['a','b'].map(name=>call(env,{action:'import',revision:0,payload:{text:menuCsv(sampleMenus),name}})));
  assert.deepEqual(reports.map(item=>item.status).sort(),[200,409]);assert.equal(files.size,1);
  const state=(await call(env)).body.state;assert.ok(files.has(state.imports[0].rawArchive.key));
});
test('approval requires owner review and current dataset and business facts',async()=>{
  const {env}=harness();await call(env);
  const generated=await call(env,{action:'candidates',revision:0,payload:{mode:'rules'}});const candidate=generated.body.state.runs[0].candidates[1];
  assert.equal((await call(env,{action:'approve',revision:1,payload:{candidateId:candidate.id}})).status,400);
  await call(env,{action:'business',revision:1,payload:{audience:'Students'}});
  assert.equal((await call(env,{action:'approve',revision:2,payload:{candidateId:candidate.id,reviewedCapacity:true,reviewedContent:true}})).status,400);
  assert.equal((await call(env)).body.state.campaigns.length,0);
});
test('results require approval and use the original campaign cost snapshot after data changes',async()=>{
  const {env}=harness();await call(env);
  const generated=await call(env,{action:'candidates',revision:0,payload:{mode:'rules'}}),candidate=generated.body.state.runs[0].candidates[1];
  const actual={candidateId:candidate.id,totalOrders:50,baselineOrders:20,spend:600};
  assert.equal((await call(env,{action:'results',revision:1,payload:actual})).status,400);
  assert.equal((await call(env,{action:'approve',revision:1,payload:{candidateId:candidate.id,reviewedCapacity:true,reviewedContent:true}})).status,200);
  const menus=sampleMenus.map(menu=>({...menu,ingredients:menu.ingredients+50}));
  assert.equal((await call(env,{action:'manual',revision:2,payload:{menus}})).status,200);
  const recorded=await call(env,{action:'results',revision:3,payload:actual});assert.equal(recorded.status,200);
  assert.equal(recorded.body.state.results[0].netCents,51600);assert.equal(recorded.body.state.results[0].menu.ingredients,29);
});
test('Gemini uses server-only credentials, deterministic financial gates, and cached scoped refinement',async()=>{
  let calls=0;
  const MODEL_FETCH=async(url,options)=>{
    calls++;assert.ok(url.includes('/gemini-test:generateContent'));assert.equal(options.headers['x-goog-api-key'],'server-secret');
    const output=['discount','value'].map((kind,index)=>({kind,title:`Test ${kind}`,summary:'Owner-reviewed test assumptions',discount:index?0:10,extraOrders:index?30:40,existingOrders:20,budget:600,drafts:{social:'Test social',message:'Test message',announcement:'Test announcement'},netCents:999999999}));
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(output)}]}}]});
  };
  const {env}=harness({GEMINI_API_KEY:'server-secret',GEMINI_MODEL:'gemini-test',MODEL_FETCH,ALLOW_MERCHANT_AI:'true'});await call(env);
  const result=await call(env,{action:'candidates',revision:0,payload:{mode:'gemini'}});assert.equal(result.status,200);
  const candidate=result.body.state.runs[0].candidates[0];assert.equal(candidate.projection.netCents,46080);
  assert.ok(!JSON.stringify(result.body).includes('server-secret'));
  const cached=await call(env,{action:'candidates',revision:1,payload:{mode:'gemini'}});assert.equal(cached.body.operation.cacheHit,true);assert.equal(calls,1);
  await call(env,{action:'memory',revision:2,payload:{key:'voice',value:'Direct wording',source:'Owner'}});
  await call(env,{action:'candidates',revision:3,payload:{mode:'gemini'}});assert.equal(calls,2);
  await call(env,{user:'owner-b'});await call(env,{user:'owner-b',action:'candidates',revision:0,payload:{mode:'gemini'}});assert.equal(calls,3);
});
test('Gemini dispatch blocks merchant data by default and failures never masquerade as AI output',async()=>{
  let calls=0;
  const {env}=harness({GEMINI_API_KEY:'secret',GEMINI_MODEL:'gemini-test',MODEL_FETCH:async()=>{calls++;return new Response('secret echoed',{status:503});}});await call(env);
  const failure=await call(env,{action:'candidates',revision:0,payload:{mode:'gemini'}});assert.equal(failure.status,400);assert.ok(!JSON.stringify(failure.body).includes('secret'));
  assert.equal((await call(env)).body.state.revision,0);
  const fallback=await call(env,{action:'candidates',revision:0,payload:{mode:'gemini',allowFallback:true}});assert.equal(fallback.status,200);assert.equal(fallback.body.operation.source,'local-rule-demo');assert.ok(fallback.body.operation.notice);
  await call(env,{action:'manual',revision:1,payload:{menus:sampleMenus}});
  assert.equal((await call(env,{action:'candidates',revision:2,payload:{mode:'gemini'}})).status,400);assert.equal(calls,2);
});
test('sample dataset does not permit owner-entered confidential business facts to reach free Gemini',async()=>{
  let calls=0;
  const {env}=harness({GEMINI_API_KEY:'secret',GEMINI_MODEL:'gemini-test',MODEL_FETCH:async()=>{calls++;throw Error('should not dispatch');}});await call(env);
  await call(env,{action:'memory',revision:0,payload:{key:'supplier deal',value:'Confidential pricing agreement',source:'Owner'}});
  assert.equal((await call(env,{action:'candidates',revision:1,payload:{mode:'gemini'}})).status,400);assert.equal(calls,0);
  await call(env,{action:'reset',revision:1});await call(env,{action:'business',revision:2,payload:{name:'Confidential shop'}});
  assert.equal((await call(env,{action:'candidates',revision:3,payload:{mode:'gemini'}})).status,400);assert.equal(calls,0);
});
test('reset affects only the signed-in owner current workspace',async()=>{
  const {env}=harness();await call(env);await call(env,{user:'owner-b'});
  await call(env,{user:'owner-b',action:'business',revision:0,payload:{name:'Other shop'}});
  await call(env,{action:'business',revision:0,payload:{name:'Changed'}});
  assert.equal((await call(env,{action:'reset',revision:1})).body.state.business.name,'Soi Kitchen');
  assert.equal((await call(env,{user:'owner-b'})).body.state.business.name,'Other shop');
});
