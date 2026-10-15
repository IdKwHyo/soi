import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const html=await readFile('dist/index.html','utf8');
assert.match(html,/<html[^>]*lang="en"/);
assert.match(html,/<meta[^>]*name="viewport"/);
assert.match(html,/<noscript>/);
assert.match(html,/aria-live/);
assert.match(html,/skip-link/);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(ids.length,new Set(ids).size,'Static IDs must be unique');
const css=await readFile('dist/style.css','utf8');
assert.match(css,/prefers-reduced-motion/);
assert.match(css,/focus-visible/);
assert.ok(!/transition\s*:\s*all\b/.test(css),'Transitions must name properties');
const sizes=JSON.parse(await readFile('build/asset-sizes.json','utf8'));
for(const asset of sizes){const limit=asset.url.startsWith('/ocr/')?4_000_000:2_000_000;assert.ok(asset.bytes<limit,asset.url+' exceeds asset budget');}
const worker=await import(pathToFileURL(path.resolve('build/server/index.js')));
assert.equal(typeof worker.default.fetch,'function');
const page=await worker.default.fetch(new Request('https://studio.test/'),{},{});
assert.equal(page.status,200);assert.match(page.headers.get('Content-Type'),/text\/html/);
assert.equal(page.headers.get('Content-Encoding'),null,'Application text must be served without precompressed HTTP bytes');
const markup=await page.text();
assert.match(markup,/^\s*<!doctype html>/i,'Browser must receive HTML after standard HTTP decoding');
assert.match(markup,/src="\/app\.js\?v=[a-f0-9]{12}"/);
assert.match(markup,/href="\/style\.css\?v=[a-f0-9]{12}"/);
assert.match(markup,/<body class="version-c"/,'The canonical app uses the retained C presentation');
assert.match(markup,/href="\/versionc\/style\.css\?v=[a-f0-9]{12}"/);
const unavailableBackend=new Proxy({},{get(){throw Error('Demo route touched a backend binding');}});
const demo=await worker.default.fetch(new Request('https://studio.test/demo'),unavailableBackend,{});
assert.equal(demo.status,200);assert.match(demo.headers.get('Content-Type'),/text\/html/);
assert.equal(demo.headers.get('Content-Encoding'),null);
assert.equal(await demo.text(),markup,'Demo must serve the complete app shell');
const demoHead=await worker.default.fetch(new Request('https://studio.test/demo',{method:'HEAD'}),unavailableBackend,{});
assert.equal(demoHead.status,200);assert.equal((await demoHead.arrayBuffer()).byteLength,0);
const demoSlash=await worker.default.fetch(new Request('https://studio.test/demo/?lang=th'),unavailableBackend,{});
assert.equal(demoSlash.status,308);assert.equal(demoSlash.headers.get('Location'),'/demo?lang=th');
assert.equal((await worker.default.fetch(new Request('https://studio.test/demo',{method:'POST'}),unavailableBackend,{})).status,405);
assert.equal((await worker.default.fetch(new Request('https://studio.test/demo/not-real'),unavailableBackend,{})).status,404);
for(const mode of ['', '/demo']){
 const route='/versionc'+mode;
 const response=await worker.default.fetch(new Request('https://studio.test'+route),unavailableBackend,{});
 assert.equal(response.status,200,route);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 const body=await response.text();
 assert.equal(body,markup,'C compatibility routes must serve the canonical app shell');
 const head=await worker.default.fetch(new Request('https://studio.test'+route,{method:'HEAD'}),unavailableBackend,{});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 const slash=await worker.default.fetch(new Request('https://studio.test'+route+'/?lang=th'),unavailableBackend,{});assert.equal(slash.status,308);assert.equal(slash.headers.get('Location'),route+'?lang=th');
 assert.equal((await worker.default.fetch(new Request('https://studio.test'+route,{method:'POST'}),unavailableBackend,{})).status,405);
 assert.equal((await worker.default.fetch(new Request('https://studio.test'+route+'/not-real'),unavailableBackend,{})).status,404);
}
for(const version of ['a','b'])for(const mode of ['', '/demo'])for(const slash of ['', '/']){
 const route='/version'+version+mode+slash,query='?lang=th&table=A%20B';
 const target=(mode||'/')+query;
 for(const method of ['GET','HEAD']){
  const response=await worker.default.fetch(new Request('https://studio.test'+route+query,{method}),unavailableBackend,{});
  assert.equal(response.status,308,route);assert.equal(response.headers.get('Location'),target,'Retired links preserve mode and query');
  assert.equal((await response.arrayBuffer()).byteLength,0,'Redirects do not serve retired UI');
 }
 assert.equal((await worker.default.fetch(new Request('https://studio.test'+route,{method:'POST'}),unavailableBackend,{})).status,405);
}
for(const route of ['/versiona/not-real','/versiona/demo/not-real','/versionb/not-real','/versionb/demo/not-real'])assert.equal((await worker.default.fetch(new Request('https://studio.test'+route),unavailableBackend,{})).status,404,route);
for(const asset of ['/versiona/app.js','/versiona/style.css','/versiona/index.html','/versionb/app.js','/versionb/style.css','/versionb/index.html','/versionc/app.js']){
 assert.ok(!sizes.some(item=>item.url===asset),'Retired or duplicate entry assets must not be bundled: '+asset);
 assert.equal((await worker.default.fetch(new Request('https://studio.test'+asset),unavailableBackend,{})).status,404,asset);
}
for(const asset of ['panel-motion.css','premium-finish.css'])assert.ok(markup.includes('/'+asset+'?v='),'Shared polish stylesheet must be versioned: '+asset);
let copilotMarkup;
for(const route of ['/copilot','/copilot/demo','/menu','/menu/demo']){
 const response=await worker.default.fetch(new Request('https://studio.test'+route),unavailableBackend,{});
 assert.equal(response.status,200,route); const body=await response.text();
 assert.match(body,/src="\/copilot\/app\.js\?v=[a-f0-9]{12}"/);
 assert.match(body,/href="\/copilot\/style\.css\?v=[a-f0-9]{12}"/);
 assert.match(body,/href="\/copilot\/menu-style\.css\?v=[a-f0-9]{12}"/);assert.match(body,/<dialog/);assert.match(body,/name="viewport"/);assert.match(body,/<noscript>/);
 for(const asset of ['panel-motion.css','premium-finish.css','copilot/dish-editor.css','copilot/receipt-story.css'])assert.ok(body.includes('/'+asset+'?v='),'Copilot polish stylesheet must be versioned: '+asset);
 if(copilotMarkup)assert.equal(body,copilotMarkup);copilotMarkup=body;
 const head=await worker.default.fetch(new Request('https://studio.test'+route,{method:'HEAD'}),unavailableBackend,{});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 const slash=await worker.default.fetch(new Request('https://studio.test'+route+'/?shop=demo&table=A'),unavailableBackend,{});assert.equal(slash.status,308);assert.equal(slash.headers.get('Location'),route+'?shop=demo&table=A');
 assert.equal((await worker.default.fetch(new Request('https://studio.test'+route,{method:'POST'}),unavailableBackend,{})).status,405);
}
const signinResponse=await worker.default.fetch(new Request('https://studio.test/signin'),unavailableBackend,{});
assert.equal(signinResponse.status,200);
const signinMarkup=await signinResponse.text();
assert.match(signinMarkup,/src="\/signin\/app\.js\?v=[a-f0-9]{12}"/);
assert.match(signinMarkup,/href="\/signin\/style\.css\?v=[a-f0-9]{12}"/);
assert.match(signinMarkup,/data-signin-enter/);assert.match(signinMarkup,/href="\/demo#overview"/);
const previewFields=[...signinMarkup.matchAll(/<input\b[^>]*>/g)].map(match=>match[0]);
assert.equal(previewFields.length,2);assert.match(previewFields[0],/type="text"/);assert.match(previewFields[1],/type="password"/);
for(const field of previewFields){assert.doesNotMatch(field,/\bname\s*=|\brequired\b/,'Preview inputs must never be serialized or validated as credentials');assert.match(field,/aria-describedby="signin-preview-note"/);}
assert.match(signinMarkup,/<form[^>]*action="\/demo#overview"[^>]*method="get"[^>]*autocomplete="off"/);
assert.match(signinMarkup,/No real sign-in needed/);
const signinIds=[...signinMarkup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(signinIds.length,new Set(signinIds).size);
assert.equal((await worker.default.fetch(new Request('https://studio.test/signin',{method:'HEAD'}),unavailableBackend,{})).status,200);
assert.equal((await worker.default.fetch(new Request('https://studio.test/signin',{method:'POST'}),unavailableBackend,{})).status,405);
const signinSlash=await worker.default.fetch(new Request('https://studio.test/signin/?lang=th'),unavailableBackend,{});assert.equal(signinSlash.status,308);assert.equal(signinSlash.headers.get('Location'),'/signin?lang=th');
assert.equal((await worker.default.fetch(new Request('https://studio.test/signin/not-real'),unavailableBackend,{})).status,404);
for(const body of [markup,copilotMarkup,signinMarkup]){
 assert.equal([...body.matchAll(/class="soi-legal-footer"/g)].length,1,'Every shell gets exactly one discreet legal footer');
 assert.match(body,/data-soi-legal="privacy" href="\/privacy"/);
 assert.match(body,/data-soi-legal="terms" href="\/terms"/);
 assert.match(body,/data-soi-legal="choices" href="\/privacy#choices"/);
 assert.match(body,/src="\/legal\/app\.js\?v=[a-f0-9]{12}"/);
 assert.match(body,/href="\/legal\/style\.css\?v=[a-f0-9]{12}"/);
}
for(const prefix of ['', '/th'])for(const kind of ['privacy','terms']){
 const route=prefix+'/'+kind;
 const response=await worker.default.fetch(new Request('https://studio.test'+route),unavailableBackend,{});
 assert.equal(response.status,200,route);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 const body=await response.text();
 assert.match(body,new RegExp('<html lang="'+(prefix?'th':'en')+'"'));
 assert.match(body,/<main id="legal-main"/);assert.match(body,/<h1>/);assert.match(body,/<h2>/);
 assert.equal([...body.matchAll(/class="soi-legal-footer"/g)].length,1);
 assert.ok(body.includes('href="'+prefix+'/privacy"'));assert.ok(body.includes('href="'+prefix+'/terms"'));
 assert.ok(body.includes(prefix?'ยังต้องยืนยัน':'still need to be confirmed')||kind==='terms','Privacy notice must retain candid operator/retention gaps');
 assert.doesNotMatch(body,/<script[^>]+src="https?:\/\//,'Legal pages have no eager third-party scripts');
 const allIds=[...body.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(allIds.length,new Set(allIds).size);
 const head=await worker.default.fetch(new Request('https://studio.test'+route,{method:'HEAD'}),unavailableBackend,{});
 assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 const slash=await worker.default.fetch(new Request('https://studio.test'+route+'/?review=1'),unavailableBackend,{});
 assert.equal(slash.status,308);assert.equal(slash.headers.get('Location'),route+'?review=1');
 assert.equal((await worker.default.fetch(new Request('https://studio.test'+route,{method:'POST'}),unavailableBackend,{})).status,405);
 assert.equal((await worker.default.fetch(new Request('https://studio.test'+route+'/not-real'),unavailableBackend,{})).status,404);
}
assert.match(markup,/src="\/signin\/entry-guard\.js\?v=[a-f0-9]{12}"/);
assert.match(markup,/href="\/signin\/entry\.css\?v=[a-f0-9]{12}"/);
const copilotCss=await readFile('dist/copilot/style.css','utf8');assert.match(copilotCss,/prefers-reduced-motion/);assert.match(copilotCss,/focus-visible/);
for(const source of ['dist/index.html','dist/versionc/index.html']){
 const body=await readFile(source,'utf8'),shellIds=[...body.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(shellIds.length,new Set(shellIds).size,source+' has duplicate IDs');assert.match(body,/id="edition-control"/);assert.match(body,/<noscript>/);
}
const versionCCss=await readFile('dist/versionc/style.css','utf8');assert.match(versionCCss,/prefers-reduced-motion/);assert.match(versionCCss,/focus-visible/);assert.ok(!/transition\s*:\s*all\b/.test(versionCCss));
for(const asset of ['/legal/app.js','/legal/style.css','/signin/app.js','/signin/style.css','/signin/entry-guard.js','/signin/entry.css','/images/signin-mountains.webp','/panel-motion.css','/premium-finish.css','/copilot/dish-editor.css','/copilot/receipt-story.css','/copilot/app.js','/copilot/style.css','/copilot/ai-style.css','/copilot/menu-style.css','/app.js','/style.css','/versionc/style.css','/compare.css','/merchant-flow.css','/presentation.css','/fonts/manrope.woff2','/fonts/fraunces.woff2','/fonts/ibm-plex-sans-thai.woff2','/ocr/worker.min.js','/samples/receipt.png','/images/sky.webp','/images/horizon.webp','/images/studio-window.webp',...['basil-chicken','chicken-rice','fried-rice','tom-yum','thai-tea','lime-soda'].map(id=>'/images/menu/'+id+'.webp')]){
 const response=await worker.default.fetch(new Request('https://studio.test'+asset),{},{});assert.equal(response.status,200,asset);
 assert.equal(response.headers.get('Content-Encoding'),null,asset+' must use hosting compression only');
 if(asset.endsWith('.js')||asset.endsWith('.css')){
  const body=Buffer.from(await response.arrayBuffer());
  assert.ok(!(body[0]===0x1f&&body[1]===0x8b),asset+' contains compressed bytes instead of source text');
  assert.ok(!body.toString('utf8').includes('\uFFFD'),asset+' must be valid UTF-8 source');
 }
}
assert.equal((await worker.default.fetch(new Request('https://studio.test/not-real'),{},{})).status,404);
assert.equal((await worker.default.fetch(new Request('https://studio.test/',{method:'POST'}),{},{})).status,405);
const health=await worker.default.fetch(new Request('https://studio.test/api/health'),{},{});assert.equal(health.status,200);
const text=await health.text();assert.ok(!text.includes('GEMINI_API_KEY'));
const bytes=(await stat('build/server/index.js')).size;
const ocrManifest=JSON.parse(await readFile('build/client/ocr/assets.json','utf8'));
assert.equal(ocrManifest.version,'7.0.0');assert.equal(ocrManifest.coreVersion,'7.0.0');
for(const asset of sizes.filter(item=>item.url.startsWith('/ocr/'))){
 const name=asset.url.slice('/ocr/'.length),local=await readFile('build/client/ocr/'+name);
 const entry={name,bytes:local.length,sha256:createHash('sha256').update(local).digest('hex')};
 const model=ocrManifest.models.find(item=>name===item.language+'.traineddata.gz');
 if(model){assert.equal(entry.bytes,model.bytes);assert.equal(entry.sha256,model.sha256,'Pinned '+model.language+' model');}
 const response=await worker.default.fetch(new Request('https://studio.test/ocr/'+entry.name),{},{});assert.equal(response.status,200,entry.name);
 assert.equal(response.headers.get('Content-Encoding'),null,entry.name+' must remain original file bytes');
 const body=Buffer.from(await response.arrayBuffer());assert.equal(body.length,entry.bytes,entry.name);
 assert.equal(createHash('sha256').update(body).digest('hex'),entry.sha256,entry.name+' hash');
 if(entry.name.endsWith('.wasm')){assert.equal(response.headers.get('Content-Type'),'application/wasm');assert.deepEqual([...body.subarray(0,4)],[0,97,115,109]);}
 if(entry.name.endsWith('.gz')){assert.equal(response.headers.get('Content-Type'),'application/gzip');assert.deepEqual([...body.subarray(0,2)],[31,139]);}
 const head=await worker.default.fetch(new Request('https://studio.test/ocr/'+entry.name,{method:'HEAD'}),{},{});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
}
const journal=JSON.parse(await readFile('build/.openai/drizzle/meta/_journal.json','utf8'));assert.deepEqual(journal.entries.map(item=>item.tag),['0000_initial','0001_advisor_records','0002_copilot']);
console.log('PASS: semantic shell, static asset paths, motion/focus rules, Worker requests, safe health flags; bundle '+bytes+' bytes.');
