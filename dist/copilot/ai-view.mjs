import {esc,tr,money} from './views.mjs';

const localized=(value,l,key)=>l==='th'&&value?.[`${key}Th`]?value[`${key}Th`]:value?.[key]??'';
const currency=(value,l)=>Number.isFinite(value)?money(value,l):'—';
const sum=(rows,key)=>rows.every(row=>Number.isFinite(row[key]))?rows.reduce((total,row)=>total+row[key],0):null;
const linkUrl=url=>{try{const parsed=new URL(url);return parsed.protocol==='https:'?parsed.href:null;}catch{return null;}};
const stage=(number,label)=>`<p class="cp-ai-stage-label"><span>${number}</span><span>${label}</span></p>`;
const sourceLink=(source,l)=>{const href=linkUrl(source?.url);return href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} <span aria-hidden="true">↗</span></a>`:`<span>${esc(source?.title||source?.id||tr(l,'Demo evidence','หลักฐานเดโม'))}</span>`;};

export function aiView({language='en',demo=false,aiState,summary,messages=[]}){
  const l=language;
  if(!demo)return `<div class="cp-shell cp-view cp-ai-view"><section class="cp-ai-intro" data-reveal><span class="cp-ai-badge">${tr(l,'AI provider not enabled','ยังไม่เปิดใช้ผู้ให้บริการ AI')}</span><h1>${tr(l,'Your ingredient<br>copilot.','ผู้ช่วยที่รู้จัก<br>วัตถุดิบของคุณ')}</h1></section><section class="cp-ai-disabled" data-reveal><h2>${tr(l,'Explore the rehearsal.','ทดลองขั้นตอนจำลอง')}</h2><p>${tr(l,'The Gemini and custom ingredient layer shown in this experience are simulated. Live model responses and custom model training are not enabled here.','ขั้นตอน Gemini และชั้นความรู้วัตถุดิบในประสบการณ์นี้เป็นการจำลอง ยังไม่เปิดใช้คำตอบจากโมเดลจริงหรือการฝึกโมเดลเฉพาะ')}</p><a class="cp-button" href="/copilot/demo#ai">${tr(l,'Open AI simulation','เปิดเดโม AI จำลอง')} <span aria-hidden="true">↗</span></a></section></div>`;
  if(!summary?.receipt)return `<div class="cp-shell cp-view cp-ai-view"><div class="cp-empty" role="status">${tr(l,'Preparing the AI simulation.','กำลังเตรียมเดโม AI จำลอง')}</div></div>`;
  const receipt=summary.receipt,weeks=summary.weeklyMetrics||[],review=summary.stockReview||{},prep=summary.suggestedPrep||{};
  const confirmed=receipt.confirmed===true,storage=aiState?.storage||'unknown',demand=aiState?.demandPercent||100;
  const sources=summary.sources||[],food=sources.find(source=>source.id==='foodsafety');
  const orderValue=sum(weeks,'orderValueCents'),purchases=sum(weeks,'purchaseCents'),contribution=sum(weeks,'contributionCents');
  const pending=sum(weeks,'pendingPurchaseCents')||0;
  return `<div class="cp-shell cp-view cp-ai-view">
    <section class="cp-ai-intro" data-reveal>
      <span class="cp-ai-badge">${tr(l,'AI simulation · no live model','AI จำลอง · ไม่เรียกโมเดลจริง')}</span>
      <h1>${tr(l,'From receipt<br>to the next service.','จากใบซื้อ<br>สู่แผนมื้อถัดไป')}</h1>
      <p>${tr(l,'Confirm a purchase. Follow its cost. Adjust tomorrow’s preparation.','ยืนยันใบซื้อ เห็นต้นทุนต่อจาน แล้วปรับแผนเตรียมครั้งถัดไป')}</p>
      <div class="cp-ai-status"><span>${tr(l,'Gemini + custom ingredient layer · simulated','Gemini + ชั้นความรู้วัตถุดิบเฉพาะ · จำลอง')}</span><span>${tr(l,'Custom training is proposed, not completed.','การฝึกโมเดลเฉพาะเป็นแนวทางที่เสนอ ยังไม่ได้ฝึกจริง')}</span></div>
    </section>
    <div class="cp-receipt-story" data-receipt-story data-story-step="all">
      ${receiptStoryControls(receipt,l)}
      <div class="cp-ai-receipt-layout">
      <section class="cp-ai-receipt" data-reveal>
        ${stage('01',tr(l,'READ THE EVIDENCE','อ่านหลักฐาน'))}
        <div class="cp-ai-paper" data-story-target="receipt"><span class="cp-story-sheen-window" aria-hidden="true"><span class="cp-story-sheen" data-story-sheen></span></span>
          <div class="cp-ai-paper-top"><strong>${tr(l,'Soi supplier receipt','ใบซื้อวัตถุดิบซอย')}</strong><span>${tr(l,'SIMULATED OCR','OCR จำลอง')}</span></div>
          <dl><div data-story-highlight><dt>${tr(l,'Purchase date','วันที่ซื้อ')}</dt><dd>${esc(receipt.dateRaw)}</dd></div><div data-story-highlight><dt>${tr(l,'Normalized date','วันที่แปลงแล้ว')}</dt><dd>${esc(receipt.dateISO)}</dd></div></dl>
          <ul class="cp-ai-paper-lines"><li data-story-highlight><div>${esc(l==='th'?receipt.nameTh:receipt.ingredient)}<small>${esc(receipt.purchaseQuantity)} ${esc(receipt.purchaseUnit)} × ${currency(receipt.unitCostCentsPerKg,l)} / kg</small></div><strong>${currency(receipt.purchaseCostCents,l)}</strong></li></ul>
          <div class="cp-ai-paper-total"><span>${tr(l,'Purchase amount','มูลค่าซื้อ')}</span><strong>${currency(receipt.purchaseCostCents,l)}</strong></div>
          <p class="cp-ai-date-note">${tr(l,'Thai year 2569 → 2026. A purchase date is not an expiry date.','พ.ศ. 2569 → ค.ศ. 2026 วันที่ซื้อไม่ใช่วันหมดอายุ')}</p>
        </div>
        <div class="cp-ai-confirm"><button id="cp-ai-confirm" class="cp-button" type="button" data-ai-action="confirm-receipt" aria-pressed="${confirmed}">${confirmed?tr(l,'Sample confirmed','ยืนยันตัวอย่างแล้ว'):tr(l,'Confirm sample receipt','ยืนยันใบซื้อตัวอย่าง')} ${confirmed?'':'<span aria-hidden="true">→</span>'}</button><p>${confirmed?tr(l,'The reviewed cost now feeds the comparison.','ต้นทุนที่ตรวจแล้วใช้คำนวณการเปรียบเทียบ'):tr(l,'Check the ingredient, amount and purchase date first.','ตรวจวัตถุดิบ จำนวนเงิน และวันที่ซื้อก่อน')}</p></div>
      </section>
      <section class="cp-ai-ingredients" data-reveal>
        ${stage('02',tr(l,'CONNECT THE INGREDIENT','เชื่อมข้อมูลวัตถุดิบ'))}
        <h2 class="cp-ai-stage-title">${tr(l,'An ingredient.<br>A cost you can trace.','เห็นต้นทุนวัตถุดิบ<br>พร้อมที่มา')}</h2>
        <div class="cp-ai-batch cp-story-ingredient" data-story-target="ingredient"><span class="cp-story-sheen-window" aria-hidden="true"><span class="cp-story-sheen" data-story-sheen></span></span><header><h3>${esc(l==='th'?receipt.nameTh:receipt.ingredient)}</h3><span class="cp-pill">${confirmed?tr(l,'Reviewed sample','ตรวจตัวอย่างแล้ว'):tr(l,'Awaiting review','รอตรวจสอบ')}</span></header><div class="cp-ai-batch-meta"><div><small>${tr(l,'Purchase → grams','แปลงหน่วยซื้อเป็นกรัม')}</small><strong>${esc(receipt.purchaseQuantity)} ${esc(receipt.purchaseUnit)} <span aria-hidden="true">→</span> ${esc(receipt.quantityG)} g</strong></div><div><small>${tr(l,'Cost per kilogram','ต้นทุนต่อกิโลกรัม')}</small><strong>${currency(receipt.unitCostCentsPerKg,l)} / kg</strong></div></div></div>
        <div class="cp-story-plate" data-story-target="plate"><span class="cp-story-sheen-window" aria-hidden="true"><span class="cp-story-sheen" data-story-sheen></span></span><figure><img src="/images/menu/basil-chicken.webp" width="960" height="720" alt="${tr(l,'AI-generated illustration of basil chicken rice','ภาพ AI ประกอบข้าวกะเพราไก่')}" loading="lazy" decoding="async"><figcaption>${tr(l,'AI illustration','ภาพ AI ประกอบ')}</figcaption></figure><div class="cp-story-plate-cost"><p>${tr(l,'Sample plate · chicken component','จานตัวอย่าง · เฉพาะต้นทุนไก่')}</p><strong>${currency(receipt.portionCostCents,l)}</strong><span>${tr(l,'Merchant portion','ปริมาณต่อจานที่ร้านกำหนด')} · ${esc(receipt.portionG)} g</span><small>${confirmed?tr(l,'Reviewed ingredient cost, not the full plate cost.','ตรวจแล้ว เฉพาะวัตถุดิบนี้ ไม่ใช่ต้นทุนทั้งจาน'):tr(l,'Preview · confirm the receipt to use this cost.','ตัวอย่าง · ยืนยันใบซื้อก่อนนำต้นทุนไปใช้')}</small></div></div>
        <div class="cp-ai-storage-control">${storageControl(storage,l)}</div>
        <div class="cp-ai-safety" data-status="${storage==='unknown'?'unknown':'chilled'}"><small class="cp-ai-snapshot">${tr(l,'Demo snapshot: ','วันที่อ้างอิงของเดโม: ')}${esc(summary.window?.asOf)}</small><strong>${review.status==='review-due'?tr(l,'Stock review · ','ตรวจสต็อก · ')+esc(review.reviewOn):esc(localized(review,l,'title'))}</strong><p>${safetySummary(review,l)}</p><details class="cp-ai-safety-details"><summary>${tr(l,'Storage guidance & assumptions','แนวทางการเก็บและสมมติฐาน')}</summary><p>${esc(localized(review,l,'detail'))}</p>${food?`<a class="cp-link" href="${esc(linkUrl(food.url))}" target="_blank" rel="noopener noreferrer">${tr(l,'FoodSafety.gov storage reference','อ้างอิงการเก็บจาก FoodSafety.gov')} <span aria-hidden="true">↗</span></a>`:''}</details></div>
        <p class="cp-ai-layer-note">${tr(l,'This rehearsal uses fixed evidence and explicit rules. It does not run OCR, Gemini, ML training or a learned safety prediction.','เดโมนี้ใช้หลักฐานตัวอย่างและกฎที่กำหนด ไม่ได้รัน OCR, Gemini, ฝึก ML หรือทำนายความปลอดภัยด้วยโมเดล')}</p>
      </section>
      </div>
    </div>
    <section class="cp-ai-analysis" data-reveal>
      <div class="cp-ai-section-head"><div>${stage('03',tr(l,'COMPARE THE BUSINESS','เปรียบเทียบธุรกิจ'))}<h2 class="cp-ai-stage-title">${tr(l,'Fourteen days.<br>A clearer picture.','เห็นภาพชัดขึ้น<br>จากข้อมูล 14 วัน')}</h2></div><p class="cp-ai-period">${esc(summary.window?.start)} — ${esc(summary.window?.end)}<br>${tr(l,'Fixed fictional comparison','ชุดข้อมูลสมมติคงที่')}</p></div>
      <div class="cp-ai-metrics"><div class="cp-ai-metric"><small>${tr(l,'Completed order value','มูลค่าออเดอร์ที่เสิร์ฟแล้ว')}</small><strong>${currency(orderValue,l)}</strong><p>${tr(l,'Cancelled portions excluded','ไม่รวมรายการที่ยกเลิก')}</p></div><div class="cp-ai-metric"><small>${tr(l,'Estimated contribution','กำไรส่วนเกินโดยประมาณ')}</small><strong>${currency(contribution,l)}</strong><p>${confirmed?tr(l,'Before overhead and tax','ยังไม่รวมค่าใช้จ่ายคงที่และภาษี'):tr(l,'Confirm the receipt to calculate','ยืนยันใบซื้อเพื่อคำนวณ')}</p></div><div class="cp-ai-metric"><small>${tr(l,'Reviewed chicken purchases','ยอดซื้อไก่ที่ตรวจแล้ว')}</small><strong>${currency(purchases,l)}</strong><p>${pending?tr(l,`${currency(pending,l)} pending review`,`${currency(pending,l)} รอตรวจสอบ`):tr(l,'Purchase spending, separate from recipe cost','ยอดซื้อแยกจากต้นทุนที่ใช้ขาย')}</p></div></div>
      ${weeklyComparison(weeks,l)}
      <p class="cp-ai-accounting-note">${tr(l,'The 14 days are a business-analysis window, never chicken shelf life. Purchases record spending; recipe cost estimates ingredients used in completed portions. Contribution is before fixed overhead, tax and missing costs—not net profit, collected cash or proof that AI caused an improvement.','14 วันคือช่วงวิเคราะห์ธุรกิจ ไม่ใช่อายุเก็บไก่ ยอดซื้อคือเงินที่ใช้ซื้อ ส่วนต้นทุนสูตรประมาณวัตถุดิบที่ใช้ในรายการเสิร์ฟแล้ว กำไรส่วนเกินยังไม่รวมค่าใช้จ่ายคงที่ ภาษีและต้นทุนที่ขาด ไม่ใช่กำไรสุทธิ ยอดรับเงินจริง หรือหลักฐานว่า AI ทำให้กำไรเพิ่ม')}</p>
      ${summary.currentService?currentService(summary.currentService,l):''}
    </section>
    <section class="cp-ai-plan" data-reveal>
      <div class="cp-ai-plan-settings">${stage('04',tr(l,'ADAPT THE NEXT SERVICE','ปรับแผนครั้งถัดไป'))}<h2 class="cp-ai-stage-title">${tr(l,'Try a different day.','ลองปรับสถานการณ์')}</h2><div class="cp-ai-controls"><label class="cp-field" for="cp-ai-demand">${tr(l,'Demand scenario','สถานการณ์ความต้องการ')}<select id="cp-ai-demand" name="demand">${[[80,'Quieter · 80%','ลดลง · 80%'],[100,'Baseline · 100%','ฐานเดิม · 100%'],[120,'Busier · 120%','เพิ่มขึ้น · 120%']].map(([value,en,th])=>`<option value="${value}" ${demand===value?'selected':''}>${tr(l,en,th)}</option>`).join('')}</select></label></div></div>
      <div class="cp-ai-plan-result"><small>${tr(l,'ILLUSTRATIVE PREP TARGET','เป้าหมายเตรียมตัวอย่าง')}</small><div class="cp-ai-plan-amount">${esc(prep.plates)} <span>${tr(l,'portions','จาน')}</span></div><p>${esc(prep.chickenG)} g ${tr(l,'chicken at the entered portion size.','ไก่ตามปริมาณต่อจานที่กำหนด')}</p><ul class="cp-ai-actions"><li><span aria-hidden="true">01</span><div><strong>${tr(l,'Review the daily target','ตรวจเป้าหมายรายวัน')}</strong><p>${esc(localized(prep,l,'method'))}</p></div></li><li><span aria-hidden="true">02</span><div><strong>${tr(l,'Check usable stock first','ตรวจสต็อกที่ใช้ได้ก่อน')}</strong><p>${esc(localized(prep,l,'reviewNote'))}</p></div></li></ul><a class="cp-link" href="#order">${tr(l,'Try it with the order menu','ทดลองผ่านเมนูสั่งอาหาร')} <span aria-hidden="true">↗</span></a></div>
    </section>
    <section class="cp-ai-advisor" data-reveal>
      <div class="cp-ai-advisor-copy"><p class="cp-ai-stage-label">${tr(l,'ASK THE EVIDENCE','ถามจากหลักฐาน')}</p><h2 class="cp-ai-stage-title">${tr(l,'A copilot<br>with context.','ผู้ช่วยที่เข้าใจ<br>ข้อมูลของร้าน')}</h2><p>${tr(l,'Ask about this receipt, the two-week comparison or your current demo service. Answers use the visible sample evidence.','ถามเรื่องใบซื้อนี้ การเปรียบเทียบสองสัปดาห์ หรือรอบบริการเดโมปัจจุบัน คำตอบอ้างอิงข้อมูลตัวอย่างที่แสดง')}</p><div class="cp-ai-prompts">${[tr(l,'Why are purchases different from recipe costs?','ทำไมยอดซื้อต่างจากต้นทุนที่ใช้ขาย?'),tr(l,'How much should I prep tomorrow?','พรุ่งนี้ควรเตรียมเท่าไร?'),tr(l,'What do we know about storage safety?','เรารู้อะไรเรื่องความปลอดภัยในการเก็บ?')].map(prompt=>`<button type="button" data-ai-prompt="${esc(prompt)}">${esc(prompt)}</button>`).join('')}</div></div>
      <div class="cp-ai-conversation"><div class="cp-ai-messages" role="log" aria-label="${tr(l,'Simulated advisor conversation','บทสนทนาผู้ช่วยจำลอง')}" aria-live="polite" aria-relevant="additions text">${messages.length?messages.map(message=>messageView(message,sources,l)).join(''):`<p class="cp-ai-chat-empty">${tr(l,'What would you like to understand?','อยากเข้าใจส่วนไหนเพิ่มเติม?')}</p>`}</div><form id="cp-ai-form" class="cp-ai-composer"><label class="cp-field" for="cp-ai-question"><span>${tr(l,'Ask about the sample','ถามเรื่องข้อมูลตัวอย่าง')}</span><input id="cp-ai-question" name="question" required maxlength="1000" autocomplete="off" placeholder="${tr(l,'Ask your copilot…','ถามผู้ช่วยของคุณ…')}"></label><button class="cp-button" type="submit">${tr(l,'Ask','ถาม')} <span aria-hidden="true">↑</span></button></form><p class="cp-ai-layer-note">${tr(l,'Simulated replies. No API calls or model training.','คำตอบจำลอง ไม่มีการเรียก API หรือฝึกโมเดล')}</p></div>
    </section>
    ${sourceDetails(summary,l)}
  </div>`;
}


function receiptStoryControls(receipt,l){
  const pending=receipt.confirmed?'':tr(l,' Receipt confirmation is still required.',' ยังต้องยืนยันใบซื้อ');
  const announcements={
    receipt:tr(l,`Simulated receipt: ${receipt.dateRaw} becomes ${receipt.dateISO}.`,`ใบซื้อจำลอง: ${receipt.dateRaw} แปลงเป็น ${receipt.dateISO}`),
    ingredient:tr(l,`${receipt.purchaseQuantity} ${receipt.purchaseUnit} becomes ${receipt.quantityG} grams at ${currency(receipt.unitCostCentsPerKg,l)} per kilogram.`,`${receipt.purchaseQuantity} ${receipt.purchaseUnit} เท่ากับ ${receipt.quantityG} กรัม ต้นทุน ${currency(receipt.unitCostCentsPerKg,l)} ต่อกิโลกรัม`),
    plate:tr(l,`${receipt.portionG} grams per portion gives ${currency(receipt.portionCostCents,l)} of chicken cost, not the full plate cost.`,`${receipt.portionG} กรัมต่อจาน มีต้นทุนไก่ ${currency(receipt.portionCostCents,l)} ไม่ใช่ต้นทุนทั้งจาน`)+pending,
  };
  return `<div class="cp-story-toolbar" data-story-controls hidden><div class="cp-story-steps" role="group" aria-label="${tr(l,'Follow the sample cost','ติดตามต้นทุนตัวอย่าง')}">${[['receipt','Receipt','ใบซื้อ'],['ingredient','Ingredient','วัตถุดิบ'],['plate','Plate','ต่อจาน']].map(([key,en,th],index)=>`<button type="button" data-story-step-button="${key}" data-story-announcement="${esc(announcements[key])}"><span aria-hidden="true">0${index+1}</span>${tr(l,en,th)}</button>`).join('')}</div><div class="cp-story-actions"><button class="cp-button secondary" type="button" data-story-play data-story-replay="${tr(l,'Replay sequence','เล่นอีกครั้ง')}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 1 8 5-8 5Z" fill="currentColor"/></svg><span data-story-play-label>${tr(l,'Play sequence','เล่นลำดับขั้นตอน')}</span></button><button class="cp-link" type="button" data-story-all>${tr(l,'Show all','แสดงทั้งหมด')}</button></div><p class="cp-story-caption">${tr(l,'Simulated receipt → ingredient → plate','ใบซื้อจำลอง → วัตถุดิบ → ต่อจาน')}</p><p class="cp-story-status" data-story-status role="status" aria-live="polite" aria-atomic="true" data-story-complete="${esc(tr(l,'Sequence complete. Sample evidence is shown.', 'แสดงหลักฐานตัวอย่างครบแล้ว')+pending)}"></p></div>`;
}

function storageControl(storage,l){
  return `<label class="cp-field" for="cp-ai-storage">${tr(l,'Storage assumption','สมมติฐานการเก็บ')}<select id="cp-ai-storage" name="storage"><option value="unknown" ${storage==='unknown'?'selected':''}>${tr(l,'Unknown / not confirmed','ยังไม่ทราบ / ยังไม่ยืนยัน')}</option><option value="chilled" ${storage==='chilled'?'selected':''}>${tr(l,'Continuously chilled ≤4°C (assumed)','แช่เย็นต่อเนื่อง ≤4°C (สมมติ)')}</option></select></label>`;
}

function safetySummary(review,l){
  if(review.status==='review-due')return tr(l,'FoodSafety.gov lists 1–2 days for raw chicken refrigerated at 4°C or below. This is a review reminder, not an expiry date or assurance that the food is safe. Check the actual label and cold-chain history.','FoodSafety.gov ระบุไก่ดิบแช่เย็นไม่เกิน 4°C ไว้ 1–2 วัน นี่คือการเตือนตรวจ ไม่ใช่วันหมดอายุหรือการรับรองความปลอดภัย ต้องตรวจฉลากจริงและประวัติอุณหภูมิ');
  if(review.status==='storage-unknown')return tr(l,'No reminder is created while storage history is unknown. A purchase date cannot determine expiry or safe condition.','ยังไม่สร้างการเตือนเมื่อไม่ทราบประวัติการเก็บ วันที่ซื้อบอกวันหมดอายุหรือสภาพที่ปลอดภัยไม่ได้');
  return tr(l,'Confirm the date and ingredient first. No stock reminder is created, and actual expiry remains unknown.','ยืนยันวันที่และวัตถุดิบก่อน ยังไม่สร้างการเตือนตรวจสต็อก และยังไม่ทราบวันหมดอายุจริง');
}

function weeklyComparison(weeks,l){
  const maximum=Math.max(1,...weeks.map(week=>Number.isFinite(week.contributionCents)?Math.max(0,week.contributionCents):0));
  return `<div class="cp-ai-week-comparison">${weeks.map(week=>{
    const known=Number.isFinite(week.contributionCents),width=known?Math.max(0,Math.min(100,week.contributionCents/maximum*100)):0;
    return `<div class="cp-ai-week"><header><span>${esc(localized(week,l,'label'))} · ${tr(l,'contribution','กำไรส่วนเกิน')}</span><strong>${currency(week.contributionCents,l)}</strong></header><div class="cp-ai-week-track" aria-hidden="true"><span style="--week-width:${width.toFixed(2)}%"></span></div><p>${esc(week.completedPortions)} ${tr(l,'completed portions','จานที่เสิร์ฟแล้ว')} · ${esc(week.cancelledPortions)} ${tr(l,'cancelled, excluded','จานยกเลิก ไม่นำมาคิด')}${known?'':`<br>${tr(l,'Awaiting receipt confirmation','รอยืนยันใบซื้อ')}`}</p></div>`;
  }).join('')}</div>`;
}

function currentService(current,l){
  return `<aside class="cp-ai-current"><div><p class="cp-eyebrow">${tr(l,'CURRENT DEMO SERVICE','รอบบริการเดโมปัจจุบัน')}</p><h3>${tr(l,'Your menu, connected.','เชื่อมกับเมนูของคุณ')}</h3></div><dl><div><dt>${tr(l,'Items','รายการ')}</dt><dd>${esc(current.quantity)}</dd></div><div><dt>${tr(l,'Order value','มูลค่าออเดอร์')}</dt><dd>${currency(current.orderValueCents,l)}</dd></div><div><dt>${tr(l,'Est. contribution','กำไรส่วนเกินโดยประมาณ')}</dt><dd>${currency(current.contributionCents,l)}</dd></div></dl><p>${esc(localized(current,l,'basis'))}</p></aside>`;
}

function messageView(message,catalog,l){
  const role=message.role==='user'?'user':'assistant';
  const sources=(message.sources||[]).map(source=>typeof source==='string'?catalog.find(item=>item.id===source)||{id:source}:source);
  return `<article class="cp-ai-message" data-role="${role}"><small>${role==='user'?tr(l,'YOU','คุณ'):tr(l,'SOI · SIMULATED REPLY','SOI · คำตอบจำลอง')}</small><p>${esc(message.content??message.text??'')}</p>${sources.length?`<div class="cp-ai-message-sources">${sources.map(source=>sourceLink(source,l)).join('')}</div>`:''}</article>`;
}

function sourceDetails(summary,l){
  const assumptions=l==='th'?[
    'ใบซื้อ ออเดอร์ และผลลัพธ์ในชุด 1–14 ต.ค. เป็นข้อมูลสมมติ ไม่ได้รัน OCR, API หรือฝึกโมเดล',
    'สูตรตัวอย่าง: ไก่ 100 กรัม + วัตถุดิบอื่น 9 บาท + บรรจุภัณฑ์ 3 บาท + ต้นทุนผันแปรอื่น 2 บาทต่อจาน ราคาหน้าร้าน 65 บาท ออนไลน์ 85 บาท ค่าธรรมเนียมออนไลน์สมมติ 30% ไม่ใช่อัตรามาตรฐาน Grab',
    'ต้นทุนไก่สมมติ 100 บาท/กก. ในสัปดาห์แรก และ 90 บาท/กก. ในสัปดาห์ที่สองเมื่อยืนยันใบซื้อ ต้นทุนสูตรต่างจากยอดซื้อและไม่ใช่การกระทบยอดสต็อก',
    'ไม่ทราบสต็อกตั้งต้น ของเสีย การโอนสินค้า หรือยอดตรวจนับจริง จึงไม่ระบุสต็อกคงเหลือหรือปริมาณสั่งซื้อ ของเสียจากออเดอร์ยกเลิกยังไม่รวม',
    'FoodSafety.gov เป็นแนวทางแช่เย็นในครัวเรือนสำหรับวัตถุดิบ ไม่ใช่การรับรองวันควรใช้ในร้านอาหาร WHO ให้หลักปฏิบัติทั่วไป ทั้งสองแหล่งไม่ได้บอกวันหมดอายุจริงจากใบซื้อ',
  ]:summary.assumptions||[];
  return `<details class="cp-ai-sources"><summary>${tr(l,'Evidence, assumptions & what is simulated','หลักฐาน สมมติฐาน และขอบเขตการจำลอง')}</summary><ul>${(summary.sources||[]).map(source=>`<li>${sourceLink(source,l)}</li>`).join('')}</ul><p>${tr(l,'FoodSafety.gov provides ingredient-specific home refrigeration guidance; WHO provides general food-handling principles. Neither establishes expiry from a purchase receipt or certifies a commercial use-by date.','FoodSafety.gov ให้แนวทางแช่เย็นในครัวเรือนตามชนิดวัตถุดิบ ส่วน WHO ให้หลักการจัดการอาหารทั่วไป ทั้งคู่ไม่กำหนดวันหมดอายุจากใบซื้อหรือรับรองวันควรใช้ในร้านอาหาร')}</p><ul>${assumptions.map(assumption=>`<li>${esc(assumption)}</li>`).join('')}</ul></details>`;
}
