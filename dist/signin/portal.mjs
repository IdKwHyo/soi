import {animate} from 'motion';

// Decorative entry around a native link/form: no credential reads or authentication state,
// scrolling lock or dependency on a successful animation to reach the demo.
export function mountSigninPortal(root = document, {animate: play = animate, navigate, now = Date.now} = {}) {
  const doc = root.ownerDocument || root, win = doc.defaultView;
  const scene = root.querySelector('[data-signin-scene]');
  const photo = root.querySelector('[data-signin-photo]');
  const enter = root.querySelector('[data-signin-enter]');
  if (!win || !scene || !photo || !enter) return () => {};
  const form = enter.closest?.('form[data-signin-form]');
  const glass = root.querySelector('[data-signin-glass]');
  const background = root.querySelector('[data-signin-background]');
  const copy = root.querySelector('[data-signin-copy]');
  const status = root.querySelector('[data-signin-status]');
  const skip = root.querySelector('[data-signin-skip]');
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const forced = win.matchMedia('(forced-colors: active)');
  const fine = win.matchMedia('(hover: hover) and (pointer: fine)');
  const listeners = new AbortController(), saved = new Map(), controls = new Set();
  const initialStatus = status?.textContent || '';
  const navigateTo = navigate || (href => win.location.assign(href));
  let disposed = false, pending = false, committed = false, revision = 0;
  let frame = 0, deadline = 0, recovery = 0, flight;
  let pointer = {x: 0, y: 0}, current = {x: 0, y: 0, scroll: 0};
  const active = () => !disposed && !doc.hidden && !reduced.matches && !forced.matches;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const remember = node => {
    if (node && !saved.has(node)) saved.set(node, ['transform', 'opacity', 'will-change'].map(key =>
      [key, node.style.getPropertyValue(key), node.style.getPropertyPriority(key)]));
  };
  const restore = () => {
    for (const [node, properties] of saved) for (const [key, value, priority] of properties)
      value ? node.style.setProperty(key, value, priority) : node.style.removeProperty(key);
    saved.clear();
  };
  function clear({message = initialStatus, eraseEntry = false} = {}) {
    revision++;
    if (frame) win.cancelAnimationFrame(frame);
    if (deadline) win.clearTimeout(deadline);
    if (recovery) win.clearTimeout(recovery);
    frame = deadline = recovery = 0;
    for (const control of controls) { try { control.stop(); } catch {} }
    controls.clear(); flight?.remove(); flight = undefined;
    restore(); pending = committed = false;
    pointer = {x: 0, y: 0}; current = {x: 0, y: 0, scroll: 0};
    enter.removeAttribute('aria-busy');
    if (status) status.textContent = message;
    if (eraseEntry) try { win.sessionStorage.removeItem('soi-demo-entry'); } catch {}
  }
  function paint() {
    frame = 0;
    if (!active() || pending || !scene.isConnected) return;
    const target = {x: fine.matches ? pointer.x : 0, y: fine.matches ? pointer.y : 0,
      scroll: clamp((win.scrollY || 0) / Math.max(1, win.innerHeight * .9), 0, 1)};
    let moving = false;
    for (const key of ['x', 'y', 'scroll']) {
      current[key] += (target[key] - current[key]) * .16;
      if (Math.abs(target[key] - current[key]) > .002) moving = true;
    }
    const depth = fine.matches ? 1 : .45;
    for (const node of [scene, photo, glass, background]) remember(node);
    scene.style.transform = `perspective(1400px) rotateX(${(-current.y * .8 + current.scroll * .5) * depth}deg) rotateY(${current.x * 1.2 * depth}deg)`;
    photo.style.transform = `translate3d(${current.x * -7 * depth}px,${(current.scroll * 27 + current.y * -5) * depth}px,0) scale(1.1)`;
    if (glass) glass.style.transform = `translate3d(${current.x * 12 * depth}px,${(current.y * 8 - current.scroll * 16) * depth}px,0) scale(1.08)`;
    if (background) background.style.transform = `translate3d(${current.x * -3 * depth}px,${current.scroll * 12 * depth}px,0) scale(1.04)`;
    if (moving) frame = win.requestAnimationFrame(paint);
  }
  function requestPaint() {
    if (active() && !pending && !frame) frame = win.requestAnimationFrame(paint);
  }
  function move(event) {
    if (!active() || !fine.matches || pending || event.pointerType === 'touch') return;
    const rect = scene.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    pointer = {x: clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1),
      y: clamp((event.clientY - rect.top) / rect.height * 2 - 1, -1, 1)};
    requestPaint();
  }
  function motion(node, values, options) {
    const control = play(node, values, options);
    controls.add(control);
    return control;
  }
  const errorText = () => status?.dataset.error || (doc.documentElement.lang.startsWith('th')
    ? 'เปิดเดโมไม่สำเร็จ ลองอีกครั้งหรือใช้ลิงก์เปิดเดโมโดยตรง' : 'Could not open the demo. Try again or open the demo directly.');
  function commit(href, turn, withArrival = true) {
    if (disposed || turn !== revision || !pending || committed) return;
    committed = true;
    if (deadline) win.clearTimeout(deadline);
    deadline = 0;
    if (withArrival) try { win.sessionStorage.setItem('soi-demo-entry', String(now())); } catch {}
    try {
      navigateTo(href);
      // A blocked or cancelled navigation must never leave the page covered.
      recovery = win.setTimeout(() => {
        if (turn === revision) clear({eraseEntry: true});
      }, 1800);
    } catch { clear({message: errorText(), eraseEntry: true}); }
  }
  function onEnter(event) {
    if (event.defaultPrevented || (event.button !== undefined && event.button !== 0)
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || (enter.target && enter.target !== '_self') || enter.hasAttribute('download')) return;
    if (pending) { event.preventDefault(); return; }
    if (!active() || photo.complete === false || !photo.naturalWidth || !photo.src) return;
    const sourceRect = scene.getBoundingClientRect();
    const width = win.innerWidth, height = win.innerHeight;
    if (sourceRect.width < 2 || sourceRect.height < 2 || width < 2 || height < 2) return;
    // A short mobile viewport can put the portrait below the button. Enter
    // through a gentle full-screen image reveal instead of flying it uphill.
    const offscreen = sourceRect.bottom <= 0 || sourceRect.top >= height || sourceRect.right <= 0 || sourceRect.left >= width;
    const rect = offscreen ? {left: 0, top: 0, width, height} : sourceRect;
    const duration = offscreen ? .65 : .85;
    const href = form?.getAttribute('action') || enter.getAttribute('href');
    if (!href) return;
    const photoTransform = win.getComputedStyle(photo).transform;
    const sceneStyle = win.getComputedStyle(scene), photoStyle = win.getComputedStyle(photo);
    clear(); pending = true;
    const turn = revision;
    try {
      flight = doc.createElement('div');
      flight.className = 'signin-portal-flight';
      flight.setAttribute('aria-hidden', 'true'); flight.inert = true;
      Object.assign(flight.style, {position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', overflow: 'hidden',
        borderRadius: offscreen ? '0px' : sceneStyle.borderRadius || '28px', transformOrigin: '50% 50%',
        pointerEvents: 'none', zIndex: '1000', background: '#dce4db', willChange: 'transform'});
      const image = doc.createElement('img');
      image.src = photo.currentSrc || photo.src; image.alt = ''; image.draggable = false;
      Object.assign(image.style, {position: 'absolute', inset: '-5%', display: 'block', width: '110%', height: '110%', objectFit: 'cover',
        objectPosition: photoStyle.objectPosition || '50% 50%',
        transform: offscreen ? 'scale(.92)' : photoTransform === 'none' ? 'scale(1.1)' : photoTransform});
      const light = doc.createElement('div');
      Object.assign(light.style, {position: 'absolute', inset: '0', background: '#f5f3ec', opacity: '0'});
      flight.append(image, light); doc.body.append(flight);
      // Construct before cancelling the native link. Any unsupported animation
      // can immediately hand off to the same destination below.
      event.preventDefault();
      enter.setAttribute('aria-busy', 'true');
      if (status) status.textContent = status.dataset.entering || (doc.documentElement.lang.startsWith('th') ? 'กำลังเปิดเดโม' : 'Opening the demo');
      const scale = Math.max(width / rect.width, height / rect.height);
      const x = width / 2 - (rect.left + rect.width / 2), y = height / 2 - (rect.top + rect.height / 2);
      if (copy) { remember(copy); motion(copy, {opacity: [1, .12]}, {duration: .34, ease: 'easeOut'}); }
      motion(light, {opacity: [0, .1]}, {duration, ease: 'easeInOut'});
      motion(image, {transform: [image.style.transform, 'scale(.941)']}, {duration, ease: [.5, 0, .15, 1]});
      const control = motion(flight, {transform: ['translate3d(0,0,0) scale(1)', `translate3d(${x}px,${y}px,0) scale(${scale})`],
        ...(offscreen ? {opacity: [0, 1]} : {}),
        borderRadius: [offscreen ? '0px' : sceneStyle.borderRadius || '28px', '0px']}, {duration, ease: [.5, 0, .15, 1]});
      deadline = win.setTimeout(() => commit(href, turn), 1000);
      control.then(() => commit(href, turn), () => commit(href, turn, false));
    } catch {
      if (event.defaultPrevented) commit(href, turn, false);
      else clear();
    }
  }
  const passive = {signal: listeners.signal, passive: true};
  (form || enter).addEventListener(form ? 'submit' : 'click', onEnter, {signal: listeners.signal});
  skip?.addEventListener('click', () => clear({eraseEntry: true}), {signal: listeners.signal});
  scene.addEventListener('pointermove', move, passive);
  scene.addEventListener('pointerleave', () => { pointer = {x: 0, y: 0}; requestPaint(); }, passive);
  win.addEventListener('scroll', requestPaint, passive);
  win.addEventListener('resize', () => { clear({eraseEntry: true}); requestPaint(); }, passive);
  doc.addEventListener('keydown', event => { if (pending && event.key === 'Escape') { clear(); requestPaint(); } }, {signal: listeners.signal});
  doc.addEventListener('visibilitychange', () => {
    // Browsers may hide the outgoing document before pagehide. Preserve the
    // arrival marker in that order; a later return clears any stale handoff.
    clear({eraseEntry: !(doc.hidden && committed)}); requestPaint();
  }, passive);
  for (const query of [reduced, forced, fine]) query.addEventListener('change', () => { clear({eraseEntry: true}); requestPaint(); }, passive);
  win.addEventListener('pagehide', () => clear(), passive);
  requestPaint();
  return () => { if (disposed) return; disposed = true; clear(); listeners.abort(); };
}
