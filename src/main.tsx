import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@phosphor-icons/web/regular/style.css';
import '@phosphor-icons/web/duotone/style.css';
import './styles.css';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { I18nProvider } from './lib/i18n';
import { registerSW } from 'virtual:pwa-register';

// Aggiornamento automatico: l'app cerca una versione nuova all'apertura, quando si
// torna sulla scheda e ogni ora. Appena la nuova è pronta la pagina si ricarica da sola.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => void registration.update().catch(() => undefined); // senza rete non fa nulla
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    setInterval(check, 60 * 60 * 1000);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);
