import {esc,tr,itemName} from './views.mjs';
import {CopilotError} from './domain.mjs';
import {photoChoiceFields} from './menu-import-view.mjs';

export function menuEditorRow(item={},language,{isNew=false,demo=false,photoUrl,hero=false}={}) {
  const t=(en,th)=>tr(language,en,th),value=(name,fallback='')=>esc(item[name]??fallback);
  const title=isNew?t('New SKU','SKU ใหม่'):itemName(item,language);
  return `<fieldset class="cp-menu-edit" data-menu-item="${isNew?'':value('id')}"${isNew?' data-new-sku="true"':''}><legend>${esc(title)}</legend>
    ${photoChoiceFields(item,language,{demo,photoUrl,hero})}
    <label class="cp-field">${t('SKU ID','รหัส SKU')}<input name="id" value="${value('id')}" pattern="[A-Za-z0-9_-]+" maxlength="60" autocomplete="off" spellcheck="false" required ${isNew?'':'readonly'}><small>${t(isNew?'Use a unique ID with letters, numbers, hyphens or underscores.':'This ID stays fixed so orders and recipes keep their connection.',isNew?'ใช้รหัสไม่ซ้ำ ประกอบด้วยตัวอักษรอังกฤษ ตัวเลข ขีดกลาง หรือขีดล่าง':'รหัสนี้คงเดิมเพื่อเชื่อมออเดอร์และสูตรอย่างต่อเนื่อง')}</small></label>
    <div class="cp-form-pair"><label class="cp-field">${t('English name','ชื่อภาษาอังกฤษ')}<input name="name" value="${value('name')}" maxlength="100" required></label><label class="cp-field">${t('Thai name','ชื่อภาษาไทย')}<input name="nameTh" value="${value('nameTh')}" maxlength="100"></label></div>
    <div class="cp-form-pair"><label class="cp-field">${t('Category','หมวดหมู่')}<input name="category" value="${value('category')}" maxlength="40" placeholder="${t('Food, drinks, products…','อาหาร เครื่องดื่ม สินค้า…')}" required></label><label class="cp-field">${t('Preparation station','จุดเตรียมสินค้า')}<input name="station" value="${value('station','main')}" maxlength="30" required><small>${t('Items sharing a station share its queue capacity.','รายการที่ใช้จุดเตรียมเดียวกันจะใช้กำลังการเตรียมร่วมกัน')}</small></label></div>
    <div class="cp-form-pair"><label class="cp-field">${t('Store price (THB)','ราคาหน้าร้าน (บาท)')}<input name="storePriceCents" type="number" inputmode="decimal" min="0" max="50000" step=".01" value="${item.storePriceCents==null?'':esc((item.storePriceCents/100).toFixed(2))}" required></label><label class="cp-field">${t('Online price (THB)','ราคาออนไลน์ (บาท)')}<input name="onlinePriceCents" type="number" inputmode="decimal" min="0" max="50000" step=".01" value="${item.onlinePriceCents==null?'':esc((item.onlinePriceCents/100).toFixed(2))}" required></label></div>
    <label class="cp-field">${t('Preparation minutes per item','เวลาเตรียมต่อรายการ (นาที)')}<input name="prepMinutes" type="number" inputmode="numeric" min="1" max="60" step="1" value="${value('prepMinutes',1)}" required></label>
    <label class="cp-check"><input name="available" type="checkbox" ${item.available?'checked':''}>${t('Available in the customer menu','เปิดขายในเมนูลูกค้า')}</label>${isNew?`<p class="cp-note">${t('Review both prices before switching availability on.','ตรวจสอบราคาทั้งสองช่องทางก่อนเปิดขาย')}</p>`:''}</fieldset>`;
}

export function menuEditor(state,language,{items=state.menu,importing=false,demo=false,photoUrl,editSku=null}={}) {
  const single=editSku!==null;
  if(single){
    if(importing)throw new CopilotError('Review imports in the full menu editor.',400);
    const item=state.menu.find(item=>item.id===editSku);
    if(!item)throw new CopilotError('This dish is no longer in the menu. Reopen the latest menu.',409);
    items=[item];
  }
  return `<form id="cp-menu-form" class="cp-form${single?' cp-single-dish-form':''}"${single?` data-edit-sku="${esc(editSku)}"`:''}>
    ${single?'':`<p class="cp-note">${tr(language,'Keep 1–60 SKUs. Turn availability off to pause an item while retaining its order history and recipe.','รองรับ 1–60 SKU ปิดการขายรายการเพื่อพักไว้ โดยเก็บประวัติออเดอร์และสูตรเดิม')}</p>`}
    <div id="cp-menu-editor-rows">${items.map(item=>menuEditorRow(item,language,{isNew:!state.menu.some(old=>old.id===item.id),demo,photoUrl,hero:single})).join('')}</div>
    ${single?'':`<button class="cp-button secondary" type="button" data-action="new-sku" ${items.length>=60?'disabled':''}>${tr(language,'Add a SKU','เพิ่ม SKU')} +</button>`}
    ${importing?`<label class="cp-check"><input name="importReviewed" type="checkbox" required>${tr(language,'I reviewed the menu names, both prices and image choices.','ตรวจชื่อเมนู ราคาทั้งสองช่องทางและภาพแล้ว')}</label>`:''}
    <button class="cp-button" type="submit">${tr(language,single?'Save dish':'Save menu',single?'บันทึกเมนูนี้':'บันทึกเมนู')}</button>
  </form>`;
}

export function parseMenuEditor(form) {
  const rows=[...form.querySelectorAll('[data-menu-item]')],seen=new Set();
  const fail=message=>{throw new CopilotError(message,400);};
  if(rows.length<1||rows.length>60)fail('Keep 1 to 60 menu SKUs.');
  return rows.map((row,index)=>{
    const field=name=>{const input=row.querySelector(`[name="${name}"]`);if(!input)fail(`Menu row ${index+1} is incomplete.`);return input;};
    const text=(name,label,max,required=true)=>{const value=String(field(name).value).trim();if((required&&!value)||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail(`Enter a valid ${label} for menu row ${index+1} (up to ${max} characters).`);return value;};
    const id=text('id','SKU ID',60);
    if(!/^[A-Za-z0-9_-]+$/.test(id)||seen.has(id))fail(`SKU IDs must be unique letters, numbers, hyphens or underscores. Check ${id}.`);
    if(!row.hasAttribute('data-new-sku')&&row.dataset.menuItem!==id)fail('Existing SKU IDs cannot be changed. Add a new SKU instead.');
    seen.add(id);
    const price=(name,label)=>{const raw=String(field(name).value).trim();if(!/^\d+(?:\.\d{1,2})?$/.test(raw))fail(`${label} must be a non-negative amount with at most two decimal places.`);const [whole,fraction='']=raw.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents>5_000_000)fail(`${label} must be no more than THB 50,000.`);return cents;};
    const prep=String(field('prepMinutes').value).trim(),prepMinutes=Number(prep);
    if(!/^\d+$/.test(prep)||prepMinutes<1||prepMinutes>60)fail('Preparation time must be a whole number from 1 to 60 minutes.');
    if(row.dataset.photoPending==='true')fail('Wait for the dish photo to finish uploading.');
    const choice=row.querySelector('[name="photoChoice"]')?.value||'none';
    let photo=null;if(choice.startsWith('generated:'))photo={kind:'generated',key:choice.slice(10)};else if(choice.startsWith('uploaded:'))photo={kind:'uploaded',id:choice.slice(9)};else if(choice!=='none')fail('Choose a valid menu photo.');
    return {id,photo,name:text('name','English name',100),nameTh:text('nameTh','Thai name',100,false),category:text('category','category',40),station:text('station','preparation station',30),storePriceCents:price('storePriceCents','Store price'),onlinePriceCents:price('onlinePriceCents','Online price'),prepMinutes,available:field('available').checked};
  });
}
