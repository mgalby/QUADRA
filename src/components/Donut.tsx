import type { ReactNode } from 'react';

export interface DonutSlice {
  key: string;
  share: number;          // 0..1
  scheduledShare: number; // parte programmata, dentro share
  color: string;
  icon: string;           // nome icona Phosphor
  label: string;          // per chi usa lo screen reader: "Casa, 28%"
}

const SIZE = 310;
const C = SIZE / 2;
const R = 88;
const LEN = 2 * Math.PI * R;
const ICON_R = 136;
const ICON = 38;
const MIN_GAP = 0.36; // distanza minima tra due icone, in radianti

/** Ciambella delle uscite per macro, con le icone intorno. */
export function Donut({ slices, onSelect, label, children }: {
  slices: DonutSlice[];
  onSelect: (key: string) => void;
  label: string;
  children: ReactNode;
}) {
  let start = 0;
  const arcs = slices.map((s) => {
    const arc = { ...s, start };
    start += s.share;
    return arc;
  });

  // le icone degli spicchi piccoli non devono sovrapporsi: si allontanano di poco dalla loro posizione
  const angles = arcs.map((a) => (a.start + a.share / 2) * 2 * Math.PI - Math.PI / 2);
  if (angles.length * MIN_GAP <= 2 * Math.PI) {
    for (let pass = 0; pass < 40; pass++) {
      for (let i = 0; i < angles.length; i++) {
        const j = (i + 1) % angles.length;
        let d = angles[j] - angles[i];
        if (j === 0) d += 2 * Math.PI;
        if (d < MIN_GAP) {
          const push = (MIN_GAP - d) / 2;
          angles[i] -= push;
          angles[j] += push;
        }
      }
    }
  }

  return (
    <div className="donut" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}>
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line)" strokeWidth="30" />
        {arcs.map((a) => {
          const solid = a.share - a.scheduledShare;
          return (
            <g key={a.key} transform={`rotate(-90 ${C} ${C})`} fill="none" stroke={a.color} strokeWidth="30">
              {solid > 0 && <circle cx={C} cy={C} r={R} strokeDasharray={`${solid * LEN} ${LEN}`} strokeDashoffset={-a.start * LEN} />}
              {/* la parte programmata è più chiara */}
              {a.scheduledShare > 0 && (
                <circle cx={C} cy={C} r={R} strokeOpacity="0.38" strokeDasharray={`${a.scheduledShare * LEN} ${LEN}`} strokeDashoffset={-(a.start + solid) * LEN} />
              )}
            </g>
          );
        })}
      </svg>
      {arcs.map((a, i) => {
        const angle = angles[i];
        return (
          <button
            key={a.key}
            type="button"
            className="donut-icon"
            aria-label={a.label}
            onClick={() => onSelect(a.key)}
            style={{
              left: C + ICON_R * Math.cos(angle) - ICON / 2,
              top: C + ICON_R * Math.sin(angle) - ICON / 2,
              background: `${a.color}2E`,
              color: a.color,
            }}
          >
            <i className={`ph-duotone ph-${a.icon}`} aria-hidden="true" />
          </button>
        );
      })}
      <div className="donut-center">{children}</div>
    </div>
  );
}
