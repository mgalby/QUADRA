import { useMemo } from 'react';
import { byMacro, guideShares, monthIndex, readBudget, type LineReading } from '../lib/budget';
import { useBudgetData } from '../lib/budgetData';
import type { QuadraDB } from '../lib/db';
import { todayISO } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import type { Nav } from '../lib/nav';
import { LineFacts, MonthStrip, Numbers, UseBar } from './Budget';

/** Dettaglio di una macro nella lettura: previsioni per categoria, tetto comune e tetti dedicati. */
export function BudgetMacro({ db, master, nav, year, macroId, currency }: {
  db: QuadraDB;
  master: MasterData;
  nav: Nav;
  year: number;
  macroId: string;
  currency: string;
}) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const data = useBudgetData(db, year, today, master.categoryById);
  const money = (cents: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0, useGrouping: 'always' }).format(cents / 100);
  const group = useMemo(() => {
    if (!data.budget) return null;
    const r = readBudget(data.budget, data.lines, master.categoryById, master.macroById, data.actuals, today);
    return byMacro(r, master.macros, master.categoryById).find((g) => g.macro.id === macroId) ?? null;
  }, [data, master, today, macroId]);

  const macro = master.macroById.get(macroId);
  const catName = (id: string) => master.categoryById.get(id)?.name ?? '?';

  const lineCard = (lr: LineReading, title: string, tag: string) => {
    const shares = lr.nature === 'common' ? guideShares(lr.members, data.refs, year - 1) : null;
    return (
      <section key={lr.line.id} className="card">
        <div className="row"><span className="strong small">{title}</span><span className="badge">{tag}</span></div>
        <Numbers budget={lr.budget} actual={lr.actual} committed={lr.committed} available={lr.available} money={money} />
        <UseBar budget={lr.budget} actual={lr.actual} committed={lr.committed} color={macro?.color ?? 'var(--accent)'} over={lr.available < 0} />
        {lr.available < 0 && lr.nature === 'dedicated' && <span className="bu-alert tiny"><i className="ph ph-warning" aria-hidden="true" /> {t('bu.overDedicatedLong')}</span>}
        <LineFacts lr={lr} money={money} />
        {(lr.nature === 'common' || lr.nature === 'dedicated') && <MonthStrip lr={lr} nowMonth={monthIndex(year, today)} money={money} locale={locale} />}
        {shares && lr.members.map((id) => (
          <div key={id} className="row bu-fact">
            <span className="small muted">{catName(id)}{shares.get(id) ? <span className="tiny"> · {t('bu.guide', { pct: Math.round(shares.get(id)! * 100) })}</span> : null}</span>
            <span className="num small">{money(data.actuals.actual.get(id) ?? 0)}</span>
          </div>
        ))}
        {lr.line.distribution && lr.line.distribution !== 'flat' && <p className="muted tiny">{t(`bu.dist.has.${lr.line.distribution}`)}</p>}
        <button type="button" className="ghost" onClick={() => nav.go({ name: 'budgetLine', id: lr.line.id })}>{t('bu.openLine')}</button>
      </section>
    );
  };

  return (
    <main className="page">
      <header className="topbar">
        <button type="button" className="ghost" onClick={nav.back}>{t('common.back')}</button>
        <h1>{macro?.name ?? ''}</h1>
        <span className="muted small" style={{ width: 64, textAlign: 'right' }}>{year}</span>
      </header>
      {!group ? (
        <p className="muted small empty">{t('bu.macro.none')}</p>
      ) : (
        <>
          <section className="card">
            <Numbers budget={group.budget} actual={group.actual} committed={group.committed} available={group.available} money={money} />
            <UseBar budget={group.budget} actual={group.actual} committed={group.committed} color={macro?.color ?? 'var(--accent)'} over={!!group.overCap} />
          </section>
          {group.forecast.length > 0 && <h3>{t('bu.part.forecast')}</h3>}
          {group.forecast.map((lr) => lineCard(lr, catName(lr.line.category_id!), t('bu.nature.forecast')))}
          {group.caps.length > 0 && <h3>{t('bu.part.cap')}</h3>}
          {group.caps.map((lr) => lineCard(lr, lr.nature === 'common' ? t('bu.commonCap') : catName(lr.line.category_id!), t(`bu.nature.${lr.nature}`)))}
          <p className="muted tiny">{t('bu.macro.hint')}</p>
        </>
      )}
    </main>
  );
}
