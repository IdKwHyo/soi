import {gsap} from 'gsap';
import {ScrollTrigger} from 'gsap/ScrollTrigger';
import {animate} from 'motion';
import {bindWindowLighting} from './window-light.mjs';
import {createChoreography} from './choreography.mjs';
import {bindInteractionLight} from './interaction-light.mjs';

gsap.registerPlugin(ScrollTrigger);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const finePointer=matchMedia('(hover: hover) and (pointer: fine)');
const compact=matchMedia('(max-width: 760px)');
const settle={type:'spring',stiffness:280,damping:34,mass:1};
const pressSettle={type:'spring',stiffness:500,damping:45,mass:1};
const fade={type:'tween',duration:.2,ease:[.22,.61,.36,1]};
const controlsSelector='.button,.text-button,.icon-button,.import-file-label,.nav-item,.studio-mode-link,.draft-tabs button,.workflow-list button,.merchant-step-list button,.flow-rail button,[data-motion-press]';
const revealSelector='.receipt-preview,[data-motion-reveal]';
const animations=new Map(),pressed=new Map(),panels=new Map(),metricValues=new Map();
const revealed=new WeakSet(),revealedMessages=new Set();
let initialized=false,observer,scene=null,sceneCleanup=()=>{},suspended=false;

function restore(element,styles){
  for(const [key,value] of Object.entries(styles))element.style[key]=value;
}
function finish(element){
  const record=animations.get(element);if(!record)return;
  try{record.control.stop();}catch{}
  animations.delete(element);restore(element,record.styles);
}
function glide(element,values,options=settle,hold=false){
  if(!element?.isConnected||reduced.matches||document.hidden||suspended)return;
  const previous=animations.get(element);
  const styles=previous?.styles||{transform:element.style.transform,opacity:element.style.opacity,willChange:element.style.willChange};
  // Motion's stop samples the presentation value/velocity, so a quick reversal
  // is retargeted from the currently visible press rather than its first frame.
  try{previous?.control.stop();}catch{}
  element.style.willChange='transform,opacity';
  let control;
  try{control=animate(element,values,{...options,opacity:fade});}
  catch{animations.delete(element);restore(element,styles);return;}
  const record={control,styles};animations.set(element,record);
  control.then(()=>{
    if(animations.get(element)!==record||hold)return;
    animations.delete(element);restore(element,styles);
  });
}
export function animateView(container){
  if(!container)return;
  // Numbers are always exact, including during a transition. Only the new
  // number's opacity changes; no fictional interpolated monetary values.
  container.querySelectorAll('.metric > strong').forEach((element,index)=>{
    const key=`${index}:${element.parentElement.querySelector('.metric-name')?.textContent||''}`;
    const value=element.textContent,previous=metricValues.get(key);
    metricValues.set(key,value);
    if(previous!==undefined&&previous!==value)glide(element,{opacity:[.48,1]},fade);
  });
  // The choreography controller builds individual sections into place.
  // Never animate the whole main element on a form rerender.
  finish(container);
}

function enhanceWindow(host){
  const lightingCleanup=bindWindowLighting(host);
  const cameraCleanup=enhanceWindowCamera(host);
  return()=>{cameraCleanup();lightingCleanup();};
}

function enhanceWindowCamera(host){
  const button=host?.querySelector('.c-window-button');
  const camera=host?.querySelector('.c-window-camera');
  const photo=host?.querySelector('.c-window-photo');
  if(!button||!camera||!photo||typeof IntersectionObserver!=='function'||typeof ResizeObserver!=='function')return()=>{};
  const photos=[...host.querySelectorAll('.c-window-photo')];
  const haze=host.querySelector('.c-window-haze');
  const reflection=host.querySelector('.c-window-reflection');
  const glint=host.querySelector('.c-window-glint');
  const light=host.querySelector('.c-window-light');
  const rim=host.querySelector('.c-window-rim');
  const shadow=host.querySelector('.c-window-shadow');
  const atmosphere=[...host.closest('.c-overview')?.querySelectorAll('.c-atmosphere')||[]];
  const layers=[camera,...photos,haze,reflection,glint,light,rim,shadow,...atmosphere].filter(Boolean);
  const original=new Map(layers.map(node=>[node,{transform:node.style.transform,opacity:node.style.opacity,willChange:node.style.willChange}]));
  const listeners=new AbortController(),signal=listeners.signal;
  const state={progress:0,ambience:0,x:0,y:0,entry:0};
  let trigger=null,ambientTrigger=null,visible=true,disposed=false,entered=false;
  const clamp=(n,min=-1,max=1)=>Math.max(min,Math.min(max,n));
  const active=()=>!disposed&&!document.hidden&&!suspended&&host.isConnected;
  const paint=()=>{
    if(!active())return;
    const calm=reduced.matches,small=compact.matches||!finePointer.matches,p=state.progress;
    const x=calm?0:state.x,y=calm?0:state.y;
    const depth=calm?0:(p-.5),entry=calm?0:1-state.entry;
    const arc=calm?0:Math.sin(p*Math.PI),orbit=small?0:depth*6;
    camera.style.transform=calm?'none':`translate3d(${orbit}px,${entry*12-arc*(small?2:5)}px,${arc*(small?0:12)}px) rotateX(${depth*(small?-1.8:-5.4)-y*.8}deg) rotateY(${depth*(small?2:10)+x*1.4}deg) scale(${1-entry*.016})`;
    for(const image of photos)image.style.transform=calm?'none':`translate3d(${depth*(small?16:62)-x*9}px,${-depth*(small?22:62)-y*5}px,0) scale(${(small?1.035:1.06)+p*(small?.035:.085)+entry*.035})`;
    if(haze){haze.style.transform=calm?'none':`translate3d(${depth*10+x*6}px,${depth*9}px,0)`;haze.style.opacity=String(.18+p*.16);}
    if(reflection){reflection.style.transform=calm?'none':`translate3d(${depth*(small?20:86)+x*30}px,${-y*16}px,0) rotate(${-5+depth*4+x*2}deg)`;reflection.style.opacity=String(.19+p*.14+Math.abs(x)*.12);}
    if(glint){glint.style.transform=calm?'none':`translate3d(${depth*(small?16:74)+x*20}px,${-depth*12-y*8}px,0) rotate(${-9+depth*7}deg)`;glint.style.opacity=String(calm?.08:.08+arc*.15+Math.abs(x)*.06);}
    if(light){light.style.transform=calm?'none':`translate3d(${-depth*18+x*8}px,${depth*8}px,0)`;light.style.opacity=String(.055+p*.065);}
    if(rim){rim.style.transform=calm?'none':`translate3d(${depth*3}px,${-depth*3}px,0)`;rim.style.opacity=String(.48+p*.17);}
    if(shadow){shadow.style.transform=calm?'none':`translate3d(${-depth*7-x*2}px,${depth*5}px,0) scale(${1+p*.025})`;shadow.style.opacity=String(.45+p*.1);}
  };
  const paintAtmosphere=()=>{
    if(!active())return;
    const calm=reduced.matches,small=compact.matches||!finePointer.matches,p=state.ambience;
    atmosphere.forEach((layer,index)=>{
      const direction=index?-1:1,travel=small?18:52;
      layer.style.transform=calm?'none':`translate3d(${direction*(p-.5)*travel}px,${direction*(p-.5)*travel*.65}px,0) scale(${1+p*.04})`;
      layer.style.opacity=String(calm?.55:.42+Math.sin(p*Math.PI)*.28);
    });
  };
  const stop=()=>{gsap.killTweensOf(state);};
  const resetPointer=()=>{
    if(!active()||reduced.matches){state.x=state.y=0;paint();return;}
    gsap.to(state,{x:0,y:0,duration:.7,ease:'power3.out',overwrite:'auto',onUpdate:paint});
  };
  const configure=()=>{
    trigger?.kill();ambientTrigger?.kill();trigger=null;ambientTrigger=null;stop();state.x=state.y=0;
    for(const layer of layers)layer.style.willChange=visible&&!reduced.matches?'transform,opacity':original.get(layer).willChange;
    if(reduced.matches){state.entry=1;state.progress=.3;paint();paintAtmosphere();return;}
    if(!active())return;
    trigger=ScrollTrigger.create({trigger:host,start:'top 65%',end:'bottom top',invalidateOnRefresh:true,
      onUpdate:self=>{
        if(!active()||!visible)return;
        gsap.to(state,{progress:self.progress,duration:.55,ease:'power3.out',overwrite:'auto',onUpdate:paint});
      }});
    state.progress=trigger.progress;
    if(atmosphere.length)ambientTrigger=ScrollTrigger.create({trigger:host.closest('.c-overview'),start:'top center',end:'bottom bottom',invalidateOnRefresh:true,
      onUpdate:self=>{
        if(!active())return;
        gsap.to(state,{ambience:self.progress,duration:.7,ease:'power2.out',overwrite:'auto',onUpdate:paintAtmosphere});
      }});
    state.ambience=ambientTrigger?.progress??0;
    if(visible&&!entered){entered=true;gsap.to(state,{entry:1,duration:1.25,ease:'power3.out',onUpdate:paint});}
    else state.entry=1;
    paint();paintAtmosphere();
  };
  const visibility=new IntersectionObserver(entries=>{
    visible=entries[0].isIntersecting;
    for(const layer of layers)layer.style.willChange=visible&&!reduced.matches?'transform,opacity':original.get(layer).willChange;
    if(!visible){gsap.killTweensOf(state,'progress,x,y,entry');state.entry=1;return;}
    if(active()){state.progress=trigger?.progress??state.progress;paint();}
  },{threshold:0});visibility.observe(host);
  const resize=new ResizeObserver(()=>{if(active()&&!reduced.matches){trigger?.refresh();ambientTrigger?.refresh();state.progress=trigger?.progress??state.progress;state.ambience=ambientTrigger?.progress??state.ambience;paint();paintAtmosphere();}});resize.observe(host);
  button.addEventListener('pointermove',event=>{
    if(!active()||!visible||reduced.matches||!finePointer.matches||event.pointerType==='touch')return;
    const box=button.getBoundingClientRect();if(!box.width||!box.height)return;
    const x=clamp((event.clientX-box.left)/box.width*2-1),y=clamp((event.clientY-box.top)/box.height*2-1);
    gsap.to(state,{x,y,duration:.65,ease:'power3.out',overwrite:'auto',onUpdate:paint});
  },{signal,passive:true});
  button.addEventListener('pointerleave',resetPointer,{signal,passive:true});
  button.addEventListener('pointercancel',resetPointer,{signal,passive:true});
  button.addEventListener('blur',resetPointer,{signal});
  photo.addEventListener('load',()=>{trigger?.refresh();paint();},{signal});
  reduced.addEventListener('change',configure,{signal});
  compact.addEventListener('change',configure,{signal});
  finePointer.addEventListener('change',resetPointer,{signal});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){stop();state.entry=1;trigger?.disable(false);ambientTrigger?.disable(false);}
    else if(!trigger&&!reduced.matches)configure();
    else{trigger?.enable(false,true);ambientTrigger?.enable(false,true);state.progress=trigger?.progress??state.progress;state.ambience=ambientTrigger?.progress??state.ambience;paint();paintAtmosphere();}
  },{signal});
  const cleanup=()=>{
    disposed=true;stop();trigger?.kill();ambientTrigger?.kill();visibility.disconnect();resize.disconnect();listeners.abort();
    delete host.dataset.windowEnhanced;
    for(const [layer,styles] of original)restore(layer,styles);
  };
  try{host.dataset.windowEnhanced='true';configure();}
  catch{cleanup();return()=>{};}
  return cleanup;
}

function finishPanel(element){
  const record=panels.get(element);if(!record)return;
  try{record.control.stop();}catch{}
  panels.delete(element);element.open=record.open;restore(element,record.styles);
}
function togglePanel(event){
  const summary=event.target instanceof Element?event.target.closest('summary'):null;
  const element=summary?.parentElement;
  if(!element?.matches('details')||element.matches('.edition-switcher')||event.defaultPrevented||reduced.matches||suspended)return;
  // Native interactive disclosures and menus keep native layout/focus behavior.
  // Height is animated only for text-only panels, never around working fields.
  if(element.querySelector('input,select,textarea,button,a,[contenteditable],details'))return;
  event.preventDefault();
  const previous=panels.get(element),open=!(previous?.open??element.open);
  const styles=previous?.styles||{height:element.style.height,overflow:element.style.overflow,willChange:element.style.willChange};
  const current=element.getBoundingClientRect().height;
  try{previous?.control.stop();}catch{}
  element.style.height='auto';element.open=true;
  const box=getComputedStyle(element);
  const borders=parseFloat(box.borderTopWidth)+parseFloat(box.borderBottomWidth);
  const padding=parseFloat(box.paddingTop)+parseFloat(box.paddingBottom);
  const closed=summary.getBoundingClientRect().height+padding+borders;
  const target=open?element.getBoundingClientRect().height:closed;
  // Current project details use border-box. Convert if a future surface doesn't.
  const adjustment=box.boxSizing==='border-box'?0:padding+borders;
  element.style.height=`${Math.max(0,current-adjustment)}px`;element.style.overflow='clip';element.style.willChange='height';
  let control;
  try{control=animate(element,{height:Math.max(0,target-adjustment)},{type:'spring',stiffness:240,damping:31,mass:1});}
  catch{element.open=open;restore(element,styles);panels.delete(element);return;}
  const record={control,styles,open};panels.set(element,record);
  control.then(()=>{if(panels.get(element)!==record)return;panels.delete(element);element.open=open;restore(element,styles);});
}

export function initMotion(){
  if(initialized)return;initialized=true;suspended=false;
  const listeners=new AbortController(),signal=listeners.signal;
  const choreography=createChoreography({reducedMotion:reduced});
  const interactionLight=bindInteractionLight({document,reducedMotion:reduced,finePointer,selector:controlsSelector});
  let activeView='overview';
  const ensureScene=()=>{
    const next=suspended?null:document.querySelector('[data-window-scene]');
    if(next===scene)return;
    sceneCleanup();scene=next;sceneCleanup=next?enhanceWindow(next):()=>{};
  };
  const settleAll=()=>{
    for(const element of animations.keys())finish(element);
    for(const element of panels.keys())finishPanel(element);
    pressed.clear();
  };
  const reveal=element=>{
    if(revealed.has(element)||element.hidden||element.closest('[hidden]'))return;
    revealed.add(element);
    const key=element.dataset.motionKey;
    if(key){if(revealedMessages.has(key))return;revealedMessages.add(key);if(revealedMessages.size>256)revealedMessages.delete(revealedMessages.values().next().value);}
    glide(element,{y:[6,0],scale:[.995,1],opacity:[.92,1]});
  };
  observer=new MutationObserver(records=>{
    ensureScene();
    for(const element of animations.keys())if(!element.isConnected)finish(element);
    for(const element of panels.keys())if(!element.isConnected)finishPanel(element);
    for(const [key,element] of pressed)if(!element.isConnected)pressed.delete(key);
    for(const record of records){
      if(record.type==='attributes'){
        const element=record.target;
        if(record.attributeName==='aria-selected'&&element.matches('.draft-tabs button[aria-selected="true"]'))glide(element,{scale:[.985,1]},pressSettle);
        if(record.attributeName==='hidden'&&!element.hidden&&element.matches('.ocr-review,[data-motion-reveal]'))reveal(element);
        if(record.attributeName==='open'){
          if(element.matches('details[open]')&&!panels.has(element)){
            for(const child of element.children)if(child.tagName!=='SUMMARY')glide(child,{opacity:[.6,1]},fade);
          }
        }
        continue;
      }
      for(const node of record.addedNodes){
        if(!(node instanceof Element))continue;
        if(node.matches(revealSelector))reveal(node);
        node.querySelectorAll(revealSelector).forEach(reveal);
      }
    }
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-selected','hidden','open']});
  const control=event=>event.target instanceof Element?event.target.closest(controlsSelector):null;
  const down=(key,element)=>{if(!element||element.matches(':disabled,[aria-disabled="true"]')||element.closest('.c-window-button'))return;pressed.set(key,element);glide(element,{scale:.976},pressSettle,true);};
  const up=key=>{const element=pressed.get(key);pressed.delete(key);if(element?.isConnected)glide(element,{scale:1},pressSettle);};
  document.addEventListener('pointerdown',event=>{if(event.isPrimary&&event.button===0)down(event.pointerId,control(event));},{signal,passive:true});
  document.addEventListener('pointerup',event=>up(event.pointerId),{signal,passive:true});
  document.addEventListener('pointercancel',event=>up(event.pointerId),{signal,passive:true});
  document.addEventListener('keydown',event=>{if(!event.repeat&&(event.key===' '||event.key==='Enter'))down('keyboard',control(event));},{signal});
  document.addEventListener('keyup',event=>{if(event.key===' '||event.key==='Enter')up('keyboard');},{signal});
  document.addEventListener('click',togglePanel,{signal});
  window.addEventListener('blur',()=>{for(const key of pressed.keys())up(key);},{signal});
  document.addEventListener('soi:view',event=>{activeView=event.detail?.view||activeView;ensureScene();choreography.update(activeView);ScrollTrigger.refresh();},{signal});
  reduced.addEventListener('change',()=>{if(reduced.matches)settleAll();},{signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){settleAll();choreography.suspend();}else choreography.resume(activeView);},{signal});
  window.addEventListener('resize',()=>{for(const element of panels.keys())finishPanel(element);},{signal,passive:true});
  ensureScene();
  window.addEventListener('pagehide',event=>{
    suspended=true;settleAll();choreography.suspend();interactionLight.suspend();ensureScene();
    if(event.persisted)return;
    initialized=false;choreography.destroy();interactionLight.destroy();listeners.abort();observer.disconnect();metricValues.clear();revealedMessages.clear();
  },{signal});
  window.addEventListener('pageshow',event=>{if(event.persisted){suspended=false;ensureScene();choreography.resume(activeView);interactionLight.resume();ScrollTrigger.refresh();}},{signal});
}
