// Service worker minimal : pas de cache agressif, on veut toujours les
// dernieres donnees financieres. Sert surtout a satisfaire les criteres
// d'installabilite PWA quand l'appli tourne en HTTPS (ou sur un vrai domaine).
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

// Pass-through : on ne cache rien, on laisse toujours passer au reseau.
self.addEventListener('fetch', () => {});
