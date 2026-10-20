import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/saira-condensed/latin-500.css';
import '@fontsource/saira-condensed/latin-ext-500.css';
import '@fontsource/saira-condensed/latin-700.css';
import '@fontsource/saira-condensed/latin-ext-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';
import { StoreProvider } from './store/store';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode><StoreProvider><App /></StoreProvider></StrictMode>,
);
