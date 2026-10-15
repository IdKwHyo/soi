import {menuPhotoUrl,normalizeMenuPhoto,GENERATED_MENU_PHOTOS,MAX_MENU_PHOTO_BYTES} from './menu-media.mjs';

const generatedKeys=new Set(GENERATED_MENU_PHOTOS);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const tr=(language,en,th)=>language==='th'?th:en;

function descriptor(item,demo){
  if(item.photo===undefined&&demo&&generatedKeys.has(item.id))return {kind:'generated',key:item.id};
  return item.photo??null;
}

export function hasGeneratedMenuPhoto(item,{demo=false}={}){
  const photo=descriptor(item,demo);
  return photo?.kind==='generated'&&generatedKeys.has(photo.key);
}

function hydratedUrl(value,photo,{demo,publicKey}){
  let normalized;
  try{normalized=normalizeMenuPhoto(photo);}catch{return null;}
  if(normalized?.kind==='generated')return menuPhotoUrl(normalized);
  if(!demo&&normalized?.kind==='uploaded'){
    const validKey=typeof publicKey==='string'&&/^[a-f0-9]{32}$/.test(publicKey);
    const match=typeof value==='string'&&value.match(/^\/api\/copilot\/media\/([a-f0-9]{32})\/([a-f0-9]{32})$/);
    if(match&&match[2]===normalized.id&&(publicKey==null||(validKey&&match[1]===publicKey)))return value;
    // Public menus must never fall back to the authenticated owner preview URL.
    return validKey?menuPhotoUrl(normalized,{publicKey}):null;
  }
  // Only the local adapter can hydrate demo uploads. Do not turn a menu field
  // into an arbitrary remote image URL or an executable SVG document.
  if(demo&&normalized?.kind==='uploaded'&&typeof value==='string'&&value.length<=Math.ceil(MAX_MENU_PHOTO_BYTES*4/3)+40){
    if(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value))return value;
  }
  return null;
}

/** Shared by merchant and guest menus; public presentation fields only. */
export function menuDishPhoto(item,{language='en',demo=false,publicKey,index=1}={}){
  const photo=descriptor(item,demo),url=photo?hydratedUrl(item.photoUrl,photo,{demo,publicKey}):null;
  if(!url)return `<figure class="cp-food-art cp-food-empty" aria-label="${tr(language,'No menu photo','ยังไม่มีภาพเมนู')}"><span aria-hidden="true">${esc(String(index).padStart(2,'0'))}</span><span>${tr(language,'No photo yet','ยังไม่มีภาพ')}</span></figure>`;
  const name=language==='th'&&item.nameTh?item.nameTh:item.name;
  const generated=photo.kind==='generated';
  const alt=generated?tr(language,`Illustrative AI image of ${name}`,`ภาพ AI ประกอบเมนู ${name}`):tr(language,`Merchant photo of ${name}`,`ภาพจากร้านของเมนู ${name}`);
  return `<figure class="cp-food-art" data-photo-kind="${generated?'generated':'uploaded'}"><img src="${esc(url)}" alt="${esc(alt)}" width="960" height="720" loading="${index===1?'eager':'lazy'}" decoding="async">${generated?'':`<figcaption class="cp-food-source">${tr(language,'Merchant photo','ภาพจากร้าน')}</figcaption>`}</figure>`;
}
