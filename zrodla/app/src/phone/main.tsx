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
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* bez trybu offline */ });
}
