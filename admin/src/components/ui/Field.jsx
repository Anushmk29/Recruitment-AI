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
const fieldClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 shadow-sm transition-colors duration-150 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:bg-slate-100 disabled:text-slate-500";

export const Input = forwardRef(function Input({ className = "", error, id, ...props }, ref) {
  const a11y = useFieldA11y(id, error);
  return (
    <input
      ref={ref}
      {...a11y}
      className={`${fieldClass} ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : ""} ${className}`}
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
      className={`${fieldClass} resize-y ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : ""} ${className}`}
      {...props}
    />
  );
});

export const Select = forwardRef(function Select({ className = "", error, id, children, ...props }, ref) {
  const a11y = useFieldA11y(id, error);
  return (
    <select
      ref={ref}
      {...a11y}
      className={`${fieldClass} ${error ? "border-red-400" : ""} ${className}`}
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
