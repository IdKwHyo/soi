import {handleApi} from './backend.mjs';
import {handleCopilot} from './copilot.mjs';
import {assets} from '../build/assets.mjs';

const COMMON={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const PAGES=new Map([['/','/index.html'],['/signin','/signin/index.html'],['/demo','/index.html'],['/versionc','/index.html'],['/versionc/demo','/index.html']]);
for(const language of ['', '/th'])for(const kind of ['privacy','terms'])PAGES.set(language+'/'+kind,language+'/'+kind+'/index.html');
const RETIRED_PAGES=new Map([['/versiona','/'],['/versiona/demo','/demo'],['/versionb','/'],['/versionb/demo','/demo']]);
for(const route of ['/copilot','/copilot/demo','/menu','/menu/demo'])PAGES.set(route,'/copilot/index.html');
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  const canonical=url.pathname.length>1?url.pathname.replace(/\/$/,''):url.pathname;
  if(RETIRED_PAGES.has(canonical)){
   if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...COMMON,Allow:'GET, HEAD'}});
   return new Response(null,{status:308,headers:{...COMMON,Location:RETIRED_PAGES.get(canonical)+url.search,'Cache-Control':'private, no-store'}});
  }
  if(PAGES.has(canonical)&&!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...COMMON,Allow:'GET, HEAD'}});
  if(PAGES.has(canonical)&&url.pathname!==canonical){
   url.pathname=canonical;
   return new Response(null,{status:308,headers:{...COMMON,Location:url.pathname+url.search,'Cache-Control':'private, no-store'}});
  }
  if(url.pathname==='/api/copilot'||url.pathname.startsWith('/api/copilot/'))return handleCopilot(request,env);
  if(url.pathname.startsWith('/api/'))return handleApi(request,env);
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...COMMON,Allow:'GET, HEAD'}});
  const pathname=PAGES.get(url.pathname)||url.pathname;
  const asset=assets[pathname];
  if(!asset)return new Response('Not found',{status:404,headers:COMMON});
  const headers={...COMMON,'Content-Type':asset.type,'Cache-Control':asset.type.startsWith('text/html')?'private, no-store':'public, max-age=3600'};
  if(request.method==='HEAD')return new Response(null,{headers});
  const binary=atob(asset.data),data=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)data[index]=binary.charCodeAt(index);
  return new Response(data,{headers});
 }
};
