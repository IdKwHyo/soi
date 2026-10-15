export const CONSENT_KEY = 'soi-privacy-choice-v1';
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60 * 1000;
const PURPOSES = ['analytics', 'marketing'];
const denied = () => ({analytics: false, marketing: false});

function parseRecord(raw, time) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.version !== CONSENT_VERSION || !Number.isSafeInteger(value.updatedAt) ||
      !Number.isSafeInteger(value.expiresAt) || value.updatedAt < 0 || value.updatedAt > time ||
      value.expiresAt <= time || value.expiresAt <= value.updatedAt ||
      value.expiresAt - value.updatedAt > CONSENT_MAX_AGE ||
      !PURPOSES.every(purpose => typeof value.purposes?.[purpose] === 'boolean')) return null;
    return value;
  } catch { return null; }
}

/**
 * Optional code belongs inside load({signal}), never in an eager import or script tag.
 * A loader must honor abort and return a cleanup function (directly or asynchronously).
 * Changing the disclosed purposes/providers requires a new consent version/key.
 * There are no registered optional services in this release.
 */
export function createConsentGate({
  services = [], storage, events = globalThis.window, now = Date.now,
  schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout
} = {}) {
  if (new Set(services.map(service => service.id)).size !== services.length ||
    services.some(service => !service.id || !PURPOSES.includes(service.purpose) || typeof service.load !== 'function')) {
    throw new TypeError('Each optional service needs a unique id, a known purpose, and a loader.');
  }
  let disposed = false, blocked = false, record = null, timer = null;
  const active = new Map();
  try { if (storage === undefined) storage = globalThis.localStorage; }
  catch { blocked = true; }

  function stop(id) {
    const entry = active.get(id);
    if (!entry) return;
    active.delete(id);
    entry.controller.abort();
    try { entry.cleanup?.(); } catch { /* Revocation continues for other services. */ }
    entry.cleanup = null;
  }
  function sync() {
    for (const service of services) {
      const allowed = !disposed && !blocked && record?.purposes[service.purpose] === true;
      if (!allowed) { stop(service.id); continue; }
      if (active.has(service.id)) continue;
      const entry = {controller: new AbortController(), cleanup: null};
      active.set(service.id, entry);
      const registerCleanup = cleanup => {
        if (typeof cleanup !== 'function') return;
        if (entry.controller.signal.aborted || active.get(service.id) !== entry) {
          try { cleanup(); } catch { /* A late loader must still be stopped. */ }
        } else entry.cleanup = cleanup;
      };
      try {
        const result = service.load({signal: entry.controller.signal});
        if (typeof result === 'function') registerCleanup(result);
        else Promise.resolve(result).then(registerCleanup, () => {
          if (active.get(service.id) === entry) stop(service.id);
        });
      } catch { stop(service.id); }
    }
  }
  function check() {
    if (disposed) return denied();
    if (timer !== null) cancel(timer);
    timer = null;
    try { record = blocked ? null : parseRecord(storage?.getItem(CONSENT_KEY), now()); }
    catch { blocked = true; record = null; }
    sync();
    if (record) {
      timer = schedule(check, Math.min(2_147_483_647, Math.max(1, record.expiresAt - now())));
      timer?.unref?.();
    }
    return record ? {...record.purposes} : denied();
  }
  function setConsent(purposes) {
    if (disposed) return false;
    const time = now();
    const next = {version: CONSENT_VERSION, updatedAt: time, expiresAt: time + CONSENT_MAX_AGE,
      purposes: Object.fromEntries(PURPOSES.map(purpose => [purpose, purposes?.[purpose] === true]))};
    try {
      if (!storage) throw new Error('Storage unavailable');
      storage.setItem(CONSENT_KEY, JSON.stringify(next));
      // Some storage adapters silently drop writes. Do not start any loader in that case.
      if (storage.getItem(CONSENT_KEY) !== JSON.stringify(next)) throw new Error('Choice was not saved');
      blocked = false;
      check();
      return true;
    } catch {
      blocked = true; record = null;
      if (timer !== null) cancel(timer);
      timer = null;
      sync();
      return false;
    }
  }
  const onStorage = event => {
    if (event.storageArea && event.storageArea !== storage) return;
    if (event.key === null || event.key === CONSENT_KEY) check();
  };
  events?.addEventListener?.('storage', onStorage);
  events?.addEventListener?.('focus', check);
  events?.addEventListener?.('pageshow', check);
  check();
  return {
    read: check, setConsent,
    keepAllOff: () => setConsent(denied()),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) cancel(timer);
      events?.removeEventListener?.('storage', onStorage);
      events?.removeEventListener?.('focus', check);
      events?.removeEventListener?.('pageshow', check);
      for (const id of [...active.keys()]) stop(id);
      record = null;
    }
  };
}
