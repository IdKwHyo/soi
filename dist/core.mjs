export const DEFAULT_PERIOD = Object.freeze({start:'2026-09-28', end:'2026-10-11'});
export const MAX_CSV_BYTES = 1024 * 1024;
export const sampleMenus = [
  {name:'Basil chicken rice', weekday:120, weekend:80, price:89, ingredients:29, packaging:5, fee:20},
  {name:'Garlic pork rice', weekday:95, weekend:62, price:95, ingredients:34, packaging:5, fee:20},
  {name:'Thai iced tea', weekday:85, weekend:55, price:45, ingredients:10, packaging:4, fee:20}
];
const FIELDS = ['menu','weekday_orders','weekend_orders','price','ingredient_cost','packaging_cost','fee_percent'];
const NUMBER_FIELDS = ['weekday','weekend','price','ingredients','packaging','fee'];
const MAX_AMOUNT = 1_000_000;
const MAX_ORDERS = 100_000;

// Money is stored in integer satang. Discounted price and platform fee are each
// rounded half-up per sold item. Aggregate totals sum those rounded items.
function scaledDecimal(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`${label} must be a finite number.`);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw Error(`${label} must have at most two decimal places.`);
  const magnitude = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2,'0'));
  const result = Number(match[1] ? -magnitude : magnitude);
  if (!Number.isSafeInteger(result)) throw Error(`${label} is too large.`);
  return result;
}
export function toCents(value) { return scaledDecimal(value, 'Money'); }
function percentBasisPoints(value) { return scaledDecimal(value, 'Percentage'); }
function safeInteger(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw Error('The calculated total exceeds the supported amount.');
  return result;
}
function halfUpDivide(value, divisor) {
  const sign = value < 0n ? -1n : 1n;
  const magnitude = value < 0n ? -value : value;
  return sign * ((magnitude + divisor / 2n) / divisor);
}
function multiplyCents(cents, count) { return safeInteger(BigInt(cents) * BigInt(count)); }
function addCents(...values) { return safeInteger(values.reduce((sum,n) => sum + BigInt(n),0n)); }
function validateDiscount(discount) {
  const basisPoints = percentBasisPoints(discount);
  if (basisPoints < 0 || basisPoints > 5000) throw Error('Use a discount between 0 and 50%.');
  return basisPoints;
}
function validateOrders(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ORDERS) throw Error(`${label} must be a whole number between 0 and ${MAX_ORDERS}.`);
}
function validateAmount(value, label) {
  if (value < 0 || value > MAX_AMOUNT) throw Error(`${label} must be between 0 and ${MAX_AMOUNT}.`);
  return scaledDecimal(value,label);
}

export function validateMenus(menus) {
  if (!Array.isArray(menus) || !menus.length || menus.length > 100) throw Error('Include between 1 and 100 menu items.');
  for (const menu of menus) {
    if (!menu || typeof menu.name !== 'string' || !menu.name.trim() || menu.name.length > 200) throw Error('Every menu item needs a name of up to 200 characters.');
    for (const key of NUMBER_FIELDS) {
      if (typeof menu[key] !== 'number' || !Number.isFinite(menu[key]) || menu[key] < 0) throw Error('Use valid, non-negative numbers for every menu field.');
    }
    validateOrders(menu.weekday,'Weekday orders');
    validateOrders(menu.weekend,'Weekend orders');
    for (const key of ['price','ingredients','packaging']) validateAmount(menu[key],key);
    if (menu.price <= 0) throw Error('Menu prices must be greater than zero.');
    if (menu.fee > 100) throw Error('Platform fees must be between 0 and 100%.');
    percentBasisPoints(menu.fee);
  }
  const names = menus.map(menu => menu.name.trim().normalize('NFC').toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw Error('Use a different name for each menu item.');
  return menus;
}

export function countPeriodDays(period = DEFAULT_PERIOD) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Use calendar dates in YYYY-MM-DD format.');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw Error('Use a valid calendar date.');
    return date.getTime();
  };
  const start = parse(period?.start), end = parse(period?.end);
  const days = (end-start)/86_400_000+1;
  if (days < 1 || days > 366) throw Error('The reporting period must include between 1 and 366 days.');
  let weekdays = 0, weekends = 0;
  for (let time=start;time<=end;time+=86_400_000) {
    const day = new Date(time).getUTCDay();
    if (day === 0 || day === 6) weekends++; else weekdays++;
  }
  return {days,weekdays,weekends};
}

export function contributionCents(menu, discount=0) {
  validateMenus([menu]);
  const basisPoints = validateDiscount(discount);
  const sellingPriceCents = safeInteger(halfUpDivide(BigInt(toCents(menu.price))*BigInt(10000-basisPoints),10000n));
  const feeCents = safeInteger(halfUpDivide(BigInt(sellingPriceCents)*BigInt(percentBasisPoints(menu.fee)),10000n));
  return {sellingPriceCents,feeCents,contributionCents:addCents(sellingPriceCents,-feeCents,-toCents(menu.ingredients),-toCents(menu.packaging))};
}
export function contribution(menu, discount=0) { return contributionCents(menu,discount).contributionCents/100; }

export function analyze(menus, period=DEFAULT_PERIOD) {
  validateMenus(menus);
  const denominator = countPeriodDays(period);
  if (!denominator.weekdays && menus.some(menu=>menu.weekday>0)) throw Error('This period has no weekdays, but weekday orders were supplied.');
  if (!denominator.weekends && menus.some(menu=>menu.weekend>0)) throw Error('This period has no weekend days, but weekend orders were supplied.');
  const rows = menus.map(menu=>({...menu,contribution:contribution(menu),contributionCents:contributionCents(menu).contributionCents,
    weekdayDaily:denominator.weekdays?menu.weekday/denominator.weekdays:0,weekendDaily:denominator.weekends?menu.weekend/denominator.weekends:0}));
  const ranked = rows.filter(menu=>menu.contributionCents>0).sort((a,b)=>
    Math.max(0,b.weekendDaily-b.weekdayDaily)*b.contributionCents-Math.max(0,a.weekendDaily-a.weekdayDaily)*a.contributionCents || b.contributionCents-a.contributionCents);
  const salesCents = safeInteger(rows.reduce((sum,menu)=>sum+BigInt(toCents(menu.price))*BigInt(menu.weekday+menu.weekend),0n));
  const totalContributionCents = safeInteger(rows.reduce((sum,menu)=>sum+BigInt(menu.contributionCents)*BigInt(menu.weekday+menu.weekend),0n));
  return {rows,recommended:ranked[0]?.name??null,sales:salesCents/100,totalContribution:totalContributionCents/100,salesCents,totalContributionCents,
    orders:rows.reduce((sum,menu)=>sum+menu.weekday+menu.weekend,0),weekdayDaily:rows.reduce((sum,menu)=>sum+menu.weekdayDaily,0),
    weekendDaily:rows.reduce((sum,menu)=>sum+menu.weekendDaily,0),period:{...period},denominator,rounding:'half-up per item; integer satang'};
}
export function analyzeCents(menus,period=DEFAULT_PERIOD) { return analyze(menus,period); }

export function project(menu, plan) {
  if (!plan) throw Error('Campaign assumptions are required.');
  validateDiscount(plan.discount);
  validateOrders(plan.extraOrders,'Additional orders');
  validateOrders(plan.existingOrders,'Existing orders');
  const budgetCents = validateAmount(plan.budget,'Campaign spend');
  const baseCents = contributionCents(menu).contributionCents;
  const offerDetails = contributionCents(menu,plan.discount), offerCents = offerDetails.contributionCents;
  const existingLossCents = multiplyCents(baseCents-offerCents,plan.existingOrders);
  const netCents = addCents(multiplyCents(offerCents,plan.extraOrders),-existingLossCents,-budgetCents);
  return {base:baseCents/100,offer:offerCents/100,existingLoss:existingLossCents/100,net:netCents/100,sellingPrice:offerDetails.sellingPriceCents/100,
    baseCents,offerCents,existingLossCents,netCents,budgetCents,sellingPriceCents:offerDetails.sellingPriceCents,
    breakEven:offerCents>0?safeInteger((BigInt(existingLossCents+budgetCents)+BigInt(offerCents)-1n)/BigInt(offerCents)):null};
}
export function projectCents(menu,plan) { return project(menu,plan); }

export function evaluate(menu, plan, actual) {
  if (!actual) throw Error('Campaign results are required.');
  validateOrders(actual.totalOrders,'Actual orders');
  validateOrders(actual.baselineOrders,'Baseline orders');
  const spendCents = validateAmount(actual.spend,'Actual spend'), projection = project(menu,plan);
  const netCents = addCents(multiplyCents(projection.offerCents,actual.totalOrders),-multiplyCents(projection.baseCents,actual.baselineOrders),-spendCents);
  return {incrementalOrders:actual.totalOrders-actual.baselineOrders,net:netCents/100,netCents,spendCents,estimate:true};
}

function csvRecords(text) {
  const records=[]; let row=[],cell='',state='plain',atStart=true;
  const finishCell=()=>{row.push(cell);cell='';state='plain';atStart=true;};
  const finishRow=()=>{finishCell();if(row.length!==1||row[0].trim()!=='')records.push(row);row=[];};
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(state==='quoted') {
      if(char==='"') { if(text[i+1]==='"'){cell+='"';i++;}else state='closed'; }
      else cell+=char;
      continue;
    }
    if(char===',') {finishCell();continue;}
    if(char==='\r'||char==='\n') {if(char==='\r'&&text[i+1]==='\n')i++;finishRow();continue;}
    if(state==='closed') throw Error('Only a comma or line ending may follow a closing CSV quote.');
    if(char==='"') {if(!atStart)throw Error('CSV quotes must enclose the entire field.');state='quoted';atStart=false;}
    else {cell+=char;atStart=false;}
  }
  if(state==='quoted') throw Error('The CSV contains an unclosed quote.');
  if(row.length||cell.length||state==='closed')finishRow();
  return records;
}
export function parseCsv(text) {
  if (typeof text !== 'string') throw Error('Upload CSV text.');
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) throw Error('CSV files must be no larger than 1 MB.');
  const records=csvRecords(text.replace(/^\uFEFF/,''));
  const headers=records.shift()?.map(value=>value.trim().toLowerCase());
  if(!headers||headers.length!==FIELDS.length||new Set(headers).size!==headers.length||FIELDS.some(field=>!headers.includes(field))) throw Error('Use exactly the seven unique column names in the sample CSV.');
  if(records.length>100) throw Error('Include between 1 and 100 menu items.');
  const index=FIELDS.map(field=>headers.indexOf(field));
  const number=value=>{
    const text=value.trim();
    if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw Error('CSV numbers must be non-negative decimals with at most two decimal places.');
    return Number(text);
  };
  const menus=records.map((row,rowIndex)=>{
    if(row.length!==FIELDS.length)throw Error(`CSV row ${rowIndex+2} must contain exactly seven fields.`);
    const values=index.map(column=>row[column]);
    if(values.some(value=>!value.trim()))throw Error(`CSV row ${rowIndex+2} needs all seven fields.`);
    return {name:values[0].trim(),weekday:number(values[1]),weekend:number(values[2]),price:number(values[3]),ingredients:number(values[4]),packaging:number(values[5]),fee:number(values[6])};
  });
  return validateMenus(menus);
}
export function menuCsv(menus) {
  validateMenus(menus);
  const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
  return FIELDS.join(',')+'\n'+menus.map(menu=>[quote(menu.name),menu.weekday,menu.weekend,menu.price,menu.ingredients,menu.packaging,menu.fee].join(',')).join('\n');
}

export function createDrafts(business,menu,plan,language=business.language||'en') {
  const price=(contributionCents(menu,plan.discount).sellingPriceCents/100).toFixed(2);
  if(language==='th') {
    const offer=plan.discount>0?`${menu.name} ลด ${plan.discount}% ราคา ${price} บาท`:`${menu.name} ราคา ${price} บาท`;
    return {social:`มื้อกลางวันวันธรรมดาที่ ${business.name}\n\n${offer}\nสำหรับ${business.audience}\nวันจันทร์–ศุกร์ 11:00–14:00 น. ในสัปดาห์แคมเปญ\nตรวจสอบวันจริงและช่องทางสั่งก่อนเผยแพร่`,
      message:`สวัสดีจาก ${business.name} มื้อกลางวันสัปดาห์นี้: ${offer} วันจันทร์–ศุกร์ 11:00–14:00 น. ยืนยันวันและช่องทางสั่งก่อนส่ง`,
      announcement:`${business.name} จัดแคมเปญมื้อกลางวันวันธรรมดาสำหรับ${business.audience} เมนู ${offer} ยืนยันวัน เงื่อนไข และช่องทางสั่งก่อนเผยแพร่`};
  }
  const opening=business.tone==='Direct'?'Weekday lunch, sorted.':business.tone==='Polished'?'A considered choice for your weekday lunch.':'Make your weekday lunch a little easier.';
  const offer=plan.discount>0?`${plan.discount}% off ${menu.name} — THB ${price}.`:`${menu.name} — THB ${price}.`;
  return {social:`${opening}\n\n${offer}\nFrom ${business.name}, for ${business.audience}.\nAvailable Monday–Friday, 11:00–14:00, during the campaign week.\nConfirm dates and ordering details before publishing.`,
    message:`Hello from ${business.name}. Our weekday lunch feature is ${menu.name} at THB ${price}${plan.discount>0?` (${plan.discount}% off)`:''}. Available Monday–Friday, 11:00–14:00, during the campaign week. Confirm dates before sending.`,
    announcement:`${business.name} announces a weekday lunch campaign for ${business.audience}, featuring ${menu.name} at THB ${price}. The campaign runs Monday–Friday, 11:00–14:00, for one week. Confirm campaign dates and ordering details before publishing.`};
}
