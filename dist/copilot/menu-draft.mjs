import {normalizeMenuPhoto} from './menu-media.mjs';

const CONFLICT='The menu changed in another tab. Close this editor and reopen it to review the latest menu before saving.';

/** Pin only the catalog fields this editor can replace, independent of queue revisions. */
export function menuDraftFingerprint(menu) {
  if(!Array.isArray(menu))throw Error('A saved menu is required before opening the editor.');
  return JSON.stringify(menu.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw Error('The saved menu could not be read. Close this editor and reopen it.');
    return {id:item.id,name:item.name,nameTh:item.nameTh??'',category:item.category,
      storePriceCents:item.storePriceCents,onlinePriceCents:item.onlinePriceCents,
      prepMinutes:item.prepMinutes,station:item.station,available:item.available,
      photo:normalizeMenuPhoto(item.photo)};
  }));
}

/** A photo upload may advance the revision without authorizing replacement of a newer catalog. */
export function assertMenuDraftCurrent(baseline,menu) {
  if(typeof baseline!=='string'||baseline!==menuDraftFingerprint(menu))throw Error(CONFLICT);
  return true;
}
