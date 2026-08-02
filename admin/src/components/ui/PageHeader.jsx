/**
 * The title / description / action row every dashboard screen opens with.
 *
 * Each page previously hand-rolled this, which is why the spacing and the
 * heading size drifted between them. One component means one rhythm.
 */
export default function PageHeader({ title, description, action, children }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-slate-500">{description}</p>}
        {children}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}
