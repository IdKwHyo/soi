/* This flag controls decoration only. It never creates an authenticated session. */
(()=>{try{
  const stamp=Number(sessionStorage.getItem('soi-demo-entry'));
  sessionStorage.removeItem('soi-demo-entry');
  const elapsed=Date.now()-stamp;
  if(['/demo','/versionc/demo'].includes(location.pathname.replace(/\/$/,''))&&stamp>0&&elapsed>=0&&elapsed<15000&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&!matchMedia('(forced-colors: active)').matches){
    document.documentElement.dataset.portalArrival='waiting';
  }
}catch{}})();
