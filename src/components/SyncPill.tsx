import { useI18n } from '../lib/i18n';
import { useSyncState } from '../lib/sync';

/** Compare solo quando c'è qualcosa da sapere: offline, movimenti in attesa, errori. */
export function SyncPill({ pending, onClick }: { pending: number; onClick: () => void }) {
  const { t } = useI18n();
  const sync = useSyncState();
  let text: string | null = null;
  if (sync.status === 'error') text = t('sync.error.short');
  else if (sync.status === 'offline') text = pending ? t('sync.offline.pending', { n: pending }) : t('sync.offline');
  else if (pending) text = t('sync.pending', { n: pending });
  if (!text) return null;
  return (
    <button type="button" className={`pill ${sync.status}`} onClick={onClick}>
      <span className="dot" aria-hidden="true" /> {text}
    </button>
  );
}
