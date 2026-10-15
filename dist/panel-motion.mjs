import {animate} from 'motion';

// Decoration around a native dialog, never a replacement for its focus, Escape,
// or close behavior. Call enter after showModal and prepareClose before close.
export function createPanelMotion({dialog, background, animate: play = animate}) {
  const doc = dialog.ownerDocument, win = doc.defaultView;
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = win.matchMedia('(forced-colors: active)');
  const backgrounds = !background ? [] : background.nodeType ? [background] : [...background];
  const listeners = new AbortController(), records = new Set();
  let disposed = false, frame = 0, flight, link, returning, revision = 0;
  const active = () => !disposed && !doc.hidden && !reduced.matches && !forcedColors.matches;
  const snapshot = (node, properties) => properties.map(key =>
    [key, node.style.getPropertyValue(key), node.style.getPropertyPriority(key)]);
  const restore = (node, styles) => styles.forEach(([key, value, priority]) =>
    value ? node.style.setProperty(key, value, priority) : node.style.removeProperty(key));
  const bounds = node => {
    if (!node?.isConnected || node.hidden) return null;
    const rect = node.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.top < win.innerHeight
      && rect.right > 0 && rect.left < win.innerWidth ? rect : null;
  };
  const imageOf = node => node?.tagName === 'IMG' ? node : node?.querySelector('img:not([hidden])');
  function photo(node, allowPending = false) {
    const image = imageOf(node), rect = bounds(image);
    if (!rect || !image.src || (!allowPending && (image.complete === false || image.naturalWidth === 0))) return null;
    const style = win.getComputedStyle(image);
    return {image, rect, src: image.currentSrc || image.src, objectPosition: style.objectPosition || '50% 50%',
      radius: style.borderRadius !== '0px' ? style.borderRadius : '20px'};
  }
  function settle(record) {
    if (!records.delete(record)) return;
    try { record.control.stop(); } catch {}
    restore(record.node, record.styles);
  }
  function motion(node, keyframes, options, hold = false) {
    const styles = snapshot(node, ['transform', 'transform-origin', 'opacity', 'will-change']);
    let control;
    try { control = play(node, keyframes, options); }
    catch { restore(node, styles); return null; }
    const record = {node, styles, control};
    records.add(record);
    if (!hold) control.then(() => settle(record), () => settle(record));
    return record;
  }
  function clearFlight() {
    if (!flight) return;
    const old = flight; flight = undefined;
    if (old.record) settle(old.record);
    if (old.hidden) restore(old.hidden, old.styles);
    try { old.node.hidePopover(); } catch {}
    old.node.remove();
  }
  function reset() {
    revision++;
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    clearFlight();
    for (const record of [...records]) settle(record);
    for (const node of backgrounds) node.classList.remove('panel-depth-background');
    dialog.classList.remove('panel-spatial');
  }
  function fly(from, to, hidden, direction) {
    if (!active()) return;
    const node = doc.createElement('div');
    // A manual popover sits above the native dialog, escaping its scroll clip
    // and transform. Older browsers keep the fully functional static photos.
    if (typeof node.showPopover !== 'function') return;
    node.className = 'panel-photo-flight'; node.setAttribute('popover', 'manual');
    node.setAttribute('aria-hidden', 'true'); node.inert = true;
    const image = doc.createElement('img');
    image.src = from.src; image.alt = ''; image.draggable = false;
    image.style.objectPosition = from.objectPosition;
    node.append(image);
    Object.assign(node.style, {width: `${to.rect.width}px`, height: `${to.rect.height}px`, borderRadius: to.radius || from.radius});
    doc.body.append(node);
    try { node.showPopover(); } catch { node.remove(); return; }
    const styles = hidden ? snapshot(hidden, ['opacity']) : [];
    if (hidden) hidden.style.opacity = '0';
    const current = {node, hidden, styles}; flight = current;
    const transform = rect => `translate3d(${rect.left}px,${rect.top}px,0) scale(${rect.width / to.rect.width},${rect.height / to.rect.height})`;
    current.record = motion(node, {
      transform: [transform(from.rect), transform(to.rect)],
      opacity: direction === 'in' ? [.95, 1] : [1, 1],
    }, {type: 'spring', bounce: 0, duration: direction === 'in' ? .42 : .34}, true);
    if (!current.record) { clearFlight(); return; }
    current.record.control.then(() => { if (flight === current) clearFlight(); }, () => {
      if (flight === current) clearFlight();
    });
  }
  function enter({source, target, resolveSource} = {}) {
    reset(); returning = undefined;
    // The editor image was just inserted and may not have decoded yet. Its
    // reserved geometry is enough: the arriving image uses the loaded source.
    const from = photo(source), to = photo(target, true);
    link = from && to ? {target, resolveSource: resolveSource || (() => source), lastTarget: to} : undefined;
    if (!dialog.open || !active()) return;
    dialog.classList.add('panel-spatial');
    for (const node of backgrounds) {
      if (!node.isConnected) continue;
      const rect = node.getBoundingClientRect();
      const origin = `50% ${Math.max(0, win.innerHeight * .45 - rect.top)}px`;
      const record = motion(node, {transform: ['none', 'translate3d(0,3px,0) scale(.989)']},
        {type: 'spring', bounce: 0, duration: .3}, true);
      if (record) node.style.transformOrigin = origin;
      node.classList.add('panel-depth-background');
    }
    motion(dialog, {opacity: [.76, 1], transform: ['translate3d(0,10px,0) scale(.99)', 'none']},
      {type: 'spring', bounce: 0, duration: .28});
    if (link) fly(from, to, to.image, 'in');
  }
  function prepareClose() {
    if (returning || !link || !active()) return;
    const current = photo(link.target) || link.lastTarget;
    const moving = flight && bounds(flight.node);
    returning = {...current, rect: moving || current.rect, resolveSource: link.resolveSource};
  }
  function closed() {
    // A close event is queued by the browser. A newer open wins over it.
    if (dialog.open) return;
    // Also supports native method="dialog" forms and unprepared callers.
    prepareClose();
    const pending = returning; returning = undefined; link = undefined;
    reset();
    if (!pending || !active()) return;
    const turn = revision;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      if (turn !== revision || dialog.open || !active()) return;
      let destination;
      // A synchronous menu rerender creates a fresh img even when its URL is
      // unchanged. The loaded editor image can cover that decode interval.
      // Revoked upload previews still require a ready, durable destination.
      try { destination = photo(pending.resolveSource(), !pending.src.startsWith('blob:')); } catch { return; }
      if (destination) {
        // Closing the editor releases its temporary upload preview URL. The
        // saved menu image is the durable resource for the return journey.
        const start = pending.src.startsWith('blob:')
          ? {...pending, src: destination.src, objectPosition: destination.objectPosition} : pending;
        fly(start, destination, destination.image, 'out');
      }
    });
  }
  function stopForEnvironment() { returning = undefined; link = undefined; reset(); }
  dialog.addEventListener('cancel', prepareClose, {signal: listeners.signal});
  dialog.addEventListener('close', closed, {signal: listeners.signal});
  // Scrolling/resizing the editor can invalidate geometry mid-flight. Content
  // wins immediately; its original style is restored before the next frame.
  dialog.addEventListener('scroll', clearFlight, {signal: listeners.signal, passive: true});
  win.addEventListener('resize', clearFlight, {signal: listeners.signal, passive: true});
  reduced.addEventListener('change', stopForEnvironment, {signal: listeners.signal});
  forcedColors.addEventListener('change', stopForEnvironment, {signal: listeners.signal});
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) stopForEnvironment(); }, {signal: listeners.signal});
  win.addEventListener('pagehide', stopForEnvironment, {signal: listeners.signal});
  return {enter, prepareClose, dispose() { if (disposed) return; disposed = true; stopForEnvironment(); listeners.abort(); }};
}
