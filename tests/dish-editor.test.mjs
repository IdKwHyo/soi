import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeDishEdit} from '../dist/copilot/dish-editor.mjs';
import {menuEditor} from '../dist/copilot/menu-editor.mjs';
import {orderMenuView} from '../dist/copilot/order-view.mjs';
import {guestView} from '../dist/copilot/views.mjs';
import {createCopilotState,publicMenu,applyCopilotAction} from '../dist/copilot/domain.mjs';

test('one dish edit retains every other SKU, ordering, recipes and historical order values',()=>{
  let state=createCopilotState();
  state=applyCopilotAction(state,{action:'order',payload:{requestId:'dish-editor-history',channel:'offline',items:[{id:state.menu[0].id,quantity:1}]}}).state;
  const before=structuredClone(state),dish=state.menu[0],edit={...dish,name:'Lunch special',storePriceCents:7200,photo:null};
  const items=mergeDishEdit(state.menu,dish.id,[edit]);
  assert.equal(items.length,state.menu.length);
  assert.deepEqual(items.map(item=>item.id),state.menu.map(item=>item.id));
  assert.equal(items[0].name,'Lunch special');
  assert.equal(items[0].storePriceCents,7200);
  assert.equal(items[0].photo,null);
  assert.deepEqual(items.slice(1),state.menu.slice(1));
  assert.deepEqual(state,before,'merge does not mutate the current state');
  const saved=applyCopilotAction(state,{action:'menu',payload:{items}}).state;
  assert.deepEqual(saved.orders,before.orders);
  assert.deepEqual(saved.recipes,before.recipes);
  assert.equal(saved.menu.length,before.menu.length);
});

test('single-dish merge rejects changed IDs, absent dishes, duplicate catalogs and multi-row saves',()=>{
  const menu=createCopilotState().menu,id=menu[0].id,dish=menu[0];
  for(const [catalog,key,items] of [
    [menu,id,[]],[menu,id,[dish,dish]],[menu,id,[{...dish,id:'different-id'}]],
    [menu,'missing-dish',[{...dish,id:'missing-dish'}]],[[],id,[dish]],
    [[dish,dish],id,[dish]],[[{...dish,id:''}],id,[dish]],[menu,'',[dish]],
  ])assert.throws(()=>mergeDishEdit(catalog,key,items));
  assert.equal(mergeDishEdit(menu,id,[{...dish,available:false}])[0].available,false);
});

test('single-dish form has one immutable SKU and anchored image while bulk import stays available',()=>{
  const state=createCopilotState(),id=state.menu[0].id;
  for(const language of ['en','th']){
    const html=menuEditor(state,language,{editSku:id,demo:true,photoUrl:()=>'/images/menu/basil-chicken.webp'});
    assert.match(html,new RegExp(`data-edit-sku="${id}"`));
    assert.equal((html.match(/data-menu-item=/g)||[]).length,1);
    assert.match(html,/data-dish-hero/);
    assert.match(html,/<input name="id"[^>]*readonly/);
    assert.doesNotMatch(html,/data-action="new-sku"|importReviewed/);
    assert.match(html,/Save dish|บันทึกเมนูนี้/);
    assert.match(html,/data-dish-photo/,'real-photo upload remains available');
    assert.match(html,/AI image collection|ชุดภาพ AI/);
  }
  const bulk=menuEditor(state,'en',{importing:true});
  assert.equal((bulk.match(/data-menu-item=/g)||[]).length,state.menu.length);
  assert.match(bulk,/data-action="new-sku"/);assert.match(bulk,/importReviewed/);
  assert.doesNotMatch(bulk,/data-edit-sku|data-dish-hero/);
  assert.throws(()=>menuEditor(state,'en',{editSku:'missing'}),/no longer/);
  assert.throws(()=>menuEditor(state,'en',{editSku:id,importing:true}),/full menu editor/);
});

test('merchant dish affordances are native buttons separate from ordering and absent in guest menu',()=>{
  const state=createCopilotState(),data=publicMenu(state),id=state.menu[0].id;
  const html=orderMenuView({state,data,language:'en',demo:true});
  assert.match(html,new RegExp(`data-dish-source="${id}"`));
  assert.match(html,new RegExp(`<button[^>]*data-edit-dish="${id}"[^>]*aria-haspopup="dialog"`));
  assert.match(html,new RegExp(`<button[^>]*data-add="${id}"`));
  assert.equal((html.match(/data-edit-dish=/g)||[]).length,data.menu.length*2);
  assert.doesNotMatch(guestView({data,language:'en',demo:true}),/data-edit-dish|data-dish-source/);
});
