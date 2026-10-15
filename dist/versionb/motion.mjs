import {gsap} from 'gsap';
import {ScrollTrigger} from 'gsap/ScrollTrigger';
import {animate} from 'motion';
import Lenis from 'lenis';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

gsap.registerPlugin(ScrollTrigger);
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const finePointer=matchMedia('(hover: hover) and (pointer: fine)');
let observer,sceneCleanup=()=>{},sceneCanvas=null,sceneMode='',choreographyCleanup=()=>{},choreographyRoot=null,lenis=null,clock=null,initialized=false,currentView='';
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
// A closed, folded strip catches light like a physical ribbon. Its open center
// keeps the generated horizon visible; the object never carries business data.
class RibbonCurve extends THREE.Curve {
  getPoint(t,target=new THREE.Vector3()){
    const a=t*Math.PI*2,breath=1+.055*Math.cos(a*3);
    return target.set(Math.cos(a)*1.62*breath,Math.sin(a)*1.28*breath,Math.sin(a*2)*.36);
  }
}
function ribbonGeometry(){
  const curve=new RibbonCurve(),segments=200,frames=curve.computeFrenetFrames(segments,true);
  const positions=[],indices=[],width=.48,thickness=.044;
  for(let i=0;i<=segments;i++){
    const t=i/segments,a=t*Math.PI*2,center=curve.getPoint(t);
    const normal=frames.normals[i].clone().multiplyScalar(Math.cos(a));
    normal.addScaledVector(frames.binormals[i],Math.sin(a));
    const binormal=new THREE.Vector3().crossVectors(frames.tangents[i],normal).normalize();
    const half=width*(.86+.14*Math.sin(a*3))*.5;
    // Four soft faces give the strip an actual edge instead of a flat polygon.
    for(const [u,v] of [[-1,1],[1,1],[1,-1],[-1,-1]]){
      const point=center.clone().addScaledVector(normal,u*half).addScaledVector(binormal,v*thickness);
      positions.push(point.x,point.y,point.z);
    }
    if(i<segments)for(let side=0;side<4;side++){
      const next=(side+1)%4,k=i*4+side,j=i*4+next;
      indices.push(k,k+4,j,j,k+4,j+4);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function atmosphereMaterial(){
  return new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,uniforms:{uLight:{value:.5}},
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec2 vUv;uniform float uLight;void main(){
      vec2 p=(vUv-.5)*vec2(1.0,1.18);float halo=exp(-dot(p,p)*9.0);
      float arc=exp(-pow(length(p+vec2(.12,-.07))-.31,2.0)*210.0);
      vec3 tint=mix(vec3(.77,.88,.72),vec3(.30,.66,.50),uLight);
      gl_FragColor=vec4(tint,halo*.09+arc*.045);
    }`
  });
}
function enhanceScene(canvas){
  if(!canvas)return()=>{};
  const host=canvas.parentElement;
  host.classList.remove('is-rendered');
  // A quiet CSS sculpture is the equivalent experience for reduced motion.
  if(motionPreference.matches){host.dataset.sceneState='static';return()=>{};}
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:finePointer.matches,powerPreference:'low-power'});}
  catch{host.dataset.sceneState='fallback';return()=>{};}
  canvas.dataset.enhanced='true';host.dataset.sceneState='loading';
  renderer.setPixelRatio(Math.min(devicePixelRatio,finePointer.matches?1.5:1));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.1,25);
  camera.position.set(0,.08,7.25);
  // A small generated studio environment gives the ribbon broad reflections
  // without another network image, canvas or WebGL context.
  let environmentTarget=null;
  const studio=new RoomEnvironment(),reflection=new THREE.PMREMGenerator(renderer);
  try{environmentTarget=reflection.fromScene(studio,.06,.1,100,{size:finePointer.matches?128:64});scene.environment=environmentTarget.texture;scene.environmentIntensity=.62;}catch{}
  finally{studio.dispose();reflection.dispose();}
  const garden=new THREE.Group();garden.rotation.set(.38,-.16,-.26);scene.add(garden);
  const ribbonMaterial=new THREE.MeshPhysicalMaterial({
    color:0x11805a,roughness:.22,metalness:.37,clearcoat:1,clearcoatRoughness:.13,
    iridescence:.14,iridescenceIOR:1.22,iridescenceThicknessRange:[100,220]
  });
  const ribbon=new THREE.Mesh(ribbonGeometry(),ribbonMaterial);garden.add(ribbon);
  const orbitMaterial=new THREE.MeshStandardMaterial({color:0xbac7a3,metalness:.58,roughness:.27,transparent:true,opacity:.65});
  const orbit=new THREE.Mesh(new THREE.TorusGeometry(2.03,.009,6,160),orbitMaterial);
  orbit.rotation.set(.65,.12,-.08);garden.add(orbit);
  const smallOrbit=new THREE.Mesh(new THREE.TorusGeometry(1.9,.007,6,144),orbitMaterial);
  smallOrbit.rotation.set(-.58,.53,.2);garden.add(smallOrbit);
  const dustPositions=new Float32Array(30*3);
  for(let i=0;i<30;i++){
    const a=i*2.399963,r=1.94+(i%5)*.048;
    dustPositions[i*3]=Math.cos(a)*r;dustPositions[i*3+1]=Math.sin(a)*r*.8;dustPositions[i*3+2]=Math.sin(a*2)*.6;
  }
  const dustGeometry=new THREE.BufferGeometry();dustGeometry.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));
  const dust=new THREE.Points(dustGeometry,new THREE.PointsMaterial({size:.018,color:0x7eab85,transparent:true,opacity:.52,sizeAttenuation:true}));garden.add(dust);
  const atmosphere=new THREE.Mesh(new THREE.PlaneGeometry(6.1,5.5),atmosphereMaterial());
  atmosphere.position.z=-1.25;scene.add(atmosphere);
  scene.add(new THREE.HemisphereLight(0xf8fff0,0x174130,3.1));
  const key=new THREE.DirectionalLight(0xeaf6da,5.4);key.position.set(3.5,4.5,4);scene.add(key);
  const rim=new THREE.DirectionalLight(0x5ddb9f,3.2);rim.position.set(-4,.8,-1);scene.add(rim);
  const pearl=new THREE.PointLight(0xffeed3,11,11);pearl.position.set(.6,-2,4);scene.add(pearl);
  let targetX=0,targetY=0,pointerX=0,pointerY=0,frame=0,visible=true,disposed=false,contextUnavailable=false;
  let entranceStart=performance.now(),entranceFinished=false,scrollProgress=0;
  const base={x:.38,y:-.16,z:-.26};
  const fallback=()=>{contextUnavailable=true;host.dataset.sceneState='fallback';host.classList.remove('is-rendered');cancelAnimationFrame(frame);frame=0;};
  const render=()=>{
    if(disposed||contextUnavailable||!visible||document.hidden)return;
    try{renderer.render(scene,camera);}catch{fallback();}
  };
  const present=now=>{
    const entrance=entranceFinished?1:Math.min(1,(now-entranceStart)/1500);
    const eased=1-Math.pow(1-entrance,3);
    if(entrance===1)entranceFinished=true;
    garden.rotation.set(base.x+pointerY+scrollProgress*.14,base.y+pointerX+scrollProgress*.22,base.z+(1-eased)*.09+scrollProgress*.12);
    garden.position.y=(1-eased)*.12-scrollProgress*.08;
    garden.position.z=scrollProgress*.34;
    camera.position.z=7.25-scrollProgress*.28;
    atmosphere.material.uniforms.uLight.value=.35+scrollProgress*.35+pointerX*.2;
    render();
  };
  const loop=now=>{
    frame=0;if(disposed||contextUnavailable||!visible||document.hidden||motionPreference.matches)return;
    pointerX+=(targetX-pointerX)*.065;pointerY+=(targetY-pointerY)*.065;present(now);
    // No idle loop: only entrance, pointer settling and scroll input render.
    if(!entranceFinished||Math.abs(targetX-pointerX)+Math.abs(targetY-pointerY)>.00015)frame=requestAnimationFrame(loop);
  };
  const wake=()=>{if(!frame&&!disposed&&!contextUnavailable&&visible&&!document.hidden&&!motionPreference.matches)frame=requestAnimationFrame(loop);};
  const resize=new ResizeObserver(()=>{
    const box=host.getBoundingClientRect(),width=Math.max(1,box.width),height=Math.max(1,box.height);
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    // Keep the open sculpture inside very narrow or wide responsive hosts.
    garden.scale.setScalar(camera.aspect<.75?.86:1);present(performance.now());
  });resize.observe(host);
  const viewObserver=new IntersectionObserver(entries=>{
    visible=entries[0].isIntersecting;
    if(!visible){cancelAnimationFrame(frame);frame=0;}else{present(performance.now());wake();}
  },{threshold:.01});viewObserver.observe(host);
  const pointer=event=>{
    if(!finePointer.matches||motionPreference.matches)return;
    const rect=host.getBoundingClientRect();if(!rect.width||!rect.height)return;
    targetX=THREE.MathUtils.clamp((event.clientX-rect.left)/rect.width-.5,-.5,.5)*.32;
    targetY=THREE.MathUtils.clamp((event.clientY-rect.top)/rect.height-.5,-.5,.5)*.19;wake();
  };
  const leave=()=>{targetX=targetY=0;wake();};
  host.addEventListener('pointermove',pointer,{passive:true});host.addEventListener('pointerleave',leave,{passive:true});
  const visibility=()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else{present(performance.now());wake();}};
  document.addEventListener('visibilitychange',visibility);
  const trigger=ScrollTrigger.create({
    trigger:host.closest('.hero-scene')||host,start:'top top',end:'bottom top',
    onUpdate:self=>{scrollProgress=self.progress;present(performance.now());}
  });
  const contextLost=event=>{event.preventDefault();fallback();};
  const contextRestored=()=>{
    if(disposed)return;contextUnavailable=false;host.dataset.sceneState='ready';host.classList.add('is-rendered');present(performance.now());wake();
  };
  canvas.addEventListener('webglcontextlost',contextLost);canvas.addEventListener('webglcontextrestored',contextRestored);
  present(performance.now());
  if(!contextUnavailable){host.classList.add('is-rendered');host.dataset.sceneState='ready';wake();}
  return()=>{
    disposed=true;cancelAnimationFrame(frame);trigger.kill();resize.disconnect();viewObserver.disconnect();
    document.removeEventListener('visibilitychange',visibility);host.removeEventListener('pointermove',pointer);host.removeEventListener('pointerleave',leave);
    canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',contextRestored);
    const geometries=new Set(),materials=new Set();
    scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>materials.add(material));});
    geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());
    environmentTarget?.dispose();renderer.dispose();
    // Preference changes rebuild on the same connected canvas. Its context
    // must stay usable; detached view canvases can release the context fully.
    if(!canvas.isConnected)renderer.forceContextLoss();
    host.classList.remove('is-rendered');
  };
}
function enhanceChoreography(root){
  if(!root||motionPreference.matches)return()=>{};
  // Text is readable in the very first frame. Scroll changes its spatial
  // relation to the horizon instead of controlling whether it is visible.
  const depth=finePointer.matches?1:.22;
  const context=gsap.context(()=>{
    const hero=root.querySelector('.hero-scene');
    if(hero){
      const passage=gsap.timeline({scrollTrigger:{trigger:hero,start:'top top',end:'bottom top',scrub:.65}});
      const horizon=hero.querySelector('.hero-horizon'),art=hero.querySelector('.hero-art'),lines=hero.querySelectorAll('.hero-line');
      if(horizon)passage.to(horizon,{yPercent:10*depth,scale:1+.045*depth,ease:'none'},0);
      if(art)passage.to(art,{y:-52*depth,z:-80*depth,rotationZ:3*depth,scale:1-.045*depth,ease:'none'},0);
      if(lines.length)passage.to(lines,{y:index=>-(10+index*6)*depth,ease:'none',stagger:.025},0);
    }
    root.querySelectorAll('[data-cinematic-step]').forEach((chapter,index)=>{
      const timeline=gsap.timeline({scrollTrigger:{trigger:chapter,start:'top 94%',end:'top 38%',scrub:.75}});
      const direction=index%2===0?1:-1,copy=chapter.querySelector('.chapter-copy'),visual=chapter.querySelector('.chapter-visual');
      if(copy)timeline.fromTo(copy,{x:-26*direction*depth,y:18*depth,rotationY:1.4*direction*depth},{x:0,y:0,rotationY:0,duration:1,ease:'power2.out',immediateRender:false},0);
      if(visual)timeline.fromTo(visual,{x:30*direction*depth,y:30*depth,z:-55*depth,scale:1-.035*depth,rotationY:-2*direction*depth},{x:0,y:0,z:0,scale:1,rotationY:0,duration:1,ease:'power2.out',immediateRender:false},.07);
    });
    root.querySelectorAll('[data-cinematic-reveal]').forEach(element=>{
      if(element.closest('.hero-copy,.hero-art,.chapter-copy,.chapter-visual'))return;
      gsap.fromTo(element,{y:20*depth,scale:1-.014*depth},{y:0,scale:1,ease:'power2.out',immediateRender:false,scrollTrigger:{trigger:element,start:'top 96%',end:'top 73%',scrub:.6}});
    });
  },root);
  return()=>context.revert();
}
export function initMotion(){
  if(initialized)return;initialized=true;
  const listeners=new AbortController(),signal=listeners.signal;
  let choreographyHero=null,choreographyMode='';
  const ensureScene=()=>{
    const next=document.getElementById('studio-canvas');
    const mode=`${motionPreference.matches}:${finePointer.matches}`;
    if(next===sceneCanvas&&mode===sceneMode)return;
    sceneCleanup();sceneCanvas=next;sceneMode=mode;sceneCleanup=enhanceScene(next);
  };
  const ensureChoreography=()=>{
    const next=document.querySelector('.journey-scene')?.closest('#view')||document.querySelector('.hero-scene')?.closest('#view')||null;
    const nextHero=next?.querySelector('.hero-scene')||null;
    if(next===choreographyRoot&&nextHero===choreographyHero&&sceneMode===choreographyMode)return;
    choreographyCleanup();choreographyRoot=next;choreographyHero=nextHero;choreographyMode=sceneMode;choreographyCleanup=enhanceChoreography(next);
  };
  const stopScroll=()=>{if(clock)cancelAnimationFrame(clock);clock=null;lenis?.destroy();lenis=null;};
  const syncScroll=()=>{
    stopScroll();
    // Overview camera only. Touch, hidden pages, reduced motion and every form
    // view use native scrolling. The clock wakes on input and stops at rest.
    if(currentView!=='overview'||motionPreference.matches||!finePointer.matches||document.hidden)return;
    lenis=new Lenis({lerp:.055,smoothWheel:true,syncTouch:false,allowNestedScroll:true,prevent:node=>Boolean(node.closest?.('dialog,form,textarea,input,select,[contenteditable],[data-native-scroll]'))});
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
    ensureScene();ensureChoreography();
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
  document.addEventListener('soi:view',event=>{currentView=event.detail?.view||'';ensureScene();ensureChoreography();syncScroll();ScrollTrigger.refresh();},{signal});
  motionPreference.addEventListener('change',()=>{if(motionPreference.matches){for(const element of animations.keys())finish(element);pressed.clear();}ensureScene();ensureChoreography();syncScroll();},{signal});
  finePointer.addEventListener('change',()=>{ensureScene();ensureChoreography();syncScroll();},{signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){for(const element of animations.keys())finish(element);pressed.clear();}syncScroll();},{signal});
  ensureScene();ensureChoreography();
  window.addEventListener('pagehide',event=>{
    if(event.persisted){stopScroll();for(const element of animations.keys())finish(element);pressed.clear();return;}
    initialized=false;listeners.abort();sceneCleanup();sceneCanvas=null;sceneMode='';choreographyCleanup();choreographyRoot=null;observer.disconnect();stopScroll();for(const element of animations.keys())finish(element);pressed.clear();
  },{signal});
  window.addEventListener('pageshow',event=>{if(event.persisted){ensureScene();ensureChoreography();syncScroll();ScrollTrigger.refresh();}},{signal});
}
