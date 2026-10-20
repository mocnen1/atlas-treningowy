import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/saira-condensed/latin-700.css';
import '@fontsource/saira-condensed/latin-ext-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './phone.css';
import { PhoneApp } from './PhoneApp';

createRoot(document.getElementById('root')!).render(<StrictMode><PhoneApp /></StrictMode>);

// Praca bez internetu: service worker trzyma kopię aplikacji w telefonie.
// Aktualizacje: sprawdzamy przy każdym powrocie do aplikacji; gdy nowa wersja przejmie stronę, aplikacja dostaje zdarzenie 'atlas-update'.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => { /* brak internetu */ });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60_000);
  }).catch(() => { /* bez trybu offline */ });
  let fired = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || fired) return; // pierwsza instalacja – nie ma czego odświeżać
    fired = true;
    window.dispatchEvent(new Event('atlas-update'));
  });
}
