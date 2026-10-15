import {createConsentGate} from './consent.mjs';

const text = {
  en: {
    privacy: 'Privacy', terms: 'Terms', choices: 'Privacy choices', nav: 'Legal and privacy',
    title: 'Privacy choices', close: 'Close', essential: 'Essential service storage',
    essentialBody: 'The app uses storage for the service you request, including saved work, language, demo state and this preference. Hosting and sign-in services may also use necessary cookies.',
    optional: 'Optional services are off',
    optionalBody: 'This release has no optional analytics or advertising scripts installed. Nothing optional needs your consent to use this preview.',
    keepOff: 'Keep all off', policy: 'Read the privacy notice',
    saved: 'Saved. Optional services remain off.',
    unsaved: 'Your browser could not save this choice. Optional services remain off for this visit.'
  },
  th: {
    privacy: 'ความเป็นส่วนตัว', terms: 'ข้อกำหนด', choices: 'ตัวเลือกความเป็นส่วนตัว', nav: 'ข้อมูลกฎหมายและความเป็นส่วนตัว',
    title: 'ตัวเลือกความเป็นส่วนตัว', close: 'ปิด', essential: 'พื้นที่จัดเก็บที่จำเป็นต่อบริการ',
    essentialBody: 'แอปใช้พื้นที่จัดเก็บเพื่อให้บริการที่คุณเลือก เช่น งานที่บันทึกไว้ ภาษา สถานะเดโม และตัวเลือกนี้ บริการโฮสติ้งและการเข้าสู่ระบบอาจใช้คุกกี้ที่จำเป็นด้วย',
    optional: 'บริการเสริมปิดอยู่',
    optionalBody: 'เวอร์ชันนี้ไม่ได้ติดตั้งสคริปต์วิเคราะห์การใช้งานหรือโฆษณาที่เป็นบริการเสริม คุณจึงใช้เดโมได้โดยไม่ต้องยินยอมให้เปิดบริการเสริม',
    keepOff: 'ปิดบริการเสริมทั้งหมด', policy: 'อ่านประกาศความเป็นส่วนตัว',
    saved: 'บันทึกแล้ว บริการเสริมยังคงปิดอยู่',
    unsaved: 'เบราว์เซอร์ไม่สามารถบันทึกตัวเลือกนี้ได้ บริการเสริมยังคงปิดอยู่ในการเข้าชมครั้งนี้'
  }
};

export function mountPrivacyControls(doc = document) {
  const win = doc.defaultView;
  // No analytics, advertising, optional pixels or optional embeds are configured.
  const gate = createConsentGate({services: [], events: win});
  let dialog = null, opener = null, savedState = null;
  const language = () => doc.documentElement.lang.toLowerCase().startsWith('th') ? 'th' : 'en';
  const prefix = () => language() === 'th' ? '/th' : '';
  function translate() {
    const t = text[language()];
    for (const nav of doc.querySelectorAll('.soi-legal-footer')) nav.setAttribute('aria-label', t.nav);
    for (const link of doc.querySelectorAll('[data-soi-legal]')) {
      const kind = link.dataset.soiLegal;
      if (!['privacy', 'terms', 'choices'].includes(kind)) continue;
      link.textContent = t[kind];
      link.href = `${prefix()}/${kind === 'terms' ? 'terms' : 'privacy'}${kind === 'choices' ? '#choices' : ''}`;
      if (kind === 'choices') link.setAttribute('aria-haspopup', 'dialog');
    }
    if (!dialog) return;
    for (const node of dialog.querySelectorAll('[data-privacy-copy]')) node.textContent = t[node.dataset.privacyCopy];
    dialog.querySelector('[data-privacy-policy]').href = `${prefix()}/privacy#choices`;
    dialog.querySelector('[role="status"]').textContent = savedState === null ? '' : t[savedState ? 'saved' : 'unsaved'];
  }
  function ensureDialog() {
    if (dialog) return dialog;
    const candidate = doc.createElement('dialog');
    if (typeof candidate.showModal !== 'function') return null;
    candidate.className = 'soi-privacy-dialog';
    candidate.setAttribute('aria-labelledby', 'soi-privacy-title');
    candidate.setAttribute('aria-describedby', 'soi-privacy-description');
    candidate.innerHTML = `<div class="soi-privacy-heading"><h2 id="soi-privacy-title" data-privacy-copy="title"></h2><button type="button" class="soi-privacy-close" data-privacy-copy="close" autofocus></button></div><div class="soi-privacy-body"><h3 data-privacy-copy="essential"></h3><p data-privacy-copy="essentialBody"></p><h3 data-privacy-copy="optional"></h3><p id="soi-privacy-description" data-privacy-copy="optionalBody"></p><a class="soi-privacy-policy" data-privacy-policy data-privacy-copy="policy"></a><div class="soi-privacy-actions"><button type="button" data-privacy-off data-privacy-copy="keepOff"></button></div><p class="soi-privacy-status" role="status" aria-live="polite"></p></div>`;
    candidate.querySelector('.soi-privacy-close').addEventListener('click', () => candidate.close());
    candidate.querySelector('[data-privacy-off]').addEventListener('click', () => {
      savedState = gate.keepAllOff(); translate();
    });
    candidate.addEventListener('close', () => { opener?.isConnected && opener.focus({preventScroll: true}); });
    doc.body.append(candidate);
    dialog = candidate;
    translate();
    return dialog;
  }
  function onClick(event) {
    const trigger = event.target.closest?.('[data-soi-legal="choices"], [data-privacy-open]');
    if (!trigger || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const panel = ensureDialog();
    if (!panel) return; // The static privacy notice remains the no-JS/unsupported fallback.
    opener = trigger;
    savedState = null; translate();
    try { panel.showModal(); event.preventDefault(); }
    catch { /* Leave native link navigation intact. */ }
  }
  translate();
  doc.addEventListener('click', onClick);
  const observer = win?.MutationObserver ? new win.MutationObserver(translate) : null;
  observer?.observe(doc.documentElement, {attributes: true, attributeFilter: ['lang']});
  return () => {
    observer?.disconnect(); doc.removeEventListener('click', onClick);
    dialog?.remove(); gate.dispose();
  };
}

if (typeof document !== 'undefined') {
  let cleanup = mountPrivacyControls(document);
  addEventListener('pagehide', () => cleanup());
  addEventListener('pageshow', event => { if (event.persisted) cleanup = mountPrivacyControls(document); });
}
