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
      {arcs.map((a) => {
        const angle = (a.start + a.share / 2) * 2 * Math.PI - Math.PI / 2;
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
