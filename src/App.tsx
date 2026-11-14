import { useAuth } from './auth/AuthProvider';
import { useI18n } from './lib/i18n';
import { isConfigured } from './lib/supabase';
import { Home } from './pages/Home';
import { Login } from './pages/Login';

export function App() {
  const { session } = useAuth();
  const { t } = useI18n();

  if (!isConfigured) {
    return (
      <main className="login">
        <div className="card">
          <h2>{t('config.title')}</h2>
          <p className="muted">{t('config.body')}</p>
        </div>
      </main>
    );
  }
  if (session === undefined) return <main className="login" aria-busy="true" />;
  if (session === null) return <Login />;
  return <Home userId={session.user.id} email={session.user.email ?? ''} />;
}
