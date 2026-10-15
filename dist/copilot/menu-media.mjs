// Canonical photo descriptors contain no remote URL, user filename or image bytes.
export const GENERATED_MENU_PHOTOS=Object.freeze(['basil-chicken','chicken-rice','fried-rice','tom-yum','thai-tea','lime-soda']);
export const MAX_MENU_PHOTO_BYTES=250*1024;
export const MAX_MENU_PHOTO_DIMENSION=2048;
export const MAX_MENU_UPLOADS=80;
export class MenuMediaError extends Error {constructor(message,status=400){super(message);this.name='MenuMediaError';this.status=status;}}
const fail=(message,status)=>{throw new MenuMediaError(message,status);};
export function normalizeMenuPhoto(photo){
  if(photo===undefined||photo===null)return null;
  if(typeof photo!=='object'||Array.isArray(photo))fail('Use a generated dish image or an uploaded photo.');
  if(photo.kind==='generated'&&GENERATED_MENU_PHOTOS.includes(photo.key))return {kind:'generated',key:photo.key};
  if(photo.kind==='uploaded'&&typeof photo.id==='string'&&/^[a-f0-9]{32}$/.test(photo.id))return {kind:'uploaded',id:photo.id};
  fail('The menu photo reference is invalid.');
}
export function menuPhotoUrl(photo,{publicKey,demo=false}={}){
  const normalized=normalizeMenuPhoto(photo);if(!normalized)return null;
  if(normalized.kind==='generated')return `/images/menu/${normalized.key}.webp`;
  if(demo)return null; // Demo uploads are resolved only from the separate browser photo store.
  if(publicKey===undefined||publicKey===null)return `/api/copilot/media/${normalized.id}`;
  if(typeof publicKey!=='string'||!/^[a-f0-9]{32}$/.test(publicKey))return null;
  return `/api/copilot/media/${publicKey}/${normalized.id}`;
}
function dimensions(width,height){if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>MAX_MENU_PHOTO_DIMENSION||height>MAX_MENU_PHOTO_DIMENSION)fail(`Dish photos must be at most ${MAX_MENU_PHOTO_DIMENSION} pixels on each side.`);return {width,height};}
export function validateMenuPhotoBytes(bytes,declaredType){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<20)fail('Attach a non-empty JPEG, PNG or WebP dish photo.');
  if(bytes.byteLength>MAX_MENU_PHOTO_BYTES)fail('Dish photos must be no larger than 250 KB after resizing.',413);
  const type=typeof declaredType==='string'?declaredType.toLowerCase().trim():'';
  if(!['image/jpeg','image/png','image/webp'].includes(type))fail('Use a JPEG, PNG or WebP dish photo.',415);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(start,end)=>new TextDecoder().decode(bytes.subarray(start,end));let actual,size;
  if([137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)&&bytes.byteLength>=33&&ascii(12,16)==='IHDR'&&view.getUint32(8)===13){actual='image/png';size=dimensions(view.getUint32(16),view.getUint32(20));}
  else if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9){
    actual='image/jpeg';let offset=2;
    while(offset+4<=bytes.length){if(bytes[offset]!==0xff)break;while(bytes[offset]===0xff)offset++;const marker=bytes[offset++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;if(offset+2>bytes.length)break;const length=view.getUint16(offset);if(length<2||offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){if(length<8)break;size=dimensions(view.getUint16(offset+5),view.getUint16(offset+3));break;}offset+=length;}
  }else if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'&&view.getUint32(4,true)+8===bytes.byteLength){
    actual='image/webp';const chunk=ascii(12,16);
    if(chunk==='VP8X'&&bytes.length>=30){if(bytes[20]&2)fail('Use a still dish photo, not an animation.');size=dimensions(1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16));}
    else if(chunk==='VP8 '&&bytes.length>=30&&bytes[23]===0x9d&&bytes[24]===0x01&&bytes[25]===0x2a)size=dimensions(view.getUint16(26,true)&0x3fff,view.getUint16(28,true)&0x3fff);
    else if(chunk==='VP8L'&&bytes.length>=25&&bytes[20]===0x2f)size=dimensions(1+bytes[21]+((bytes[22]&0x3f)<<8),1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&0x0f)<<10));
  }
  if(actual!==type||!size)fail('The photo content does not match a supported image.');
  return {contentType:actual,bytes:bytes.byteLength,...size};
}
