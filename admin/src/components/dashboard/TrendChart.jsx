/**
 * Applications-over-time area chart.
 *
 * Hand-built SVG rather than a charting library: this is one series of a dozen
 * points, and Recharts/Chart.js would add 80–200 kB to a bundle that is already
 * over budget. A path and a fill do the whole job.
 *
 * Every point is a real count of applications bucketed by `createdAt`. There is
 * no smoothing that invents values between buckets and no projected trend line —
 * the plot shows what happened, nothing more.
 */

const W = 720;
const H = 180;
const PAD_Y = 14;

function buildPath(values, max) {
  const step = values.length > 1 ? W / (values.length - 1) : W;
  return values.map((v, i) => {
    const x = i * step;
    const y = H - PAD_Y - (max === 0 ? 0 : (v / max) * (H - PAD_Y * 2));
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
}

export default function TrendChart({ buckets, emptyLabel = "No applications yet" }) {
  const values = buckets.map((b) => b.count);
  const total = values.reduce((a, b) => a + b, 0);

  if (!buckets.length || total === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60">
        <p className="text-sm text-slate-500">{emptyLabel}</p>
      </div>
    );
  }

  const max = Math.max(...values);
  const line = buildPath(values, max);
  const area = [...line, `L${W} ${H - PAD_Y}`, `L0 ${H - PAD_Y}`, "Z"].join(" ");
  const peakIndex = values.indexOf(max);

  return (
    <figure className="mt-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-44 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Applications per period. Peak of ${max} in ${buckets[peakIndex]?.label}. ${total} in total.`}
      >
        {/* Baseline + one mid rule. Two rules, not a full grid — a grid on a
            single series is chart-junk that competes with the data. */}
        <g stroke="var(--color-slate-200)" strokeWidth="1" vectorEffect="non-scaling-stroke">
          <line x1="0" y1={H - PAD_Y} x2={W} y2={H - PAD_Y} />
          <line x1="0" y1={(H - PAD_Y) / 2} x2={W} y2={(H - PAD_Y) / 2} strokeDasharray="4 4" />
        </g>

        <path d={area} fill="var(--color-brand-100)" opacity="0.65" />
        <path
          d={line.join(" ")}
          fill="none"
          stroke="var(--color-brand-600)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <figcaption className="mt-2 flex justify-between text-xs tabular-nums text-slate-500">
        <span>{buckets[0]?.label}</span>
        <span className="font-semibold text-slate-600">
          Peak {max} · {buckets[peakIndex]?.label}
        </span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}
