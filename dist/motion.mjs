import {gsap} from 'gsap';
import {ScrollTrigger} from 'gsap/ScrollTrigger';
import {animate} from 'motion';
import Lenis from 'lenis';
import * as THREE from 'three';

gsap.registerPlugin(ScrollTrigger);
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const finePointer=matchMedia('(hover: hover) and (pointer: fine)');
let observer,sceneCleanup=()=>{},sceneCanvas=null,lenis=null,clock=null,initialized=false,currentView='';
const animations=new Map();
// Keep inputs live: all transitions start immediately, with critically damped
// springs and no overshoot. Motion owns control/view transforms; GSAP owns the
// overview camera only. No animation is attached to editable values.
const settle={type:'spring',stiffness:280,damping:34,mass:1};
const pressSettle={type:'spring',stiffness:500,damping:45,mass:1};
const opacitySettle={type:'tween',duration:.2,ease:[.22,.61,.36,1]};
const controlsSelector='.button,.text-button,.icon-button,.import-file-label,.nav-item,.draft-tabs button,.workflow-list button,[data-motion-press]';
const revealSelector='.receipt-preview,[data-motion-reveal]';
const revealed=new WeakSet();
const revealedMessages=new Set();
const pressed=new Map();

function restore(element,styles){
  element.style.transform=styles.transform;
  element.style.opacity=styles.opacity;
  element.style.willChange=styles.willChange;
}
function finish(element){
  const record=animations.get(element);if(!record)return;
  // A node may already be detached or a native dialog already closed.
  try{record.controls.stop();}catch{}
  animations.delete(element);restore(element,record.styles);
}
function glide(element,values,options=settle,hold=false){
  if(!element?.isConnected||motionPreference.matches||document.hidden)return;
  const previous=animations.get(element),styles=previous?.styles||{transform:element.style.transform,opacity:element.style.opacity,willChange:element.style.willChange};
  // stop() commits the current presentation state rather than reverting it.
  // Re-targeting the same Motion element therefore does not jump to its start.
  try{previous?.controls.stop();}catch{}
  element.style.willChange='transform,opacity';
  let controls;
  try{controls=animate(element,values,{...options,opacity:opacitySettle});}
  catch{animations.delete(element);restore(element,styles);return;}
  const record={controls,styles};animations.set(element,record);
  controls.then(()=>{if(animations.get(element)!==record||hold)return;animations.delete(element);restore(element,styles);});
}
export function animateView(container){
  if(!container)return;
  if(motionPreference.matches){finish(container);return;}
  // Content remains almost fully visible from the first frame. A refresh during
  // a transition settles from its current value instead of replaying the entry.
  glide(container,animations.has(container)?{y:0,opacity:1}:{y:[8,0],opacity:[.94,1]});
}
function enhanceScene(canvas){
  if(!canvas)return()=>{};
  canvas.dataset.enhanced='true';
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});}catch{return()=>{};}
  const host=canvas.parentElement;
  host.dataset.sceneState='loading';
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(33,1,.1,30);camera.position.set(0,.1,7.3);
  const group=new THREE.Group();scene.add(group);
  const material=new THREE.MeshPhysicalMaterial({color:0x18775d,roughness:.25,metalness:.12,transmission:.18,thickness:.7,clearcoat:1,clearcoatRoughness:.15});
  const form=new THREE.Mesh(new THREE.TorusKnotGeometry(.88,.28,112,20,2,3),material);form.rotation.set(.5,.3,-.4);group.add(form);
  const wire=new THREE.Mesh(new THREE.TorusGeometry(1.62,.018,8,96),new THREE.MeshStandardMaterial({color:0x7ea88f,roughness:.6,metalness:.35}));wire.rotation.set(1.0,.35,-.45);group.add(wire);
  const dustPositions=new Float32Array(24*3);
  for(let i=0;i<24;i++){const angle=i*2.39996;dustPositions[i*3]=Math.cos(angle)*(1.85+i%3*.12);dustPositions[i*3+1]=Math.sin(angle)*(1.4+i%2*.2);dustPositions[i*3+2]=Math.sin(angle*2)*.5;}
  const dustGeometry=new THREE.BufferGeometry();dustGeometry.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));
  const dust=new THREE.Points(dustGeometry,new THREE.PointsMaterial({size:.024,color:0x8fac99,transparent:true,opacity:.5}));group.add(dust);
  scene.add(new THREE.HemisphereLight(0xeaf6ec,0x284338,3.0));
  const key=new THREE.DirectionalLight(0xd1f0d7,5);key.position.set(3,4,5);scene.add(key);
  const edge=new THREE.PointLight(0x69b48e,10,12);edge.position.set(-3,-1,3);scene.add(edge);
  let targetX=0,targetY=0,frame=0,visible=true,disposed=false,contextUnavailable=false;
  const render=()=>{if(disposed||contextUnavailable||!visible||document.hidden)return;renderer.render(scene,camera);};
  const loop=()=>{
    frame=0;if(disposed||contextUnavailable||!visible||document.hidden||motionPreference.matches)return;
    group.rotation.y+=(targetX-group.rotation.y)*.035;group.rotation.x+=(targetY-group.rotation.x)*.035;render();
    if(Math.abs(targetX-group.rotation.y)+Math.abs(targetY-group.rotation.x)>.0001)frame=requestAnimationFrame(loop);
  };
  const wake=()=>{if(!frame&&!disposed&&!contextUnavailable&&visible&&!document.hidden&&!motionPreference.matches)frame=requestAnimationFrame(loop);};
  const resize=new ResizeObserver(()=>{const box=host.getBoundingClientRect();renderer.setSize(Math.max(1,box.width),Math.max(1,box.height),false);camera.aspect=Math.max(1,box.width)/Math.max(1,box.height);camera.updateProjectionMatrix();render();});resize.observe(host);
  const viewObserver=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible){cancelAnimationFrame(frame);frame=0;}else{render();wake();}},{threshold:.01});viewObserver.observe(host);
  const pointer=e=>{if(!finePointer.matches||motionPreference.matches)return;const rect=host.getBoundingClientRect();targetX=((e.clientX-rect.left)/rect.width-.5)*.3;targetY=((e.clientY-rect.top)/rect.height-.5)*.18;wake();};
  const leave=()=>{targetX=targetY=0;wake();};
  host.addEventListener('pointermove',pointer);host.addEventListener('pointerleave',leave);
  const visibility=()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else wake();};document.addEventListener('visibilitychange',visibility);
  let trigger=null;
  const refresh=()=>{
    trigger?.kill();trigger=null;cancelAnimationFrame(frame);frame=0;
    if(!motionPreference.matches){trigger=ScrollTrigger.create({trigger:host,start:'top 85%',end:'bottom top',onUpdate:self=>{group.position.z=self.progress*.22;form.rotation.z=-.4+self.progress*.14;render();}});wake();}else render();
  };motionPreference.addEventListener('change',refresh);refresh();
  const contextLost=e=>{e.preventDefault();contextUnavailable=true;host.dataset.sceneState='fallback';host.classList.remove('is-rendered');cancelAnimationFrame(frame);frame=0;};
  canvas.addEventListener('webglcontextlost',contextLost);
  render();host.classList.add('is-rendered');host.dataset.sceneState='ready';
  return()=>{disposed=true;cancelAnimationFrame(frame);trigger?.kill();resize.disconnect();viewObserver.disconnect();motionPreference.removeEventListener('change',refresh);document.removeEventListener('visibilitychange',visibility);host.removeEventListener('pointermove',pointer);host.removeEventListener('pointerleave',leave);canvas.removeEventListener('webglcontextlost',contextLost);scene.traverse(object=>{object.geometry?.dispose();if(object.material){const values=Array.isArray(object.material)?object.material:[object.material];values.forEach(m=>m.dispose());}});renderer.dispose();};
}
export function initMotion(){
  if(initialized)return;initialized=true;
  const listeners=new AbortController(),signal=listeners.signal;
  const ensureScene=()=>{
    const next=document.getElementById('studio-canvas');
    if(next===sceneCanvas)return;
    sceneCleanup();sceneCanvas=next;sceneCleanup=enhanceScene(next);
  };
  const stopScroll=()=>{if(clock)cancelAnimationFrame(clock);clock=null;lenis?.destroy();lenis=null;};
  const syncScroll=()=>{
    stopScroll();
    // Overview camera only. Touch, hidden pages, reduced motion and every form
    // view use native scrolling. The clock wakes on input and stops at rest.
    if(currentView!=='overview'||motionPreference.matches||!finePointer.matches||document.hidden)return;
    lenis=new Lenis({lerp:.08,smoothWheel:true,syncTouch:false,allowNestedScroll:true,prevent:node=>Boolean(node.closest?.('dialog,form,textarea,input,select'))});
    const tick=time=>{clock=null;if(!lenis||document.hidden)return;lenis.raf(time);if(!clock&&lenis.isScrolling==='smooth')clock=requestAnimationFrame(tick);};
    const wake=()=>{if(!clock&&lenis&&!document.hidden)clock=requestAnimationFrame(tick);};
    lenis.raf(performance.now());lenis.on('virtual-scroll',wake);lenis.on('scroll',()=>{ScrollTrigger.update();if(lenis?.isScrolling==='smooth')wake();});
  };
  const reveal=element=>{
    if(revealed.has(element)||element.hidden||element.closest('[hidden]'))return;
    revealed.add(element);
    const key=element.dataset.motionKey;
    if(key){if(revealedMessages.has(key))return;revealedMessages.add(key);if(revealedMessages.size>256)revealedMessages.delete(revealedMessages.values().next().value);}
    glide(element,{y:[5,0],scale:[.994,1],opacity:[.96,1]});
  };
  observer=new MutationObserver(records=>{
    ensureScene();
    for(const element of animations.keys())if(!element.isConnected)finish(element);
    for(const [key,element] of pressed)if(!element.isConnected)pressed.delete(key);
    for(const record of records){
      if(record.type==='attributes'){
        const element=record.target;
        if(record.attributeName==='aria-selected'&&element.matches('.draft-tabs button[aria-selected="true"]'))glide(element,{scale:[.985,1]},pressSettle);
        if(record.attributeName==='hidden'&&!element.hidden&&element.matches('.ocr-review,[data-motion-reveal]'))reveal(element);
        if(record.attributeName==='open'&&element.matches('dialog[open]'))glide(element,{y:[6,0],scale:[.994,1],opacity:[.96,1]});
        if(record.attributeName==='open'&&element.matches('dialog:not([open])'))finish(element);
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
  const down=(key,element)=>{if(!element||element.matches(':disabled,[aria-disabled="true"]'))return;pressed.set(key,element);glide(element,{scale:.984},pressSettle,true);};
  const up=key=>{const element=pressed.get(key);pressed.delete(key);if(element?.isConnected)glide(element,{scale:1},pressSettle);};
  document.addEventListener('pointerdown',event=>{if(event.isPrimary&&event.button===0)down(event.pointerId,control(event));},{signal,passive:true});
  document.addEventListener('pointerup',event=>up(event.pointerId),{signal,passive:true});
  document.addEventListener('pointercancel',event=>up(event.pointerId),{signal,passive:true});
  document.addEventListener('keydown',event=>{if(!event.repeat&&(event.key===' '||event.key==='Enter'))down('keyboard',control(event));},{signal});
  document.addEventListener('keyup',event=>{if(event.key===' '||event.key==='Enter')up('keyboard');},{signal});
  window.addEventListener('blur',()=>{for(const key of pressed.keys())up(key);},{signal});
  document.addEventListener('soi:view',event=>{currentView=event.detail?.view||'';ensureScene();syncScroll();ScrollTrigger.refresh();},{signal});
  motionPreference.addEventListener('change',()=>{if(motionPreference.matches){for(const element of animations.keys())finish(element);pressed.clear();}syncScroll();},{signal});
  finePointer.addEventListener('change',syncScroll,{signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){for(const element of animations.keys())finish(element);pressed.clear();}syncScroll();},{signal});
  ensureScene();
  window.addEventListener('pagehide',event=>{
    if(event.persisted){stopScroll();for(const element of animations.keys())finish(element);pressed.clear();return;}
    initialized=false;listeners.abort();sceneCleanup();sceneCanvas=null;observer.disconnect();stopScroll();for(const element of animations.keys())finish(element);pressed.clear();
  },{signal});
  window.addEventListener('pageshow',event=>{if(event.persisted){ensureScene();syncScroll();ScrollTrigger.refresh();}},{signal});
}
