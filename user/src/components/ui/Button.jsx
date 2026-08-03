import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

const variants = {
  primary:
    "bg-brand-600 text-white shadow-soft hover:bg-brand-700 focus-visible:ring-brand-300 disabled:bg-brand-300",
  secondary:
    "bg-white text-brand-700 border border-brand-200 hover:bg-brand-50 focus-visible:ring-brand-200 disabled:opacity-50",
  outline:
    "bg-transparent text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-200 disabled:opacity-50",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-200 disabled:opacity-50",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-300 disabled:bg-red-300",
  // Ember CTA — marketing surfaces only (hero, pricing, conversion prompts),
  // where the job is "draw the eye", not "state an outcome". It stays inside
  // the Ember Containment Rule because emphasis is not a status.
  //
  // Two constraints are load-bearing here. It ships accent-700, not the
  // brighter accent-600: button labels are 14px semibold, i.e. normal text at
  // AA, and accent-600 on white is 3.86:1 — it only clears for large text.
  // And it must never sit beside `danger` in the same control group; two warm
  // saturated buttons side by side is how someone destroys a record they meant
  // to promote.
  accent:
    "bg-accent-700 text-white shadow-soft hover:bg-accent-800 focus-visible:ring-accent-300 disabled:bg-accent-300",
};

const sizes = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2.5 text-sm",
  lg: "px-6 py-3.5 text-base",
};

const Button = forwardRef(function Button(
  { as: Component = "button", variant = "primary", size = "md", loading = false, className = "", children, disabled, ...props },
  ref
) {
  return (
    <Component
      ref={ref}
      disabled={disabled || loading}
      // Properties are named rather than `transition-all` so the focus ring
      // (a box-shadow) appears instantly — a ring that fades in leaves keyboard
      // users with no indicator at the start of the transition.
      //
      // `tap-target` (index.css) raises this to the 44px comfort floor only on
      // coarse pointers. Candidates apply from whatever device they have, and a
      // "Start interview" button their thumb misses is the worst possible miss.
      //
      // `motion-reduce:active:scale-100` keeps the press *feedback* (the colour
      // still changes) while removing the movement, rather than removing both.
      className={`tap-target inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-4 active:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:active:scale-100 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </Component>
  );
});

export default Button;
