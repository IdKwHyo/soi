import test from 'node:test';
import assert from 'node:assert/strict';
import {createCopilotState,applyCopilotAction} from '../dist/copilot/domain.mjs';
import {menuDraftFingerprint,assertMenuDraftCurrent} from '../dist/copilot/menu-draft.mjs';

test('menu draft guard tolerates queue, revision and media changes without losing catalog protection',()=>{
  const state=createCopilotState(),baseline=menuDraftFingerprint(state.menu);
  const ordered=applyCopilotAction(state,{action:'order',payload:{requestId:'draft-queue-order',channel:'offline',table:'A',items:[{id:state.menu[0].id,quantity:1}]}}).state;
  ordered.revision++;ordered.mediaUploads=[{id:'a'.repeat(32),bytes:1234}];
  assert.equal(assertMenuDraftCurrent(baseline,ordered.menu),true);
  assert.equal(menuDraftFingerprint(ordered.menu),baseline);
});

test('all editable menu changes require reopening the latest editor',()=>{
  const menu=createCopilotState().menu,baseline=menuDraftFingerprint(menu);
  const changes={id:'different-sku',name:'New name',nameTh:'ชื่อใหม่',category:'New category',
    storePriceCents:12345,onlinePriceCents:23456,prepMinutes:22,station:'new-station',available:false,
    photo:{kind:'uploaded',id:'a'.repeat(32)}};
  for(const [field,value] of Object.entries(changes)){
    const current=structuredClone(menu);current[0][field]=value;
    assert.throws(()=>assertMenuDraftCurrent(baseline,current),/Close this editor and reopen it to review the latest menu/);
  }
  assert.throws(()=>assertMenuDraftCurrent(baseline,[...menu].reverse()),/menu changed/);
  assert.throws(()=>assertMenuDraftCurrent(baseline,menu.slice(1)),/menu changed/);
});

test('fingerprints use canonical photo descriptors and stable property ordering',()=>{
  const menu=createCopilotState().menu,baseline=menuDraftFingerprint(menu),copy=structuredClone(menu);
  const reordered=copy.map(item=>({...Object.fromEntries(Object.entries(item).reverse()),
    photo:{url:'https://ignored.example/photo',key:item.photo.key,kind:'generated'},
    photoUrl:'/api/copilot/media/ignored',updatedAt:'later',privateMetadata:'ignored'}));
  assert.equal(menuDraftFingerprint(reordered),baseline);
  assert.equal(assertMenuDraftCurrent(baseline,reordered),true);
  assert.deepEqual(copy,menu);
  const legacy=structuredClone(menu);delete legacy[0].photo;delete legacy[0].nameTh;
  const explicit=structuredClone(legacy);explicit[0].photo=null;explicit[0].nameTh='';
  assert.equal(menuDraftFingerprint(legacy),menuDraftFingerprint(explicit));
  assert.throws(()=>assertMenuDraftCurrent(null,menu),/Close this editor and reopen/);
});
