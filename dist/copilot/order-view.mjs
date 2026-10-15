import {esc,tr,money,itemName,statusName} from './views.mjs';
import {menuDishPhoto,hasGeneratedMenuPhoto} from './photo-view.mjs';

const labelCategory=(category,language)=>category==='Kitchen'?tr(language,'From the kitchen','จากครัว'):category==='Drinks'?tr(language,'Drinks','เครื่องดื่ม'):category;
const quantityFor=(cart,id)=>{
  const quantity=Number(cart?.[id]??0);
  return Number.isInteger(quantity)&&quantity>0?Math.min(20,quantity):0;
};
const selectedItems=(data,cart)=>(data?.menu||[])
  .map(item=>({item,quantity:quantityFor(cart,item.id)}))
  .filter(line=>line.quantity>0);

/** Render only public menu fields: no private costs or online prices enter this view. */
export function orderMenuView({state,data,language='en',demo=false,category='all',cart={},table='',tracking=null}){
  const l=language,menu=data?.menu||[],shop=data?.shop||{};
  const categories=[...new Set(menu.map(item=>item.category))];
  const active=category==='all'||categories.includes(category)?category:'all';
  const shown=menu.filter(item=>active==='all'||item.category===active);
  const cartCount=selectedItems(data,cart).reduce((sum,line)=>sum+line.quantity,0);
  return `<div class="cp-shell cp-view cp-order-workspace cp-photo-menu">
    <section class="cp-order-masthead" data-reveal>
      <img class="cp-order-landscape" src="/images/studio-window.webp" alt="" width="1200" height="800">
      <div class="cp-order-masthead-copy">
        <p class="cp-eyebrow">${esc(shop.name||tr(l,'Your table menu','เมนูของร้าน'))} / ${tr(l,'IN-STORE MENU','เมนูหน้าร้าน')}</p>
        <h1>${tr(l,'Made to order.','เลือกมื้อของคุณ')}</h1>
        <p>${tr(l,'Choose your dishes. Send to the kitchen. Pay with the merchant.','เลือกเมนู ส่งให้ครัว แล้วชำระกับร้านโดยตรง')}</p>
        ${demo?`<span class="cp-pill">${tr(l,'Simulated menu · no real order','เมนูจำลอง · ไม่ใช่ออเดอร์จริง')}</span>`:''}
        <div class="cp-menu-management"><button class="cp-button secondary" type="button" data-action="edit-menu">${tr(l,'Edit menu','แก้ไขเมนู')} <span aria-hidden="true">↗</span></button><button class="cp-button quiet" type="button" data-action="import-menu">${tr(l,'Import menu','นำเข้าเมนู')} <span aria-hidden="true">+</span></button></div>
      </div>
    </section>
    <div class="cp-order-layout">
      <section class="cp-order-menu" aria-label="${tr(l,'Menu and order','เมนูและออเดอร์')}">
        ${tracking?trackingPanel(tracking,l,demo):`
        <div class="cp-order-menu-heading" data-reveal><h2>${tr(l,'The menu','รายการอาหาร')}</h2><span>${tr(l,'In-store prices','ราคาหน้าร้าน')}</span></div>
        <div class="cp-menu-categories cp-order-categories" role="group" aria-label="${tr(l,'Menu categories','หมวดหมู่เมนู')}">
          ${['all',...categories].map(value=>`<button type="button" data-category="${esc(value)}" aria-pressed="${active===value}">${esc(value==='all'?tr(l,'Everything','ทั้งหมด'):labelCategory(value,l))}</button>`).join('')}
        </div>
        ${menu.some(item=>hasGeneratedMenuPhoto(item,{demo}))?`<p class="cp-menu-photo-note">${tr(l,'AI-generated food images are illustrative. Use your own photos for the actual menu.','ภาพอาหารจาก AI เป็นภาพประกอบ ใช้ภาพของร้านสำหรับเมนูจริง')}</p>`:''}
        <a class="cp-basket-jump cp-link" href="#cp-embedded-cart" data-action="jump-cart">${tr(l,'View your selection','ดูรายการที่เลือก')} <span aria-hidden="true">↓</span></a>
        ${!shop.accepting?`<p class="cp-note cp-order-paused" role="status">${tr(l,'QR ordering is paused. Ask the merchant to open ordering.','พักรับออเดอร์ QR กรุณาให้ร้านเปิดรับออเดอร์')}</p>`:''}
        <div class="cp-order-dishes">
          ${shown.map(item=>dishRow(item,menu.indexOf(item)+1,{l,cart,cartCount,demo,publicKey:state?.publicKey,accepting:!!shop.accepting})).join('')||`<p class="cp-empty">${tr(l,'No available dishes in this category.','ยังไม่มีเมนูพร้อมขายในหมวดนี้')}</p>`}
        </div>`}
        <div class="cp-order-flow-links">
          <a class="cp-link" href="#service">${tr(l,'Kitchen queue','คิวในครัว')} <span aria-hidden="true">↗</span></a>
          <a class="cp-link" href="#intelligence">${tr(l,'Cost intelligence','ดูต้นทุนต่อจาน')} <span aria-hidden="true">↗</span></a>
        </div>
      </section>
      <aside class="cp-order-sidebar" aria-label="${tr(l,'Basket and table QR','รายการที่เลือกและ QR ประจำโต๊ะ')}">
        <div id="cp-embedded-cart" tabindex="-1"${tracking?' hidden':''}>${cartView({data,language:l,demo,cart})}</div>
        <section class="cp-embedded-qr" aria-labelledby="cp-order-qr-title">
          <div class="cp-embedded-qr-copy"><p class="cp-eyebrow">${tr(l,'AT THE TABLE','สำหรับโต๊ะนี้')}</p><h2 id="cp-order-qr-title">${tr(l,'Scan & choose.','สแกนแล้วเลือก')}</h2></div>
          <label class="cp-field" for="cp-qr-table">${tr(l,'Table label','ชื่อโต๊ะ')}<input id="cp-qr-table" value="${esc(table)}" maxlength="40" autocomplete="off"></label>
          <div class="cp-qr-art"><canvas id="cp-qr" aria-label="${tr(l,'QR code for this table menu','QR โค้ดเมนูของโต๊ะนี้')}"></canvas></div>
          <a class="cp-button secondary" id="cp-menu-link" href="#">${tr(l,'Open customer menu','เปิดเมนูฝั่งลูกค้า')} <span aria-hidden="true">↗</span></a>
          <p class="cp-note">${demo?tr(l,'Demo orders stay in this browser. A different device gets its own sample.','เดโมเก็บออเดอร์ในเบราว์เซอร์นี้ อุปกรณ์อื่นใช้ข้อมูลตัวอย่างแยกกัน'):tr(l,'Customers order at your in-store prices. Payment stays with your merchant.','ลูกค้าสั่งด้วยราคาหน้าร้าน และชำระเงินกับร้านโดยตรง')}</p>
        </section>
      </aside>
    </div>
  </div>`;
}

function dishRow(item,index,{l,cart,cartCount,demo,publicKey,accepting}){
  const quantity=quantityFor(cart,item.id),name=itemName(item,l);
  return `<article class="cp-order-dish" data-reveal>
    <div class="cp-dish-photo-source" data-dish-source="${esc(item.id)}">${menuDishPhoto(item,{language:l,demo,publicKey,index})}<button class="cp-dish-photo-edit" type="button" data-edit-dish="${esc(item.id)}" aria-label="${esc(tr(l,'Edit ','แก้ไข ')+name)}" aria-haspopup="dialog"><span>${tr(l,'Edit','แก้ไข')}</span></button></div>
    <div class="cp-food-copy"><div class="cp-order-dish-copy"><p>${esc(labelCategory(item.category,l))}</p><h3><button class="cp-dish-name-edit" type="button" data-edit-dish="${esc(item.id)}" aria-label="${esc(tr(l,'Edit ','แก้ไข ')+name)}" aria-haspopup="dialog">${esc(name)}</button></h3><span>${esc(item.prepMinutes)} ${tr(l,'min prep · queue additional','นาทีเตรียม · ยังไม่รวมคิว')}</span></div>
    <div class="cp-order-dish-action"><strong>${money(item.storePriceCents,l)}</strong><button type="button" data-add="${esc(item.id)}" aria-label="${esc(tr(l,'Add ','เพิ่ม ')+name)}" ${!accepting||quantity>=20||cartCount>=50?'disabled':''}><span aria-hidden="true">+</span></button><small data-selected="${esc(item.id)}"${quantity?'':' hidden'}>${quantity} ${tr(l,'selected','ที่เลือก')}</small></div></div>
  </article>`;
}

export function cartView({data,language='en',demo=false,cart={}}){
  const l=language,items=selectedItems(data,cart),count=items.reduce((sum,line)=>sum+line.quantity,0);
  const total=items.reduce((sum,{item,quantity})=>sum+item.storePriceCents*quantity,0);
  return `<section class="cp-basket" aria-labelledby="cp-basket-title">
    <div class="cp-basket-heading"><div><p class="cp-eyebrow">${tr(l,'YOUR SELECTION','รายการที่เลือก')}</p><h2 id="cp-basket-title">${tr(l,'For the table.','สำหรับโต๊ะนี้')}</h2></div><span class="cp-basket-count"><strong id="cp-cart-count">${count}</strong><span class="sr-only"> ${tr(l,'items selected','รายการที่เลือก')}</span></span></div>
    ${items.length?`<ul class="cp-basket-items">${items.map(({item,quantity})=>`<li><div class="cp-basket-item-heading"><h3>${esc(itemName(item,l))}</h3><strong>${money(item.storePriceCents*quantity,l)}</strong></div><div class="cp-basket-item-controls"><span>${money(item.storePriceCents,l)} ${tr(l,'each','ต่อรายการ')}</span><div class="cp-quantity" role="group" aria-label="${esc(tr(l,'Quantity for ','จำนวน ')+itemName(item,l))}"><button type="button" data-remove="${esc(item.id)}" aria-label="${esc(tr(l,'Remove one ','ลดหนึ่งรายการ ')+itemName(item,l))}"><span aria-hidden="true">−</span></button><span>${quantity}</span><button type="button" data-add="${esc(item.id)}" aria-label="${esc(tr(l,'Add one ','เพิ่มหนึ่งรายการ ')+itemName(item,l))}" ${quantity>=20||count>=50||!data?.shop?.accepting?'disabled':''}><span aria-hidden="true">+</span></button></div></div></li>`).join('')}</ul>`:`<p class="cp-basket-empty">${tr(l,'Add a dish to begin your order.','เลือกเมนูเพื่อเริ่มออเดอร์')}</p>`}
    <div class="cp-basket-total"><span>${tr(l,'Order value','มูลค่าออเดอร์')}</span><strong>${money(total,l)}</strong></div>
    <button class="cp-button" type="button" data-action="review-cart" ${!count||count>50||!data?.shop?.accepting?'disabled':''}>${tr(l,'Review order','ตรวจสอบออเดอร์')} <span aria-hidden="true">→</span></button>
    <p class="cp-basket-payment">${demo?tr(l,'Simulated order. No food or payment.','ออเดอร์จำลอง ไม่มีการเตรียมอาหารหรือชำระเงิน'):tr(l,'Pay directly with the merchant. No payment is processed here.','ชำระกับร้านโดยตรง ไม่มีการรับชำระเงินที่นี่')}</p>
  </section>`;
}

function trackingPanel(order,l,demo){
  const waiting=['queued','preparing'].includes(order.status),eta=Number.isFinite(order.etaMinutes)&&order.etaMinutes>=0?order.etaMinutes:null;
  return `<section class="cp-embedded-tracking" data-reveal aria-labelledby="cp-embedded-status">
    <p class="cp-eyebrow">${demo?tr(l,'SIMULATED ORDER','ออเดอร์จำลอง'):tr(l,'ORDER UPDATE','สถานะออเดอร์')}</p>
    <div class="cp-embedded-order-number"><span>${tr(l,'Order','ออเดอร์')}</span><strong>#${esc(String(order.number).padStart(2,'0'))}</strong></div>
    <h2 id="cp-embedded-status">${esc(statusName(order.status,l))}</h2>
    <p>${waiting&&eta!==null?tr(l,`Estimated ready in ~${eta} min.`,`คาดว่าพร้อมใน ~${eta} นาที`):tr(l,'Check with the merchant for collection.','สอบถามร้านเพื่อรับอาหาร')}</p>
    ${order.table?`<span class="cp-pill">${esc(order.table)}</span>`:''}
    <div class="cp-hero-actions"><button type="button" class="cp-button" data-action="back-menu">${tr(l,'Start another order','เริ่มออเดอร์ใหม่')} <span aria-hidden="true">+</span></button><button type="button" class="cp-button quiet" data-action="refresh-tracking">${tr(l,'Refresh status','รีเฟรชสถานะ')}</button></div>
    <p class="cp-note">${tr(l,'Order acknowledgement only. Payment is arranged with the merchant. Preparation time is an estimate.','นี่คือการรับทราบออเดอร์เท่านั้น ชำระเงินกับร้านโดยตรง เวลาเตรียมเป็นการประมาณ')}</p>
  </section>`;
}
