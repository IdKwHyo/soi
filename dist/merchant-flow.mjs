import {analyze,contributionCents,project,evaluate,toCents,sampleMenus,DEFAULT_PERIOD} from './core.mjs';

// This extension names the merchant's sources explicitly. An unassigned channel
// stays unknown; selecting "combined" never counts one report twice.
const CHANNELS=['grab','storefront'];
const MONEY_FIELDS=['fixedCosts','marketingSpend','openingCash','upcomingPayments','receivables'];
const SCENARIO_FIELDS=['menuName','channel','price','discount','extraOrders','existingOrders','budget','newCustomers'];
const clone=value=>structuredClone(value);
const nameKey=value=>value.trim().normalize('NFC').toLocaleLowerCase();
const DEFAULT=()=>({schemaVersion:1,setup:{goal:'balanced',feePercent:null,fixedCosts:null,marketingSpend:null,openingCash:null,upcomingPayments:null,receivables:null},scope:'combined',sources:{grab:null,storefront:null},scenario:{menuName:'',channel:'grab',price:null,discount:0,extraOrders:20,existingOrders:0,budget:0,newCustomers:null},outcomes:[]});

function object(value,label) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${label} is invalid.`);
}
function only(value,fields,label) {
  object(value,label);
  if(Object.keys(value).some(key=>!fields.includes(key)))throw Error(`${label} contains unsupported fields.`);
}
function required(value,fields,label) {
  only(value,fields,label);
  if(fields.some(key=>!Object.hasOwn(value,key)))throw Error(`${label} is incomplete.`);
}
function amount(value,label,{nullable=false,max=1_000_000,min=0}={}) {
  if(nullable&&value===null)return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(`${label} must be between ${min} and ${max}.`);
  return toCents(value);
}
function count(value,label,{nullable=false}={}) {
  if(nullable&&value===null)return null;
  if(!Number.isSafeInteger(value)||value<0||value>100_000)throw Error(`${label} must be a whole number between 0 and 100000.`);
  return value;
}
function sumCents(values) {
  const value=Number(values.reduce((sum,item)=>sum+BigInt(item),0n));
  if(!Number.isSafeInteger(value))throw Error('The calculated total exceeds the supported amount.');
  return value;
}
function freeze(value) {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);Object.freeze(value);
  }
  return value;
}
function settings(flow) {
  return {schemaVersion:1,setup:clone(flow.setup),scope:flow.scope,sources:clone(flow.sources),scenario:clone(flow.scenario)};
}
function sourceDataset(state,flow,channel) {
  const id=flow.sources[channel];
  if(id===null)return null;
  const dataset=state.datasets?.find(item=>item.id===id);
  if(!dataset)throw Error(`The selected ${channel} report is missing. Assign an available source.`);
  return dataset;
}
function validateScenario(scenario) {
  required(scenario,SCENARIO_FIELDS,'Scenario');
  if(typeof scenario.menuName!=='string'||scenario.menuName.length>200)throw Error('Choose a menu name of up to 200 characters.');
  if(!CHANNELS.includes(scenario.channel))throw Error('Choose Grab or storefront for the scenario.');
  amount(scenario.price,'Scenario price',{nullable:true,min:0.01});
  amount(scenario.discount,'Discount',{max:50});
  count(scenario.extraOrders,'Additional orders');count(scenario.existingOrders,'Existing orders');
  amount(scenario.budget,'Scenario spend');count(scenario.newCustomers,'Expected new customers',{nullable:true});
  if(scenario.newCustomers!==null&&scenario.newCustomers>scenario.extraOrders)throw Error('Expected new customers cannot exceed assumed additional orders.');
}
function validateSettings(state,flow) {
  if(flow.schemaVersion!==1)throw Error('This merchant workflow version is not supported.');
  required(flow.setup,['goal','feePercent',...MONEY_FIELDS],'Shop setup');
  if(!['profit','growth','balanced'].includes(flow.setup.goal))throw Error('Choose a profit, growth or balanced goal.');
  amount(flow.setup.feePercent,'Effective Grab fee',{nullable:true,max:99.99});
  for(const field of MONEY_FIELDS)amount(flow.setup[field],field,{nullable:true});
  if(!['grab','storefront','combined'].includes(flow.scope))throw Error('Choose Grab, storefront or combined calculation.');
  required(flow.sources,CHANNELS,'Channel sources');
  for(const channel of CHANNELS) {
    const id=flow.sources[channel];
    if(id!==null&&(typeof id!=='string'||!id||id.length>200))throw Error('A channel source must reference an existing report.');
    sourceDataset(state,flow,channel);
  }
  if(flow.sources.grab!==null&&flow.sources.grab===flow.sources.storefront)throw Error('Assign separate reports to Grab and storefront to avoid counting sales twice.');
  validateScenario(flow.scenario);
  if(flow.scope!=='combined'&&flow.scenario.channel!==flow.scope)throw Error('The scenario channel must match the selected calculation scope.');
  const scenarioDataset=sourceDataset(state,flow,flow.scenario.channel);
  if(scenarioDataset&&flow.scenario.menuName&&!scenarioDataset.menus.some(menu=>nameKey(menu.name)===nameKey(flow.scenario.menuName)))throw Error('Choose a menu in the selected channel report.');
}

export function normalizeMerchantFlow(state) {
  object(state,'Workspace');
  if(state.merchantFlow===undefined)state.merchantFlow=DEFAULT();
  return state;
}

function channelMenus(dataset,flow,channel) {
  return dataset.menus.map(menu=>({...menu,fee:channel==='storefront'?0:(flow.setup.feePercent??menu.fee)}));
}
function simulateWithFlow(state,flow,payload=flow.scenario) {
  const scenario={...flow.scenario,...payload};validateScenario(scenario);
  if(flow.scope!=='combined'&&scenario.channel!==flow.scope)throw Error('The scenario channel must match the selected calculation scope.');
  const dataset=sourceDataset(state,flow,scenario.channel);
  if(!dataset)throw Error(`Assign a ${scenario.channel} report before testing a scenario.`);
  const original=dataset.menus.find(menu=>nameKey(menu.name)===nameKey(scenario.menuName));
  if(!original)throw Error('Choose a menu in the selected channel report.');
  const baselineMenu={...original,fee:scenario.channel==='storefront'?0:(flow.setup.feePercent??original.fee)};
  const menu={...baselineMenu,price:scenario.price??original.price};
  // The core validates all scenario inputs and computes the offered unit value.
  // A changed price must still compare existing orders with the original source
  // price. A negative existingLoss therefore represents a gain, not a cost.
  const calculated=project(menu,scenario),baseCents=contributionCents(baselineMenu).contributionCents;
  const existingLossCents=sumCents([(baseCents-calculated.offerCents)*scenario.existingOrders]);
  const netCents=sumCents([calculated.offerCents*scenario.extraOrders,-existingLossCents,-calculated.budgetCents]);
  const breakEven=calculated.offerCents>0?Math.max(0,Number((BigInt(existingLossCents+calculated.budgetCents)+BigInt(calculated.offerCents)-1n)/BigInt(calculated.offerCents))):null;
  const projection={...calculated,baseCents,base:baseCents/100,existingLossCents,existingLoss:existingLossCents/100,netCents,net:netCents/100,breakEven};
  const cacCents=scenario.newCustomers>0?Math.round(projection.budgetCents/scenario.newCustomers):null;
  const snapshot={schemaVersion:1,settings:{...settings(flow),scenario:clone(scenario)},datasetId:dataset.id,datasetName:dataset.name,sourceType:dataset.sourceType,period:clone(dataset.period),menu:clone(menu),scenario:clone(scenario),projection:clone(projection)};
  return {projection,menu,baselineMenu,datasetId:dataset.id,datasetName:dataset.name,sourceType:dataset.sourceType,channel:scenario.channel,scenario,cacCents,cac:cacCents===null?null:cacCents/100,newCustomers:scenario.newCustomers,snapshot};
}
function stable(value) {
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function validateSnapshot(state,snapshot) {
  required(snapshot,['schemaVersion','settings','datasetId','datasetName','sourceType','period','menu','scenario','projection'],'Scenario snapshot');
  if(snapshot.schemaVersion!==1)throw Error('This scenario snapshot is not supported.');
  required(snapshot.settings,['schemaVersion','setup','scope','sources','scenario'],'Scenario settings');
  validateSettings(state,snapshot.settings);
  const expected=simulateWithFlow(state,snapshot.settings,snapshot.scenario).snapshot;
  if(!same(expected,snapshot))throw Error('The scenario snapshot no longer matches its source and calculation.');
  return expected;
}
function actualFields(actual) {
  const fields=['totalOrders','baselineOrders','spend','newCustomers','returningCustomers','repeatCustomers'];
  only(actual,[...fields,'paybackDays'],'Actual result');
  if(fields.some(key=>!Object.hasOwn(actual,key)))throw Error('Actual result is incomplete.');
  count(actual.totalOrders,'Actual orders');count(actual.baselineOrders,'Baseline orders');amount(actual.spend,'Actual spend');
  // Payback is a separately observed owner input. Orders and a spend estimate
  // do not establish when cash was recovered, so it is never inferred here.
  if(actual.paybackDays!==undefined&&actual.paybackDays!==null&&(!Number.isSafeInteger(actual.paybackDays)||actual.paybackDays<0||actual.paybackDays>3650))throw Error('Reported payback days must be a whole number between 0 and 3650, or unknown.');
  for(const field of ['newCustomers','returningCustomers','repeatCustomers']) {
    count(actual[field],field,{nullable:true});
    if(actual[field]!==null&&actual[field]>actual.totalOrders)throw Error('Customer counts cannot exceed recorded orders in this one-item scenario.');
  }
  if(actual.newCustomers!==null&&actual.returningCustomers!==null&&actual.newCustomers+actual.returningCustomers>actual.totalOrders)throw Error('New and returning customer counts exceed recorded orders.');
  const customers=actual.newCustomers!==null&&actual.returningCustomers!==null?actual.newCustomers+actual.returningCustomers:null;
  if(customers!==null&&actual.repeatCustomers!==null&&actual.repeatCustomers>customers)throw Error('Repeat customers cannot exceed recorded customer counts.');
  return customers;
}
function outcomeMetrics(snapshot,actual) {
  const customers=actualFields(actual),calculated=evaluate(snapshot.menu,snapshot.scenario,actual);
  const netCents=sumCents([snapshot.projection.offerCents*actual.totalOrders,-snapshot.projection.baseCents*actual.baselineOrders,-calculated.spendCents]);
  const evaluation={...calculated,netCents,net:netCents/100};
  const cacCents=actual.newCustomers>0?Math.round(evaluation.spendCents/actual.newCustomers):null;
  return {evaluation,cacCents,cac:cacCents===null?null:cacCents/100,
    returningShare:customers>0?actual.returningCustomers/customers:null,
    repeatShare:customers>0&&actual.repeatCustomers!==null?actual.repeatCustomers/customers:null};
}
function validateOutcome(state,outcome) {
  required(outcome,['id','createdAt','source','snapshot','actual','evaluation','cacCents','cac','returningShare','repeatShare','interpretation'],'Workflow outcome');
  if(typeof outcome.id!=='string'||!/^flow_result_[A-Za-z0-9_-]{1,100}$/.test(outcome.id))throw Error('The workflow result identifier is invalid.');
  if(typeof outcome.createdAt!=='string'||!Number.isFinite(Date.parse(outcome.createdAt)))throw Error('The workflow result date is invalid.');
  if(!['owner','demo'].includes(outcome.source))throw Error('Workflow results need an owner or demo source.');
  validateSnapshot(state,outcome.snapshot);
  const metrics=outcomeMetrics(outcome.snapshot,outcome.actual);
  if(Object.keys(metrics).some(key=>!same(outcome[key],metrics[key])))throw Error('Workflow result calculations do not match the pinned scenario.');
  if(outcome.interpretation!==INTERPRETATION)throw Error('The workflow result interpretation is invalid.');
  freeze(outcome);
}
const INTERPRETATION='Estimated incremental contribution uses an owner-supplied baseline, not a causal A/B experiment. Customer shares describe entered counts, not cohort retention or future lifetime value.';

export function validateMerchantFlow(state) {
  normalizeMerchantFlow(state);
  const flow=state.merchantFlow;
  required(flow,['schemaVersion','setup','scope','sources','scenario','outcomes'],'Merchant workflow');
  validateSettings(state,flow);
  if(!Array.isArray(flow.outcomes)||flow.outcomes.length>50)throw Error('Keep at most 50 workflow outcomes. Export the workspace before recording more.');
  const ids=new Set();
  for(const outcome of flow.outcomes) {
    if(ids.has(outcome.id))throw Error('Workflow result identifiers must be unique.');
    ids.add(outcome.id);validateOutcome(state,outcome);
  }
  return state;
}

export function updateMerchantFlow(state,payload) {
  only(payload,['setup','scope','sources','scenario'],'Workflow update');
  if(!Number.isSafeInteger(state.revision)||state.revision<0)throw Error('The workspace revision is invalid.');
  const flow=clone(state.merchantFlow===undefined?DEFAULT():state.merchantFlow);
  const previousChannel=flow.scenario?.channel;
  if(payload.setup!==undefined) {only(payload.setup,['goal','feePercent',...MONEY_FIELDS],'Setup update');flow.setup={...flow.setup,...payload.setup};}
  if(payload.sources!==undefined) {only(payload.sources,CHANNELS,'Source update');flow.sources={...flow.sources,...payload.sources};}
  if(payload.scenario!==undefined) {only(payload.scenario,SCENARIO_FIELDS,'Scenario update');flow.scenario={...flow.scenario,...payload.scenario};}
  if(payload.scope!==undefined)flow.scope=payload.scope;
  const switching=payload.scope!==undefined&&['grab','storefront'].includes(flow.scope)&&previousChannel!==flow.scope;
  if(payload.scope!==undefined&&['grab','storefront'].includes(flow.scope))flow.scenario.channel=flow.scope;
  const changedContext=payload.scope!==undefined||payload.sources!==undefined;
  if(changedContext&&!Object.hasOwn(payload.scenario??{},'menuName')) {
    const dataset=sourceDataset(state,flow,flow.scenario.channel);
    const menuExists=dataset?.menus.some(menu=>nameKey(menu.name)===nameKey(flow.scenario.menuName));
    if(switching||!menuExists) {
      flow.scenario.menuName=dataset?.menus[0]?.name??'';
      flow.scenario.price=null;
    }
  }
  if(switching&&!Object.hasOwn(payload.scenario??{},'price'))flow.scenario.price=null;
  if(flow.scope!=='combined'&&flow.scenario.channel!==flow.scope)throw Error('The scenario channel must match the selected calculation scope.');
  validateMerchantFlow({...state,merchantFlow:flow});
  state.merchantFlow=flow;state.selectedCandidateId=null;state.revision+=1;
  return flow;
}

export function loadMerchantDemo(state) {
  if(!Array.isArray(state.datasets))throw Error('The workspace report history is invalid.');
  const flow=clone(state.merchantFlow===undefined?DEFAULT():state.merchantFlow);
  validateMerchantFlow({...state,merchantFlow:flow});
  const definitions=[
    {channel:'grab',name:'Workflow demo / Grab',menus:sampleMenus.map(menu=>({...menu,fee:32.1}))},
    {channel:'storefront',name:'Workflow demo / Storefront',menus:sampleMenus.map((menu,index)=>({...menu,price:[69,75,35][index],packaging:2,weekday:[180,140,160][index],weekend:[100,90,80][index],fee:0}))}
  ];
  const created=[],selected={};
  for(const definition of definitions) {
    const existing=state.datasets.find(dataset=>dataset.sourceType==='synthetic'&&dataset.name===definition.name&&same(dataset.period,DEFAULT_PERIOD)&&same(dataset.menus,definition.menus));
    const dataset=existing??freeze({id:`dataset_${crypto.randomUUID()}`,name:definition.name,menus:clone(definition.menus),period:clone(DEFAULT_PERIOD),sourceType:'synthetic',createdAt:new Date().toISOString()});
    selected[definition.channel]=dataset;if(!existing)created.push(dataset);
  }
  if(created.length&&state.datasets.length+created.length>100)throw Error('Export your workspace before adding demo reports beyond 100 datasets.');
  const next={...state,datasets:[...state.datasets,...created],merchantFlow:flow,activeDatasetId:selected.grab.id};
  // This action is an explicit demo fixture load. It changes no imported report,
  // recorded costs, cash inputs or outcomes. The demo client guards its use.
  updateMerchantFlow(next,{scope:'combined',sources:{grab:selected.grab.id,storefront:selected.storefront.id},setup:{feePercent:null},scenario:{menuName:selected.grab.menus[0].name,channel:'grab',price:null}});
  for(const dataset of Object.values(selected))freeze(dataset);
  for(const field of ['datasets','merchantFlow','activeDatasetId','selectedCandidateId','revision'])state[field]=next[field];
  return {grab:selected.grab,storefront:selected.storefront,createdCount:created.length};
}

function channelReport(state,flow,channel) {
  const dataset=sourceDataset(state,flow,channel);if(!dataset)return null;
  const menus=channelMenus(dataset,flow,channel),analysis=analyze(menus,dataset.period);
  const rows=menus.map(menu=>{
    const details=contributionCents(menu),orders=menu.weekday+menu.weekend;
    return {...menu,...details,orders,salesCents:sumCents([toCents(menu.price)*orders]),feeTotalCents:sumCents([details.feeCents*orders]),ingredientTotalCents:sumCents([toCents(menu.ingredients)*orders]),packagingTotalCents:sumCents([toCents(menu.packaging)*orders]),contributionTotalCents:sumCents([details.contributionCents*orders])};
  });
  const totals={salesCents:analysis.salesCents,feeCents:sumCents(rows.map(row=>row.feeTotalCents)),ingredientCents:sumCents(rows.map(row=>row.ingredientTotalCents)),packagingCents:sumCents(rows.map(row=>row.packagingTotalCents)),contributionCents:analysis.totalContributionCents,orders:analysis.orders};
  return {channel,datasetId:dataset.id,datasetName:dataset.name,sourceType:dataset.sourceType,period:clone(dataset.period),analysis,rows,...humanTotals(totals)};
}
function humanTotals(totals) {
  return {...totals,sales:totals.salesCents/100,fees:totals.feeCents/100,ingredients:totals.ingredientCents/100,packaging:totals.packagingCents/100,contribution:totals.contributionCents/100};
}
export function merchantReport(state) {
  validateMerchantFlow(state);const flow=state.merchantFlow;
  const includedChannels=flow.scope==='combined'?CHANNELS:[flow.scope];
  const channels=Object.fromEntries(CHANNELS.map(channel=>[channel,channelReport(state,flow,channel)]));
  const present=includedChannels.map(channel=>channels[channel]).filter(Boolean);
  const missingChannels=includedChannels.filter(channel=>!channels[channel]);
  const periodCompatible=present.length<2||present.every(channel=>same(channel.period,present[0].period));
  const complete=missingChannels.length===0&&periodCompatible;
  const knownTotals=present.length&&periodCompatible?humanTotals(Object.fromEntries(['salesCents','feeCents','ingredientCents','packagingCents','contributionCents','orders'].map(key=>[key,sumCents(present.map(channel=>channel[key]))]))):null;
  const totals=complete?knownTotals:null;
  const knownCosts=MONEY_FIELDS.slice(0,2).filter(field=>flow.setup[field]!==null);
  const knownCostsCents=sumCents(knownCosts.map(field=>toCents(flow.setup[field])));
  const netAfterKnownCostsCents=totals&&knownCosts.length?sumCents([totals.contributionCents,-knownCostsCents]):null;
  const cashComplete=['openingCash','receivables','upcomingPayments'].every(field=>flow.setup[field]!==null);
  const cashBalanceCents=cashComplete?sumCents([toCents(flow.setup.openingCash),toCents(flow.setup.receivables),-toCents(flow.setup.upcomingPayments)]):null;
  return {scope:flow.scope,channels,includedChannels,missingChannels,complete,periodCompatible,period:complete?clone(present[0].period):null,totals,knownTotals,knownCosts,knownCostsCents,costsComplete:knownCosts.length===2,netAfterKnownCostsCents,netAfterKnownCosts:netAfterKnownCostsCents===null?null:netAfterKnownCostsCents/100,cashComplete,cashBalanceCents,cashBalance:cashBalanceCents===null?null:cashBalanceCents/100,
    exclusions:['Tax and labour are excluded unless explicitly included in entered costs.','Cash buffer uses entered cash, receivables and upcoming payments; contribution is not cash flow.','Channel reports must cover the same dates before combining.']};
}

// Find the lowest supported price that retains the storefront selling price
// after the effective platform fee. Reusing the core fee rounding avoids an
// off-by-one satang at fee ties that a plain ceil(price/(1-fee)) can produce.
function requiredPrice(storefrontPrice,fee) {
  if(fee>=100)return null;
  const target=toCents(storefrontPrice),limit=100_000_000;
  const net=cents=>contributionCents({name:'Fee comparison',price:cents/100,ingredients:0,packaging:0,weekday:0,weekend:0,fee}).contributionCents;
  if(net(limit)<target)return null;
  let low=Math.max(1,target),high=limit;
  while(low<high) {const middle=Math.floor((low+high)/2);if(net(middle)>=target)high=middle;else low=middle+1;}
  return low;
}
export function priceComparison(state) {
  validateMerchantFlow(state);const flow=state.merchantFlow;
  const grab=sourceDataset(state,flow,'grab'),storefront=sourceDataset(state,flow,'storefront');
  if(!grab||!storefront)return [];
  const grabRows=new Map(channelMenus(grab,flow,'grab').map(menu=>[nameKey(menu.name),menu]));
  return channelMenus(storefront,flow,'storefront').flatMap(menu=>{
    const online=grabRows.get(nameKey(menu.name));if(!online)return [];
    const net=contributionCents({...online,ingredients:0,packaging:0}).contributionCents;
    const requiredGrabPriceCents=requiredPrice(menu.price,online.fee);
    return [{name:menu.name,storefrontPrice:menu.price,storefrontPriceCents:toCents(menu.price),grabPrice:online.price,grabPriceCents:toCents(online.price),feePercent:online.fee,netGrabPriceCents:net,netGrabPrice:net/100,requiredGrabPriceCents,requiredGrabPrice:requiredGrabPriceCents===null?null:requiredGrabPriceCents/100,requiredIncrease:requiredGrabPriceCents===null?null:(requiredGrabPriceCents-toCents(online.price))/100,grabDatasetId:grab.id,storefrontDatasetId:storefront.id,
      interpretation:'Fee-only parity comparison, not a recommended price. Ingredient and packaging differences, tax and demand are not adjusted.'}];
  });
}

export function simulateMerchantPlan(state,payload) {
  validateMerchantFlow(state);return simulateWithFlow(state,state.merchantFlow,payload??state.merchantFlow.scenario);
}

export function recordMerchantOutcome(state,payload,{source='owner'}={}) {
  only(payload,['id','snapshot','totalOrders','baselineOrders','spend','newCustomers','returningCustomers','repeatCustomers','paybackDays','source'],'Outcome input');
  if(payload.id!==undefined&&(typeof payload.id!=='string'||!/^flow_result_[A-Za-z0-9_-]{1,100}$/.test(payload.id)))throw Error('The workflow result identifier is invalid.');
  if(!['owner','demo'].includes(source)||payload.source!==undefined&&payload.source!==source)throw Error('The result source does not match this workflow.');
  if(!Number.isSafeInteger(state.revision)||state.revision<0)throw Error('The workspace revision is invalid.');
  const flow=clone(state.merchantFlow===undefined?DEFAULT():state.merchantFlow);validateMerchantFlow({...state,merchantFlow:flow});
  const snapshot=validateSnapshot(state,payload.snapshot);
  const actual={totalOrders:payload.totalOrders,baselineOrders:payload.baselineOrders,spend:payload.spend,newCustomers:payload.newCustomers??null,returningCustomers:payload.returningCustomers??null,repeatCustomers:payload.repeatCustomers??null,paybackDays:payload.paybackDays??null};
  const metrics=outcomeMetrics(snapshot,actual);
  const existing=payload.id!==undefined?flow.outcomes.find(outcome=>outcome.id===payload.id):null;
  if(existing) {
    const previousActual={...existing.actual,paybackDays:existing.actual.paybackDays??null};
    if(existing.source!==source||!same(existing.snapshot,snapshot)||!same(previousActual,actual))throw Error('This result identifier already belongs to different recorded contents.');
    return freeze(state.merchantFlow.outcomes.find(outcome=>outcome.id===existing.id));
  }
  if(flow.outcomes.length>=50)throw Error('Export your workspace before recording more than 50 workflow outcomes.');
  const outcome=freeze({id:payload.id??`flow_result_${crypto.randomUUID()}`,createdAt:new Date().toISOString(),source,snapshot:clone(snapshot),actual:clone(actual),...metrics,interpretation:INTERPRETATION});
  flow.outcomes.push(outcome);state.merchantFlow=flow;state.revision+=1;
  return outcome;
}
