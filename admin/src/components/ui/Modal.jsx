import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * The one overlay primitive.
 *
 * Before this existed, all three overlays in the app (publish-to-boards,
 * platform suspend-reason, mobile nav drawer) were a bare <div> over a scrim:
 * no dialog role, no Escape, no focus trap, no focus restore. Keyboard focus
 * stayed behind the scrim on content the user could no longer see, and the
 * mobile drawer — the entire navigation on a tablet — could be opened and not
 * closed without a mouse.
 *
 * Rendered through a portal on purpose: `position: fixed` resolves against the
 * nearest transformed ancestor, and the dashboard's <main> carries a transform
 * during its route-change animation. In the DOM tree an overlay opened mid
 * animation would be positioned against the page, not the viewport.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
};

export default function Modal({
  open,
  onClose,
  title,
  description,
  label,
  size = "lg",
  // "center" is a dialog; "left" is an edge drawer. Same semantics either way —
  // a drawer that owns the screen is a dialog whatever it looks like.
  placement = "center",
  panelClassName = "",
  className = "",
  showClose = true,
  children,
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const headingId = useId();

  // Escape, and Tab cycling inside the panel. Bound to the panel rather than the
  // document so a nested overlay closes only itself.
  const onKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!nodes || nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return undefined;

    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    // Prefer the first real control; fall back to the panel itself so focus is
    // never left behind the scrim on a dialog that happens to be read-only.
    const target = panel?.querySelector(FOCUSABLE) || panel;
    target?.focus?.({ preventScroll: true });

    // The page behind a dialog must not scroll under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      // Return focus to whatever opened this, so the keyboard user resumes where
      // they were rather than at the top of the document.
      const restore = restoreRef.current;
      if (restore && document.contains(restore)) restore.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const centred = placement === "center";

  return createPortal(
    <div
      className={`fixed inset-0 z-50 ${centred ? "flex items-center justify-center p-4" : ""} ${className}`}
      onKeyDown={onKeyDown}
    >
      {/* mousedown, not click: a click that STARTS inside the panel and ends on
          the scrim (text selection dragged past the edge) must not close it. */}
      <div className="absolute inset-0 bg-slate-900/50" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={label ? undefined : title ? headingId : undefined}
        tabIndex={-1}
        className={
          centred
            ? `relative max-h-[85vh] w-full overflow-y-auto rounded-2xl bg-white p-5 shadow-deep focus:outline-none ${SIZES[size] || SIZES.lg} ${panelClassName}`
            : `absolute inset-y-0 left-0 flex flex-col shadow-deep focus:outline-none ${panelClassName}`
        }
      >
        {title && (
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 id={headingId} className="text-base font-semibold text-slate-900">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
            </div>
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-m-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <X className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
