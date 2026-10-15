import {createWorkspace,validateWorkspace,validateBusiness,importDataset,commitManualDataset,saveMemory,buildCandidates,evaluateCandidates,recordResult} from './data.mjs';
import {simulateReply,recordExchange,sampleReceiptDraft,parseReceipt,validateReceiptDraft,confirmReceipt} from './advisor.mjs';
import {ocr as realOcr,closeOcr as disposeOcr} from './ocr.mjs';
import {routeContext,editionPath} from './routes.mjs';
import {updateMerchantFlow,recordMerchantOutcome,loadMerchantDemo} from './merchant-flow.mjs';

const route=routeContext(globalThis.location?.pathname||'/');
const DEMO=route.demo;
const KEY=DEMO?'soi-studio-v2-demo':'soi-studio-v2-local';
let state=null;
let capabilities={storage:'local',model:DEMO?'simulated':'rules',advisor:DEMO?'simulated':'not-configured',memoryRetrieval:DEMO?'simulated':'not-configured',ocr:DEMO?'simulated':'browser',trainedLayer:false,auth:DEMO?'local':'chatgpt',demo:DEMO,signinPath:DEMO?null:'/signin-with-chatgpt?return_to='+encodeURIComponent(editionPath(route.version,false,''))};
let serial=Promise.resolve();
let uncertain=false;
const uploadedFiles=new WeakMap();
const receiptIds=new WeakMap();
const outcomeIds=new WeakMap();
const clone=value=>structuredClone(value);
function stableOutcomePayload(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.hasOwn(payload,'id'))return payload;
  let id=outcomeIds.get(payload);
  if(!id){id='flow_result_'+crypto.randomUUID();outcomeIds.set(payload,id);}
  return {...payload,id};
}
function loadLocal(){try{return validateWorkspace(JSON.parse(localStorage.getItem(KEY)));}catch{return createWorkspace();}}
function storeLocal(value){try{localStorage.setItem(KEY,JSON.stringify(value));}catch{throw Error('Browser storage is full or unavailable. Export your workspace before continuing.');}}
async function request(body,{signal}={}){
  if(DEMO)throw Error('The frontend demo does not send workspace requests.');
  const deadline=AbortSignal.timeout(body?.action==='chat'||body?.action==='candidates'?90000:25000);
  const combined=signal?AbortSignal.any([signal,deadline]):deadline;
  const response=await fetch('/api/workspace',{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:combined});
  let value;try{value=await response.json();}catch{throw Object.assign(Error('The workspace service returned an unreadable response.'),{status:response.status});}
  if(!response.ok)throw Object.assign(Error(value.error?.message||value.error||'The workspace request failed.'),{status:response.status,details:value});
  return value;
}
export async function loadWorkspace(){
  if(DEMO){state=loadLocal();return {state:clone(state),capabilities:clone(capabilities)};}
  try{
    const result=await request();
    if(result.state){state=validateWorkspace(result.state);capabilities={...capabilities,...result.capabilities};return {state:clone(state),capabilities:clone(capabilities)};}
    capabilities={...capabilities,...result.capabilities,storage:'local'};
  }catch(error){
    if(![401,404,503].includes(error.status)&&!(error instanceof TypeError)&&error.name!=='TimeoutError')throw error;
    capabilities={...capabilities,storage:'local',notice:error.status===401?'Sign in to save a private cloud workspace. You can explore the sample locally.':'The workspace service is unavailable. This sample is saved in this browser.'};
  }
  state=loadLocal();return {state:clone(state),capabilities:clone(capabilities)};
}
function findCandidate(next,id){return next.runs.flatMap(run=>run.candidates).find(candidate=>candidate.id===id);}
function contextKey(value){return JSON.stringify({business:value.business,dataset:value.activeDatasetId,merchantFlow:value.merchantFlow,memories:value.memories.filter(m=>m.status==='confirmed').map(m=>[m.id,m.key,m.value,m.source])});}
async function commitLocal(action,payload){
  const next=clone(state);const originalRevision=next.revision;
  let operation;
  if(action==='business'){
    next.business=validateBusiness({...next.business,...payload.business});next.selectedCandidateId=null;
  }else if(action==='import'){
    await importDataset(next,payload);
  }else if(action==='manual'){
    commitManualDataset(next,payload.menus,payload.period);
  }else if(action==='memory'){
    saveMemory(next,payload);next.selectedCandidateId=null;
  }else if(action==='merchant-flow'){
    operation=updateMerchantFlow(next,payload);
  }else if(action==='merchant-flow-sample'){
    if(!DEMO)throw Error('Illustrative channel reports belong in /demo. Assign your own sources in the full app.');
    operation=loadMerchantDemo(next);
  }else if(action==='flow-outcome'){
    if(!DEMO&&payload.source!==undefined&&payload.source!=='owner')throw Error('Simulated outcomes belong in /demo. Record owner-observed results here.');
    const outcome=recordMerchantOutcome(next,payload,{source:DEMO?'demo':'owner'}),alreadyRecorded=next.revision===originalRevision;
    operation={outcome,alreadyRecorded};
    if(alreadyRecorded)return {state:clone(state),capabilities:clone(capabilities),operation};
  }else if(action==='candidates'){
    if(payload.mode==='gemini')throw Error('Gemini requires a signed-in cloud workspace and a configured server key. Rule-based comparison is available now.');
    const language=payload.language||next.business.language;
    buildCandidates(next,language);const run=next.runs.at(-1);run.localContextKey=contextKey(next);
    if(DEMO){
      const example=simulateReply(next,{text:'Compare two weekday lunch campaigns',language});
      run.evaluation={...example.evaluation,summary:language==='th'?'ตัวอย่างการเปรียบเทียบหลักฐานและสมมติฐาน ไม่มีการเรียกโมเดลจริง':'Illustrative evidence and assumption comparison; no model was called.'};
      for(const candidate of run.candidates)candidate.evaluation={mode:'simulated',reason:language==='th'?'นี่คือตัวอย่างการประเมิน ส่วนตัวเลขและเงื่อนไขทางการเงินคำนวณจากข้อมูลในเดโม':'This is an example evaluation. Financial values and constraints are calculated from the demo records.',unsupportedClaims:[]};
    }
  }else if(action==='approve'){
    if(payload.reviewedCapacity!==true||payload.reviewedContent!==true)throw Error('Review campaign capacity and wording before approval.');
    const candidate=findCandidate(next,payload.candidateId);
    if(!candidate||candidate.datasetId!==next.activeDatasetId)throw Error('Generate a campaign from the current dataset before approval.');
    const run=next.runs.find(r=>r.candidates.some(c=>c.id===candidate.id));
    if(run.localContextKey!==contextKey(next))throw Error('Business facts changed. Generate a fresh comparison before approval.');
    if(next.campaigns.some(c=>c.candidateId===candidate.id))throw Error('This strategy is already approved.');
    const edited=clone(candidate);for(const key of ['discount','extraOrders','existingOrders','budget'])if(Object.hasOwn(payload.plan||{},key))edited[key]=payload.plan[key];
    const current=evaluateCandidates(next,[edited])[0];
    if(!current.approvable)throw Error('Resolve the campaign checks before approval.');
    const draftFields=payload.drafts||current.drafts;
    for(const key of ['social','message','announcement'])if(typeof draftFields?.[key]!=='string'||draftFields[key].length>10000)throw Error('Campaign copy is invalid.');
    const approved={...clone(current),drafts:clone(draftFields),status:'approved'};
    const campaign={...approved,id:crypto.randomUUID(),candidateId:candidate.id,datasetId:candidate.datasetId,approvedAt:new Date().toISOString()};
    next.campaigns.push(campaign);next.selectedCandidateId=candidate.id;
  }else if(action==='results'){
    if(!next.campaigns.some(c=>c.candidateId===payload.candidateId||c.id===payload.candidateId))throw Error('Approve a campaign before recording its results.');
    recordResult(next,payload);
  }else if(action==='chat'){
    if(!DEMO)throw Error('The live Advisor requires a connected private workspace and Gemini. Open /demo for simulated replies.');
    const response=simulateReply(next,payload);recordExchange(next,{question:payload.text,response,language:payload.language||next.business.language,mode:'simulated'});operation={response};
  }else if(action==='receipt'){
    if(!DEMO)throw Error('Connect the private workspace before saving a receipt.');
    operation={receipt:confirmReceipt(next,payload)};
  }else if(action==='chat-clear'){
    if(!DEMO)throw Error('Connect the private workspace before changing chat history.');
    next.messages=[];
  }else if(action==='reset'){
    state=createWorkspace();state.revision=originalRevision+1;storeLocal(state);return {state:clone(state),capabilities:clone(capabilities)};
  }else throw Error('This workspace action is not supported.');
  next.revision=originalRevision+1;validateWorkspace(next);storeLocal(next);state=next;
  return {state:clone(state),capabilities:clone(capabilities),...(operation?{operation}:{})};
}
async function performCommit(action,payload={},options={}){
    if(action==='merchant-flow-sample'&&!DEMO)throw Error('Illustrative channel reports belong in /demo. Assign your own sources in the full app.');
    if(action==='flow-outcome')payload=stableOutcomePayload(payload);
    if(!state)await loadWorkspace();
    if(options.signal?.aborted)throw new DOMException('Operation cancelled.','AbortError');
    if(DEMO||capabilities.storage==='local')return commitLocal(action,payload);
    if(uncertain){const latest=await request();state=validateWorkspace(latest.state);capabilities={...capabilities,...latest.capabilities};uncertain=false;}
    let result;
    try{result=await request({action,payload:action==='business'?(payload.business||payload):payload,expectedRevision:state.revision},options);}
    catch(error){if(error.name==='AbortError'||error.name==='TimeoutError'||error instanceof TypeError||(action==='flow-outcome'&&(error.status>=500||error.status>=200&&error.status<300)))uncertain=true;throw error;}
    state=validateWorkspace(result.state);capabilities={...capabilities,...result.capabilities};
    return {state:clone(state),capabilities:clone(capabilities),operation:result.operation};
}
function enqueue(work){
  const operation=serial.then(work);
  serial=operation.catch(()=>{});return operation;
}
export function commit(action,payload={},options={}){return enqueue(()=>performCommit(action,payload,options));}

export async function askAdvisor({text,language,signal}){
  if(!state)await loadWorkspace();
  if(!DEMO&&(capabilities.storage!=='cloud'||capabilities.advisor!=='gemini'))throw Error('The live Advisor is not connected yet. Configure Gemini and private workspace access, or open /demo for labelled simulated replies.');
  return commit('chat',{text,language:language||state.business.language},{signal});
}
export async function readReceipt(file,{onProgress=()=>{},signal}={}){
  if(signal?.aborted)throw new DOMException('Receipt reading cancelled.','AbortError');
  if(!(file instanceof Blob)||!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>8*1024*1024)throw Error('Choose a non-empty JPEG, PNG or WebP receipt photo smaller than 8 MB.');
  if(DEMO){onProgress({status:'Preparing labelled demo receipt',progress:1});return {...sampleReceiptDraft({name:file.name||'Demo receipt'}),id:'receipt_'+crypto.randomUUID()};}
  const result=await realOcr(file,onProgress,{signal});
  return {...parseReceipt(result.text,{name:file.name||'Receipt photo',engine:result.engine,simulation:false}),id:'receipt_'+crypto.randomUUID()};
}
export function saveReceipt(receipt,file){
  return enqueue(async()=>{
    if(!state)await loadWorkspace();
    let normalized=validateReceiptDraft(receipt);
    let stableId=normalized.id||receiptIds.get(receipt);
    if(!stableId){stableId='receipt_'+crypto.randomUUID();receiptIds.set(receipt,stableId);}
    normalized={...normalized,id:stableId};
    if(DEMO){if(normalized.source.mode!=='simulated')throw Error('The demo saves labelled sample receipt values only.');return performCommit('receipt',{receipt:normalized,reviewed:true});}
    if(capabilities.storage!=='cloud')throw Error('Sign in to the private workspace before saving a receipt. The reviewed fields remain on this screen.');
    if(!['ocr','manual'].includes(normalized.source.mode))throw Error('Simulated receipt values cannot be saved to the live workspace.');
    if(uncertain){const latest=await request();state=validateWorkspace(latest.state);capabilities={...capabilities,...latest.capabilities};uncertain=false;}
    const existing=state.receipts.find(item=>item.id===stableId);
    if(existing){
      const comparable=value=>JSON.stringify(Object.fromEntries(['name','kind','merchant','date','currency','items','total','text','source'].map(key=>[key,value[key]])));
      if(comparable(validateReceiptDraft(existing))!==comparable(normalized))throw Error('This receipt was already confirmed with different fields. Historical receipt records cannot be overwritten.');
      return {state:clone(state),capabilities:clone(capabilities),operation:{receipt:clone(existing),alreadyConfirmed:true}};
    }
    if(file){
      if(!(file instanceof Blob)||!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>8*1024*1024)throw Error('Choose a supported receipt photo smaller than 8 MB.');
      let uploaded=uploadedFiles.get(file);
      if(!uploaded||uploaded.businessId!==state.id||!state.receiptUploads.some(item=>item.id===uploaded.id)){
        const form=new FormData();form.set('file',file,file.name||'receipt-photo');form.set('expectedRevision',String(state.revision));
        let result;
        try{
          const response=await fetch('/api/receipt-source',{method:'POST',credentials:'same-origin',body:form,signal:AbortSignal.timeout(60000)});
          result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'The receipt photo could not be archived.'),{status:response.status});
        }catch(error){if(error.name==='AbortError'||error.name==='TimeoutError'||error instanceof TypeError)uncertain=true;throw error;}
        state=validateWorkspace(result.state);capabilities={...capabilities,...result.capabilities};
        const source=result.operation?.source;if(!source?.id||!state.receiptUploads.some(item=>item.id===source.id))throw Error('The receipt archive did not return a valid source. Reload before retrying.');
        uploaded={id:source.id,businessId:state.id};uploadedFiles.set(file,uploaded);
      }
      normalized={...normalized,uploadId:uploaded.id};
    }
    return performCommit('receipt',{receipt:normalized,reviewed:true});
  });
}
export function clearChat(){return commit('chat-clear');}
export const ocr=realOcr;
export const closeOcr=disposeOcr;
