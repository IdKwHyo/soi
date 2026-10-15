// A single light follows the pointer over the active control. Controls never
// move, and the listener does no work while the page or pointer is inactive.
export function bindInteractionLight({document: doc = document, reducedMotion, finePointer, selector} = {}) {
  const clock = doc.defaultView || globalThis;
  const listeners = new AbortController();
  const properties = ['--c-glare-x', '--c-glare-y'];
  let current = null, original = [], point, frame = null, suspended = false, disposed = false;
  const enabled = () => !disposed && !suspended && !doc.hidden && !reducedMotion?.matches && finePointer?.matches;
  const clear = () => {
    if (frame !== null) clock.cancelAnimationFrame(frame);
    frame = null;
    if (current) for (const [property, value, priority] of original) {
      if (value) current.style.setProperty(property, value, priority);
      else current.style.removeProperty(property);
    }
    current = null; original = []; point = null;
  };
  const paint = () => {
    frame = null;
    if (!enabled() || !current?.isConnected || !point) { clear(); return; }
    const rect = current.getBoundingClientRect();
    if (!rect.width || !rect.height) { clear(); return; }
    const clamp = value => Math.max(0, Math.min(100, value));
    current.style.setProperty('--c-glare-x', `${clamp((point.x - rect.left) / rect.width * 100).toFixed(1)}%`);
    current.style.setProperty('--c-glare-y', `${clamp((point.y - rect.top) / rect.height * 100).toFixed(1)}%`);
  };
  const move = event => {
    if (!enabled() || event.pointerType === 'touch') { clear(); return; }
    const next = event.target?.closest?.(selector);
    if (!next || next.matches(':disabled,[aria-disabled="true"]')) { clear(); return; }
    if (current !== next) {
      clear(); current = next;
      original = properties.map(property => [property, current.style.getPropertyValue(property), current.style.getPropertyPriority(property)]);
    }
    point = {x: event.clientX, y: event.clientY};
    if (frame === null) frame = clock.requestAnimationFrame(paint);
  };
  const options = {signal: listeners.signal, passive: true};
  doc.addEventListener('pointermove', move, options);
  doc.addEventListener('pointerout', event => {
    if (current && !current.contains(event.relatedTarget)) clear();
  }, options);
  doc.addEventListener('pointercancel', clear, options);
  doc.addEventListener('visibilitychange', clear, options);
  clock.addEventListener?.('blur', clear, options);
  reducedMotion?.addEventListener('change', clear, options);
  finePointer?.addEventListener('change', clear, options);
  return {
    suspend() { suspended = true; clear(); },
    resume() { if (!disposed) suspended = false; },
    destroy() { disposed = true; clear(); listeners.abort(); },
  };
}
