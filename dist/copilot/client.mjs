import {createCopilotState,applyCopilotAction,publicMenu,placePublicOrder,trackOrder,CopilotError} from './domain.mjs';
import {menuPhotoUrl,normalizeMenuPhoto,GENERATED_MENU_PHOTOS,MAX_MENU_PHOTO_BYTES,MAX_MENU_PHOTO_DIMENSION} from './menu-media.mjs';
import {inspectDishPhoto} from './menu-photo-client.mjs';

export const COPILOT_DEMO_STORAGE_KEY='soi-copilot-demo-v1';
export const COPILOT_DEMO_PHOTO_STORAGE_KEY='soi-copilot-demo-photos-v1';
const DEMO_PHOTO_BYTES=80*1024,DEMO_PHOTO_STORAGE_BYTES=1_000_000;
const clone=value=>value==null?value:structuredClone(value);

/** Owner-supplied order import. Prices always come from the saved menu. */
export function parseOrderCsv(text) {
  const invalid=message=>{throw new CopilotError(message,400);};
  if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>50_000)invalid('Use a UTF-8 CSV no larger than 50 KB.');
  const input=text.replace(/^\uFEFF/,''),rows=[];
  let row=[],value='',quoted=false,closed=false;
  const cell=()=>{row.push(value);value='';closed=false;};
  const line=()=>{cell();if(row.some(part=>part.trim()))rows.push(row);row=[];if(rows.length>101)invalid('Import at most 100 data rows per file.');};
  for(let i=0;i<input.length;i++) {
    const char=input[i];
    if(quoted) {if(char==='"'){if(input[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=char;continue;}
    if(char===','){cell();continue;}
    if(char==='\n'||char==='\r'){if(char==='\r'&&input[i+1]==='\n')i++;line();continue;}
    if(closed)invalid('Unexpected text after a quoted CSV value.');
    if(char==='"'){if(value!=='')invalid('Quotes must wrap the complete CSV value.');quoted=true;}else value+=char;
  }
  if(quoted)invalid('A quoted CSV value is missing its closing quote.');
  if(value!==''||row.length||closed)line();
  if(rows.length<2)invalid('Include the CSV header and at least one order row.');
  if(rows[0].map(part=>part.trim()).join(',')!=='order_id,channel,table,sku,quantity')invalid('Use exactly these CSV columns: order_id,channel,table,sku,quantity.');
  const groups=new Map();
  for(let index=1;index<rows.length;index++) {
    if(rows[index].length!==5)invalid(`CSV row ${index+1} must contain five values.`);
    const [orderId,channel,table,sku,rawQuantity]=rows[index].map(part=>part.trim());
    if(!/^[A-Za-z0-9_-]{4,64}$/.test(orderId))invalid(`CSV row ${index+1}: order_id must contain 4–64 letters, numbers, hyphens or underscores.`);
    if(!['offline','online'].includes(channel))invalid(`CSV row ${index+1}: channel must be offline or online.`);
    if(table.length>40||/[\u0000-\u001f\u007f]/.test(table))invalid(`CSV row ${index+1}: use a table label up to 40 characters without line breaks.`);
    if(!/^[A-Za-z0-9_-]{1,60}$/.test(sku))invalid(`CSV row ${index+1}: use a valid menu SKU.`);
    if(!/^\d+$/.test(rawQuantity)||Number(rawQuantity)<1||Number(rawQuantity)>20)invalid(`CSV row ${index+1}: quantity must be a whole number from 1 to 20.`);
    let order=groups.get(orderId);
    if(!order){order={requestId:`csv_${orderId}`,channel,table,items:[],note:'Imported CSV · owner supplied'};groups.set(orderId,order);}
    else if(order.channel!==channel||order.table!==table)invalid(`Order ${orderId} must use the same channel and table on every row.`);
    order.items.push({id:sku,quantity:Number(rawQuantity)});
    if(order.items.length>20||order.items.reduce((total,item)=>total+item.quantity,0)>50)invalid(`Order ${orderId} exceeds 20 lines or 50 items.`);
  }
  return [...groups.values()];
}

function sampleState() {
  const clock=Date.now(),ago=minutes=>clock-minutes*60_000;
  let state=createCopilotState({businessId:'copilot-demo',name:'Soi Kitchen',now:ago(15)});
  state=applyCopilotAction(state,{action:'settings',payload:{accepting:true}},ago(15)).state;
  const fixtures=[
    {requestId:'sample-offline-ready',channel:'offline',table:'Table 02',items:[{id:'basil-chicken',quantity:2},{id:'thai-tea',quantity:1}],age:10,status:'ready'},
    {requestId:'sample-online-preparing',channel:'online',table:'Delivery 108',items:[{id:'chicken-rice',quantity:2},{id:'lime-soda',quantity:1}],age:6,status:'preparing'},
    {requestId:'sample-offline-queued',channel:'offline',table:'Table 04',items:[{id:'tom-yum',quantity:1},{id:'fried-rice',quantity:1}],age:3,status:'queued'},
    {requestId:'sample-online-queued',channel:'online',table:'Delivery 109',items:[{id:'basil-chicken',quantity:1},{id:'thai-tea',quantity:2}],age:1,status:'queued'}
  ];
  for(const {age,status,...payload} of fixtures) {
    const placed=applyCopilotAction(state,{action:'order',payload},ago(age));state=placed.state;
    if(status!=='queued')state=applyCopilotAction(state,{action:'status',payload:{orderId:placed.operation.order.id,status:'preparing'}},ago(status==='ready'?8:2)).state;
    if(status==='ready')state=applyCopilotAction(state,{action:'status',payload:{orderId:placed.operation.order.id,status:'ready'}},ago(1)).state;
  }
  return extendDemoState(state,clock);
}

function extendDemoState(state,clock=Date.now()) {
  if(state.demoPhotoVersion!==1){const menu=state.menu.map(item=>item.photo===undefined&&GENERATED_MENU_PHOTOS.includes(item.id)?{...item,photo:{kind:'generated',key:item.id}}:item);state={...applyCopilotAction(state,{action:'menu',payload:{items:menu}},clock).state,demoPhotoVersion:1};}
  if(state.demoFixtureVersion===2)return state;
  const ingredient=(name,purchaseCostCents,purchaseQuantity,portionQuantity,unit='g')=>({name,source:'demo',purchaseCostCents,purchaseQuantity,portionQuantity,unit});
  const rice=()=>ingredient('Rice',6000,1000,80),chicken=()=>ingredient('Chicken',11000,1000,100),oil=()=>ingredient('Cooking oil',7000,1000,10,'ml'),sauce=amount=>ingredient('Sauce',8000,1000,amount,'ml');
  // Fictional purchase packs and recipes for demonstration, not OCR or supplier data.
  const recipes=[
    ['basil-chicken',[rice(),chicken(),ingredient('Basil',2000,100,10),sauce(15),oil()],500,300],
    ['chicken-rice',[rice(),chicken(),ingredient('Cucumber',3500,1000,40),sauce(10)],500,200],
    ['fried-rice',[rice(),ingredient('Mixed vegetables',5000,1000,100),oil(),sauce(15)],500,300],
    ['tom-yum',[ingredient('Shrimp',24000,1000,100),ingredient('Mushrooms',7000,1000,60),ingredient('Soup stock',5000,1000,250,'ml'),sauce(30)],600,400],
    ['thai-tea',[ingredient('Tea leaves',15000,1000,15),ingredient('Milk',6500,1000,80,'ml'),ingredient('Sugar',3000,1000,15)],400,100],
    ['lime-soda',[ingredient('Lime juice',12000,1000,30,'ml'),ingredient('Soda water',1800,1000,180,'ml'),ingredient('Syrup',5000,1000,20,'ml')],400,100]
  ];
  for(const [menuId,ingredients,packagingCents,otherVariableCents] of recipes) {
    if(!state.menu.some(item=>item.id===menuId)||state.costings?.[menuId])continue;
    state=applyCopilotAction(state,{action:'costing',payload:{menuId,source:'demo',ingredients,packagingCents,otherVariableCents,onlineFeeBps:3000}},clock).state;
  }
  const history=[
    ['offline','Sample counter 201',[['basil-chicken',3],['thai-tea',2]],100],
    ['offline','Sample counter 202',[['chicken-rice',4],['lime-soda',2]],80],
    ['online','Sample delivery 301',[['basil-chicken',2],['tom-yum',1]],75],
    ['offline','Sample counter 203',[['fried-rice',2],['lime-soda',1]],55],
    ['online','Sample delivery 302',[['chicken-rice',1],['thai-tea',2]],45],
    ['online','Sample delivery 303',[['tom-yum',2],['fried-rice',1]],25]
  ];
  history.forEach(([channel,table,lines,age],index)=>{
    const requestId=`sample-served-history-${index+1}`;
    if(state.orders.length>=500||state.orders.filter(order=>['queued','preparing','ready'].includes(order.status)).length>=80||state.orders.some(order=>order.requestId===requestId)||lines.some(([id])=>!state.menu.some(item=>item.id===id&&item.available)))return;
    const now=clock-age*60_000,placed=applyCopilotAction(state,{action:'order',payload:{requestId,channel,table,items:lines.map(([id,quantity])=>({id,quantity})),note:'Fictional served-order history. No payment or actual merchant outcome is implied.'}},now);state=placed.state;
    ['preparing','ready','served'].forEach((status,step)=>{state=applyCopilotAction(state,{action:'status',payload:{orderId:placed.operation.order.id,status}},now+(step+1)*3*60_000).state;});
  });
  return {...state,demoFixtureVersion:2};
}

// A damaged demo is recoverable; live data is never replaced with sample records.
function isDemoState(state) {
  return state?.schemaVersion===1&&state.businessId==='copilot-demo'&&Number.isSafeInteger(state.revision)&&state.revision>=0
    &&typeof state.publicKey==='string'&&/^[a-f0-9]{32}$/.test(state.publicKey)
    &&state.settings&&typeof state.settings.name==='string'&&Number.isInteger(state.settings.capacity)
    &&state.settings.capacity>=1&&state.settings.capacity<=6&&typeof state.settings.accepting==='boolean'
    &&Array.isArray(state.settings.paymentMethods)&&Array.isArray(state.menu)&&state.menu.length>0
    &&state.menu.every(item=>typeof item.id==='string'&&Number.isSafeInteger(item.storePriceCents)&&Number.isSafeInteger(item.onlinePriceCents))
    &&Number.isSafeInteger(state.sequence)&&Array.isArray(state.orders)&&state.orders.every(order=>typeof order.id==='string'
      &&typeof order.createdAt==='string'&&['offline','online'].includes(order.channel)
      &&['queued','preparing','ready','served','cancelled'].includes(order.status)&&Array.isArray(order.items)
      &&order.items.every(item=>typeof item.station==='string'&&Number.isInteger(item.prepMinutes)&&Number.isInteger(item.quantity)));
}

/**
 * One interface for the cloud app and its deliberately isolated local demo.
 * Callers supply a stable requestId for an order and preserve it on retries.
 * A 409 refreshes the cached live state, then rejects so the merchant can review.
 */
export function createCopilotClient(options={}) {
  const demo=options.demo===true,fetchImpl=options.fetchImpl??globalThis.fetch;
  let state=null,storage=null,persistence=demo?'local':'cloud',notice='',photoRaw=null,photoCache=null;
  if(demo) {
    try {storage=Object.hasOwn(options,'storage')?options.storage:globalThis.localStorage;}
    catch {storage=null;}
    if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')useMemory();
  }
  function useMemory() {storage=null;persistence='memory';notice='Browser storage is unavailable. This demo will last only while this page stays open.';}
  function persist(next) {
    state=next;
    if(storage)try {storage.setItem(COPILOT_DEMO_STORAGE_KEY,JSON.stringify(next));}catch {useMemory();}
    return clone(state);
  }
  function readDemo() {
    if(storage) {
      let raw;
      try {raw=storage.getItem(COPILOT_DEMO_STORAGE_KEY);}catch {useMemory();}
      if(raw!=null) {
        let saved;
        try {saved=JSON.parse(raw);if(!isDemoState(saved))throw new Error('Invalid demo data');}
        catch {notice='The saved demo could not be read. A fresh sample queue has been loaded.';return persist(sampleState());}
        state=saved;if(saved.demoFixtureVersion!==2||saved.demoPhotoVersion!==1)return persist(extendDemoState(saved));return clone(state);
      } else if(storage) return persist(sampleState());
    }
    return state?clone(state):persist(sampleState());
  }
  function demoFor(key) {
    const current=readDemo();
    if(key!=='demo'&&key!==current.publicKey)throw new CopilotError('This demo menu link was not found. Open the merchant demo to create a current link.',404);
    return current;
  }
  async function request(path,{method='GET',body}={}) {
    if(typeof fetchImpl!=='function')throw new CopilotError('The server cannot be reached in this browser.',503);
    const binary=body instanceof Blob;
    const response=await fetchImpl(path,{method,credentials:'same-origin',cache:'no-store',headers:body===undefined?{'Accept':'application/json'}:{'Accept':'application/json','Content-Type':binary?body.type:'application/json'},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
    let result;
    try {result=await response.json();}catch {throw new CopilotError('The server returned an unreadable response. Please try again.',response.ok?502:response.status);}
    if(!response.ok) {
      const error=new CopilotError(typeof result?.error==='string'?result.error:'The request could not be completed.',response.status);
      if(typeof result?.signinPath==='string')error.signinPath=result.signinPath;
      throw error;
    }
    return result;
  }
  async function load() {
    if(demo)return readDemo();
    const result=await request('/api/copilot');
    if(!result?.state||!Number.isSafeInteger(result.state.revision))throw new CopilotError('The server returned an incomplete merchant workspace.',502);
    state=result.state;return clone(state);
  }
  async function mutate(action,payload) {
    if(demo) {const result=applyCopilotAction(readDemo(),{action,payload});persist(result.state);return clone(result);}
    if(!state)await load();
    try {
      const result=await request('/api/copilot',{method:'POST',body:{action,payload,expectedRevision:state.revision}});
      if(!result?.state||!Number.isSafeInteger(result.state.revision))throw new CopilotError('The server returned an incomplete update. Reload before retrying.',502);
      state=result.state;return clone(result);
    } catch(error) {
      if(error.status===409)try {await load();}catch { /* Preserve the original conflict; never retry a write. */ }
      throw error;
    }
  }
  async function importCsv(text) {
    const orders=parseOrderCsv(text);let imported=0,duplicates=0;
    for(const payload of orders) {
      try {const result=await mutate('order',payload);if(result.operation.duplicate)duplicates++;else imported++;}
      catch(error) {
        const failure=new CopilotError(`CSV import stopped after ${imported} confirmed new orders and ${duplicates} existing orders (${orders.length} total). ${error.message} Retry the same file to resume without duplicates.`,error.status||503);
        Object.assign(failure,{imported,duplicates,committed:imported+duplicates,total:orders.length});
        if(error.signinPath)failure.signinPath=error.signinPath;
        throw failure;
      }
    }
    return {state:clone(state),imported,duplicates,total:orders.length};
  }
  function readPhotos() {
    if(!storage)throw new CopilotError('Browser storage is unavailable. Enable storage to save menu photos in this demo.',503);
    let raw;try{raw=storage.getItem(COPILOT_DEMO_PHOTO_STORAGE_KEY);}catch{throw new CopilotError('Browser storage is unavailable. Your photo has not been saved.',503);}
    if(raw===photoRaw&&photoCache)return photoCache;
    try {
      if(raw&&raw.length>DEMO_PHOTO_STORAGE_BYTES)throw Error('Photo store exceeds its limit');
      const data=raw?JSON.parse(raw):{version:1,photos:{}};
      if(data.version!==1||!data.photos||typeof data.photos!=='object'||Array.isArray(data.photos))throw Error('Invalid photo store');
      for(const [id,photo] of Object.entries(data.photos)){if(!/^[a-f0-9]{32}$/.test(id)||!photo||!['image/jpeg','image/png','image/webp'].includes(photo.type)||!Number.isInteger(photo.bytes)||photo.bytes<1||photo.bytes>DEMO_PHOTO_BYTES||typeof photo.url!=='string'||!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo.url))throw Error('Invalid photo record');}
      photoRaw=raw;photoCache=data;return data;
    } catch {throw new CopilotError('Saved demo photos could not be read. Restart the demo to clear its photo storage, then upload again.',422);}
  }
  function photoUrl(photo,publicKey) {
    if(demo&&photo?.kind==='uploaded') {
      try{return readPhotos().photos[photo.id]?.url||null;}
      catch(error){notice=error.message;return null;}
    }
    const normalized=normalizeMenuPhoto(photo);
    if(!demo&&normalized?.kind==='uploaded'&&publicKey===undefined)return `/api/copilot/media/${normalized.id}`;
    return menuPhotoUrl(normalized,{publicKey,demo});
  }
  async function uploadPhoto(blob) {
    const limit=demo?DEMO_PHOTO_BYTES:MAX_MENU_PHOTO_BYTES;
    if(!(blob instanceof Blob)||!blob.size||blob.size>limit)throw new CopilotError(`Prepare a menu photo no larger than ${Math.floor(limit/1024)} KB before uploading.`,413);
    const info=await inspectDishPhoto(blob);if(info.width>MAX_MENU_PHOTO_DIMENSION||info.height>MAX_MENU_PHOTO_DIMENSION)throw new CopilotError(`Prepare a photo no larger than ${MAX_MENU_PHOTO_DIMENSION} pixels per side.`,400);
    if(!demo) {
      const result=await request('/api/copilot/media',{method:'POST',body:blob});
      if(!result?.state||!Number.isSafeInteger(result.state.revision)||result.photo?.kind!=='uploaded')throw new CopilotError('The server returned an incomplete photo record. Reload before trying again.',502);
      state=result.state;return clone(result);
    }
    const bytes=new Uint8Array(await blob.arrayBuffer());
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),id=Array.from(digest).slice(0,16).map(value=>value.toString(16).padStart(2,'0')).join('');
    let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    const current=readDemo(),saved=readPhotos(),url=`data:${blob.type};base64,${btoa(binary)}`,next={version:1,photos:{...saved.photos,[id]:{type:blob.type,bytes:blob.size,url}}},raw=JSON.stringify(next);
    if(raw.length>DEMO_PHOTO_STORAGE_BYTES)throw new CopilotError('This demo has reached its 1 MB photo-storage limit. Restart the demo to clear old photos or use a generated image.',413);
    try{storage.setItem(COPILOT_DEMO_PHOTO_STORAGE_KEY,raw);}catch{throw new CopilotError('Browser photo storage is full or blocked. Your photo has not been saved; use a generated image or free browser storage.',507);}
    photoRaw=raw;photoCache=next;return {photo:{kind:'uploaded',id},url,state:clone(current)};
  }
  const publicPath=key=>`/api/copilot/public/${encodeURIComponent(key)}`;
  return {
    load,mutate,importCsv,uploadPhoto,photoUrl,
    getState:()=>clone(state),
    get persistence(){return persistence;},
    get notice(){return notice;},
    async menu(key) {if(!demo)return request(publicPath(key));const menu=publicMenu(demoFor(key));return {...menu,menu:menu.menu.map(item=>({...item,photoUrl:photoUrl(item.photo)}))};},
    async submit(key,payload) {
      if(!demo)return request(publicPath(key),{method:'POST',body:payload});
      const result=placePublicOrder(demoFor(key),payload);persist(result.state);return clone(result.operation);
    },
    async track(key,token) {return demo?trackOrder(demoFor(key),token):(await request(`${publicPath(key)}/order/${encodeURIComponent(token)}`)).order;},
    async importSample(source='qr') {
      if(!demo)throw new CopilotError('Sample imports are available only in the demo.',403);
      const presets={
        qr:{channel:'offline',table:'Simulated QR · Table 06',items:[{id:'fried-rice',quantity:2},{id:'lime-soda',quantity:2}]},
        pos:{channel:'offline',table:'Simulated POS · Counter 01',items:[{id:'chicken-rice',quantity:3},{id:'thai-tea',quantity:1}]},
        delivery:{channel:'online',table:'Simulated delivery · 110',items:[{id:'tom-yum',quantity:1},{id:'basil-chicken',quantity:2}]}
      };
      if(!Object.hasOwn(presets,source))throw new CopilotError('Choose qr, pos or delivery for the sample import.',400);
      const payload={requestId:`demo-source-${source}-v1`,...presets[source],note:`Simulated ${source} input. No external system is connected.`};
      const current=readDemo(),result=source==='qr'?placePublicOrder(current,payload):applyCopilotAction(current,{action:'order',payload});
      persist(result.state);return clone(result);
    },
    async resetDemo() {
      if(!demo)throw new CopilotError('Reset is available only in the demo.',403);
      if(storage)try{storage.setItem(COPILOT_DEMO_PHOTO_STORAGE_KEY,JSON.stringify({version:1,photos:{}}));photoRaw=null;photoCache=null;}catch{throw new CopilotError('Browser storage is blocked. The demo photos could not be cleared.',507);}
      if(persistence!=='memory')notice='';
      return persist(sampleState());
    }
  };
}
