import test from 'node:test';
import assert from 'node:assert/strict';
import {menuDishPhoto} from '../dist/copilot/photo-view.mjs';
import {MAX_MENU_PHOTO_BYTES} from '../dist/copilot/menu-media.mjs';

const publicKey='a'.repeat(32),photoId='b'.repeat(32),otherKey='c'.repeat(32);
const item={id:'custom-dish',name:'Lunch',photo:{kind:'uploaded',id:photoId}};
const publicUrl=`/api/copilot/media/${publicKey}/${photoId}`;
const render=(photoUrl,options={})=>menuDishPhoto({...item,photoUrl},options);
const imageSource=html=>html.match(/<img src="([^"]+)"/)?.[1]??null;

test('guest photo uses the hydrated public route without requiring a separate public key',()=>{
  assert.equal(imageSource(render(publicUrl)),publicUrl);
});

test('an explicit public key resolves the public route and cannot be overridden by another shop',()=>{
  assert.equal(imageSource(render(undefined,{publicKey})),publicUrl);
  assert.equal(imageSource(render(`/api/copilot/media/${otherKey}/${photoId}`,{publicKey})),publicUrl);
});

test('menu rendering never falls back to an authenticated owner photo route',()=>{
  assert.equal(imageSource(render(undefined)),null);
  assert.equal(imageSource(render(`/api/copilot/media/${photoId}`)),null);
  assert.equal(imageSource(render(undefined,{publicKey:null})),null);
  assert.equal(imageSource(render(publicUrl,{publicKey:'invalid'})),null);
});

test('unsafe or mismatched hydrated routes are rejected',()=>{
  for(const value of ['https://example.com/photo.jpg','//example.com/photo.jpg','javascript:alert(1)','data:image/svg+xml;base64,AAAA','blob:example',`${publicUrl}?other=1`,`/api/copilot/media/${publicKey}/${otherKey}`]){
    assert.equal(imageSource(render(value)),null,value);
  }
});

test('demo upload hydration accepts bounded raster data and rejects unsafe alternatives',()=>{
  for(const type of ['jpeg','png','webp']){
    const value=`data:image/${type};base64,AAAA`;
    assert.equal(imageSource(render(value,{demo:true})),value);
  }
  for(const value of [publicUrl,'data:image/svg+xml;base64,AAAA','https://example.com/photo.jpg',`data:image/jpeg;base64,${'A'.repeat(Math.ceil(MAX_MENU_PHOTO_BYTES*4/3)+41)}`]){
    assert.equal(imageSource(render(value,{demo:true})),null);
  }
});

test('generated images retain their curated path and explicit no-photo is respected',()=>{
  assert.equal(imageSource(menuDishPhoto({...item,photo:{kind:'generated',key:'basil-chicken'}})),'/images/menu/basil-chicken.webp');
  assert.equal(imageSource(menuDishPhoto({id:'basil-chicken',name:'Basil chicken',photo:null},{demo:true})),null);
});
