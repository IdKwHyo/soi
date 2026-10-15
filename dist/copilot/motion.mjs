import {animate} from 'motion';
import {gsap} from 'gsap';

const controllers=new Set();
const ease=[.22,.61,.36,1];
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

/** Progressive enhancement: content remains visible if animation is unavailable. */
export function mountMotion(root=document,{animate:animateElement=animate}={}){
  const doc=root.ownerDocument||root;
  const win=doc.defaultView||window;
  const reduced=win.matchMedia('(prefers-reduced-motion: reduce)');
  const fine=win.matchMedia('(hover: hover) and (pointer: fine)');
  const listeners=new AbortController();
  const signal=listeners.signal;
  const running=new Map();
  let disposed=false,scene=null,disposeScene=()=>{},observer=null,viewKey=null;
  const revealed=new Set();
  const pending=new Map();
  const select=(selector)=>root.querySelectorAll(selector);

  function finish(element){
    const item=running.get(element);if(!item)return;
    try{item.control.stop();}catch{}
    element.style.transform=item.transform;
    element.style.opacity=item.opacity;
    element.style.willChange=item.willChange;
    running.delete(element);
  }
  function settle(){for(const element of running.keys())finish(element);}
  function reveal(element,delay=0,kind='surface'){
    if(disposed||reduced.matches||doc.hidden||!element.isConnected)return;
    if(element.contains(doc.activeElement)&&doc.activeElement!==doc.body)return;
    if(fine.matches&&element.matches(':hover'))return;
    finish(element);
    const original={transform:element.style.transform,opacity:element.style.opacity,willChange:element.style.willChange};
    const computed=win.getComputedStyle(element),base=computed.transform==='none'?'':computed.transform;
    const opacity=Number.parseFloat(computed.opacity)||1,compact=!fine.matches||win.innerWidth<640;
    const travel=(kind==='detail'?8:kind==='image'?14:18)*(compact?.5:1);
    const tilt=kind==='surface'&&!compact?1.1:0;
    element.style.willChange='transform,opacity';
    let control;
    try{control=animateElement(element,{opacity:[opacity*.84,opacity],transform:[`perspective(1100px) translate3d(0,${travel}px,0) rotateX(${tilt}deg) ${base}`,`perspective(1100px) translate3d(0,0,0) rotateX(0deg) ${base}`]},{duration:kind==='detail'?.36:.5,delay:Math.min(delay,.14),ease});}
    catch{Object.assign(element.style,original);return;}
    const item={...original,control};running.set(element,item);
    control.then(()=>{if(running.get(element)===item)finish(element);}).catch(()=>{if(running.get(element)===item)finish(element);});
  }
  if(typeof win.IntersectionObserver==='function'){
    observer=new win.IntersectionObserver(entries=>{
      let order=0;
      for(const entry of entries){
        if(!entry.isIntersecting)continue;
        const item=pending.get(entry.target);if(item===undefined)continue;
        pending.delete(entry.target);observer.unobserve(entry.target);
        if(revealed.has(item.key))continue;revealed.add(item.key);reveal(entry.target,item.delay+Math.min(order++*.025,.05),item.kind);
      }
    },{threshold:.08,rootMargin:'0px 0px -16px 0px'});
  }
  function refresh(scope=root,{animate:shouldAnimate=true}={}){
    if(disposed)return;
    const nextScene=root.querySelector('.cp-scene');
    if(nextScene!==scene){disposeScene();scene=nextScene;disposeScene=scene?mountScene(scene,{doc,win,reduced,fine}):()=>{};}
    // The app mounts before its first asynchronous render. Do not spend the
    // initial construction on the empty loading shell.
    if(!root.querySelector('[data-reveal]')&&!scene)return;
    const nextKey=`${win.location.pathname}${win.location.hash}`;
    const changed=nextKey!==viewKey;
    if(changed){viewKey=nextKey;settle();revealed.clear();pending.clear();observer?.disconnect();}
    for(const element of running.keys())if(!element.isConnected)finish(element);
    for(const element of pending.keys())if(!element.isConnected){pending.delete(element);observer?.unobserve(element);}
    // Data refreshes and text entry never reconstruct the page around the user.
    // Every route change gets one short construction sequence; lower sections
    // enter once as the user naturally scrolls to them.
    const elements=[...select('[data-reveal]')]
      .filter(element=>!element.parentElement?.closest('[data-reveal]')&&!element.closest('[data-receipt-story]'))
      .flatMap((element,index)=>arrivalLayers(element).map((item,part)=>({...item,key:`${nextKey}:${element.dataset.reveal||index}:${part}`})));
    let order=0;
    elements.forEach(({element,key,delay,kind})=>{
      if(revealed.has(key))return;
      if(element.closest('[hidden],dialog:not([open]),[data-receipt-story]'))return;
      if(!shouldAnimate||reduced.matches||doc.hidden){revealed.add(key);return;}
      const rect=element.getBoundingClientRect();
      if(!rect.width||!rect.height)return;
      if(rect.bottom<=0){revealed.add(key);return;}
      if(rect.top<win.innerHeight-16){revealed.add(key);if(changed)reveal(element,delay+Math.min(order++*.025,.05),kind);}
      else if(observer){pending.set(element,{key,delay,kind});observer.observe(element);}
      else revealed.add(key);
    });
  }
  const interaction=event=>{
    for(const element of running.keys())if(element.contains(event.target))finish(element);
    for(const [element,item] of pending)if(element.contains(event.target)){
      revealed.add(item.key);pending.delete(element);observer?.unobserve(element);
    }
  };
  root.addEventListener('focusin',interaction,{signal});
  root.addEventListener('pointerover',interaction,{signal,passive:true});
  root.addEventListener('pointerdown',interaction,{signal,passive:true});
  root.addEventListener('input',interaction,{signal});
  reduced.addEventListener('change',()=>{settle();if(reduced.matches){observer?.disconnect();pending.clear();}refresh(root,{animate:false});},{signal});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)settle();},{signal});
  win.addEventListener('pagehide',settle,{signal});
  const controller={root,refresh};controllers.add(controller);
  refresh();
  return()=>{
    if(disposed)return;disposed=true;controllers.delete(controller);listeners.abort();
    observer?.disconnect();pending.clear();revealed.clear();settle();disposeScene();scene=null;
  };
}

// Animate sibling layers, never a section and its descendants together. The
// receipt sequence has its own user-controlled timeline and is left alone.
function arrivalLayers(element){
  const part=(node,index=0)=>({element:node,delay:Math.min(index*.045,.09),kind:node.matches('.cp-food-art,[data-dish-source],.cp-scene')?'image':node.matches('h1,h2,h3,p,.cp-service-title,.cp-order-dish-copy,.cp-order-dish-action,.cp-hero-actions,.cp-ai-status,.cp-ai-badge')?'detail':'surface'});
  let children=[];
  if(element.matches('.cp-order-dish'))children=[...element.querySelectorAll(':scope > .cp-food-art,:scope > [data-dish-source],:scope > .cp-food-copy > .cp-order-dish-copy,:scope > .cp-food-copy > .cp-order-dish-action')];
  else if(element.matches('.cp-hero-copy,.cp-page-head,.cp-ai-intro,.cp-order-masthead'))children=[...element.children];
  else if(element.matches('.cp-cost-flow'))children=[...element.querySelectorAll(':scope > .cp-cost-stage')];
  else if(element.querySelector(':scope > .cp-cost-flow'))children=[...element.querySelectorAll(':scope > .cp-service-title,:scope > .cp-cost-flow > .cp-cost-stage,:scope > .cp-note')];
  else if(element.matches('#cp-service'))children=[...element.querySelectorAll('.cp-service-title,.cp-summary,.cp-lane,.cp-aggregate')];
  else if(element.matches('.cp-section,.cp-source-section'))children=[...element.children];
  if(!children.length)return [part(element)];
  return children.filter(node=>!node.matches('script,style,[hidden]')&&!node.closest('[data-receipt-story]')).map(part);
}

/** Call after rendering. Route changes animate; polling may pass {animate:false}. */
export function revealOnChange(root=document,options={}){
  for(const controller of controllers){
    if(controller.root===root||controller.root.contains?.(root)||root.contains?.(controller.root))controller.refresh(root,options);
  }
}

function mountScene(host,{doc,win,reduced,fine}){
  const button=host.querySelector('[data-scene-light]')||host.querySelector('.cp-window');
  const camera=host.querySelector('.cp-camera');
  const landscape=host.querySelector('.cp-landscape');
  const reflection=host.querySelector('.cp-reflection');
  const glass=host.querySelector('.cp-cost-focus,.cp-float-ticket');
  if(!button||!camera||!landscape)return()=>{};
  const listeners=new AbortController(),signal=listeners.signal;
  const layers=[camera,landscape,reflection,glass].filter(Boolean);
  const originals=new Map(layers.map(element=>[element,{transform:element.style.transform,willChange:element.style.willChange}]));
  const state={p:0,x:0,y:0};
  let disposed=false,visible=true,frame=0,lightTimer=0,lightOn=false;
  const active=()=>!disposed&&!doc.hidden&&host.isConnected;
  function paint(){
    if(!active())return;
    if(reduced.matches){for(const layer of layers)layer.style.transform='none';return;}
    const small=win.innerWidth<640,p=state.p;
    camera.style.transform=`rotateX(${p*(small?-1.4:-4)-state.y*.65}deg) rotateY(${p*(small?2:9)+state.x*1.4}deg)`;
    landscape.style.transform=`translate3d(${p*(small?12:30)-state.x*6}px,${-p*(small?16:32)-state.y*4}px,0) scale(${1.12+p*.045})`;
    if(reflection)reflection.style.transform=`translate3d(${p*55+state.x*28}px,${state.y*-12}px,0) rotate(${state.x*2}deg)`;
    if(glass)glass.style.transform=`translate3d(${p*(small?3:9)+state.x*2}px,${-p*(small?5:12)+state.y}px,0) rotate(${-3+p*2}deg)`;
  }
  function updateScroll(){
    frame=0;if(!active()||reduced.matches||!visible)return;
    const box=host.getBoundingClientRect();
    const p=clamp((win.innerHeight*.65-box.top)/(win.innerHeight*.65+box.height),0,1)-.25;
    gsap.to(state,{p,duration:.65,ease:'power3.out',overwrite:'auto',onUpdate:paint});
  }
  function scheduleScroll(){if(!frame&&active())frame=win.requestAnimationFrame(updateScroll);}
  function neutral(){
    if(!active()||reduced.matches){state.x=state.y=0;paint();return;}
    gsap.to(state,{x:0,y:0,duration:.55,ease:'power3.out',overwrite:'auto',onUpdate:paint});
  }
  function setLight(value){
    win.clearTimeout(lightTimer);lightTimer=0;lightOn=value;
    button.dataset.light=value?'on':'off';button.setAttribute('aria-pressed',String(value));
    if(value)lightTimer=win.setTimeout(()=>setLight(false),8000);
  }
  function stop(){
    if(frame){win.cancelAnimationFrame(frame);frame=0;}
    gsap.killTweensOf(state);setLight(false);
  }
  const visibility=typeof win.IntersectionObserver==='function'?new win.IntersectionObserver(entries=>{
    visible=entries[0].isIntersecting;
    for(const layer of layers)layer.style.willChange=visible&&!reduced.matches?'transform':originals.get(layer).willChange;
    if(!visible){gsap.killTweensOf(state);state.x=state.y=0;}
    else scheduleScroll();
  }):null;
  visibility?.observe(host);
  button.addEventListener('pointermove',event=>{
    if(!active()||!visible||reduced.matches||!fine.matches||event.pointerType==='touch')return;
    const rect=button.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const x=clamp((event.clientX-rect.left)/rect.width*2-1,-1,1),y=clamp((event.clientY-rect.top)/rect.height*2-1,-1,1);
    gsap.to(state,{x,y,duration:.6,ease:'power3.out',overwrite:'auto',onUpdate:paint});
  },{signal,passive:true});
  button.addEventListener('pointerleave',neutral,{signal,passive:true});
  button.addEventListener('pointercancel',neutral,{signal,passive:true});
  button.addEventListener('blur',neutral,{signal});
  button.addEventListener('click',()=>setLight(!lightOn),{signal});
  doc.addEventListener('keydown',event=>{if(event.key==='Escape')setLight(false);},{signal});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)stop();else scheduleScroll();},{signal});
  win.addEventListener('pagehide',stop,{signal});
  win.addEventListener('pageshow',scheduleScroll,{signal});
  win.addEventListener('scroll',scheduleScroll,{signal,passive:true});
  win.addEventListener('resize',scheduleScroll,{signal,passive:true});
  reduced.addEventListener('change',()=>{stop();state.x=state.y=0;paint();scheduleScroll();},{signal});
  fine.addEventListener('change',neutral,{signal});
  landscape.addEventListener('load',scheduleScroll,{signal});
  scheduleScroll();
  return()=>{
    if(disposed)return;stop();disposed=true;listeners.abort();visibility?.disconnect();
    for(const [element,styles] of originals)Object.assign(element.style,styles);
  };
}
