import {animate} from 'motion';

const steps=Object.freeze(['receipt','ingredient','plate']);
const ease=[.22,.61,.36,1];

/**
 * A user-triggered explanation of already-visible demo evidence. It never runs
 * inference, changes receipt confirmation, or makes accounting data available.
 * All content stays readable when animation fails or this controller is absent.
 */
export function mountReceiptStory(root,{animateElement=animate}={}){
  const host=root.matches?.('[data-receipt-story]')?root:root.querySelector('[data-receipt-story]');
  if(!host)return()=>{};
  const doc=host.ownerDocument,win=doc.defaultView;
  const controls=host.querySelector('[data-story-controls]'),play=host.querySelector('[data-story-play]');
  const playLabel=host.querySelector('[data-story-play-label]'),status=host.querySelector('[data-story-status]');
  const buttons=[...host.querySelectorAll('[data-story-step-button]')];
  const targets=new Map([...host.querySelectorAll('[data-story-target]')].map(element=>[element.dataset.storyTarget,element]));
  if(!controls||!play||!status||targets.size!==steps.length)return()=>{};
  const reduced=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const listeners=new AbortController(),running=new Map(),timers=new Set();
  const originalLabel=playLabel?.textContent,originalStatus=status.textContent;
  const initiallyHidden=controls.hidden;
  let disposed=false,generation=0;

  function finish(element){
    const record=running.get(element);if(!record)return;
    running.delete(element);
    record.control?.stop?.();
    Object.assign(element.style,record.original);
  }
  function stop(){
    generation++;
    for(const timer of timers)win.clearTimeout(timer);
    timers.clear();
    for(const element of [...running.keys()])finish(element);
    host.removeAttribute('data-story-running');
  }
  function motion(element,keyframes,options={}){
    if(disposed||reduced?.matches||doc.hidden||!element?.isConnected)return;
    finish(element);
    const original={transform:element.style.transform,opacity:element.style.opacity,willChange:element.style.willChange};
    element.style.willChange='transform, opacity';
    try{
      const control=animateElement(element,keyframes,{duration:.62,ease,...options});
      const record={control,original};running.set(element,record);
      Promise.resolve(control).then(()=>{if(running.get(element)===record)finish(element);},()=>{if(running.get(element)===record)finish(element);});
    }catch{Object.assign(element.style,original);}
  }
  function setStep(step,{moving=true,announce=true}={}){
    for(const element of [...running.keys()])finish(element);
    host.dataset.storyStep=step;
    for(const button of buttons){
      if(button.dataset.storyStepButton===step)button.setAttribute('aria-current','step');
      else button.removeAttribute('aria-current');
    }
    for(const [key,element] of targets){
      if(key===step)element.setAttribute('data-story-active','');
      else element.removeAttribute('data-story-active');
    }
    const current=buttons.find(button=>button.dataset.storyStepButton===step);
    if(announce)status.textContent=current?.dataset.storyAnnouncement||status.dataset.storyComplete;
    const target=targets.get(step);
    if(!moving||!target)return;
    const frames=step==='receipt'
      ?{transform:['translate3d(0,10px,0) rotate(-2.8deg)','translate3d(0,0,0) rotate(-1.5deg)']}
      :step==='plate'
        ?{transform:['perspective(900px) translate3d(0,12px,0) rotateY(-2deg)','perspective(900px) translate3d(0,0,0) rotateY(0deg)'],opacity:[.88,1]}
        :{transform:['translate3d(-10px,0,0)','translate3d(0,0,0)'],opacity:[.9,1]};
    motion(target,frames);
    const sheen=target.querySelector('[data-story-sheen]');
    if(sheen)motion(sheen,{transform:['translateX(-115%)','translateX(115%)'],opacity:[0,.72,0]},{duration:1.05});
  }
  function showAll({announce=true}={}){stop();setStep('all',{moving:false,announce});}
  function playSequence(){
    if(disposed)return;
    stop();
    if(playLabel)playLabel.textContent=play.dataset.storyReplay||originalLabel;
    if(reduced?.matches||doc.hidden||!host.isConnected){showAll();return;}
    const current=generation;
    host.dataset.storyRunning='true';
    setStep('receipt');
    for(const [delay,step] of [[1300,'ingredient'],[2700,'plate'],[4400,'all']]){
      const timer=win.setTimeout(()=>{
        timers.delete(timer);
        if(disposed||current!==generation)return;
        if(doc.hidden||!host.isConnected||reduced?.matches){showAll({announce:false});return;}
        if(step==='all')showAll();else setStep(step);
      },delay);
      timers.add(timer);
    }
  }
  function click(event){
    if(disposed)return;
    const button=event.target.closest?.('button');
    if(!button||!controls.contains(button))return;
    if(button.hasAttribute('data-story-play'))playSequence();
    else if(button.hasAttribute('data-story-all'))showAll();
    else if(steps.includes(button.dataset.storyStepButton)){
      stop();setStep(button.dataset.storyStepButton,{moving:!reduced?.matches});
    }
  }
  const interrupt=event=>{if(!controls.contains(event.target))showAll({announce:false});};
  const hidden=()=>{if(doc.hidden)showAll({announce:false});};
  const motionChange=()=>{if(reduced?.matches)showAll({announce:false});};
  controls.hidden=false;
  host.addEventListener('click',click,{signal:listeners.signal});
  host.addEventListener('focusin',interrupt,{signal:listeners.signal});
  host.addEventListener('pointerdown',interrupt,{signal:listeners.signal,passive:true});
  host.addEventListener('input',interrupt,{signal:listeners.signal});
  doc.addEventListener('visibilitychange',hidden,{signal:listeners.signal});
  win.addEventListener('pagehide',()=>showAll({announce:false}),{signal:listeners.signal});
  reduced?.addEventListener?.('change',motionChange,{signal:listeners.signal});
  return()=>{
    if(disposed)return;
    showAll({announce:false});disposed=true;listeners.abort();
    controls.hidden=initiallyHidden;
    if(playLabel)playLabel.textContent=originalLabel;
    status.textContent=originalStatus;
  };
}
