import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleMenus,MAX_CSV_BYTES,analyze,contribution,contributionCents,project,evaluate,parseCsv,menuCsv,validateMenus,countPeriodDays} from '../dist/core.mjs';
import {createWorkspace,validateWorkspace,validateBusiness,importDataset,commitManualDataset,saveMemory,retrieveMemory,buildCandidates,evaluateCandidates,recordResult,exportMemoryMarkdown,restoreArchive} from '../dist/data.mjs';

const header='menu,weekday_orders,weekend_orders,price,ingredient_cost,packaging_cost,fee_percent';
const csv=menuCsv(sampleMenus);
const plan={discount:10,extraOrders:40,existingOrders:20,budget:600};

test('hand-calculated golden contribution and campaign totals use exact satang',()=>{
  assert.equal(contribution(sampleMenus[0]),37.2);
  const projection=project(sampleMenus[0],plan);
  assert.equal(projection.offerCents,3008);
  assert.equal(projection.existingLossCents,14240);
  assert.equal(projection.netCents,46080);
  assert.equal(projection.breakEven,25);
  assert.equal(evaluate(sampleMenus[0],plan,{totalOrders:60,baselineOrders:20,spend:600}).netCents,46080);
  const analysis=analyze(sampleMenus);
  assert.equal(analysis.orders,497);
  assert.equal(analysis.salesCents,3901500);
  assert.equal(analysis.recommended,'Basil chicken rice');
});
test('rounding is half-up per discounted item followed by half-up platform fee',()=>{
  const menu={...sampleMenus[0],price:10.05,ingredients:0,packaging:0,fee:10};
  assert.deepEqual(contributionCents(menu,10),{sellingPriceCents:905,feeCents:91,contributionCents:814});
  assert.equal(project(menu,{...plan,extraOrders:3,existingOrders:0,budget:0}).netCents,2442);
  assert.throws(()=>validateMenus([{...menu,price:10.005}]),/decimal places/);
});
test('reporting periods count calendar weekdays instead of assuming a fortnight',()=>{
  assert.deepEqual(countPeriodDays({start:'2026-10-05',end:'2026-10-11'}),{days:7,weekdays:5,weekends:2});
  assert.deepEqual(countPeriodDays({start:'2026-10-10',end:'2026-10-11'}),{days:2,weekdays:0,weekends:2});
  assert.equal(analyze(sampleMenus,{start:'2026-10-05',end:'2026-10-11'}).rows[0].weekdayDaily,24);
  assert.throws(()=>analyze(sampleMenus,{start:'2026-10-10',end:'2026-10-11'}),/no weekdays/);
  assert.throws(()=>countPeriodDays({start:'2026-02-30',end:'2026-03-01'}),/valid calendar/);
  assert.throws(()=>countPeriodDays({start:'2026-10-12',end:'2026-10-11'}),/between/);
});
test('CSV preserves Thai, BOM, comma, escaped quote and line break names',()=>{
  const menus=[{...sampleMenus[0],name:'ข้าว, "พิเศษ"\nไก่'}];
  assert.deepEqual(parseCsv('\uFEFF'+menuCsv(menus)),menus);
  const reordered='price,menu,weekday_orders,weekend_orders,ingredient_cost,packaging_cost,fee_percent\r\n89,กะเพราไก่,120,80,29,5,20\r\n';
  assert.equal(parseCsv(reordered)[0].name,'กะเพราไก่');
});
test('CSV rejects ambiguous schema, malformed quotes, number syntax and extra fields',()=>{
  const invalid=[
    header+',price\nRice,1,1,80,20,5,20,80',
    header.replace('fee_percent','price')+'\nRice,1,1,80,20,5,20',
    header+'\nRice,1,1,80,20,5,20,extra',
    header+'\nRice,1,1,80,20,5',
    header+'\nRi"ce,1,1,80,20,5,20',
    header+'\n"Rice"x,1,1,80,20,5,20',
    header+'\n"Rice,1,1,80,20,5,20',
    header+'\nRice,1,,80,20,5,20',
    header+'\nRice,1,1,0x50,20,5,20',
    header+'\nRice,1,1,8e1,20,5,20',
    header+'\nRice,1,1,-80,20,5,20',
    header+'\nRice,1.5,1,80,20,5,20',
    header+'\nRice,1,1,80.001,20,5,20',
    header+'\nRice,1,1,80,20,5,101'
  ];
  for(const text of invalid)assert.throws(()=>parseCsv(text));
  assert.throws(()=>parseCsv('ก'.repeat(Math.ceil(MAX_CSV_BYTES/3)+1)),/1 MB/);
  assert.throws(()=>parseCsv(header+'\n'+Array.from({length:101},(_,i)=>`Rice ${i},1,1,80,20,5,20`).join('\n')),/100 menu/);
});
test('CSV duplicate names and huge aggregate values fail safely',()=>{
  assert.throws(()=>parseCsv(header+'\nRice,1,1,80,20,5,20\nrice,1,1,80,20,5,20'),/different name/);
  assert.throws(()=>project(sampleMenus[0],{...plan,extraOrders:100001}),/whole number/);
  assert.throws(()=>project(sampleMenus[0],{...plan,budget:Infinity}),/valid|finite|between/);
  assert.equal(project({...sampleMenus[0],ingredients:100},plan).breakEven,null);
});
test('a new workspace is valid and source labels its synthetic knowledge',()=>{
  const state=createWorkspace();
  assert.equal(validateWorkspace(state),state);
  assert.equal(state.datasets[0].sourceType,'synthetic');
  assert.equal(state.revision,0);
  assert.ok(state.memories.every(memory=>memory.source.includes('Synthetic')));
  assert.throws(()=>validateBusiness({...state.business,capacity:1.5}),/whole number/);
});
test('import commits one immutable snapshot, deduplicates the same source and archives original bytes',async()=>{
  const state=createWorkspace(),original=JSON.stringify(state.datasets[0]);
  const first=await importDataset(state,{text:csv,name:'POS export'});
  assert.equal(first.status,'committed');
  assert.equal(state.datasets.length,2);
  assert.equal(state.imports.length,1);
  assert.equal(state.activeDatasetId,first.dataset.id);
  assert.equal(JSON.stringify(state.datasets[0]),original);
  const repeat=await importDataset(state,{text:csv,name:'Same export renamed'});
  assert.equal(repeat.status,'duplicate');
  assert.equal(repeat.dataset.id,first.dataset.id);
  assert.equal(state.datasets.length,2);
  assert.equal(state.revision,1);
  assert.equal(await restoreArchive(first.import.rawGzip),csv);
  assert.match(first.import.rawGzip.sha256,/^[a-f0-9]{64}$/);
});
test('same CSV with a different reporting period is a different dataset',async()=>{
  const state=createWorkspace();
  await importDataset(state,{text:csv,name:'Fortnight'});
  await importDataset(state,{text:csv,name:'Week',period:{start:'2026-10-05',end:'2026-10-11'}});
  assert.equal(state.imports.length,2);
  assert.notEqual(state.imports[0].hash,state.imports[1].hash);
});
test('invalid and stale asynchronous imports do not partially commit',async()=>{
  const state=createWorkspace();
  await assert.rejects(importDataset(state,{text:header+'\nBad,1,1,80,20,5,20,extra'}));
  assert.equal(state.datasets.length,1);
  const pending=importDataset(state,{text:csv,name:'Pending'});
  commitManualDataset(state,[{...sampleMenus[0],price:90}]);
  await assert.rejects(pending,/workspace changed/);
  assert.equal(state.imports.length,0);
  assert.equal(state.datasets.length,2);
});
test('concurrent duplicate imports commit once rather than duplicate history',async()=>{
  const state=createWorkspace();
  const outcomes=await Promise.allSettled([importDataset(state,{text:csv,name:'One'}),importDataset(state,{text:csv,name:'Two'})]);
  assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);
  assert.equal(state.datasets.length,2);
  assert.equal(state.imports.length,1);
});
test('archive restoration verifies both size and hash',async()=>{
  const state=createWorkspace();
  const {import:imported}=await importDataset(state,{text:csv});
  await assert.rejects(restoreArchive({...imported.rawGzip,sha256:'0'.repeat(64)}),/integrity/);
  await assert.rejects(restoreArchive({...imported.rawGzip,rawBytes:10}),/size limit/);
  await assert.rejects(restoreArchive({...imported.rawGzip,rawBytes:MAX_CSV_BYTES+1}),/metadata/);
});
test('memory updates supersede prior facts and retrieval excludes stale values',()=>{
  const state=createWorkspace();
  const older=saveMemory(state,{key:'ingredient supplier',value:'Chicken costs 80 baht per kilo.',source:'Invoice 2026-10-01'});
  const newer=saveMemory(state,{key:' INGREDIENT SUPPLIER ',value:'Chicken costs 90 baht per kilo.',source:'Invoice 2026-10-10'});
  assert.equal(older.status,'superseded');
  const found=retrieveMemory(state,'ingredient chicken supplier',4);
  assert.equal(found[0].id,newer.id);
  assert.ok(found.every(memory=>memory.status==='confirmed'&&memory.retrievalMode==='keyword'));
  assert.ok(!found.some(memory=>memory.id===older.id));
  assert.throws(()=>saveMemory(state,{key:'cost',value:'1',source:''}),/named source/);
  assert.throws(()=>retrieveMemory(state,'cost',6),/one and five/);
  assert.ok(exportMemoryMarkdown(state).includes('superseded'));
});
test('strategy candidates expose assumptions and deterministic checks, with no model claims',()=>{
  const state=createWorkspace(),candidates=buildCandidates(state);
  assert.equal(candidates.length,2);
  assert.equal(state.runs.at(-1).candidates.length,2);
  assert.equal(candidates[0].projection.netCents,46080);
  assert.equal(candidates[1].projection.netCents,51600);
  assert.ok(candidates.every(candidate=>candidate.approvable&&candidate.source==='local-rule-demo'&&candidate.checks.every(check=>check.passed)));
  assert.ok(candidates[0].assumptions[0].includes('not forecasts'));
  assert.ok(candidates[0].scoreLabel.includes('not predicted'));
  const thai=buildCandidates(state,'th');
  assert.ok(thai[0].drafts.social.includes('บาท'));
});
test('budget, capacity, margin and stale dataset fail approval checks',()=>{
  const state=createWorkspace(),candidates=buildCandidates(state);
  state.business.capacity=10;
  const constrained=evaluateCandidates(state,candidates);
  assert.equal(constrained[0].approvable,false);
  assert.equal(constrained[0].checks.find(check=>check.key==='capacity').passed,false);
  state.business.capacity=80;state.business.budget=100;
  assert.equal(evaluateCandidates(state,candidates)[0].checks.find(check=>check.key==='budget').passed,false);
  commitManualDataset(state,[{...sampleMenus[0],price:90}]);
  assert.equal(evaluateCandidates(state,candidates)[0].checks.find(check=>check.key==='current').passed,false);
  const highCost=createWorkspace();
  commitManualDataset(highCost,[{...sampleMenus[0],ingredients:40}]);
  const moneyLosing={...buildCandidates(highCost)[0],discount:50,budget:0};
  assert.equal(evaluateCandidates(highCost,[moneyLosing])[0].checks.find(check=>check.key==='margin').passed,false);
});
test('results use the original dataset and capture plan even after active data changes',()=>{
  const state=createWorkspace(),candidate=buildCandidates(state)[0],datasetId=state.activeDatasetId;
  commitManualDataset(state,[{...sampleMenus[0],price:900}]);
  const result=recordResult(state,{candidateId:candidate.id,totalOrders:60,baselineOrders:20,spend:600});
  assert.equal(result.datasetId,datasetId);
  assert.equal(result.menu.price,89);
  assert.equal(result.netCents,46080);
  candidate.discount=20;
  assert.equal(result.plan.discount,10);
  assert.equal(state.results.length,1);
  assert.ok(result.interpretation.includes('not a causal'));
});
test('approved campaign snapshot is preferred over later draft changes',()=>{
  const state=createWorkspace(),candidate=buildCandidates(state)[0];
  state.campaigns.push({...structuredClone(candidate),candidateId:candidate.id,status:'approved'});
  candidate.discount=20;
  const result=recordResult(state,{candidateId:candidate.id,totalOrders:60,baselineOrders:20,spend:600});
  assert.equal(result.plan.discount,10);
  assert.equal(result.netCents,46080);
});

test('async imports pin caller date values before awaiting and rehydrated dataset snapshots are immutable',async()=>{
  const state=createWorkspace(),period={start:'2026-10-05',end:'2026-10-11'};
  const pending=importDataset(state,{text:csv,period});
  period.start='invalid';
  const imported=await pending;
  assert.equal(imported.dataset.period.start,'2026-10-05');
  assert.throws(()=>{imported.dataset.menus[0].price=900;},TypeError);
  const rehydrated=JSON.parse(JSON.stringify(state));
  validateWorkspace(rehydrated);
  assert.throws(()=>{rehydrated.datasets[0].menus[0].price=900;},TypeError);
});
