import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {GENERATED_MENU_PHOTOS,MAX_MENU_PHOTO_BYTES,normalizeMenuPhoto,menuPhotoUrl,validateMenuPhotoBytes} from '../dist/copilot/menu-media.mjs';
import {createCopilotState,applyCopilotAction,publicMenu} from '../dist/copilot/domain.mjs';
import {handleCopilot} from '../worker/copilot.mjs';
const png=()=>Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOsmBbFwMDAxMDAwMDAAAARKAFsiRyEPQAAAABJRU5ErkJggg==','base64'));
const webp=()=>Uint8Array.from(Buffer.from('UklGRjIAAABXRUJQVlA4ICYAAABwAQCdASoCAAIAAUAmJZACdAIigAD9xx/Fv2j+9soKTiCjoAAAAA==','base64'));
const jpeg=()=>Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiivJOY//9k=','base64'));
function harness(){const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');for(const migration of ['0000_initial.sql','0001_advisor_records.sql','0002_copilot.sql'])database.exec(readFileSync(new URL(`../migrations/${migration}`,import.meta.url),'utf8'));
  const DB={prepare(sql){const statement=database.prepare(sql);return {bind(...args){return {sql,args,first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)})};}};},async batch(statements){database.exec('BEGIN');try{const rows=statements.map(({sql,args})=>({meta:{changes:database.prepare(sql).run(...args).changes}}));database.exec('COMMIT');return rows;}catch(error){database.exec('ROLLBACK');throw error;}}};
  const files=new Map(),BUCKET={async put(key,bytes,metadata){files.set(key,{bytes:new Uint8Array(bytes),metadata});},async head(key){return files.has(key)?{size:files.get(key).bytes.length}:null;},async get(key){const file=files.get(key);return file?{body:new Blob([file.bytes]).stream(),size:file.bytes.length,httpMetadata:file.metadata.httpMetadata}:null;}};return {env:{DB,BUCKET},files,database};}
async function call(env,{path='/api/copilot',user='merchant-a',body,bytes,type='image/png',origin='https://example.test',method=body||bytes?'POST':'GET'}={}){
  const headers={};if(user)headers['oai-authenticated-user-id']=user;if(method==='POST'){if(origin)headers.origin=origin;headers['content-type']=bytes?type:'application/json';}
  const response=await handleCopilot(new Request(`https://example.test${path}`,{method,headers,body:method==='POST'?(bytes||JSON.stringify(body)):undefined}),env);
  return {status:response.status,body:response.headers.get('Content-Type')?.startsWith('application/json')?await response.json():new Uint8Array(await response.arrayBuffer()),headers:response.headers};}
async function saveMenu(env,state,photo,{available=true,user='merchant-a'}={}){return call(env,{user,body:{action:'menu',expectedRevision:state.revision,payload:{items:state.menu.map((item,index)=>index?item:{...item,photo,available})}}});}

test('photo descriptors and URLs allow only curated keys or opaque IDs, never arbitrary image URLs',()=>{
  assert.equal(normalizeMenuPhoto(undefined),null);assert.equal(normalizeMenuPhoto(null),null);assert.equal(GENERATED_MENU_PHOTOS.length,6);
  for(const key of GENERATED_MENU_PHOTOS)assert.equal(menuPhotoUrl({kind:'generated',key}),`/images/menu/${key}.webp`);
  for(const bad of [{kind:'generated',key:'../private'},{kind:'uploaded',id:'../file'},'https://evil.test/pic.jpg',{url:'data:image/svg+xml,<svg/>'},{kind:'remote',url:'https://evil.test'}])assert.throws(()=>normalizeMenuPhoto(bad));
  const photo={kind:'uploaded',id:'a'.repeat(32)};assert.equal(menuPhotoUrl(photo,{demo:true,publicKey:'b'.repeat(32)}),null);assert.equal(menuPhotoUrl(photo,{publicKey:'invalid'}),null);
  assert.equal(menuPhotoUrl(photo),`/api/copilot/media/${'a'.repeat(32)}`);
  assert.equal(menuPhotoUrl(photo,{publicKey:'b'.repeat(32)}),`/api/copilot/media/${'b'.repeat(32)}/${'a'.repeat(32)}`);
  assert.deepEqual(normalizeMenuPhoto({...photo,url:'https://ignored.test',filename:'private-name'}),photo);
});

test('photo validation checks actual supported raster type, compressed byte limit and dimensions',()=>{
  for(const [bytes,type] of [[png(),'image/png'],[jpeg(),'image/jpeg'],[webp(),'image/webp']])assert.deepEqual(validateMenuPhotoBytes(bytes,type),{contentType:type,bytes:bytes.length,width:2,height:2});
  assert.throws(()=>validateMenuPhotoBytes(png(),'image/jpeg'),/does not match/);assert.throws(()=>validateMenuPhotoBytes(new TextEncoder().encode('<svg onload="alert(1)"></svg>'),'image/svg+xml'),error=>error.status===415);
  assert.throws(()=>validateMenuPhotoBytes(new Uint8Array(MAX_MENU_PHOTO_BYTES+1),'image/png'),error=>error.status===413);
  const huge=png();new DataView(huge.buffer).setUint32(16,9000);assert.throws(()=>validateMenuPhotoBytes(huge,'image/png'),/2048/);
  assert.throws(()=>validateMenuPhotoBytes(jpeg().slice(0,-1),'image/jpeg'),/does not match/);
});

test('legacy catalogs stay usable and non-destructive photo changes preserve costs and historical orders',()=>{
  let state=createCopilotState();for(const item of state.menu)delete item.photo;delete state.mediaUploads;
  assert.ok(publicMenu(state).menu.every(item=>item.photo===null&&item.photoUrl===null));
  state=applyCopilotAction(state,{action:'costing',payload:{menuId:'basil-chicken',source:'manual',ingredients:[{name:'Chicken',purchaseCostCents:10000,purchaseQuantity:1000,portionQuantity:100,unit:'g'}],packagingCents:100,otherVariableCents:0,onlineFeeBps:null}}).state;
  state=applyCopilotAction(state,{action:'order',payload:{requestId:'historic-photo-test',channel:'offline',items:[{id:'basil-chicken',quantity:2}],table:'4',note:''}}).state;
  const original=structuredClone(state),photo={kind:'generated',key:'basil-chicken'};
  const next=applyCopilotAction(state,{action:'menu',payload:{items:state.menu.map((item,index)=>index?item:{...item,photo,storePriceCents:7000})}}).state;
  assert.deepEqual(next.orders,original.orders);assert.deepEqual(next.costings,original.costings);assert.equal(next.orders[0].totalCents,13000);assert.equal(publicMenu(next).menu[0].photoUrl,'/images/menu/basil-chicken.webp');
});

test('authenticated upload remains private until catalog publication, then serves only while referenced and available',async()=>{
  const {env,files}=harness();const initial=(await call(env)).body.state;
  const uploaded=await call(env,{path:'/api/copilot/media',bytes:png()});assert.equal(uploaded.status,200);assert.equal(uploaded.body.photo.kind,'uploaded');assert.match(uploaded.body.photo.id,/^[a-f0-9]{32}$/);assert.equal(uploaded.body.state.revision,initial.revision+1);
  const publicUrl=menuPhotoUrl(uploaded.body.photo,{publicKey:initial.publicKey});
  assert.equal(files.size,1);assert.ok([...files.keys()][0].startsWith(initial.businessId+'/menu-photos/'));assert.equal((await call(env,{path:publicUrl,user:null})).status,404);
  const privateUrl=menuPhotoUrl(uploaded.body.photo);assert.equal(uploaded.body.url,privateUrl);
  assert.equal((await call(env,{path:privateUrl,user:null})).status,401);
  assert.equal((await call(env,{path:privateUrl,user:'merchant-b'})).status,404);
  const draft=await call(env,{path:privateUrl});assert.equal(draft.status,200);assert.deepEqual(draft.body,png());assert.match(draft.headers.get('Cache-Control'),/private, no-store/);
  const saved=await saveMenu(env,uploaded.body.state,uploaded.body.photo);assert.equal(saved.status,200);
  const menu=await call(env,{path:`/api/copilot/public/${initial.publicKey}`,user:null});assert.deepEqual(menu.body.menu[0].photo,uploaded.body.photo);assert.equal(menu.body.menu[0].photoUrl,publicUrl);assert.equal(menu.body.mediaUploads,undefined);
  const image=await call(env,{path:publicUrl,user:null});assert.equal(image.status,200);assert.deepEqual(image.body,png());assert.equal(image.headers.get('Content-Type'),'image/png');assert.equal(image.headers.get('X-Content-Type-Options'),'nosniff');assert.match(image.headers.get('Cache-Control'),/no-store/);
  const paused=await saveMenu(env,saved.body.state,uploaded.body.photo,{available:false});assert.equal(paused.status,200);assert.equal((await call(env,{path:publicUrl,user:null})).status,404);
  assert.equal((await call(env,{path:privateUrl})).status,200);
  const removed=await saveMenu(env,paused.body.state,null);assert.equal(removed.status,200);assert.equal((await call(env,{path:publicUrl,user:'merchant-a'})).status,404);
});

test('merchant ownership, same-origin writes and photo byte validation are enforced before blob writes',async()=>{
  const {env,files}=harness();
  assert.equal((await call(env,{path:'/api/copilot/media',bytes:png(),user:null})).status,401);
  assert.equal((await call(env,{path:'/api/copilot/media',bytes:png(),origin:'https://evil.test'})).status,403);
  assert.equal((await call(env,{path:'/api/copilot/media',bytes:png(),type:'image/webp'})).status,400);
  assert.equal((await call(env,{path:'/api/copilot/media',bytes:new Uint8Array(MAX_MENU_PHOTO_BYTES+1)})).status,413);assert.equal(files.size,0);
  const a=await call(env,{path:'/api/copilot/media',bytes:png()}),b=(await call(env,{user:'merchant-b'})).body.state;
  assert.equal((await saveMenu(env,b,a.body.photo,{user:'merchant-b'})).status,400);
  assert.equal((await call(env,{user:null,path:`/api/copilot/media/${b.publicKey}/${a.body.photo.id}`})).status,404);
  assert.equal((await saveMenu(env,a.body.state,{kind:'uploaded',id:'f'.repeat(32)})).status,400);
  assert.equal((await call(env)).body.state.revision,a.body.state.revision);
});

test('concurrent identical uploads deduplicate capacity and failed R2 writes can be retried safely',async()=>{
  const {env,files}=harness();await call(env);
  const results=await Promise.all([1,2].map(()=>call(env,{path:'/api/copilot/media',bytes:png()})));assert.deepEqual(results.map(result=>result.status),[200,200]);assert.deepEqual(results[0].body.photo,results[1].body.photo);assert.equal(files.size,1);
  const state=(await call(env)).body.state;assert.equal(state.mediaUploads.length,1);assert.equal(state.revision,1);
  const realPut=env.BUCKET.put;env.BUCKET.put=async()=>{throw Error('Interrupted storage write');};const failed=await call(env,{path:'/api/copilot/media',bytes:webp(),type:'image/webp'});assert.equal(failed.status,503);
  assert.equal((await call(env)).body.state.mediaUploads.length,2);env.BUCKET.put=realPut;
  const repaired=await call(env,{path:'/api/copilot/media',bytes:webp(),type:'image/webp'});assert.equal(repaired.status,200);assert.equal(repaired.body.state.mediaUploads.length,2);assert.equal(repaired.body.state.revision,2);assert.equal(files.size,2);
});

test('uploaded media capacity remains bounded even for unsaved drafts and stale menu writes remain guarded',async()=>{
  const {env,database,files}=harness(),initial=(await call(env)).body.state;
  const uploaded=await call(env,{path:'/api/copilot/media',bytes:png()});assert.equal((await saveMenu(env,initial,uploaded.body.photo)).status,409);
  const current=(await call(env)).body.state;current.mediaUploads=Array.from({length:80},(_,index)=>({id:index.toString(16).padStart(32,'0'),bytes:1,contentType:'image/png'}));
  database.prepare('UPDATE copilot_workspaces SET payload=? WHERE business_id=?').run(JSON.stringify(current),current.businessId);
  const denied=await call(env,{path:'/api/copilot/media',bytes:webp(),type:'image/webp'});assert.equal(denied.status,422);assert.equal(files.size,1);assert.equal((await call(env)).body.state.mediaUploads.length,80);
});
