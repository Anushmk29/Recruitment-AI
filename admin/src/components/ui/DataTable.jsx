/**
 * Table primitives shared by every list screen (jobs, candidates, audit trail,
 * assessments, reports).
 *
 * Two fixes baked in, because every page had drifted into the same two bugs:
 *
 * 1. Column headers are sentence case, not `uppercase tracking-wide`. DESIGN.md's
 *    Sentence-Case Rule exists because the system's smallest text is already
 *    dense — adding caps and letter-spacing to 12px costs a recruiter legibility
 *    exactly where they are scanning fastest.
 * 2. Header text is slate-600, not slate-400. slate-400 on white is 2.8:1 and
 *    fails WCAG AA for body text; a column header is not decoration.
 */

export function TableWrap({ children }) {
  // Horizontal overflow is owned here so no page has to remember it, and so a
  // wide table scrolls inside its own container rather than the document.
  return <div className="overflow-x-auto">{children}</div>;
}

export function Table({ children, className = "" }) {
  return <table className={`w-full text-left text-sm ${className}`}>{children}</table>;
}

export function THead({ children }) {
  return (
    <thead className="border-b border-slate-200 text-xs font-semibold text-slate-600">
      {children}
    </thead>
  );
}

export function TH({ children, align = "left", className = "" }) {
  return (
    <th scope="col" className={`px-6 py-3 font-semibold ${align === "right" ? "text-right" : ""} ${className}`}>
      {children}
    </th>
  );
}

export function TBody({ children }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}

export function TR({ children, className = "" }) {
  // One hover signal — a background tint. Not a lift, not a shadow, not a
  // scale: a row is a line in a list, and rows that jump make a queue hard to
  // track with the eye.
  return (
    <tr className={`transition-colors duration-150 hover:bg-slate-50/80 ${className}`}>{children}</tr>
  );
}

export function TD({ children, align = "left", className = "" }) {
  return <td className={`px-6 py-4 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}

/**
 * Icon-only row action. The previous inline version had no accessible name, no
 * focus ring, and a 16px hit target. 36px on a mouse keeps a row scannable;
 * `tap-target` takes it to 44px wherever the pointer is coarse.
 */
export function RowAction({ as: Component = "button", label, icon: Icon, tone = "brand", className = "", ...props }) {
  const tones = {
    brand: "hover:text-brand-700 focus-visible:outline-brand-600",
    danger: "hover:text-red-600 focus-visible:outline-red-600",
    positive: "hover:text-emerald-600 focus-visible:outline-emerald-600",
  };
  return (
    <Component
      title={label}
      aria-label={label}
      className={`tap-target inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 ${tones[tone]} ${className}`}
      {...props}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Component>
  );
}
