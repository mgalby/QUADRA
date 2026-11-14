import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@phosphor-icons/web/regular/style.css';
import '@phosphor-icons/web/duotone/style.css';
import './styles.css';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { I18nProvider } from './lib/i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);
