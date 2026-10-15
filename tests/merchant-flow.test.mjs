import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace,commitManualDataset} from '../dist/data.mjs';
import {contributionCents,project} from '../dist/core.mjs';
import {normalizeMerchantFlow,validateMerchantFlow,updateMerchantFlow,loadMerchantDemo,merchantReport,priceComparison,simulateMerchantPlan,recordMerchantOutcome} from '../dist/merchant-flow.mjs';

function twoChannels({grabFee=20,grabPrice=89,storefrontPrice=89,storefrontPeriod}={}) {
  const state=createWorkspace();normalizeMerchantFlow(state);
  const grab=commitManualDataset(state,[{name:'Rice',weekday:10,weekend:5,price:grabPrice,ingredients:29,packaging:5,fee:grabFee}]);
  const storefront=commitManualDataset(state,[{name:'Rice',weekday:20,weekend:10,price:storefrontPrice,ingredients:29,packaging:5,fee:17}],storefrontPeriod??grab.period);
  updateMerchantFlow(state,{sources:{grab:grab.id,storefront:storefront.id},scenario:{menuName:'Rice'}});
  return {state,grab,storefront};
}

test('legacy workspace normalizes without attributing the sample to both channels',()=>{
  const state=createWorkspace(),original=JSON.stringify(state.datasets),revision=state.revision;
  normalizeMerchantFlow(state);
  const result=merchantReport(state);
  assert.deepEqual(state.merchantFlow.sources,{grab:null,storefront:null});
  assert.equal(result.complete,false);assert.equal(result.totals,null);assert.equal(result.knownTotals,null);
  assert.equal(result.netAfterKnownCosts,null);assert.equal(result.cashBalance,null);
  assert.equal(state.revision,revision);assert.equal(JSON.stringify(state.datasets),original);
  assert.deepEqual(priceComparison(state),[]);
  assert.throws(()=>simulateMerchantPlan(state),/Assign a grab report/);
});

test('explicit two-channel demo load reuses separate immutable fixtures and preserves prior data',()=>{
  const state=createWorkspace(),original=JSON.stringify(state.datasets[0]);
  updateMerchantFlow(state,{setup:{feePercent:45,fixedCosts:100,openingCash:200},scenario:{price:120,budget:50,discount:10}});
  const revision=state.revision,loaded=loadMerchantDemo(state),report=merchantReport(state);
  assert.equal(loaded.createdCount,2);assert.notEqual(loaded.grab.id,loaded.storefront.id);
  assert.equal(state.activeDatasetId,loaded.grab.id);assert.equal(state.revision,revision+1);
  assert.equal(state.datasets.length,3);assert.equal(JSON.stringify(state.datasets[0]),original);
  assert.ok(Object.isFrozen(loaded.grab));assert.ok(Object.isFrozen(loaded.storefront.menus));
  assert.equal(loaded.grab.sourceType,'synthetic');assert.equal(loaded.storefront.sourceType,'synthetic');
  assert.equal(report.complete,true);assert.equal(report.periodCompatible,true);
  assert.equal(report.totals.salesCents,8398500);assert.equal(report.totals.contributionCents,3673650);assert.equal(report.totals.orders,1247);
  assert.equal(state.merchantFlow.setup.feePercent,null);assert.equal(state.merchantFlow.setup.fixedCosts,100);assert.equal(state.merchantFlow.setup.openingCash,200);
  assert.equal(state.merchantFlow.scenario.price,null);assert.equal(state.merchantFlow.scenario.discount,10);assert.equal(state.merchantFlow.scenario.budget,50);
  const repeated=loadMerchantDemo(state);
  assert.equal(repeated.createdCount,0);assert.equal(repeated.grab.id,loaded.grab.id);assert.equal(repeated.storefront.id,loaded.storefront.id);assert.equal(state.datasets.length,3);
  assert.ok(simulateMerchantPlan(state).projection);
  const restored=JSON.parse(JSON.stringify(state)),reused=loadMerchantDemo(restored);
  assert.equal(reused.createdCount,0);assert.equal(restored.datasets.length,3);assert.ok(Object.isFrozen(reused.grab.menus));
});

test('demo capacity failure adds no partial fixture or settings update',()=>{
  const state=createWorkspace();normalizeMerchantFlow(state);
  for(let index=1;index<99;index++)state.datasets.push({...state.datasets[0],id:`existing_${index}`,name:`Existing ${index}`});
  const original=JSON.stringify(state);
  assert.throws(()=>loadMerchantDemo(state),/100 datasets/);assert.equal(JSON.stringify(state),original);
});

test('combined report sums distinct channels using exact per-item fees and fee-free storefront',()=>{
  const {state,grab,storefront}=twoChannels({grabPrice:10.05,storefrontPrice:10.05,grabFee:10});
  const original=JSON.stringify(state.datasets),result=merchantReport(state);
  assert.equal(result.complete,true);assert.equal(result.periodCompatible,true);
  assert.equal(result.channels.grab.feeCents,1515); // THB 1.005 fee rounds to 1.01 per sold item.
  assert.equal(result.channels.storefront.feeCents,0);
  assert.equal(result.totals.salesCents,45225);assert.equal(result.totals.feeCents,1515);
  assert.equal(result.totals.ingredientCents,130500);assert.equal(result.totals.packagingCents,22500);
  assert.equal(result.totals.contributionCents,-109290);assert.equal(result.totals.orders,45);
  assert.equal(JSON.stringify(state.datasets),original);assert.equal(grab.menus[0].fee,10);assert.equal(storefront.menus[0].fee,17);
});

test('missing and unequal reporting periods cannot masquerade as complete combined sales',()=>{
  const {state}=twoChannels({storefrontPeriod:{start:'2026-10-05',end:'2026-10-11'}});
  let result=merchantReport(state);
  assert.equal(result.complete,false);assert.equal(result.periodCompatible,false);assert.equal(result.totals,null);assert.equal(result.knownTotals,null);
  updateMerchantFlow(state,{sources:{storefront:null}});result=merchantReport(state);
  assert.equal(result.complete,false);assert.deepEqual(result.missingChannels,['storefront']);assert.equal(result.totals,null);assert.equal(result.knownTotals.orders,15);
  updateMerchantFlow(state,{scope:'grab'});result=merchantReport(state);
  assert.equal(result.complete,true);assert.equal(result.totals.orders,15);
});

test('storefront-only setup reaches a scenario without requiring or borrowing a Grab report',()=>{
  const state=createWorkspace();normalizeMerchantFlow(state);
  updateMerchantFlow(state,{scope:'storefront'});
  assert.equal(state.merchantFlow.scenario.channel,'storefront');assert.equal(state.merchantFlow.scenario.menuName,'');
  const storefront=commitManualDataset(state,[{name:'Counter rice',weekday:20,weekend:10,price:75,ingredients:29,packaging:2,fee:32.1}]);
  updateMerchantFlow(state,{sources:{storefront:storefront.id}});
  assert.equal(state.merchantFlow.sources.grab,null);assert.equal(state.merchantFlow.scenario.menuName,'Counter rice');
  assert.equal(merchantReport(state).complete,true);
  const simulation=simulateMerchantPlan(state);assert.equal(simulation.channel,'storefront');assert.equal(simulation.menu.fee,0);
  assert.throws(()=>simulateMerchantPlan(state,{channel:'grab'}),/selected calculation scope/);
  updateMerchantFlow(state,{scenario:{price:80}});
  const replacement=commitManualDataset(state,[{name:'Counter tea',weekday:20,weekend:10,price:35,ingredients:10,packaging:2,fee:0}]);
  updateMerchantFlow(state,{sources:{storefront:replacement.id}});
  assert.equal(state.merchantFlow.scenario.menuName,'Counter tea');assert.equal(state.merchantFlow.scenario.price,null);
  assert.equal(simulateMerchantPlan(state).datasetId,replacement.id);
  const original=JSON.stringify(state);
  assert.throws(()=>updateMerchantFlow(state,{sources:{storefront:storefront.id},scenario:{menuName:'Missing menu'}}),/Choose a menu/);assert.equal(JSON.stringify(state),original);
  assert.throws(()=>updateMerchantFlow(state,{scenario:{channel:'grab'}}),/selected calculation scope/);assert.equal(JSON.stringify(state),original);
});

test('restoring an explicit historical menu and price survives a scope change',()=>{
  const {state}=twoChannels();
  const grab=commitManualDataset(state,[{name:'First dish',weekday:10,weekend:5,price:100,ingredients:30,packaging:5,fee:20},{name:'Second dish',weekday:10,weekend:5,price:110,ingredients:35,packaging:5,fee:20}]);
  updateMerchantFlow(state,{sources:{grab:grab.id},scope:'storefront'});
  updateMerchantFlow(state,{scope:'grab',scenario:{channel:'grab',menuName:'Second dish',price:120}});
  assert.equal(state.merchantFlow.scenario.menuName,'Second dish');assert.equal(state.merchantFlow.scenario.price,120);
  const simulation=simulateMerchantPlan(state);assert.equal(simulation.menu.name,'Second dish');assert.equal(simulation.menu.price,120);assert.equal(simulation.baselineMenu.price,110);
});

test('optional known costs and cash inputs stay explicit and zero remains known',()=>{
  const {state}=twoChannels();
  updateMerchantFlow(state,{setup:{fixedCosts:100,marketingSpend:null}});
  let result=merchantReport(state);
  assert.equal(result.netAfterKnownCostsCents,210800);assert.equal(result.costsComplete,false);
  assert.equal(result.cashBalance,null);
  updateMerchantFlow(state,{setup:{fixedCosts:0,marketingSpend:0,openingCash:100,receivables:0,upcomingPayments:150}});
  result=merchantReport(state);
  assert.equal(result.netAfterKnownCostsCents,result.totals.contributionCents);assert.equal(result.costsComplete,true);
  assert.equal(result.cashBalanceCents,-5000);assert.equal(result.cashBalance,-50);
});

test('fee-only parity uses the minimum cent price and treats 100% fee as impossible',()=>{
  for(const [front,fee,expected] of [[89,0,8900],[89,32.1,13107],[0.01,50,2],[0.01,49.99,1],[100,100,null]]) {
    const {state}=twoChannels({storefrontPrice:front,grabPrice:front,grabFee:fee});
    const row=priceComparison(state)[0];assert.equal(row.requiredGrabPriceCents,expected);
    if(expected!==null) {
      const menu={name:'Rice',weekday:0,weekend:0,price:expected/100,ingredients:0,packaging:0,fee};
      assert.ok(contributionCents(menu).contributionCents>=Math.round(front*100));
      if(expected>1)assert.ok(contributionCents({...menu,price:(expected-1)/100}).contributionCents<Math.round(front*100));
    }
  }
});

test('fee override affects reports and scenarios while preserving source menus',()=>{
  const {state,grab}=twoChannels(),original=JSON.stringify(grab);
  updateMerchantFlow(state,{setup:{feePercent:32.1},scenario:{discount:10,extraOrders:40,existingOrders:20,budget:600,newCustomers:10}});
  const report=merchantReport(state),simulation=simulateMerchantPlan(state);
  assert.equal(report.channels.grab.rows[0].fee,32.1);
  assert.equal(simulation.menu.fee,32.1);assert.deepEqual(simulation.projection,project({...grab.menus[0],fee:32.1},state.merchantFlow.scenario));
  assert.equal(simulation.cacCents,6000);assert.equal(simulation.cac,60);
  assert.equal(JSON.stringify(grab),original);
});

test('scenario retains negative contribution and unknown or zero new customers has no CAC',()=>{
  const {state}=twoChannels({grabPrice:10});
  const simulation=simulateMerchantPlan(state,{budget:30,newCustomers:0});
  assert.ok(simulation.projection.offerCents<0);assert.equal(simulation.projection.breakEven,null);
  assert.equal(simulation.cac,null);assert.equal(simulateMerchantPlan(state).cac,null);
});

test('changed price compares all existing orders with the original source price',()=>{
  const {state}=twoChannels();
  const raised=simulateMerchantPlan(state,{price:100,discount:0,extraOrders:20,existingOrders:50,budget:600});
  assert.equal(raised.projection.baseCents,3720);assert.equal(raised.projection.offerCents,4600);
  assert.equal(raised.projection.existingLossCents,-44000);assert.equal(raised.projection.netCents,76000);assert.equal(raised.projection.breakEven,4);
  assert.equal(raised.baselineMenu.price,89);assert.equal(raised.menu.price,100);
  const lowered=simulateMerchantPlan(state,{price:80,discount:0,extraOrders:0,existingOrders:50,budget:0});
  assert.equal(lowered.projection.baseCents,3720);assert.equal(lowered.projection.offerCents,3000);
  assert.equal(lowered.projection.existingLossCents,36000);assert.equal(lowered.projection.netCents,-36000);assert.equal(lowered.projection.breakEven,12);
  const gain=simulateMerchantPlan(state,{price:100,discount:0,extraOrders:0,existingOrders:50,budget:100});
  assert.equal(gain.projection.netCents,34000);assert.equal(gain.projection.breakEven,0);
  const outcome=recordMerchantOutcome(state,{snapshot:raised.snapshot,totalOrders:70,baselineOrders:50,spend:600});
  assert.equal(outcome.evaluation.netCents,76000);assert.equal(outcome.snapshot.projection.baseCents,3720);
});

test('storefront price reduction and increase include existing-order losses and gains',()=>{
  const {state}=twoChannels({storefrontPrice:100});
  const cut=simulateMerchantPlan(state,{channel:'storefront',price:80,discount:0,extraOrders:0,existingOrders:10,budget:0});
  const increase=simulateMerchantPlan(state,{channel:'storefront',price:120,discount:0,extraOrders:0,existingOrders:10,budget:0});
  assert.equal(cut.projection.netCents,-20000);assert.equal(increase.projection.netCents,20000);assert.equal(increase.projection.breakEven,0);
  const actual=recordMerchantOutcome(state,{snapshot:cut.snapshot,totalOrders:10,baselineOrders:10,spend:0});
  assert.equal(actual.evaluation.netCents,-20000);
});

test('invalid updates and duplicate sources are rejected atomically without revision changes',()=>{
  const {state,grab}=twoChannels();state.selectedCandidateId='selected';const original=JSON.stringify(state);
  for(const invalid of [{sources:{storefront:grab.id}},{sources:{grab:'missing'}},{setup:{feePercent:100}},{setup:{fixedCosts:0.001}},{scenario:{budget:-1}},{scenario:{extraOrders:1.5}},{scenario:{newCustomers:21}},{scenario:{price:0}},{setup:{futurePrediction:2}},{outcomes:[]}]) {
    assert.throws(()=>updateMerchantFlow(state,invalid));assert.equal(JSON.stringify(state),original);
  }
  const revision=state.revision;updateMerchantFlow(state,{scope:'storefront',setup:{goal:'growth'}});
  assert.equal(state.revision,revision+1);assert.equal(state.selectedCandidateId,null);
  const malformed=createWorkspace();malformed.merchantFlow=null;
  assert.throws(()=>updateMerchantFlow(malformed,{scope:'grab'}));assert.equal(malformed.merchantFlow,null);
});

test('outcome pins the original settings and remains valid after current fee, price and source changes',()=>{
  const {state}=twoChannels();
  const simulation=simulateMerchantPlan(state,{discount:10,extraOrders:40,existingOrders:20,budget:600,newCustomers:10});
  const revision=state.revision;
  const outcome=recordMerchantOutcome(state,{snapshot:simulation.snapshot,totalOrders:60,baselineOrders:20,spend:600,newCustomers:10,returningCustomers:20,repeatCustomers:5});
  assert.equal(state.revision,revision+1);assert.equal(outcome.evaluation.netCents,46080);
  assert.equal(outcome.cac,60);assert.equal(outcome.returningShare,2/3);assert.equal(outcome.repeatShare,1/6);
  assert.ok(Object.isFrozen(outcome));assert.ok(Object.isFrozen(outcome.snapshot.settings.setup));
  assert.throws(()=>{outcome.snapshot.menu.price=1;},/read only/);
  simulation.snapshot.menu.price=1;assert.equal(outcome.snapshot.menu.price,89);
  const previous=JSON.stringify(outcome);
  updateMerchantFlow(state,{setup:{feePercent:45},scenario:{price:120},sources:{storefront:null}});
  assert.equal(JSON.stringify(state.merchantFlow.outcomes[0]),previous);assert.equal(validateMerchantFlow(state),state);
});

test('actual zero and unavailable customer counts never invent CAC or retention',()=>{
  const {state}=twoChannels();const snapshot=simulateMerchantPlan(state).snapshot;
  const outcome=recordMerchantOutcome(state,{snapshot,totalOrders:0,baselineOrders:1,spend:100,newCustomers:0,returningCustomers:0,repeatCustomers:0},{source:'demo'});
  assert.equal(outcome.source,'demo');assert.equal(outcome.evaluation.netCents,-13720);
  assert.equal(outcome.cac,null);assert.equal(outcome.returningShare,null);assert.equal(outcome.repeatShare,null);
  const unknown=recordMerchantOutcome(state,{snapshot,totalOrders:20,baselineOrders:0,spend:0});
  assert.equal(unknown.cac,null);assert.equal(unknown.repeatShare,null);
});

test('payback days remain unknown unless separately reported, including a valid observed zero',()=>{
  const {state}=twoChannels();const snapshot=simulateMerchantPlan(state).snapshot;
  const base={snapshot,totalOrders:20,baselineOrders:0,spend:50};
  const unknown=recordMerchantOutcome(state,base);
  const immediate=recordMerchantOutcome(state,{...base,paybackDays:0});
  const measured=recordMerchantOutcome(state,{...base,paybackDays:45});
  assert.equal(unknown.actual.paybackDays,null);assert.equal(immediate.actual.paybackDays,0);assert.equal(measured.actual.paybackDays,45);
  assert.deepEqual(unknown.evaluation,measured.evaluation);
  const legacy=JSON.parse(JSON.stringify(state));delete legacy.merchantFlow.outcomes[0].actual.paybackDays;
  assert.equal(validateMerchantFlow(legacy),legacy);
  const original=JSON.stringify(state);
  for(const paybackDays of [-1,3651,1.5,'45',Infinity]) {
    assert.throws(()=>recordMerchantOutcome(state,{...base,paybackDays}),/payback days/);assert.equal(JSON.stringify(state),original);
  }
});

test('forged or stale snapshots, conflicting source and impossible actual counts fail without partial outcomes',()=>{
  const {state}=twoChannels();const snapshot=simulateMerchantPlan(state).snapshot,original=JSON.stringify(state);
  const base={snapshot,totalOrders:20,baselineOrders:0,spend:50};
  const forged=structuredClone(snapshot);forged.menu.fee=0;
  const missing=structuredClone(snapshot);missing.settings.sources.grab='missing';
  for(const invalid of [{...base,snapshot:forged},{...base,snapshot:missing},{...base,source:'demo'},{...base,newCustomers:21},{...base,newCustomers:15,returningCustomers:10},{...base,newCustomers:5,returningCustomers:5,repeatCustomers:11},{...base,spend:50.001},{...base,totalOrders:100001}]) {
    assert.throws(()=>recordMerchantOutcome(state,invalid));assert.equal(JSON.stringify(state),original);
  }
});

test('stable outcome IDs make identical retries a no-op and reject changed result contents',()=>{
  const {state}=twoChannels(),snapshot=simulateMerchantPlan(state).snapshot;
  const payload={id:'flow_result_retry_123',snapshot,totalOrders:20,baselineOrders:0,spend:50};
  const first=recordMerchantOutcome(state,payload),revision=state.revision;
  assert.equal(recordMerchantOutcome(state,payload),first);assert.equal(state.revision,revision);assert.equal(state.merchantFlow.outcomes.length,1);
  const original=JSON.stringify(state);
  assert.throws(()=>recordMerchantOutcome(state,{...payload,spend:51}),/different recorded contents/);assert.equal(JSON.stringify(state),original);
  assert.throws(()=>recordMerchantOutcome(state,{...payload,id:'bad id'}),/identifier/);assert.equal(JSON.stringify(state),original);
  assert.throws(()=>recordMerchantOutcome(state,payload,{source:'demo'}),/different recorded contents/);assert.equal(JSON.stringify(state),original);
  updateMerchantFlow(state,{setup:{feePercent:30}});
  assert.equal(recordMerchantOutcome(state,payload),state.merchantFlow.outcomes[0]);
});

test('serialized outcome history recalculates amounts, rejects duplicate IDs and enforces the 50-result cap',()=>{
  const {state}=twoChannels();const snapshot=simulateMerchantPlan(state).snapshot;
  for(let i=0;i<50;i++)recordMerchantOutcome(state,{snapshot,totalOrders:10,baselineOrders:0,spend:0});
  assert.equal(state.merchantFlow.outcomes.length,50);
  const saved=JSON.stringify(state);assert.throws(()=>recordMerchantOutcome(state,{snapshot,totalOrders:10,baselineOrders:0,spend:0}),/50/);assert.equal(JSON.stringify(state),saved);
  const retry=state.merchantFlow.outcomes[0],revision=state.revision;
  assert.equal(recordMerchantOutcome(state,{id:retry.id,snapshot:retry.snapshot,...retry.actual}),retry);assert.equal(state.revision,revision);assert.equal(state.merchantFlow.outcomes.length,50);
  const restored=JSON.parse(saved);assert.equal(validateMerchantFlow(restored),restored);assert.ok(Object.isFrozen(restored.merchantFlow.outcomes[0]));
  const tampered=JSON.parse(saved);tampered.merchantFlow.outcomes[0].evaluation.netCents=999999;assert.throws(()=>validateMerchantFlow(tampered),/calculations/);
  const duplicate=JSON.parse(saved);duplicate.merchantFlow.outcomes[1].id=duplicate.merchantFlow.outcomes[0].id;assert.throws(()=>validateMerchantFlow(duplicate),/unique/);
});
