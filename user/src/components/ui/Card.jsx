/**
 * Shared surfaces. Every candidate screen composes from these, so a change here
 * lands on all of them at once.
 *
 * Kept in step with admin/src/components/ui/Card.jsx — see DESIGN.md § Do's
 * ("keep the two frontends' UI kits identical").
 */

export function Card({ children, className = "", as: Component = "div", interactive = false, ...props }) {
  // `interactive` is opt-in: a card that lifts on hover but does nothing when
  // clicked is a false affordance. Only pass it when the whole card is a target.
  return (
    <Component
      className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-card ${
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

export function Badge({ children, tone = "slate", className = "" }) {
  // Outcome tones read from the verdict tokens rather than raw Tailwind hues,
  // so "green means advanced" is a system fact instead of a convention each
  // component re-picks. The pending tone in particular moved off `amber-700`,
  // which sat at 4.35:1 on its own tint — under AA at the 12px it ships at.
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

export function Skeleton({ className = "" }) {
  // The pulse is an ambient loop with nothing waiting on it, so it is the first
  // thing to go under reduced motion. The shape alone still reads as "not
  // loaded yet", which is the whole job.
  return <div className={`animate-pulse motion-reduce:animate-none rounded-lg bg-slate-200/80 ${className}`} />;
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-14 text-center">
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
