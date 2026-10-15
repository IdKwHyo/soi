// Browser-local OCR. The adapter owns the actual Worker so cancellation and
// initialization failures cannot leave Tesseract.js 7's setup promise pending.
// Message shapes are pinned to tesseract.js 7.0.0 src/createWorker.js.
const MAX_FILE_BYTES=8*1024*1024;
const TYPES=new Set(['image/jpeg','image/png','image/webp']);
const ENGINE='Tesseract.js 7 · Thai + English';
const VERSION='7-best-int-v1';
let worker=null;
let ready=false;
let active=null;
let jobCounter=0;
const pending=new Map();

function failure(code,message,cause){return Object.assign(new Error(message,{cause}),{code});}
function aborted(){return new DOMException('Receipt reading was cancelled.','AbortError');}
function notify(message){try{active?.onProgress?.(message);}catch{ /* A UI callback cannot break recognition. */ }}
function stop(error=aborted()){
  if(active)active.cancelled=true;
  const old=worker;worker=null;ready=false;
  if(old){old.onmessage=null;old.onerror=null;old.onmessageerror=null;old.terminate();}
  for(const job of pending.values()){clearTimeout(job.timer);job.reject(error);}
  pending.clear();
}
function readableFailure(error,stage){
  if(error?.name==='AbortError'||error?.code)return error;
  const detail=String(error?.message||error||'').toLowerCase();
  if(stage==='recognize'&&(/read image|decode|pixread|image format/.test(detail)))return failure('OCR_IMAGE','This photo could not be decoded. Save it again as JPEG, PNG or WebP and retry.',error);
  if(/memory|out of bounds|allocation/.test(detail))return failure('OCR_MEMORY','This device ran out of memory while reading the receipt. Crop the photo to the receipt or use a smaller image.',error);
  if(stage!=='recognize'||/fetch|network|404|403|importscripts|wasm/.test(detail))return failure('OCR_ASSETS','Receipt recognition files could not load from this app. Check your connection and reload. You can enter receipt details manually.',error);
  return failure('OCR_RECOGNITION','The recognition engine could not finish reading this document. Retry once or enter the receipt details manually.',error);
}
function startWorker(){
  if(typeof Worker==='undefined'||typeof WebAssembly==='undefined')throw failure('OCR_UNSUPPORTED','Receipt reading requires a browser with Web Workers and WebAssembly. You can enter the receipt manually.');
  // Same-origin, non-blob worker also gives separate WASM files a stable base URL.
  worker=new Worker(new URL('/ocr/worker.min.js',globalThis.location.origin),{name:'soi-receipt-reader'});
  worker.onmessage=({data})=>{
    const job=pending.get(data?.jobId);
    if(!job||data.workerId!=='soi-ocr')return;
    if(data.status==='progress'){notify({status:String(data.data?.status||'Reading receipt'),progress:Math.max(0,Math.min(1,Number(data.data?.progress)||0)),stage:job.action});return;}
    clearTimeout(job.timer);pending.delete(data.jobId);
    if(data.status==='resolve')job.resolve(data.data);
    else if(data.status==='reject')job.reject(readableFailure(data.data,job.action));
    else job.reject(failure('OCR_PROTOCOL','The receipt reader returned an unreadable response. Reload this app and retry.'));
  };
  worker.onerror=event=>{event.preventDefault?.();stop(readableFailure(event.error||event.message,'load'));};
  worker.onmessageerror=()=>stop(failure('OCR_PROTOCOL','The receipt reader could not exchange image data. Reload this app and retry.'));
}
function run(action,payload,transfer=[]){
  if(active?.cancelled||active?.signal?.aborted)return Promise.reject(aborted());
  const jobId='soi-job-'+(++jobCounter);
  return new Promise((resolve,reject)=>{
    const timeout=action==='recognize'?120000:60000;
    const timer=setTimeout(()=>stop(failure('OCR_TIMEOUT',action==='recognize'?'Receipt reading took too long. Crop the image to one receipt, then retry or enter details manually.':'The receipt recognition files took too long to load. Check your connection, reload, or enter details manually.')),timeout);
    pending.set(jobId,{resolve,reject,timer,action});
    try{worker.postMessage({workerId:'soi-ocr',jobId,action,payload},transfer);}catch(error){stop(readableFailure(error,action));}
  });
}
async function validatePhoto(file){
  if(!(file instanceof Blob)||!TYPES.has(file.type))throw failure('OCR_FILE_TYPE','Choose a JPEG, PNG or WebP photo. PDF reading is not enabled.');
  if(file.size===0)throw failure('OCR_EMPTY_FILE','This photo is empty. Choose another receipt image.');
  if(file.size>MAX_FILE_BYTES)throw failure('OCR_FILE_SIZE','Choose a receipt photo smaller than 8 MB.');
  const head=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const png=head[0]===137&&head[1]===80&&head[2]===78&&head[3]===71&&head[4]===13&&head[5]===10&&head[6]===26&&head[7]===10;
  const jpeg=head[0]===255&&head[1]===216&&head[2]===255;
  const webp=String.fromCharCode(...head.slice(0,4))==='RIFF'&&String.fromCharCode(...head.slice(8,12))==='WEBP';
  if(!(file.type==='image/png'&&png||file.type==='image/jpeg'&&jpeg||file.type==='image/webp'&&webp))throw failure('OCR_FILE_SIGNATURE','This file does not contain a valid photo of the selected type. Export it as JPEG, PNG or WebP first.');
}
export async function ocr(file,onProgress=()=>{},{signal}={}){
  if(active)throw failure('OCR_BUSY','A receipt is already being read. Wait for it to finish or cancel it first.');
  if(signal?.aborted)throw aborted();
  // Lock before asynchronous file reads so two selections cannot race.
  const operation={onProgress,signal};active=operation;
  const cancel=()=>stop(aborted());signal?.addEventListener('abort',cancel,{once:true});
  try{
    await validatePhoto(file);if(operation.cancelled||signal?.aborted)throw aborted();
    if(!worker)startWorker();
    if(!ready){
      notify({status:'Loading local recognition engine',progress:0,stage:'load'});
      await run('load',{options:{lstmOnly:true,corePath:new URL('/ocr',globalThis.location.origin).href,logging:false}});
      notify({status:'Loading Thai and English receipt models',progress:0,stage:'loadLanguage'});
      await run('loadLanguage',{langs:'tha+eng',options:{langPath:new URL('/ocr',globalThis.location.origin).href,cachePath:'soi-ocr-'+VERSION,cacheMethod:'write',gzip:true,lstmOnly:true}});
      await run('initialize',{langs:'tha+eng',oem:1,config:{}});
      await run('setParameters',{params:{preserve_interword_spaces:'1'}});
      ready=true;
    }
    notify({status:'Reading receipt text',progress:0,stage:'recognize'});
    const image=new Uint8Array(await file.arrayBuffer());if(operation.cancelled||signal?.aborted)throw aborted();
    const data=await run('recognize',{image,options:{},output:{text:true,blocks:true}},[image.buffer]);
    if(typeof data?.text!=='string')throw failure('OCR_PROTOCOL','The receipt reader returned no usable text. Reload and retry.');
    if(data.text.length>12000)throw failure('OCR_TEXT_LIMIT','This document is too long for one receipt. Crop it to a single receipt and retry.');
    notify({status:'Receipt text ready for review',progress:1,stage:'complete'});
    return {text:data.text,blocks:data.blocks||[],engine:ENGINE,confidence:Number.isFinite(data.confidence)?data.confidence:null};
  }catch(error){stop(error);throw error;}
  finally{signal?.removeEventListener('abort',cancel);if(active===operation)active=null;}
}
export async function closeOcr(){stop(aborted());}
