import {analyze,project,toCents} from './core.mjs';
import {normalizeMerchantFlow,merchantReport,priceComparison,simulateMerchantPlan} from './merchant-flow.mjs';

const clone=value=>structuredClone(value);
const now=()=>new Date().toISOString();
const id=prefix=>`${prefix}_${crypto.randomUUID()}`;
const LIMITS=Object.freeze({messages:80,receipts:50,uploads:50,items:30,text:12000,answer:8000,question:2000});
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function string(value,label,max,{empty=false}={}){
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error(`${label} is missing or exceeds ${max} characters.`);
  return value.trim();
}
function optionalString(value,label,max){return value===undefined||value===null||value===''?null:string(value,label,max);}
function languageOf(language){if(!['en','th'].includes(language))throw Error('Choose English or Thai.');return language;}
function money(value,label){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1_000_000)throw Error(`${label} must be a non-negative amount up to THB 1,000,000, or left unknown.`);
  toCents(value);return value;
}
function quantity(value){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1_000_000||!/^\d+(?:\.\d{1,3})?$/.test(String(value)))throw Error('Receipt quantity must be positive with at most three decimal places, or left unknown.');
  return value;
}
function lineCents(count,unitPrice){
  const match=/^(\d+)(?:\.(\d{1,3}))?$/.exec(String(count));
  const thousandths=BigInt(match[1])*1000n+BigInt((match[2]||'').padEnd(3,'0'));
  return Number((thousandths*BigInt(toCents(unitPrice))+500n)/1000n);
}
function date(value){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Receipt date must be a valid YYYY-MM-DD date, or left unknown.');
  const parsed=new Date(`${value}T00:00:00.000Z`);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw Error('Receipt date is not a valid calendar date.');
  return value;
}
function receiptShape(receipt){
  if(!receipt||typeof receipt!=='object')throw Error('Review a receipt before saving it.');
  if(!['sale','purchase','other'].includes(receipt.kind))throw Error('Identify the receipt as sale, purchase or other.');
  if(receipt.currency!=='THB')throw Error('Only THB receipts are supported in this preview.');
  if(!Array.isArray(receipt.items)||receipt.items.length>LIMITS.items)throw Error(`Include at most ${LIMITS.items} receipt lines.`);
  if(!['ocr','manual','simulated'].includes(receipt.source?.mode))throw Error('Receipt source must identify real OCR, owner-entered fields or a simulation.');
  const normalized={name:string(receipt.name,'Receipt name',200),kind:receipt.kind,merchant:optionalString(receipt.merchant,'Receipt merchant',200),date:date(receipt.date),currency:'THB',
    items:receipt.items.map(item=>({name:string(item?.name,'Receipt item name',200),quantity:quantity(item.quantity),unitPrice:money(item.unitPrice,'Unit price'),lineTotal:money(item.lineTotal,'Line total')})),
    total:money(receipt.total,'Receipt total'),text:string(receipt.text??'','Receipt text',LIMITS.text,{empty:true}),
    source:{mode:receipt.source.mode,engine:string(receipt.source.engine,'Receipt engine',200)},warnings:[]};
  if(receipt.id!==undefined){
    normalized.id=string(receipt.id,'Receipt identifier',100);
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(normalized.id))throw Error('Receipt identifier must contain only letters, numbers, underscores or hyphens.');
  }
  if(receipt.uploadId!==undefined&&receipt.uploadId!==null)normalized.uploadId=string(receipt.uploadId,'Receipt upload identifier',100);
  if(!Array.isArray(receipt.warnings||[])||(receipt.warnings||[]).length>20)throw Error('Receipt warning list is invalid.');
  normalized.warnings=(receipt.warnings||[]).map(warning=>string(warning,'Receipt warning',500));
  return normalized;
}
function arithmeticWarnings(receipt){
  const warnings=[];
  receipt.items.forEach((item,index)=>{
    if(item.quantity!==null&&item.unitPrice!==null&&item.lineTotal!==null&&lineCents(item.quantity,item.unitPrice)!==toCents(item.lineTotal))warnings.push(`Line ${index+1}: quantity × unit price does not match the line total.`);
  });
  if(receipt.items.length&&receipt.total!==null&&receipt.items.every(item=>item.lineTotal!==null)){
    const sum=receipt.items.reduce((total,item)=>total+toCents(item.lineTotal),0);
    if(sum!==toCents(receipt.total))warnings.push('The known line totals do not match the receipt total. Review omitted tax, discounts or OCR mistakes.');
  }
  return warnings;
}
export function validateReceiptDraft(receipt){
  const normalized=receiptShape(receipt),contradictions=arithmeticWarnings(normalized);
  if(contradictions.length)throw Error(`Resolve receipt arithmetic before confirming. ${contradictions.join(' ')}`);
  return normalized;
}
export function normalizeAssistantState(state){
  if(!state||typeof state!=='object')throw Error('Assistant workspace is invalid.');
  for(const field of ['messages','receipts','receiptUploads'])if(state[field]===undefined)state[field]=[];
  return state;
}
function validateSource(document){
  if(!document||typeof document!=='object')throw Error('Answer evidence is invalid.');
  return {id:string(document.id,'Evidence identifier',150),title:string(document.title,'Evidence title',250),text:string(document.text,'Evidence content',12000,{empty:true}),
    sourceType:string(document.sourceType,'Evidence type',100),source:string(document.source,'Evidence source',500),updatedAt:optionalString(document.updatedAt,'Evidence timestamp',100),
    ...(document.reference!==undefined?{reference:string(document.reference,'Evidence reference',500)}:{})};
}
function validateResponse(response){
  if(!response||typeof response!=='object')throw Error('Advisor response is invalid.');
  const answer=string(response.answer,'Advisor answer',LIMITS.answer);
  if(!Array.isArray(response.sources)||response.sources.length>5)throw Error('Advisor answers may use up to five source documents.');
  if(!Array.isArray(response.assumptions)||response.assumptions.length>15)throw Error('Advisor assumptions are invalid.');
  if(!Array.isArray(response.actions)||response.actions.length>5)throw Error('Advisor actions are invalid.');
  const result={answer,sources:response.sources.map(validateSource),assumptions:response.assumptions.map(value=>string(value,'Advisor assumption',1000)),
    actions:response.actions.map(action=>{
      if(!['compare','data','receipt-review'].includes(action?.type))throw Error('Advisor actions must be reviewable app actions.');
      return {type:action.type,label:string(action.label,'Advisor action label',200),...(action.receiptId?{receiptId:string(action.receiptId,'Action receipt identifier',100)}:{})};
    }),retrieval:clone(response.retrieval||{mode:'unavailable'})};
  if(JSON.stringify(result.retrieval).length>3000)throw Error('Advisor retrieval metadata is too large.');
  if(response.evaluation!==undefined){if(JSON.stringify(response.evaluation).length>12000)throw Error('Advisor evaluation is too large.');result.evaluation=clone(response.evaluation);}
  return result;
}
export function validateAssistantState(state){
  normalizeAssistantState(state);
  for(const [field,max] of [['messages',LIMITS.messages],['receipts',LIMITS.receipts],['receiptUploads',LIMITS.uploads]])if(!Array.isArray(state[field])||state[field].length>max)throw Error(`Assistant ${field} history is invalid or too large.`);
  const identifiers=new Set();
  for(const message of state.messages){
    if(!message||typeof message.id!=='string'||identifiers.has(message.id)||!['user','assistant'].includes(message.role)||!['en','th'].includes(message.language)||typeof message.createdAt!=='string'||!['simulated','gemini'].includes(message.mode))throw Error('Advisor message history is invalid.');
    identifiers.add(message.id);string(message.content,'Advisor message',message.role==='user'?LIMITS.question:LIMITS.answer);
    if(message.role==='assistant'){
      const response=validateResponse(message.response||message);
      if(response.answer!==message.content)throw Error('Advisor answer content is inconsistent.');
    }
  }
  const receiptIds=new Set(),confirmedUploadIds=new Set();
  for(const receipt of state.receipts){
    const normalized=validateReceiptDraft(receipt);
    if(!normalized.id||receiptIds.has(normalized.id)||receipt.status!=='confirmed'||typeof receipt.confirmedAt!=='string'||typeof receipt.createdAt!=='string'||receipt.reviewed!==true)throw Error('Confirmed receipt history is invalid.');
    if(normalized.uploadId){if(confirmedUploadIds.has(normalized.uploadId))throw Error('A source photo cannot belong to multiple confirmed receipts.');confirmedUploadIds.add(normalized.uploadId);}
    receiptIds.add(normalized.id);freeze(receipt);
  }
  const uploadIds=new Set();
  for(const upload of state.receiptUploads){
    if(!upload||typeof upload.id!=='string'||!upload.id||upload.id.length>100||uploadIds.has(upload.id)||typeof upload.name!=='string'||upload.name.length>200||!['image/jpeg','image/png','image/webp'].includes(upload.contentType)||!Number.isSafeInteger(upload.bytes)||upload.bytes<1||upload.bytes>8*1024*1024||typeof upload.createdAt!=='string')throw Error('Receipt upload history is invalid.');
    uploadIds.add(upload.id);
  }
  if([...confirmedUploadIds].some(uploadId=>!uploadIds.has(uploadId)))throw Error('A confirmed receipt is missing its workspace source upload.');
  return state;
}
export function confirmReceipt(state,{receipt,reviewed}){
  normalizeAssistantState(state);
  if(reviewed!==true)throw Error('Review the extracted receipt fields before confirming.');
  if(state.receipts.length>=LIMITS.receipts)throw Error('Export your receipts before adding more receipt history.');
  const normalized=validateReceiptDraft(receipt);
  if(normalized.id&&state.receipts.some(item=>item.id===normalized.id))throw Error('This receipt is already confirmed.');
  if(normalized.uploadId&&!state.receiptUploads.some(item=>item.id===normalized.uploadId))throw Error('The receipt source upload is missing from this workspace.');
  if(normalized.uploadId&&state.receipts.some(item=>item.uploadId===normalized.uploadId))throw Error('This receipt photo is already linked to a confirmed receipt. Review the existing receipt before saving another.');
  const stamp=now(),record=freeze({...normalized,id:normalized.id||id('receipt'),status:'confirmed',reviewed:true,createdAt:stamp,confirmedAt:stamp,
    reviewNote:normalized.source.mode==='manual'?'Fields entered and confirmed by the owner; no OCR extraction occurred. This record does not alter sales or menu costs.':'Fields confirmed by the owner; OCR output may have been corrected. This record does not alter sales or menu costs.'});
  state.receipts.push(record);state.revision+=1;return record;
}
export function recordExchange(state,{question,response,language='en',mode='simulated'}){
  normalizeAssistantState(state);string(question,'Advisor question',LIMITS.question);languageOf(language);
  if(!['simulated','gemini'].includes(mode))throw Error('Advisor reply must identify simulation or Gemini.');
  const normalized=validateResponse(response),stamp=now();
  const message={id:id('message'),role:'assistant',content:normalized.answer,language,mode,createdAt:stamp,...normalized};
  state.messages.push({id:id('message'),role:'user',content:question.trim(),language,mode,createdAt:stamp},message);
  if(state.messages.length>LIMITS.messages)state.messages.splice(0,state.messages.length-LIMITS.messages);
  state.revision+=1;return message;
}

const THAI_DIGITS='๐๑๒๓๔๕๖๗๘๙';
const arabic=value=>value.replace(/[๐-๙]/g,digit=>String(THAI_DIGITS.indexOf(digit)));
const numeric='(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?';
const amounts=new RegExp(numeric,'g');
function parseAmount(value){
  const clean=value.replaceAll(',','');
  if(!/^\d+(?:\.\d{1,2})?$/.test(clean))return null;
  const number=Number(clean);return Number.isFinite(number)&&number<=1_000_000?number:null;
}
function parseQuantity(value){const number=Number(value);return Number.isFinite(number)&&number>0&&number<=1_000_000?number:null;}
function parseDate(text,warnings){
  let candidate=null;
  const iso=/(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?=\s|$)/m.exec(text);
  if(iso)candidate=`${iso[1]}-${iso[2]}-${iso[3]}`;
  else{
    const local=/(?:^|\s)(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?=\s|$)/m.exec(text);
    if(local){let year=Number(local[3]);if(year>=2400)year-=543;candidate=`${year}-${local[2].padStart(2,'0')}-${local[1].padStart(2,'0')}`;warnings.push('Numeric local date was read as day/month/year. Confirm the date.');}
  }
  if(candidate){try{return date(candidate);}catch{warnings.push('The printed date could not be validated.');}}
  return null;
}
export function parseReceipt(text,{name='Receipt photo',engine='OCR',simulation=false}={}){
  string(text,'Receipt text',LIMITS.text,{empty:true});
  const working=arabic(text).replaceAll('\r',''),lines=working.split('\n').map(line=>line.trim()).filter(Boolean),warnings=[];
  if(/(?:\b(?:USD|EUR|JPY|CNY|RMB|TWD|HKD|SGD)\b|[$€¥])/i.test(working))throw Error('Only THB receipt reading is supported. Review the currency before entering values.');
  const header=/^(?:qty|quantity|item|description|รายการ|จำนวน|ราคา|ยอดเงิน|สินค้า)(?:(?:\s|[|])+(?:qty|quantity|unit\s*price|price|amount|total|description|item|รายการ|จำนวน|ราคา(?:ต่อหน่วย)?|ยอดเงิน|รวม|สินค้า))*$/i;
  const totals=/^(?:grand\s+total|net\s+total|total|amount\s+due|ยอดรวม|รวมทั้งสิ้น|รวมสุทธิ|ยอดชำระ|รวม)(?:\s|[:：]|$)/i;
  const nonItems=/^(?:subtotal|sub\s+total|tax|vat|discount|cash|change|paid|payment|receipt|invoice|date|time|tel|phone|address|thank|ยอดก่อน|ภาษี|ส่วนลด|เงินสด|เงินทอน|วันที่|เวลา|โทร|ใบเสร็จ|ใบกำกับ|ขอบคุณ)/i;
  const totalLines=lines.filter(line=>totals.test(line));
  const totalsFound=totalLines.map(line=>line.match(amounts)).filter(Boolean).map(values=>parseAmount(values.at(-1)));
  const uniqueTotals=[...new Set(totalsFound)];let total=uniqueTotals.length===1?uniqueTotals[0]:null;
  if(uniqueTotals.length>1)warnings.push('Multiple different totals were detected. Enter the confirmed payable total.');
  const receiptDate=parseDate(working,warnings),items=[];
  const itemHeader=lines.find(line=>header.test(line));
  const hasQuantity=/(?:qty|quantity|จำนวน)/i.test(itemHeader||'');
  const hasUnit=/(?:unit\s*price|ราคาต่อหน่วย)/i.test(itemHeader||'');
  let passedHeader=false;
  for(let index=0;index<lines.length;index++){
    const line=lines[index];
    if(header.test(line)){passedHeader=true;continue;}
    if(totals.test(line)||nonItems.test(line)||/(?:^|\s)\d{4}-\d{2}-\d{2}(?=\s|$)|(?:^|\s)\d{1,2}[\/-]\d{1,2}[\/-]\d{4}(?=\s|$)/.test(line))continue;
    if(/(?:^|\s)-\s*\d/.test(line)){warnings.push('A signed amount was found. Refunds and adjustments are not automatically extracted.');continue;}
    let match=new RegExp(`^(.+?)\\s+(\\d+(?:\\.\\d{1,3})?)\\s*[x×]\\s*(${numeric})(?:\\s*(?:=|\\s)\\s*(${numeric}))?\\s*(?:THB|บาท|฿)?$`,'i').exec(line);
    if(match){items.push({name:match[1].trim(),quantity:parseQuantity(match[2]),unitPrice:parseAmount(match[3]),lineTotal:match[4]?parseAmount(match[4]):null});continue;}
    if(passedHeader&&hasQuantity&&hasUnit){
      match=new RegExp(`^(.+?)\\s+(\\d+(?:\\.\\d{1,3})?)\\s+(${numeric})\\s+(${numeric})\\s*(?:THB|บาท|฿)?$`,'i').exec(line);
      if(match){items.push({name:match[1].trim(),quantity:parseQuantity(match[2]),unitPrice:parseAmount(match[3]),lineTotal:parseAmount(match[4])});continue;}
    }
    if(passedHeader&&hasQuantity&&!hasUnit){
      match=new RegExp(`^(.+?)\\s+(\\d+(?:\\.\\d{1,3})?)\\s+(${numeric})\\s*(?:THB|บาท|฿)?$`,'i').exec(line);
      if(match){items.push({name:match[1].trim(),quantity:parseQuantity(match[2]),unitPrice:null,lineTotal:parseAmount(match[3])});continue;}
    }
    // An amount alone never proves quantity or unit price. Preserve those as unknown.
    match=new RegExp(`^(.+?)\\s+(${numeric})\\s*(?:THB|บาท|฿)?$`,'i').exec(line);
    if(match&&index>0&&!/^\d/.test(match[1])&&/[\p{L}]/u.test(match[1]))items.push({name:match[1].trim(),quantity:null,unitPrice:null,lineTotal:parseAmount(match[2])});
  }
  if(items.length>LIMITS.items){warnings.push('Only the first 30 candidate lines are shown. Review the full document.');items.splice(LIMITS.items);}
  const merchant=lines.find(line=>!header.test(line)&&!totals.test(line)&&!nonItems.test(line)&&!line.match(amounts))||null;
  const kind=/(?:purchase\s+invoice|supplier\s+invoice|ใบซื้อ|ใบรับซื้อ)/i.test(working)?'purchase':/(?:sales\s+receipt|ใบขาย)/i.test(working)?'sale':'other';
  if(total===null)warnings.push('Receipt total is unknown; enter it only if the document supports it.');
  if(!items.length)warnings.push('No item lines were reliably identified. Add only fields supported by the document.');
  if(items.some(item=>item.quantity===null||item.unitPrice===null||item.lineTotal===null))warnings.push('Some quantities, unit prices or line totals are unknown. They were not inferred.');
  if(!merchant)warnings.push('Merchant name is unknown.');
  if(!receiptDate)warnings.push('Receipt date is unknown.');
  warnings.push('Review receipt type, all extracted lines and totals before confirming. OCR does not establish ingredient cost per serving.');
  const draft={name,kind,merchant,date:receiptDate,currency:'THB',items,total,text,source:{mode:simulation?'simulated':'ocr',engine},warnings};
  return {...draft,warnings:[...warnings,...arithmeticWarnings(draft)]};
}
export function sampleReceiptDraft({name='Sample receipt'}={}){
  return {name,kind:'sale',merchant:'Soi Kitchen',date:'2026-10-11',currency:'THB',
    items:[{name:'ข้าวกะเพราไก่ · Basil chicken rice',quantity:2,unitPrice:89,lineTotal:178},{name:'ชาไทย · Thai iced tea',quantity:1,unitPrice:45,lineTotal:45}],total:223,
    text:'SIMULATED SAMPLE — not extracted from your image\nSoi Kitchen\nSales receipt\n2026-10-11\nข้าวกะเพราไก่ 2 x 89.00 178.00\nชาไทย 1 x 45.00 45.00\nTOTAL THB 223.00',
    source:{mode:'simulated',engine:'Demo fixture · no OCR or model call'},warnings:['These are sample values, even if you attached a different photo. They were not read from that photo.','Confirming this sample never changes sales data or menu costs.']};
}

const PLAYBOOK=Object.freeze([
  {id:'playbook:margin',title:'Contribution and exclusions',text:'Use price less ingredient cost, packaging and platform fee to calculate item contribution. Contribution excludes fixed overhead, tax, rent and additional labour; it is not net profit. Purchase receipts alone do not establish ingredient cost per serving.',topic:'margin'},
  {id:'playbook:campaign',title:'Campaign comparison and evidence',text:'Compare a regular-price message with a discount campaign using explicit additional-order and existing-order assumptions. A discount reduces contribution on both additional and existing offer orders. Check spend, break-even, capacity and unsupported claims. Comparing generated drafts is not a causal A/B experiment.',topic:'campaign'},
  {id:'playbook:receipt',title:'Receipt confirmation',text:'Confirm receipt type, merchant, date, quantities, prices and total against the source. Missing fields stay unknown. Resolve conflicting arithmetic. A supplier invoice is not sales, and OCR text is not a verified merchant fact until reviewed.',topic:'receipt'},
  {id:'playbook:claims',title:'Commercial wording and owner approval',text:'Commercial drafts must use sourced business facts. Do not invent testimonials, health or nutrition claims, delivery promises, guarantees or causal uplift. Confirm dates, ordering channel, capacity and final wording before owner approval.',topic:'claims'}
]);
function merchantEvidence(state){
  normalizeMerchantFlow(state);
  const flow=state.merchantFlow,report=merchantReport(state),prices=priceComparison(state);
  const unknown=value=>value===null||value===undefined?'unknown':String(value),currency=cents=>cents===null?'unknown':`THB ${(cents/100).toFixed(2)}`;
  const source='Owner-selected workflow inputs; financial values calculated by code from referenced reports';
  const documents=[{id:'merchant-flow:settings',title:'Merchant workflow · scope and goals',sourceType:'merchant-workflow',source,updatedAt:null,
    text:`Goal ${flow.setup.goal}; selected calculation scope ${flow.scope}. Grab source ${flow.sources.grab??'unassigned; sales unknown'}; storefront source ${flow.sources.storefront??'unassigned; sales unknown'}. Effective Grab fee override ${flow.setup.feePercent===null?'unknown; each assigned menu fee is used':`${flow.setup.feePercent}% entered by owner; not a universal Grab fee`}. Fixed costs THB ${unknown(flow.setup.fixedCosts)}; marketing spend THB ${unknown(flow.setup.marketingSpend)}. Opening cash THB ${unknown(flow.setup.openingCash)}; receivables THB ${unknown(flow.setup.receivables)}; upcoming payments THB ${unknown(flow.setup.upcomingPayments)}. Missing fields remain unknown. No platform connection, automatic import, prediction or causal outcome is implied.`},
    {id:'merchant-flow:report',title:'Merchant workflow · calculated channel report and cash buffer',sourceType:'calculated-merchant-report',source,updatedAt:null,
      text:`Calculation scope ${report.scope}; complete ${report.complete}; missing channels ${report.missingChannels.join(', ')||'none'}; compatible reporting dates ${report.periodCompatible}. ${report.period?`Reporting period ${report.period.start} to ${report.period.end}.`:''} Complete-scope sales ${currency(report.totals?.salesCents??null)}, contribution ${currency(report.totals?.contributionCents??null)}, fees ${currency(report.totals?.feeCents??null)}, sold item orders ${report.totals?.orders??'unknown'}. Known assigned-channel subtotal sales ${currency(report.knownTotals?.salesCents??null)} and contribution ${currency(report.knownTotals?.contributionCents??null)}; this subtotal does not substitute for missing channels. After explicitly entered costs ${currency(report.netAfterKnownCostsCents)}; both fixed costs and marketing supplied ${report.costsComplete}. Cash buffer ${currency(report.cashBalanceCents)}, calculated only as opening cash plus receivables minus upcoming payments; it is not contribution or a cash-flow forecast. ${report.exclusions.join(' ')}`}];
  for(const channel of ['grab','storefront']){
    const result=report.channels[channel];if(!result)continue;
    documents.push({id:`merchant-flow:channel:${channel}`,title:`Merchant workflow · ${channel} source totals`,sourceType:result.sourceType,source:`${source}; ${result.sourceType==='synthetic'?'synthetic sample source':`owner ${result.sourceType} source`}`,updatedAt:null,
      text:`Assigned ${channel} dataset ${result.datasetId}, name ${result.datasetName}; source type ${result.sourceType}; period ${result.period.start} to ${result.period.end}. ${result.orders} sold item orders; sales ${currency(result.salesCents)}, ingredients ${currency(result.ingredientCents)}, packaging ${currency(result.packagingCents)}, platform fees ${currency(result.feeCents)}, contribution ${currency(result.contributionCents)}. Storefront calculation uses zero platform fee; Grab uses owner effective fee when supplied, otherwise source menu fees. Contribution is before fixed costs, marketing, tax and extra labour. This channel is ${report.includedChannels.includes(channel)?'included in':'excluded from'} the selected calculation scope.`});
  }
  prices.forEach((row,index)=>documents.push({id:`merchant-flow:price:${index}`,title:`${row.name} · cross-channel fee parity`,sourceType:'calculated-price-parity',source,updatedAt:null,
    text:`Matched menu ${row.name}; Grab dataset ${row.grabDatasetId}; storefront dataset ${row.storefrontDatasetId}. Storefront price ${currency(row.storefrontPriceCents)}; Grab listed price ${currency(row.grabPriceCents)}; effective fee ${row.feePercent}%; net Grab selling price after platform fee ${currency(row.netGrabPriceCents)}; lowest fee-only parity price ${currency(row.requiredGrabPriceCents)}. ${row.interpretation} This is a calculated comparison, not a recommended price or evidence that demand will remain unchanged.`}));
  const selectedScenarioDataset=state.datasets.find(item=>item.id===flow.sources[flow.scenario.channel]);
  const selectedScenarioMenu=selectedScenarioDataset?.menus.find(item=>item.name.trim().normalize('NFC').toLocaleLowerCase()===flow.scenario.menuName.trim().normalize('NFC').toLocaleLowerCase());
  if(selectedScenarioMenu){
    const scenario=simulateMerchantPlan(state);
    documents.push({id:'merchant-flow:scenario',title:`${scenario.menu.name} · explicit what-if scenario`,sourceType:'calculated-scenario',source,updatedAt:null,
      text:`Source dataset ${scenario.datasetId}; type ${scenario.sourceType}; channel ${scenario.channel}; goal ${flow.setup.goal}. Scenario menu ${scenario.menu.name}; original source price THB ${scenario.baselineMenu.price.toFixed(2)}; scenario listed price THB ${scenario.menu.price.toFixed(2)}; fee ${scenario.menu.fee}%; discount ${scenario.scenario.discount}%; assumed additional orders ${scenario.scenario.extraOrders}; existing offer orders ${scenario.scenario.existingOrders}; assumed spend THB ${scenario.scenario.budget.toFixed(2)}; assumed new customers ${unknown(scenario.newCustomers)}. Code-calculated original source contribution ${currency(scenario.projection.baseCents)}, offer contribution ${currency(scenario.projection.offerCents)}, existing-order contribution ${scenario.projection.existingLossCents<0?'gain':'loss'} ${currency(Math.abs(scenario.projection.existingLossCents))}, estimated incremental contribution ${currency(scenario.projection.netCents)}, additional orders to break even ${scenario.projection.breakEven??'unavailable'}, assumed acquisition cost per new customer ${currency(scenario.cacCents)}. Price changes compare existing orders against the original source price, at the assumed unchanged existing-order count. These inputs are assumptions, not forecasts or actual customer observations. Acquisition cost excludes unentered customer-acquisition spending. Negative campaign contribution may represent a growth tradeoff; it never proves retention or future lifetime value.`});
  }
  for(const outcome of flow.outcomes)documents.push({id:`merchant-flow:outcome:${outcome.id}`,title:`${outcome.snapshot.menu.name} · recorded workflow outcome`,sourceType:outcome.source==='demo'?'simulated-workflow-outcome':'owner-recorded-workflow-outcome',source:outcome.source==='demo'?'Labelled demo inputs, not observed merchant results':'Owner-recorded results and code-calculated estimates',updatedAt:outcome.createdAt,
    text:`Record ${outcome.id}; source ${outcome.source}; pinned dataset ${outcome.snapshot.datasetId} (${outcome.snapshot.sourceType}); channel ${outcome.snapshot.scenario.channel}; pinned goal ${outcome.snapshot.settings.setup.goal}; menu ${outcome.snapshot.menu.name}. Entered orders ${outcome.actual.totalOrders}, owner-supplied baseline ${outcome.actual.baselineOrders}, spend THB ${outcome.actual.spend.toFixed(2)}, new customers ${unknown(outcome.actual.newCustomers)}, returning customers ${unknown(outcome.actual.returningCustomers)}, repeat customers ${unknown(outcome.actual.repeatCustomers)}. Code-calculated estimated incremental contribution ${currency(outcome.evaluation.netCents)} and acquisition cost ${currency(outcome.cacCents)}. Returning customer share ${unknown(outcome.returningShare)}; repeat customer share ${unknown(outcome.repeatShare)}. Owner-reported observed payback days ${unknown(outcome.actual.paybackDays)}; this value is not calculated from orders or forecast. ${outcome.interpretation}`});
  return documents;
}
export function buildEvidence(state){
  normalizeAssistantState(state);
  const dataset=state.datasets.find(item=>item.id===state.activeDatasetId);
  if(!dataset)throw Error('Select an active dataset before asking for business analysis.');
  const analysis=analyze(dataset.menus,dataset.period),stamp=dataset.createdAt;
  const sourceLabel=dataset.sourceType==='synthetic'?'Synthetic sample dataset':dataset.sourceType==='manual'?'Owner-entered menu dataset':'Owner-imported sales CSV';
  const documents=[{id:`dataset:${dataset.id}`,title:`${dataset.name} · exact metrics`,sourceType:dataset.sourceType,source:sourceLabel,updatedAt:stamp,
    text:`Business: ${state.business.name}. Reporting period ${dataset.period.start} to ${dataset.period.end}. ${analysis.orders} item orders; THB ${(analysis.salesCents/100).toFixed(2)} declared sales; THB ${(analysis.totalContributionCents/100).toFixed(2)} contribution before fixed overhead, tax and extra labour. ${analysis.denominator.weekdays} weekdays and ${analysis.denominator.weekends} weekend days. Weekday daily item orders ${analysis.weekdayDaily.toFixed(2)}; weekend daily item orders ${analysis.weekendDaily.toFixed(2)}. Highest contribution per sold item: ${[...analysis.rows].sort((a,b)=>b.contributionCents-a.contributionCents)[0].name}. Weekday campaign starting point: ${analysis.recommended||'no positive-contribution menu'}. Individual menu facts appear in separate sourced documents. These are item counts, not unique customers.`},
    {id:'business:profile',title:`${state.business.name} · owner profile`,sourceType:'owner-profile',source:'Current workspace business profile',updatedAt:null,
      text:`Business ${state.business.name}; type ${state.business.type}; audience ${state.business.audience}; voice ${state.business.tone}; campaign budget THB ${state.business.budget.toFixed(2)}; capacity ${state.business.capacity} additional orders across the entire campaign week.`}];
  analysis.rows.forEach((row,index)=>documents.push({id:`menu:${dataset.id}:${index}`,title:`${row.name} · contribution facts`,sourceType:dataset.sourceType,source:sourceLabel,updatedAt:stamp,text:`${row.name}: price THB ${row.price.toFixed(2)}, ingredients THB ${row.ingredients.toFixed(2)}, packaging THB ${row.packaging.toFixed(2)}, platform fee ${row.fee}%, contribution THB ${(row.contributionCents/100).toFixed(2)}, weekday orders ${row.weekday}, weekend orders ${row.weekend}, weekday daily orders ${row.weekdayDaily.toFixed(2)}, weekend daily orders ${row.weekendDaily.toFixed(2)}. Period ${dataset.period.start} to ${dataset.period.end}. Contribution is calculated in integer satang with half-up rounding and excludes fixed overhead, tax and additional labour.`}));
  for(const memory of state.memories.filter(item=>item.status==='confirmed'))documents.push({id:`memory:${memory.id}`,title:memory.key,text:memory.value,sourceType:'confirmed-memory',source:memory.source,updatedAt:memory.updatedAt});
  for(const receipt of state.receipts.filter(item=>item.status==='confirmed'))documents.push({id:`receipt:${receipt.id}`,title:receipt.name,sourceType:receipt.source.mode==='simulated'?'simulated-receipt':'confirmed-receipt',source:`Owner-confirmed ${receipt.kind} receipt · ${receipt.source.mode==='manual'?'owner-entered fields, no OCR':receipt.source.engine}`,updatedAt:receipt.confirmedAt,
    text:`Receipt kind ${receipt.kind}; merchant ${receipt.merchant||'unknown'}; date ${receipt.date||'unknown'}; total ${receipt.total===null?'unknown':`THB ${receipt.total.toFixed(2)}`}. Items: ${receipt.items.map(item=>`${item.name}; quantity ${item.quantity??'unknown'}, unit price ${item.unitPrice===null?'unknown':`THB ${item.unitPrice.toFixed(2)}`}, line total ${item.lineTotal===null?'unknown':`THB ${item.lineTotal.toFixed(2)}`}`).join('; ')}. Source mode ${receipt.source.mode}. Owner confirmed/corrected fields; this receipt has not altered sales or recipe costs.`});
  for(const guide of PLAYBOOK)documents.push({id:guide.id,title:guide.title,text:guide.text,sourceType:'project-playbook',source:'Soi Studio project-authored commercial guidance · not externally validated expert training data',updatedAt:'2026-10-12',reference:'Project commercial playbook'});
  documents.push(...merchantEvidence(state));
  return documents;
}
function keywords(text){
  const normalized=text.normalize('NFC').toLocaleLowerCase();
  if(typeof Intl.Segmenter==='function')return new Set([...new Intl.Segmenter('th',{granularity:'word'}).segment(normalized)].filter(part=>part.isWordLike).map(part=>part.segment));
  return new Set(normalized.match(/[\p{L}\p{N}]+/gu)||[]);
}
function relevantDocuments(documents,query,preferred=[]){
  const queryTokens=keywords(query);
  return documents.map(document=>({document,score:[...keywords(`${document.title} ${document.text}`)].filter(token=>queryTokens.has(token)).length+(preferred.includes(document.id)?1000:0)}))
    .sort((a,b)=>b.score-a.score).slice(0,5).map(item=>({...clone(item.document),text:item.document.text.slice(0,2400)}));
}
const fmt=(cents,language)=>new Intl.NumberFormat(language==='th'?'th-TH':'en-GB',{style:'currency',currency:'THB',minimumFractionDigits:2}).format(cents/100);
export function simulateReply(state,{text,language=state.business.language||'en'}){
  string(text,'Advisor question',LIMITS.question);languageOf(language);const th=language==='th';
  const dataset=state.datasets.find(item=>item.id===state.activeDatasetId),analysis=analyze(dataset.menus,dataset.period),documents=buildEvidence(state);
  const question=text.toLocaleLowerCase(),top=[...analysis.rows].sort((a,b)=>b.contributionCents-a.contributionCents)[0];
  const hasAssignedWorkflow=Object.values(state.merchantFlow.sources).some(value=>value!==null);
  const sourcesRequired=[`dataset:${dataset.id}`],assumptions=th?['นี่คือคำตอบจำลอง ไม่มีการเรียก Gemini หรือค้นเวกเตอร์จริง','ยอดขายคือจำนวนรายการ ไม่ใช่ลูกค้าไม่ซ้ำ; กำไรส่วนเกินยังไม่หักค่าใช้จ่ายคงที่ ภาษี และแรงงานเพิ่ม']:['This is a simulated response; no Gemini call or real vector retrieval occurred.','Order counts are sold items, not unique customers. Contribution excludes fixed overhead, tax and additional labour.'];
  let answer='',actions=[],evaluation;
  if(/receipt|invoice|ocr|ใบเสร็จ|ใบกำกับ|บิล|เอกสาร/.test(question)){
    const receipt=state.receipts.at(-1);sourcesRequired.push('playbook:receipt');
    if(receipt){sourcesRequired.push(`receipt:${receipt.id}`);answer=th?`ใบเสร็จที่ยืนยันล่าสุดคือ “${receipt.name}” จาก ${receipt.merchant||'ร้านที่ยังไม่ทราบชื่อ'} ยอด ${receipt.total===null?'ยังไม่ทราบ':fmt(toCents(receipt.total),language)} มี ${receipt.items.length} รายการ ประเภท ${receipt.kind==='purchase'?'ซื้อ':receipt.kind==='sale'?'ขาย':'อื่น ๆ'}\n\n${receipt.items.map(item=>`${item.name}: จำนวน ${item.quantity??'ยังไม่ทราบ'}; รวมรายการ ${item.lineTotal===null?'ยังไม่ทราบ':fmt(toCents(item.lineTotal),language)}`).join('\n')}\n\nข้อมูลนี้ยังไม่ถูกนำไปเพิ่มยอดขายหรือเปลี่ยนต้นทุนต่อจาน กรุณาตรวจชนิดเอกสารและข้อมูลที่ยังไม่ทราบก่อนใช้วิเคราะห์ต่อ`:
      `The latest confirmed receipt is “${receipt.name}” from ${receipt.merchant||'an unknown merchant'}, with ${receipt.items.length} lines and a ${receipt.total===null?'still unknown total':`total of ${fmt(toCents(receipt.total),language)}`}. Its type is ${receipt.kind}.\n\n${receipt.items.map(item=>`${item.name}: quantity ${item.quantity??'unknown'}; line total ${item.lineTotal===null?'unknown':fmt(toCents(item.lineTotal),language)}`).join('\n')}\n\nIt has not increased sales or changed recipe costs. Review document type and remaining unknowns before using it for further analysis.`;
      actions=[{type:'receipt-review',receiptId:receipt.id,label:th?'ดูใบเสร็จที่ยืนยัน':'Review confirmed receipt'}];
      if(receipt.source.mode==='simulated')assumptions.push(th?'ใบเสร็จนี้มีค่าเป็นตัวอย่าง ไม่ใช่ผลอ่านภาพจริง':'This receipt contains sample values, not extraction from a real photo.');
    }else{answer=th?'ยังไม่มีใบเสร็จที่ยืนยัน แนบภาพเพื่อทดลองตัวอย่างการอ่านเอกสาร แล้วตรวจรายการ จำนวน ราคา และยอดรวมก่อนยืนยัน ใน /demo ค่าที่แสดงเป็นตัวอย่าง 223 บาท ไม่ใช่ข้อมูลจากภาพที่แนบ':'There are no confirmed receipts yet. Attach a photo to try the reading workflow, then review items, quantities, prices and total before confirming. In /demo, the THB 223 extraction is a sample, not data read from your attached image.';actions=[{type:'receipt-review',label:th?'แนบและตรวจใบเสร็จ':'Attach and review a receipt'}];}
  }else if(/price normalization|price parity|fee parity|cash flow|cashflow|cash buffer|\bcac\b|acquisition|returning|repeat customer|storefront|grab channel|scope|payback|ช่องทาง|เทียบราคา|ปรับราคา|ราคาหน้าร้าน|ค่าธรรมเนียม|กระแสเงินสด|เงินสด|คุ้มค่า|ลูกค้าใหม่|ซื้อซ้ำ|ต้นทุนการหาลูกค้า|คืนทุน/.test(question)||(hasAssignedWorkflow&&/profit|margin|contribution|cost|กำไร|ต้นทุน/.test(question))){
    const flow=state.merchantFlow,report=merchantReport(state),prices=priceComparison(state),latest=flow.outcomes.at(-1);
    sourcesRequired.length=0;
    sourcesRequired.push('merchant-flow:settings','merchant-flow:report',...prices.slice(0,1).map((_,index)=>`merchant-flow:price:${index}`));
    const unknown=th?'ยังไม่ทราบ':'unknown';
    const amount=cents=>cents===null||cents===undefined?unknown:fmt(cents,language);
    const channels=report.includedChannels.map(channel=>`${channel}: ${report.channels[channel]?.datasetName??unknown}`).join('; ');
    const summary=th?`เป้าหมาย ${flow.setup.goal}; ขอบเขตคำนวณ ${flow.scope}\nแหล่งข้อมูลที่เลือก: ${channels}\nยอดขายของขอบเขตที่ครบ ${amount(report.totals?.salesCents)}; กำไรส่วนเกิน ${amount(report.totals?.contributionCents)}; หลังต้นทุนที่กรอก ${amount(report.netAfterKnownCostsCents)}\nเงินสดคงเหลือตามข้อมูลที่กรอก ${amount(report.cashBalanceCents)} คำนวณจากเงินสดตั้งต้น + ลูกหนี้ − ยอดจ่ายที่กำลังถึงกำหนด ไม่ใช่การพยากรณ์เงินสด`:
      `Goal ${flow.setup.goal}; selected calculation scope ${flow.scope}.\nAssigned sources: ${channels}.\nComplete-scope sales ${amount(report.totals?.salesCents)}; contribution ${amount(report.totals?.contributionCents)}; after entered costs ${amount(report.netAfterKnownCostsCents)}.\nCash buffer from entered inputs ${amount(report.cashBalanceCents)}: opening cash plus receivables minus upcoming payments; this is not a cash-flow forecast.`;
    const parity=prices.length?(th?prices.slice(0,1).map(row=>`${row.name}: หน้าร้าน ${amount(row.storefrontPriceCents)}; Grab ${amount(row.grabPriceCents)}; หลังค่าธรรมเนียม ${row.feePercent}% เหลือ ${amount(row.netGrabPriceCents)}; ราคาที่เทียบรายรับหน้าร้านก่อนต้นทุนอื่น ${amount(row.requiredGrabPriceCents)}`).join('\n'):
      prices.slice(0,1).map(row=>`${row.name}: storefront ${amount(row.storefrontPriceCents)}; Grab ${amount(row.grabPriceCents)}; net selling price after ${row.feePercent}% fee ${amount(row.netGrabPriceCents)}; fee-only parity price ${amount(row.requiredGrabPriceCents)}.`).join('\n')):
      (th?'ยังเทียบราคาไม่ได้ ต้องมีรายงาน Grab และหน้าร้านแยกกันที่มีชื่อเมนูตรงกัน ค่าธรรมเนียมต้องมาจากข้อมูลร้าน ไม่ใช่อัตราตายตัว':'Price normalization is unavailable until separate Grab and storefront reports have matching menus. Fees use your entered/source values, not a universal rate.');
    let scenarioText=th?'ยังไม่มีสถานการณ์ที่เลือกครบ; CAC และจุดคุ้มทุนของแผนยังไม่ทราบ':'A complete scenario has not been selected; plan CAC and break-even are unknown.';
    const scenarioDocument=documents.find(item=>item.id==='merchant-flow:scenario');
    if(scenarioDocument){
      const scenario=simulateMerchantPlan(state);sourcesRequired.push('merchant-flow:scenario');
      scenarioText=th?`สถานการณ์ ${scenario.menu.name}: สมมติยอดเพิ่ม ${scenario.scenario.extraOrders} รายการ งบ ${amount(scenario.projection.budgetCents)} → กำไรส่วนเกินเพิ่มโดยประมาณ ${amount(scenario.projection.netCents)}; จุดคุ้มทุน ${scenario.projection.breakEven??unknown} รายการเพิ่ม; CAC ตามลูกค้าใหม่ที่สมมติ ${amount(scenario.cacCents)} ผลต่อยอดเดิมเมื่อเทียบราคาต้นฉบับ: ${scenario.projection.existingLossCents<0?'ได้ส่วนเกินเพิ่ม':'เสียส่วนเกิน'} ${amount(Math.abs(scenario.projection.existingLossCents))} ภายใต้สมมติฐานว่าจำนวนยอดเดิมไม่เปลี่ยน`:
        `Scenario for ${scenario.menu.name}: assume ${scenario.scenario.extraOrders} additional orders and ${amount(scenario.projection.budgetCents)} spend → estimated incremental contribution ${amount(scenario.projection.netCents)}; break-even ${scenario.projection.breakEven??unknown} additional orders; CAC from assumed new customers ${amount(scenario.cacCents)}. Existing-order contribution ${scenario.projection.existingLossCents<0?'gain':'loss'} against the original source price: ${amount(Math.abs(scenario.projection.existingLossCents))}, assuming the existing-order count remains unchanged.`;
    }
    const actual=latest?(sourcesRequired.push(`merchant-flow:outcome:${latest.id}`),th?`ผลที่บันทึกล่าสุด (${latest.source==='demo'?'ค่าตัวอย่าง':'เจ้าของกรอก'}): ลูกค้าใหม่ ${latest.actual.newCustomers??unknown}, ลูกค้าเดิม ${latest.actual.returningCustomers??unknown}, ลูกค้าซื้อซ้ำ ${latest.actual.repeatCustomers??unknown}; CAC ${amount(latest.cacCents)}; จำนวนวันคืนทุนที่เจ้าของรายงาน ${latest.actual.paybackDays??unknown} วัน (ไม่ได้คำนวณจากยอดสั่งหรือพยากรณ์)`:
      `Latest recorded outcome (${latest.source==='demo'?'demo inputs':'owner-entered'}): new customers ${latest.actual.newCustomers??unknown}, returning customers ${latest.actual.returningCustomers??unknown}, repeat customers ${latest.actual.repeatCustomers??unknown}; CAC ${amount(latest.cacCents)}; owner-reported observed payback ${latest.actual.paybackDays??unknown} days (not calculated from orders or forecast).`):
      (th?'ยังไม่มีผลจริงที่บันทึก จำนวนลูกค้าใหม่ ลูกค้าเดิม การซื้อซ้ำ และจำนวนวันคืนทุนที่สังเกตยังไม่ทราบ':'There is no recorded outcome yet. Actual new, returning and repeat customer counts and observed payback days are unknown.');
    answer=`${summary}\n\n${parity}\n\n${scenarioText}\n\n${actual}\n\n${th?'ราคาเทียบค่าธรรมเนียมไม่ใช่ราคาที่แนะนำ กำไรส่วนเกินติดลบอาจเป็นต้นทุนหาลูกค้า แต่ยังไม่พิสูจน์การซื้อซ้ำหรือมูลค่าลูกค้าในอนาคต':'Fee parity is not a recommended price. Negative campaign contribution may be an acquisition tradeoff, but it does not prove retention or future lifetime value.'}`;
    assumptions.push(th?'ยอดเพิ่ม ลูกค้าใหม่ และงบในสถานการณ์เป็นสมมติฐาน; ผลที่กรอกอาศัยยอดฐานที่เจ้าของระบุ ไม่ใช่ผลเชิงเหตุจาก A/B':'Scenario additional orders, new customers and spend are assumptions; recorded results use an owner-supplied baseline and are not causal A/B results.');
    actions=[{type:'data',label:th?'ตรวจแหล่งข้อมูลและเป้าหมาย':'Review sources and goals'}];
  }else if(/campaign|compare|a\/b|strategy|discount|promo|แคมเปญ|เปรียบเทียบ|กลยุทธ์|ส่วนลด|โปรโม/.test(question)){
    const menu=dataset.menus.find(item=>item.name===analysis.recommended);
    sourcesRequired.push(`menu:${dataset.id}:${analysis.rows.findIndex(row=>row.name===analysis.recommended)}`,'business:profile','playbook:campaign');
    if(!menu){answer=th?'ยังไม่มีเมนูที่มีกำไรส่วนเกินเป็นบวก ควรยืนยันต้นทุนและราคาก่อนทำแคมเปญ':'No menu has positive contribution. Confirm costs and prices before planning a campaign.';actions=[{type:'data',label:th?'ตรวจข้อมูลต้นทุน':'Review menu costs'}];}
    else{
      const plans=[{label:th?'A · ลด 10%':'A · 10% offer',discount:10,extraOrders:40,existingOrders:20,budget:state.business.budget},{label:th?'B · ราคาเดิม':'B · regular price',discount:0,extraOrders:30,existingOrders:20,budget:state.business.budget}];
      const compared=plans.map(plan=>({...plan,projection:project(menu,plan)}));
      const eligible=compared.filter(item=>item.extraOrders<=state.business.capacity&&item.projection.offerCents>0&&item.projection.netCents>=0),recommended=[...eligible].sort((a,b)=>b.projection.netCents-a.projection.netCents)[0];
      answer=th?`สำหรับ ${menu.name} เปรียบเทียบสองสถานการณ์:\n${compared.map(item=>`${item.label}: สมมติยอดเพิ่ม ${item.extraOrders} รายการ, ยอดเดิมที่รับข้อเสนอ ${item.existingOrders}, งบ ${fmt(toCents(item.budget),language)} → กำไรส่วนเกินเพิ่มสุทธิประมาณ ${fmt(item.projection.netCents,language)}; คุ้มทุน ${item.projection.breakEven??'ไม่ได้'} รายการเพิ่ม`).join('\n')}\n\n${recommended?`ภายใต้สมมติฐานนี้ ${recommended.label} ผ่านเงื่อนไขและให้กำไรส่วนเกินเพิ่มสูงกว่า`:'ยังไม่มีตัวเลือกที่ผ่านทั้งกำไรส่วนเกิน งบ และกำลังผลิต'} กำลังผลิตปัจจุบันรองรับยอดเพิ่ม ${state.business.capacity} รายการทั้งสัปดาห์ นี่เป็นการเปรียบเทียบสถานการณ์ ไม่ใช่ผล A/B จากลูกค้าจริง`:
        `For ${menu.name}, compare these two scenarios:\n${compared.map(item=>`${item.label}: assume ${item.extraOrders} additional orders, ${item.existingOrders} existing offer orders and ${fmt(toCents(item.budget),language)} spend → estimated incremental contribution ${fmt(item.projection.netCents,language)}; break-even ${item.projection.breakEven??'unavailable'} additional orders`).join('\n')}\n\n${recommended?`${recommended.label} passes the contribution and capacity constraints and has the higher estimate under these assumptions.`:'Neither option passes both contribution and capacity constraints.'} Current capacity is ${state.business.capacity} additional orders for the whole week. This compares scenarios; it is not an observed customer A/B test.`;
      assumptions.push(th?'ยอดเพิ่ม 40/30 และยอดเดิม 20 เป็นสมมติฐานที่ต้องทดลองจริง ไม่ใช่การพยากรณ์':'40/30 additional orders and 20 existing offer orders are illustrative assumptions to test, not forecasts.');
      actions=[{type:'compare',label:th?'เปิดการเปรียบเทียบและตรวจสมมติฐาน':'Compare and review the assumptions'}];
      evaluation={mode:'simulated',label:th?'ตัวอย่างการประเมิน ไม่ใช่โมเดลที่ฝึกแล้ว':'Illustrative evaluation, not a trained scorer',recommendation:recommended?.label??null,
        candidates:compared.map(item=>({label:item.label,grounding:'Illustrative explicit order assumptions; exact dataset-backed contribution',financialChecks:{margin:item.projection.offerCents>0,capacity:item.extraOrders<=state.business.capacity,budget:item.budget<=state.business.budget,breakEven:item.projection.netCents>=0},netCents:item.projection.netCents})),limitations:['Not measured causal uplift','No trained model or live model response']};
    }
  }else if(/memory|remember|audience|customer|voice|tone|know|จำ|ความจำ|ลูกค้า|กลุ่มเป้าหมาย|น้ำเสียง/.test(question)){
    const queryTokens=keywords(text),memories=state.memories.filter(item=>item.status==='confirmed').map(memory=>({memory,score:[...keywords(`${memory.key} ${memory.value}`)].filter(token=>queryTokens.has(token)).length})).sort((a,b)=>b.score-a.score||b.memory.updatedAt.localeCompare(a.memory.updatedAt)).map(item=>item.memory);sourcesRequired.push('business:profile',...memories.slice(0,3).map(memory=>`memory:${memory.id}`));
    answer=th?`ข้อมูลธุรกิจที่ยืนยันของ ${state.business.name}: กลุ่มเป้าหมาย ${state.business.audience}, น้ำเสียง ${state.business.tone}, งบแคมเปญ ${fmt(toCents(state.business.budget),language)}, กำลังผลิตเพิ่ม ${state.business.capacity} รายการทั้งสัปดาห์\n\n${memories.slice(0,3).map(memory=>`${memory.key}: ${memory.value}`).join('\n')}\n\nใช้เฉพาะความจำที่ยังยืนยันอยู่ ค่าเก่าที่ถูกแทนที่ไม่ถูกนำมาสนับสนุนคำตอบ`:
      `Confirmed business context for ${state.business.name}: audience ${state.business.audience}, voice ${state.business.tone}, campaign budget ${fmt(toCents(state.business.budget),language)}, and ${state.business.capacity} additional orders of weekly capacity.\n\n${memories.slice(0,3).map(memory=>`${memory.key}: ${memory.value}`).join('\n')}\n\nOnly current confirmed memories are used; superseded values are excluded.`;
    actions=[{type:'data',label:th?'ตรวจข้อมูลธุรกิจ':'Review business data'}];
  }else if(/why|recommend|best|margin|contribution|profit|menu|cost|กำไร|เมนู|ต้นทุน|แนะนำ|ทำไม|ดีที่สุด/.test(question)){
    sourcesRequired.push(`menu:${dataset.id}:${analysis.rows.findIndex(row=>row.name===top.name)}`,'playbook:margin','playbook:campaign');
    answer=th?`เมนูที่มีกำไรส่วนเกินต่อรายการสูงสุดตอนนี้คือ ${top.name}: ${fmt(top.contributionCents,language)} จากราคา ${fmt(toCents(top.price),language)}, ต้นทุนวัตถุดิบ ${fmt(toCents(top.ingredients),language)}, บรรจุภัณฑ์ ${fmt(toCents(top.packaging),language)} และค่าธรรมเนียม ${top.fee}%\n\nเมนูเริ่มต้นสำหรับแคมเปญวันธรรมดาคือ ${analysis.recommended||'ยังไม่มีเมนูที่เหมาะสม'} โดยจัดอันดับส่วนต่างยอดขายต่อวันสุดสัปดาห์กับวันธรรมดาคูณกำไรส่วนเกิน จากข้อมูลช่วง ${dataset.period.start} ถึง ${dataset.period.end} ยอดเฉลี่ยวันธรรมดา ${analysis.weekdayDaily.toFixed(2)} และสุดสัปดาห์ ${analysis.weekendDaily.toFixed(2)} รายการต่อวัน\n\nการจัดอันดับนี้เป็นเกณฑ์ที่อธิบายได้ ไม่ได้พิสูจน์ว่าแคมเปญจะเพิ่มยอดขาย ควรทดสอบเล็ก ๆ พร้อมบันทึกผล`:
      `The highest contribution per sold item is currently ${top.name}: ${fmt(top.contributionCents,language)}, from price ${fmt(toCents(top.price),language)}, ingredient cost ${fmt(toCents(top.ingredients),language)}, packaging ${fmt(toCents(top.packaging),language)} and a ${top.fee}% platform fee.\n\nThe weekday campaign starting point is ${analysis.recommended||'unavailable'}: its rank uses the weekend-to-weekday daily order gap multiplied by positive contribution. For ${dataset.period.start} to ${dataset.period.end}, overall daily item orders average ${analysis.weekdayDaily.toFixed(2)} on weekdays and ${analysis.weekendDaily.toFixed(2)} on weekends.\n\nThat is an explainable prioritization rule, not proof a campaign will increase demand. Run a small test and record results.`;
    actions=[{type:'compare',label:th?'เปรียบเทียบแคมเปญ':'Compare campaign options'}];
  }else{
    sourcesRequired.push('playbook:claims');
    answer=th?`ฉันช่วยวิเคราะห์ข้อมูลของ ${state.business.name} อ่านใบเสร็จที่ยืนยันแล้ว และเปรียบเทียบแคมเปญได้ ตอนนี้ข้อมูลช่วง ${dataset.period.start} ถึง ${dataset.period.end} มี ${analysis.orders} รายการ ยอดขาย ${fmt(analysis.salesCents,language)} และกำไรส่วนเกินก่อนค่าใช้จ่ายคงที่ ${fmt(analysis.totalContributionCents,language)}\n\nสำหรับคำถาม “${text.trim()}” ตัวอย่างนี้ยังไม่มีหลักฐานเฉพาะเพียงพอ ลองระบุเมนู แคมเปญ หรือใบเสร็จที่ต้องการวิเคราะห์ ฉันจะไม่สร้างคำตอบที่ไม่มีข้อมูลรองรับ`:
      `I can help analyze ${state.business.name}'s data, review confirmed receipts and compare campaign choices. The current ${dataset.period.start} to ${dataset.period.end} dataset contains ${analysis.orders} sold items, ${fmt(analysis.salesCents,language)} in declared sales and ${fmt(analysis.totalContributionCents,language)} contribution before fixed overhead.\n\nFor “${text.trim()}”, this demo does not have enough specific evidence. Specify a menu, campaign or receipt to examine; I will not invent a supported answer where the source is missing.`;
    actions=[{type:'data',label:th?'ดูข้อมูลที่มี':'Explore available data'}];
  }
  const sources=relevantDocuments(documents,text,sourcesRequired);
  return validateResponse({answer:`${th?'คำตอบจำลอง':'Simulated reply'}\n\n${answer}`,sources,assumptions,actions,
    retrieval:{mode:'simulated',method:'scenario + keyword evidence selection; no embeddings',query:text.trim(),documentIds:sources.map(source=>source.id)},...(evaluation?{evaluation}:{})});
}
