import {normalizeMenuPhoto,menuPhotoUrl} from './menu-media.mjs';
// One domain module for the simulated browser experience and authoritative server.
// All currency values are integer satang. No payment is taken or marked paid here.
const clone=value=>structuredClone(value);
const ACTIVE=new Set(['queued','preparing','ready']);
const MAX_ACTIVE=80,MAX_HISTORY=500;
export const ETA_METHOD='Heuristic: prep time per item, active station backlog and configured parallel capacity. Not a promised collection time.';
export class CopilotError extends Error {constructor(message,status=400){super(message);this.name='CopilotError';this.status=status;}}
const fail=(message,status)=>{throw new CopilotError(message,status);};
const object=(v,label='payload')=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(`Use an object for ${label}.`);return v;};
function text(v,label,max,{optional=false}={}) {if(v==null&&optional)return '';if(typeof v!=='string'||v.length>max||(!optional&&!v.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))fail(`Enter a valid ${label} (up to ${max} characters).`);return v.trim();}
function integer(v,label,min,max){if(!Number.isSafeInteger(v)||v<min||v>max)fail(`${label} must be a whole number from ${min} to ${max}.`);return v;}
function at(now){const d=new Date(now??Date.now());if(!Number.isFinite(d.getTime()))fail('Invalid time.');return d.toISOString();}
const id=()=>crypto.randomUUID().replaceAll('-','');
function settings(value) {
  object(value,'settings');
  const name=text(value.name,'shop name',100),capacity=integer(value.capacity,'Parallel station capacity',1,6);
  if(typeof value.accepting!=='boolean')fail('Choose whether orders are accepted.');
  let grabMenuUrl=text(value.grabMenuUrl,'Grab menu URL',400,{optional:true});
  if(grabMenuUrl) {let url;try{url=new URL(grabMenuUrl);}catch{fail('Use a valid https://food.grab.com menu link.');}if(url.protocol!=='https:'||url.hostname!=='food.grab.com'||url.username||url.password||url.port)fail('Use a valid https://food.grab.com menu link.');grabMenuUrl=url.href;}
  const methods=value.paymentMethods;if(!Array.isArray(methods)||methods.length>4||methods.some(m=>!['cash','promptpay','card','government-assistance'].includes(m))||new Set(methods).size!==methods.length)fail('Choose valid merchant payment methods.');
  return {name,capacity,accepting:value.accepting,grabMenuUrl,paymentMethods:[...methods]};
}
function catalog(items) {
  if(!Array.isArray(items)||!items.length||items.length>60)fail('Keep 1 to 60 menu items.');
  const seen=new Set();return items.map(item=>{object(item,'menu item');const itemId=text(item.id,'menu ID',60);if(!/^[a-zA-Z0-9_-]+$/.test(itemId)||seen.has(itemId))fail('Menu IDs must be unique letters, numbers, hyphens or underscores.');seen.add(itemId);
    if(typeof item.available!=='boolean')fail('Set each menu item availability.');
    return {id:itemId,name:text(item.name,'menu name',100),nameTh:text(item.nameTh,'Thai menu name',100,{optional:true}),category:text(item.category,'category',40),storePriceCents:integer(item.storePriceCents,'Store price in satang',0,5_000_000),onlinePriceCents:integer(item.onlinePriceCents,'Online price in satang',0,5_000_000),prepMinutes:integer(item.prepMinutes,'Preparation minutes',1,60),station:text(item.station,'station',30),available:item.available,photo:normalizeMenuPhoto(item.photo)};});
}
export function createCopilotState({businessId='demo',name='Soi Kitchen',now}={}) {
  const timestamp=at(now);
  const menu=[
    ['basil-chicken','Basil chicken rice','ข้าวกะเพราไก่','Kitchen',6500,8500,7,'hot'],
    ['chicken-rice','Chicken rice','ข้าวมันไก่','Kitchen',6000,8000,5,'hot'],
    ['fried-rice','Vegetable fried rice','ข้าวผัดผัก','Kitchen',6000,8000,6,'hot'],
    ['tom-yum','Tom yum soup','ต้มยำ','Kitchen',9500,12500,9,'hot'],
    ['thai-tea','Thai iced tea','ชาไทยเย็น','Drinks',3500,4500,2,'drinks'],
    ['lime-soda','Lime soda','มะนาวโซดา','Drinks',4000,5000,2,'drinks']
  ].map(([itemId,itemName,nameTh,category,storePriceCents,onlinePriceCents,prepMinutes,station])=>({id:itemId,name:itemName,nameTh,category,storePriceCents,onlinePriceCents,prepMinutes,station,available:true,photo:{kind:'generated',key:itemId}}));
  return {schemaVersion:1,businessId,revision:0,publicKey:id(),settings:settings({name,capacity:2,accepting:false,grabMenuUrl:'',paymentMethods:['cash','promptpay']}),menu,costings:{},mediaUploads:[],orders:[],sequence:0,createdAt:timestamp,updatedAt:timestamp};
}
function submission(payload,channel) {
  object(payload);const requestId=text(payload.requestId,'request ID',100);if(!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))fail('Use a unique request ID of 8 to 100 letters, numbers, hyphens or underscores.');
  if(!['offline','online'].includes(channel))fail('Choose offline or online orders.');
  const table=text(payload.table,'table or collection label',40,{optional:true}),note=text(payload.note,'order note',300,{optional:true});
  if(!Array.isArray(payload.items)||!payload.items.length||payload.items.length>20)fail('Choose 1 to 20 order lines.');
  const items=payload.items.map(item=>{object(item,'order line');return {id:text(item.id,'menu ID',60),quantity:integer(item.quantity,'Quantity',1,20),note:text(item.note,'item note',160,{optional:true})};});
  if(items.reduce((n,item)=>n+item.quantity,0)>50)fail('An order can contain at most 50 items.');
  return {requestId,channel,table,note,items};
}
function place(state,payload,source,now) {
  const input=submission(payload,source==='qr'?'offline':payload.channel),fingerprint=JSON.stringify(input),old=state.orders.find(o=>o.requestId===input.requestId);
  if(old) {if(old.requestFingerprint!==fingerprint||old.source!==source)fail('This request ID was already used for different order details.',409);return {state,operation:{order:source==='qr'?safeOrder(state,old,now):clone(old),trackingToken:old.trackingToken,duplicate:true}};}
  if(source==='qr'&&!state.settings.accepting)fail('This shop is not accepting QR orders right now. Ask the merchant to order.',409);
  if(state.orders.filter(o=>ACTIVE.has(o.status)).length>=MAX_ACTIVE)fail('The queue is full. Please ask the merchant before ordering.',429);
  if(state.orders.length>=MAX_HISTORY)fail('This prototype has reached its saved order capacity. Contact the merchant.',422);
  const items=input.items.map(item=>{const menu=state.menu.find(m=>m.id===item.id);if(!menu||!menu.available)fail('A selected menu item is no longer available. Refresh the menu.');const unitPriceCents=input.channel==='offline'?menu.storePriceCents:menu.onlinePriceCents;return {id:menu.id,name:menu.name,nameTh:menu.nameTh,category:menu.category,station:menu.station,prepMinutes:menu.prepMinutes,quantity:item.quantity,unitPriceCents,lineTotalCents:unitPriceCents*item.quantity,note:item.note};});
  const totalCents=items.reduce((n,item)=>n+item.lineTotalCents,0);if(!Number.isSafeInteger(totalCents))fail('Order amount is too large.');
  const timestamp=at(now),next=clone(state),order={id:id(),number:state.sequence+1,channel:input.channel,source,table:input.table,note:input.note,items,totalCents,status:'queued',createdAt:timestamp,updatedAt:timestamp,startedAt:null,trackingToken:id(),requestId:input.requestId,requestFingerprint:fingerprint};
  next.orders.push(order);next.sequence++;next.revision++;next.updatedAt=timestamp;
  return {state:next,operation:{order:source==='qr'?safeOrder(next,order,now):clone(order),trackingToken:order.trackingToken,duplicate:false}};
}
export function applyCopilotAction(state,{action,payload},now) {
  object(payload);if(action==='order')return place(state,payload,'manual',now);
  const next=clone(state),timestamp=at(now);let operation={};
  if(action==='settings') {next.settings=settings({...state.settings,...payload});operation.settings=clone(next.settings);}
  else if(action==='menu') {next.menu=catalog(payload.items);operation.menu=clone(next.menu);}
  else if(action==='costing') {const costing=validateCosting(state,payload,timestamp);next.costings={...(state.costings||{}),[costing.menuId]:costing};operation.costing=clone(costing);}
  else if(action==='status') {
    const order=next.orders.find(o=>o.id===payload.orderId);if(!order)fail('Order not found.',404);
    const allowed={queued:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['served','cancelled'],served:[],cancelled:[]};
    if(!allowed[order.status]?.includes(payload.status))fail('This order status change is not allowed.',409);
    order.status=payload.status;order.updatedAt=timestamp;if(payload.status==='preparing')order.startedAt=timestamp;if(['served','cancelled'].includes(payload.status))order.completedAt=timestamp;operation.order=clone(order);
  } else fail('Unknown copilot action.');
  next.revision++;next.updatedAt=timestamp;return {state:next,operation};
}
export function placePublicOrder(state,payload,now){return place(state,payload,'qr',now);}
export function publicMenu(state) {return {shop:{name:state.settings.name,accepting:state.settings.accepting,grabMenuUrl:state.settings.grabMenuUrl,paymentMethods:[...state.settings.paymentMethods],etaMethod:ETA_METHOD,paymentNotice:'Pay directly with the merchant. No payment is processed here. Government scheme eligibility must be confirmed with the merchant.'},menu:state.menu.filter(item=>item.available).map(({id,name,nameTh,category,storePriceCents,prepMinutes,photo})=>({id,name,nameTh,category,storePriceCents,prepMinutes,photo:normalizeMenuPhoto(photo),photoUrl:menuPhotoUrl(photo,{publicKey:state.publicKey,demo:state.businessId==='copilot-demo'})}))};}
export function estimateOrders(state,now) {
  const clock=new Date(at(now)).getTime(),slots=new Map(),result={};
  const active=state.orders.filter(o=>['queued','preparing'].includes(o.status)).sort((a,b)=>(a.status==='preparing'?0:1)-(b.status==='preparing'?0:1)||a.createdAt.localeCompare(b.createdAt)||a.number-b.number);
  for(const order of state.orders)if(!['queued','preparing'].includes(order.status))result[order.id]=order.status==='cancelled'?null:0;
  for(const order of active) {let finish=0;const elapsed=order.status==='preparing'&&order.startedAt?Math.max(0,(clock-new Date(order.startedAt).getTime())/60_000):0;
    // Estimate the order's own station schedule, then subtract elapsed time
    // from that timeline once. Subtracting it from every item undercounts batches.
    const ownSlots=new Map(),remaining=[];
    for(const item of order.items) {if(!ownSlots.has(item.station))ownSlots.set(item.station,new Array(state.settings.capacity).fill(0));const lanes=ownSlots.get(item.station);
      for(let unit=0;unit<item.quantity;unit++){const lane=lanes.indexOf(Math.min(...lanes)),start=lanes[lane],end=start+item.prepMinutes;lanes[lane]=end;const duration=Math.max(0,end-Math.max(start,elapsed));if(duration)remaining.push({station:item.station,duration});}}
    // A merchant must explicitly mark completion; never claim an active meal is ready.
    if(!remaining.length)remaining.push({station:order.items[0].station,duration:1});
    for(const item of remaining){if(!slots.has(item.station))slots.set(item.station,new Array(state.settings.capacity).fill(0));const lanes=slots.get(item.station),lane=lanes.indexOf(Math.min(...lanes));lanes[lane]+=item.duration;finish=Math.max(finish,lanes[lane]);}
    result[order.id]=Math.ceil(finish);
  }
  return result;
}
function safeOrder(state,order,now) {return {id:order.id,number:order.number,channel:order.channel,table:order.table,note:order.note,items:order.items.map(({id,name,nameTh,quantity,unitPriceCents,lineTotalCents,note})=>({id,name,nameTh,quantity,unitPriceCents,lineTotalCents,note})),totalCents:order.totalCents,status:order.status,createdAt:order.createdAt,updatedAt:order.updatedAt,etaMinutes:estimateOrders(state,now)[order.id],etaMethod:ETA_METHOD,paymentProcessed:false};}
export function trackOrder(state,token,now) {if(typeof token!=='string'||!/^[a-f0-9]{32}$/.test(token))fail('Order not found.',404);const order=state.orders.find(o=>o.trackingToken===token);if(!order)fail('Order not found.',404);return safeOrder(state,order,now);}
export function queueSummary(state,now) {
  const active=state.orders.filter(o=>ACTIVE.has(o.status)),aggregated=new Map(),estimates=estimateOrders(state,now);
  for(const order of active.filter(o=>o.status!=='ready'))for(const item of order.items){const key=JSON.stringify([item.id,item.name,item.nameTh,item.station,item.note]);const current=aggregated.get(key)||{id:item.id,name:item.name,nameTh:item.nameTh,note:item.note,station:item.station,quantity:0,offline:0,online:0};current.quantity+=item.quantity;current[order.channel]+=item.quantity;aggregated.set(key,current);}
  return {activeOrders:active.length,offlineOrders:active.filter(o=>o.channel==='offline').length,onlineOrders:active.filter(o=>o.channel==='online').length,readyOrders:active.filter(o=>o.status==='ready').length,items:[...aggregated.values()],estimatedMinutes:Math.max(0,...active.map(o=>estimates[o.id]||0)),etaMethod:ETA_METHOD};
}


function decimalQuantity(value,label) {
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1_000_000||!/^\d+(?:\.\d{1,3})?$/.test(String(value)))fail(`${label} must be positive, at most 1,000,000, and have at most three decimal places.`);
  return value;
}
function thousandths(value) {const [whole,fraction='']=String(value).split('.');return BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0'));}
function safeMoney(value){const result=Number(value);if(!Number.isSafeInteger(result)||result<0)fail('The recipe calculation exceeds the supported amount.');return result;}
function roundedRatio(numerator,denominator){return safeMoney((numerator+denominator/2n)/denominator);}
function validateCosting(state,payload,timestamp) {
  const menuId=text(payload.menuId,'menu ID',60);if(!state.menu.some(item=>item.id===menuId))fail('Choose an existing menu item.');
  const source=payload.source??'manual';if(!['manual','receipt','demo'].includes(source))fail('Choose a valid cost evidence source.');
  if(!Array.isArray(payload.ingredients)||!payload.ingredients.length||payload.ingredients.length>30)fail('Include 1 to 30 recipe ingredients.');
  const ingredients=payload.ingredients.map(item=>{object(item,'ingredient');const ingredientSource=item.source??(item.receiptId?'receipt':source==='demo'?'demo':'manual');if(!['manual','receipt','demo'].includes(ingredientSource))fail('Choose a valid ingredient evidence source.');
    const ingredient={name:text(item.name,'ingredient name',200),source:ingredientSource,purchaseCostCents:integer(item.purchaseCostCents,'Purchase cost in satang',1,100_000_000),purchaseQuantity:decimalQuantity(item.purchaseQuantity,'Purchased quantity'),portionQuantity:decimalQuantity(item.portionQuantity,'Quantity per plate'),unit:item.unit};
    if(!['g','ml','unit'].includes(ingredient.unit))fail('Use g, ml or unit for both purchased and portion quantities.');
    if(item.receiptId!==undefined||ingredientSource==='receipt'){ingredient.receiptId=text(item.receiptId,'receipt ID',100);ingredient.receiptLine=integer(item.receiptLine,'Receipt line index',0,29);ingredient.source='receipt';}
    return ingredient;
  });
  const onlineFeeBps=payload.onlineFeeBps===undefined||payload.onlineFeeBps===null?null:integer(payload.onlineFeeBps,'Online platform fee in basis points',0,9999);
  const result={menuId,source:ingredients.some(item=>item.source==='receipt')?'receipt':source==='demo'?'demo':'manual',ingredients,packagingCents:integer(payload.packagingCents,'Packaging cost in satang',0,1_000_000),otherVariableCents:integer(payload.otherVariableCents,'Other variable cost in satang',0,1_000_000),onlineFeeBps,updatedAt:timestamp};
  costForMenu({...state,costings:{[menuId]:result}},menuId);return result;
}
export function costForMenu(state,menuId) {
  const recipe=state.costings&&Object.hasOwn(state.costings,menuId)?state.costings[menuId]:null;
  if(!recipe)return {menuId,source:null,ingredients:[],ingredientCostCents:null,packagingCents:null,otherVariableCents:null,costCents:null,totalCents:null,onlineFeeBps:null,missingCost:true,updatedAt:null};
  const ingredients=recipe.ingredients.map(ingredient=>({...ingredient,portionCostCents:roundedRatio(BigInt(ingredient.purchaseCostCents)*thousandths(ingredient.portionQuantity),thousandths(ingredient.purchaseQuantity))}));
  const ingredientCostCents=safeMoney(ingredients.reduce((sum,item)=>sum+BigInt(item.portionCostCents),0n));
  const costCents=safeMoney(BigInt(ingredientCostCents)+BigInt(recipe.packagingCents)+BigInt(recipe.otherVariableCents));
  return {...clone(recipe),ingredients,ingredientCostCents,costCents,totalCents:costCents,missingCost:false};
}
export function calculatePlateCosts(state,now) {
  const recipes=state.costings||{},menus=new Map(state.menu.map(item=>[item.id,item]));
  // Retain orders for a SKU removed from the live menu; original order amounts remain authoritative.
  for(const order of state.orders)for(const item of order.items)if(!menus.has(item.id))menus.set(item.id,{id:item.id,name:item.name,nameTh:item.nameTh,storePriceCents:null,onlinePriceCents:null,archived:true});
  const rows=[];
  for(const menu of menus.values()) {
    const cost=costForMenu(state,menu.id),channels={};
    for(const channel of ['offline','online']) {
      const lines=state.orders.filter(order=>order.status!=='cancelled'&&order.channel===channel).flatMap(order=>order.items.filter(item=>item.id===menu.id).map(item=>({item,status:order.status})));
      const quantity=lines.reduce((sum,{item})=>sum+item.quantity,0),servedQuantity=lines.filter(line=>line.status==='served').reduce((sum,{item})=>sum+item.quantity,0),orderValueCents=safeMoney(lines.reduce((sum,{item})=>sum+BigInt(item.lineTotalCents),0n));
      const missingFee=channel==='online'&&cost.onlineFeeBps===null;
      const feeCents=missingFee?null:channel==='offline'?0:safeMoney(lines.reduce((sum,{item})=>sum+BigInt(roundedRatio(BigInt(item.unitPriceCents)*BigInt(cost.onlineFeeBps),10000n))*BigInt(item.quantity),0n));
      const ingredientCostCents=cost.missingCost?null:safeMoney(BigInt(cost.ingredientCostCents)*BigInt(quantity));
      const variableCostCents=cost.missingCost?null:safeMoney(BigInt(cost.costCents)*BigInt(quantity));
      channels[channel]={priceCents:channel==='offline'?menu.storePriceCents:menu.onlinePriceCents,quantity,servedQuantity,openQuantity:quantity-servedQuantity,orderValueCents,ingredientCostCents,variableCostCents,feeCents,contributionCents:variableCostCents===null||feeCents===null?null:orderValueCents-variableCostCents-feeCents,missingCost:cost.missingCost,missingFee};
    }
    const values=Object.values(channels),sum=key=>values.reduce((total,value)=>total+value[key],0),known=key=>values.some(value=>value.quantity>0&&value[key]===null)?null:values.reduce((total,value)=>total+(value[key]||0),0);
    rows.push({menuId:menu.id,name:menu.name,nameTh:menu.nameTh,archived:!!menu.archived,source:recipes[menu.id]?.source??null,costCents:cost.costCents,prices:{offline:menu.storePriceCents,online:menu.onlinePriceCents},channels,quantity:sum('quantity'),servedQuantity:sum('servedQuantity'),openQuantity:sum('openQuantity'),orderValueCents:sum('orderValueCents'),ingredientCostCents:known('ingredientCostCents'),variableCostCents:known('variableCostCents'),feeCents:known('feeCents'),contributionCents:cost.missingCost?null:known('contributionCents'),missingCost:cost.missingCost,missingFee:channels.online.quantity>0&&channels.online.missingFee});
  }
  const totals={};for(const key of ['quantity','servedQuantity','openQuantity','orderValueCents'])totals[key]=rows.reduce((sum,row)=>sum+row[key],0);
  for(const key of ['ingredientCostCents','variableCostCents','feeCents','contributionCents'])totals[key]=rows.some(row=>row.quantity>0&&row[key]===null)?null:rows.reduce((sum,row)=>sum+(row[key]||0),0);
  totals.missingCost=rows.some(row=>row.quantity>0&&row.missingCost);totals.missingFee=rows.some(row=>row.missingFee);
  return {rows,totals,asOf:at(now),basis:'Current recipe costs applied to original non-cancelled order values; served and open orders are separate counts. Orders are not confirmed payments.',exclusions:'Contribution before fixed overhead, tax, unentered labour, wastage, refunds, discounts and any other unentered costs. No historical profit or payment reconciliation is implied.'};
}
