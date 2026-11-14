import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useI18n, type MsgKey } from '../lib/i18n';

export function Login() {
  const { signIn } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MsgKey | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    if (result !== 'ok') setError(`login.error.${result}`);
    setBusy(false);
  }

  return (
    <main className="login">
      <div className="brand">
        <img src="/icons/favicon.svg" alt="" width="56" height="56" />
        <h1>Quadra</h1>
        <p className="muted">{t('app.tagline')}</p>
      </div>

      <form onSubmit={onSubmit} className="card form">
        <label>
          <span>{t('login.email')}</span>
          <input
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          <span>{t('login.password')}</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? t('login.busy') : t('login.submit')}
        </button>
      </form>

      <p className="muted small center">{t('login.invite')}</p>
    </main>
  );
}
