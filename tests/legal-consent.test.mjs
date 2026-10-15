import test from 'node:test';
import assert from 'node:assert/strict';
import {createConsentGate, CONSENT_KEY, CONSENT_VERSION, CONSENT_MAX_AGE} from '../dist/legal/consent.mjs';
import {renderLegalFooter} from '../scripts/legal-footer.mjs';

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(services = []) {
  let time = 10000, next = 0, raw = null, failRead = false, failWrite = false;
  const timers = new Map(), events = new EventTarget();
  const storage = {
    getItem(key) { assert.equal(key, CONSENT_KEY); if (failRead) throw Error('blocked'); return raw; },
    setItem(key, value) { assert.equal(key, CONSENT_KEY); if (failWrite) throw Error('blocked'); raw = value; }
  };
  const gate = createConsentGate({services, storage, events, now: () => time,
    schedule: (callback, delay) => { timers.set(++next, {callback, delay}); return next; },
    cancel: id => timers.delete(id)});
  return {gate, storage, events, timers,
    setTime(value) { time = value; },
    setRaw(value) { raw = value; },
    fail({read = false, write = false} = {}) { failRead = read; failWrite = write; },
    notify(key = CONSENT_KEY) { const event = new Event('storage'); Object.defineProperty(event, 'key', {value: key}); events.dispatchEvent(event); },
    record(purposes, changes = {}) { return JSON.stringify({version: CONSENT_VERSION, updatedAt: time, expiresAt: time + CONSENT_MAX_AGE, purposes, ...changes}); }
  };
}
function service(id, purpose, calls) {
  return {id, purpose, load({signal}) { calls.push({id, signal}); return () => calls.push({stopped: id}); }};
}

test('no optional loader runs before explicit purpose consent, including after rejection', async () => {
  const calls = [], f = fixture([service('visits', 'analytics', calls), service('ads', 'marketing', calls)]);
  assert.deepEqual(f.gate.read(), {analytics: false, marketing: false});
  assert.equal(f.gate.keepAllOff(), true);
  f.gate.read(); await settle();
  assert.deepEqual(calls, []);
  assert.deepEqual(f.gate.read(), {analytics: false, marketing: false});
  f.gate.dispose();
});

test('only the explicitly granted purpose loads and repeated reads do not reload it', async () => {
  const calls = [], f = fixture([service('visits', 'analytics', calls), service('ads', 'marketing', calls)]);
  f.gate.setConsent({analytics: true, marketing: 'true'});
  f.gate.read(); f.gate.read(); await settle();
  assert.equal(calls.length, 1); assert.equal(calls[0].id, 'visits');
  assert.deepEqual(f.gate.read(), {analytics: true, marketing: false});
  f.gate.keepAllOff();
  assert.equal(calls[0].signal.aborted, true); assert.deepEqual(calls[1], {stopped: 'visits'});
  f.gate.dispose();
});

test('revocation aborts a pending loader immediately and cleans a late result', async () => {
  let resolve, signal, cleaned = 0;
  const f = fixture([{id: 'slow', purpose: 'analytics', load(context) {
    signal = context.signal; return new Promise(done => { resolve = done; });
  }}]);
  f.gate.setConsent({analytics: true});
  assert.equal(signal.aborted, false);
  f.gate.keepAllOff(); assert.equal(signal.aborted, true);
  resolve(() => { cleaned++; }); await settle();
  assert.equal(cleaned, 1); f.gate.dispose(); assert.equal(cleaned, 1);
});

test('cross-tab withdrawal or storage clear stops optional services', async () => {
  for (const clear of [false, true]) {
    const calls = [], f = fixture([service('visits', 'analytics', calls)]);
    f.gate.setConsent({analytics: true}); await settle();
    f.setRaw(clear ? null : f.record({analytics: false, marketing: false}));
    f.notify(clear ? null : CONSENT_KEY);
    assert.equal(calls[0].signal.aborted, true); assert.deepEqual(calls[1], {stopped: 'visits'});
    assert.deepEqual(f.gate.read(), {analytics: false, marketing: false}); f.gate.dispose();
  }
});

test('invalid, stale, future and unknown-version records fail closed', () => {
  const calls = [], f = fixture([service('visits', 'analytics', calls)]);
  for (const raw of ['{broken', '{}', f.record({analytics: 'yes', marketing: false}),
    f.record({analytics: true, marketing: false}, {version: 99}),
    f.record({analytics: true, marketing: false}, {expiresAt: 9999}),
    f.record({analytics: true, marketing: false}, {updatedAt: 10001}),
    f.record({analytics: true, marketing: false}, {expiresAt: 10001 + CONSENT_MAX_AGE})]) {
    f.setRaw(raw); f.notify(); assert.deepEqual(f.gate.read(), {analytics: false, marketing: false});
  }
  assert.deepEqual(calls, []); f.gate.dispose();
});

test('expiry uses bounded timer chunks and withdraws active services at expiry', async () => {
  const calls = [], f = fixture([service('visits', 'analytics', calls)]);
  f.gate.setConsent({analytics: true}); await settle();
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 2_147_483_647);
  f.setTime(10000 + CONSENT_MAX_AGE);
  [...f.timers.values()][0].callback();
  assert.equal(calls[0].signal.aborted, true); assert.deepEqual(calls[1], {stopped: 'visits'});
  assert.equal(f.timers.size, 0); f.gate.dispose();
});

test('a failed or silently discarded write cannot start optional code', () => {
  const calls = [], f = fixture([service('visits', 'analytics', calls)]);
  f.fail({write: true}); assert.equal(f.gate.setConsent({analytics: true}), false);
  assert.deepEqual(f.gate.read(), {analytics: false, marketing: false}); assert.deepEqual(calls, []);
  f.fail(); f.storage.setItem = () => {};
  assert.equal(f.gate.setConsent({analytics: true}), false); assert.deepEqual(calls, []); f.gate.dispose();
});

test('storage access failure stops active services and needs a new saved choice to resume', async () => {
  const calls = [], f = fixture([service('visits', 'analytics', calls)]);
  f.gate.setConsent({analytics: true}); await settle();
  f.fail({read: true}); assert.deepEqual(f.gate.read(), {analytics: false, marketing: false});
  assert.equal(calls[0].signal.aborted, true);
  f.fail(); f.gate.read(); assert.equal(calls.length, 2);
  f.gate.setConsent({analytics: true}); await settle(); assert.equal(calls.length, 3);
  f.gate.dispose();
});

test('dispose aborts services and removes cross-tab and timer reactivation', async () => {
  const calls = [], f = fixture([service('visits', 'analytics', calls)]);
  f.gate.setConsent({analytics: true}); await settle(); f.gate.dispose(); f.gate.dispose();
  f.notify(); f.events.dispatchEvent(new Event('focus'));
  assert.equal(f.gate.setConsent({analytics: true}), false);
  assert.equal(calls.length, 2); assert.equal(f.timers.size, 0);
});

test('localized legal footer remains navigable without JavaScript', () => {
  const en = renderLegalFooter(), th = renderLegalFooter('th-TH');
  assert.match(en, /href="\/privacy"/); assert.match(en, /href="\/terms"/);
  assert.match(en, /href="\/privacy#choices">Privacy choices/);
  assert.match(th, /href="\/th\/privacy"/); assert.match(th, /href="\/th\/terms"/);
  assert.match(th, /href="\/th\/privacy#choices">ตัวเลือกความเป็นส่วนตัว/);
  for (const markup of [en, th]) assert.doesNotMatch(markup, /hidden|style=|<dialog|<script/);
});
