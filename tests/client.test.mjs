import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../dist/data.mjs';
import {menuCsv} from '../dist/core.mjs';

function browserStorage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
test('frontend demo completes the owner workflow with no workspace requests and isolated persistence',async()=>{
 const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage,originalLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 const storage=browserStorage(),connectedSample=JSON.stringify(createWorkspace());storage.setItem('soi-studio-v2-local',connectedSample);
 globalThis.localStorage=storage;Object.defineProperty(globalThis,'location',{configurable:true,writable:true,value:{pathname:'/demo'}});
 let requests=0;globalThis.fetch=async()=>{requests++;throw Error('Backend is unavailable');};
 try{
  const client=await import('../dist/client.mjs?forced-demo-flow');let result=await client.loadWorkspace();
  assert.equal(result.capabilities.demo,true);assert.equal(result.capabilities.storage,'local');assert.equal(result.capabilities.signinPath,null);
  result=await client.commit('business',{business:{name:'Demo restaurant'}});
  const source=result.state.datasets.find(d=>d.id===result.state.activeDatasetId);
  result=await client.commit('manual',{menus:structuredClone(source.menus),period:source.period});
  result=await client.commit('import',{name:'Demo sales.csv',text:menuCsv(source.menus),period:source.period});
  assert.equal(result.state.imports.length,1);
  result=await client.commit('memory',{key:'service',value:'Pickup only during lunch.',source:'Owner confirmation'});
  result=await client.commit('candidates',{language:'th'});const candidate=result.state.runs.at(-1).candidates[0];
  result=await client.commit('approve',{candidateId:candidate.id,reviewedCapacity:true,reviewedContent:true,drafts:candidate.drafts,plan:{discount:0}});
  result=await client.commit('results',{candidateId:candidate.id,totalOrders:60,baselineOrders:20,spend:600});
  assert.equal(result.state.results.length,1);assert.equal(result.state.business.name,'Demo restaurant');
  await assert.rejects(client.commit('candidates',{mode:'gemini'}),/configured server key/);
  const reloaded=await import('../dist/client.mjs?forced-demo-reload');const persisted=await reloaded.loadWorkspace();
  assert.equal(persisted.state.results[0].id,result.state.results[0].id);
  await reloaded.commit('reset');assert.equal(storage.getItem('soi-studio-v2-local'),connectedSample);
  assert.ok(storage.getItem('soi-studio-v2-demo'));assert.equal(requests,0);
 }finally{
  globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;
  if(originalLocation)Object.defineProperty(globalThis,'location',originalLocation);else delete globalThis.location;
 }
});
test('cloud client sends the server business contract and retains returned revision',async()=>{
 const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;globalThis.localStorage=browserStorage();
 const initial=createWorkspace();let captured;
 globalThis.fetch=async(url,options)=>{
  if(options.method==='GET')return Response.json({state:initial,capabilities:{storage:'cloud',model:'rules'}});
  captured=JSON.parse(options.body);const next=structuredClone(initial);next.business.name=captured.payload.name;next.revision=1;
  return Response.json({state:next,capabilities:{storage:'cloud'},operation:{status:'saved'}});
 };
 try{const client=await import('../dist/client.mjs?cloud-contract');await client.loadWorkspace();const result=await client.commit('business',{business:{name:'New restaurant'}});assert.equal(captured.payload.name,'New restaurant');assert.equal(captured.payload.business,undefined);assert.equal(captured.expectedRevision,0);assert.equal(result.state.revision,1);assert.equal(result.operation.status,'saved');}
 finally{globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});
test('local sample refuses stale fact approval and persists approved plan for results',async()=>{
 const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;globalThis.localStorage=browserStorage();globalThis.fetch=async()=>Response.json({error:'Sign in'}, {status:401});
 try{
  const client=await import('../dist/client.mjs?local-contract');let result=await client.loadWorkspace();assert.equal(result.capabilities.storage,'local');
  result=await client.commit('candidates',{language:'en'});let candidate=result.state.runs.at(-1).candidates[0];
  await client.commit('memory',{key:'service',value:'Pickup only during lunch.',source:'Owner confirmation'});
  await assert.rejects(client.commit('approve',{candidateId:candidate.id,reviewedCapacity:true,reviewedContent:true}),/Business facts changed/);
  result=await client.commit('candidates',{language:'en'});candidate=result.state.runs.at(-1).candidates[0];
  result=await client.commit('approve',{candidateId:candidate.id,reviewedCapacity:true,reviewedContent:true,drafts:candidate.drafts,plan:{discount:0}});
  assert.equal(result.state.campaigns[0].discount,0);
  await assert.rejects(client.commit('approve',{candidateId:candidate.id,reviewedCapacity:true,reviewedContent:true}),/already approved/);
  result=await client.commit('results',{candidateId:candidate.id,totalOrders:60,baselineOrders:20,spend:600});
  assert.equal(result.state.results[0].net,888);
  await assert.rejects(client.commit('candidates',{mode:'gemini'}),/configured server key/);
 }finally{globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});
test('cloud conflict does not downgrade into local writes',async()=>{
 const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;globalThis.localStorage=browserStorage();let writes=0;
 globalThis.fetch=async(url,options)=>options.method==='GET'?Response.json({state:createWorkspace(),capabilities:{storage:'cloud'}}):(writes++,Response.json({error:'Reload before changing this workspace.'},{status:409}));
 try{const client=await import('../dist/client.mjs?conflict-contract');await client.loadWorkspace();await assert.rejects(client.commit('memory',{key:'x',value:'y',source:'owner'}),{status:409});await assert.rejects(client.commit('reset',{}),{status:409});assert.equal(writes,2);assert.equal(globalThis.localStorage.getItem('soi-studio-v2-local'),null);}
 finally{globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});
