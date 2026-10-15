import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelMotion} from '../dist/panel-motion.mjs';

function fixture({reduced = false, popover = true} = {}) {
  const document = new EventTarget(), window = new EventTarget(), preference = new EventTarget(), forcedColors = new EventTarget();
  const frames = new Map(), animations = [], allNodes = [];
  let tick = 0;
  preference.matches = reduced;
  forcedColors.matches = false;
  document.hidden = false; document.defaultView = window;
  Object.assign(window, {innerWidth: 1200, innerHeight: 900,
    matchMedia: query => query.includes('forced-colors') ? forcedColors : preference,
    getComputedStyle: () => ({borderRadius: '16px', objectPosition: '50% 50%'}),
    requestAnimationFrame: callback => { frames.set(++tick, callback); return tick; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const rect = (left = 40, top = 200, width = 240, height = 180) => ({left, top, width, height, right: left + width, bottom: top + height});
  function element(tagName = 'div', rectangle = rect()) {
    const node = new EventTarget(), styles = new Map(), classes = new Set();
    Object.assign(node, {ownerDocument: document, nodeType: 1, tagName: tagName.toUpperCase(), isConnected: true,
      children: [], attrs: {}, styles, src: '', naturalWidth: 800, complete: true, rectangle,
      style: {
        getPropertyValue: key => styles.get(key)?.value || '',
        getPropertyPriority: key => styles.get(key)?.priority || '',
        setProperty: (key, value, priority = '') => styles.set(key, {value, priority}),
        removeProperty: key => styles.delete(key),
      },
      classList: {add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name)},
      setAttribute(name, value) { this.attrs[name] = value; },
      getBoundingClientRect() { return this.rectangle; },
      append(child) { child.parent = this; this.children.push(child); },
      remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); },
      querySelector() { return this.children.find(child => child.tagName === 'IMG' && !child.hidden); },
    });
    // Model style properties used by the module as real inline declarations.
    for (const name of ['opacity', 'transform', 'transformOrigin']) Object.defineProperty(node.style, name, {
      get: () => node.style.getPropertyValue(name === 'transformOrigin' ? 'transform-origin' : name),
      set: value => node.style.setProperty(name === 'transformOrigin' ? 'transform-origin' : name, value),
    });
    if (popover) {
      node.showPopover = () => { node.shown = true; };
      node.hidePopover = () => { node.shown = false; };
    }
    allNodes.push(node); return node;
  }
  document.createElement = tag => element(tag);
  document.body = element('body');
  const dialog = element('dialog'), background = element('main');
  dialog.open = true;
  const source = element('div'), sourceImage = element('img'); sourceImage.src = '/images/dish.webp'; source.append(sourceImage);
  const target = element('div'), targetImage = element('img', rect(400, 220, 400, 300)); targetImage.src = sourceImage.src; target.append(targetImage);
  const play = (node, keyframes) => {
    const callbacks = [];
    const control = {node, keyframes, stopped: false, stop() { this.stopped = true; },
      then(callback) { callbacks.push(callback); }, finish() { for (const callback of callbacks) callback(); }};
    animations.push(control);
    if (keyframes.transform) node.style.transform = keyframes.transform.at(-1);
    if (keyframes.opacity) node.style.opacity = String(keyframes.opacity.at(-1));
    return control;
  };
  const panels = createPanelMotion({dialog, background: [background], animate: play});
  const flush = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  const ghosts = () => document.body.children.filter(node => node.className === 'panel-photo-flight');
  const close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  return {panels, dialog, background, source, sourceImage, target, targetImage, document, window, preference, forcedColors,
    frames, animations, element, flush, ghosts, close};
}

test('dish returns to the fresh menu node after synchronous close and rerender without changing focus or hiding original photos', () => {
  const f = fixture();
  f.targetImage.style.setProperty('opacity', '.9', 'important');
  f.background.style.setProperty('transform', 'translateX(0)', 'important');
  let destination = f.source;
  f.panels.enter({source: f.source, target: f.target, resolveSource: () => destination});
  assert.equal(f.ghosts().length, 1);
  assert.equal(f.ghosts()[0].attrs['aria-hidden'], 'true');
  assert.equal(f.ghosts()[0].inert, true);
  assert.equal(f.targetImage.style.opacity, '0');
  assert.equal(f.dialog.open, true);
  f.panels.prepareClose(); f.close();
  assert.equal(f.dialog.open, false);
  assert.equal(f.ghosts().length, 0);
  assert.deepEqual(f.targetImage.styles.get('opacity'), {value: '.9', priority: 'important'});
  assert.deepEqual(f.background.styles.get('transform'), {value: 'translateX(0)', priority: 'important'});
  destination = f.element('img'); destination.src = '/images/dish.webp';
  f.source.isConnected = false; f.flush();
  assert.equal(f.ghosts().length, 1);
  assert.equal(destination.style.opacity, '0');
  f.animations.at(-1).finish();
  assert.equal(destination.style.opacity, '');
  assert.equal(f.ghosts().length, 0);
  f.panels.dispose();
});

test('Escape, interrupted reentry and queued close events cannot retain a hidden photo or remove a newer panel', () => {
  const f = fixture();
  f.panels.enter({source: f.source, target: f.target});
  const previous = [...f.animations];
  f.dialog.dispatchEvent(new Event('cancel')); f.close();
  f.dialog.open = true; f.panels.enter({source: f.source, target: f.target});
  const newer = f.ghosts()[0];
  f.dialog.dispatchEvent(new Event('close'));
  for (const animation of previous) animation.finish();
  f.flush();
  assert.equal(f.ghosts()[0], newer);
  assert.equal(f.dialog.classList.contains('panel-spatial'), true);
  f.panels.dispose();
  assert.equal(f.frames.size, 0);
  assert.equal(f.ghosts().length, 0);
  assert.equal(f.targetImage.style.opacity, '');
  assert.equal(f.background.style.transform, '');
});

test('reduced motion, hidden page and unavailable popovers leave native dialog content available', () => {
  const f = fixture({reduced: true});
  f.panels.enter({source: f.source, target: f.target});
  assert.equal(f.animations.length, 0);
  assert.equal(f.targetImage.style.opacity, '');
  f.preference.matches = false; f.preference.dispatchEvent(new Event('change'));
  f.panels.enter({source: f.source, target: f.target});
  assert.equal(f.ghosts().length, 1);
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.ghosts().length, 0);
  assert.equal(f.targetImage.style.opacity, '');
  assert.equal(f.background.style.transform, '');
  f.panels.dispose();
  const fallback = fixture({popover: false});
  fallback.panels.enter({source: fallback.source, target: fallback.target});
  assert.equal(fallback.ghosts().length, 0);
  assert.equal(fallback.targetImage.style.opacity, '');
  assert.equal(fallback.dialog.open, true);
  fallback.panels.dispose();
});

test('editor scroll or a missing destination settles shared motion immediately and safely', () => {
  const f = fixture();
  f.panels.enter({source: f.source, target: f.target, resolveSource: () => null});
  f.dialog.dispatchEvent(new Event('scroll'));
  assert.equal(f.ghosts().length, 0);
  assert.equal(f.targetImage.style.opacity, '');
  f.panels.prepareClose(); f.close(); f.flush();
  assert.equal(f.ghosts().length, 0);
  assert.equal(f.frames.size, 0);
  f.panels.dispose();
});

test('fresh editor image geometry can receive the loaded dish, while forced colors never hides useful content', () => {
  const f = fixture();
  f.targetImage.complete = false; f.targetImage.naturalWidth = 0;
  f.panels.enter({source: f.source, target: f.target});
  assert.equal(f.ghosts().length, 1);
  assert.equal(f.ghosts()[0].children[0].src, f.sourceImage.src);
  f.forcedColors.matches = true; f.forcedColors.dispatchEvent(new Event('change'));
  assert.equal(f.ghosts().length, 0);
  assert.equal(f.targetImage.style.opacity, '');
  assert.equal(f.background.style.transform, '');
  const count = f.animations.length;
  f.panels.enter({source: f.source, target: f.target});
  assert.equal(f.animations.length, count);
  f.panels.dispose();
});

test('a released upload preview returns using the saved destination image resource', () => {
  const f = fixture();
  f.panels.enter({source: f.source, target: f.target});
  f.animations.at(-1).finish();
  f.targetImage.src = 'blob:temporary-upload';
  f.sourceImage.src = '/saved-photo.webp';
  f.panels.prepareClose(); f.close(); f.flush();
  assert.equal(f.ghosts()[0].children[0].src, '/saved-photo.webp');
  f.panels.dispose();
  assert.equal(f.sourceImage.style.opacity, '');
});

test('save returns into a freshly rendered menu image before it finishes decoding', () => {
  const f = fixture();
  let destination = f.source;
  f.panels.enter({source: f.source, target: f.target, resolveSource: () => destination});
  f.animations.at(-1).finish();
  f.panels.prepareClose(); f.close();
  destination = f.element('img'); destination.src = f.targetImage.src;
  destination.complete = false; destination.naturalWidth = 0;
  f.flush();
  assert.equal(f.ghosts().length, 1);
  assert.equal(f.ghosts()[0].children[0].src, f.targetImage.src);
  assert.equal(destination.style.opacity, '0');
  f.animations.at(-1).finish();
  assert.equal(f.ghosts().length, 0);
  assert.equal(destination.style.opacity, '');
  f.panels.dispose();
});
