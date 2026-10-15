import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSigninPortal} from '../dist/signin/portal.mjs';

function fixture({reduced = false, forced = false, fine = true, navigateError = false, animationError = false, form = false} = {}) {
  const document = new EventTarget(), window = new EventTarget();
  const frames = new Map(), timers = new Map(), animations = [], visits = [], storage = new Map();
  const queries = Object.fromEntries(['reduced', 'forced', 'fine'].map(key => [key, new EventTarget()]));
  Object.assign(queries.reduced, {matches: reduced}); Object.assign(queries.forced, {matches: forced}); Object.assign(queries.fine, {matches: fine});
  let sequence = 0;
  const rectangle = {left: 700, top: 150, width: 360, height: 540, right: 1060, bottom: 690};
  function element(tag = 'div') {
    const node = new EventTarget(), styles = new Map(), attrs = new Map();
    Object.assign(node, {ownerDocument: document, tagName: tag.toUpperCase(), isConnected: true,
      children: [], styles, attrs, dataset: {}, textContent: '', target: '', complete: true, naturalWidth: 960,
      src: tag === 'img' ? '/images/signin-mountains.webp' : '',
      style: {
        getPropertyValue: key => styles.get(key)?.value || '',
        getPropertyPriority: key => styles.get(key)?.priority || '',
        setProperty: (key, value, priority = '') => styles.set(key, {value, priority}),
        removeProperty: key => styles.delete(key),
      },
      getBoundingClientRect: () => rectangle,
      setAttribute: (key, value) => attrs.set(key, value),
      getAttribute: key => attrs.get(key) || null,
      hasAttribute: key => attrs.has(key),
      removeAttribute: key => attrs.delete(key),
      append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
      remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
    });
    for (const name of ['transform', 'opacity', 'willChange']) Object.defineProperty(node.style, name, {
      get: () => node.style.getPropertyValue(name === 'willChange' ? 'will-change' : name),
      set: value => node.style.setProperty(name === 'willChange' ? 'will-change' : name, value),
    });
    return node;
  }
  const nodes = Object.fromEntries(['scene', 'photo', 'glass', 'background', 'copy', 'enter', 'skip', 'status']
    .map(key => [key, element(key === 'photo' ? 'img' : key === 'enter' || key === 'skip' ? 'a' : 'div')]));
  nodes.enter.setAttribute('href', '/demo#overview'); nodes.skip.setAttribute('href', '/demo#overview');
  if(form){nodes.form=element('form');nodes.form.setAttribute('action','/demo#overview');nodes.enter.removeAttribute('href');nodes.enter.closest=()=>nodes.form;}
  document.body = element('body'); document.defaultView = window; document.hidden = false;
  document.documentElement = {lang: 'en'};
  document.querySelector = selector => nodes[selector.replace('[data-signin-', '').replace(']', '')];
  document.createElement = element;
  Object.assign(window, {innerWidth: 1200, innerHeight: 900, scrollY: 0,
    matchMedia: query => query.includes('reduced-motion') ? queries.reduced : query.includes('forced-colors') ? queries.forced : queries.fine,
    getComputedStyle: node => ({transform: node.style.transform || 'none', borderRadius: '28px', objectPosition: '50% 50%'}),
    requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (callback, delay) => { timers.set(++sequence, {callback, delay}); return sequence; },
    clearTimeout: id => timers.delete(id),
    sessionStorage: {setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
  });
  const play = (node, values, options) => {
    if (animationError) throw new Error('Animation unavailable');
    const listeners = [];
    const control = {node, values, options, stopped: false,
      stop() { this.stopped = true; }, then(success, failure) { listeners.push({success, failure}); },
      finish() { for (const listener of listeners) listener.success?.(); },
      reject() { for (const listener of listeners) listener.failure?.(); },
    };
    animations.push(control);
    if (values.opacity) node.style.opacity = String(values.opacity.at(-1));
    if (values.transform) node.style.transform = values.transform.at(-1);
    return control;
  };
  const cleanup = mountSigninPortal(document, {animate: play, now: () => 123456789,
    navigate: href => { if (navigateError) throw new Error('Blocked'); visits.push(href); }});
  const click = (node = nodes.enter, fields = {}) => {
    const event = new Event('click', {cancelable: true}); Object.assign(event, {button: 0, ...fields});
    node.dispatchEvent(event); return event;
  };
  const flush = () => {
    for (let count = 0; frames.size && count < 100; count++) for (const [id, callback] of [...frames]) {
      frames.delete(id); callback();
    }
  };
  const runTimer = delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } };
  const flights = () => document.body.children.filter(node => node.className === 'signin-portal-flight');
  return {document, window, nodes, queries, frames, timers, animations, visits, storage, cleanup, click, flush, runTimer, flights, rectangle};
}

test('sign in expands a decorative portrait then follows the native destination once, without authentication state', () => {
  const f = fixture();
  f.flush();
  assert.equal(f.click().defaultPrevented, true);
  assert.equal(f.flights().length, 1);
  assert.equal(f.flights()[0].attrs.get('aria-hidden'), 'true');
  assert.equal(f.flights()[0].inert, true);
  assert.equal(f.nodes.enter.attrs.get('aria-busy'), 'true');
  assert.equal(f.visits.length, 0);
  assert.equal(f.storage.size, 0);
  assert.equal(f.click().defaultPrevented, true);
  assert.equal(f.flights().length, 1);
  f.animations.at(-1).finish(); f.runTimer(1000); f.animations.at(-1).finish();
  assert.deepEqual(f.visits, ['/demo#overview']);
  assert.deepEqual([...f.storage], [['soi-demo-entry', '123456789']]);
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.storage.get('soi-demo-entry'), '123456789');
  f.window.dispatchEvent(new Event('pagehide'));
  assert.equal(f.flights().length, 0);
  assert.equal(f.nodes.enter.hasAttribute('aria-busy'), false);
  assert.equal(f.storage.get('soi-demo-entry'), '123456789');
  f.cleanup(); f.cleanup();
  assert.equal(f.click().defaultPrevented, false);
});

test('native form submission uses the same transition and preserves direct submission when motion is disabled',()=>{
  const f=fixture({form:true});
  const event=new Event('submit',{cancelable:true});
  f.nodes.form.dispatchEvent(event);
  assert.equal(event.defaultPrevented,true);assert.equal(f.flights().length,1);
  f.animations.at(-1).finish();
  assert.deepEqual(f.visits,['/demo#overview']);
  assert.deepEqual([...f.storage],[['soi-demo-entry','123456789']]);
  f.cleanup();
  const fallback=fixture({form:true,reduced:true});
  const nativeSubmit=new Event('submit',{cancelable:true});
  fallback.nodes.form.dispatchEvent(nativeSubmit);
  assert.equal(nativeSubmit.defaultPrevented,false);assert.equal(fallback.flights().length,0);assert.equal(fallback.storage.size,0);
  assert.equal(fallback.nodes.form.getAttribute('action'),'/demo#overview');
  fallback.cleanup();
});

test('modifier clicks and static fallbacks preserve native link semantics without an arrival overlay', () => {
  const f = fixture();
  for (const fields of [{metaKey: true}, {ctrlKey: true}, {shiftKey: true}, {altKey: true}, {button: 1}])
    assert.equal(f.click(f.nodes.enter, fields).defaultPrevented, false);
  f.nodes.enter.target = '_blank'; assert.equal(f.click().defaultPrevented, false); f.nodes.enter.target = '';
  f.nodes.enter.setAttribute('download', ''); assert.equal(f.click().defaultPrevented, false);
  f.cleanup();
  for (const options of [{reduced: true}, {forced: true}, {}]) {
    const fallback = fixture(options);
    if (!options.reduced && !options.forced) fallback.nodes.photo.naturalWidth = 0;
    assert.equal(fallback.click().defaultPrevented, false);
    assert.equal(fallback.flights().length, 0);
    assert.equal(fallback.storage.size, 0);
    fallback.cleanup();
  }
});

test('hidden pages and changing motion preferences restore styles and invalidate stale completion callbacks', () => {
  const f = fixture();
  f.nodes.copy.style.setProperty('opacity', '.95', 'important');
  f.click(); const previous = f.animations.at(-1);
  f.queries.reduced.matches = true; f.queries.reduced.dispatchEvent(new Event('change'));
  previous.finish(); f.runTimer(1000);
  assert.equal(f.visits.length, 0);
  assert.equal(f.flights().length, 0);
  assert.deepEqual(f.nodes.copy.styles.get('opacity'), {value: '.95', priority: 'important'});
  f.queries.reduced.matches = false; f.queries.reduced.dispatchEvent(new Event('change'));
  f.click(); const second = f.animations.at(-1);
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); second.finish();
  assert.equal(f.visits.length, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.flights().length, 0);
  f.cleanup();
});

test('native skip and Escape interrupt the pending flight without trapping the controls', () => {
  const f = fixture();
  f.click(); const first = f.animations.at(-1);
  assert.equal(f.click(f.nodes.skip).defaultPrevented, false);
  first.finish(); assert.equal(f.visits.length, 0); assert.equal(f.flights().length, 0);
  f.click(); const second = f.animations.at(-1);
  const escape = new Event('keydown'); escape.key = 'Escape'; f.document.dispatchEvent(escape);
  second.finish(); assert.equal(f.visits.length, 0); assert.equal(f.flights().length, 0);
  assert.equal(f.nodes.enter.hasAttribute('aria-busy'), false);
  f.cleanup();
});

test('an unresolved or rejected animation still reaches the demo; blocked navigation restores a retryable page', () => {
  const f = fixture(); f.click(); f.runTimer(1000);
  assert.deepEqual(f.visits, ['/demo#overview']);
  f.animations.at(-1).finish(); assert.equal(f.visits.length, 1);
  f.runTimer(1800); assert.equal(f.flights().length, 0); assert.equal(f.storage.size, 0); f.cleanup();
  const unsupported = fixture({animationError: true}); unsupported.click();
  assert.deepEqual(unsupported.visits, ['/demo#overview']); assert.equal(unsupported.storage.size, 0); unsupported.cleanup();
  const blocked = fixture({navigateError: true}); blocked.click(); blocked.animations.at(-1).finish();
  assert.equal(blocked.flights().length, 0); assert.equal(blocked.nodes.enter.hasAttribute('aria-busy'), false);
  assert.equal(blocked.storage.size, 0); assert.match(blocked.nodes.status.textContent, /Could not open/);
  assert.equal(blocked.click().defaultPrevented, true); blocked.cleanup();
});

test('natural scroll decorates only the landscape, remains bounded, and stops work once settled', () => {
  const f = fixture({fine: false}); f.flush();
  f.window.scrollY = 20000; f.window.dispatchEvent(new Event('scroll')); f.flush();
  assert.match(f.nodes.photo.style.transform, /translate3d/);
  assert.equal(f.nodes.copy.style.transform, '');
  assert.equal(f.nodes.enter.style.transform, '');
  assert.equal(f.frames.size, 0);
  const transform = f.nodes.photo.style.transform;
  const event = new Event('pointermove'); Object.assign(event, {clientX: 1000, clientY: 300, pointerType: 'touch'});
  f.nodes.scene.dispatchEvent(event); f.flush(); assert.equal(f.nodes.photo.style.transform, transform);
  // Explicit entry still works with touch; automatic pointer camera motion does not.
  assert.equal(f.click().defaultPrevented, true);
  f.cleanup(); assert.equal(f.nodes.photo.style.transform, ''); assert.equal(f.frames.size, 0);
});

test('a still-loading image leaves the native link available while an offscreen mobile portrait enters without flying from below the viewport', () => {
  const f = fixture(); f.nodes.photo.complete = false;
  assert.equal(f.click().defaultPrevented, false);
  f.nodes.photo.complete = true; f.rectangle.top = 1500; f.rectangle.bottom = 2040;
  assert.equal(f.click().defaultPrevented, true);
  assert.equal(f.flights().length, 1);
  assert.equal(f.flights()[0].style.top, '0px');
  assert.equal(f.flights()[0].style.width, '1200px');
  assert.deepEqual(f.animations.at(-1).values.opacity, [0, 1]);
  f.animations.at(-1).finish(); assert.deepEqual(f.visits, ['/demo#overview']); f.cleanup();
});
