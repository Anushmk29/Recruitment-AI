import { forwardRef } from "react";

const fieldClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 shadow-sm transition-colors duration-150 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-slate-100 disabled:text-slate-500";

export const Input = forwardRef(function Input({ className = "", error, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={`${fieldClass} ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : ""} ${className}`}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className = "", error, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      // `resize-y`, not the browser default `resize: both` — a textarea the user
      // can drag wider than its column silently breaks the form grid, and the
      // horizontal handle has no legitimate use inside a fixed-width field.
      className={`${fieldClass} resize-y ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : ""} ${className}`}
      {...props}
    />
  );
});

export const Select = forwardRef(function Select({ className = "", error, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={`${fieldClass} ${error ? "border-red-400" : ""} ${className}`}
      {...props}
    >
      {children}
    </select>
  );
});

export function Label({ children, required, className = "" }) {
  return (
    <label className={`mb-1.5 block text-sm font-semibold text-slate-700 ${className}`}>
      {children}
      {required && <span className="text-red-500"> *</span>}
    </label>
  );
}

export function FieldError({ children }) {
  if (!children) return null;
  return <p className="mt-1 text-xs font-medium text-red-600">{children}</p>;
}

export function FormGroup({ children, className = "" }) {
  return <div className={`mb-4 ${className}`}>{children}</div>;
}
