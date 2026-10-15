import {mountSigninPortal} from './portal.mjs';

const picker=document.querySelector('#signin-language');
let language='en';
try{language=localStorage.getItem('soi-language')==='th'?'th':'en';}catch{}
function translate(){
  document.documentElement.lang=language;
  document.title=language==='th'?'Soi Studio — เข้าสู่พื้นที่ทำงาน':'Soi Studio — Sign in';
  picker.value=language;
  for(const element of document.querySelectorAll('[data-en][data-th]'))element.textContent=element.dataset[language];
  for(const element of document.querySelectorAll('[data-en-alt][data-th-alt]'))element.alt=language==='th'?element.dataset.thAlt:element.dataset.enAlt;
  for(const element of document.querySelectorAll('[data-en-aria][data-th-aria]'))element.setAttribute('aria-label',language==='th'?element.dataset.thAria:element.dataset.enAria);
}
picker.addEventListener('change',()=>{
  language=picker.value==='th'?'th':'en';
  try{localStorage.setItem('soi-language',language);localStorage.setItem('soi-copilot-language',language);}catch{}
  translate();
});
translate();
let stop=mountSigninPortal(document);
window.addEventListener('pagehide',()=>{stop();document.querySelector('[data-signin-form]')?.reset();});
window.addEventListener('pageshow',event=>{if(event.persisted){translate();stop=mountSigninPortal(document);}});
