// Service worker da Coleta: funciona offline e recebe arquivos pelo "Compartilhar" do Android.
const CACHE = 'coleta-v7';
const ARQS = ['./', './index.html', './gravador.js', './hash.js', './verificar.html', './manifest.webmanifest', './icone-192.png', './icone-512.png', './icone-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
function abrirDB(){ return new Promise((ok, er) => { const r = indexedDB.open('coleta', 2); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('recebidos')) d.createObjectStore('recebidos'); if (!d.objectStoreNames.contains('gravacoes')) d.createObjectStore('gravacoes', { keyPath: 'id' }); }; r.onsuccess = () => ok(r.result); r.onerror = er; }); }
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.pathname.endsWith('/receber')) {
    e.respondWith((async () => {
      const fd = await e.request.formData();
      const fs = fd.getAll('arquivos').filter(f => f && f.name);
      const db = await abrirDB();
      await new Promise((ok, er) => { const tx = db.transaction('recebidos', 'readwrite'); tx.objectStore('recebidos').put(fs, 'ultimo'); tx.oncomplete = ok; tx.onerror = er; });
      return Response.redirect('./?compartilhado=1', 303);
    })());
    return;
  }
  if (e.request.method === 'GET' && u.origin === location.origin) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
