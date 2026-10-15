import test from 'node:test';
import assert from 'node:assert/strict';
import {bindWindowLighting, LIGHT_HOLD_MS} from '../dist/versionc/window-light.mjs';

// Exercise the DOM event contract without a browser or an animation renderer.
function fixture() {
  const document = new EventTarget(); document.hidden = false;
  const button = new EventTarget(), attributes = new Map();
  button.setAttribute = (key, value) => attributes.set(key, value);
  const host = {dataset: {}, ownerDocument: document, isConnected: true,
    querySelector: selector => selector === '.c-window-button' ? button : null};
  let now = 0, nextId = 0;
  const pending = new Map();
  const clock = {
    setTimeout(fn, delay) { const id = ++nextId; pending.set(id, {fn, at: now + delay}); return id; },
    clearTimeout(id) { pending.delete(id); },
    tick(ms) { now += ms; for (const [id, item] of [...pending]) if (item.at <= now) { pending.delete(id); item.fn(); } }
  };
  const click = () => button.dispatchEvent(new Event('click'));
  return {document, button, host, attributes, clock, pending, click};
}

test('C window click exposes the warm scene immediately and returns without a renderer', () => {
  const f = fixture(), dispose = bindWindowLighting(f.host, {clock: f.clock});
  f.click();
  assert.equal(f.host.dataset.windowLight, 'on');
  assert.equal(f.attributes.get('aria-pressed'), 'true');
  assert.equal(f.pending.size, 1);
  f.clock.tick(LIGHT_HOLD_MS - 1);
  assert.equal(f.host.dataset.windowLight, 'on');
  f.clock.tick(1);
  assert.equal(f.host.dataset.windowLight, 'off');
  assert.equal(f.attributes.get('aria-pressed'), 'false');
  assert.equal(f.pending.size, 0);
  dispose();
});

test('C lighting can reverse repeatedly, Escape or hide without leaving a stale reset', () => {
  const f = fixture(), dispose = bindWindowLighting(f.host, {clock: f.clock});
  f.click(); f.clock.tick(2000); f.click();
  assert.equal(f.host.dataset.windowLight, 'off');
  assert.equal(f.pending.size, 0);
  f.click(); f.clock.tick(LIGHT_HOLD_MS - 1);
  assert.equal(f.host.dataset.windowLight, 'on');
  const escape = new Event('keydown'); Object.defineProperty(escape, 'key', {value: 'Escape'});
  f.button.dispatchEvent(escape);
  assert.equal(f.host.dataset.windowLight, 'off'); assert.equal(f.pending.size, 0);
  f.click(); f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.host.dataset.windowLight, 'off'); assert.equal(f.pending.size, 0);
  f.click(); assert.equal(f.host.dataset.windowLight, 'off');
  dispose();
});

test('removing a C scene cancels its timer and listeners before a replacement is mounted', () => {
  const f = fixture(), dispose = bindWindowLighting(f.host, {clock: f.clock});
  f.click(); dispose();
  assert.equal(f.pending.size, 0); f.click();
  assert.equal(f.host.dataset.windowLight, 'off');
  const nextDispose = bindWindowLighting(f.host, {clock: f.clock});
  f.click(); assert.equal(f.host.dataset.windowLight, 'on'); assert.equal(f.pending.size, 1);
  nextDispose(); f.clock.tick(LIGHT_HOLD_MS * 2);
  assert.equal(f.host.dataset.windowLight, 'off');
});
