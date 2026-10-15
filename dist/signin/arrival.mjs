/** The destination reveals only after the workspace's first render is ready. */
export function createPortalArrival(doc=document){
  const root=doc.documentElement,win=doc.defaultView;
  if(!root.hasAttribute('data-portal-arrival'))return{ready(){}};
  const listeners=new AbortController();
  let timer=win.setTimeout(clear,2600),finished=false;
  function clear(){
    if(finished)return;
    finished=true;win.clearTimeout(timer);root.removeAttribute('data-portal-arrival');listeners.abort();
  }
  doc.addEventListener('pointerdown',clear,{signal:listeners.signal,passive:true});
  doc.addEventListener('keydown',clear,{signal:listeners.signal});
  win.addEventListener('pagehide',clear,{signal:listeners.signal});
  return{ready(){
    if(finished)return;
    root.dataset.portalArrival='ready';
    win.clearTimeout(timer);timer=win.setTimeout(clear,850);
  }};
}
