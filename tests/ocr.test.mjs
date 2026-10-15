import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {ocr,closeOcr} from '../dist/ocr.mjs';

// This file verifies the browser adapter's real pinned message shapes and
// lifecycle. Fake workers do not benchmark OCR accuracy or browser rendering.
const ORIGIN='https://soi-test.invalid';
const photo=()=>new Blob([Uint8Array.of(137,80,78,71,13,10,26,10,0,0,0,0)],{type:'image/png'});
const output={text:'ชาไทย 45.00\nTOTAL 223.00',blocks:[],confidence:94};
function browser(t,respond=packet=>({status:'resolve',data:packet.action==='recognize'?output:{}})){
  const originalWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  const originalLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
  const workers=[];
  class FakeWorker{
    constructor(url,options){this.url=url;this.options=options;this.messages=[];workers.push(this);}
    postMessage(packet,transfer){
      this.messages.push({packet,transfer});
      const reply=respond(packet,this);
      if(reply)queueMicrotask(()=>{if(!this.terminated)this.onmessage?.({data:{workerId:packet.workerId,jobId:packet.jobId,action:packet.action,...reply}});});
    }
    terminate(){this.terminated=true;}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,writable:true,value:FakeWorker});
  Object.defineProperty(globalThis,'location',{configurable:true,writable:true,value:{origin:ORIGIN}});
  t.after(async()=>{
    await closeOcr();
    if(originalWorker)Object.defineProperty(globalThis,'Worker',originalWorker);else delete globalThis.Worker;
    if(originalLocation)Object.defineProperty(globalThis,'location',originalLocation);else delete globalThis.location;
  });
  return workers;
}

test('OCR loads same-origin Thai/English assets through the pinned worker protocol and reuses a ready worker',{concurrency:false},async t=>{
  const workers=browser(t);const statuses=[];
  const result=await ocr(photo(),message=>statuses.push(message));
  assert.deepEqual(result,{...output,engine:'Tesseract.js 7 · Thai + English'});
  assert.equal(workers[0].url.href,ORIGIN+'/ocr/worker.min.js');
  assert.deepEqual(workers[0].messages.map(m=>m.packet.action),['load','loadLanguage','initialize','setParameters','recognize']);
  const packets=workers[0].messages.map(m=>m.packet);
  assert.deepEqual(packets[0].payload,{options:{lstmOnly:true,corePath:ORIGIN+'/ocr',logging:false}});
  assert.equal(packets[1].payload.langs,'tha+eng');
  assert.equal(packets[1].payload.options.langPath,ORIGIN+'/ocr');
  assert.equal(packets[1].payload.options.gzip,true);
  assert.equal(packets[1].payload.options.lstmOnly,true);
  assert.deepEqual(packets[2].payload,{langs:'tha+eng',oem:1,config:{}});
  assert.deepEqual(packets[3].payload,{params:{preserve_interword_spaces:'1'}});
  assert.ok(packets[4].payload.image instanceof Uint8Array);
  assert.deepEqual(packets[4].payload.output,{text:true,blocks:true});
  assert.equal(workers[0].messages[4].transfer[0],packets[4].payload.image.buffer);
  assert.ok(packets.every(packet=>packet.workerId==='soi-ocr'&&typeof packet.jobId==='string'));
  assert.equal(statuses.at(-1).stage,'complete');
  await ocr(photo());assert.equal(workers.length,1);
  assert.equal(workers[0].messages.at(-1).packet.action,'recognize');
});

test('OCR language initialization rejection terminates the worker and allows a clean retry',{concurrency:false,timeout:2000},async t=>{
  let fail=true;
  const workers=browser(t,packet=>packet.action==='loadLanguage'&&fail?{status:'reject',data:'network error'}:{status:'resolve',data:packet.action==='recognize'?output:{}});
  await assert.rejects(ocr(photo()),error=>error.code==='OCR_ASSETS'&&/files could not load/.test(error.message));
  assert.equal(workers[0].terminated,true);
  fail=false;assert.equal((await ocr(photo())).text,output.text);assert.equal(workers.length,2);
});

test('OCR rejects concurrent reads and abort disposes a worker during initialization',{concurrency:false,timeout:2000},async t=>{
  const workers=browser(t,()=>null);const controller=new AbortController();
  const reading=ocr(photo(),()=>{},{signal:controller.signal});
  // Attach a rejection assertion before aborting so there is no unhandled rejection.
  const cancelled=assert.rejects(reading,error=>error.name==='AbortError');
  await nextTurn();assert.equal(workers.length,1);
  await assert.rejects(ocr(photo()),error=>error.code==='OCR_BUSY');
  controller.abort();await cancelled;assert.equal(workers[0].terminated,true);
  await assert.rejects(ocr(photo(),()=>{},{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(workers.length,1);
});

test('closing OCR before asynchronous file validation ends prevents a new worker from starting',{concurrency:false,timeout:2000},async t=>{
  const workers=browser(t);const reading=ocr(photo());
  const cancelled=assert.rejects(reading,error=>error.name==='AbortError');
  await closeOcr();await cancelled;assert.equal(workers.length,0);
  // The closed operation released the busy guard.
  assert.equal((await ocr(photo())).text,output.text);
});

test('OCR validates size, image magic and supported formats before allocating a worker',{concurrency:false},async t=>{
  const workers=browser(t);
  await assert.rejects(ocr(new Blob(['garbage'],{type:'image/png'})),error=>error.code==='OCR_FILE_SIGNATURE');
  await assert.rejects(ocr(new Blob(['pdf'],{type:'application/pdf'})),error=>error.code==='OCR_FILE_TYPE');
  await assert.rejects(ocr(new Blob([],{type:'image/png'})),error=>error.code==='OCR_EMPTY_FILE');
  await assert.rejects(ocr(new Blob([new Uint8Array(8*1024*1024+1)],{type:'image/png'})),error=>error.code==='OCR_FILE_SIZE');
  assert.equal(workers.length,0);
});

test('OCR distinguishes undecodable photos from model-loading failures',{concurrency:false,timeout:2000},async t=>{
  const workers=browser(t,packet=>packet.action==='recognize'?{status:'reject',data:'Error attempting to read image.'}:{status:'resolve',data:{}});
  await assert.rejects(ocr(photo()),error=>error.code==='OCR_IMAGE'&&/decoded/.test(error.message));
  assert.equal(workers[0].terminated,true);
});

test('a UI progress callback exception cannot interrupt receipt recognition',{concurrency:false},async t=>{
  browser(t);const result=await ocr(photo(),()=>{throw Error('UI callback failure');});
  assert.equal(result.text,output.text);
});
