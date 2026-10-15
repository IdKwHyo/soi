import {legalContent,policyDate} from './legal-content.mjs';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function renderLegalPage(kind,language='en') {
 const doc=legalContent[language]?.[kind];if(!doc)throw Error('Unknown legal document');
 const th=language==='th',prefix=th?'/th':'',other=th?'en':'th',otherUrl=(other==='th'?'/th':'')+'/'+kind;
 return `<!doctype html>
<html lang="${language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#f7f5ef"><meta name="description" content="${escape(doc.intro)}"><title>${escape(doc.title)} — Soi Studio</title><link rel="alternate" hreflang="en" href="/${kind}"><link rel="alternate" hreflang="th" href="/th/${kind}"></head>
<body class="soi-legal-page"><a class="soi-legal-skip" href="#legal-main">${th?'ข้ามไปยังเนื้อหา':'Skip to content'}</a>
<header class="soi-legal-header"><a href="/demo#overview" class="soi-legal-brand">Soi Studio</a><nav aria-label="${th?'ภาษาและการนำทาง':'Language and navigation'}"><a href="${otherUrl}" lang="${other}" hreflang="${other}">${th?'English':'ไทย'}</a><a href="/demo#overview">${th?'กลับสู่เดโม':'Back to demo'}</a></nav></header>
<main id="legal-main" class="soi-legal-main" tabindex="-1"><p class="soi-legal-kicker">${th?'รุ่นทดลอง':'Preview'} · ${policyDate[language]}</p><h1>${escape(doc.title)}</h1><p class="soi-legal-intro">${escape(doc.intro)}</p><p class="soi-legal-notice">${escape(doc.note)}</p>
${doc.sections.map(([title,paragraphs,id],index)=>`<section id="${id||'section-'+(index+1)}"><h2>${escape(title)}</h2>${paragraphs.map(p=>`<p>${escape(p)}</p>`).join('')}${id==='choices'?`<p><a href="${prefix}/privacy#choices" data-soi-legal="choices">${th?'เปิดตัวเลือกความเป็นส่วนตัว':'Open privacy choices'}</a></p>`:''}</section>`).join('\n')}
<p class="soi-legal-related"><a href="${prefix}/${kind==='privacy'?'terms':'privacy'}">${kind==='privacy'?(th?'อ่านข้อกำหนดการใช้บริการ':'Read the Terms of Service'):(th?'อ่านนโยบายความเป็นส่วนตัว':'Read the Privacy Policy')}</a></p></main></body></html>`;
}
