/**
 * Shared surfaces. Every dashboard screen composes from these, so a change here
 * lands on all of them at once.
 */

export function Card({ children, className = "", as: Component = "div", interactive = false, ...props }) {
  // `interactive` is opt-in: a card that lifts on hover but does nothing when
  // clicked is a false affordance. Only pass it when the whole card is a target.
  return (
    <Component
      className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-card ${
        interactive
          ? "transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lift"
          : ""
      } ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}

export function Badge({ children, tone = "slate", className = "" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
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
  return <div className={`animate-pulse rounded-lg bg-slate-200/80 ${className}`} />;
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
