import { useI18n } from '../lib/i18n';
import type { Basis } from '../lib/basis';

/** Interruttore Competenza / Cassa: vale per Home, statistiche ed elenco dei movimenti. */
export function BasisToggle({ basis, setBasis }: { basis: Basis; setBasis: (b: Basis) => void }) {
  const { t } = useI18n();
  return (
    <div className="segmented basis" role="group" aria-label={t('basis.title')}>
      {(['accrual', 'cash'] as Basis[]).map((b) => (
        <button key={b} type="button" aria-pressed={basis === b} onClick={() => setBasis(b)}>
          {t(`basis.${b}`)}
        </button>
      ))}
    </div>
  );
}
