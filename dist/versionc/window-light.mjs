// The Easter egg is independent of camera animation. CSS owns its appearance,
// so a reduced-motion preference or unavailable scene renderer cannot hide it.
export const LIGHT_HOLD_MS = 6500;

export function bindWindowLighting(host, {clock = globalThis} = {}) {
  const button = host?.querySelector('.c-window-button');
  if (!button) return () => {};
  const doc = host.ownerDocument;
  const listeners = new AbortController();
  let timer = null, warm = false, disposed = false;

  const setWarm = value => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    warm = value;
    host.dataset.windowLight = value ? 'on' : 'off';
    button.setAttribute('aria-pressed', String(value));
    if (value) timer = clock.setTimeout(() => {
      if (!disposed) setWarm(false);
    }, LIGHT_HOLD_MS);
  };
  button.addEventListener('click', () => {
    if (!disposed && host.isConnected && !doc.hidden) setWarm(!warm);
  }, {signal: listeners.signal});
  button.addEventListener('keydown', event => {
    if (event.key === 'Escape') setWarm(false);
  }, {signal: listeners.signal});
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) setWarm(false);
  }, {signal: listeners.signal});
  setWarm(false);
  return () => {
    disposed = true;
    listeners.abort();
    setWarm(false);
  };
}
