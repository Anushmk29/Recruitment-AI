import { createContext, forwardRef, useContext, useId, useMemo, useRef } from "react";

/**
 * Form primitives.
 *
 * A label and its control are only connected when the label's `htmlFor` matches
 * the control's `id`. Nothing here generated ids, so every <Label> in the app
 * was decorative text: clicking it focused nothing, and a screen reader read
 * fifteen consecutive "edit text, blank" on the job form — the form that sets
 * the ATS threshold deciding who gets an interview.
 *
 * FormGroup now mints one id per group and passes it down through context.
 * Label points at it, the control claims it, and FieldError is linked by
 * `aria-describedby`. No call site changes: the wiring is invisible from the
 * outside, which is the only way it stays correct across 61 form groups.
 */
const FieldContext = createContext(null);

/**
 * The first control inside a group takes the group's id — the one Label targets.
 * A later control in the same group gets its own unique id instead of a
 * duplicate: no group needs two controls today, but a silently duplicated id
 * breaks label association for *both* fields, which is worse than the bug we
 * are fixing. An explicit `id` prop always wins.
 */
function useControlId(explicitId) {
  const ctx = useContext(FieldContext);
  const own = useId();
  if (explicitId) return explicitId;
  if (!ctx) return undefined;
  if (ctx.claimed.current === null) ctx.claimed.current = own;
  return ctx.claimed.current === own ? ctx.id : own;
}

// `error` is already the styling flag on every control; reuse it as the truth
// for the ARIA state so the visual and programmatic error can never disagree.
function useFieldA11y(explicitId, error) {
  const ctx = useContext(FieldContext);
  const id = useControlId(explicitId);
  return {
    id,
    "aria-invalid": error ? "true" : undefined,
    "aria-describedby": error && ctx ? ctx.errorId : undefined,
  };
}

// Focus moves the BORDER from slate-300 to near-black ink and adds a greige
// ring. With an achromatic primary the border swing is what carries the state —
// it is a large contrast change around the whole perimeter — where the previous
// violet border did the work and the ring merely decorated it. The ring stepped
// 100 → 200 so it is still perceptible on white now that it is a warm grey.
// Padding is kept out of the shared chrome so the compact variant can swap it
// instead of layering a second, competing padding class on top of it.
const fieldChrome =
  "rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-500 shadow-sm transition-colors duration-150 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:bg-slate-100 disabled:text-slate-500";
const fieldClass = `${fieldChrome} px-3.5 py-2.5`;
// For a control that sits inline in a list row rather than stacked in a form.
const fieldCompactClass = `${fieldChrome} px-2.5 py-1.5`;

/**
 * `w-full` is the right default for a field stacked in a form and the wrong one
 * for a field sitting inline in a row. Tailwind cannot express "unless the
 * caller says otherwise": both `w-full` and the caller's `w-36` end up in the
 * same class attribute, and which one applies is decided by the order the rules
 * happen to sit in the compiled stylesheet — not by the call site's intent.
 *
 * This bit us for real. RubricEditor's importance dropdown asked for `w-36`,
 * `w-full` won, and because the control is also `shrink-0` it took the entire
 * row: the criterion name was crushed to zero width and the computed share and
 * delete button were pushed outside the card. The screen still "worked" while
 * showing a list of criteria with no names.
 *
 * So the default width is only emitted when the caller has not supplied one.
 * `max-w-*` / `min-w-*` are constraints, not widths, and deliberately do not
 * count — they compose with `w-full` correctly today (see JobForm's threshold
 * input) and must keep doing so.
 */
// Variant prefixes count, so `sm:w-36` suppresses the default too — otherwise a
// responsive width would lose to `w-full` at exactly the breakpoints it exists
// for. `max-w-` / `min-w-` never match: the `w-` in them is not at a token or
// variant boundary.
const HAS_WIDTH = /(?:^|\s)(?:[\w.[\]/-]+:)*(?:w-|size-)\S/;
function withWidth(className) {
  return HAS_WIDTH.test(className) ? "" : "w-full";
}

export const Input = forwardRef(function Input({ className = "", error, id, ...props }, ref) {
  const a11y = useFieldA11y(id, error);
  return (
    <input
      ref={ref}
      {...a11y}
      className={`${withWidth(className)} ${fieldClass} ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : ""} ${className}`}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className = "", error, id, ...props }, ref) {
  const a11y = useFieldA11y(id, error);
  return (
    <textarea
      ref={ref}
      {...a11y}
      // `resize-y`, not the browser default `resize: both` — a textarea the user
      // can drag wider than its column silently breaks the form grid, and the
      // horizontal handle has no legitimate use inside a fixed-width field.
      className={`${withWidth(className)} ${fieldClass} resize-y ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : ""} ${className}`}
      {...props}
    />
  );
});

// `compact` is a prop rather than a class the caller passes because padding has
// the same order-dependent collision that width does — a caller's `py-1.5` and
// the base `py-2.5` would both apply and the winner would be arbitrary. It is
// also swallowed here so it never reaches the DOM: `size` on a real <select> is
// the number of visible rows, so this variant must not be spelled that way.
export const Select = forwardRef(function Select({ className = "", error, id, compact = false, children, ...props }, ref) {
  const a11y = useFieldA11y(id, error);
  return (
    <select
      ref={ref}
      {...a11y}
      className={`${withWidth(className)} ${compact ? fieldCompactClass : fieldClass} ${error ? "border-red-400" : ""} ${className}`}
      {...props}
    >
      {children}
    </select>
  );
});

export function Label({ children, required, htmlFor, className = "" }) {
  const ctx = useContext(FieldContext);
  return (
    <label htmlFor={htmlFor || ctx?.id} className={`mb-1.5 block text-sm font-semibold text-slate-700 ${className}`}>
      {children}
      {required && (
        <>
          {/* A bare asterisk is announced as "star", which tells a screen-reader
              user nothing. Hide the glyph and say the word. */}
          <span aria-hidden="true" className="text-red-500"> *</span>
          <span className="sr-only"> (required)</span>
        </>
      )}
    </label>
  );
}

export function FieldError({ children, id }) {
  const ctx = useContext(FieldContext);
  if (!children) return null;
  return (
    <p id={id || ctx?.errorId} className="mt-1 text-xs font-medium text-red-600">
      {children}
    </p>
  );
}

export function FormGroup({ children, className = "" }) {
  const id = useId();
  const claimed = useRef(null);
  const value = useMemo(() => ({ id, errorId: `${id}-error`, claimed }), [id]);
  return (
    <FieldContext.Provider value={value}>
      <div className={`mb-4 ${className}`}>{children}</div>
    </FieldContext.Provider>
  );
}
