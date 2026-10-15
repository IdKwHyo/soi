import test from 'node:test';
import assert from 'node:assert/strict';
import {createCopilotClient} from '../dist/copilot/client.mjs';
import {publicMenu,calculatePlateCosts,queueSummary,createCopilotState,applyCopilotAction} from '../dist/copilot/domain.mjs';
import {orderMenuView,cartView} from '../dist/copilot/order-view.mjs';
import {queueView,money} from '../dist/copilot/views.mjs';

function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};}
const frame=(state,extras={})=>({state,data:publicMenu(state),language:'en',demo:true,category:'all',cart:Object.create(null),table:'Table 03',tracking:null,...extras});
function actionButton(html,action){return [...html.matchAll(/<button\b[^>]*>/g)].map(match=>match[0]).find(tag=>tag.includes(`data-action="${action}"`));}

test('embedded demo cart reaches the shared queue and SKU contribution once, then shows live local progress',async()=>{
  let network=0;const client=createCopilotClient({demo:true,storage:storage(),fetchImpl:()=>{network++;throw Error('Embedded demo must stay local');}});
  const before=await client.load(),prior=calculatePlateCosts(before).rows.find(row=>row.menuId==='basil-chicken'),priorQueue=queueSummary(before),cart=Object.assign(Object.create(null),{'basil-chicken':2});
  const html=orderMenuView(frame(before,{cart})),cartHtml=cartView({data:publicMenu(before),language:'en',demo:true,cart});
  assert.ok(html.includes('data-add="basil-chicken"'));assert.ok(cartHtml.includes(money(13000,'en')));assert.ok(!actionButton(cartHtml,'review-cart').includes('disabled'));
  const payload={requestId:'embedded-qr-proof-001',table:'Embedded table 77',items:[{id:'basil-chicken',quantity:2}],note:'No chilli'};
  const sent=await client.submit('demo',payload),retried=await client.submit('demo',payload);
  assert.equal(retried.order.id,sent.order.id);assert.equal(retried.duplicate,true);
  const after=await client.load(),next=calculatePlateCosts(after).rows.find(row=>row.menuId==='basil-chicken');
  assert.equal(after.orders.length,before.orders.length+1);assert.equal(queueSummary(after).activeOrders,priorQueue.activeOrders+1);
  assert.equal(next.quantity-prior.quantity,2);assert.equal(next.openQuantity-prior.openQuantity,2);assert.equal(next.servedQuantity-prior.servedQuantity,0);
  assert.equal(next.orderValueCents-prior.orderValueCents,13000);assert.equal(next.variableCostCents-prior.variableCostCents,5540);assert.equal(next.contributionCents-prior.contributionCents,7460);
  const saved=after.orders.find(order=>order.id===sent.order.id);assert.equal(saved.source,'qr');assert.equal(saved.channel,'offline');assert.equal(sent.order.paymentProcessed,false);
  assert.ok(queueView({state:after,language:'en'}).includes('Embedded table 77'));
  await client.mutate('status',{orderId:sent.order.id,status:'preparing'});
  const tracking=await client.track('demo',sent.trackingToken),trackedHtml=orderMenuView(frame(await client.load(),{tracking}));
  assert.equal(tracking.status,'preparing');assert.match(trackedHtml,/Preparing/);assert.match(trackedHtml,/simulat/i);assert.equal(network,0);
});

test('embedded empty and paused carts cannot submit, and live view does not claim a simulated order',()=>{
  let state=createCopilotState();const empty=cartView({data:publicMenu(state),language:'en',demo:false,cart:Object.create(null)});
  assert.ok(actionButton(empty,'review-cart')?.includes('disabled'));
  const cart={'basil-chicken':1},paused=cartView({data:publicMenu(state),language:'en',demo:false,cart});
  assert.ok(actionButton(paused,'review-cart')?.includes('disabled'));
  const live=orderMenuView(frame(state,{demo:false,cart}));assert.doesNotMatch(live,/SIMULATED ORDER|Simulated order|fictional order/i);
  assert.match(live,/paused|not accepting/i);
  state=applyCopilotAction(state,{action:'settings',payload:{accepting:true}}).state;
  assert.ok(!actionButton(cartView({data:publicMenu(state),language:'en',demo:false,cart}),'review-cart').includes('disabled'));
});

test('embedded menu and cart escape merchant names, categories, and table labels in both languages',()=>{
  let state=createCopilotState();const unsafe='<img src=x onerror=alert(1)>';
  state=applyCopilotAction(state,{action:'settings',payload:{name:unsafe,accepting:true}}).state;
  state=applyCopilotAction(state,{action:'menu',payload:{items:state.menu.map((item,index)=>index?item:{...item,name:unsafe,nameTh:unsafe,category:unsafe})}}).state;
  for(const language of ['en','th']){
    const args=frame(state,{language,cart:{'basil-chicken':1},table:unsafe});
    assert.ok(!orderMenuView(args).includes(unsafe));assert.ok(!cartView(args).includes(unsafe));
  }
});
