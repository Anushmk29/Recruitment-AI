import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion.js";

/**
 * One-shot scroll reveal.
 *
 * Deliberately one-shot: content that re-animates every time it re-enters the
 * viewport means the page never settles, which is the single most-recognisable
 * generated-page motion tell. Once revealed, an element is simply there.
 *
 * Never wrap the hero or any LCP element in this — above-the-fold content must
 * paint immediately, not wait on an observer.
 *
 * The visible state is driven by a data attribute so the transition tokens stay
 * in CSS rather than being inlined per element.
 */
export default function Reveal({
  as: Tag = "div",
  delay = 0,
  className = "",
  children,
  ...props
}) {
  const ref = useRef(null);
  const reducedMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    // Reduced motion, or no IntersectionObserver: show it, skip the animation.
    // Content is never gated behind a capability the browser might lack.
    if (reducedMotion || typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return undefined;
    }

    const node = ref.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion]);

  return (
    <Tag
      ref={ref}
      data-reveal=""
      data-revealed={revealed ? "true" : "false"}
      style={delay ? { "--reveal-delay": `${delay}ms` } : undefined}
      className={className}
      {...props}
    >
      {children}
    </Tag>
  );
}
