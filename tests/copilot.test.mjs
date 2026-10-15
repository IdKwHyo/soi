import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createCopilotState,applyCopilotAction,placePublicOrder,publicMenu,trackOrder,queueSummary,estimateOrders,costForMenu,calculatePlateCosts} from '../dist/copilot/domain.mjs';
import {handleCopilot} from '../worker/copilot.mjs';
import {createStorage} from '../worker/storage.mjs';
import {createWorkspace} from '../dist/data.mjs';
import {confirmReceipt} from '../dist/advisor.mjs';
const now='2026-10-14T12:00:00.000Z';
const seed=()=>createCopilotState({businessId:'business-test',now});
const submit=(requestId='request-0001',extras={})=>({requestId,channel:'offline',table:'4',items:[{id:'basil-chicken',quantity:2}],note:'',...extras});
const change=(state,action,payload,time=now)=>applyCopilotAction(state,{action,payload},time);
const open=state=>change(state,'settings',{accepting:true}).state;
const order=(state,requestId,extras={})=>change(state,'order',submit(requestId,extras));
function harness() {
  const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');
  for(const name of ['0000_initial.sql','0001_advisor_records.sql','0002_copilot.sql'])database.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  const DB={prepare(sql){const stmt=database.prepare(sql);return {bind(...args){return {sql,args,first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)})};}};},async batch(statements){database.exec('BEGIN');try{const result=statements.map(({sql,args})=>({meta:{changes:database.prepare(sql).run(...args).changes}}));database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}}};
  return {database,env:{DB,BUCKET:{}}};
}
async function call(env,{path='/api/copilot',user='owner',body,origin='https://example.test',method=body?'POST':'GET',type='application/json'}={}) {
  const headers={};if(user)headers['oai-authenticated-user-id']=user;if(body!==undefined){headers['content-type']=type;if(origin)headers.origin=origin;}
  const response=await handleCopilot(new Request(`https://example.test${path}`,{method,headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)}),env);return {status:response.status,body:await response.json()};
}
const mutation=(state,action,payload)=>({action,payload,expectedRevision:state.revision});
async function onlineShop(env) {const state=(await call(env)).body.state;return (await call(env,{body:mutation(state,'settings',{accepting:true})})).body.state;}

test('orders pin exact channel prices and menu snapshots; public cannot select online prices',()=>{
  const original=seed(),a=order(original,'offline-0001'),b=order(a.state,'online-00001',{channel:'online'});
  assert.equal(original.orders.length,0);assert.equal(a.operation.order.totalCents,13000);assert.equal(b.operation.order.totalCents,17000);
  const updated=change(b.state,'menu',{items:b.state.menu.map(item=>({...item,storePriceCents:item.storePriceCents+1000}))});
  assert.equal(updated.state.orders[0].items[0].unitPriceCents,6500);assert.equal(updated.state.orders[1].items[0].unitPriceCents,8500);
  const publicResult=placePublicOrder(open(original),submit('public-00001',{channel:'online',totalCents:1}),now);
  assert.equal(publicResult.operation.order.channel,'offline');assert.equal(publicResult.operation.order.totalCents,13000);assert.equal(publicResult.operation.order.paymentProcessed,false);
});

test('idempotency survives closing the menu and rejects changed intent',()=>{
  const a=placePublicOrder(open(seed()),submit(),now),closed=change(a.state,'settings',{accepting:false}).state;
  const again=placePublicOrder(closed,submit(),now);assert.equal(again.state.orders.length,1);assert.equal(again.state.revision,closed.revision);assert.equal(again.operation.trackingToken,a.operation.trackingToken);assert.equal(again.operation.duplicate,true);
  assert.throws(()=>placePublicOrder(closed,submit('request-0001',{note:'different'}),now),/different order details/);
  assert.throws(()=>placePublicOrder(closed,submit('request-0002'),now),/not accepting/);
});

test('active aggregation preserves channel quantities and separates item notes',()=>{
  let state=order(seed(),'order-one1',{items:[{id:'basil-chicken',quantity:2,note:'No chilli'}]}).state;
  state=order(state,'order-two2',{channel:'online',items:[{id:'basil-chicken',quantity:3,note:'No chilli'}]}).state;
  state=order(state,'order-three3',{items:[{id:'basil-chicken',quantity:1,note:'Extra chilli'}]}).state;
  const summary=queueSummary(state,now);assert.equal(summary.activeOrders,3);assert.equal(summary.offlineOrders,2);assert.equal(summary.onlineOrders,1);assert.equal(summary.items.length,2);
  assert.deepEqual(summary.items.find(item=>item.note==='No chilli'),{id:'basil-chicken',name:'Basil chicken rice',nameTh:'ข้าวกะเพราไก่',note:'No chilli',station:'hot',quantity:5,offline:2,online:3});
  const id=state.orders[0].id;state=change(state,'status',{orderId:id,status:'preparing'}).state;state=change(state,'status',{orderId:id,status:'ready'}).state;
  assert.equal(queueSummary(state,now).items.find(item=>item.note==='No chilli').quantity,3);assert.equal(queueSummary(state,now).readyOrders,1);
});

test('ETA uses parallel station capacity and progress; queued wait is never treated as cooking',()=>{
  let state=order(seed(),'eta-first1',{items:[{id:'basil-chicken',quantity:2},{id:'thai-tea',quantity:1}]}).state;
  state=order(state,'eta-second2',{items:[{id:'basil-chicken',quantity:1}]}).state;
  const [a,b]=state.orders;assert.equal(estimateOrders(state,now)[a.id],7);assert.equal(estimateOrders(state,now)[b.id],14);
  assert.equal(estimateOrders(state,'2026-10-14T13:00:00Z')[b.id],14);
  state=change(state,'status',{orderId:a.id,status:'preparing'}).state;
  assert.equal(estimateOrders(state,'2026-10-14T12:03:00Z')[a.id],4);assert.equal(estimateOrders(state,'2026-10-14T12:03:00Z')[b.id],11);
  state=change(state,'status',{orderId:a.id,status:'ready'}).state;assert.equal(estimateOrders(state,now)[a.id],0);assert.equal(estimateOrders(state,now)[b.id],7);
});

test('status transitions enforce construction order, allow cancellations and keep served immutable',()=>{
  let state=order(seed(),'status-one1').state;const orderId=state.orders[0].id;
  assert.throws(()=>change(state,'status',{orderId,status:'served'}),/not allowed/);
  for(const status of ['preparing','ready','served'])state=change(state,'status',{orderId,status}).state;
  assert.throws(()=>change(state,'status',{orderId,status:'cancelled'}),/not allowed/);
  const second=order(state,'status-two2');state=change(second.state,'status',{orderId:second.operation.order.id,status:'cancelled'}).state;
  assert.equal(queueSummary(state,now).activeOrders,0);
});

test('menu, settings and submissions validate monetary, URL, availability and quantity boundaries',()=>{
  const state=open(seed());
  for(const payload of [{capacity:7},{capacity:0},{grabMenuUrl:'https://food.grab.com.evil.test/menu'},{grabMenuUrl:'http://food.grab.com/menu'},{grabMenuUrl:'https://evil@food.grab.com/menu'},{paymentMethods:['paid']},{accepting:'true'}])assert.throws(()=>change(state,'settings',payload));
  for(const value of [1.1,-1,5_000_001,Infinity])assert.throws(()=>change(state,'menu',{items:state.menu.map((item,i)=>i?item:{...item,storePriceCents:value})}));
  assert.throws(()=>placePublicOrder(state,submit('public-test1',{items:[{id:'basil-chicken',quantity:0}]})));
  assert.throws(()=>placePublicOrder(state,submit('public-test1',{items:[{id:'missing',quantity:1}]})));
  const unavailable=change(state,'menu',{items:state.menu.map(item=>({...item,available:false}))}).state;assert.equal(publicMenu(unavailable).menu.length,0);assert.throws(()=>placePublicOrder(unavailable,submit()));
});

test('public views omit internal ownership, prices, request IDs and unrelated orders',()=>{
  const a=placePublicOrder(open(seed()),submit('public-one1'),now),b=placePublicOrder(a.state,submit('public-two2',{table:'99',note:'Private note'}),now);
  const menu=publicMenu(b.state),tracking=trackOrder(b.state,a.operation.trackingToken,now);
  assert.ok(!JSON.stringify(menu).includes('onlinePriceCents'));for(const key of ['businessId','publicKey','orders','revision','trackingToken','requestFingerprint','requestId'])assert.equal(menu[key],undefined);
  assert.ok(!JSON.stringify(tracking).includes('Private note'));assert.equal(tracking.trackingToken,undefined);assert.equal(tracking.requestId,undefined);
  assert.throws(()=>trackOrder(b.state,'0'.repeat(32),now),/not found/);
});

test('authenticated storage is isolated per merchant and stale owner writes do not overwrite',async()=>{
  const {env,database}=harness();assert.equal((await call(env,{user:null})).status,401);
  const a=(await call(env)).body.state,b=(await call(env,{user:'other'})).body.state;
  assert.notEqual(a.businessId,b.businessId);assert.notEqual(a.publicKey,b.publicKey);assert.equal(a.settings.accepting,false);
  const update=await call(env,{body:mutation(a,'settings',{name:'Only owner A',accepting:true})});assert.equal(update.status,200);
  assert.equal((await call(env,{body:mutation(a,'settings',{name:'Stale'})})).status,409);
  assert.notEqual((await call(env,{user:'other'})).body.state.settings.name,'Only owner A');
  const attack=await call(env,{user:'other',body:{...mutation(b,'settings',{name:'Owner B'}),businessId:a.businessId}});assert.equal(attack.status,200);assert.equal((await call(env)).body.state.settings.name,'Only owner A');
  assert.equal(database.prepare('SELECT count(*) n FROM copilot_workspaces').get().n,2);
});

test('public order creates a real merchant queue item and retries remain idempotent across CAS races',async()=>{
  const {env,database}=harness(),state=await onlineShop(env),path=`/api/copilot/public/${state.publicKey}`;
  const results=await Promise.all([1,2].map(()=>call(env,{user:null,path,body:submit()})));
  assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results[0].body.order.id,results[1].body.order.id);
  const saved=(await call(env)).body.state;assert.equal(saved.orders.length,1);assert.equal(saved.orders[0].source,'qr');assert.equal(saved.orders[0].totalCents,13000);
  const tracking=await call(env,{user:null,path:`${path}/order/${results[0].body.trackingToken}`});assert.equal(tracking.status,200);assert.equal(tracking.body.order.id,saved.orders[0].id);
  const other=(await call(env,{user:'other'})).body.state;assert.equal((await call(env,{user:null,path:`/api/copilot/public/${other.publicKey}/order/${results[0].body.trackingToken}`})).status,404);
  assert.equal(database.prepare('SELECT revision FROM copilot_workspaces WHERE business_id=?').get(state.businessId).revision,2);
});

test('concurrent distinct public orders preserve both orders without overwriting and owner duplicates tolerate stale revision',async()=>{
  const {env}=harness(),state=await onlineShop(env),path=`/api/copilot/public/${state.publicKey}`;
  const results=await Promise.all(['concurrent-a','concurrent-b'].map(requestId=>call(env,{user:null,path,body:submit(requestId)})));assert.deepEqual(results.map(r=>r.status),[200,200]);
  let saved=(await call(env)).body.state;assert.equal(saved.orders.length,2);assert.deepEqual(saved.orders.map(o=>o.number).sort(),[1,2]);
  const body=mutation(saved,'order',submit('manual-order1',{channel:'online'}));assert.equal((await call(env,{body})).status,200);const repeat=await call(env,{body});assert.equal(repeat.status,200);assert.equal(repeat.body.operation.duplicate,true);assert.equal(repeat.body.state.orders.length,3);
});

test('public read remains available while paused, but public writes and cross-origin requests fail',async()=>{
  const {env}=harness(),state=(await call(env)).body.state,path=`/api/copilot/public/${state.publicKey}`;
  assert.equal((await call(env,{user:null,path})).status,200);assert.equal((await call(env,{user:null,path,body:submit()})).status,409);
  assert.equal((await call(env,{body:mutation(state,'settings',{accepting:true}),origin:'https://evil.test'})).status,403);
  assert.equal((await call(env,{user:null,path,body:submit(),origin:null})).status,403);
  assert.equal((await call(env,{body:mutation(state,'settings',{accepting:true}),type:'text/plain'})).status,415);
  assert.equal((await call(env,{body:'x'.repeat(40_001)})).status,413);
  assert.equal((await call(env,{user:null,path:'/api/copilot/public/not-a-key'})).status,404);
});

 test('preparing batch elapsed time reduces its station timeline once, not every item',()=>{
  let state=order(seed(),'large-batch1',{items:[{id:'basil-chicken',quantity:4}]}).state;const orderId=state.orders[0].id;
  state=change(state,'status',{orderId,status:'preparing'}).state;
  assert.equal(estimateOrders(state,now)[orderId],14);
  assert.equal(estimateOrders(state,'2026-10-14T12:03:00Z')[orderId],11);
  assert.equal(estimateOrders(state,'2026-10-14T13:00:00Z')[orderId],1);
});


const recipe=(extras={})=>({menuId:'basil-chicken',source:'manual',ingredients:[{name:'Chicken',purchaseCostCents:10000,purchaseQuantity:1000,portionQuantity:120,unit:'g'}],packagingCents:200,otherVariableCents:100,onlineFeeBps:2000,...extras});
test('portion costing uses exact decimal ratios and half-up per-ingredient rounding',()=>{
  const state=change(seed(),'costing',recipe()).state,cost=costForMenu(state,'basil-chicken');assert.equal(cost.ingredients[0].portionCostCents,1200);assert.equal(cost.costCents,1500);
  const half=change(state,'costing',recipe({ingredients:[{name:'Spice',purchaseCostCents:1,purchaseQuantity:0.002,portionQuantity:0.001,unit:'g'}],packagingCents:0,otherVariableCents:0})).state;
  assert.equal(costForMenu(half,'basil-chicken').costCents,1);
  for(const quantity of [0,-1,0.0001,Infinity,1000001])assert.throws(()=>change(seed(),'costing',recipe({ingredients:[{...recipe().ingredients[0],portionQuantity:quantity}]})));
  assert.throws(()=>change(seed(),'costing',recipe({ingredients:[{...recipe().ingredients[0],unit:'kg'}]})));
  assert.throws(()=>change(seed(),'costing',recipe({onlineFeeBps:10000})));
  assert.equal(costForMenu(seed(),'constructor').costCents,null);
});

test('plate analysis separates open and served quantities, excludes cancellation and applies fees per channel',()=>{
  let state=change(seed(),'costing',recipe()).state;
  state=order(state,'cost-order1',{items:[{id:'basil-chicken',quantity:2}]}).state;const servedId=state.orders[0].id;
  for(const status of ['preparing','ready','served'])state=change(state,'status',{orderId:servedId,status}).state;
  state=order(state,'cost-order2',{channel:'online',items:[{id:'basil-chicken',quantity:3}]}).state;
  state=order(state,'cost-order3',{items:[{id:'basil-chicken',quantity:1}]}).state;state=change(state,'status',{orderId:state.orders.at(-1).id,status:'cancelled'}).state;
  const report=calculatePlateCosts(state,now),row=report.rows.find(row=>row.menuId==='basil-chicken');
  assert.equal(row.quantity,5);assert.equal(row.servedQuantity,2);assert.equal(row.openQuantity,3);assert.equal(row.orderValueCents,38500);assert.equal(row.variableCostCents,7500);assert.equal(row.ingredientCostCents,6000);assert.equal(row.feeCents,5100);assert.equal(row.contributionCents,25900);
  assert.equal(row.channels.offline.contributionCents,10000);assert.equal(row.channels.online.contributionCents,15900);assert.equal(report.totals.contributionCents,25900);
  assert.match(report.basis,/Current recipe/);assert.match(report.exclusions,/fixed overhead/);
  const updated=change(state,'costing',recipe({ingredients:[{...recipe().ingredients[0],purchaseCostCents:20000}]})).state;
  assert.equal(updated.orders[0].totalCents,13000);assert.equal(calculatePlateCosts(updated,now).totals.contributionCents,19900);
});

test('unknown recipes and online fees remain unknown and old states without costings still load',()=>{
  let state=seed();delete state.costings;state=order(state,'unknown-order1').state;
  assert.equal(costForMenu(state,'basil-chicken').costCents,null);assert.equal(calculatePlateCosts(state,now).totals.contributionCents,null);
  state=change(state,'costing',recipe({onlineFeeBps:null})).state;assert.equal(calculatePlateCosts(state,now).totals.contributionCents,10000);
  state=order(state,'unknown-order2',{channel:'online'}).state;const report=calculatePlateCosts(state,now);assert.equal(report.totals.contributionCents,null);assert.equal(report.totals.missingFee,true);assert.equal(report.rows[0].channels.online.feeCents,null);
  const renamed=change(state,'menu',{items:state.menu.filter(item=>item.id!=='basil-chicken')}).state;const archived=calculatePlateCosts(renamed,now).rows.find(row=>row.menuId==='basil-chicken');assert.equal(archived.archived,true);assert.equal(archived.orderValueCents,30000);
});

async function savedReceipt(env,user,{kind='purchase',mode='manual',lineTotal=100}={}) {
  const storage=createStorage(env),owned=await storage.load(user,createWorkspace),state=structuredClone(owned.state);
  const result=confirmReceipt(state,{reviewed:true,receipt:{name:'Supplier bill',kind,currency:'THB',items:[{name:'Confirmed chicken purchase',quantity:1,unitPrice:lineTotal,lineTotal}],total:lineTotal,text:'Supplier bill',source:{mode,engine:'Test confirmed fields'}}});
  await storage.save(user,owned.businessId,state,owned.state.revision,'receipt',{previousState:owned.state});return result;
}
test('receipt costing derives authoritative money from owned confirmed purchase lines and persists provenance',async()=>{
  const {env}=harness(),receipt=await savedReceipt(env,'owner'),state=(await call(env)).body.state;
  const payload=recipe({source:'receipt',ingredients:[{...recipe().ingredients[0],name:'Forged name',source:'receipt',receiptId:receipt.id,receiptLine:0,purchaseCostCents:1}]});
  const result=await call(env,{body:mutation(state,'costing',payload)});assert.equal(result.status,200);
  const saved=result.body.state.costings['basil-chicken'];assert.equal(saved.source,'receipt');assert.equal(saved.ingredients[0].purchaseCostCents,10000);assert.equal(saved.ingredients[0].name,'Confirmed chicken purchase');assert.equal(saved.ingredients[0].receiptId,receipt.id);assert.equal(costForMenu(result.body.state,'basil-chicken').costCents,1500);
  const publicView=await call(env,{user:null,path:`/api/copilot/public/${state.publicKey}`});assert.ok(!JSON.stringify(publicView.body).includes('Confirmed chicken purchase'));assert.equal(publicView.body.costings,undefined);
});

test('foreign, simulated, unconfirmed and sales receipts cannot become real ingredient cost evidence',async()=>{
  const {env,database}=harness(),foreign=await savedReceipt(env,'other'),sale=await savedReceipt(env,'owner',{kind:'sale'}),simulated=await savedReceipt(env,'owner',{mode:'simulated'}),unknown=await savedReceipt(env,'owner',{lineTotal:null}),state=(await call(env)).body.state;
  const ingredient=recipe().ingredients[0];
  for(const receiptId of [foreign.id,sale.id,simulated.id,unknown.id,'not-owned']){
    const payload=recipe({source:'receipt',ingredients:[{...ingredient,receiptId,receiptLine:0}]});assert.equal((await call(env,{body:mutation(state,'costing',payload)})).status,400);
  }
  for(const payload of [recipe({source:'demo'}),recipe({ingredients:[{...ingredient,source:'demo'}]}),recipe({source:'receipt'}),recipe({ingredients:{bad:true}})])assert.equal((await call(env,{body:mutation(state,'costing',payload)})).status,400);
  assert.equal((await call(env)).body.state.revision,0);
  const stored=database.prepare('SELECT payload FROM copilot_workspaces WHERE business_id=?').get(state.businessId);assert.deepEqual(JSON.parse(stored.payload).costings,{});
});

test('public and merchant category labels escape saved merchant text',async()=>{
  const {guestView,menuView}=await import('../dist/copilot/views.mjs');
  const payload='<img src=x onerror=alert(1)>',initial=seed();
  const state=change(initial,'menu',{items:initial.menu.map((item,index)=>index?item:{...item,category:payload})}).state;
  for(const language of ['en','th']) {
    const guestHtml=guestView({data:publicMenu(state),language,demo:false,table:'Table 1'});
    const merchantHtml=menuView({state,language,demo:false,table:'Table 1'});
    assert.ok(!guestHtml.includes(payload),'Customer category label must escape merchant text');
    assert.ok(!merchantHtml.includes(payload),'Merchant category label must escape merchant text');
  }
});
