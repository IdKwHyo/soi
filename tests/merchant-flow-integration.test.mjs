import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorkspace,validateWorkspace,commitManualDataset} from '../dist/data.mjs';
import {merchantReport,priceComparison,simulateMerchantPlan,updateMerchantFlow} from '../dist/merchant-flow.mjs';
import {buildEvidence,simulateReply} from '../dist/advisor.mjs';
import {handleApi} from '../worker/backend.mjs';
import {contextFingerprint,syntheticDemoOnly} from '../worker/model.mjs';

function harness(overrides={}){
  const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');
  for(const name of ['0000_initial.sql','0001_advisor_records.sql'])database.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  const DB={prepare(sql){const stmt=database.prepare(sql);return {bind(...args){return {sql,args,first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)})};}};},async batch(statements){database.exec('BEGIN');try{const result=statements.map(({sql,args})=>({meta:{changes:database.prepare(sql).run(...args).changes}}));database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}}};
  const BUCKET={async put(){},async get(){return null;},async delete(){}};
  return {env:{DB,BUCKET,...overrides},database};
}
async function call(env,{user='owner',action,payload={},revision=0}={}){
  const headers={};if(user)headers['oai-authenticated-user-id']=user;
  if(action){headers['Content-Type']='application/json';headers.Origin='https://example.test';}
  const response=await handleApi(new Request('https://example.test/api/workspace',{method:action?'POST':'GET',headers,body:action?JSON.stringify({action,payload,expectedRevision:revision}):undefined}),env);
  return {status:response.status,body:await response.json()};
}
function settings(state){
  const dataset=state.datasets.find(item=>item.id===state.activeDatasetId);
  return {setup:{goal:'growth',feePercent:32.1},scope:'grab',sources:{grab:dataset.id},scenario:{menuName:dataset.menus[0].name,channel:'grab',price:dataset.menus[0].price,discount:0,extraOrders:10,existingOrders:0,budget:50,newCustomers:2}};
}
function outcome(state){return {snapshot:simulateMerchantPlan(state).snapshot,totalOrders:10,baselineOrders:0,spend:50,newCustomers:2,returningCustomers:null,repeatCustomers:null};}

test('legacy workspaces acquire empty workflow settings without assigning channel sales',async()=>{
  const state=createWorkspace(),datasets=JSON.stringify(state.datasets);delete state.merchantFlow;
  validateWorkspace(state);assert.deepEqual(state.merchantFlow.sources,{grab:null,storefront:null});
  assert.equal(JSON.stringify(state.datasets),datasets);assert.equal(state.revision,0);
  const {env,database}=harness();const initial=await call(env);
  database.prepare("UPDATE workspaces SET payload=json_remove(payload,'$.merchantFlow') WHERE business_id=?").run(initial.body.state.id);
  const loaded=await call(env);assert.equal(loaded.status,200);assert.deepEqual(loaded.body.state.merchantFlow.sources,{grab:null,storefront:null});
  assert.equal(loaded.body.state.revision,0);
});

test('workflow settings use owner membership and CAS while source datasets stay unchanged',async()=>{
  const {env,database}=harness();const initial=(await call(env)).body.state;
  assert.equal((await call(env,{user:null,action:'merchant-flow',payload:settings(initial)})).status,401);
  const saved=await call(env,{action:'merchant-flow',payload:settings(initial)});assert.equal(saved.status,200);
  assert.equal(saved.body.state.revision,1);assert.equal(saved.body.state.merchantFlow.setup.feePercent,32.1);
  assert.deepEqual(saved.body.state.datasets,initial.datasets);
  assert.equal((await call(env,{action:'merchant-flow',payload:{setup:{goal:'profit'}}})).status,409);
  const other=(await call(env,{user:'another-owner'})).body.state;
  assert.equal((await call(env,{action:'merchant-flow',revision:1,payload:{sources:{storefront:other.activeDatasetId}}})).status,400);
  assert.equal(database.prepare("SELECT count(*) AS n FROM mutation_audit WHERE action='merchant-flow'").get().n,1);
  assert.equal((await call(env,{user:'another-owner'})).body.state.merchantFlow.setup.goal,'balanced');
});

test('a shared report cannot be counted twice as Grab and storefront sales',async()=>{
  const {env}=harness();const initial=(await call(env)).body.state;
  const duplicate=await call(env,{action:'merchant-flow',payload:{sources:{grab:initial.activeDatasetId,storefront:initial.activeDatasetId}}});
  assert.equal(duplicate.status,400);assert.equal((await call(env)).body.state.revision,0);
  const invalid=await call(env,{action:'merchant-flow',payload:{setup:{feePercent:100}}});assert.equal(invalid.status,400);
});

test('cloud price parity and outcome math are recalculated from owned channel sources',async()=>{
  const {env}=harness();const initial=(await call(env)).body.state;
  const manual=await call(env,{action:'manual',payload:{menus:initial.datasets[0].menus,period:initial.datasets[0].period}});assert.equal(manual.status,200);
  const selected=settings(manual.body.state);selected.sources.storefront=initial.activeDatasetId;selected.scope='combined';
  const saved=await call(env,{action:'merchant-flow',revision:1,payload:selected});assert.equal(saved.status,200);
  const comparison=priceComparison(saved.body.state)[0];assert.equal(comparison.feePercent,32.1);
  assert.equal(comparison.netGrabPriceCents,6043);assert.equal(comparison.requiredGrabPriceCents,13107);
  const docs=buildEvidence(saved.body.state);const parity=docs.find(item=>item.id==='merchant-flow:price:0');
  assert.match(parity.text,/THB 131\.07/);assert.ok(parity.text.includes(initial.activeDatasetId));assert.ok(parity.text.includes(manual.body.state.activeDatasetId));
  const forged=outcome(saved.body.state);forged.snapshot.projection.netCents+=1;
  assert.equal((await call(env,{action:'flow-outcome',revision:2,payload:forged})).status,400);
  assert.equal((await call(env)).body.state.merchantFlow.outcomes.length,0);
  const accepted=await call(env,{action:'flow-outcome',revision:2,payload:outcome(saved.body.state)});assert.equal(accepted.status,200);
  assert.equal(accepted.body.state.merchantFlow.outcomes[0].evaluation.netCents,21430);
});

test('server outcomes pin calculated snapshots and unknown customer counts without demo spoofing',async()=>{
  const {env}=harness();const initial=(await call(env)).body.state;
  const setup=await call(env,{action:'merchant-flow',payload:settings(initial)});assert.equal(setup.status,200);
  const payload={...outcome(setup.body.state),newCustomers:null,paybackDays:12};
  assert.equal((await call(env,{action:'flow-outcome',revision:1,payload:{...payload,source:'demo'}})).status,400);
  const saved=await call(env,{action:'flow-outcome',revision:1,payload});assert.equal(saved.status,200);
  const record=saved.body.state.merchantFlow.outcomes[0];assert.equal(record.source,'owner');
  assert.equal(record.actual.newCustomers,null);assert.equal(record.actual.returningCustomers,null);assert.equal(record.actual.repeatCustomers,null);
  assert.equal(record.actual.paybackDays,12);
  const recordedEvidence=buildEvidence(saved.body.state).find(item=>item.id===`merchant-flow:outcome:${record.id}`);
  assert.match(recordedEvidence.text,/Owner-reported observed payback days 12/);
  const pinned=JSON.stringify(record);
  const changed=await call(env,{action:'merchant-flow',revision:2,payload:{setup:{feePercent:25,goal:'profit'}}});assert.equal(changed.status,200);
  assert.equal(JSON.stringify(changed.body.state.merchantFlow.outcomes[0]),pinned);
  assert.equal((await call(env,{user:'other'})).body.state.merchantFlow.outcomes.length,0);
});

test('retrying one outcome ID returns the original owner record without another revision or audit row',async()=>{
  const {env,database}=harness();const initial=(await call(env)).body.state;
  const setup=await call(env,{action:'merchant-flow',payload:settings(initial)});
  const payload={...outcome(setup.body.state),id:'flow_result_'+crypto.randomUUID()};
  const first=await call(env,{action:'flow-outcome',revision:1,payload});assert.equal(first.status,200);
  assert.equal(first.body.operation.alreadyRecorded,false);assert.equal(first.body.state.revision,2);
  const retry=await call(env,{action:'flow-outcome',revision:2,payload});assert.equal(retry.status,200);
  assert.equal(retry.body.operation.alreadyRecorded,true);assert.equal(retry.body.state.revision,2);
  assert.equal(retry.body.state.merchantFlow.outcomes.length,1);
  assert.deepEqual(retry.body.operation.outcome,first.body.operation.outcome);
  assert.equal(database.prepare("SELECT count(*) AS n FROM mutation_audit WHERE action='flow-outcome'").get().n,1);
  assert.equal((await call(env,{action:'flow-outcome',revision:2,payload:{...payload,spend:51}})).status,400);
  assert.equal((await call(env,{user:'other',action:'flow-outcome',payload})).status,400);
  assert.equal((await call(env)).body.state.revision,2);
});

test('a lost committed outcome response refreshes cloud state and reuses the same confirmation ID',async()=>{
  const previous={fetch:globalThis.fetch,storage:globalThis.localStorage,location:Object.getOwnPropertyDescriptor(globalThis,'location')};
  const {env,database}=harness();const initial=(await call(env)).body.state;
  await call(env,{action:'merchant-flow',payload:settings(initial)});const captured=[];let loseResponse=true;
  globalThis.localStorage={getItem:()=>null,setItem:()=>{throw Error('Cloud outcomes must not fall back to local storage');}};
  Object.defineProperty(globalThis,'location',{value:{pathname:'/versionb'},writable:true,configurable:true});
  globalThis.fetch=async(path,options)=>{
    const body=options.body?JSON.parse(options.body):null;if(body?.action==='flow-outcome')captured.push(body);
    const headers=new Headers(options.headers);headers.set('oai-authenticated-user-id','owner');
    const result=await handleApi(new Request('https://example.test'+path,{...options,headers}),env);
    if(body?.action==='flow-outcome'&&loseResponse){loseResponse=false;throw new TypeError('Response connection lost after commit');}
    return result;
  };
  try{
    const client=await import('../dist/client.mjs?lost-flow-outcome-response');const loaded=await client.loadWorkspace();
    const pending=outcome(loaded.state);
    await assert.rejects(client.commit('flow-outcome',pending),/connection lost/);
    const retried=await client.commit('flow-outcome',pending);
    assert.equal(captured.length,2);assert.equal(captured[0].payload.id,captured[1].payload.id);
    assert.deepEqual(captured.map(item=>item.expectedRevision),[1,2]);
    assert.equal(retried.state.merchantFlow.outcomes.length,1);assert.equal(retried.state.revision,2);
    assert.equal(retried.operation.alreadyRecorded,true);
    assert.equal(database.prepare("SELECT count(*) AS n FROM mutation_audit WHERE action='flow-outcome'").get().n,1);
  }finally{
    globalThis.fetch=previous.fetch;globalThis.localStorage=previous.storage;
    if(previous.location)Object.defineProperty(globalThis,'location',previous.location);else delete globalThis.location;
  }
});

test('workflow context invalidates previous campaign approval and merchant-provider eligibility',async()=>{
  const {env}=harness();const initial=(await call(env)).body.state;
  assert.equal(syntheticDemoOnly(initial),true);const before=await contextFingerprint(initial);
  const compared=await call(env,{action:'candidates',payload:{mode:'rules'}});assert.equal(compared.status,200);
  const candidate=compared.body.state.runs[0].candidates.find(item=>item.approvable);assert.ok(candidate);
  const changed=await call(env,{action:'merchant-flow',revision:1,payload:{setup:{goal:'growth'}}});assert.equal(changed.status,200);
  assert.notEqual(await contextFingerprint(changed.body.state),before);assert.equal(syntheticDemoOnly(changed.body.state),false);
  assert.equal((await call(env,{action:'approve',revision:2,payload:{candidateId:candidate.id,reviewedCapacity:true,reviewedContent:true}})).status,400);
  let calls=0;env.GEMINI_API_KEY='test-key';env.MODEL_FETCH=async()=>{calls++;throw Error('Merchant details must not dispatch');};
  assert.equal((await call(env,{action:'candidates',revision:2,payload:{mode:'gemini',allowFallback:false}})).status,400);assert.equal(calls,0);
});

test('nested demo editions save and reload the new workflow with zero backend requests',async()=>{
  const previous={fetch:globalThis.fetch,storage:globalThis.localStorage,location:Object.getOwnPropertyDescriptor(globalThis,'location')};
  const values=new Map();let requests=0;
  globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};
  globalThis.fetch=async()=>{requests++;throw Error('Backend unavailable');};
  try{
    Object.defineProperty(globalThis,'location',{value:{pathname:'/versiona/demo'},writable:true,configurable:true});
    const a=await import('../dist/client.mjs?merchant-a-demo');let result=await a.loadWorkspace();
    result=await a.commit('merchant-flow',settings(result.state));
    const pending=outcome(result.state);
    result=await a.commit('flow-outcome',pending);assert.equal(result.state.merchantFlow.outcomes[0].source,'demo');
    const revision=result.state.revision;result=await a.commit('flow-outcome',pending);
    assert.equal(result.state.revision,revision);assert.equal(result.state.merchantFlow.outcomes.length,1);assert.equal(result.operation.alreadyRecorded,true);
    const original=JSON.stringify(result.state.merchantFlow.outcomes[0]);
    globalThis.location.pathname='/versionb/demo';const b=await import('../dist/client.mjs?merchant-b-demo');result=await b.loadWorkspace();
    assert.equal(JSON.stringify(result.state.merchantFlow.outcomes[0]),original);assert.equal(result.capabilities.demo,true);
    result=await b.commit('candidates',{mode:'rules'});const candidate=result.state.runs.at(-1).candidates.find(item=>item.approvable);
    await b.commit('merchant-flow',{scope:'combined'});
    await assert.rejects(b.commit('approve',{candidateId:candidate.id,reviewedCapacity:true,reviewedContent:true}),/Business facts changed/);
    assert.equal(requests,0);assert.equal(values.has('soi-studio-v2-local'),false);
  }finally{
    globalThis.fetch=previous.fetch;globalThis.localStorage=previous.storage;
    if(previous.location)Object.defineProperty(globalThis,'location',previous.location);else delete globalThis.location;
  }
});

test('one-click channel examples stay in the local demo and the main app rejects the action',async()=>{
  const previous={fetch:globalThis.fetch,storage:globalThis.localStorage,location:Object.getOwnPropertyDescriptor(globalThis,'location')};
  const values=new Map(),mainSample=JSON.stringify(createWorkspace());values.set('soi-studio-v2-local',mainSample);let requests=0;
  globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};
  globalThis.fetch=async()=>{requests++;throw Error('Backend unavailable');};
  try{
    Object.defineProperty(globalThis,'location',{value:{pathname:'/versionb/demo'},writable:true,configurable:true});
    const demo=await import('../dist/client.mjs?merchant-channel-examples');await demo.loadWorkspace();
    let result=await demo.commit('merchant-flow-sample');
    assert.ok(result.state.merchantFlow.sources.grab);assert.ok(result.state.merchantFlow.sources.storefront);
    assert.notEqual(result.state.merchantFlow.sources.grab,result.state.merchantFlow.sources.storefront);
    assert.equal(merchantReport(result.state).complete,true);assert.equal(requests,0);
    const count=result.state.datasets.length;result=await demo.commit('merchant-flow-sample');assert.equal(result.state.datasets.length,count);
    assert.equal(values.get('soi-studio-v2-local'),mainSample);
    globalThis.location.pathname='/versiona';const main=await import('../dist/client.mjs?merchant-examples-main-guard');
    await assert.rejects(main.commit('merchant-flow-sample'),/belong in \/demo/);assert.equal(requests,0);
    assert.equal(values.get('soi-studio-v2-local'),mainSample);
    const {env}=harness();assert.equal((await call(env,{action:'merchant-flow-sample'})).status,400);
  }finally{
    globalThis.fetch=previous.fetch;globalThis.localStorage=previous.storage;
    if(previous.location)Object.defineProperty(globalThis,'location',previous.location);else delete globalThis.location;
  }
});

test('workflow calculations become bounded cited evidence and simulated chat keeps unknowns visible',()=>{
  const state=createWorkspace();updateMerchantFlow(state,settings(state));
  const documents=buildEvidence(state).filter(item=>item.id.startsWith('merchant-flow:'));
  assert.ok(documents.length);assert.ok(documents.every(item=>item.text.length<=12000));
  assert.ok(documents.some(item=>item.text.includes('32.1')));
  const reply=simulateReply(state,{text:'Show my Grab price normalization, CAC and cash flow',language:'en'});
  assert.match(reply.answer,/Simulated/);assert.ok(reply.sources.some(item=>item.id.startsWith('merchant-flow:')));
  assert.match(reply.answer,/unknown|not supplied|not available|unavailable/i);
  assert.equal(reply.retrieval.mode,'simulated');assert.ok(merchantReport(state));assert.ok(priceComparison(state));
});

test('generic demo profit analysis uses selected storefront scope rather than the active legacy dataset',()=>{
  const state=createWorkspace(),storefrontId=state.activeDatasetId;
  const menus=state.datasets[0].menus.map(menu=>({...menu,price:10,ingredients:30,fee:32.1}));
  commitManualDataset(state,menus,state.datasets[0].period);
  assert.notEqual(state.activeDatasetId,storefrontId);
  updateMerchantFlow(state,{scope:'storefront',sources:{storefront:storefrontId}});
  const reply=simulateReply(state,{text:'What is my profit margin?',language:'en'});
  assert.match(reply.answer,/selected calculation scope storefront/);
  assert.match(reply.answer,/contribution THB\s*24,132\.00/);
  assert.ok(reply.sources.some(item=>item.id==='merchant-flow:report'));
  assert.doesNotMatch(reply.answer,/highest contribution per sold item/);
});
