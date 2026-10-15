import {normalizeAssistantState,validateAssistantState} from './advisor.mjs';
import {normalizeMerchantFlow,validateMerchantFlow} from './merchant-flow.mjs';
import {sampleMenus,DEFAULT_PERIOD,MAX_CSV_BYTES,validateMenus,parseCsv,analyze,project,evaluate,createDrafts,toCents} from './core.mjs';

const clone=value=>structuredClone(value);
function freezeSnapshot(value) {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)) {
    for(const child of Object.values(value))freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}
const timestamp=()=>new Date().toISOString();
const identifier=prefix=>`${prefix}_${crypto.randomUUID()}`;
const bump=state=>{state.revision+=1;};
const encoder=new TextEncoder();
function currentDataset(state) {
  const dataset=state.datasets.find(item=>item.id===state.activeDatasetId);
  if(!dataset)throw Error('Choose an active dataset first.');
  return dataset;
}
export function validateBusiness(business) {
  if(!business||typeof business.name!=='string'||!business.name.trim()||business.name.length>120)throw Error('Enter a business name of up to 120 characters.');
  for(const field of ['type','audience','tone'])if(typeof business[field]!=='string'||!business[field].trim()||business[field].length>500)throw Error(`Enter a valid ${field}.`);
  if(!['en','th'].includes(business.language))throw Error('Choose English or Thai.');
  if(!Number.isFinite(business.budget)||business.budget<0||business.budget>1_000_000)throw Error('Use a valid campaign budget.');
  toCents(business.budget);
  if(!Number.isSafeInteger(business.capacity)||business.capacity<0||business.capacity>100_000)throw Error('Additional campaign capacity must be a non-negative whole number.');
  return business;
}

export function createWorkspace() {
  const dataset=freezeSnapshot({id:identifier('dataset'),name:'Soi Kitchen · sample fortnight',menus:clone(sampleMenus),period:{...DEFAULT_PERIOD},sourceType:'synthetic',createdAt:timestamp()});
  const state={schemaVersion:2,id:identifier('workspace'),revision:0,
    business:{name:'Soi Kitchen',type:'Restaurant',audience:'Nearby office workers',tone:'Warm',budget:600,capacity:80,language:'en'},
    activeDatasetId:dataset.id,datasets:[dataset],imports:[],memories:[],runs:[],campaigns:[],results:[],messages:[],receipts:[],receiptUploads:[],selectedCandidateId:null};
  saveMemory(state,{key:'lunch audience',value:'Nearby office workers looking for a convenient weekday lunch.',source:'Synthetic demo business brief'});
  saveMemory(state,{key:'capacity',value:'Up to 80 additional orders during a campaign week.',source:'Synthetic demo business brief'});
  saveMemory(state,{key:'voice',value:'Warm, clear wording. Avoid unsupported claims and invented customer testimonials.',source:'Synthetic demo business brief'});
  normalizeMerchantFlow(state);
  state.revision=0;
  return state;
}

export function validateWorkspace(state) {
  if(!state||state.schemaVersion!==2||!Number.isSafeInteger(state.revision)||state.revision<0)throw Error('This workspace version is not supported.');
  validateBusiness(state.business);
  normalizeAssistantState(state);
  validateAssistantState(state);
  for(const field of ['datasets','imports','memories','runs','campaigns','results'])if(!Array.isArray(state[field])||state[field].length>500)throw Error(`The workspace ${field} history is invalid or too large.`);
  if(!state.datasets.length)throw Error('The workspace needs at least one dataset.');
  const ids=new Set();
  for(const dataset of state.datasets) {
    if(typeof dataset.id!=='string'||ids.has(dataset.id))throw Error('Dataset identifiers must be unique.');
    ids.add(dataset.id);
    if(typeof dataset.name!=='string'||!['synthetic','csv','manual'].includes(dataset.sourceType))throw Error('Dataset metadata is invalid.');
    analyze(dataset.menus,dataset.period);
    freezeSnapshot(dataset);
  }
  if(!ids.has(state.activeDatasetId))throw Error('The active dataset is missing.');
  for(const item of state.imports)if(!ids.has(item.datasetId)||item.status!=='committed'||typeof item.hash!=='string')throw Error('Import history is invalid.');
  const memoryIds=new Set(),confirmedKeys=new Set();
  for(const memory of state.memories) {
    if(typeof memory.id!=='string'||memoryIds.has(memory.id)||typeof memory.key!=='string'||!memory.key.trim()||memory.key.length>100||typeof memory.value!=='string'||!memory.value.trim()||memory.value.length>2000||!['confirmed','superseded'].includes(memory.status)||typeof memory.source!=='string'||!memory.source.trim()||memory.source.length>500||typeof memory.updatedAt!=='string')throw Error('Memory history is invalid.');
    memoryIds.add(memory.id);
    if(memory.status==='confirmed') {
      const key=normalize(memory.key);
      if(confirmedKeys.has(key))throw Error('A memory key has conflicting current values.');
      confirmedKeys.add(key);
    }
  }
  for(const run of state.runs) {
    if(!ids.has(run.datasetId)||!Array.isArray(run.candidates))throw Error('A strategy run is missing its dataset.');
    for(const candidate of run.candidates)if(candidate.datasetId!==run.datasetId)throw Error('A strategy candidate has inconsistent dataset provenance.');
  }
  for(const result of state.results)if(!ids.has(result.datasetId))throw Error('A result is missing its original dataset.');
  normalizeMerchantFlow(state);
  validateMerchantFlow(state);
  return state;
}

async function sha256(bytes) {
  if(!crypto.subtle)throw Error('Secure file hashing is unavailable. Use HTTPS or a local development server.');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function encodeBase64(bytes) {
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=16_384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16_384));
  return btoa(binary);
}
function decodeBase64(text) {
  if(typeof text!=='string'||text.length>MAX_CSV_BYTES*2)throw Error('The compressed archive is too large.');
  let binary;
  try{binary=atob(text);}catch{throw Error('The archive encoding is invalid.');}
  return Uint8Array.from(binary,char=>char.charCodeAt(0));
}
async function archiveText(text) {
  if(typeof CompressionStream==='undefined')return null;
  const bytes=encoder.encode(text);
  const gzip=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return {encoding:'gzip-base64',data:encodeBase64(gzip),sha256:await sha256(bytes),rawBytes:bytes.length,gzipBytes:gzip.length};
}
export async function restoreArchive(archive) {
  if(archive?.encoding!=='gzip-base64'||!Number.isSafeInteger(archive.rawBytes)||archive.rawBytes<0||archive.rawBytes>MAX_CSV_BYTES||typeof archive.sha256!=='string'||!/^[a-f0-9]{64}$/.test(archive.sha256))throw Error('Archive metadata is invalid.');
  if(typeof DecompressionStream==='undefined')throw Error('This browser cannot decompress the archive.');
  const compressed=decodeBase64(archive.data);
  if(compressed.length>MAX_CSV_BYTES+1024)throw Error('The compressed archive is too large.');
  const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.length;
      if(size>MAX_CSV_BYTES||size>archive.rawBytes){await reader.cancel();throw Error('The decompressed archive exceeds its size limit.');}
      chunks.push(value);
    }
  } catch(error){throw Error(`Archive restore failed: ${error.message}`);}
  if(size!==archive.rawBytes)throw Error('The archive size does not match its original.');
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(await sha256(bytes)!==archive.sha256)throw Error('The archive integrity check failed.');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

export async function importDataset(state,{text,name='Uploaded sales report',period=DEFAULT_PERIOD,sourceType='csv'}) {
  validateWorkspace(state);
  if(sourceType!=='csv')throw Error('This importer currently supports CSV reports.');
  if(typeof name!=='string'||!name.trim()||name.length>200)throw Error('Enter a report name of up to 200 characters.');
  const revision=state.revision;
  const reportingPeriod={start:period?.start,end:period?.end};
  const menus=parseCsv(text);
  analyze(menus,reportingPeriod);
  const hash=await sha256(encoder.encode(JSON.stringify({text,period:reportingPeriod,sourceType})));
  if(state.revision!==revision)throw Error('The workspace changed while this report was being prepared. Retry the import.');
  const previous=state.imports.find(item=>item.hash===hash);
  if(previous)return {status:'duplicate',dataset:state.datasets.find(item=>item.id===previous.datasetId),import:previous};
  if(state.datasets.length>=500||state.imports.length>=500)throw Error('Export your workspace before adding more history.');
  const rawGzip=await archiveText(text);
  if(state.revision!==revision)throw Error('The workspace changed while this report was being prepared. Retry the import.');
  const dataset=freezeSnapshot({id:identifier('dataset'),name:name.trim(),menus:clone(menus),period:reportingPeriod,sourceType,createdAt:timestamp()});
  const imported={id:identifier('import'),name:name.trim(),hash,datasetId:dataset.id,status:'committed',createdAt:timestamp(),rawGzip};
  state.datasets.push(dataset);state.imports.push(imported);state.activeDatasetId=dataset.id;state.selectedCandidateId=null;bump(state);
  return {status:'committed',dataset,import:imported};
}

export function commitManualDataset(state,menus,period=DEFAULT_PERIOD) {
  validateWorkspace(state);analyze(menus,period);
  if(state.datasets.length>=500)throw Error('Export your workspace before adding more history.');
  const dataset=freezeSnapshot({id:identifier('dataset'),name:`Menu update · version ${state.datasets.length+1}`,menus:clone(menus),period:{start:period.start,end:period.end},sourceType:'manual',createdAt:timestamp()});
  state.datasets.push(dataset);state.activeDatasetId=dataset.id;state.selectedCandidateId=null;bump(state);
  return dataset;
}
function normalize(value){return value.normalize('NFC').trim().toLocaleLowerCase();}
function tokens(value) {
  const normalized=normalize(value);
  if(typeof Intl.Segmenter==='function')return new Set([...new Intl.Segmenter('th',{granularity:'word'}).segment(normalized)].filter(part=>part.isWordLike).map(part=>part.segment));
  return new Set(normalized.match(/[\p{L}\p{N}]+/gu)||[]);
}
export function saveMemory(state,{key,value,source}) {
  if(!Array.isArray(state.memories)||!Number.isSafeInteger(state.revision))throw Error('Memory workspace is invalid.');
  if(typeof key!=='string'||!key.trim()||key.length>100)throw Error('Use a memory key of up to 100 characters.');
  if(typeof value!=='string'||!value.trim()||value.length>2000)throw Error('Enter a confirmed memory value of up to 2,000 characters.');
  if(typeof source!=='string'||!source.trim()||source.length>500)throw Error('Every memory needs a named source.');
  if(state.memories.length>=500)throw Error('Export your memories before adding more history.');
  const comparable=normalize(key);
  for(const memory of state.memories)if(memory.status==='confirmed'&&normalize(memory.key)===comparable)memory.status='superseded';
  const memory={id:identifier('memory'),key:key.trim(),value:value.trim(),source:source.trim(),status:'confirmed',updatedAt:timestamp()};
  state.memories.push(memory);bump(state);return memory;
}
export function retrieveMemory(state,query,limit=4) {
  if(typeof query!=='string')throw Error('Memory search needs text.');
  if(!Number.isSafeInteger(limit)||limit<1||limit>5)throw Error('Retrieve between one and five memories.');
  const queryTokens=tokens(query);
  return state.memories.filter(memory=>memory.status==='confirmed').map(memory=>{
    const memoryTokens=tokens(`${memory.key} ${memory.value}`);
    const overlap=[...queryTokens].filter(token=>memoryTokens.has(token)).length;
    const score=queryTokens.size&&memoryTokens.size?overlap/Math.sqrt(queryTokens.size*memoryTokens.size):0;
    return {...clone(memory),retrievalScore:score,retrievalMode:'keyword'};
  }).sort((a,b)=>b.retrievalScore-a.retrievalScore||b.updatedAt.localeCompare(a.updatedAt)).slice(0,limit);
}

export function buildCandidates(state,language=state.business.language||'en') {
  validateWorkspace(state);
  if(!['en','th'].includes(language))throw Error('Choose English or Thai.');
  const dataset=currentDataset(state),analysis=analyze(dataset.menus,dataset.period);
  const menu=dataset.menus.find(item=>item.name===analysis.recommended);
  if(!menu)throw Error('No menu has positive contribution. Confirm costs or revise the menu before planning a campaign.');
  if(state.runs.length>=500)throw Error('Export your workspace before adding more runs.');
  const context=retrieveMemory(state,'weekday lunch audience capacity voice campaign',4);
  const strategies=language==='th'?[
    {kind:'discount',title:'โปรโมชันมื้อกลางวัน',summary:'ทดลองส่วนลด 10% เพื่อเพิ่มยอดขายมื้อกลางวันวันธรรมดา',discount:10,extraOrders:40,existingOrders:20},
    {kind:'value',title:'เน้นความคุ้มค่าโดยไม่ลดราคา',summary:'นำเสนอเมนูและความสะดวกในมื้อกลางวันโดยคงราคาเดิม',discount:0,extraOrders:30,existingOrders:20}
  ]:[
    {kind:'discount',title:'Weekday lunch offer',summary:'Test a 10% offer for weekday lunch. Additional orders are an assumption to verify.',discount:10,extraOrders:40,existingOrders:20},
    {kind:'value',title:'Value at the regular price',summary:'Feature a convenient weekday lunch without a discount. Additional orders are an assumption to verify.',discount:0,extraOrders:30,existingOrders:20}
  ];
  const candidates=strategies.map(strategy=>({id:identifier('candidate'),...strategy,menu:clone(menu),budget:state.business.budget,datasetId:dataset.id,
    language,source:'local-rule-demo',status:'draft',assumptions:['Additional and existing offer orders are illustrative assumptions, not forecasts.','One menu item represents one sold order.','Excludes fixed overhead, tax and additional labour.','Additional campaign capacity applies to the whole campaign week.'],
    memoryIds:context.map(memory=>memory.id),drafts:createDrafts(state.business,menu,{...strategy,budget:state.business.budget},language)}));
  const evaluated=evaluateCandidates(state,candidates);
  state.runs.push({id:identifier('run'),datasetId:dataset.id,createdAt:timestamp(),source:'local-rule-demo',memoryIds:context.map(memory=>memory.id),candidates:evaluated});
  state.selectedCandidateId=null;bump(state);return evaluated;
}

export function evaluateCandidates(state,candidates) {
  validateBusiness(state.business);
  if(!Array.isArray(candidates)||!candidates.length||candidates.length>10)throw Error('Compare between one and ten candidate strategies.');
  return candidates.map(candidate=>{
    const dataset=state.datasets.find(item=>item.id===candidate.datasetId);
    const menu=dataset?.menus.find(item=>item.name===candidate.menu?.name);
    let projection=null,error=null;
    try {if(!menu)throw Error('The candidate source menu is missing.');projection=project(menu,candidate);}catch(caught){error=caught.message;}
    const checks=[
      {key:'source',label:'Source dataset and menu are available',passed:Boolean(menu),detail:dataset?.name||'Missing source'},
      {key:'current',label:'Uses the active dataset version',passed:candidate.datasetId===state.activeDatasetId,detail:candidate.datasetId===state.activeDatasetId?'Current version':'Historical candidate; regenerate to approve'},
      {key:'inputs',label:'Campaign inputs are valid',passed:!error,detail:error||'Valid decimal money and whole order counts'},
      {key:'budget',label:'Spend fits the business budget',passed:!error&&toCents(candidate.budget)<=toCents(state.business.budget),detail:`Declared budget: THB ${state.business.budget.toFixed(2)}`},
      {key:'capacity',label:'Additional orders fit campaign capacity',passed:!error&&candidate.extraOrders<=state.business.capacity,detail:`Up to ${state.business.capacity} additional orders per campaign week`},
      {key:'margin',label:'Offer contribution remains positive',passed:Boolean(projection&&projection.offerCents>0),detail:projection?`THB ${projection.offer.toFixed(2)} per sold item`:'Cannot calculate'},
      {key:'breakEven',label:'Assumed additional orders cover campaign cost',passed:Boolean(projection&&projection.netCents>=0),detail:projection?.breakEven===null?'No positive offer contribution':`${projection?.breakEven??'Unknown'} additional orders to break even`}
    ];
    const score=Math.round(checks.filter(check=>check.passed).length/checks.length*100);
    const approvable=checks.every(check=>check.passed);
    return {...clone(candidate),menu:clone(menu||candidate.menu),projection,checks,score,approvable,status:candidate.status||'draft',
      scoreLabel:'Constraint checks passed; not predicted effectiveness',reasons:checks.filter(check=>!check.passed).map(check=>`${check.label}: ${check.detail}`)};
  });
}

export function recordResult(state,{candidateId,totalOrders,baselineOrders,spend}) {
  validateWorkspace(state);
  if(state.results.length>=500)throw Error('Export your workspace before adding more results.');
  const campaign=state.campaigns.find(item=>item.id===candidateId||item.candidateId===candidateId);
  const candidate=campaign?.candidate||campaign||state.runs.flatMap(run=>run.candidates).find(item=>item.id===candidateId);
  if(!candidate)throw Error('Choose an existing campaign candidate.');
  const dataset=state.datasets.find(item=>item.id===candidate.datasetId),menu=dataset?.menus.find(item=>item.name===candidate.menu?.name);
  if(!menu)throw Error('The original campaign dataset is missing.');
  const actual={totalOrders,baselineOrders,spend},evaluation=evaluate(menu,candidate,actual);
  const result={id:identifier('result'),candidateId,datasetId:dataset.id,datasetName:dataset.name,menu:clone(menu),plan:{discount:candidate.discount,extraOrders:candidate.extraOrders,existingOrders:candidate.existingOrders,budget:candidate.budget},
    actual,evaluation,...evaluation,createdAt:timestamp(),interpretation:'Estimated incremental contribution using an owner-supplied baseline. This is not a causal A/B experiment.'};
  state.results.push(result);bump(state);return result;
}
export function exportMemoryMarkdown(state) {
  const escape=value=>String(value).replace(/[\r\n]+/g,' ').replaceAll('|','\\|');
  return `# ${escape(state.business.name)} — business memory\n\nExported ${timestamp()}. Confirmed merchant facts remain separate from AI suggestions.\n\n`+
    state.memories.map(memory=>`## ${escape(memory.key)}\n\n${memory.value}\n\n- Status: ${memory.status}\n- Source: ${escape(memory.source)}\n- Updated: ${memory.updatedAt}\n- ID: ${memory.id}\n`).join('\n');
}
