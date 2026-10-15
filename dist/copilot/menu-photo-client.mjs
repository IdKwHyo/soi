import {CopilotError} from './domain.mjs';

const TYPES=new Set(['image/jpeg','image/png','image/webp']);
const MAX_SOURCE_BYTES=8*1024*1024,MAX_PIXELS=24_000_000,MAX_EDGE=8192;
const fail=message=>{throw new CopilotError(message,400);};
const ascii=(bytes,offset,length)=>String.fromCharCode(...bytes.subarray(offset,offset+length));
function dimensions(width,height) {if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>MAX_EDGE||height>MAX_EDGE||width*height>MAX_PIXELS)fail('Choose a photo no larger than 8,192 pixels per side and 24 megapixels.');return {width,height};}

// Inspect dimensions before browser decoding, including large compressed images.
export async function inspectDishPhoto(file) {
  if(!(file instanceof Blob)||!TYPES.has(file.type)||!file.size||file.size>MAX_SOURCE_BYTES)fail('Choose a JPEG, PNG or WebP photo no larger than 8 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer);
  if(file.type==='image/png') {
    if(bytes.length<24||!([137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))||ascii(bytes,12,4)!=='IHDR')fail('This file is not a valid PNG photo.');
    return {type:file.type,...dimensions(view.getUint32(16),view.getUint32(20))};
  }
  if(file.type==='image/jpeg') {
    if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)fail('This file is not a valid JPEG photo.');
    let offset=2;
    while(offset+3<bytes.length) {
      if(bytes[offset]!==255)fail('The JPEG photo header is damaged.');
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];if(marker===217||marker===218)break;
      if(marker===1||(marker>=208&&marker<=215))continue;
      if(offset+2>bytes.length)break;const length=view.getUint16(offset);
      if(length<2||offset+length>bytes.length)fail('The JPEG photo header is damaged.');
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if(length<8)fail('The JPEG photo header is damaged.');
        return {type:file.type,...dimensions(view.getUint16(offset+5),view.getUint16(offset+3))};
      }
      offset+=length;
    }
    fail('The JPEG photo dimensions could not be read.');
  }
  if(bytes.length<20||ascii(bytes,0,4)!=='RIFF'||ascii(bytes,8,4)!=='WEBP'||view.getUint32(4,true)+8!==bytes.length)fail('This file is not a valid WebP photo.');
  for(let offset=12;offset+8<=bytes.length;) {
    const kind=ascii(bytes,offset,4),length=view.getUint32(offset+4,true),start=offset+8;
    if(start+length>bytes.length)fail('The WebP photo header is damaged.');
    if(kind==='VP8X'&&length>=10){if(bytes[start]&2)fail('Use a still photo rather than an animated image.');return {type:file.type,...dimensions(1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16),1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16))};}
    if(kind==='VP8 '&&length>=10&&bytes[start+3]===157&&bytes[start+4]===1&&bytes[start+5]===42)return {type:file.type,...dimensions(view.getUint16(start+6,true)&16383,view.getUint16(start+8,true)&16383)};
    if(kind==='VP8L'&&length>=5&&bytes[start]===47)return {type:file.type,...dimensions(1+bytes[start+1]+((bytes[start+2]&63)<<8),1+(bytes[start+2]>>6)+(bytes[start+3]<<2)+((bytes[start+4]&15)<<10))};
    offset=start+length+(length%2);
  }
  fail('The WebP photo dimensions could not be read.');
}

async function decodePhoto(file) {
  if(typeof globalThis.createImageBitmap==='function')return createImageBitmap(file,{imageOrientation:'from-image'});
  if(!globalThis.document||typeof globalThis.Image!=='function')fail('Photo preparation needs a browser with image support.');
  const url=URL.createObjectURL(file),image=new Image();
  try {await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('The photo could not be decoded.'));image.src=url;});return image;}
  finally {URL.revokeObjectURL(url);}
}
function makeCanvas(){if(!globalThis.document)fail('Photo preparation needs a browser canvas.');return document.createElement('canvas');}
function encode(canvas,quality){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('The photo could not be prepared.')),'image/jpeg',quality));}

/** Re-encode pixels only: at most 640 px, stripping EXIF and other source metadata. */
export async function prepareDishPhoto(file,{maxBytes=80*1024,decode=decodePhoto,createCanvas=makeCanvas}={}) {
  if(!Number.isInteger(maxBytes)||maxBytes<20*1024||maxBytes>250*1024)fail('Use a photo size target from 20 to 250 KB.');
  await inspectDishPhoto(file);let image;
  try {
    image=await decode(file);const {width,height}=dimensions(image.naturalWidth||image.width,image.naturalHeight||image.height);
    const canvas=createCanvas(),context=canvas.getContext('2d');if(!context)fail('This browser could not prepare the photo.');
    let longest=Math.min(640,Math.max(width,height));
    for(let round=0;round<5;round++) {
      const scale=longest/Math.max(width,height);canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
      context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of [.84,.70,.56,.42]) {const blob=await encode(canvas,quality);if(blob.type!=='image/jpeg')fail('This browser did not produce a supported photo format.');if(blob.size&&blob.size<=maxBytes)return blob;}
      longest=Math.max(1,Math.round(longest*.8));
    }
    fail('This photo is too detailed for the menu limit. Choose a simpler crop or smaller photo.');
  } catch(error) {if(error instanceof CopilotError)throw error;throw new CopilotError(error.message||'The photo could not be decoded. Choose another image.',400);}
  finally {image?.close?.();}
}
