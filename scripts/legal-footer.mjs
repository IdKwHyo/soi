const copy = {
  en: ['Privacy', 'Terms', 'Privacy choices', 'Legal and privacy'],
  th: ['ความเป็นส่วนตัว', 'ข้อกำหนด', 'ตัวเลือกความเป็นส่วนตัว', 'ข้อมูลกฎหมายและความเป็นส่วนตัว']
};

export function renderLegalFooter(language = 'en') {
  const isThai = language.toLowerCase().startsWith('th');
  const [privacy, terms, choices, label] = copy[isThai ? 'th' : 'en'];
  const prefix = isThai ? '/th' : '';
  return `<nav class="soi-legal-footer" aria-label="${label}"><a data-soi-legal="privacy" href="${prefix}/privacy">${privacy}</a><a data-soi-legal="terms" href="${prefix}/terms">${terms}</a><a data-soi-legal="choices" href="${prefix}/privacy#choices">${choices}</a></nav>`;
}
