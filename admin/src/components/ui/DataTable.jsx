/**
 * Table primitives.
 *
 * **Do not reach for these to build a list screen.** Every list screen — jobs,
 * candidates, interview queue, tenants, audit trail, reports — renders
 * `<RecordCard>` from `Panels.jsx` instead of rows; see DESIGN.md § The
 * Record-Card Rule for why. `RowAction` at the bottom of this file is the
 * icon-only action affordance and moved onto the cards intact.
 *
 * These were kept unused for a year on the argument that "a genuinely columnar
 * surface may yet need them", and one arrived: the interview report's role map
 * is criterion × evidence source, which is the 2-D matrix the Record-Card Rule
 * names as its own exception. That is the bar. One axis must not be "records".
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

/**
 * Cell padding is a PROP, not a `className` override — the third time this trap
 * has been paid for in this codebase, after `<Card>`'s padding and its surface.
 * Tailwind resolves two competing `px-*` utilities by its own stylesheet order,
 * which sorts the spacing scale ascending, so `px-6` from the component beats
 * `px-3` from a call site no matter which appears later in the string.
 *
 * It earns its keep here rather than being theoretical: `default` is right for a
 * four-column list, and a seven-column matrix like the role map spends 84px per
 * row on gutters alone at that setting. See DESIGN.md § The Bring-Your-Own-
 * Surface Rule for the general form.
 */
const thPadding = { default: "px-6 py-3", compact: "px-3 py-2.5", tight: "px-2 py-2.5", none: "px-0 py-2.5" };
const tdPadding = { default: "px-6 py-4", compact: "px-3 py-3", tight: "px-2 py-3", none: "px-0 py-3" };
const cellAlign = { left: "", right: "text-right", center: "text-center" };

export function TH({ children, align = "left", padding = "default", className = "" }) {
  return (
    <th
      scope="col"
      className={`font-semibold ${thPadding[padding] ?? thPadding.default} ${cellAlign[align] ?? ""} ${className}`}
    >
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
  //
  // The explicit `bg-white` is what lets a sticky first column work: a sticky
  // cell needs an opaque background or the scrolling columns slide visibly
  // underneath it, and `bg-inherit` on that cell then picks up this row's
  // background — including the hover tint, which a hardcoded white would have
  // frozen out of the one column that stays on screen.
  return (
    <tr className={`bg-white transition-colors duration-150 hover:bg-slate-50/80 ${className}`}>{children}</tr>
  );
}

export function TD({ children, align = "left", padding = "default", className = "" }) {
  return (
    <td className={`${tdPadding[padding] ?? tdPadding.default} ${cellAlign[align] ?? ""} ${className}`}>{children}</td>
  );
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
