import test from 'node:test';
import assert from 'node:assert/strict';
import {createCopilotClient,COPILOT_DEMO_STORAGE_KEY,parseOrderCsv} from '../dist/copilot/client.mjs';
import {createCopilotState,applyCopilotAction,costForMenu} from '../dist/copilot/domain.mjs';

function browserStorage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const order=requestId=>({requestId,table:'Table 08',items:[{id:'basil-chicken',quantity:2}]});

test('demo uses isolated persistence, combines channels, and carries public orders across browser clients without networking',async()=>{
  const storage=browserStorage();storage.setItem('soi-studio-demo-v1','original');
  let requests=0;const fetchImpl=()=>{requests++;throw new Error('No network in demo');};
  const merchant=createCopilotClient({demo:true,storage,fetchImpl}),customer=createCopilotClient({demo:true,storage,fetchImpl});
  const initial=await merchant.load();assert.equal(initial.orders.length,10);assert.deepEqual(new Set(initial.orders.map(o=>o.channel)),new Set(['offline','online']));
  assert.deepEqual(new Set(initial.orders.map(o=>o.status)),new Set(['ready','preparing','queued','served']));
  const menu=await customer.menu(initial.publicKey);assert.equal(menu.shop.accepting,true);assert.ok(menu.menu.every(item=>!Object.hasOwn(item,'onlinePriceCents')));
  const placed=await customer.submit(initial.publicKey,order('customer-retry-001'));assert.equal(placed.order.totalCents,13_000);
  assert.equal(placed.order.paymentProcessed,false);assert.equal(placed.order.channel,'offline');
  const duplicate=await customer.submit(initial.publicKey,order('customer-retry-001'));assert.equal(duplicate.duplicate,true);assert.equal(duplicate.order.id,placed.order.id);
  const refreshed=await merchant.load();assert.equal(refreshed.orders.length,11);
  await merchant.mutate('status',{orderId:placed.order.id,status:'preparing'});
  const tracked=await customer.track(initial.publicKey,placed.trackingToken);assert.equal(tracked.status,'preparing');assert.equal(tracked.requestId,undefined);
  assert.equal(storage.getItem('soi-studio-demo-v1'),'original');assert.equal(requests,0);
  const snapshot=merchant.getState();snapshot.settings.name='Unsaved';assert.notEqual(merchant.getState().settings.name,'Unsaved');
});

test('demo uses current saved state for writes and respects disabled QR ordering',async()=>{
  const storage=browserStorage(),first=createCopilotClient({demo:true,storage}),second=createCopilotClient({demo:true,storage});
  const initial=await first.load();await second.load();
  await first.mutate('settings',{accepting:false});
  await assert.rejects(second.submit(initial.publicKey,order('closed-shop-001')),error=>error.status===409);
  await second.mutate('settings',{name:'Another name'});
  const state=await first.load();assert.equal(state.settings.accepting,false);assert.equal(state.settings.name,'Another name');
  await assert.rejects(first.menu('missing-menu-key'),error=>error.status===404);
});

test('unavailable or damaged demo storage is disclosed and never creates live requests',async()=>{
  const unavailable={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  const memory=createCopilotClient({demo:true,storage:unavailable});const state=await memory.load();
  assert.equal(memory.persistence,'memory');assert.match(memory.notice,/only while this page/);
  await memory.mutate('settings',{name:'Memory kitchen'});assert.equal((await memory.load()).settings.name,'Memory kitchen');
  const storage=browserStorage();storage.setItem(COPILOT_DEMO_STORAGE_KEY,'bad json');
  const recovered=createCopilotClient({demo:true,storage});assert.equal((await recovered.load()).orders.length,10);assert.match(recovered.notice,/fresh sample queue/);
  const reset=await memory.resetDemo();assert.equal(reset.orders.length,10);assert.notEqual(reset.publicKey,state.publicKey);
});

test('live errors preserve authentication information and never use demo storage or records',async()=>{
  let requests=0;const storage={getItem(){throw new Error('Live storage was touched');},setItem(){throw new Error('Live storage was touched');}};
  const live=createCopilotClient({storage,fetchImpl:async()=>{requests++;return Response.json({error:'Sign in',signinPath:'/signin-with-chatgpt?return_to=%2Fcopilot'},{status:401});}});
  await assert.rejects(live.load(),error=>error.status===401&&error.signinPath==='/signin-with-chatgpt?return_to=%2Fcopilot');
  assert.equal(live.getState(),null);assert.equal(live.persistence,'cloud');assert.equal(requests,1);
  await assert.rejects(live.resetDemo(),error=>error.status===403);assert.equal(requests,1);
  const offline=createCopilotClient({fetchImpl:async()=>{throw new TypeError('Network unavailable');}});
  await assert.rejects(offline.load(),/Network unavailable/);assert.equal(offline.getState(),null);
});

test('a live revision conflict refreshes the state but does not replay the write',async()=>{
  let saved=createCopilotState(),writes=0,reads=0;
  const client=createCopilotClient({fetchImpl:async(path,options)=>{
    assert.equal(path,'/api/copilot');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
    if(options.method==='GET'){reads++;return Response.json({state:saved});}
    writes++;const body=JSON.parse(options.body);assert.equal(body.expectedRevision,0);assert.equal(body.action,'settings');
    saved=applyCopilotAction(saved,{action:'settings',payload:{name:'Concurrent name'}}).state;
    return Response.json({error:'Queue changed'},{status:409});
  }});
  await client.load();await assert.rejects(client.mutate('settings',{name:'My update'}),error=>error.status===409);
  assert.equal(writes,1);assert.equal(reads,2);assert.equal(client.getState().settings.name,'Concurrent name');assert.equal(client.getState().revision,1);
});

test('live public requests preserve order request IDs and tracking tokens without loading owner data',async()=>{
  const calls=[],payload=order('stable-network-retry-001');
  const client=createCopilotClient({fetchImpl:async(path,options)=>{
    calls.push({path,options});
    if(options.method==='POST')return Response.json({order:{number:3},trackingToken:'receipt-token',duplicate:false});
    return Response.json(path.includes('/order/')?{order:{number:3,status:'ready'}}:{shop:{name:'Public menu'},menu:[]});
  }});
  assert.equal((await client.menu('public-key')).shop.name,'Public menu');
  const first=await client.submit('public-key',payload);await client.submit('public-key',payload);
  assert.equal(first.trackingToken,'receipt-token');assert.equal((await client.track('public-key',first.trackingToken)).status,'ready');
  assert.deepEqual(calls.filter(c=>c.options.method==='POST').map(c=>JSON.parse(c.options.body).requestId),[payload.requestId,payload.requestId]);
  assert.ok(calls.every(c=>c.path.startsWith('/api/copilot/public/public-key')));assert.equal(client.getState(),null);
});

test('costing demo uses fictional purchases and preserves entered recipes when upgrading saved demo data',async()=>{
  const storage=browserStorage(),client=createCopilotClient({demo:true,storage});
  let state=await client.load();assert.equal(Object.keys(state.costings).length,6);assert.equal(state.orders.filter(order=>order.status==='served').length,6);
  assert.ok(Object.values(state.costings).every(costing=>costing.source==='demo'&&costing.ingredients.every(item=>item.source==='demo'&&!item.receiptId)));
  assert.equal(costForMenu(state,'basil-chicken').costCents,2770);assert.equal(state.costings['basil-chicken'].onlineFeeBps,3000);
  const custom={...state.costings['basil-chicken'],source:'manual',packagingCents:1000};
  state=(await client.mutate('costing',custom)).state;
  delete state.demoFixtureVersion;storage.setItem(COPILOT_DEMO_STORAGE_KEY,JSON.stringify(state));
  const upgraded=await client.load();assert.equal(upgraded.costings['basil-chicken'].packagingCents,1000);assert.equal(upgraded.orders.length,10);
});

test('sample import presets add distinct channels once and refuse live use',async()=>{
  const client=createCopilotClient({demo:true,storage:browserStorage()});await client.load();
  for(const source of ['qr','pos','delivery']) {
    const first=await client.importSample(source),second=await client.importSample(source);
    assert.equal(first.operation.duplicate,false);assert.equal(second.operation.duplicate,true);
    assert.equal(first.operation.order.channel,source==='delivery'?'online':'offline');assert.match(first.operation.order.table,/Simulated/);
    assert.match(first.operation.order.note,/No external system/);
  }
  assert.equal((await client.load()).orders.length,13);
  await assert.rejects(client.importSample('unknown'),error=>error.status===400);
  const live=createCopilotClient({fetchImpl:()=>{throw Error('Must not request');}});
  await assert.rejects(live.importSample('pos'),error=>error.status===403);
});

test('CSV import parses quoted fields, aggregates stable IDs and rejects conflicting or untrusted columns before writing',()=>{
  const parsed=parseOrderCsv('\uFEFForder_id,channel,table,sku,quantity\r\nPOS-1001,offline,"Counter, ""A""",basil-chicken,2\r\nPOS-1001,offline,"Counter, ""A""",thai-tea,1\r\nDEL-2001,online,Delivery,chicken-rice,3');
  assert.equal(parsed.length,2);assert.equal(parsed[0].requestId,'csv_POS-1001');assert.equal(parsed[0].table,'Counter, "A"');assert.equal(parsed[0].items.length,2);
  assert.equal(parsed[0].note,'Imported CSV · owner supplied');
  assert.throws(()=>parseOrderCsv('order_id,channel,table,sku,quantity,price\nPOS-1001,offline,A,basil-chicken,1,1'),/exactly these/);
  assert.throws(()=>parseOrderCsv('order_id,channel,table,sku,quantity\nPOS-1001,offline,A,basil-chicken,1\nPOS-1001,online,A,thai-tea,1'),/same channel/);
  assert.throws(()=>parseOrderCsv('order_id,channel,table,sku,quantity\nPOS-1001,offline,A,basil-chicken,0'),/whole number/);
  assert.throws(()=>parseOrderCsv('order_id,channel,table,sku,quantity\nPOS-1001,offline,"A,basil-chicken,1'),/closing quote/);
  assert.throws(()=>parseOrderCsv('x'.repeat(50_001)),/50 KB/);
});

test('CSV retry safely recovers a lost response after an order was already committed',async()=>{
  let saved=createCopilotState(),failOnce=true;
  const client=createCopilotClient({fetchImpl:async(path,options)=>{
    if(options.method==='GET')return Response.json({state:saved});
    const body=JSON.parse(options.body),result=applyCopilotAction(saved,body);saved=result.state;
    if(body.payload.requestId==='csv_POS-1002'&&failOnce){failOnce=false;throw new TypeError('Response lost');}
    return Response.json(result);
  }});
  const csv='order_id,channel,table,sku,quantity\nPOS-1001,offline,A,basil-chicken,1\nPOS-1002,offline,B,thai-tea,2';
  await assert.rejects(client.importCsv(csv),error=>error.committed===1&&error.total===2&&/Retry the same file/.test(error.message));
  assert.equal(saved.orders.length,2);
  const resumed=await client.importCsv(csv);assert.equal(resumed.imported,0);assert.equal(resumed.duplicates,2);assert.equal(resumed.state.orders.length,2);
  assert.equal(resumed.state.orders[0].totalCents,6500);assert.equal(resumed.state.orders[1].totalCents,7000);
});
