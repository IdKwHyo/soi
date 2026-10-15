import {createCopilotState,CopilotError} from './domain.mjs';

export const MENU_CSV_HEADER='sku,name,name_th,category,store_price,online_price,prep_minutes,station';
const fail=message=>{throw new CopilotError(message,400);};
const safeText=(value,label,max,{optional=false}={})=>{const text=value.trim();if((!text&&!optional)||text.length>max||/[\u0000-\u001f\u007f]/.test(text))fail(`Enter a valid ${label}, up to ${max} characters.`);return text;};
function cents(value,label) {
  const raw=value.trim();if(!/^\d+(?:\.\d{1,2})?$/.test(raw))fail(`${label} must use a non-negative amount with at most two decimal places.`);
  const [whole,fraction='']=raw.split('.'),amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(amount)||amount>5_000_000)fail(`${label} must be no more than THB 50,000.`);return amount;
}
function rowsFromCsv(text) {
  if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>50_000)fail('Use a UTF-8 menu CSV no larger than 50 KB.');
  const input=text.replace(/^\uFEFF/,''),rows=[];let row=[],value='',quoted=false,closed=false;
  const cell=()=>{row.push(value);value='';closed=false;};
  const line=()=>{cell();if(row.some(value=>value.trim()))rows.push(row);row=[];if(rows.length>61)fail('Import at most 60 menu SKUs.');};
  for(let index=0;index<input.length;index++) {
    const char=input[index];
    if(quoted){if(char==='"'){if(input[index+1]==='"'){value+='"';index++;}else{quoted=false;closed=true;}}else value+=char;continue;}
    if(char===','){cell();continue;}
    if(char==='\r'||char==='\n'){if(char==='\r'&&input[index+1]==='\n')index++;line();continue;}
    if(closed)fail('Unexpected text after a quoted menu CSV value.');
    if(char==='"'){if(value!=='')fail('Quotes must wrap the complete CSV value.');quoted=true;}else value+=char;
  }
  if(quoted)fail('A menu CSV value is missing its closing quote.');
  if(value!==''||row.length||closed)line();
  if(rows.length<2)fail('Include the menu CSV header and at least one SKU.');
  if(rows[0].map(value=>value.trim()).join(',')!==MENU_CSV_HEADER)fail(`Use exactly these menu CSV columns: ${MENU_CSV_HEADER}.`);
  return rows.slice(1);
}

/** Returns an editable full-menu draft. No state or order history is mutated. */
export function parseMenuCsv(text,existingMenu=[]) {
  const seen=new Set(),incoming=rowsFromCsv(text).map((row,index)=>{
    if(row.length!==8)fail(`Menu CSV row ${index+2} must contain eight values.`);
    const [rawId,rawName,rawThai,rawCategory,store,online,prep,rawStation]=row;
    const id=safeText(rawId,'SKU ID',60);if(!/^[A-Za-z0-9_-]+$/.test(id)||seen.has(id))fail(`Menu SKU IDs must be unique letters, numbers, hyphens or underscores. Check ${id}.`);seen.add(id);
    const prepMinutes=Number(prep.trim());if(!/^\d+$/.test(prep.trim())||prepMinutes<1||prepMinutes>60)fail(`Preparation minutes for ${id} must be a whole number from 1 to 60.`);
    return {id,name:safeText(rawName,'menu name',100),nameTh:safeText(rawThai,'Thai menu name',100,{optional:true}),category:safeText(rawCategory,'category',40),storePriceCents:cents(store,`Store price for ${id}`),onlinePriceCents:cents(online,`Online price for ${id}`),prepMinutes,station:safeText(rawStation,'station',30)};
  });
  return mergeMenuImport(existingMenu,incoming);
}

/** Matching IDs update in place; unmatched existing items, photos and history stay intact. */
export function mergeMenuImport(existingMenu,incoming) {
  if(!Array.isArray(existingMenu)||!Array.isArray(incoming)||!incoming.length||incoming.length>60)fail('Import 1 to 60 menu SKUs.');
  const ids=new Set(),drafts=new Map();
  for(const item of incoming){if(!item||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,60}$/.test(item.id)||ids.has(item.id))fail('Imported menu SKU IDs must be valid and unique.');ids.add(item.id);drafts.set(item.id,item);}
  const merged=existingMenu.map(item=>{const update=drafts.get(item.id);drafts.delete(item.id);return structuredClone(update?{...item,...update,available:update.available??item.available}:item);});
  for(const item of drafts.values())merged.push(structuredClone({...item,available:item.available??false}));
  if(!merged.length||merged.length>60)fail('The combined menu must contain 1 to 60 SKUs. Pause unused items or update matching IDs.');
  return merged;
}

export function createDemoMenuDraft() {
  const items=createCopilotState({businessId:'menu-draft-demo'}).menu.map(item=>({...item,photo:{kind:'generated',key:item.id}}));
  return {mode:'simulated',items,notice:'Simulated AI menu draft using six fixed sample dishes and AI-generated illustrations. No uploaded image was read and no live model was called. Review names, prices and availability before applying.'};
}
