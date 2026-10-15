import {CopilotError} from './domain.mjs';

/** Apply a parsed single-dish edit without replacing the rest of the catalog. */
export function mergeDishEdit(menu,editSku,items){
  const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,60}$/.test(value);
  if(!validId(editSku)||!Array.isArray(items)||items.length!==1||items[0]?.id!==editSku){
    throw new CopilotError('A dish edit must keep its original SKU ID.',400);
  }
  if(!Array.isArray(menu)||menu.length<1||menu.length>60){
    throw new CopilotError('Close this editor and reopen the latest menu.',409);
  }
  const seen=new Set();
  for(const item of menu){
    if(!validId(item?.id)||seen.has(item.id))throw new CopilotError('The menu has duplicate or invalid SKU IDs. Reopen the latest menu.',409);
    seen.add(item.id);
  }
  if(!seen.has(editSku))throw new CopilotError('This dish is no longer in the menu. Close this editor and reopen the latest menu.',409);
  return menu.map(item=>item.id===editSku?{...item,...items[0],id:editSku}:item);
}
