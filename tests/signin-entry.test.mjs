import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createPortalArrival} from '../dist/signin/arrival.mjs';

const guard=await readFile(new URL('../dist/signin/entry-guard.js',import.meta.url),'utf8');
function guardAt({path='/demo',stamp=9900,now=10000,reduced=false,forced=false,blocked=false}={}){
  const dataset={},removed=[];
  runInNewContext(guard,{document:{documentElement:{dataset}},location:{pathname:path},Date:{now:()=>now},
    sessionStorage:{getItem(){if(blocked)throw Error('Unavailable');return stamp;},removeItem:key=>removed.push(key)},
    matchMedia:query=>({matches:query.includes('forced-colors')?forced:reduced})});
  return{dataset,removed};
}
test('fresh preview entry is one-use decoration confined to demo routes',()=>{
  for(const path of ['/demo','/demo/','/versionc/demo']){
    const result=guardAt({path});assert.equal(result.dataset.portalArrival,'waiting');assert.deepEqual(result.removed,['soi-demo-entry']);
  }
  for(const options of [{path:'/'},{path:'/copilot'},{path:'/signin'},{stamp:null},{stamp:'invalid'},{stamp:20000},{stamp:1,now:30000},{reduced:true},{forced:true},{blocked:true}])assert.deepEqual(guardAt(options).dataset,{});
});
function arrivalFixture(){
  const doc=new EventTarget(),win=new EventTarget(),timers=new Map();let next=0;
  const root={dataset:{portalArrival:'waiting'},hasAttribute:key=>key==='data-portal-arrival'&&!!root.dataset.portalArrival,removeAttribute:()=>delete root.dataset.portalArrival};
  win.setTimeout=callback=>{timers.set(++next,callback);return next;};win.clearTimeout=id=>timers.delete(id);
  doc.documentElement=root;doc.defaultView=win;
  return{doc,win,root,timers};
}
test('workspace readiness, input and timeout can never leave an entry overlay active',()=>{
  for(const action of ['ready','keydown','pointerdown','pagehide','timeout']){
    const f=arrivalFixture(),arrival=createPortalArrival(f.doc);
    if(action==='ready'){arrival.ready();assert.equal(f.root.dataset.portalArrival,'ready');for(const callback of [...f.timers.values()])callback();}
    else if(action==='timeout')for(const callback of [...f.timers.values()])callback();
    else (action==='pagehide'?f.win:f.doc).dispatchEvent(new Event(action));
    assert.equal(f.root.dataset.portalArrival,undefined);assert.equal(f.timers.size,0);
    arrival.ready();assert.equal(f.root.dataset.portalArrival,undefined);
  }
});
