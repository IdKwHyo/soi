import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {routeContext,editionPath,renderEditionSwitcher} from '../dist/routes.mjs';
import {createWorkspace} from '../dist/data.mjs';

test('retained edition links resolve to the canonical full app or simulated demo',()=>{
  for(const version of ['a','b','c'])for(const demo of [false,true]){
    const path=editionPath(version,demo,'advisor');
    assert.equal(path,(demo?'/demo':'/')+'#advisor');
    assert.deepEqual(routeContext(path.split('#')[0]),{version:'c',demo});
    assert.deepEqual(routeContext('/version'+version+(demo?'/demo/':'/')),{version:'c',demo});
  }
  assert.equal(editionPath(),'/#overview');
  assert.deepEqual(routeContext('/'),{version:'c',demo:false});
  assert.deepEqual(routeContext('/demo'),{version:'c',demo:true});
  assert.equal(routeContext('/versionb/demo/not-real').demo,false);
  assert.throws(()=>editionPath('d'),/Unknown/);
});

test('direct mode and merchant shortcuts replace the edition comparison menu',()=>{
  for(const language of ['en','th'])for(const demo of [false,true]){
    const html=renderEditionSwitcher(language,'advisor',demo);
    assert.match(html,/<nav class="studio-shortcuts"/);
    assert.ok(html.includes(`data-edition-link href="/copilot${demo?'/demo':''}#order"`));
    assert.ok(html.includes('data-edition-link href="/copilot/demo#ai"'));
    assert.ok(html.includes(language==='th'?'เมนูออเดอร์':'Order menu'));
    assert.ok(html.includes(language==='th'?'เดโม AI':'AI demo'));
    assert.ok(html.includes(language==='th'?'แอปเต็ม':'Full app'));
    assert.ok(html.includes(language==='th'?'เดโมจำลอง':'Simulated demo'));
    assert.equal((html.match(/data-edition-link/g)||[]).length,4);
    for(const isDemo of [false,true])assert.ok(html.includes(`href="${editionPath('c',isDemo,'advisor')}"`));
    assert.doesNotMatch(html,/<details|Compare experiences|Version [ABC]|เวอร์ชัน|\/version[ab]/);
  }
});

test('the retained presentation keeps its delegated unsaved-work guard for mode shortcuts',async()=>{
  for(const path of ['dist/versionc/app.mjs']){
    const source=await readFile(path,'utf8');
    const handler=source.match(/\$\('edition-control'\)\.addEventListener\('click',[^\n]+/)?.[0];
    assert.ok(handler,path);
    assert.ok(handler.includes("closest('[data-edition-link]')"),path);
    assert.ok(handler.includes('dirty||chatDraft.trim()'),path);
    assert.ok(handler.includes("confirmDialog('discardChanges'"),path);
    assert.ok(handler.includes('location.assign(link.href)'),path);
  }
});

test('canonical demo and compatibility routes share completed work without live providers',async()=>{
  const original={fetch:globalThis.fetch,storage:globalThis.localStorage,location:Object.getOwnPropertyDescriptor(globalThis,'location')};
  const values=new Map();let requests=0;
  globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};
  globalThis.fetch=async()=>{requests++;throw Error('Live backend unavailable');};
  try{
    Object.defineProperty(globalThis,'location',{value:{pathname:'/demo'},writable:true,configurable:true});
    const a=await import('../dist/client.mjs?edition-a-demo');
    await a.loadWorkspace();
    await a.commit('business',{business:{audience:'Neighborhood lunch customers'}});
    await a.commit('memory',{key:'Lunch capacity',value:'Owner confirms twelve extra meals',source:'Owner'});
    const draft=await a.readReceipt(new File([Uint8Array.of(137,80,78,71,13,10,26,10)],'receipt.png',{type:'image/png'}));
    await a.saveReceipt(draft);
    globalThis.location.pathname='/versionc/demo';
    const b=await import('../dist/client.mjs?edition-b-demo');
    let result=await b.loadWorkspace();
    assert.equal(result.state.business.audience,'Neighborhood lunch customers');
    assert.equal(result.state.receipts.length,1);assert.equal(result.capabilities.demo,true);
    result=await b.askAdvisor({text:'Read my receipt',language:'en'});
    assert.match(result.operation.response.answer,/223/);
    assert.equal(result.operation.response.retrieval.mode,'simulated');
    result=await b.commit('candidates',{language:'en',mode:'rules'});
    const candidate=result.state.runs.at(-1).candidates.find(item=>item.approvable);
    assert.ok(candidate,'Sample has an approvable candidate');
    result=await b.commit('approve',{candidateId:candidate.id,drafts:candidate.drafts,plan:candidate,reviewedCapacity:true,reviewedContent:true});
    assert.equal(result.state.campaigns.length,1);
    result=await b.commit('results',{candidateId:candidate.id,totalOrders:30,baselineOrders:20,spend:100});
    assert.equal(result.state.results.length,1);
    globalThis.location.pathname='/versionb/demo';
    const c=await import('../dist/client.mjs?edition-c-demo');
    result=await c.loadWorkspace();
    assert.equal(result.state.results.length,1);assert.equal(result.state.receipts.length,1);
    assert.equal(result.state.business.audience,'Neighborhood lunch customers');
    assert.equal(result.capabilities.demo,true);
    result=await c.askAdvisor({text:'What do my receipts say?',language:'en'});
    assert.equal(result.operation.response.retrieval.mode,'simulated');
    globalThis.location.pathname='/versiona/demo';
    const aReload=await import('../dist/client.mjs?edition-a-demo-reload');
    result=await aReload.loadWorkspace();
    assert.equal(result.state.results.length,1);assert.equal(result.state.messages.length,4);
    assert.equal(requests,0);assert.equal(values.has('soi-studio-v2-local'),false);
  }finally{
    globalThis.fetch=original.fetch;globalThis.localStorage=original.storage;
    if(original.location)Object.defineProperty(globalThis,'location',original.location);else delete globalThis.location;
  }
});

test('canonical full app and compatibility paths use the live service without simulated replies',async()=>{
  const original={fetch:globalThis.fetch,storage:globalThis.localStorage,location:Object.getOwnPropertyDescriptor(globalThis,'location')};let calls=0;
  globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
  globalThis.fetch=async()=>{calls++;return Response.json({state:createWorkspace(),capabilities:{storage:'cloud',advisor:'not-configured'}});};
  try{
    for(const [index,pathname] of ['/','/versionc','/versiona','/versionb'].entries()){
      Object.defineProperty(globalThis,'location',{value:{pathname},writable:true,configurable:true});
      const client=await import('../dist/client.mjs?edition-'+index+'-live');
      const result=await client.loadWorkspace();
      assert.equal(result.capabilities.demo,false);assert.equal(result.capabilities.storage,'cloud');
      assert.equal(result.capabilities.signinPath,'/signin-with-chatgpt?return_to='+encodeURIComponent('/'));
      await assert.rejects(client.askAdvisor({text:'Compare campaigns',language:'en'}),/not connected/);
    }
    assert.equal(calls,4);
  }finally{
    globalThis.fetch=original.fetch;globalThis.localStorage=original.storage;
    if(original.location)Object.defineProperty(globalThis,'location',original.location);else delete globalThis.location;
  }
});
