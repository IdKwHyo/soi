import {build} from 'esbuild';
import {readFile,writeFile,mkdir,rm,copyFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {prepareOcrAssets} from './prepare-ocr-assets.mjs';
import {renderLegalFooter} from './legal-footer.mjs';
import {renderLegalPage} from './legal-pages.mjs';

const root=process.cwd();const target=path.join(root,'build');
await rm(target,{recursive:true,force:true});await mkdir(path.join(target,'client/fonts'),{recursive:true});
await mkdir(path.join(target,'client/ocr'),{recursive:true});await mkdir(path.join(target,'server'),{recursive:true});
await build({entryPoints:{app:'dist/versionc/app.mjs','copilot/app':'dist/copilot/app.mjs','signin/app':'dist/signin/app.mjs','legal/app':'dist/legal/app.mjs'},bundle:true,format:'esm',splitting:true,minify:true,target:['es2022'],outdir:path.join(target,'client'),chunkNames:'chunks/[name]-[hash]',entryNames:'[dir]/[name]',legalComments:'eof',metafile:true}).then(async r=>writeFile(path.join(target,'browser-meta.json'),JSON.stringify(r.metafile)));
const revision=async file=>createHash('sha256').update(await readFile(file)).digest('hex').slice(0,12);
const legalScriptRevision=await revision(path.join(target,'client/legal/app.js'));
const legalStyleRevision=await revision('dist/legal/style.css');
await copyFile('dist/legal/style.css',path.join(target,'client/legal/style.css'));
function withLegal(markup,language='en'){
 const footer=renderLegalFooter(language);
 markup=markup.replace('</head>',`<link rel="stylesheet" href="/legal/style.css?v=${legalStyleRevision}"><script type="module" src="/legal/app.js?v=${legalScriptRevision}"></script></head>`);
 if(markup.includes('class="workspace-footer"'))return markup.replace('</footer>\n    </div>',`</footer>${footer}\n    </div>`);
 return markup.replace('</body>',footer+'</body>');
}
const appRevision=await revision(path.join(target,'client/app.js'));
const styleRevision=await revision('dist/style.css');
const compareRevision=await revision('dist/compare.css');
const flowRevision=await revision('dist/merchant-flow.css');
const presentationRevision=await revision('dist/presentation.css');
const versionCStyleRevision=await revision('dist/versionc/style.css');
const polishStyles=['panel-motion.css','premium-finish.css','copilot/dish-editor.css','copilot/receipt-story.css','signin/entry.css'];
const polishRevisions=Object.fromEntries(await Promise.all(polishStyles.map(async file=>[file,await revision('dist/'+file)])));
const versionPolishStyles=markup=>polishStyles.reduce((result,file)=>result.replace('href="/'+file+'"','href="/'+file+'?v='+polishRevisions[file]+'"'),markup);
for(const file of polishStyles)await copyFile('dist/'+file,path.join(target,'client',file));
const entryGuardRevision=await revision('dist/signin/entry-guard.js');
await copyFile('dist/signin/entry-guard.js',path.join(target,'client/signin/entry-guard.js'));
let html=await readFile('dist/versionc/index.html','utf8');
html=html.replace('src="/signin/entry-guard.js"',`src="/signin/entry-guard.js?v=${entryGuardRevision}"`);
html=html.replace('src="./app.mjs"',`src="/app.js?v=${appRevision}"`).replace('href="/style.css"',`href="/style.css?v=${styleRevision}"`).replace('href="./style.css"',`href="/versionc/style.css?v=${versionCStyleRevision}"`);
html=html.replace('href="/compare.css"',`href="/compare.css?v=${compareRevision}"`);
html=html.replace('href="/merchant-flow.css"',`href="/merchant-flow.css?v=${flowRevision}"`).replace('href="/presentation.css"',`href="/presentation.css?v=${presentationRevision}"`);
html=versionPolishStyles(html);
html=withLegal(html);
await writeFile(path.join(target,'client/index.html'),html);
await mkdir(path.join(target,'client/versionc'),{recursive:true});
await writeFile(path.join(target,'client/versionc/index.html'),html);
await copyFile('dist/versionc/style.css',path.join(target,'client/versionc/style.css'));
await copyFile('dist/style.css',path.join(target,'client/style.css'));
await copyFile('dist/compare.css',path.join(target,'client/compare.css'));
await copyFile('dist/merchant-flow.css',path.join(target,'client/merchant-flow.css'));
await copyFile('dist/presentation.css',path.join(target,'client/presentation.css'));
const copilotRevision=await revision(path.join(target,'client/copilot/app.js'));
const copilotStyleRevision=await revision('dist/copilot/style.css');
const aiStyleRevision=await revision('dist/copilot/ai-style.css');
const menuStyleRevision=await revision('dist/copilot/menu-style.css');
let copilotHtml=await readFile('dist/copilot/index.html','utf8');
copilotHtml=copilotHtml.replace('src="./app.mjs"',`src="/copilot/app.js?v=${copilotRevision}"`).replace('href="./style.css"',`href="/copilot/style.css?v=${copilotStyleRevision}"`);
copilotHtml=copilotHtml.replace('href="./ai-style.css"',`href="/copilot/ai-style.css?v=${aiStyleRevision}"`);
copilotHtml=copilotHtml.replace('href="./menu-style.css"',`href="/copilot/menu-style.css?v=${menuStyleRevision}"`);
copilotHtml=versionPolishStyles(copilotHtml);
copilotHtml=withLegal(copilotHtml);
await writeFile(path.join(target,'client/copilot/index.html'),copilotHtml);
await copyFile('dist/copilot/menu-style.css',path.join(target,'client/copilot/menu-style.css'));
await copyFile('dist/copilot/ai-style.css',path.join(target,'client/copilot/ai-style.css'));
await copyFile('dist/copilot/style.css',path.join(target,'client/copilot/style.css'));
const signinRevision=await revision(path.join(target,'client/signin/app.js'));
const signinStyleRevision=await revision('dist/signin/style.css');
let signinHtml=await readFile('dist/signin/index.html','utf8');
signinHtml=signinHtml.replace('src="./app.mjs"',`src="/signin/app.js?v=${signinRevision}"`).replace('href="./style.css"',`href="/signin/style.css?v=${signinStyleRevision}"`);
signinHtml=withLegal(signinHtml);
await writeFile(path.join(target,'client/signin/index.html'),signinHtml);
await copyFile('dist/signin/style.css',path.join(target,'client/signin/style.css'));
for(const language of ['en','th'])for(const kind of ['privacy','terms']){
 const directory=path.join(target,'client',language==='th'?'th':'',kind);
 await mkdir(directory,{recursive:true});
 await writeFile(path.join(directory,'index.html'),withLegal(renderLegalPage(kind,language),language));
}


await mkdir(path.join(target,'client/samples'),{recursive:true});
await copyFile('dist/samples/receipt.png',path.join(target,'client/samples/receipt.png'));
await mkdir(path.join(target,'client/images'),{recursive:true});
await copyFile('dist/images/sky.webp',path.join(target,'client/images/sky.webp'));
await copyFile('dist/images/horizon.webp',path.join(target,'client/images/horizon.webp'));
await copyFile('dist/images/studio-window.webp',path.join(target,'client/images/studio-window.webp'));
await copyFile('dist/images/signin-mountains.webp',path.join(target,'client/images/signin-mountains.webp'));
await mkdir(path.join(target,'client/images/menu'),{recursive:true});
for(const name of (await readdir('dist/images/menu')).filter(name=>name.endsWith('.webp')))await copyFile(path.join('dist/images/menu',name),path.join(target,'client/images/menu',name));
const fonts={
 'manrope.woff2':'node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2',
 'fraunces.woff2':'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2',
 'ibm-plex-sans-thai.woff2':'node_modules/@fontsource/ibm-plex-sans-thai/files/ibm-plex-sans-thai-thai-400-normal.woff2'
};
for(const [name,source] of Object.entries(fonts))await copyFile(source,path.join(target,'client/fonts',name));
await prepareOcrAssets(root,path.join(target,'client/ocr'));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.txt':'text/plain; charset=utf-8','.wasm':'application/wasm','.gz':'application/gzip','.json':'application/json; charset=utf-8'};
const assets={};
async function collect(dir,prefix=''){
 for(const item of await readdir(dir,{withFileTypes:true})){
  const relative=prefix+'/'+item.name;const location=path.join(dir,item.name);
  if(item.isDirectory()){await collect(location,relative);continue;}
  const bytes=await readFile(location);const type=types[path.extname(item.name)]||'application/octet-stream';
  // Serve original bytes; the hosting layer negotiates HTTP compression.
  // Pre-gzipped bodies with automatic Worker encoding are compressed twice.
  assets[relative]={data:bytes.toString('base64'),type,bytes:bytes.length};
 }
}
await collect(path.join(target,'client'));
await writeFile(path.join(target,'assets.mjs'),'export const assets='+JSON.stringify(assets)+';\n');
await build({entryPoints:['worker/index.mjs'],bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',outfile:path.join(target,'server/index.js'),legalComments:'eof'});
const workerBytes=await readFile(path.join(target,'server/index.js'));
const compressedWorkerBytes=gzipSync(workerBytes).length;
if(compressedWorkerBytes>10*1024*1024)throw Error('The Sites Worker exceeds the 10 MiB compressed budget ('+compressedWorkerBytes+' bytes). Reduce bundled assets before publishing.');
await mkdir(path.join(target,'.openai/drizzle/meta'),{recursive:true});
const manifestFile=path.join(root,'.openai/hosting.json');
try{await copyFile(manifestFile,path.join(target,'.openai/hosting.json'));}catch{
 await writeFile(path.join(target,'.openai/hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'}));
}
const migrationFiles=(await readdir(path.join(root,'migrations'))).filter(name=>/^\d+_[\w-]+\.sql$/.test(name)).sort();
if(!migrationFiles.length)throw Error('No source SQL migrations were found.');
const migrationEntries=[];
const migrationTimes={'0000_initial':1791777600000,'0001_advisor_records':1791787200000,'0002_copilot':1791993600000};
for(const [idx,name] of migrationFiles.entries()){
 const tag=name.slice(0,-4);
 const source=await readFile(path.join(root,'migrations',name),'utf8');
 const migration=(source.includes('--> statement-breakpoint')?source:source.replaceAll(';\n',';\n--> statement-breakpoint\n')).replace(/--> statement-breakpoint\s*$/,'');
 await writeFile(path.join(target,'.openai/drizzle',name),migration);
 migrationEntries.push({idx,version:'6',when:migrationTimes[tag]??1791777600000+idx*9600000,tag,breakpoints:true});
}
await writeFile(path.join(target,'.openai/drizzle/meta/_journal.json'),JSON.stringify({version:'7',dialect:'sqlite',entries:migrationEntries},null,2));
const sizes=Object.entries(assets).map(([url,v])=>({url,bytes:v.bytes,transferredBytes:Buffer.from(v.data,'base64').length}));
await writeFile(path.join(target,'asset-sizes.json'),JSON.stringify(sizes,null,2));
// The Sites packager recognizes dist/server; source frontend files stay alongside it.
await mkdir(path.join(root,'dist/server'),{recursive:true});
await rm(path.join(root,'dist/.openai/drizzle'),{recursive:true,force:true});
await mkdir(path.join(root,'dist/.openai/drizzle/meta'),{recursive:true});
await copyFile(path.join(target,'server/index.js'),path.join(root,'dist/server/index.js'));
await copyFile(path.join(target,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
for(const name of migrationFiles)await copyFile(path.join(target,'.openai/drizzle',name),path.join(root,'dist/.openai/drizzle',name));
await copyFile(path.join(target,'.openai/drizzle/meta/_journal.json'),path.join(root,'dist/.openai/drizzle/meta/_journal.json'));
console.log('Built browser modules and self-contained Sites Worker ('+sizes.length+' assets; '+compressedWorkerBytes+' bytes gzip).');
