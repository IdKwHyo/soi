// One visual experience, with separate private and simulated modes.
export function routeContext(pathname='/') {
  const path=pathname.replace(/\/$/,'')||'/';
  const version='c';
  const demo=['/demo','/versiona/demo','/versionb/demo','/versionc/demo'].includes(path);
  return {version,demo};
}
export function editionPath(version='c',demo=false,view='overview') {
  if(!['a','b','c'].includes(version))throw Error('Unknown visual edition.');
  const hash=view&&/^[a-z-]+$/.test(view)?'#'+view:'';
  return (demo?'/demo':'/')+hash;
}
export const currentRoute=routeContext(globalThis.location?.pathname||'/');
export const demoPath=(view='')=>editionPath(currentRoute.version,true,view);
export const fullPath=(view='')=>editionPath(currentRoute.version,false,view);
export function renderEditionSwitcher(language,view,demo=currentRoute.demo){
  const th=language==='th';
  const orderPath=`/copilot${demo?'/demo':''}#order`;
  return `<nav class="studio-shortcuts" aria-label="${th?'เครื่องมือร้านค้า':'Merchant tools'}"><a class="studio-shortcut studio-shortcut-order" data-edition-link href="${orderPath}">${th?'เมนูออเดอร์':'Order menu'}</a><a class="studio-shortcut studio-shortcut-ai" data-edition-link href="/copilot/demo#ai">${th?'เดโม AI':'AI demo'}</a></nav><nav class="studio-mode-switch" aria-label="${th?'โหมดการใช้งาน':'Workspace mode'}">${[false,true].map(isDemo=>`<a class="studio-mode-link" data-edition-link href="${editionPath('c',isDemo,view)}"${isDemo===demo?' aria-current="page"':''}>${isDemo?(th?'เดโมจำลอง':'Simulated demo'):(th?'แอปเต็ม':'Full app')}</a>`).join('')}</nav>`;
}
