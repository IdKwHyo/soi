import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMenuCsv,mergeMenuImport,createDemoMenuDraft,MENU_CSV_HEADER} from '../dist/copilot/menu-import.mjs';
import {inspectDishPhoto,prepareDishPhoto} from '../dist/copilot/menu-photo-client.mjs';
import {createCopilotClient,COPILOT_DEMO_PHOTO_STORAGE_KEY} from '../dist/copilot/client.mjs';
import {createCopilotState,applyCopilotAction} from '../dist/copilot/domain.mjs';

function storage(){const entries=new Map();return {getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value))};}
const pngBytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH2kAAAAASUVORK5CYII=','base64'));
const png=()=>new Blob([pngBytes],{type:'image/png'});

test('menu CSV review merges matching IDs, retains unmatched SKUs and existing photos, and parses exact money',()=>{
  const original=createCopilotState().menu;original[0].available=false;original[0].photo={kind:'uploaded',id:'a'.repeat(32)};
  const copy=structuredClone(original);
  const draft=parseMenuCsv(`${MENU_CSV_HEADER}\r\nbasil-chicken,"Basil, ""special""",กะเพรา,Kitchen,65.10,85.25,7,hot\r\nnew-latte,Latte,ลาเต้,Drinks,40,50.00,2,bar`,original);
  assert.equal(draft.length,7);assert.equal(draft[0].name,'Basil, "special"');assert.equal(draft[0].storePriceCents,6510);assert.equal(draft[0].onlinePriceCents,8525);
  assert.deepEqual(draft[0].photo,original[0].photo);assert.equal(draft[0].available,false);assert.equal(draft.at(-1).available,false);assert.deepEqual(draft[1],original[1]);assert.deepEqual(original,copy);
  const state=createCopilotState(),withOrder=applyCopilotAction(state,{action:'order',payload:{requestId:'csv-existing-order',channel:'offline',table:'A',items:[{id:'basil-chicken',quantity:1}]}}).state;
  const updated=applyCopilotAction(withOrder,{action:'menu',payload:{items:draft}}).state;
  assert.deepEqual(updated.orders,withOrder.orders);assert.deepEqual(updated.costings,withOrder.costings);
});

test('menu CSV rejects duplicate IDs, invalid values, unsupported columns and combined catalogs over 60 before saving',()=>{
  const line='dish-a,Dish A,,Food,10,12,2,main';
  assert.throws(()=>parseMenuCsv(`${MENU_CSV_HEADER}\n${line}\n${line}`),/unique/);
  for(const price of ['-1','2.555','1e2','50000.01'])assert.throws(()=>parseMenuCsv(`${MENU_CSV_HEADER}\ndish-a,Dish,,Food,${price},12,2,main`));
  assert.throws(()=>parseMenuCsv(`${MENU_CSV_HEADER}\ndish-a,Dish,,Food,10,12,0,main`),/Preparation minutes/);
  assert.throws(()=>parseMenuCsv(`${MENU_CSV_HEADER},photo_url\n${line},https://remote.test/photo.png`),/exactly these/);
  assert.throws(()=>parseMenuCsv('x'.repeat(50_001)),/50 KB/);
  assert.throws(()=>mergeMenuImport(Array.from({length:60},(_,index)=>({id:`existing-${index}`,available:true})),[{id:'new-sku'}]),/combined menu/);
});

test('simulated AI menu draft is explicit and uses six canonical generated photos',()=>{
  const draft=createDemoMenuDraft();assert.equal(draft.mode,'simulated');assert.equal(draft.items.length,6);assert.match(draft.notice,/No uploaded image was read/);assert.match(draft.notice,/no live model/);
  assert.ok(draft.items.every(item=>item.photo.kind==='generated'&&item.photo.key===item.id));
});

test('photo source validation rejects disguised formats and oversized dimensions before decoding',async()=>{
  await assert.rejects(inspectDishPhoto(new Blob(['<svg></svg>'],{type:'image/png'})),/valid PNG/);
  await assert.rejects(inspectDishPhoto(new Blob([pngBytes],{type:'image/jpeg'})),/valid JPEG/);
  const large=pngBytes.slice(),view=new DataView(large.buffer);view.setUint32(16,6000);view.setUint32(20,5000);
  let decoded=false;
  await assert.rejects(prepareDishPhoto(new Blob([large],{type:'image/png'}),{decode:async()=>{decoded=true;}}),/24 megapixels/);
  assert.equal(decoded,false);assert.deepEqual(await inspectDishPhoto(png()),{type:'image/png',width:1,height:1});
});

test('photo preparation re-encodes decoded pixels, lowers quality to its budget and releases the decoded image',async()=>{
  let encoded=0,closed=false,drawn=false;const canvas={width:0,height:0,getContext:()=>({fillStyle:'',fillRect(){},drawImage(){drawn=true;}}),toBlob(callback,type){assert.equal(type,'image/jpeg');encoded++;callback(new Blob([new Uint8Array(encoded===1?90_000:70_000)],{type}));}};
  const result=await prepareDishPhoto(png(),{decode:async()=>({width:1,height:1,close(){closed=true;}}),createCanvas:()=>canvas});
  assert.equal(result.type,'image/jpeg');assert.equal(result.size,70_000);assert.equal(encoded,2);assert.equal(drawn,true);assert.equal(closed,true);assert.ok(canvas.width<=640&&canvas.height<=640);
});

test('demo photo uploads deduplicate, resolve across browser clients, and never transmit to a service',async()=>{
  const shared=storage();let requests=0;const options={demo:true,storage:shared,fetchImpl:()=>{requests++;throw Error('No demo requests');}};
  const owner=createCopilotClient(options),guest=createCopilotClient(options);let state=await owner.load();
  const uploaded=await owner.uploadPhoto(png()),again=await owner.uploadPhoto(png());assert.deepEqual(uploaded.photo,again.photo);assert.match(uploaded.url,/^data:image\/png;base64,/);
  assert.equal(Object.keys(JSON.parse(shared.getItem(COPILOT_DEMO_PHOTO_STORAGE_KEY)).photos).length,1);
  const items=state.menu.map((item,index)=>index===0?{...item,photo:uploaded.photo}:item);await owner.mutate('menu',{items});
  const menu=await guest.menu('demo');assert.equal(menu.menu[0].photoUrl,uploaded.url);assert.equal(guest.photoUrl(uploaded.photo),uploaded.url);
  await owner.resetDemo();assert.equal(guest.photoUrl(uploaded.photo),null);assert.equal(requests,0);
});

test('demo photo quota errors do not silently discard already-saved images',async()=>{
  const shared=storage(),client=createCopilotClient({demo:true,storage:shared});await client.load();
  let latest=null,error=null;
  for(let index=0;index<15;index++) {const bytes=new Uint8Array(80*1024);bytes.set(pngBytes);bytes[bytes.length-1]=index;try{latest=await client.uploadPhoto(new Blob([bytes],{type:'image/png'}));}catch(caught){error=caught;break;}}
  assert.equal(error?.status,413);assert.match(error.message,/1 MB/);assert.equal(client.photoUrl(latest.photo),latest.url);
  const unavailable=createCopilotClient({demo:true,storage:null});await assert.rejects(unavailable.uploadPhoto(png()),/storage is unavailable/);
});

test('live photo upload sends raw bytes and adopts the returned revision for the next menu save',async()=>{
  let saved=createCopilotState(),posted=null;const photo={kind:'uploaded',id:'b'.repeat(32)};
  const client=createCopilotClient({fetchImpl:async(path,options)=>{
    if(path==='/api/copilot/media'){assert.ok(options.body instanceof Blob);assert.equal(options.headers['Content-Type'],'image/png');saved={...saved,revision:1};return Response.json({photo,url:`/api/copilot/media/${saved.publicKey}/${photo.id}`,state:saved});}
    posted=JSON.parse(options.body);assert.equal(posted.expectedRevision,1);const result=applyCopilotAction(saved,posted);saved=result.state;return Response.json(result);
  }});
  const upload=await client.uploadPhoto(png());assert.equal(upload.state.revision,1);assert.equal(client.getState().revision,1);
  assert.equal(client.photoUrl(photo),`/api/copilot/media/${photo.id}`);assert.equal(client.photoUrl(photo,upload.state.publicKey),`/api/copilot/media/${upload.state.publicKey}/${photo.id}`);
  await client.mutate('menu',{items:upload.state.menu.map((item,index)=>index===0?{...item,photo}:item)});assert.equal(posted.action,'menu');
  const failure=createCopilotClient({fetchImpl:async()=>Response.json({error:'Sign in',signinPath:'/signin-with-chatgpt'},{status:401})});await assert.rejects(failure.uploadPhoto(png()),error=>error.status===401&&error.signinPath==='/signin-with-chatgpt');assert.equal(failure.getState(),null);
});
