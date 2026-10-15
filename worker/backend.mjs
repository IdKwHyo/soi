import {createWorkspace,validateWorkspace,validateBusiness,importDataset,commitManualDataset,saveMemory,retrieveMemory,buildCandidates,evaluateCandidates,recordResult} from '../dist/data.mjs';
import {createStorage,RevisionConflict} from './storage.mjs';
import {modelAvailable,modelName,syntheticDemoOnly,contextFingerprint,candidateCacheKey,refineWithGemini,applyModelCandidates,PROMPT_VERSION} from './model.mjs';
import {normalizeAssistantState,confirmReceipt,recordExchange} from '../dist/advisor.mjs';
import {askAssistant,evaluateComparison,retrieveSemantic,embeddingModelName,ASSISTANT_VERSION} from './assistant.mjs';
import {normalizeMerchantFlow,updateMerchantFlow,recordMerchantOutcome} from '../dist/merchant-flow.mjs';

const MAX_BODY_BYTES=1_200_000;
const LIMITS={datasets:100,imports:100,memories:200,runs:100,campaigns:100,results:200,receipts:50,receiptUploads:50,messages:80};
const SIGN_IN='/signin-with-chatgpt?return_to=%2F';
const clone=value=>structuredClone(value);
const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const capabilities=env=>({storage:env.DB&&env.BUCKET?'cloud':'local',model:modelAvailable(env)?'gemini':'rules',ocr:'browser',auth:'chatgpt',
  merchantAI:env.ALLOW_MERCHANT_AI==='true',memoryRetrieval:modelAvailable(env)&&env.ALLOW_MERCHANT_AI==='true'?'semantic':'not-configured',embeddingModel:embeddingModelName(env),
  advisor:modelAvailable(env)&&env.ALLOW_MERCHANT_AI==='true'?'gemini':'not-configured',comparison:modelAvailable(env)&&env.ALLOW_MERCHANT_AI==='true'?'evidence-and-constraint-checks':'constraint-checks',trainedLayer:false,promptVersion:PROMPT_VERSION});
function object(value,label='payload') {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`Use an object for ${label}.`);
  return value;
}
function boundedState(state) {
  validateWorkspace(state);
  for(const [field,max] of Object.entries(LIMITS))if(state[field].length>max)throw Error(`This workspace has reached its ${field} history limit. Export it before adding more.`);
}
async function readJson(request) {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Object.assign(Error('Send application/json.'),{status:415});
  const reader=request.body?.getReader();
  if(!reader)throw Error('A request body is required.');
  const chunks=[];let length=0;
  while(true) {
    const {done,value}=await reader.read();if(done)break;
    length+=value.byteLength;
    if(length>MAX_BODY_BYTES){await reader.cancel();throw Object.assign(Error('The request is too large. Upload a CSV under 1 MB.'),{status:413});}
    chunks.push(value);
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),'request');}
  catch{throw Error('The request body must contain valid JSON.');}
}
const MAX_PHOTO_BYTES=8*1024*1024;
async function readReceiptUpload(request) {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;'))throw Object.assign(Error('Send a multipart receipt image.'),{status:415});
  const reader=request.body?.getReader();if(!reader)throw Error('Attach a receipt image.');
  const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_PHOTO_BYTES+16_384){await reader.cancel();throw Object.assign(Error('Receipt photos must be under 8 MB.'),{status:413});}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let form;try{form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')}}).formData();}catch{throw Error('The receipt upload is invalid.');}
  const file=form.get('file'),rawRevision=form.get('expectedRevision');
  if(typeof rawRevision!=='string'||!/^\d+$/.test(rawRevision)||!Number.isSafeInteger(Number(rawRevision)))throw Error('Include the workspace revision with this receipt upload.');
  if(!file||typeof file==='string'||typeof file.arrayBuffer!=='function'||file.size<12||file.size>MAX_PHOTO_BYTES)throw Error('Attach a JPEG, PNG or WebP receipt photo under 8 MB.');
  const image=new Uint8Array(await file.arrayBuffer());let contentType;
  if(image[0]===0xff&&image[1]===0xd8&&image[2]===0xff)contentType='image/jpeg';
  else if([137,80,78,71,13,10,26,10].every((value,index)=>image[index]===value))contentType='image/png';
  else if(new TextDecoder().decode(image.slice(0,4))==='RIFF'&&new TextDecoder().decode(image.slice(8,12))==='WEBP')contentType='image/webp';
  else throw Error('This file is not a supported JPEG, PNG or WebP image.');
  if(file.type&&file.type!==contentType)throw Error('The receipt file type does not match its image content.');
  return {image,contentType,name:String(file.name||'receipt').replace(/[\x00-\x1f\x7f/\\]/g,'').slice(0,100)||'receipt',expectedRevision:Number(rawRevision)};
}
function updateBusiness(state,payload) {
  const business={...state.business};
  for(const field of ['name','type','audience','tone','budget','capacity','language'])if(Object.hasOwn(payload,field))business[field]=payload[field];
  validateBusiness(business);state.business=business;state.revision++;
}
function approval(state,payload,context) {
  if(payload.reviewedCapacity!==true||payload.reviewedContent!==true)throw Error('Confirm cooking capacity and review the campaign wording before approval.');
  const run=state.runs.find(item=>item.candidates.some(candidate=>candidate.id===payload.candidateId));
  if(!run)throw Error('Choose a strategy from an existing comparison.');
  if(run.contextFingerprint!==context)throw Error('Business facts changed after this comparison. Generate a fresh comparison before approval.');
  if(state.campaigns.some(item=>item.candidateId===payload.candidateId))throw Error('This strategy is already approved.');
  const original=run.candidates.find(item=>item.id===payload.candidateId),edited=clone(original);
  if(original.evaluation?.mode==='gemini-evidence-evaluator'&&original.evaluation.passed!==true)throw Error('This generated strategy did not pass the evidence review. Generate a fresh comparison before approval.');
  if(payload.plan!==undefined) {
    const plan=object(payload.plan,'campaign assumptions');
    for(const field of ['discount','extraOrders','existingOrders','budget'])if(Object.hasOwn(plan,field))edited[field]=plan[field];
  }
  if(payload.drafts!==undefined) {
    const drafts=object(payload.drafts,'campaign copy');
    for(const field of ['social','message','announcement'])if(Object.hasOwn(drafts,field)) {
      if(typeof drafts[field]!=='string'||!drafts[field].trim()||drafts[field].length>10_000)throw Error('Campaign copy must contain between 1 and 10,000 characters.');
      edited.drafts[field]=drafts[field];
    }
  }
  const candidate=evaluateCandidates(state,[edited])[0];
  if(candidate.evaluation)candidate.evaluation={...candidate.evaluation,scope:'Generated draft before owner edits',ownerEdited:payload.plan!==undefined||payload.drafts!==undefined};
  if(!candidate.approvable)throw Error('This strategy does not pass the current financial, budget, capacity and dataset checks.');
  const campaign={...candidate,id:`campaign_${crypto.randomUUID()}`,candidateId:candidate.id,status:'approved',approvedAt:new Date().toISOString(),
    createdAt:new Date().toISOString(),reviewedCapacity:true,reviewedContent:true,contextFingerprint:context};
  state.campaigns.push(campaign);state.selectedCandidateId=candidate.id;state.revision++;
  return campaign;
}
function results(state,payload) {
  const campaign=state.campaigns.find(item=>item.candidateId===payload.candidateId||item.id===payload.candidateId);
  if(!campaign||campaign.status!=='approved')throw Error('Approve a campaign before recording its results.');
  const pinned=clone(state);pinned.runs=[];
  const result=recordResult(pinned,{candidateId:campaign.candidateId,totalOrders:payload.totalOrders,baselineOrders:payload.baselineOrders,spend:payload.spend});
  result.campaignId=campaign.id;
  state.results.push(result);state.revision++;
  return result;
}

export async function handleApi(request,env={}) {
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return null;
  if(url.pathname==='/api/health'&&request.method==='GET')return response({ok:true,capabilities:capabilities(env)});
  const userId=request.headers.get('oai-authenticated-user-id');
  if(!userId||userId.length>200)return response({error:'Sign in with ChatGPT to use your saved workspace.',signinPath:SIGN_IN},401);
  const storage=createStorage(env);
  if(!storage) {
    if(url.pathname==='/api/workspace'&&request.method==='GET')return response({state:null,capabilities:capabilities(env)});
    return response({error:'Cloud storage is not configured. The local demo remains available.'},503);
  }
  let loaded,stagedArchive=null,stagedReceipt=null;
  try {
    loaded=await storage.load(userId,createWorkspace);
    normalizeAssistantState(loaded.state);
    normalizeMerchantFlow(loaded.state);
    const {businessId}=loaded;
    if(request.method==='GET') {
      if(url.pathname==='/api/workspace')return response({state:loaded.state,capabilities:capabilities(env)});
      if(url.pathname==='/api/memory')return response({memories:retrieveMemory(loaded.state,(url.searchParams.get('q')||'').slice(0,500),4),retrievalMode:'keyword'});
      if(url.pathname.startsWith('/api/receipt-source/')) {
        const id=decodeURIComponent(url.pathname.slice('/api/receipt-source/'.length));
        const upload=loaded.state.receiptUploads.find(item=>item.id===id);
        if(!upload?.key?.startsWith(`${businessId}/receipts/`))return response({error:'Receipt source not found.'},404);
        const file=await env.BUCKET.get(upload.key);if(!file)return response({error:'Receipt source not found.'},404);
        const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[upload.contentType];
        if(!extension)return response({error:'Receipt source not found.'},404);
        return new Response(file.body,{headers:{'Content-Type':upload.contentType,'Content-Disposition':`attachment; filename="receipt.${extension}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
      if(url.pathname.startsWith('/api/archive/')) {
        const id=decodeURIComponent(url.pathname.slice('/api/archive/'.length));
        const imported=loaded.state.imports.find(item=>item.id===id);
        if(!imported?.rawArchive?.key?.startsWith(`${businessId}/originals/`))return response({error:'Archive not found.'},404);
        const file=await env.BUCKET.get(imported.rawArchive.key);
        if(!file)return response({error:'Archive not found.'},404);
        return new Response(file.body,{headers:{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="original-report.csv.gz"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
      return response({error:'API route not found.'},404);
    }
    if(!['/api/workspace','/api/receipt-source'].includes(url.pathname))return response({error:'API route not found.'},404);
    if(request.method!=='POST')return response({error:'Use GET or POST for this route.'},405);
    const origin=request.headers.get('origin');
    if(origin&&origin!==url.origin)return response({error:'Requests must come from this site.'},403);
    if(url.pathname==='/api/receipt-source') {
      const parsed=await readReceiptUpload(request);
      if(parsed.expectedRevision!==loaded.state.revision)throw new RevisionConflict();
      const state=clone(loaded.state),id=`upload_${crypto.randomUUID()}`;
      const sha=await crypto.subtle.digest('SHA-256',parsed.image),sha256=[...new Uint8Array(sha)].map(value=>value.toString(16).padStart(2,'0')).join('');
      const upload={id,name:parsed.name,key:`${businessId}/receipts/${id}-${sha256}`,contentType:parsed.contentType,bytes:parsed.image.byteLength,sha256,createdAt:new Date().toISOString()};
      state.receiptUploads.push(upload);state.revision++;boundedState(state);
      stagedReceipt=await storage.archiveReceipt(businessId,upload,parsed.image,state,loaded.state);
      await storage.save(userId,businessId,state,parsed.expectedRevision,'receipt-source',{previousState:loaded.state});
      return response({state,capabilities:capabilities(env),operation:{source:{id:upload.id,name:upload.name,bytes:upload.bytes,contentType:upload.contentType}}});
    }
    const body=await readJson(request),payload=object(body.payload||{});
    if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw Error('Include the workspace revision with every change.');
    if(body.expectedRevision!==loaded.state.revision)throw new RevisionConflict();
    const state=clone(loaded.state);let operation=null,cache=null,caches=[];
    switch(body.action) {
      case 'business': updateBusiness(state,payload);break;
      case 'manual': operation=commitManualDataset(state,payload.menus,payload.period);break;
      case 'import': {
        operation=await importDataset(state,payload);
        if(operation.status==='duplicate')return response({state:loaded.state,capabilities:capabilities(env),operation:{status:'duplicate',datasetId:operation.dataset.id}});
        boundedState(state);
        stagedArchive=await storage.archive(businessId,operation.import,state,loaded.state);
        operation={status:'committed',datasetId:operation.dataset.id,importId:operation.import.id};
        break;
      }
      case 'memory': operation=saveMemory(state,payload);break;
      case 'merchant-flow': operation=updateMerchantFlow(state,payload);break;
      case 'flow-outcome': {
        if(payload.source!==undefined&&payload.source!=='owner')throw Error('Simulated outcomes belong in /demo. Record owner-observed results here.');
        const outcome=recordMerchantOutcome(state,payload,{source:'owner'}),alreadyRecorded=state.revision===loaded.state.revision;
        operation={outcome,alreadyRecorded};
        if(alreadyRecorded)return response({state:loaded.state,capabilities:capabilities(env),operation});
        break;
      }
      case 'chat': {
        const result=await askAssistant(env,state,{text:payload.text,language:payload.language||state.business.language,businessId,storage,signal:request.signal});
        recordExchange(state,{question:payload.text,response:result.response,language:payload.language||state.business.language,mode:'gemini'});
        caches=result.caches;operation={response:result.response};break;
      }
      case 'chat-clear': state.messages=[];state.revision++;operation={status:'cleared'};break;
      case 'receipt': {
        if(!['ocr','manual'].includes(payload.receipt?.source?.mode))throw Error('Simulated receipts belong in /demo. Read or enter a real receipt here.');
        if(payload.receipt?.uploadId&&!state.receiptUploads.some(item=>item.id===payload.receipt.uploadId))throw Error('This receipt source does not belong to your workspace.');
        operation=confirmReceipt(state,payload);break;
      }
      case 'candidates': {
        const mode=payload.mode||'rules';if(!['rules','gemini'].includes(mode))throw Error('Choose the rules demo or Gemini.');
        const language=payload.language||state.business.language;
        const base=buildCandidates(state,language),run=state.runs.at(-1);
        run.contextFingerprint=await contextFingerprint(state);run.promptVersion=PROMPT_VERSION;
        if(mode==='gemini') {
          if(!modelAvailable(env))throw Error('Gemini is not configured. Choose the rules demo to continue.');
          if(!syntheticDemoOnly(state)&&env.ALLOW_MERCHANT_AI!=='true')throw Error('This Gemini demo accepts the unchanged sample business and memories only. Merchant-data AI is not enabled.');
          const semantic=payload.evidenceEvaluation===true;
          const key=await candidateCacheKey(businessId,state,language,modelName(env),semantic?{evidenceVersion:ASSISTANT_VERSION,embeddingModel:embeddingModelName(env)}:{});
          let cached=await storage.cached(businessId,key),retrieved;
          try {
            if(semantic)retrieved=await retrieveSemantic(env,state,'Generate and compare two weekday lunch restaurant campaign strategies grounded in owner facts, contribution, budget, additional order capacity and factual wording.',{businessId,storage,signal:request.signal});
            if(cached)run.candidates=applyModelCandidates(state,base,cached);
            else {
              const refined=await refineWithGemini(env,state,base,{signal:request.signal,evidence:retrieved?.documents});
              run.candidates=refined.candidates;
              cache={key,value:refined.output,expiresAt:new Date(Date.now()+60*60*1000).toISOString()};
            }
            // Existing integrations may explicitly opt into refinement only.
            // The app requests the evidence evaluator; failures never fall back silently.
            if(semantic) {
              const evaluated=await evaluateComparison(env,state,run.candidates,{businessId,storage,language,signal:request.signal,retrieved});
              run.candidates=evaluated.candidates;run.evaluation=evaluated.evaluation;run.retrieval=evaluated.retrieval;caches=evaluated.caches;
            }
            run.source='gemini-domain-refinement';run.model=modelName(env);run.cacheHit=Boolean(cached);
          } catch(error) {
            if(payload.allowFallback!==true)throw error;
            run.source='local-rule-demo';run.modelNotice=error.message;
          }
        }
        operation={runId:run.id,source:run.source,cacheHit:run.cacheHit||false,notice:run.modelNotice||null};
        break;
      }
      case 'approve': operation=approval(state,payload,await contextFingerprint(state));break;
      case 'results': operation=results(state,payload);break;
      case 'reset': {
        const fresh=createWorkspace();fresh.id=businessId;fresh.revision=state.revision+1;
        Object.assign(state,fresh);operation={status:'reset'};break;
      }
      default:throw Error('Choose a supported workspace action.');
    }
    boundedState(state);
    await storage.save(userId,businessId,state,body.expectedRevision,body.action,{cache,caches,previousState:loaded.state});
    return response({state,capabilities:capabilities(env),operation});
  } catch(error) {
    if(stagedArchive&&loaded)await storage.releaseArchive(loaded.businessId,stagedArchive);
    if(stagedReceipt&&loaded)await storage.releaseReceipt(loaded.businessId,stagedReceipt);
    if(error instanceof RevisionConflict)return response({error:error.message,code:'revision_conflict'},409);
    // Domain errors are concise and safe. Unexpected storage/runtime errors
    // are intentionally kept behind the module seam.
    const safe=error?.message&&error.message.length<500&&!/SQLITE|D1_|constraint failed|database|SELECT |INSERT |UPDATE /i.test(error.message);
    return response({error:safe?error.message:'Workspace storage is temporarily unavailable. Try again.'},error.status||400);
  }
}
