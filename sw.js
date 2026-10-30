/* MARS CRM v90.46 — network-first only for the app HTML. CRM customer records and files are NEVER cached by this worker. */
const SHELL_CACHE = 'mars-crm-html-network-first-v9046';
const APP_ROOT = new URL('./', self.location.href);
const APP_INDEX = new URL('./index.html', self.location.href);
self.addEventListener('install', function(event){ event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', function(event){ event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(event){
  const req=event.request;
  if(req.method!=='GET' || req.mode!=='navigate') return;
  const url=new URL(req.url);
  if(url.origin!==APP_ROOT.origin || !url.pathname.startsWith(APP_ROOT.pathname))return;
  event.respondWith((async function(){
    try {
      const response=await fetch(req, {cache:'no-store'});
      if(response.ok && (url.pathname===APP_ROOT.pathname || url.pathname===APP_INDEX.pathname)){
        // Keep only the public HTML shell as an offline fallback. Do not cache authenticated API traffic.
        try {const cache=await caches.open(SHELL_CACHE);await cache.put(APP_INDEX.href,response.clone());}catch(_e){}
      }
      return response;
    } catch(err) {
      const cache=await caches.open(SHELL_CACHE);
      const fallback=await cache.match(APP_INDEX.href);
      if(fallback)return fallback;
      return Response.error();
    }
  })());
});
