import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReceiptStory} from '../dist/copilot/receipt-story.mjs';
import {aiView} from '../dist/copilot/ai-view.mjs';
import {createAiDemoState,summarizeAiDemo} from '../dist/copilot/ai-demo.mjs';

class Element extends EventTarget{
  constructor(data={}){super();this.dataset={...data};this.style={transform:'',opacity:'',willChange:''};this.attrs=new Map();this.children=[];this.isConnected=true;this.hidden=false;this.textContent='';}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  contains(element){return element===this||this.children.some(child=>child.contains(element));}
  closest(selector){return selector==='button'?(this.button?this:this.parent?.closest(selector)):null;}
  matches(selector){return selector==='[data-receipt-story]'&&this.dataset.receiptStory!==undefined;}
  setAttribute(key,value){this.attrs.set(key,String(value));if(key.startsWith('data-'))this.dataset[this.dataKey(key)]=String(value);}
  getAttribute(key){return this.attrs.get(key)??null;}
  removeAttribute(key){this.attrs.delete(key);if(key.startsWith('data-'))delete this.dataset[this.dataKey(key)];}
  hasAttribute(key){return this.attrs.has(key)||(key.startsWith('data-')&&this.dataset[this.dataKey(key)]!==undefined);}
  dataKey(key){return key.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase());}
  querySelector(selector){return this.selector?.get(selector)||null;}
  querySelectorAll(selector){return this.selector?.get(selector)||[];}
}
function fixture({reduce=false,animationFails=false}={}){
  const doc=new EventTarget(),win=new EventTarget(),reduced=new EventTarget(),timers=new Map();
  let currentTime=0,id=0;reduced.matches=reduce;doc.defaultView=win;doc.hidden=false;
  win.matchMedia=()=>reduced;
  win.setTimeout=(fn,delay)=>{timers.set(++id,{fn,at:currentTime+delay});return id;};
  win.clearTimeout=key=>timers.delete(key);
  const tick=ms=>{const end=currentTime+ms;while(true){const next=[...timers].filter(([,item])=>item.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;currentTime=next[1].at;timers.delete(next[0]);next[1].fn();}currentTime=end;};
  const host=new Element({receiptStory:'',storyStep:'all'}),controls=new Element(),play=new Element({storyPlay:'',storyReplay:'Replay sequence'}),playLabel=new Element(),all=new Element({storyAll:''}),status=new Element({storyComplete:'Complete; receipt review still required.'}),confirm=new Element({aiAction:'confirm-receipt'});
  controls.hidden=true;playLabel.textContent='Play sequence';status.textContent='';
  const buttons=['receipt','ingredient','plate'].map(step=>new Element({storyStepButton:step,storyAnnouncement:`Evidence for ${step}`}));
  for(const button of [play,all,confirm,...buttons])button.button=true;
  const targets=['receipt','ingredient','plate'].map(step=>{const target=new Element({storyTarget:step}),sheen=new Element();target.append(sheen);target.selector=new Map([['[data-story-sheen]',sheen]]);return target;});
  targets[0].style.transform='rotate(-1.5deg)';
  controls.append(play,all,...buttons,status);play.append(playLabel);host.append(controls,...targets,confirm);
  host.selector=new Map([['[data-story-controls]',controls],['[data-story-play]',play],['[data-story-play-label]',playLabel],['[data-story-status]',status],['[data-story-step-button]',buttons],['[data-story-target]',targets]]);
  for(const element of [host,controls,play,all,confirm,...buttons,...targets])element.ownerDocument=doc;
  const animations=[];
  const animateElement=(element)=>{if(animationFails)throw Error('Animation unavailable');const control={stopped:false,stop(){this.stopped=true;},then(){}};element.style.transform='ANIMATING';animations.push({element,control});return control;};
  const cleanup=mountReceiptStory(host,{animateElement});
  const emit=(target,type,fields={})=>{const event=new Event(type);for(const [key,value] of Object.entries(fields))Object.defineProperty(event,key,{value});target.dispatchEvent(event);};
  const click=button=>emit(host,'click',{target:button});
  return {doc,win,reduced,timers,tick,host,controls,play,playLabel,all,status,buttons,targets,confirm,animations,cleanup,click,emit};
}

test('receipt sequence is opt-in, replayable and leaves review/accounting separate',()=>{
  const f=fixture();
  assert.equal(f.controls.hidden,false);assert.equal(f.host.dataset.storyStep,'all');assert.equal(f.animations.length,0);assert.equal(f.timers.size,0);
  f.click(f.play);assert.equal(f.host.dataset.storyStep,'receipt');assert.equal(f.buttons[0].getAttribute('aria-current'),'step');assert.equal(f.playLabel.textContent,'Replay sequence');
  f.tick(1300);assert.equal(f.host.dataset.storyStep,'ingredient');assert.equal(f.targets[0].style.transform,'rotate(-1.5deg)');
  f.tick(1400);assert.equal(f.host.dataset.storyStep,'plate');assert.equal(f.status.textContent,'Evidence for plate');
  f.tick(1700);assert.equal(f.host.dataset.storyStep,'all');assert.equal(f.timers.size,0);assert.equal(f.host.dataset.storyRunning,undefined);
  assert.ok(f.animations.every(item=>item.control.stopped));assert.equal(f.status.textContent,'Complete; receipt review still required.');
  assert.equal(f.confirm.dataset.aiAction,'confirm-receipt');assert.equal(f.confirm.getAttribute('aria-pressed'),null);
  f.click(f.play);assert.equal(f.host.dataset.storyStep,'receipt');f.cleanup();
});

test('manual steps and Show all interrupt playback without stale completion or moving focus',()=>{
  const f=fixture();f.doc.activeElement=f.play;f.click(f.play);f.tick(600);
  f.click(f.buttons[2]);assert.equal(f.timers.size,0);assert.equal(f.host.dataset.storyStep,'plate');assert.equal(f.doc.activeElement,f.play);
  f.tick(6000);assert.equal(f.host.dataset.storyStep,'plate');
  f.click(f.all);assert.equal(f.host.dataset.storyStep,'all');assert.equal(f.buttons.some(button=>button.hasAttribute('aria-current')),false);
  f.click(f.play);f.emit(f.host,'focusin',{target:f.confirm});assert.equal(f.timers.size,0);assert.equal(f.host.dataset.storyStep,'all');
  f.cleanup();
});

test('reduced motion, hidden pages and detached views settle with all evidence visible',()=>{
  const reduced=fixture({reduce:true});reduced.click(reduced.play);assert.equal(reduced.host.dataset.storyStep,'all');assert.equal(reduced.timers.size,0);assert.equal(reduced.animations.length,0);reduced.cleanup();
  for(const signal of ['reduce','hidden','pagehide','detached']){
    const f=fixture();f.click(f.play);
    if(signal==='reduce'){f.reduced.matches=true;f.reduced.dispatchEvent(new Event('change'));}
    if(signal==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}
    if(signal==='pagehide')f.win.dispatchEvent(new Event('pagehide'));
    if(signal==='detached'){f.host.isConnected=false;f.tick(1300);}
    assert.equal(f.timers.size,0,signal);assert.equal(f.host.dataset.storyStep,'all',signal);assert.ok(f.animations.every(item=>item.control.stopped),signal);f.cleanup();
  }
});

test('teardown and unavailable motion cannot leave transforms, listeners or hidden evidence',()=>{
  const f=fixture();f.click(f.play);f.cleanup();f.cleanup();
  assert.equal(f.timers.size,0);assert.equal(f.targets[0].style.transform,'rotate(-1.5deg)');assert.equal(f.controls.hidden,true);assert.equal(f.playLabel.textContent,'Play sequence');
  f.click(f.play);f.tick(6000);assert.equal(f.timers.size,0);assert.equal(f.host.dataset.storyStep,'all');
  const failed=fixture({animationFails:true});failed.click(failed.play);failed.tick(4400);assert.equal(failed.host.dataset.storyStep,'all');assert.equal(failed.targets[0].style.transform,'rotate(-1.5deg)');assert.equal(failed.timers.size,0);failed.cleanup();
});

test('rendered sequence remains transparent about simulation and chicken-only preview in both languages',()=>{
  const aiState=createAiDemoState(),summary=summarizeAiDemo(aiState);
  for(const language of ['en','th']){
    const html=aiView({language,demo:true,aiState,summary});
    assert.equal((html.match(/data-receipt-story/g)||[]).length,1);
    assert.equal((html.match(/data-story-target=/g)||[]).length,3);
    assert.equal((html.match(/<button[^>]+data-story-step-button/g)||[]).length,3);
    assert.match(html,/data-story-controls hidden/);assert.match(html,/data-story-play/);assert.match(html,/data-story-all/);
    assert.match(html,/data-story-status role="status" aria-live="polite"/);
    assert.match(html,/data-ai-action="confirm-receipt" aria-pressed="false"/);
    assert.match(html,/\/images\/menu\/basil-chicken.webp/);assert.match(html,/13\/10\/2569/);assert.match(html,/2026-10-13/);
    assert.match(html,language==='en'?/Sample plate · chicken component/:/จานตัวอย่าง · เฉพาะต้นทุนไก่/);
    assert.match(html,language==='en'?/Preview · confirm the receipt/:/ตัวอย่าง · ยืนยันใบซื้อ/);
    assert.doesNotMatch(aiView({language,demo:false,aiState,summary}),/data-receipt-story|data-story-play|basil-chicken.webp/);
  }
  assert.equal(summary.weeklyMetrics[1].contributionCents,null);assert.equal(aiState.receiptConfirmed,false);
});
