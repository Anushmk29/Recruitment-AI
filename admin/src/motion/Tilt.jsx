import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion.js";

/**
 * Pointer-tracked perspective tilt — real dimensionality on a real surface,
 * rather than a decorative 3D object floating behind the content.
 *
 * The distinction matters: an ambient WebGL sphere or a floating orb is depth
 * with no semantic anchor, and reads as generated within a glance. A card that
 * turns fractionally toward the pointer is depth that responds to intent, so it
 * behaves like a physical object the user is addressing.
 *
 * Held deliberately small (MAX_TILT below). Past a few degrees the text on the
 * surface starts to shear and legibility goes, and the effect stops reading as
 * a material and starts reading as a gimmick.
 *
 * Guards: fine pointers only (a tilt no touch user can trigger is a hover-only
 * affordance), and off entirely under reduced motion.
 */

const MAX_TILT = 3.5; // degrees
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

export default function Tilt({ as: Tag = "div", className = "", children, ...props }) {
  const ref = useRef(null);
  const frame = useRef(0);
  const reducedMotion = useReducedMotion();
  const [finePointer, setFinePointer] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(FINE_POINTER);
    const onChange = (event) => setFinePointer(event.matches);
    setFinePointer(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const enabled = finePointer && !reducedMotion;

  const reset = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const node = ref.current;
    if (node) node.style.removeProperty("transform");
  }, []);

  const onPointerMove = useCallback(
    (event) => {
      if (!enabled) return;
      const node = ref.current;
      if (!node) return;

      // Coalesced into a frame: pointermove fires far faster than the compositor
      // paints, and writing transform per event is wasted work.
      cancelAnimationFrame(frame.current);
      const { clientX, clientY } = event;
      frame.current = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        // -0.5 … 0.5 from the card's centre.
        const x = (clientX - rect.left) / rect.width - 0.5;
        const y = (clientY - rect.top) / rect.height - 0.5;
        node.style.transform = `perspective(1100px) rotateX(${(-y * MAX_TILT).toFixed(2)}deg) rotateY(${(x * MAX_TILT).toFixed(2)}deg)`;
      });
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled) reset();
    return () => cancelAnimationFrame(frame.current);
  }, [enabled, reset]);

  return (
    <Tag
      ref={ref}
      data-tilt={enabled ? "on" : "off"}
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      onBlur={reset}
      className={className}
      {...props}
    >
      {children}
    </Tag>
  );
}
