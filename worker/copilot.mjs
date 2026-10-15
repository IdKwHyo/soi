import {createStorage} from './storage.mjs';
import {createWorkspace} from '../dist/data.mjs';
import {toCents} from '../dist/core.mjs';
import {menuPhotoUrl,validateMenuPhotoBytes,MAX_MENU_PHOTO_BYTES,MAX_MENU_UPLOADS,MenuMediaError} from '../dist/copilot/menu-media.mjs';
import {createCopilotState,applyCopilotAction,publicMenu,placePublicOrder,trackOrder,CopilotError} from '../dist/copilot/domain.mjs';
const MAX_BODY=40_000,MAX_STATE=900_000;
const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw new CopilotError(message,status);};
async function readJson(request) {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail('Send application/json.',415);
  const reader=request.body?.getReader();if(!reader)fail('A request body is required.');
  const chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BODY){await reader.cancel();fail('The order request is too large.',413);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('Use a valid JSON request.');}if(!body||typeof body!=='object'||Array.isArray(body))fail('Use a JSON object.');return body;
}
function sameOrigin(request,url) {const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');if(origin!==url.origin||site==='cross-site')fail('Requests must come from this site.',403);}
function stateFrom(row){if(!row)return null;const state=JSON.parse(row.payload);state.businessId=row.business_id;state.revision=row.revision;state.publicKey=row.public_key;return state;}
async function save(db,state,expectedRevision,userId) {
  const payload=JSON.stringify(state);if(new TextEncoder().encode(payload).byteLength>MAX_STATE)fail('This queue has reached its storage capacity.',422);
  const args=[state.revision,payload,state.updatedAt,state.businessId,expectedRevision];
  let sql='UPDATE copilot_workspaces SET revision=?,payload=?,updated_at=? WHERE business_id=? AND revision=?';
  if(userId){sql+=" AND EXISTS(SELECT 1 FROM memberships WHERE user_id=? AND business_id=? AND role='owner')";args.push(userId,state.businessId);}
  const result=await db.batch([db.prepare(sql).bind(...args)]);return result[0]?.meta?.changes===1;
}
export async function handleCopilot(request,env) {
  try {
    const url=new URL(request.url),publicMatch=url.pathname.match(/^\/api\/copilot\/public\/([a-f0-9]{32})(?:\/order\/([a-f0-9]{32}))?\/?$/);
    if(!env.DB||!env.BUCKET)return response({error:'Merchant storage is unavailable. You can explore the separate demo.'},503);
    if(!['GET','POST'].includes(request.method))return response({error:'Use GET or POST.'},405);
    const mediaMatch=url.pathname.match(/^\/api\/copilot\/media\/([a-f0-9]{32})\/([a-f0-9]{32})$/);
    if(mediaMatch){if(request.method!=='GET')return response({error:'Use GET to view a dish photo.'},405);return await serveMenuPhoto(env,mediaMatch[1],mediaMatch[2]);}
    if(publicMatch) {
      const [,key,token]=publicMatch,load=async()=>stateFrom(await env.DB.prepare('SELECT business_id,public_key,revision,payload FROM copilot_workspaces WHERE public_key=?').bind(key).first());
      let state=await load();if(!state)fail('This menu link was not found.',404);
      if(request.method==='GET')return response(token?{order:trackOrder(state,token)}:publicMenu(state));
      if(token)return response({error:'Use GET to view order progress.'},405);
      sameOrigin(request,url);const body=await readJson(request);
      for(let attempt=0;attempt<4;attempt++) {const result=placePublicOrder(state,body);if(result.operation.duplicate||await save(env.DB,result.state,state.revision))return response(result.operation);state=await load();if(!state)fail('This menu link was not found.',404);}
      fail('The queue changed while submitting. Retry with the same request ID.',409);
    }
    const uploading=url.pathname==='/api/copilot/media',ownerMediaMatch=url.pathname.match(/^\/api\/copilot\/media\/([a-f0-9]{32})$/);
    if(!uploading&&!ownerMediaMatch&&url.pathname!=='/api/copilot'&&url.pathname!=='/api/copilot/')return response({error:'Copilot route not found.'},404);
    const userId=request.headers.get('oai-authenticated-user-id');if(!userId||userId.length>200)return response({error:'Sign in with ChatGPT to manage your merchant workspace.',signinPath:'/signin-with-chatgpt?return_to=%2Fcopilot'},401);
    if(request.method==='POST')sameOrigin(request,url);
    const owned=await createStorage(env).load(userId,createWorkspace),db=env.DB;
    let row=await db.prepare("SELECT c.business_id,c.public_key,c.revision,c.payload FROM copilot_workspaces c JOIN memberships m ON m.business_id=c.business_id WHERE m.user_id=? AND m.role='owner'").bind(userId).first();
    if(!row){const initial=createCopilotState({businessId:owned.businessId,name:owned.state.business.name});await db.batch([db.prepare("INSERT OR IGNORE INTO copilot_workspaces(business_id,public_key,revision,payload,updated_at) SELECT ?,?,0,?,? WHERE EXISTS(SELECT 1 FROM memberships WHERE user_id=? AND business_id=? AND role='owner')").bind(owned.businessId,initial.publicKey,JSON.stringify(initial),initial.updatedAt,userId,owned.businessId)]);row=await db.prepare('SELECT business_id,public_key,revision,payload FROM copilot_workspaces WHERE business_id=?').bind(owned.businessId).first();}
    const state=stateFrom(row);if(!state)fail('Merchant storage is unavailable.',503);
    if(ownerMediaMatch){if(request.method!=='GET')return response({error:'Use GET to preview a dish photo.'},405);return await serveStoredMenuPhoto(env,state,ownerMediaMatch[1]);}
    if(uploading){if(request.method!=='POST')return response({error:'Use POST to upload a dish photo.'},405);return response(await uploadMenuPhoto(request,env,state,userId));}
    if(request.method==='GET')return response({state});
    const body=await readJson(request);if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)fail('Include the current queue revision.');
    // Duplicate manual submissions are safe to retry even after a lost response.
    if(body.action==='order'&&state.orders.some(order=>order.requestId===body.payload?.requestId))return response(applyCopilotAction(state,body));
    if(body.expectedRevision!==state.revision)fail('The queue changed in another tab. Reload before trying again.',409);
    if(body.action==='costing')body.payload=verifiedCosting(body.payload,owned.state);
    const result=applyCopilotAction(state,body);
    if(body.action==='menu')await verifyMenuPhotos(env,state,result.state.menu);
    if(!await save(db,result.state,state.revision,userId))fail('The queue changed in another tab. Reload before trying again.',409);
    return response(result);
  } catch(error) {if(error instanceof CopilotError||error instanceof MenuMediaError)return response({error:error.message},error.status);return response({error:'Merchant storage is temporarily unavailable. Please try again.'},503);}
}


function verifiedCosting(payload,workspace) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('Use a recipe costing object.');
  if(!Array.isArray(payload.ingredients))fail('Include recipe ingredients.');
  if(payload.source==='demo'||payload.ingredients.some(item=>item?.source==='demo'))fail('Simulated cost evidence is only available in the separate demo.');
  const ingredients=payload.ingredients.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))fail('Use a valid ingredient.');
    if(item.receiptId===undefined&&item.source!=='receipt')return {...item,source:'manual'};
    const receipt=workspace.receipts?.find(record=>record.id===item.receiptId);
    if(!receipt||receipt.status!=='confirmed'||receipt.reviewed!==true||receipt.kind!=='purchase'||receipt.currency!=='THB'||receipt.source?.mode==='simulated')fail('Choose a confirmed purchase receipt from this merchant workspace.');
    if(!Number.isSafeInteger(item.receiptLine)||item.receiptLine<0||item.receiptLine>=receipt.items.length)fail('Choose a valid confirmed receipt line.');
    const line=receipt.items[item.receiptLine];if(line.lineTotal===null||line.lineTotal===undefined||line.lineTotal<=0)fail('This receipt line needs a confirmed positive purchase total.');
    // Receipt money is authoritative; merchant confirms normalized unit and recipe quantity.
    return {...item,name:line.name,purchaseCostCents:toCents(line.lineTotal),source:'receipt'};
  });
  if(payload.source==='receipt'&&!ingredients.some(item=>item.source==='receipt'))fail('Select a confirmed receipt line or use owner-entered costs.');
  return {...payload,source:ingredients.some(item=>item.source==='receipt')?'receipt':'manual',ingredients};
}


const photoKey=(businessId,photoId)=>`${businessId}/menu-photos/${photoId}`;
async function readPhoto(request){
  const reader=request.body?.getReader();if(!reader)fail('Attach a dish photo.');const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_MENU_PHOTO_BYTES){await reader.cancel();fail('Dish photos must be no larger than 250 KB after resizing.',413);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {bytes,metadata:validateMenuPhotoBytes(bytes,request.headers.get('content-type'))};
}
async function uploadMenuPhoto(request,env,initial,userId){
  const {bytes,metadata}=await readPhoto(request),digest=await crypto.subtle.digest('SHA-256',bytes),sha256=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join(''),id=sha256.slice(0,32),photo={kind:'uploaded',id};
  let state=initial,reserved=false;
  // Reserve capacity before R2 writes. All uploads, including abandoned drafts,
  // remain bounded; retries of the same bytes repair an interrupted upload.
  for(let attempt=0;attempt<4;attempt++){
    if((state.mediaUploads||[]).some(item=>item.id===id)){reserved=true;break;}
    if((state.mediaUploads||[]).length>=MAX_MENU_UPLOADS)fail('This preview has reached its 80 uploaded-photo capacity. Reuse an existing image or a generated dish image.',422);
    const next=structuredClone(state);next.mediaUploads=[...(state.mediaUploads||[]),{id,...metadata,sha256,createdAt:new Date().toISOString()}];next.revision++;next.updatedAt=new Date().toISOString();
    if(await save(env.DB,next,state.revision,userId)){state=next;reserved=true;break;}
    state=stateFrom(await env.DB.prepare("SELECT c.business_id,c.public_key,c.revision,c.payload FROM copilot_workspaces c JOIN memberships m ON m.business_id=c.business_id WHERE m.user_id=? AND m.role='owner'").bind(userId).first());if(!state)fail('Merchant workspace is unavailable.',503);
  }
  if(!reserved)fail('The queue changed during the upload. Retry the same photo.',409);
  await env.BUCKET.put(photoKey(state.businessId,id),bytes,{httpMetadata:{contentType:metadata.contentType,cacheControl:'private, no-store'},customMetadata:{sha256,width:String(metadata.width),height:String(metadata.height)}});
  const latest=stateFrom(await env.DB.prepare("SELECT c.business_id,c.public_key,c.revision,c.payload FROM copilot_workspaces c JOIN memberships m ON m.business_id=c.business_id WHERE m.user_id=? AND m.role='owner'").bind(userId).first());
  return {photo,url:menuPhotoUrl(photo),state:latest||state};
}
async function verifyMenuPhotos(env,state,menu){
  for(const id of new Set(menu.filter(item=>item.photo?.kind==='uploaded').map(item=>item.photo.id))){
    if(!(state.mediaUploads||[]).some(item=>item.id===id))fail('Choose a dish photo uploaded to this merchant workspace.');
    const key=photoKey(state.businessId,id),object=typeof env.BUCKET.head==='function'?await env.BUCKET.head(key):await env.BUCKET.get(key);
    if(!object)fail('A selected dish photo has not finished uploading. Upload it again before saving.');
  }
}
async function serveMenuPhoto(env,publicKey,id){
  const state=stateFrom(await env.DB.prepare('SELECT business_id,public_key,revision,payload FROM copilot_workspaces WHERE public_key=?').bind(publicKey).first());
  const referenced=state?.menu.some(item=>item.available&&item.photo?.kind==='uploaded'&&item.photo.id===id);
  if(!referenced)fail('Dish photo not found.',404);
  return serveStoredMenuPhoto(env,state,id);
}
async function serveStoredMenuPhoto(env,state,id){
  const metadata=state.mediaUploads?.find(item=>item.id===id);if(!metadata)fail('Dish photo not found.',404);
  const object=await env.BUCKET.get(photoKey(state.businessId,id));if(!object)fail('Dish photo not found.',404);
  if(!['image/jpeg','image/png','image/webp'].includes(metadata.contentType))fail('Dish photo not found.',404);
  return new Response(object.body,{headers:{'Content-Type':metadata.contentType,'Content-Length':String(metadata.bytes),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
