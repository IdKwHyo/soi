import {normalizeMerchantFlow,merchantReport,priceComparison,simulateMerchantPlan,updateMerchantFlow} from './merchant-flow.mjs';
import {contributionCents} from './core.mjs';
import {formatMoney,formatNumber,formatDate} from './i18n.mjs';
import {merchantFlowCopy} from './merchant-flow-copy.mjs';

const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const nullable=value=>String(value??'').trim()===''?null:Number(value);
const channelDataset=(state,channel)=>state.datasets.find(item=>item.id===state.merchantFlow.sources[channel]);
const menuKey=name=>name.trim().normalize('NFC').toLocaleLowerCase();
const formId='merchant-flow-form';

function context(state,language){
  normalizeMerchantFlow(state);
  return {state,flow:state.merchantFlow,c:merchantFlowCopy(language),language,
    money:value=>value===null||value===undefined?'—':formatMoney(value,language),
    num:(value,decimals=0)=>value===null||value===undefined?'—':formatNumber(value,language,decimals),
    date:value=>formatDate(value,language)};
}
function field(label,name,value,{required=false,step='.01',min=0,max=1000000,help='',wide=false,placeholder=''}={}){
  const id=`mflow-${name}`;
  return `<label class="field${wide?' flow-field-wide':''}" for="${id}"><span>${escape(label)}</span><input id="${id}" name="${name}" type="number" inputmode="${step==='1'?'numeric':'decimal'}" value="${escape(value)}" min="${min}" max="${max}" step="${step}"${required?' required':''}${placeholder?` placeholder="${escape(placeholder)}"`:''}${help?` aria-describedby="${id}-hint"`:''}>${help?`<small id="${id}-hint">${escape(help)}</small>`:''}</label>`;
}
function select(label,name,value,options,{required=true,wide=false}={}){
  const id=`mflow-${name}`;
  return `<label class="field${wide?' flow-field-wide':''}" for="${id}"><span>${escape(label)}</span><select id="${id}" name="${name}"${required?' required':''}>${options.map(([key,text,disabled])=>`<option value="${escape(key)}"${String(value??'')===String(key)?' selected':''}${disabled?' disabled':''}>${escape(text)}</option>`).join('')}</select></label>`;
}
const tool=(view,label)=>`<button class="text-button" type="button" data-flow-tool="${view}">${escape(label)}</button>`;
const note=(text,kind='')=>`<p class="flow-notice${kind?' '+kind:''}">${escape(text)}</p>`;
const disclosure=(title,text)=>`<details class="flow-details"><summary>${escape(title)}</summary><p>${escape(text)}</p></details>`;
function actions(c,step,hasForm=true){
  return `<div class="flow-actions">${step>1?`<button class="text-button" type="button" data-flow-step="${step-1}">${c.back}</button>`:'<span></span>'}<div class="flow-primary-actions">${hasForm?`<button class="button secondary" type="submit" name="save">${c.save}</button>`:''}${step<8?`<button class="button" ${hasForm?'type="submit" name="continue"':`type="button" data-flow-step="${step+1}"`}>${hasForm?c.continue:c.next}</button>`:''}</div></div>`;
}
function errorMarkup(){return '<div class="flow-error flow-notice error" role="alert" tabindex="-1" hidden></div><p class="flow-status" role="status" hidden></p>';}
function sourceNote(ctx,channel,id=ctx.flow.sources[channel]){
  const data=ctx.state.datasets.find(item=>item.id===id);
  if(!data)return `<p class="flow-source-note">${ctx.c.noRecords}</p>`;
  return `<p class="flow-source-note"><span>${escape(ctx.c.sourceKinds[data.sourceType]||data.sourceType)} · ${escape(data.name)}</span><span>${ctx.c.period}: ${ctx.date(data.period.start)} — ${ctx.date(data.period.end)}</span></p>`;
}
function sourceWarnings(ctx,report){
  let html='';
  if(report.missingChannels.length)html+=note(ctx.c.missingSources,'warning');
  if(!report.periodCompatible)html+=note(ctx.c.periodMismatch,'warning');
  if(report.includedChannels.some(channel=>report.channels[channel]?.sourceType==='synthetic'))html+=note(ctx.c.sampleWarning);
  return html;
}

function setupStep(ctx){
  const {c,flow,state}=ctx;
  return `<form id="${formId}" data-flow-form="setup">${errorMarkup()}<div class="flow-shop"><div><p class="eyebrow">${c.shop}</p><strong>${escape(state.business.name)}</strong></div>${tool('data',c.editProfile)}</div><div class="flow-form-grid">${select(c.goal,'goal',flow.setup.goal,Object.entries(c.goals),{wide:true})}</div><h3>${c.costTitle}</h3><p class="flow-helper">${c.costHelp}</p><div class="flow-form-grid">${field(c.fixedCosts,'fixedCosts',flow.setup.fixedCosts,{placeholder:c.unknown})}${field(c.marketingSpend,'marketingSpend',flow.setup.marketingSpend,{placeholder:c.unknown})}</div>${actions(c,1)}</form>`;
}
function scopeStep(ctx){
  const {c,flow}=ctx;
  return `<form id="${formId}" data-flow-form="scope">${errorMarkup()}<fieldset class="flow-scope-options"><legend>${c.scope}</legend>${['storefront','grab','combined'].map(channel=>`<label class="flow-scope-option"><input type="radio" name="scope" value="${channel}"${flow.scope===channel?' checked':''} required><span><strong>${c.channels[channel]}</strong><small>${c.channelCopy[channel]}</small></span></label>`).join('')}</fieldset>${actions(c,2)}</form>`;
}
function sourcesStep(ctx,demo=false){
  const {c,state,flow}=ctx,report=merchantReport(state);
  return `<form id="${formId}" data-flow-form="sources">${errorMarkup()}<p class="flow-helper">${c.sourceHelp}</p><div class="flow-form-grid">${['storefront','grab'].map(channel=>`<div>${select(`${c.channels[channel]} · ${c.sourceLabel}`,channel,flow.sources[channel],[["",c.notAssigned],...state.datasets.map(data=>[data.id,`${data.name} · ${c.sourceKinds[data.sourceType]||data.sourceType}`,data.id===flow.sources[channel==='grab'?'storefront':'grab']])],{required:false})}<div data-flow-source-note="${channel}">${sourceNote(ctx,channel)}</div></div>`).join('')}</div><div class="flow-source-warnings">${sourceWarnings(ctx,report)}</div><div class="flow-primary-actions">${tool('data',c.addData)}${demo?`<button class="button secondary" type="button" data-flow-demo>${c.loadDemo}</button>`:''}</div>${demo?`<p class="flow-helper">${c.demoSources}</p>`:''}${disclosure(c.notes,c.inputHelp)}${actions(c,3)}</form>`;
}
function priceTable(ctx){
  const {c,state,flow,money,num}=ctx,grab=channelDataset(state,'grab'),storefront=channelDataset(state,'storefront');
  if(!grab&&!storefront)return `<p class="flow-empty">${c.noPriceRows}</p>`;
  const paired=new Map(priceComparison(state).map(row=>[menuKey(row.name),row]));
  const grabByName=new Map((grab?.menus||[]).map(menu=>[menuKey(menu.name),menu]));
  const storeByName=new Map((storefront?.menus||[]).map(menu=>[menuKey(menu.name),menu]));
  const names=new Map([...(storefront?.menus||[]),...(grab?.menus||[])].map(menu=>[menuKey(menu.name),menu.name]));
  return `<div class="flow-table-scroll" tabindex="0" role="region" aria-label="${c.pricesTitle}"><table class="flow-table"><thead><tr>${[c.menu,c.storefrontPrice,c.grabPrice,c.feePercent,c.afterFee,c.matchPrice].map((label,i)=>`<th scope="col"${i?' class="number"':''}>${label}</th>`).join('')}</tr></thead><tbody>${[...names].map(([key,name])=>{
    const online=grabByName.get(key),shop=storeByName.get(key),match=paired.get(key),fee=online?(flow.setup.feePercent??online.fee):null;
    const net=online?contributionCents({...online,fee,ingredients:0,packaging:0}).contributionCents/100:null;
    return `<tr><th scope="row">${escape(name)}</th><td class="number">${money(shop?.price)}</td><td class="number">${money(online?.price)}</td><td class="number">${fee===null?'—':num(fee,2)+'%'}</td><td class="number">${money(net)}</td><td class="number">${money(match?.requiredGrabPrice)}</td></tr>`;
  }).join('')}</tbody><caption>${c.priceCaution}</caption></table></div>`;
}
function pricesStep(ctx){
  const {c,flow}=ctx;
  return `<form id="${formId}" data-flow-form="fees">${errorMarkup()}<div class="flow-form-grid">${field(c.feePercent,'feePercent',flow.setup.feePercent,{max:99.99,help:c.feeHelp,placeholder:c.unknown,wide:true})}</div><div id="flow-price-comparison">${priceTable(ctx)}</div>${disclosure(c.notes,c.feeExample)}${actions(c,4)}</form>`;
}
function totalsMarkup(ctx,totals,title){
  const {c,money}=ctx;
  if(!totals)return `<p class="flow-empty">${c.noCompleteTotals}</p>`;
  return `<section class="flow-financial-block">${title?`<h3>${escape(title)}</h3>`:''}<dl class="flow-money-list">${[[c.grossSales,totals.sales],[c.fees,-totals.fees],[c.ingredients,-totals.ingredients],[c.packaging,-totals.packaging],[c.contribution,totals.contribution]].map(([label,value],i)=>`<div${i===4?' class="flow-total"':''}><dt>${label}</dt><dd${value<0?' class="flow-negative"':''}>${money(value)}</dd></div>`).join('')}</dl></section>`;
}
function cashMarkup(ctx){
  const value=merchantReport(ctx.state).cashBalance;
  return `<dl class="flow-money-list"><div class="flow-total"><dt>${ctx.c.cashBalance}</dt><dd${value<0?' class="flow-negative"':''}>${ctx.money(value)}</dd></div></dl>`;
}
function financialStep(ctx){
  const {c,flow,state,money}=ctx,report=merchantReport(state);
  let totals=totalsMarkup(ctx,report.totals,c.channels[report.scope]);
  if(!report.complete)totals=report.includedChannels.map(channel=>totalsMarkup(ctx,report.channels[channel],c.channels[channel])).join('')+(report.knownTotals?totalsMarkup(ctx,report.knownTotals,c.knownOnly):'');
  return `${errorMarkup()}${sourceWarnings(ctx,report)}${totals}<dl class="flow-money-list"><div class="flow-total"><dt>${c.knownProfit}</dt><dd${report.netAfterKnownCosts<0?' class="flow-negative"':''}>${money(report.netAfterKnownCosts)}</dd></div></dl>${!report.costsComplete?note(c.profitMissing,'warning'):''}${disclosure(c.formula,c.profitCaution)}<form id="${formId}" data-flow-form="cash"><h3>${c.cashTitle}</h3><p class="flow-helper">${c.cashHelp}</p><div class="flow-form-grid">${['openingCash','receivables','upcomingPayments'].map(name=>field(c[name],name,flow.setup[name],{placeholder:c.unknown})).join('')}</div><div id="flow-cash-preview">${cashMarkup(ctx)}</div>${actions(c,5)}</form>`;
}
function advisorStep(ctx,demo,capabilities){
  const {c}=ctx,ready=capabilities.storage==='cloud'&&capabilities.advisor==='gemini',key=demo?'aiDemo':ready?'aiLive':'aiSetup';
  return `${errorMarkup()}<span class="flow-mode">${c[key]}</span><p class="flow-helper">${c[key+'Copy']}</p><div class="flow-primary-actions"><button class="button" type="button" data-flow-tool="advisor">${c.openAdvisor}</button>${tool('analysis',c.openAnalysis)}</div>${disclosure(c.notes,c.aiCaution)}${actions(c,6,false)}`;
}
function scenarioMenus(ctx,channel=ctx.flow.scenario.channel){return channelDataset(ctx.state,channel)?.menus||[];}
function scenarioPreview(ctx,scenario=ctx.flow.scenario,preview=false){
  const {c,money,num}=ctx;
  let simulation;
  try{simulation=simulateMerchantPlan(ctx.state,scenario);}catch{return `<p class="flow-empty">${c.noScenario}</p>`;}
  const p=simulation.projection,status=p.net>0?'positive':p.net<0?'negative':'zero';
  return `<div class="flow-scenario-preview"><p class="eyebrow">${c.scenarioPreview}</p><p class="flow-preview-label">${c.incremental}</p><div class="flow-preview-number${p.net<0?' flow-negative':''}">${money(p.net)}</div><p class="flow-preview-status${p.net<0?' flow-negative':''}">${c[status]}</p><div class="flow-preview-substats">${[[money(p.offer),c.offerContribution],[money(-p.existingLoss),c.existingChange],[num(p.breakEven),c.breakEven],[money(simulation.cac),c.cac],[num(simulation.newCustomers),c.newCustomers]].map(([value,label])=>`<div><strong>${value}</strong><small>${label}</small></div>`).join('')}</div>${p.net<0&&simulation.newCustomers>0?`<p class="flow-helper">${c.tradeoff}</p>`:''}<p class="flow-preview-note">${escape(simulation.datasetName)} · ${c.channels[simulation.channel]}<br>${c[preview?'previewCalculation':'liveCalculation']}</p></div>`;
}
function scenarioStep(ctx){
  const {c,flow}=ctx,s=flow.scenario,menus=scenarioMenus(ctx);
  return `<form id="${formId}" data-flow-form="scenario">${errorMarkup()}<div class="flow-form-grid">${select(c.scenarioChannel,'channel',s.channel,(flow.scope==='combined'?['storefront','grab']:[flow.scope]).map(channel=>[channel,c.channels[channel]]))}${select(c.scenarioMenu,'menuName',s.menuName,[['',c.notAssigned],...menus.map(menu=>[menu.name,menu.name])])}${field(c.price,'price',s.price,{min:.01,help:c.priceUnknown,placeholder:c.unknown})}${field(c.discount,'discount',s.discount,{max:50,required:true})}${field(c.extraOrders,'extraOrders',s.extraOrders,{step:'1',max:100000,required:true})}${field(c.existingOrders,'existingOrders',s.existingOrders,{step:'1',max:100000,required:true})}${field(c.budget,'budget',s.budget,{required:true})}${field(c.newCustomers,'newCustomers',s.newCustomers,{step:'1',max:100000,placeholder:c.unknown})}</div><p class="flow-helper">${c.scenarioHelp}</p><div id="flow-scenario-preview">${scenarioPreview(ctx)}</div>${disclosure(c.formula,c.scenarioExclusions)}${actions(c,7)}</form>`;
}
function outcomeHistory(ctx){
  const {c,flow,money,num,date}=ctx;
  return `<section class="flow-outcome-history"><h3>${c.outcomeHistory}</h3>${flow.outcomes.length?`<ul class="flow-outcome-list">${flow.outcomes.slice().reverse().map(outcome=>`<li><div class="flow-outcome-heading"><h4>${escape(outcome.snapshot.menu.name)} · ${c.channels[outcome.snapshot.scenario.channel]}</h4><small>${date(outcome.createdAt)} · ${c[outcome.source==='demo'?'outcomeDemo':'outcomeSource']}</small></div><p class="flow-source-note">${escape(outcome.snapshot.datasetName)}</p><div class="flow-preview-substats">${[[money(outcome.evaluation.net),c.outcomeEstimate],[money(outcome.cac),c.cac],[num(outcome.evaluation.incrementalOrders),c.observedAdditional],[num(outcome.actual.newCustomers),c.actualNew],[outcome.repeatShare===null?'—':num(outcome.repeatShare*100,1)+'%',c.repeatShare],[outcome.returningShare===null?'—':num(outcome.returningShare*100,1)+'%',c.returningShare],[num(outcome.actual.paybackDays),c.paybackDays]].map(([value,label])=>`<div><strong>${value}</strong><small>${label}</small></div>`).join('')}</div><button class="text-button" type="button" data-flow-reuse="${escape(outcome.id)}">${c.reuse}</button></li>`).join('')}</ul><p class="flow-helper">${c.reuseHelp}</p>`:`<p class="flow-empty">${c.noOutcomes}</p>`}</section>`;
}
function outcomesStep(ctx){
  const {c,state}=ctx;let simulation;
  try{simulation=simulateMerchantPlan(state);}catch{}
  return `${errorMarkup()}${simulation?`<p class="flow-source-note">${c.currentPlan}: ${escape(simulation.menu.name)} · ${c.channels[simulation.channel]}<br>${escape(simulation.datasetName)}</p><form id="${formId}" data-flow-form="outcome"><div class="flow-form-grid">${field(c.totalOrders,'totalOrders','',{step:'1',max:100000,required:true})}${field(c.baselineOrders,'baselineOrders','',{step:'1',max:100000,required:true})}${field(c.actualSpend,'spend','',{required:true})}${field(c.actualNew,'newCustomers','',{step:'1',max:100000,placeholder:c.unknown})}${field(c.actualReturning,'returningCustomers','',{step:'1',max:100000,placeholder:c.unknown})}${field(c.actualRepeat,'repeatCustomers','',{step:'1',max:100000,placeholder:c.unknown})}${field(c.paybackDays,'paybackDays','',{step:'1',max:3650,placeholder:c.unknown,help:c.paybackHelp})}</div><p class="flow-helper">${c.observedHelp}</p><label class="flow-review-check"><input type="checkbox" name="reviewed" required><span>${c.outcomeReview}</span></label><div class="flow-actions"><button class="text-button" type="button" data-flow-step="7">${c.back}</button><div class="flow-primary-actions"><button class="text-button" type="button" data-flow-clear>${c.clearOutcome}</button><button class="button" type="submit">${c.saveOutcome}</button></div></div></form>`:`${note(c.needsScenario)}<button class="button secondary" type="button" data-flow-step="7">${c.returnScenario}</button>`}${outcomeHistory(ctx)}`;
}

export function renderMerchantFlow({state,language='en',demo=false,capabilities={},step=1}){
  const ctx=context(state,language),{c}=ctx,current=Math.max(1,Math.min(8,Number(step)||1));
  const titles={4:c.pricesTitle,5:c.financialTitle,6:c.aiTitle,7:c.scenarioTitle,8:c.outcomesTitle};
  const intros={4:c.pricesCopy,6:c.aiCopy,7:c.scenarioCopy,8:c.outcomesCopy};
  const panels=[setupStep,scopeStep,ctx=>sourcesStep(ctx,demo),pricesStep,financialStep,ctx=>advisorStep(ctx,demo,capabilities),scenarioStep,outcomesStep];
  return `<section class="merchant-flow" data-flow-current="${current}"><div class="flow-header"><p class="eyebrow">${c.workflow}</p><h1>${c.title}</h1><p class="intro">${c.intro}</p></div><div class="flow-layout"><nav class="flow-rail" aria-label="${c.navLabel}"><ol>${c.steps.map((label,i)=>`<li><button type="button" data-flow-step="${i+1}"${current===i+1?' aria-current="step"':''}><span class="flow-step-number" aria-hidden="true">${i+1}</span><span>${label}</span></button></li>`).join('')}</ol><small>${c.saveBeforeChange}</small></nav><section class="flow-panel" aria-labelledby="flow-step-title"><div class="flow-step-header"><span class="flow-step-index" aria-hidden="true">${String(current).padStart(2,'0')}</span><div><h2 id="flow-step-title" tabindex="-1">${titles[current]||c.steps[current-1]}</h2><p>${intros[current]||c.stepCopy[current-1]}</p></div></div>${panels[current-1](ctx)}</section></div></section>`;
}

function readPatch(form){
  const values=new FormData(form),kind=form.dataset.flowForm;
  if(kind==='setup')return {setup:{goal:values.get('goal'),fixedCosts:nullable(values.get('fixedCosts')),marketingSpend:nullable(values.get('marketingSpend'))}};
  if(kind==='scope')return {scope:values.get('scope')};
  if(kind==='sources')return {sources:{grab:values.get('grab')||null,storefront:values.get('storefront')||null}};
  if(kind==='fees')return {setup:{feePercent:nullable(values.get('feePercent'))}};
  if(kind==='cash')return {setup:Object.fromEntries(['openingCash','receivables','upcomingPayments'].map(name=>[name,nullable(values.get(name))]))};
  if(kind==='scenario')return {scenario:Object.fromEntries(['menuName','channel','price','discount','extraOrders','existingOrders','budget','newCustomers'].map(name=>[name,['menuName','channel'].includes(name)?values.get(name):nullable(values.get(name))]))};
  return null;
}

export function bindMerchantFlow(container,{state,language='en',demo=false,step=1,setStep,commitAction,navigate,markDirty=()=>{}}){
  const ctx=context(state,language),{c}=ctx,root=container.querySelector('.merchant-flow');
  if(!root)return ()=>{};
  const controller=new AbortController(),options={signal:controller.signal};
  let dirty=false,saving=false,disposed=false,pendingOutcomeId='flow_result_'+crypto.randomUUID();
  const form=()=>root.querySelector(`#${formId}`);
  const alert=message=>{if(disposed)return;const el=root.querySelector('.flow-error');if(el){el.textContent=message;el.hidden=false;el.focus({preventScroll:true});}};
  const clearAlert=()=>{const el=root.querySelector('.flow-error');if(el){el.hidden=true;el.textContent='';}};
  const clearDirty=()=>{if(disposed)return;dirty=false;markDirty(false);};
  function updateControls(pending){
    if(disposed)return;saving=pending;root.querySelector('.flow-panel').setAttribute('aria-busy',String(pending));
    root.querySelectorAll('button,input,select').forEach(input=>{if(pending){input.dataset.flowWasDisabled=String(input.disabled);input.disabled=true;}else{input.disabled=input.dataset.flowWasDisabled==='true';delete input.dataset.flowWasDisabled;}});
  }
  async function savePatch(nextStep=step,explicit=false){
    if(saving||disposed)return false;
    const currentForm=form();
    if(currentForm?.dataset.flowForm==='outcome'){
      if(dirty){alert(c.unsavedOutcome);return false;}
      setStep(nextStep);return true;
    }
    const patch=currentForm?readPatch(currentForm):null;
    if(!patch||(!dirty&&!explicit)){setStep(nextStep);return true;}
    if(!currentForm.reportValidity())return false;
    clearAlert();updateControls(true);
    try{
      const response=await commitAction('merchant-flow',patch);
      if(disposed)return false;
      if(!response){alert(c.saveError);return false;}
      clearDirty();setStep(nextStep);return true;
    }catch(error){alert(error.message||c.saveError);return false;}
    finally{if(!disposed)updateControls(false);}
  }
  function preview(){
    const currentForm=form(),patch=currentForm?readPatch(currentForm):null;if(!patch)return;
    const previewState=structuredClone(state);
    try{updateMerchantFlow(previewState,patch);}catch(error){
      if(currentForm.dataset.flowForm==='scenario')root.querySelector('#flow-scenario-preview').innerHTML=`<p class="flow-empty">${escape(error.message||c.scenarioInvalid)}</p>`;
      return;
    }
    const previewCtx=context(previewState,language);
    if(currentForm.dataset.flowForm==='fees')root.querySelector('#flow-price-comparison').innerHTML=priceTable(previewCtx);
    if(currentForm.dataset.flowForm==='cash')root.querySelector('#flow-cash-preview').innerHTML=cashMarkup(previewCtx);
    if(currentForm.dataset.flowForm==='scenario')root.querySelector('#flow-scenario-preview').innerHTML=scenarioPreview(previewCtx,previewState.merchantFlow.scenario,true);
  }
  function sourceControls(){
    const currentForm=form();if(currentForm?.dataset.flowForm!=='sources')return;
    const values=new FormData(currentForm),grab=values.get('grab'),storefront=values.get('storefront');
    for(const channel of ['grab','storefront']){
      const input=currentForm.elements.namedItem(channel),other=channel==='grab'?storefront:grab;
      for(const option of input.options)option.disabled=!!option.value&&option.value===other&&option.value!==input.value;
      input.setCustomValidity(grab&&grab===storefront?c.duplicate:'');
      root.querySelector(`[data-flow-source-note="${channel}"]`).innerHTML=sourceNote(ctx,channel,input.value);
    }
  }
  root.addEventListener('input',event=>{
    if(!event.target.closest(`#${formId}`)||saving)return;
    dirty=true;markDirty(true);clearAlert();preview();
  },options);
  root.addEventListener('change',event=>{
    if(!event.target.closest(`#${formId}`)||saving)return;
    dirty=true;markDirty(true);clearAlert();sourceControls();
    if(event.target.name==='channel'){
      const menuSelect=form().elements.namedItem('menuName'),old=menuSelect.value,menus=scenarioMenus(ctx,event.target.value);
      menuSelect.innerHTML=`<option value="">${c.notAssigned}</option>`+menus.map(menu=>`<option value="${escape(menu.name)}">${escape(menu.name)}</option>`).join('');
      menuSelect.value=menus.some(menu=>menu.name===old)?old:'';
    }
    preview();
  },options);
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||!root.contains(button)||saving)return;
    if(button.dataset.flowStep){event.preventDefault();const next=Math.max(1,Math.min(8,Number(button.dataset.flowStep)));if(next!==Number(step))await savePatch(next);}
    if(button.hasAttribute('data-flow-demo')&&demo){
      event.preventDefault();updateControls(true);clearAlert();
      try{const response=await commitAction('merchant-flow-sample',{});if(disposed)return;if(!response){alert(c.saveError);return;}clearDirty();setStep(3);}
      catch(error){alert(error.message||c.saveError);}
      finally{if(!disposed)updateControls(false);}
    }
    if(button.dataset.flowTool){event.preventDefault();await navigate(button.dataset.flowTool);}
    if(button.hasAttribute('data-flow-clear')){event.preventDefault();form()?.reset();pendingOutcomeId='flow_result_'+crypto.randomUUID();clearDirty();clearAlert();}
    if(button.dataset.flowReuse){
      event.preventDefault();if(dirty){alert(c.unsavedOutcome);return;}
      const outcome=ctx.flow.outcomes.find(item=>item.id===button.dataset.flowReuse);if(!outcome)return;
      const additionalOrders=Math.max(0,outcome.evaluation.incrementalOrders);
      if(outcome.actual.newCustomers!==null&&outcome.actual.newCustomers>additionalOrders){alert(c.reuseManual);return;}
      updateControls(true);
      try{
        const saved=outcome.snapshot.settings,s=outcome.snapshot.scenario,response=await commitAction('merchant-flow',{sources:{...saved.sources},scope:saved.scope,setup:{feePercent:saved.setup.feePercent},scenario:{...s,extraOrders:additionalOrders,budget:outcome.actual.spend,newCustomers:outcome.actual.newCustomers}});
        if(disposed)return;
        if(!response){alert(c.saveError);return;}clearDirty();setStep(7);
      }catch(error){alert(error.message||c.saveError);}
      finally{if(!disposed)updateControls(false);}
    }
  },options);
  root.addEventListener('submit',async event=>{
    if(event.target.id!==formId)return;event.preventDefault();if(saving||disposed)return;
    const currentForm=event.target;if(!currentForm.reportValidity())return;
    if(currentForm.dataset.flowForm!=='outcome'){await savePatch(event.submitter?.name==='continue'?Math.min(8,Number(step)+1):Number(step),true);return;}
    const values=new FormData(currentForm);if(values.get('reviewed')!=='on'){alert(c.reviewRequired);return;}
    const payload={id:pendingOutcomeId,snapshot:simulateMerchantPlan(state).snapshot,...Object.fromEntries(['totalOrders','baselineOrders','spend','newCustomers','returningCustomers','repeatCustomers','paybackDays'].map(name=>[name,nullable(values.get(name))]))};
    updateControls(true);clearAlert();
    try{
      const response=await commitAction('flow-outcome',payload);
      if(disposed)return;
      if(!response){alert(c.outcomeError);return;}clearDirty();setStep(8);
    }catch(error){alert(error.message||c.outcomeError);}
    finally{if(!disposed)updateControls(false);}
  },options);
  sourceControls();
  return ()=>{disposed=true;controller.abort();};
}
