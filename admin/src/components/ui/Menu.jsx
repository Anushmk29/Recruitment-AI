import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The action menu — a button that opens a list of *commands*, not a form field.
 *
 * Every inline action in the app used to be a <select>. A select is a control
 * for choosing a VALUE inside a form: it announces as "combobox", it has no
 * concept of a destructive item, it cannot group or annotate its options, and
 * the browser renders it as an undifferentiated column of strings. Firing an
 * irreversible action — rejecting a candidate — out of one is a semantic
 * mismatch that shows up as a usability one: twelve identical lines, the safe
 * move and the terminal move a pixel apart, no way to say which is which.
 *
 * Rendered through a portal, for the same reason <Modal> is. The Hiring
 * Pipeline board is an `overflow-x-auto` rail, and `overflow-x: auto` computes
 * `overflow-y` to `auto` as well — an absolutely-positioned panel inside a
 * kanban column would be clipped by the column it opened from. Fixed
 * positioning off the trigger's rect is the only placement that survives both
 * that rail and a plain list row.
 *
 * The menu closes on scroll rather than tracking the trigger. A panel that
 * chases its button down a scrolling queue is more distracting than one that
 * gets out of the way, and re-opening costs a click.
 */

// Disabled items are skipped by arrow navigation rather than focused-and-inert,
// which is the behaviour of a menu the keyboard actually likes.
const ITEM = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])';

export default function Menu({ trigger, children, footer, label, align = "end", width = 268, className = "" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    // Focus goes back to the button that opened the menu, so a keyboard user
    // resumes where they were instead of at the top of the document. A detached
    // node (the row re-rendered under us) no-ops harmlessly.
    if (restoreFocus) triggerRef.current?.focus?.({ preventScroll: true });
  }, []);

  // Placement runs in a LAYOUT effect so the measure-then-move happens before
  // paint — the panel is mounted `invisible` for exactly one commit, and nobody
  // sees it at the origin. Flips above the trigger when the room below cannot
  // hold it, and clamps to the viewport either way.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const t = triggerRef.current?.getBoundingClientRect();
    const p = panelRef.current?.getBoundingClientRect();
    if (!t || !p) return;

    const margin = 8;
    const gap = 6;
    const below = window.innerHeight - t.bottom;
    const flip = below < p.height + gap + margin && t.top > below;
    const top = flip
      ? Math.max(margin, t.top - p.height - gap)
      : Math.max(margin, Math.min(t.bottom + gap, window.innerHeight - p.height - margin));
    const raw = align === "end" ? t.right - width : t.left;
    const left = Math.max(margin, Math.min(raw, window.innerWidth - width - margin));
    setPos({ top, left });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return undefined;

    panelRef.current?.querySelector(ITEM)?.focus({ preventScroll: true });

    const onPointerDown = (e) => {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      close(false);
    };
    const dismiss = () => close(false);

    document.addEventListener("mousedown", onPointerDown);
    // Capture phase: the scroll that matters is usually an ancestor's, not the
    // window's — the pipeline rail and the dashboard's own scroll container.
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, close]);

  function onPanelKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    // Tab out of an open menu closes it and lands on the trigger, so the next
    // Tab continues along the page rather than into a floating panel.
    if (e.key === "Tab") {
      e.preventDefault();
      close();
      return;
    }
    const items = Array.from(panelRef.current?.querySelectorAll(ITEM) || []);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement);
    const go = { ArrowDown: (i + 1) % items.length, ArrowUp: (i - 1 + items.length) % items.length, Home: 0, End: items.length - 1 };
    if (e.key in go) {
      e.preventDefault();
      items[go[e.key]]?.focus();
    }
  }

  const triggerNode = cloneElement(trigger, {
    ref: triggerRef,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    onClick: (e) => {
      trigger.props.onClick?.(e);
      setOpen((v) => !v);
    },
    onKeyDown: (e) => {
      trigger.props.onKeyDown?.(e);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
    },
  });

  return (
    <>
      {triggerNode}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            onKeyDown={onPanelKeyDown}
            // Selection closes the menu here rather than in every item, so an
            // item's own onSelect stays a plain callback. React bubbling runs
            // the item's handler first, which is the order this needs.
            onClick={(e) => {
              if (e.target.closest?.(ITEM)) close();
            }}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width }}
            // `opacity-0` for the one pre-measure commit, NOT `invisible`: a
            // `visibility: hidden` subtree is not focusable, so the effect below
            // that moves focus onto the first item silently did nothing and the
            // menu opened with the keyboard stranded on the trigger. Opacity
            // hides it just as completely and keeps it focusable.
            className={`fixed z-50 flex max-h-[min(26rem,70vh)] flex-col rounded-2xl border border-slate-200 bg-white shadow-lift ${
              pos ? "" : "pointer-events-none opacity-0"
            } ${className}`}
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">{children}</div>
            {/* The footer sits OUTSIDE the scroll area on purpose. A menu long
                enough to scroll would otherwise bury its last item, and the last
                item is where a destructive command belongs — "Reject" reachable
                only by scrolling past eleven safe options is the failure mode
                this whole component exists to remove. */}
            {footer && <div className="shrink-0 border-t border-slate-100 p-1.5">{footer}</div>}
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * A titled block of items. The title is what turns "twelve destinations" into
 * "advance to / other rounds / reject" — the grouping is the whole reason a
 * menu beats a select here.
 */
export function MenuGroup({ label, children, className = "" }) {
  return (
    <div role="group" aria-label={label} className={className}>
      {label && (
        <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
      )}
      {children}
    </div>
  );
}

export function MenuSeparator({ className = "" }) {
  return <div role="separator" className={`my-1.5 border-t border-slate-100 ${className}`} />;
}

/**
 * One command.
 *
 * `tone="danger"` is not decoration: it is the affordance that stops a terminal
 * action from looking like the eleven reversible ones above it. It reads from
 * the verdict-negative token, the same one <Badge tone="red"> uses, so
 * "red means this ends the application" stays one fact across the product.
 *
 * `tabIndex={-1}` on every item with focus moved by the parent's arrow keys is
 * the menu pattern's roving-focus contract — a menu whose items are all in the
 * tab order makes Tab the wrong key for leaving it.
 */
export function MenuItem({
  children,
  onSelect,
  leading,
  trailing,
  description,
  tone = "default",
  disabled = false,
  className = "",
}) {
  const tones = {
    default: "text-slate-700 hover:bg-brand-50 hover:text-brand-800",
    danger: "text-verdict-negative hover:bg-verdict-negative-tint",
  };
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition-colors duration-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50 ${
        tones[tone] ?? tones.default
      } ${className}`}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {description && <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">{description}</span>}
      </span>
      {trailing}
    </button>
  );
}
