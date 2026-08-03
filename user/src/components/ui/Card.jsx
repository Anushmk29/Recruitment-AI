/**
 * Shared surfaces. Every candidate screen composes from these, so a change here
 * lands on all of them at once.
 *
 * Kept in step with admin/src/components/ui/Card.jsx — see DESIGN.md § Do's
 * ("keep the two frontends' UI kits identical").
 */

/**
 * Card tones.
 *
 * `default` is the workhorse and stays white — a dashboard full of tinted
 * panels has no hierarchy left to spend. The tinted and filled tones are for
 * *grouping and emphasis*, which is the one thing they are allowed to mean.
 *
 * There is deliberately no `positive` / `pending` / `negative` tone here. A
 * whole card washed in a verdict colour reads as "this candidate is a
 * rejection" long before anyone gets to the sentence explaining why, and the
 * moment a card can be green the Reserved Verdict Rule stops holding. Outcome
 * is stated by <Badge>, on the specific claim it applies to.
 */
const cardTones = {
  default: "border-slate-200 bg-white",
  brand: "border-brand-100 surface-brand",
  ember: "border-accent-100 surface-ember",
  // Filled tones invert to white text. Both gradients are pinned so their
  // lightest stop already clears 4.5:1 against white (see index.css), which is
  // what lets 12px metadata sit anywhere on these surfaces — including the top
  // corner, where a brighter stop would have failed.
  "filled-brand": "border-transparent fill-brand text-white",
  "filled-ember": "border-transparent fill-ember text-white",
};

export function Card({
  children,
  className = "",
  as: Component = "div",
  interactive = false,
  tone = "default",
  ...props
}) {
  // `interactive` is opt-in: a card that lifts on hover but does nothing when
  // clicked is a false affordance. Only pass it when the whole card is a target.
  return (
    <Component
      className={`rounded-2xl border p-6 shadow-card ${cardTones[tone] ?? cardTones.default} ${
        interactive
          ? "transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lift motion-reduce:hover:translate-y-0"
          : ""
      } ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}

/**
 * The rounded icon chip from the reference deck — a feature marker, not a status
 * light. `brand` is the default because ember is rationed (see below).
 */
const tileTones = {
  brand: "bg-brand-100 text-brand-700",
  ember: "bg-accent-100 text-accent-700",
  slate: "bg-slate-100 text-slate-600",
  "on-fill": "bg-white/15 text-white",
};

const tileSizes = {
  sm: "h-9 w-9 rounded-xl [&>svg]:h-4 [&>svg]:w-4",
  md: "h-11 w-11 rounded-2xl [&>svg]:h-5 [&>svg]:w-5",
  lg: "h-14 w-14 rounded-2xl [&>svg]:h-6 [&>svg]:w-6",
};

export function IconTile({ icon: Icon, tone = "brand", size = "md", className = "" }) {
  if (!Icon) return null;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${tileSizes[size] ?? tileSizes.md} ${
        tileTones[tone] ?? tileTones.brand
      } ${className}`}
    >
      <Icon />
    </span>
  );
}

export function Badge({ children, tone = "slate", className = "" }) {
  // Outcome tones read from the verdict tokens rather than raw Tailwind hues,
  // so "green means advanced" is a system fact instead of a convention each
  // component re-picks. The pending tone in particular moved off `amber-700`,
  // which sat at 4.35:1 on its own tint — under AA at the 12px it ships at.
  //
  // There is no `ember` tone, and that omission is the enforcement point for
  // the Ember Containment Rule. Orange is a neighbour of the reserved pending
  // amber; an ember badge would put a decorative colour into the one channel a
  // recruiter reads fastest, and "awaiting a human" would stop being legible at
  // a glance. Ember lives on fills and icon tiles. It never states a state.
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-verdict-positive-tint text-verdict-positive",
    amber: "bg-verdict-pending-tint text-verdict-pending",
    red: "bg-verdict-negative-tint text-verdict-negative",
    brand: "bg-brand-100 text-brand-700",
  };
  // `whitespace-nowrap`: a pill whose label wraps to two lines reads as broken
  // rather than as a status. Long labels widen the pill; they never stack it.
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * The metric tile the reference deck leads with. Deliberately plain: a label, a
 * number, and an optional icon.
 *
 * `note` exists so a figure can carry its own caveat inline — an estimate, a
 * partial period, a fallback reading. CLAUDE.md's rule is that a degraded
 * result must never be dressed as a measurement, and a stat tile is exactly
 * where that would otherwise happen silently, because a big confident number
 * with no qualifier *is* a claim.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  note,
  action,
  className = "",
  ...props
}) {
  const filled = tone.startsWith("filled-");
  return (
    <Card tone={tone} className={`flex items-start gap-4 ${className}`} {...props}>
      {Icon && <IconTile icon={Icon} tone={filled ? "on-fill" : tone === "ember" ? "ember" : "brand"} />}
      <div className="min-w-0 flex-1">
        {/* white/90, not the /70–/75 that reads as "secondary" on a mock: over
            brand-600 those land at 3.8:1 and 4.4:1. On a filled card the
            hierarchy has to come from weight and size, because opacity is
            spending contrast the small text does not have to give. */}
        <p className={`text-xs font-semibold ${filled ? "text-white/90" : "text-slate-500"}`}>{label}</p>
        {/* Lexend via font-display: this is display text, not a heading, so it
            does not inherit the base-layer treatment on its own. */}
        <p
          className={`font-display mt-1 text-2xl font-bold tracking-tight [overflow-wrap:anywhere] ${
            filled ? "text-white" : "text-slate-900"
          }`}
        >
          {value}
        </p>
        {note && <p className={`mt-1 text-xs ${filled ? "text-white/90" : "text-slate-500"}`}>{note}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </Card>
  );
}

/**
 * The title row *inside* a card or a section band. Distinct from <PageHeader>,
 * which owns the top of a whole screen — mixing the two is how heading sizes
 * drifted across pages before either existed.
 */
export function SectionHeader({ title, description, action, icon: Icon, className = "" }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-x-6 gap-y-3 ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <IconTile icon={Icon} size="sm" />}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-1 max-w-prose text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  // The pulse is an ambient loop with nothing waiting on it, so it is the first
  // thing to go under reduced motion. The shape alone still reads as "not
  // loaded yet", which is the whole job.
  return <div className={`animate-pulse motion-reduce:animate-none rounded-lg bg-slate-200/80 ${className}`} />;
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-brand-200 bg-brand-50/40 px-6 py-14 text-center">
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
