import { useState } from "react";

// Small, dependency-free charts in the Wepluz design system.
// Single series only (so no legend: the card title names it), thin marks,
// recessive axes, a hover tooltip on every mark, and a screen-reader table.

type Point = { label: string; value: number | null; detail?: string };

/** Smooth teal line with a soft area fill. `max` fixes the y-scale (e.g. 100 for percentages). */
export function LineChart({ points, max, format, height = 120, title }: { points: Point[]; max?: number; format: (v: number) => string; height?: number; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 300;
  const H = height;
  const pad = { t: 10, b: 6, x: 6 };
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const top = max ?? Math.max(1, ...values);
  const bottom = max !== undefined ? Math.max(0, Math.min(...values, top) - 10) : 0;
  const x = (i: number) => pad.x + (points.length <= 1 ? 0 : (i * (W - pad.x * 2)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - (v - bottom) / (top - bottom || 1)) * (H - pad.t - pad.b);
  const pts = points.map((p, i) => (p.value === null ? null : ([x(i), y(p.value)] as const))).filter(Boolean) as (readonly [number, number])[];

  // Catmull-Rom to Bezier, clamped to the plot so curves never overshoot the frame.
  const clampY = (v: number) => Math.max(pad.t, Math.min(H - pad.b, v));
  let d = "";
  pts.forEach(([px, py], i) => {
    if (i === 0) d = `M${px},${py}`;
    else {
      const [x0, y0] = pts[i - 2] ?? pts[i - 1];
      const [x1, y1] = pts[i - 1];
      const [x3, y3] = pts[i + 1] ?? [px, py];
      d += ` C${x1 + (px - x0) / 6},${clampY(y1 + (py - y0) / 6)} ${px - (x3 - x1) / 6},${clampY(py - (y3 - y1) / 6)} ${px},${py}`;
    }
  });
  const area = pts.length ? `${d} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z` : "";
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" style={{ height }} preserveAspectRatio="none" role="img" aria-label={title}>
        <defs>
          <linearGradient id="wl-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(46 125 105)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(46 125 105)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill="url(#wl-area)" />}
        {d && <path d={d} fill="none" stroke="rgb(46 125 105)" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {hover !== null && points[hover].value !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H} stroke="rgb(148 163 184)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        {points.map((_, i) => (
          <rect key={i} x={x(i) - W / points.length / 2} y={0} width={W / points.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {h && h.value !== null && (
        <>
          <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand" style={{ left: `${(x(hover!) / W) * 100}%`, top: y(h.value) }} />
          <div className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-xl bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg" style={{ left: `${Math.min(85, Math.max(15, (x(hover!) / W) * 100))}%`, top: -8 - 36 }}>
            <span className="font-semibold">{format(h.value)}</span> · {h.label}
            {h.detail && <span className="block text-white/70">{h.detail}</span>}
          </div>
        </>
      )}
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-400" aria-hidden>
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>{points.map((p) => <tr key={p.label}><th>{p.label}</th><td>{p.value === null ? "no data" : format(p.value)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Sunflower bars on soft tracks. Yellow is low-contrast on the card, so values come with a tooltip and a table toggle. */
export function BarChart({ bars, unit, title, asTable }: { bars: { label: string; value: number }[]; unit: string; title: string; asTable: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  if (asTable) {
    return (
      <table className="w-full text-sm">
        <caption className="sr-only">{title}</caption>
        <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">Class</th><th className="py-1 text-right font-medium">{unit[0].toUpperCase() + unit.slice(1)}</th></tr></thead>
        <tbody className="divide-y divide-white">{bars.map((b) => <tr key={b.label}><td className="py-1.5">{b.label}</td><td className="py-1.5 text-right font-semibold">{b.value}</td></tr>)}</tbody>
      </table>
    );
  }
  return (
    <div className="relative" role="img" aria-label={`${title}: ${bars.map((b) => `${b.label} ${b.value}`).join(", ")}`}>
      <div className="flex h-44 items-end gap-1.5 sm:gap-2">
        {bars.map((b, i) => (
          <div key={b.label} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="relative h-full w-full overflow-hidden rounded-t-md rounded-b-sm bg-white">
              <div className={`absolute inset-x-0 bottom-0 rounded-t-[4px] transition-colors ${hover === i ? "bg-[#E2AE2C]" : "bg-accent"}`} style={{ height: `${(b.value / max) * 100}%` }} />
            </div>
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-xl bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg">
                <span className="font-semibold">{b.value}</span> {unit} · {b.label}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 sm:gap-2" aria-hidden>
        {bars.map((b) => (
          <span key={b.label} className="flex min-w-0 flex-1 justify-center text-[10px] text-slate-500 sm:text-[11px]"><span className="max-h-14 truncate whitespace-nowrap [writing-mode:vertical-rl] rotate-180 sm:max-h-none sm:rotate-0 sm:[writing-mode:horizontal-tb]">{b.label}</span></span>
        ))}
      </div>
    </div>
  );
}
