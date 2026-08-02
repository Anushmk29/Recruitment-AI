import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import "lenis/dist/lenis.css";
import { useReducedMotion } from "./useReducedMotion.js";

/**
 * Headless Lenis controller. Renders nothing.
 *
 * Two deliberate restrictions:
 *
 * 1. Marketing surface only. Interpolated scrolling desyncs the scrollbar from
 *    the wheel, which is a pleasant effect on a page you read top-to-bottom and
 *    a regression on one you scan. A recruiter working the candidate table or
 *    the pipeline board needs the scroll position to be exactly where they put
 *    it, so the dashboard keeps native scrolling.
 * 2. Off entirely under `prefers-reduced-motion: reduce`.
 *
 * The instance is created and destroyed as the route crosses that boundary,
 * rather than mounting a provider around the tree — toggling a provider would
 * remount every route on navigation.
 */

// Long-form marketing pages only. Short transactional routes (checkout, OTP)
// are a single viewport of form and gain nothing from smoothing.
const SMOOTH_PATHS = new Set(["/welcome", "/demo", "/pricing"]);

export function isSmoothPath(pathname) {
  return SMOOTH_PATHS.has(pathname);
}

/**
 * @param {boolean} allowRoot - whether "/" is currently the marketing Landing
 *   page (signed-out) rather than the dashboard. The caller owns auth state.
 */
export default function SmoothScroll({ allowRoot = false }) {
  const { pathname } = useLocation();
  const reducedMotion = useReducedMotion();

  const active = !reducedMotion && (isSmoothPath(pathname) || (allowRoot && pathname === "/"));

  useEffect(() => {
    if (!active) return undefined;

    let lenis;
    let cancelled = false;

    // Loaded on demand rather than imported at module scope. The engine is
    // marketing-surface only by rule (2 above), so a signed-in recruiter should
    // never download it — and with a static import they did, on every page of
    // the dashboard, for a behaviour that is switched off there.
    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({
        autoRaf: true,
        duration: 1.1,
        // Exponential ease-out — the decelerate-into-place curve. No overshoot:
        // bounce on scroll reads as a toy, and this product is not one.
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        // Native touch scrolling is already smooth and already has momentum the
        // user's OS tuned. Overriding it makes phones feel laggy.
        syncTouch: false,
      });
    });

    return () => {
      cancelled = true;
      lenis?.destroy();
    };
  }, [active]);

  // Anchor links (#how-it-works) must still land when Lenis owns the scroll.
  useEffect(() => {
    if (!window.location.hash) return;
    const target = document.querySelector(window.location.hash);
    if (!target) return;
    const id = window.requestAnimationFrame(() =>
      target.scrollIntoView({ behavior: active ? "smooth" : "auto", block: "start" })
    );
    return () => window.cancelAnimationFrame(id);
  }, [pathname, active]);

  return null;
}
