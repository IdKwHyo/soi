import {animate} from 'motion';

// C's content arrives in small architectural layers. Nothing is hidden before
// enhancement, and scrolling back never takes already-read content away.
export function createChoreography({reducedMotion = false} = {}) {
  const records = new Map();
  const waiting = new Map();
  const seen = new Set();
  const listeners = new AbortController();
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  let observer, previousView, previousStep, currentView, suspended = false, destroyed = false;

  const reduced = () => typeof reducedMotion === 'function'
    ? Boolean(reducedMotion())
    : typeof reducedMotion === 'object' ? Boolean(reducedMotion?.matches) : Boolean(reducedMotion);
  const active = () => !destroyed && !suspended && !document.hidden && !reduced();
  const restore = (element, styles) => {
    for (const [property, value, priority] of styles) {
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    }
  };
  const settle = element => {
    const record = records.get(element);
    if (!record) return;
    records.delete(element);
    try { record.control.stop(); } catch {}
    restore(element, record.styles);
  };
  const release = () => {
    observer?.disconnect();
    observer = undefined;
    waiting.clear();
    for (const element of records.keys()) settle(element);
  };
  const interacted = element => element.contains(document.activeElement)
    || (finePointer.matches && element.matches(':hover'));

  function arrive(element, delay = 0, small = false) {
    if (!active() || !element.isConnected || element.hidden || interacted(element)) return;
    const styles = ['transform', 'transform-origin', 'opacity', 'will-change'].map(property =>
      [property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
    const computed = getComputedStyle(element);
    const restingTransform = computed.transform === 'none' ? '' : computed.transform;
    const opacity = Number.parseFloat(computed.opacity) || 1;
    const travel = (small ? 8 : 22) * (finePointer.matches ? 1 : .5);
    const angle = small ? 0 : finePointer.matches ? 2.2 : .6;
    const from = `perspective(1000px) translate3d(0,${travel}px,${small ? 0 : -14}px) rotateX(${angle}deg) scale(${small ? 1 : .994}) ${restingTransform}`;
    const to = `perspective(1000px) translate3d(0,0,0) rotateX(0deg) scale(1) ${restingTransform}`;
    element.style.transformOrigin = '50% 0%';
    element.style.willChange = 'transform, opacity';
    let control;
    try {
      control = animate(element, {transform: [from, to], opacity: [opacity * .78, opacity]}, {
        duration: small ? .34 : .48,
        delay: Math.min(delay, small ? .14 : .09),
        ease: [.16, 1, .3, 1],
      });
    } catch {
      restore(element, styles);
      return;
    }
    const record = {control, styles};
    records.set(element, record);
    // A canceled or superseded transition cannot restore a newer transition.
    control.then(() => { if (records.get(element) === record) settle(element); }, () => {
      if (records.get(element) === record) settle(element);
    });
  }

  function targets(container, view, stepOnly) {
    const result = [];
    const add = (selector, {small = false, base = 0, interval = .045} = {}) => {
      container.querySelectorAll(selector).forEach((element, index) => {
        // Select siblings rather than animating a region and its own children.
        if (element.closest('[data-receipt-story]') || result.some(item => item.element === element || item.element.contains(element) || element.contains(item.element))) return;
        result.push({element, key: `${selector}:${index}`, small, delay: base + index * interval});
      });
    };
    if (view === 'workflow') {
      if (!stepOnly) {
        add('.flow-header', {small: true});
        add('.flow-rail li', {small: true, base: .025, interval: .02});
      }
      add('.flow-step-header', {small: true, base: stepOnly ? 0 : .045});
      add('.flow-panel > form, .flow-panel > .flow-financial-block, .flow-panel > .flow-money-list, .flow-panel > .flow-outcome-history', {base: .085});
      // AI review and empty steps have no form; their useful actions still arrive.
      add('.flow-panel > .flow-mode, .flow-panel > .flow-primary-actions, .flow-panel > .flow-actions', {small: true, base: .09, interval: .025});
    } else if (view === 'overview') {
      add('.overview-topline', {small: true});
      // The mountain owns its camera motion; copy arrives in a short sequence
      // beside it without moving the controls again after first interaction.
      add('.hero-copy > h1', {small: true, base: .02});
      add('.hero-copy > .studio-report-period', {small: true, base: .065});
      add('.hero-copy > .button-row', {small: true, base: .11});
      add('.metric-ribbon > .metric', {small: true, base: .065, interval: .025});
      add('.overview-workflow > .story-head', {small: true});
      add('.merchant-step-list > li', {small: true, base: .04, interval: .02});
      add('.overview-evidence > section > .story-head, .overview-evidence > aside > .story-head', {small: true});
      add('.overview-evidence > section > .story-body, .overview-evidence > aside > .saved-work-list', {base: .055, interval: .025});
      add('.overview-evidence > aside > .text-button', {small: true, base: .1});
    } else {
      add('.view-header', {small: true});
      add('.metric-ribbon > .metric', {small: true, base: .04, interval: .025});
      add('.content-split > section, .content-split > .section-stack > section, .content-split > aside:not(.section-stack), .advisor-layout > section, .advisor-layout > aside', {base: .045});
      add(':scope > .section-stack > section, :scope > section.surface', {base: .06});
    }
    return result;
  }

  function observe() {
    if (!active() || typeof IntersectionObserver !== 'function') return;
    observer = new IntersectionObserver(entries => {
      let order = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const item = waiting.get(entry.target);
        if (!item) continue;
        waiting.delete(entry.target);
        observer?.unobserve(entry.target);
        seen.add(item.key);
        arrive(entry.target, Math.min(item.delay + order++ * .02, .12), item.small);
      }
    }, {threshold: 0, rootMargin: '0px 0px -24px 0px'});
  }

  function update(view = currentView) {
    if (destroyed) return;
    const container = document.getElementById('view');
    currentView = view;
    release();
    if (!container) return;
    const step = container.querySelector('.merchant-flow')?.dataset.flowCurrent || '';
    const newView = view !== previousView;
    const newStep = view === 'workflow' && !newView && step !== previousStep;
    if (newView) seen.clear();
    if (newStep) for (const key of seen) if (!key.startsWith('.flow-header:') && !key.startsWith('.flow-rail li:')) seen.delete(key);
    previousView = view;
    previousStep = step;
    if (!active()) return;
    observe();
    for (const item of targets(container, view, newStep)) {
      if (seen.has(item.key) || item.element.closest('[hidden], dialog:not([open])')) continue;
      const rect = item.element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const onScreen = rect.top < innerHeight - 24 && rect.bottom > 0;
      if (onScreen || rect.bottom <= 0) {
        seen.add(item.key);
        // Saving, translating, chat replies and formula edits replace markup.
        // Only a genuine route/step change earns another entry sequence.
        if (onScreen && (newView || newStep)) arrive(item.element, item.delay, item.small);
      } else if (observer) {
        waiting.set(item.element, item);
        observer.observe(item.element);
      }
    }
  }

  function settleTarget(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    for (const element of records.keys()) if (element.contains(target)) settle(element);
    for (const [element, item] of waiting) if (element.contains(target)) {
      seen.add(item.key);
      waiting.delete(element);
      observer?.unobserve(element);
    }
  }

  // A pointer, keyboard focus or input wins over decorative motion instantly.
  // Press animations belong to motion.mjs and are not touched here.
  for (const event of ['pointerover', 'pointerdown', 'focusin', 'input']) {
    document.addEventListener(event, settleTarget, {signal: listeners.signal, passive: true});
  }
  if (reducedMotion && typeof reducedMotion.addEventListener === 'function') {
    reducedMotion.addEventListener('change', () => {
      release();
      if (!reduced()) update(currentView);
    }, {signal: listeners.signal});
  }

  return {
    update,
    suspend() { suspended = true; release(); },
    resume(view = currentView) { if (!destroyed) { suspended = false; update(view); } },
    destroy() { destroyed = true; release(); listeners.abort(); seen.clear(); },
  };
}
