import test from 'node:test';
import assert from 'node:assert/strict';
import {bindInteractionLight} from '../dist/versionc/interaction-light.mjs';

function fixture() {
  const doc = new EventTarget(), clock = new EventTarget(), pending = new Map();
  let id = 0;
  clock.requestAnimationFrame = callback => { pending.set(++id, callback); return id; };
  clock.cancelAnimationFrame = key => pending.delete(key);
  clock.flush = () => { for (const [key, callback] of [...pending]) { pending.delete(key); callback(); } };
  doc.defaultView = clock; doc.hidden = false;
  const reduced = new EventTarget(), fine = new EventTarget();
  reduced.matches = false; fine.matches = true;
  function element() {
    const styles = new Map();
    return {isConnected: true, disabled: false, styles,
      style: {
        getPropertyValue: key => styles.get(key)?.value || '',
        getPropertyPriority: key => styles.get(key)?.priority || '',
        setProperty: (key, value, priority = '') => styles.set(key, {value, priority}),
        removeProperty: key => styles.delete(key),
      },
      closest() { return this; }, matches() { return this.disabled; },
      contains(node) { return node === this; },
      getBoundingClientRect: () => ({left: 10, top: 20, width: 200, height: 50}),
    };
  }
  function emit(type, fields = {}) {
    const event = new Event(type);
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, {value});
    doc.dispatchEvent(event);
  }
  const move = (target, x = 100, y = 25, pointerType = 'mouse') => emit('pointermove', {target, clientX: x, clientY: y, pointerType});
  const light = bindInteractionLight({document: doc, reducedMotion: reduced, finePointer: fine, selector: '.button'});
  return {doc, clock, pending, reduced, fine, element, emit, move, light};
}

test('pointer light coalesces movement and restores the previous control without changing geometry', () => {
  const f = fixture(), first = f.element(), second = f.element();
  first.style.setProperty('--c-glare-x', '30%', 'important');
  f.move(first, 20, 22); f.move(first, 1000, -100);
  assert.equal(f.pending.size, 1);
  f.clock.flush();
  assert.equal(first.style.getPropertyValue('--c-glare-x'), '100.0%');
  assert.equal(first.style.getPropertyValue('--c-glare-y'), '0.0%');
  assert.equal(first.styles.has('transform'), false);
  f.move(second);
  assert.deepEqual(first.styles.get('--c-glare-x'), {value: '30%', priority: 'important'});
  assert.equal(first.styles.has('--c-glare-y'), false);
  f.clock.flush();
  f.emit('pointerout', {relatedTarget: second});
  assert.equal(second.styles.has('--c-glare-x'), true);
  f.emit('pointerout', {relatedTarget: null});
  assert.equal(second.styles.size, 0);
  f.light.destroy();
});

test('hidden, reduced motion, touch and disabled controls cannot retain pointer lighting work', () => {
  const f = fixture(), control = f.element();
  f.move(control); f.doc.hidden = true; f.emit('visibilitychange');
  assert.equal(f.pending.size, 0); assert.equal(control.styles.size, 0);
  f.move(control); assert.equal(f.pending.size, 0);
  f.doc.hidden = false;
  f.move(control, 20, 20, 'touch'); assert.equal(f.pending.size, 0);
  control.disabled = true; f.move(control); assert.equal(f.pending.size, 0);
  control.disabled = false;
  f.move(control); f.clock.flush();
  f.reduced.matches = true; f.reduced.dispatchEvent(new Event('change'));
  assert.equal(control.styles.size, 0); f.move(control); assert.equal(f.pending.size, 0);
  f.reduced.matches = false; f.fine.matches = false;
  f.move(control); assert.equal(f.pending.size, 0);
  f.light.destroy();
});

test('unmount, suspension and teardown cancel stale frames and allow a clean resume', () => {
  const f = fixture(), control = f.element();
  f.move(control); control.isConnected = false; f.clock.flush();
  assert.equal(control.styles.size, 0);
  control.isConnected = true; f.move(control); f.light.suspend();
  assert.equal(f.pending.size, 0); f.move(control); assert.equal(f.pending.size, 0);
  f.light.resume(); f.move(control); assert.equal(f.pending.size, 1);
  f.clock.flush(); assert.equal(control.styles.size, 2);
  f.move(control); f.light.destroy();
  assert.equal(f.pending.size, 0); assert.equal(control.styles.size, 0);
  f.light.resume(); f.move(control); assert.equal(f.pending.size, 0);
});
