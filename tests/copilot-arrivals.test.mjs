import test from 'node:test';
import assert from 'node:assert/strict';
import {mountMotion,revealOnChange} from '../dist/copilot/motion.mjs';

// A DOM-contract fixture checks entry/interaction lifecycle without pretending
// to validate layout or animation frames in a browser.
class Node extends EventTarget {
  constructor({tag='DIV',classes=[],reveal=false,story=false,source=false,top=100,children=[]}={}) {
    super();Object.assign(this,{tagName:tag,classes,reveal,story,source,top,children,isConnected:true,hidden:false,dataset:{},style:{transform:'',opacity:'',willChange:''}});
    for(const child of children)child.parentElement=this;
  }
  matches(selector) {
    return selector.split(',').some(value=>{
      value=value.trim();
      if(value==='[data-reveal]')return this.reveal;
      if(value==='[data-receipt-story]')return this.story;
      if(value==='[data-dish-source]')return this.source;
      if(value.startsWith('.'))return this.classes.includes(value.slice(1));
      return value.toUpperCase()===this.tagName;
    });
  }
  contains(node) {return node===this||this.children.some(child=>child.contains(node));}
  closest(selector) {return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  querySelector(selector) {return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector) {
    if(selector.startsWith(':scope >'))return selector.split(',').flatMap(branch=>branch.replace(':scope > ','').split(' > ').reduce((parents,match)=>parents.flatMap(parent=>parent.children.filter(child=>child.matches(match))),[this]));
    return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);
  }
  getBoundingClientRect() {return {top:this.top,bottom:this.top+100,width:300,height:100};}
}

function fixture(nodes,{reduced=false}={}) {
  const doc=new EventTarget(),win=new EventTarget(),root=new Node({children:nodes}),media=new EventTarget(),fine=new EventTarget();
  media.matches=reduced;fine.matches=true;
  Object.assign(win,{location:{pathname:'/copilot/demo',hash:'#intelligence'},innerHeight:800,innerWidth:1200,
    matchMedia:query=>query.includes('reduced-motion')?media:fine,
    getComputedStyle:()=>({transform:'none',opacity:'1'})});
  Object.assign(doc,{defaultView:win,hidden:false,body:new Node(),activeElement:null});root.ownerDocument=doc;
  const observers=[];
  win.IntersectionObserver=class {
    constructor(callback){this.callback=callback;this.observed=new Set();observers.push(this);}
    observe(node){this.observed.add(node);}
    unobserve(node){this.observed.delete(node);}
    disconnect(){this.observed.clear();}
    show(node){this.callback([{target:node,isIntersecting:true}]);}
  };
  const calls=[];
  const animate=(element,values,options)=>{
    const record={element,values,options,stopped:false};calls.push(record);
    element.style.transform=values.transform[0];element.style.opacity=String(values.opacity[0]);
    const promise=new Promise(()=>{});promise.stop=()=>{record.stopped=true;};return promise;
  };
  const dispose=mountMotion(root,{animate});
  const interact=(target,type='focusin')=>{
    const event=new Event(type);Object.defineProperty(event,'target',{value:target});root.dispatchEvent(event);
  };
  return {root,doc,win,media,calls,observers,dispose,interact};
}

test('copilot constructs sibling layers once per route and never on a data refresh',()=>{
  const heading=new Node({tag:'H1'}),copy=new Node({tag:'P'}),actions=new Node({classes:['cp-hero-actions']});
  const hero=new Node({classes:['cp-hero-copy'],reveal:true,children:[heading,copy,actions]});
  const f=fixture([hero]);
  assert.deepEqual(f.calls.map(call=>call.element),[heading,copy,actions]);
  assert.ok(f.calls[0].options.delay<f.calls[1].options.delay);
  assert.ok(f.calls[1].options.delay<f.calls[2].options.delay);
  assert.ok(f.calls.every(call=>call.options.delay<=.14));
  revealOnChange(f.root);revealOnChange(f.root,{animate:false});
  assert.equal(f.calls.length,3);
  f.win.location.hash='#service';revealOnChange(f.root);
  assert.equal(f.calls.length,6);
  assert.ok(f.calls.slice(0,3).every(call=>call.stopped));
  f.dispose();
  assert.ok(f.calls.every(call=>call.stopped));
  for(const node of [heading,copy,actions])assert.deepEqual(node.style,{transform:'',opacity:'',willChange:''});
});

test('keyboard focus settles queued and active arrivals before controls can move',()=>{
  const field=new Node({tag:'INPUT'}),below=new Node({reveal:true,top:1200,children:[field]}),active=new Node({reveal:true});
  const f=fixture([below,active]);
  assert.equal(f.calls.length,1);assert.ok(f.observers[0].observed.has(below));
  f.interact(field);
  assert.equal(f.observers[0].observed.has(below),false);
  f.observers[0].show(below);assert.equal(f.calls.length,1);
  f.interact(active,'pointerdown');assert.equal(f.calls[0].stopped,true);
  assert.equal(active.style.transform,'');f.dispose();
});

test('merchant dish photo precedes copy and action without moving their common row',()=>{
  const photo=new Node({source:true,children:[new Node({classes:['cp-food-art']})]});
  const copy=new Node({classes:['cp-order-dish-copy']}),actions=new Node({classes:['cp-order-dish-action']});
  const row=new Node({classes:['cp-order-dish'],reveal:true,children:[photo,new Node({classes:['cp-food-copy'],children:[copy,actions]})]});
  const f=fixture([row]);
  assert.deepEqual(f.calls.map(call=>call.element),[photo,copy,actions]);
  assert.equal(f.calls[0].options.duration,.5);
  assert.equal(f.calls[1].options.duration,.36);
  assert.ok(f.calls[0].options.delay<f.calls[1].options.delay);
  f.interact(photo);assert.equal(f.calls[0].stopped,true);
  f.dispose();
});

test('receipt story owns its timeline and reduced motion settles every decorative layer',()=>{
  const storyChild=new Node({reveal:true}),story=new Node({reveal:true,story:true,children:[storyChild]}),content=new Node({reveal:true});
  const f=fixture([story,content]);
  assert.deepEqual(f.calls.map(call=>call.element),[content]);
  f.media.matches=true;f.media.dispatchEvent(new Event('change'));
  assert.equal(f.calls[0].stopped,true);assert.equal(content.style.opacity,'');
  f.win.location.hash='#order';revealOnChange(f.root);
  assert.equal(f.calls.length,1);f.dispose();
  const calm=fixture([new Node({reveal:true})],{reduced:true});
  assert.equal(calm.calls.length,0);calm.dispose();
});
