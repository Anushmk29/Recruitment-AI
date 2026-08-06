import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

// Focus rings are one step darker than a "tint" would suggest, across every
// variant. A ring is only an affordance if it is visible against the surface
// BEHIND the control, and the surface is bone (#f6f2ea): tint-weight rings
// measured 1.4–1.9:1 against it, i.e. the loudest treatment in the system had
// quietly become the faintest. Each value below clears the 3:1 floor WCAG 2.2
// sets for a focus indicator — brand-300 3.37:1, slate-400 3.04:1, red-500
// 3.37:1, accent-500 3.33:1.
//
// Every FILLED variant disables to the same greige, and that uniformity is the
// point. Each used to disable into its own ramp's 300, which worked while those
// were tints and broke the moment brand-300 became the (necessarily dark) petrol
// focus step: a disabled primary rendered as a solid mid-teal block that read as
// a live button — louder than the real secondary beside it. A disabled control
// must not be able to out-shout an enabled one, so the disabled surface is
// neutral and shared, and the label goes muted with it rather than staying
// white. slate-500 on slate-200 is 4.14:1: unmistakably inert, still readable.
const DISABLED_FILL = "disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none";

const variants = {
  primary:
    `bg-brand-600 text-white shadow-soft hover:bg-brand-700 focus-visible:ring-brand-300 ${DISABLED_FILL}`,
  secondary:
    "bg-white text-brand-700 border border-brand-200 hover:bg-brand-50 focus-visible:ring-brand-300 disabled:opacity-50",
  outline:
    "bg-transparent text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400 disabled:opacity-50",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400 disabled:opacity-50",
  // The verdict token, not raw `red-600`. DESIGN.md § Buttons always specified
  // "Verdict Negative"; the implementation had drifted to a brighter Tailwind
  // red, which on the bone canvas was the loudest thing on any screen it
  // appeared on — louder than an actual rejection badge.
  danger: `bg-verdict-negative text-white hover:bg-red-900 focus-visible:ring-red-500 ${DISABLED_FILL}`,
  // Clay CTA — marketing surfaces only (hero, pricing, conversion prompts),
  // where the job is "draw the eye", not "state an outcome". It stays inside
  // the Ember Containment Rule because emphasis is not a status.
  //
  // It ships accent-700 (6.93:1 on white) rather than accent-600 (4.99:1).
  // Both now clear AA for the 14px semibold label, unlike the old coral ramp
  // where 600 was 3.86:1 and only legal at large sizes — but 700 is what keeps
  // this readable as a *considered* CTA rather than a bright one, which is the
  // whole reason the ramp was muted to clay.
  //
  // It must never sit beside `danger` in the same control group: two warm
  // saturated buttons side by side is how someone destroys a record they meant
  // to promote.
  accent:
    `bg-accent-700 text-white shadow-soft hover:bg-accent-800 focus-visible:ring-accent-500 ${DISABLED_FILL}`,
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
      // `tap-target` (index.css) raises this to the 44px comfort floor only on
      // coarse pointers. On a mouse the sm/md heights stay 32/40px, which is
      // what makes a dense toolbar readable.
      className={`tap-target inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-4 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </Component>
  );
});

export default Button;
